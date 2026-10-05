<script lang="ts">
	/**
	 * Directorio de formularios de asistencia.
	 *
	 * Misma cáscara que flota, conductores y clientes (`dir-*` de app.css y los
	 * componentes de `listing/`): cabecera con conteos, buscador y segmentos a
	 * la vista, tabla compartida con selección y acciones por fila, y la barra
	 * flotante para lo masivo. Antes tenía su propia tabla (`DataTable` con
	 * HTML en cadenas), sus tarjetas para móvil y su barra de selección; ahora
	 * todo eso lo pone el listado común y aquí solo queda lo de asistencias.
	 *
	 * Filtros, orden y página viven en la URL: un enlace compartido abre la
	 * misma vista.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import {
		CheckCheck,
		Download,
		Eye,
		Link2,
		Pencil,
		Plus,
		Power,
		PowerOff,
		Trash2
	} from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import BarraSeleccion from '$lib/components/listing/BarraSeleccion.svelte';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { numero, opcion, texto, valoresPorDefecto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { mascota } from '$lib/mascot';
	import { socketUtils } from '$lib/socket';
	import { asistenciasAPI, type FormularioAsistencia } from '$lib/api/asistencias';
	import { duracionLegible, etiquetaTipoEvento, fechaEvento } from '$lib/asistencias/eventos';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 10;
	const VERDE = '#079665';
	const GRIS = '#66756f';

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		q: string;
		estado: string;
		orden: string;
		dir: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		estado: opcion('all'),
		orden: opcion('fecha'),
		dir: opcion('desc'),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	const DEFS_VACIOS = valoresPorDefecto(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	const hayFiltros = $derived(!!filtros.q || filtros.estado !== 'all');

	const SEGMENTOS = [
		{ valor: 'all', etiqueta: 'Todos' },
		{ valor: 'activo', etiqueta: 'Activos', punto: VERDE },
		{ valor: 'inactivo', etiqueta: 'Inactivos', punto: GRIS }
	];

	// ── Datos ────────────────────────────────────────────────────────────
	let formularios = $state<FormularioAsistencia[]>([]);
	let totalRows = $state(0);
	let cargando = $state(true);
	let conteos = $state({ total: 0, activos: 0, inactivos: 0 });

	/// El orden de la tabla es el de la URL; la tabla no ordena por su cuenta.
	const ordenTabla = $derived<SortingState>([{ id: filtros.orden, desc: filtros.dir === 'desc' }]);

	async function cargar() {
		cargando = true;
		try {
			const res = await asistenciasAPI.obtenerFormularios({
				page: filtros.pagina,
				limit: POR_PAGINA,
				search: filtros.q || undefined,
				filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
				sortBy: filtros.orden as 'fecha' | 'tematica' | 'respuestas',
				sortOrder: filtros.dir as 'asc' | 'desc'
			});
			formularios = res?.data ?? [];
			totalRows = res?.meta?.total ?? formularios.length;
		} catch (error) {
			toast.error('No se pudieron cargar los formularios');
			console.error(error);
		} finally {
			cargando = false;
		}
	}

	/// La API no trae totales por estado: se piden dos páginas de un registro
	/// solo por su `meta.total`. Son dos consultas livianas y evitan contar
	/// sobre la página visible, que daba cifras falsas.
	async function cargarConteos() {
		try {
			const [a, i] = await Promise.all([
				asistenciasAPI.obtenerFormularios({ page: 1, limit: 1, filterActivo: 'activo' }),
				asistenciasAPI.obtenerFormularios({ page: 1, limit: 1, filterActivo: 'inactivo' })
			]);
			const activos = a?.meta?.total ?? 0;
			const inactivos = i?.meta?.total ?? 0;
			conteos = { total: activos + inactivos, activos, inactivos };
		} catch {
			/* los conteos son decorativos: sin ellos la lista sigue sirviendo */
		}
	}

	function recargar() {
		void cargar();
		void cargarConteos();
	}

	$effect(() => {
		void filtros;
		untrack(() => void cargar());
	});
	onMount(() => void cargarConteos());

	const resumen = $derived([
		{ clave: 'all', etiqueta: 'Total', valor: conteos.total },
		{ clave: 'activo', etiqueta: 'Activos', valor: conteos.activos, color: VERDE },
		{ clave: 'inactivo', etiqueta: 'Inactivos', valor: conteos.inactivos, color: GRIS }
	]);

	// ── Selección ────────────────────────────────────────────────────────
	let seleccion = $state<Set<string>>(new Set());
	let seleccionandoTodo = $state(false);

	/// Cambiar un filtro limpia la selección: lo marcado ya no está a la vista
	/// y una descarga masiva sobre ello sorprendería.
	function ponerFiltros(cambios: Partial<Filtros>) {
		filtros = { ...filtros, ...cambios, pagina: cambios.pagina ?? 1 };
		seleccion = new Set();
	}

	async function seleccionarTodosLosFiltrados() {
		if (seleccionandoTodo) return;
		seleccionandoTodo = true;
		try {
			const ids = await asistenciasAPI.obtenerTodosLosIds({
				filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
				search: filtros.q || undefined
			});
			seleccion = new Set(ids);
		} catch {
			toast.error('No se pudo seleccionar todo');
		} finally {
			seleccionandoTodo = false;
		}
	}

	// ── Descargas (ZIP de PDF) con progreso por socket ───────────────────
	let descargando = $state(false);
	let progresoJobId = $state<string | null>(null);
	let progresoToastId: string | number | undefined;

	function bajar(blob: Blob, nombre: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = nombre;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function descargarZip(ids: string[] | null) {
		if (descargando) return;
		descargando = true;
		progresoJobId = `${ids ? 'sel' : 'all'}-${Date.now()}`;
		progresoToastId = toast.loading(
			ids ? `Generando ZIP con ${ids.length} formularios…` : 'Generando ZIP con todas las asistencias filtradas…',
			{ description: 'Puede tardar unos minutos.' }
		);
		try {
			const blob = ids
				? await asistenciasAPI.exportarSeleccionadosPDFs(ids, progresoJobId)
				: await asistenciasAPI.exportarTodasPDFs({
						filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
						search: filtros.q || undefined,
						jobId: progresoJobId
					});
			toast.success('Descarga lista', { id: progresoToastId });
			bajar(blob, `asistencias${ids ? '_seleccionadas' : ''}_${new Date().toISOString().slice(0, 10)}.zip`);
			if (ids) seleccion = new Set();
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo generar el ZIP', { id: progresoToastId });
		} finally {
			progresoJobId = null;
			descargando = false;
		}
	}

	const onExportProgress = (p: any) => {
		if (!p || !progresoJobId || p.jobId !== progresoJobId) return;
		const tema = p.currentTematica ? ` · ${String(p.currentTematica).slice(0, 30)}` : '';
		toast.loading(`Generando PDF ${p.current}/${p.total} (${p.percent}%)${tema}`, {
			id: progresoToastId,
			description: 'Puede tardar unos minutos.'
		});
	};

	// ── Sockets ──────────────────────────────────────────────────────────
	const onFormularioCreado = ({ formulario }: any) => {
		toast.success(`Nuevo formulario: ${formulario?.tematica ?? ''}`);
		recargar();
	};
	const onCambio = () => recargar();
	const onRespuesta = () => {
		recargar();
		toast.success('Nueva respuesta recibida');
	};
	onMount(() => {
		socketUtils.on('asistencias:formulario:created', onFormularioCreado);
		socketUtils.on('asistencias:formulario:updated', onCambio);
		socketUtils.on('asistencias:formulario:disabled', onCambio);
		socketUtils.on('asistencias:respuesta:created', onRespuesta);
		socketUtils.on('asistencias:export:progress', onExportProgress);
	});
	onDestroy(() => {
		socketUtils.off('asistencias:formulario:created', onFormularioCreado);
		socketUtils.off('asistencias:formulario:updated', onCambio);
		socketUtils.off('asistencias:formulario:disabled', onCambio);
		socketUtils.off('asistencias:respuesta:created', onRespuesta);
		socketUtils.off('asistencias:export:progress', onExportProgress);
	});

	// ── Acciones por fila ────────────────────────────────────────────────
	let modalAbierto = $state(false);
	let formularioEnEdicion = $state<FormularioAsistencia | null>(null);

	function abrirNuevo() {
		formularioEnEdicion = null;
		modalAbierto = true;
	}
	function abrirEdicion(f: FormularioAsistencia) {
		formularioEnEdicion = f;
		modalAbierto = true;
	}
	function verRespuestas(f: FormularioAsistencia) {
		goto(`/dashboard/asistencias/${f.id}/respuestas`);
	}
	async function copiarEnlace(f: FormularioAsistencia) {
		try {
			await navigator.clipboard.writeText(asistenciasAPI.generarUrlPublica(f.token));
			toast.success('Enlace para firmar copiado');
		} catch {
			toast.error('No se pudo copiar el enlace');
		}
	}
	async function alternarActivo(f: FormularioAsistencia) {
		try {
			await asistenciasAPI.actualizarFormulario(f.id, { activo: !f.activo });
			toast.success(f.activo ? 'Formulario desactivado: ya no recibe firmas' : 'Formulario activado');
			recargar();
		} catch {
			toast.error('No se pudo cambiar el estado');
		}
	}
	async function eliminar(f: FormularioAsistencia) {
		const n = f._count?.respuestas ?? 0;
		const ok = await confirmarEliminacion({
			title: '¿Eliminar este formulario?',
			message: `Se eliminará «${f.tematica}»${n ? ` con sus ${n} ${n === 1 ? 'respuesta' : 'respuestas'}` : ''}. Esta acción no se puede deshacer.`
		});
		if (!ok) return;
		try {
			await asistenciasAPI.eliminarFormulario(f.id);
			toast.success('Formulario eliminado');
			seleccion.delete(f.id);
			seleccion = new Set(seleccion);
			recargar();
		} catch {
			toast.error('No se pudo eliminar el formulario');
		}
	}

	// ── Tabla ────────────────────────────────────────────────────────────
	const COLUMNAS: ColumnDef<FormularioAsistencia, any>[] = [
		{ id: 'tematica', header: 'Evento', accessorKey: 'tematica' },
		{ id: 'fecha', header: 'Fecha', accessorKey: 'fecha', size: 180 },
		{ id: 'lugar', header: 'Lugar · Instructor', enableSorting: false, size: 220 },
		{ id: 'respuestas', header: 'Firmas', size: 90 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 110 },
		{ id: 'acciones', header: '', enableSorting: false, size: 150 }
	];

	function ordenar(o: SortingState) {
		const [primero] = o;
		ponerFiltros({
			orden: primero?.id ?? 'fecha',
			dir: primero ? (primero.desc ? 'desc' : 'asc') : 'desc'
		});
	}

	function horario(f: FormularioAsistencia): string {
		if (!f.hora_inicio && !f.hora_finalizacion) return '';
		const rango = `${f.hora_inicio || '--:--'} – ${f.hora_finalizacion || '--:--'}`;
		const dur = duracionLegible(f.duracion_minutos);
		return dur ? `${rango} · ${dur}` : rango;
	}
</script>

<svelte:head>
	<title>Asistencias — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Asistencias</h1>
			<p class="dir-desc">
				Formularios de asistencia a capacitaciones, charlas, inducciones y reuniones, con la firma
				de cada asistente.
			</p>
			<div class="dir-conteos">
				<ResumenConteos
					conteos={resumen}
					activo={filtros.estado === 'all' ? null : filtros.estado}
					onElegir={(clave) => ponerFiltros({ estado: filtros.estado === clave ? 'all' : clave })}
				/>
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			<button
				type="button"
				class="btn-secondary"
				onclick={() => descargarZip(null)}
				disabled={descargando || totalRows === 0}
				title="ZIP con el PDF de cada formulario de la lista filtrada"
			>
				<Download size={16} strokeWidth={2} />
				{descargando && progresoJobId?.startsWith('all-') ? 'Generando…' : 'Descargar todas'}
			</button>
			<button type="button" class="btn-primary" onclick={abrirNuevo}>
				<Plus size={16} strokeWidth={2.4} />
				Nuevo formulario
			</button>
		</div>
	</header>

	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={filtros.q}
				onBuscar={(termino) => ponerFiltros({ q: termino })}
				placeholder="Temática, lugar o instructor…"
				etiqueta="Buscar formularios de asistencia"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Estado"
			opciones={SEGMENTOS}
			valor={filtros.estado}
			onCambiar={(v) => ponerFiltros({ estado: v })}
		/>
	</div>

	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={formularios}
				claveFila={(f) => f.id}
				{cargando}
				orden={ordenTabla}
				onOrdenar={ordenar}
				onFila={verRespuestas}
				etiqueta="Formularios de asistencia"
				{seleccion}
				onSeleccion={(ids) => (seleccion = ids)}
			>
				{#snippet celda({ columnaId, fila: f })}
					{#if columnaId === 'tematica'}
						<!-- Con tope de ancho: una temática larga ensanchaba la columna y
						     empujaba las acciones fuera de la tarjeta. -->
						<div class="as-evento">
							<CeldaIdentidad
								titulo={f.tematica}
								subtitulo={etiquetaTipoEvento(f.tipo_evento, f.tipo_evento_otro)}
							/>
						</div>
					{:else if columnaId === 'fecha'}
						<div class="dir-celda dir-celda--fecha">
							<span>{fechaEvento(f.fecha)}</span>
							{#if horario(f)}<small>{horario(f)}</small>{/if}
						</div>
					{:else if columnaId === 'lugar'}
						{#if f.lugar_sede || f.nombre_instructor}
							<div class="dir-celda">
								<span>{f.lugar_sede || '—'}</span>
								{#if f.nombre_instructor}<small>{f.nombre_instructor}</small>{/if}
							</div>
						{:else}
							<span class="dir-nulo">Sin lugar</span>
						{/if}
					{:else if columnaId === 'respuestas'}
						{@const n = f._count?.respuestas ?? 0}
						<span class="as-firmas" class:as-firmas--vacio={n === 0}>{n}</span>
					{:else if columnaId === 'estado'}
						<EstadoPunto
							etiqueta={f.activo ? 'Activo' : 'Inactivo'}
							color={f.activo ? VERDE : GRIS}
							apagado={!f.activo}
						/>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							visibles={2}
							acciones={[
								{ id: 'ver', etiqueta: 'Ver firmas', icono: Eye, onClick: () => verRespuestas(f) },
								{ id: 'enlace', etiqueta: 'Copiar enlace para firmar', icono: Link2, onClick: () => copiarEnlace(f) },
								{ id: 'editar', etiqueta: 'Editar', icono: Pencil, onClick: () => abrirEdicion(f) },
								{
									id: 'activo',
									etiqueta: f.activo ? 'Desactivar' : 'Activar',
									icono: f.activo ? PowerOff : Power,
									onClick: () => alternarActivo(f)
								},
								{ id: 'eliminar', etiqueta: 'Eliminar', icono: Trash2, onClick: () => eliminar(f), peligrosa: true }
							]}
						/>
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>{hayFiltros ? 'Sin resultados' : 'Todavía no hay formularios'}</h3>
						<p>
							{hayFiltros
								? 'No hay formularios que coincidan con la búsqueda o el estado elegido.'
								: 'Crea el primero y comparte su enlace para que los asistentes firmen desde el celular.'}
						</p>
						{#if hayFiltros}
							<button type="button" class="btn-secondary" onclick={() => ponerFiltros({ ...DEFS_VACIOS })}>
								Limpiar filtros
							</button>
						{:else}
							<button type="button" class="btn-primary" onclick={abrirNuevo}>
								<Plus size={16} strokeWidth={2.4} />
								Crear formulario
							</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<PaginadorLista
			pagina={filtros.pagina}
			total={totalRows}
			porPagina={POR_PAGINA}
			{cargando}
			nombreItems="formularios"
			onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
		/>
	</div>

	<BarraSeleccion
		cantidad={seleccion.size}
		nombreItems="formularios"
		procesando={descargando || seleccionandoTodo}
		onLimpiar={() => (seleccion = new Set())}
		acciones={[
			...(seleccion.size < totalRows
				? [
						{
							id: 'todos',
							etiqueta: `Seleccionar los ${totalRows} filtrados`,
							icono: CheckCheck,
							tono: 'neutro' as const,
							onClick: seleccionarTodosLosFiltrados
						}
					]
				: []),
			{
				id: 'zip',
				etiqueta: 'Descargar ZIP',
				icono: Download,
				tono: 'primario' as const,
				onClick: () => descargarZip([...seleccion])
			}
		]}
	/>
</div>

<ModalFormularioAsistencia
	open={modalAbierto}
	formulario={formularioEnEdicion}
	oncerrar={() => (modalAbierto = false)}
	onguardado={recargar}
/>

<style>
	.as-evento {
		max-width: 34rem;
		min-width: 14rem;
	}

	/* Conteo de firmas: la cifra en una pastilla, en gris cuando no hay ninguna. */
	.as-firmas {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.25rem;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-size: 0.82rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.as-firmas--vacio {
		background: var(--bg-base);
		color: var(--text-very-muted);
	}
</style>
