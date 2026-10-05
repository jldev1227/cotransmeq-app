<script lang="ts">
	/**
	 * Registro de salidas no conformes (ISO 9001 · 8.7).
	 *
	 * Misma cáscara que los directorios (`dir-*` de app.css y `listing/`):
	 * cabecera con los conteos por estado, buscador y segmentos a la vista, un
	 * cajón de filtros para lo menos frecuente (detección y fechas), la tabla
	 * compartida con acciones por fila, y el formulario en el cascarón común de
	 * los modales de directorio. Antes era una página con su propio hero, un
	 * panel de cinco desplegables y un modal rojo de 1 200 px de alto.
	 *
	 * Filtros, orden y página viven en la URL; el orden lo resuelve el
	 * servidor porque la lista va paginada.
	 */
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { FileDown, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import ModalSalidaNC from '$lib/components/salidas-nc/ModalSalidaNC.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { mascota } from '$lib/mascot';
	import {
		salidasNCAPI,
		type SalidaNoConforme,
		type FiltrosSalidasNC,
		type ClasificacionNC,
		type TipoDeteccion,
		type EstadoSNC,
		type EstadisticasSNC,
		CLASIFICACION_LABELS,
		TIPO_DETECCION_LABELS,
		TIPO_SALIDA_NC_LABELS,
		ESTADO_SNC_LABELS
	} from '$lib/api/salidas-nc';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 10;

	/// Semáforo: iguales en los dos gemelos, no siguen la marca.
	const COLOR_ESTADO: Record<EstadoSNC, string> = {
		ABIERTA: '#ef4444',
		EN_TRATAMIENTO: '#f59e0b',
		CERRADA: '#22c55e'
	};
	const COLOR_CLASIF: Record<ClasificacionNC, string> = {
		CRITICA: '#dc2626',
		MAYOR: '#ea580c',
		MENOR: '#ca8a04'
	};

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface FiltrosSalidas {
		q: string;
		clasificacion: string;
		estado: string;
		deteccion: string;
		desde: string;
		hasta: string;
		pagina: number;
		orden: string;
		direccion: string;
	}
	const DEFS: DefinicionesFiltros<FiltrosSalidas> = {
		q: texto(),
		clasificacion: opcion(''),
		estado: opcion(''),
		deteccion: opcion(''),
		desde: texto(),
		hasta: texto(),
		pagina: numero(1),
		orden: opcion('numero_snc'),
		direccion: opcion('desc')
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosSalidas>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	function ponerFiltro<K extends keyof FiltrosSalidas>(clave: K, valor: FiltrosSalidas[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	/// Lo que no está a la vista (detección y fechas) se cuenta en el botón del
	/// cajón: un filtro invisible haría parecer la lista vacía sin motivo.
	const filtrosOcultos = $derived(
		[filtros.deteccion, filtros.desde, filtros.hasta].filter(Boolean).length
	);
	const hayFiltros = $derived(
		!!(filtros.q || filtros.clasificacion || filtros.estado) || filtrosOcultos > 0
	);
	let mostrarFiltros = $state(false);

	const SEGMENTOS_ESTADO = [
		{ valor: '', etiqueta: 'Todas' },
		...(Object.keys(ESTADO_SNC_LABELS) as EstadoSNC[]).map((e) => ({
			valor: e,
			etiqueta: ESTADO_SNC_LABELS[e].label,
			punto: COLOR_ESTADO[e]
		}))
	];
	const SEGMENTOS_CLASIF = [
		{ valor: '', etiqueta: 'Todas' },
		...(Object.keys(CLASIFICACION_LABELS) as ClasificacionNC[]).map((c) => ({
			valor: c,
			etiqueta: CLASIFICACION_LABELS[c].label,
			punto: COLOR_CLASIF[c]
		}))
	];

	// ── Datos ────────────────────────────────────────────────────────────
	let salidas = $state<SalidaNoConforme[]>([]);
	let total = $state(0);
	let cargando = $state(true);
	let estadisticas = $state<EstadisticasSNC | null>(null);

	$effect(() => {
		void filtros;
		void cargarSalidas();
	});
	$effect(() => {
		void cargarEstadisticas();
	});

	async function cargarSalidas() {
		cargando = true;
		try {
			const parametros: FiltrosSalidasNC = {
				page: filtros.pagina,
				limit: POR_PAGINA,
				sortBy: filtros.orden,
				sortOrder: filtros.direccion as 'asc' | 'desc',
				...(filtros.q && { busqueda: filtros.q }),
				...(filtros.clasificacion && { clasificacion_nc: filtros.clasificacion as ClasificacionNC }),
				...(filtros.estado && { estado: filtros.estado as EstadoSNC }),
				...(filtros.deteccion && { tipo_deteccion: filtros.deteccion as TipoDeteccion }),
				...(filtros.desde && { fecha_desde: filtros.desde }),
				...(filtros.hasta && { fecha_hasta: filtros.hasta })
			};
			const res = await salidasNCAPI.listar(parametros);
			salidas = res.salidas;
			total = res.total;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las salidas');
			salidas = [];
		} finally {
			cargando = false;
		}
	}

	async function cargarEstadisticas() {
		try {
			estadisticas = await salidasNCAPI.estadisticas();
		} catch {
			/* los conteos son de apoyo: sin ellos la lista sigue sirviendo */
		}
	}

	function recargar() {
		void cargarSalidas();
		void cargarEstadisticas();
	}

	const contarEstado = (e: EstadoSNC) => estadisticas?.porEstado.find((x) => x.estado === e)?.count ?? 0;
	const contarClasif = (c: ClasificacionNC) =>
		estadisticas?.porClasificacion.find((x) => x.clasificacion === c)?.count ?? 0;
	const resumen = $derived([
		{ clave: '', etiqueta: 'Total', valor: estadisticas?.total ?? 0 },
		...(Object.keys(ESTADO_SNC_LABELS) as EstadoSNC[]).map((e) => ({
			clave: e,
			etiqueta: ESTADO_SNC_LABELS[e].label,
			valor: contarEstado(e),
			color: COLOR_ESTADO[e]
		})),
		{ clave: 'CRITICA', etiqueta: 'Críticas', valor: contarClasif('CRITICA'), color: COLOR_CLASIF.CRITICA }
	]);
	function elegirConteo(clave: string) {
		if (clave === 'CRITICA') {
			ponerFiltro('clasificacion', filtros.clasificacion === 'CRITICA' ? '' : 'CRITICA');
			return;
		}
		ponerFiltro('estado', filtros.estado === clave ? '' : clave);
	}

	// ── Tabla ────────────────────────────────────────────────────────────
	/// Los `id` de las ordenables coinciden con el `sortBy` que acepta el
	/// backend; las que juntan campos no se ordenan y su cabecera no se pinta
	/// como pulsable.
	const COLUMNAS: ColumnDef<SalidaNoConforme, any>[] = [
		{ id: 'numero_snc', accessorKey: 'numero_snc', header: 'Salida' },
		{ id: 'fecha_deteccion', accessorKey: 'fecha_deteccion', header: 'Detección', size: 150 },
		{ id: 'conductor', header: 'Conductor · Vehículo', enableSorting: false, size: 220 },
		{ id: 'clasificacion_nc', accessorKey: 'clasificacion_nc', header: 'Clasificación', size: 130 },
		{ id: 'estado', accessorKey: 'estado', header: 'Estado', size: 140 },
		{ id: 'acciones', header: '', enableSorting: false, size: 130 }
	];
	const ordenTabla = $derived<SortingState>(
		filtros.orden ? [{ id: filtros.orden, desc: filtros.direccion === 'desc' }] : []
	);
	function aplicarOrden(nuevo: SortingState) {
		const [primero] = nuevo;
		filtros = {
			...filtros,
			/// Sin orden se vuelve al natural: la SNC más reciente arriba.
			orden: primero?.id ?? 'numero_snc',
			direccion: primero ? (primero.desc ? 'desc' : 'asc') : 'desc',
			pagina: 1
		};
	}

	const codigo = (n: number) => `SNC-${String(n).padStart(4, '0')}`;
	function fecha(f?: string) {
		if (!f) return '—';
		const [y, m, d] = f.split('T')[0].split('-');
		return `${d}/${m}/${y}`;
	}
	function tipoSalida(s: SalidaNoConforme) {
		return s.tipo_salida_nc === 'OTRO' && s.tipo_salida_nc_otro
			? s.tipo_salida_nc_otro
			: TIPO_SALIDA_NC_LABELS[s.tipo_salida_nc] || s.tipo_salida_nc;
	}

	// ── Acciones ─────────────────────────────────────────────────────────
	let modalAbierto = $state(false);
	let enEdicion = $state<SalidaNoConforme | null>(null);

	function abrirNueva() {
		enEdicion = null;
		modalAbierto = true;
	}
	function abrirEdicion(s: SalidaNoConforme) {
		enEdicion = s;
		modalAbierto = true;
	}

	async function eliminar(s: SalidaNoConforme) {
		const ok = await confirmarEliminacion({
			title: `¿Eliminar ${codigo(s.numero_snc)}?`,
			message: 'La salida no conforme y su registro de tratamiento y verificación se eliminarán.'
		});
		if (!ok) return;
		try {
			await salidasNCAPI.eliminar(s.id);
			toast.success(`${codigo(s.numero_snc)} eliminada`);
			recargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
		}
	}

	async function descargarPDF(s: SalidaNoConforme) {
		const id = toast.loading(`Generando el PDF de ${codigo(s.numero_snc)}…`);
		try {
			await salidasNCAPI.descargarPDF(s.id, s.numero_snc);
			toast.success('PDF descargado', { id });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo generar el PDF', { id });
		}
	}
</script>

<svelte:head>
	<title>Salidas no conformes — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Salidas no conformes</h1>
			<p class="dir-desc">
				Registro, tratamiento y verificación de las salidas no conformes del servicio · ISO 9001,
				cláusula 8.7.
			</p>
			<div class="dir-conteos">
				<ResumenConteos
					conteos={resumen}
					activo={filtros.clasificacion === 'CRITICA' ? 'CRITICA' : filtros.estado || null}
					onElegir={elegirConteo}
				/>
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			<button
				type="button"
				class="btn-secondary"
				class:snc-filtros--on={filtrosOcultos > 0}
				onclick={() => (mostrarFiltros = !mostrarFiltros)}
			>
				<SlidersHorizontal size={16} strokeWidth={2} />
				Filtros
				{#if filtrosOcultos > 0}<span class="snc-filtros-n">{filtrosOcultos}</span>{/if}
			</button>
			<button type="button" class="btn-primary" onclick={abrirNueva}>
				<Plus size={16} strokeWidth={2.4} />
				Registrar SNC
			</button>
		</div>

		<FilterDrawer
			open={mostrarFiltros}
			onClose={() => (mostrarFiltros = false)}
			eyebrow="Filtros"
			title="Refinar salidas"
			subtitle="Cómo se detectaron y en qué rango de fechas."
			activeCount={filtrosOcultos}
		>
			<div class="flex flex-col gap-5">
				<div class="filter-field">
					<label for="snc-f-deteccion" class="filter-field-label">Tipo de detección</label>
					<select
						id="snc-f-deteccion"
						value={filtros.deteccion}
						onchange={(e) => ponerFiltro('deteccion', e.currentTarget.value)}
					>
						<option value="">Todos</option>
						{#each Object.entries(TIPO_DETECCION_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label for="snc-f-desde" class="filter-field-label">Detectadas desde</label>
					<input
						id="snc-f-desde"
						type="date"
						class="snc-fecha"
						value={filtros.desde}
						onchange={(e) => ponerFiltro('desde', e.currentTarget.value)}
					/>
				</div>
				<div class="filter-field">
					<label for="snc-f-hasta" class="filter-field-label">Detectadas hasta</label>
					<input
						id="snc-f-hasta"
						type="date"
						class="snc-fecha"
						value={filtros.hasta}
						onchange={(e) => ponerFiltro('hasta', e.currentTarget.value)}
					/>
				</div>
			</div>
			<div slot="footer">
				<button class="filter-clear" onclick={limpiarFiltros} disabled={!hayFiltros}>Limpiar</button>
				<button class="btn-primary" onclick={() => (mostrarFiltros = false)}>Ver resultados</button>
			</div>
		</FilterDrawer>
	</header>

	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 80 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={filtros.q}
				onBuscar={(t) => ponerFiltro('q', t)}
				placeholder="Conductor, placa, descripción, área…"
				etiqueta="Buscar salidas no conformes"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Estado"
			opciones={SEGMENTOS_ESTADO}
			valor={filtros.estado}
			onCambiar={(v) => ponerFiltro('estado', v)}
		/>
		<SegmentosFiltro
			etiqueta="Clasificación"
			opciones={SEGMENTOS_CLASIF}
			valor={filtros.clasificacion}
			onCambiar={(v) => ponerFiltro('clasificacion', v)}
		/>
	</div>

	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 140 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={salidas}
				claveFila={(s) => s.id}
				{cargando}
				orden={ordenTabla}
				onOrdenar={aplicarOrden}
				onFila={abrirEdicion}
				etiqueta="Salidas no conformes registradas"
			>
				{#snippet celda({ columnaId, fila: s })}
					{#if columnaId === 'numero_snc'}
						<div class="snc-salida">
							<CeldaIdentidad
								codigo={String(s.numero_snc).padStart(4, '0')}
								titulo={tipoSalida(s)}
								subtitulo={s.area_proceso
									? `${s.area_proceso} · detectó ${s.detectado_por}`
									: `Detectó ${s.detectado_por}`}
							/>
						</div>
					{:else if columnaId === 'fecha_deteccion'}
						<div class="dir-celda dir-celda--fecha">
							<span>{fecha(s.fecha_deteccion)}</span>
							<small>{TIPO_DETECCION_LABELS[s.tipo_deteccion] ?? s.tipo_deteccion}</small>
						</div>
					{:else if columnaId === 'conductor'}
						{#if s.conductor_nombre || s.vehiculo_placa}
							<div class="dir-celda">
								<span>{s.conductor_nombre || 'Sin conductor'}</span>
								<small>
									{[s.conductor_cedula ? `CC ${s.conductor_cedula}` : '', s.vehiculo_placa]
										.filter(Boolean)
										.join(' · ') || '—'}
								</small>
							</div>
						{:else}
							<span class="dir-nulo">Sin conductor ni vehículo</span>
						{/if}
					{:else if columnaId === 'clasificacion_nc'}
						<EstadoPunto
							etiqueta={CLASIFICACION_LABELS[s.clasificacion_nc]?.label ?? s.clasificacion_nc}
							color={COLOR_CLASIF[s.clasificacion_nc] ?? '#66756f'}
						/>
					{:else if columnaId === 'estado'}
						<EstadoPunto
							etiqueta={ESTADO_SNC_LABELS[s.estado]?.label ?? s.estado}
							color={COLOR_ESTADO[s.estado] ?? '#66756f'}
						/>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{ id: 'editar', etiqueta: 'Abrir y editar', icono: Pencil, onClick: () => abrirEdicion(s) },
								{ id: 'pdf', etiqueta: 'Descargar PDF', icono: FileDown, onClick: () => descargarPDF(s) },
								{ id: 'eliminar', etiqueta: 'Eliminar', icono: Trash2, onClick: () => eliminar(s), peligrosa: true }
							]}
						/>
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota(hayFiltros ? 'vacio' : 'exito')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>{hayFiltros ? 'Sin resultados' : 'No hay salidas no conformes'}</h3>
						<p>
							{hayFiltros
								? 'Ninguna salida coincide con la búsqueda o los filtros elegidos.'
								: 'Cuando se detecte una, regístrala aquí con su tratamiento y su verificación.'}
						</p>
						{#if hayFiltros}
							<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar filtros</button>
						{:else}
							<button type="button" class="btn-primary" onclick={abrirNueva}>
								<Plus size={16} strokeWidth={2.4} />
								Registrar SNC
							</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<PaginadorLista
			pagina={filtros.pagina}
			{total}
			porPagina={POR_PAGINA}
			{cargando}
			nombreItems="salidas"
			onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
		/>
	</div>
</div>

<ModalSalidaNC
	open={modalAbierto}
	salida={enEdicion}
	oncerrar={() => (modalAbierto = false)}
	onguardado={recargar}
/>

<style>
	/* Tope de ancho: un tipo de salida largo ensanchaba la columna y empujaba
	   las acciones fuera de la tabla. */
	.snc-salida {
		max-width: 30rem;
		min-width: 14rem;
	}
	.snc-filtros--on {
		border-color: var(--au-primary) !important;
		background: var(--au-tint) !important;
		color: var(--au-dark) !important;
	}
	.snc-filtros-n {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--au-primary);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
	}
	.snc-fecha {
		width: 100%;
		min-height: 42px;
		padding: 0 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font-family: inherit;
		color: var(--text-primary);
	}
</style>
