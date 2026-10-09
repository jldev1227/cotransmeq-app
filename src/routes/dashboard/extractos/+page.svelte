<script lang="ts">
	/**
	 * Extractos de contrato (FUEC, OP-FR-04).
	 *
	 * Dos vistas: los EXTRACTOS (emitidos por el sistema y los importados del
	 * libro de Excel) y los CONTRATANTES (catálogo con contrato, NIT y
	 * responsable). Emitir abre el formulario, firma en el servidor y descarga
	 * el PDF con su QR de validación. Un extracto no se edita: se reemplaza o
	 * se anula desde el detalle.
	 *
	 * Misma cáscara que los directorios (`dir-*` de app.css y `listing/`).
	 */
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Download, Eye, Pencil, Plus, Trash2 } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import ModalExtracto from '$lib/components/extractos/ModalExtracto.svelte';
	import ModalDetalleExtracto from '$lib/components/extractos/ModalDetalleExtracto.svelte';
	import ModalContratante from '$lib/components/extractos/ModalContratante.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { authStore } from '$lib/stores/auth';
	import { mascota } from '$lib/mascot';
	import { descargarExtracto } from '$lib/utils/pdfExtracto';
	import {
		ESTADO_COLORES,
		ESTADO_LABELS,
		conPuntos,
		extractosAPI,
		fechaLarga,
		type Contratante,
		type Extracto,
		type FiltroEstadoExtracto,
		type ListadoExtractos,
		type OpcionesExtracto,
		type SnapshotExtracto
	} from '$lib/api/extractos';

	const LOGO = '/assets/logo_nombre.webp';
	const FIRMA = '/assets/fuec/firma.png';
	const POR_PAGINA = 20;

	const puedeEscribir = $derived(
		!!$authStore.user && authStore.getAccessLevel('extractos') === 'full'
	);

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		vista: string;
		q: string;
		estado: string;
		anio: number;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		vista: opcion('extractos'),
		q: texto(),
		estado: opcion('todos'),
		anio: numero(0),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
	function limpiarFiltros() {
		filtros = { ...limpiarFiltrosDe(DEFS, filtros), vista: filtros.vista };
	}
	const hayFiltros = $derived(!!filtros.q || filtros.estado !== 'todos' || filtros.anio !== 0);

	const SEGMENTOS = [
		{ valor: 'todos', etiqueta: 'Todos' },
		{ valor: 'vigentes', etiqueta: 'Vigentes', punto: ESTADO_COLORES.VIGENTE },
		{ valor: 'por_vencer', etiqueta: 'Por vencer', punto: ESTADO_COLORES.POR_VENCER },
		{ valor: 'vencidos', etiqueta: 'Vencidos', punto: ESTADO_COLORES.VENCIDO },
		{ valor: 'anulados', etiqueta: 'Anulados', punto: ESTADO_COLORES.ANULADO }
	];

	// ── Extractos ────────────────────────────────────────────────────────
	let listado = $state<ListadoExtractos | null>(null);
	let cargando = $state(true);
	let anios = $state<number[]>([]);
	let opciones = $state<OpcionesExtracto | null>(null);

	$effect(() => {
		if (filtros.vista !== 'extractos') return;
		void filtros.q;
		void filtros.estado;
		void filtros.anio;
		void filtros.pagina;
		void cargar();
	});
	$effect(() => {
		void extractosAPI
			.anios()
			.then((a) => (anios = a))
			.catch(() => {});
	});

	async function cargar() {
		cargando = true;
		try {
			listado = await extractosAPI.listar({
				q: filtros.q || undefined,
				estado: filtros.estado as FiltroEstadoExtracto,
				anio: filtros.anio || undefined,
				page: filtros.pagina,
				limit: POR_PAGINA
			});
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los extractos');
		} finally {
			cargando = false;
		}
	}

	async function cargarOpciones(): Promise<OpcionesExtracto | null> {
		try {
			opciones = await extractosAPI.opciones();
			return opciones;
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'No se pudieron cargar los datos del formulario'
			);
			return null;
		}
	}

	const resumen = $derived([
		{ clave: 'todos', etiqueta: 'Extractos', valor: listado?.conteos.todos ?? 0 },
		{
			clave: 'vigentes',
			etiqueta: 'Vigentes',
			valor: listado?.conteos.vigentes ?? 0,
			color: ESTADO_COLORES.VIGENTE
		},
		{
			clave: 'por_vencer',
			etiqueta: 'Por vencer',
			valor: listado?.conteos.por_vencer ?? 0,
			color: ESTADO_COLORES.POR_VENCER
		},
		{
			clave: 'vencidos',
			etiqueta: 'Vencidos',
			valor: listado?.conteos.vencidos ?? 0,
			color: ESTADO_COLORES.VENCIDO
		},
		{
			clave: 'anulados',
			etiqueta: 'Anulados',
			valor: listado?.conteos.anulados ?? 0,
			color: ESTADO_COLORES.ANULADO
		}
	]);
	function elegirConteo(clave: string) {
		ponerFiltro('estado', filtros.estado === clave ? 'todos' : clave);
	}

	const COLUMNAS: ColumnDef<Extracto, any>[] = [
		{ id: 'numero', header: 'No. · FUEC', enableSorting: false, size: 190 },
		{ id: 'contratante', header: 'Contratante · Origen-destino', enableSorting: false },
		{ id: 'vehiculo', header: 'Vehículo', enableSorting: false, size: 150 },
		{ id: 'conductores', header: 'Conductores', enableSorting: false, size: 220 },
		{ id: 'vigencia', header: 'Vigencia', enableSorting: false, size: 170 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 120 },
		{ id: 'acciones', header: '', enableSorting: false, size: 90 }
	];

	// ── Modales ──────────────────────────────────────────────────────────
	let modalNuevo = $state(false);
	let base = $state<Extracto | null>(null);
	let detalle = $state<Extracto | null>(null);
	let modalDetalle = $state(false);

	async function abrirNuevo(desde: Extracto | null = null) {
		const o = opciones ?? (await cargarOpciones());
		if (!o) return;
		/// El consecutivo pudo avanzar desde la última carga.
		void cargarOpciones();
		base = desde;
		modalDetalle = false;
		modalNuevo = true;
	}

	async function abrirDetalle(e: Extracto) {
		detalle = e;
		modalDetalle = true;
		try {
			detalle = await extractosAPI.detalle(e.id);
		} catch {
			/* se queda con lo de la lista */
		}
	}

	function snapshotDe(e: Extracto): SnapshotExtracto {
		const s = e.snapshot as SnapshotExtracto;
		if (s && s.numero) return s;
		/// Importados antiguos sin snapshot: se arma con lo guardado.
		return {
			numero: e.numero_completo,
			consecutivo: e.consecutivo,
			empresa: opciones?.empresa
				? { razon_social: opciones.empresa.razon_social, nit: opciones.empresa.nit }
				: { razon_social: '', nit: '' },
			contrato_numero: e.contrato_numero ?? '',
			contratante: { nombre: e.contratante_nombre ?? '', nit: e.contratante_nit },
			objeto_contrato: e.objeto_contrato ?? '',
			origen_destino: e.origen_destino ?? '',
			convenio: e.convenio ?? 'N/A',
			vigencia_desde: e.vigencia_desde,
			vigencia_hasta: e.vigencia_hasta,
			vehiculo: {
				placa: e.placa ?? '',
				modelo: e.modelo,
				marca: e.marca,
				clase: e.clase,
				numero_interno: e.numero_interno,
				tarjeta_operacion: e.tarjeta_operacion
			},
			conductores: e.conductores.map((c) => ({
				nombre: c.nombre,
				cedula: c.cedula,
				licencia_vigencia: c.licencia_vigencia
			})),
			responsable: e.responsable,
			emitido_at: e.emitido_at
		};
	}

	async function descargar(e: Extracto) {
		const o = opciones ?? (await cargarOpciones());
		if (!o) return;
		try {
			const nombre = await descargarExtracto(snapshotDe(e), {
				empresa: o.empresa,
				logo: LOGO,
				firma: FIRMA,
				codigo_verificacion: e.codigo_verificacion,
				huella: e.huella,
				marca: e.firmado ? null : 'Copia del libro histórico · sin firma electrónica'
			});
			toast.success(`Descargado ${nombre}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo generar el PDF');
		}
	}

	async function emitido(e: Extracto) {
		toast.success(`Extracto ${e.consecutivo} emitido y firmado`);
		await cargar();
		await descargar(e);
		detalle = e;
		modalDetalle = true;
	}

	function anulado(e: Extracto) {
		detalle = e;
		void cargar();
	}

	// ── Contratantes ─────────────────────────────────────────────────────
	let contratantes = $state<Contratante[]>([]);
	let cargandoContratantes = $state(false);
	let modalContratante = $state(false);
	let contratanteEditado = $state<Contratante | null>(null);

	$effect(() => {
		if (filtros.vista !== 'contratantes') return;
		void filtros.q;
		void cargarContratantes();
	});

	async function cargarContratantes() {
		cargandoContratantes = true;
		try {
			contratantes = await extractosAPI.contratantes(filtros.q || undefined);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'No se pudieron cargar los contratantes'
			);
		} finally {
			cargandoContratantes = false;
		}
	}

	async function eliminarContratante(c: Contratante) {
		const ok = await confirmarEliminacion({
			title: `Eliminar a ${c.nombre}`,
			message: 'Desaparece del catálogo para nuevos extractos. Los ya emitidos no cambian.'
		});
		if (!ok) return;
		try {
			await extractosAPI.eliminarContratante(c.id);
			toast.success('Contratante eliminado');
			await cargarContratantes();
			opciones = null;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
		}
	}

	const COLUMNAS_CONTRATANTE: ColumnDef<Contratante, any>[] = [
		{ id: 'nombre', header: 'Contratante', enableSorting: false },
		{ id: 'contrato', header: 'Contrato · NIT', enableSorting: false, size: 170 },
		{ id: 'responsable', header: 'Responsable', enableSorting: false },
		{ id: 'usos', header: 'Extractos', enableSorting: false, size: 110 },
		{ id: 'acciones', header: '', enableSorting: false, size: 90 }
	];
</script>

<svelte:head>
	<title>Extractos de contrato · Cotransmeq</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Extractos de contrato</h1>
			<p class="dir-desc">
				Formato único de extracto del contrato (FUEC, OP-FR-04). Cada extracto sale firmado y con un
				QR que lleva a su página de validación; para corregir uno se emite el reemplazo y el
				anterior queda anulado.
			</p>
			{#if filtros.vista === 'extractos'}
				<div class="dir-conteos">
					<ResumenConteos
						conteos={resumen}
						activo={filtros.estado !== 'todos' ? filtros.estado : null}
						onElegir={elegirConteo}
					/>
				</div>
			{/if}
		</div>
		{#if puedeEscribir}
			<div class="dir-cabecera-acciones">
				{#if filtros.vista === 'contratantes'}
					<button
						type="button"
						class="btn-primary"
						onclick={() => {
							contratanteEditado = null;
							modalContratante = true;
						}}
					>
						<Plus size={16} strokeWidth={2.4} />
						Nuevo contratante
					</button>
				{:else}
					<button type="button" class="btn-primary" onclick={() => abrirNuevo()}>
						<Plus size={16} strokeWidth={2.4} />
						Emitir extracto
					</button>
				{/if}
			</div>
		{/if}
	</header>

	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{ id: 'extractos', label: 'Extractos', cuenta: listado?.conteos.todos ?? null },
				{ id: 'contratantes', label: 'Contratantes', cuenta: contratantes.length || null }
			]}
			activa={filtros.vista}
			etiqueta="Vistas de extractos"
			onCambiar={(v) => (filtros = { ...filtros, vista: v, q: '', pagina: 1 })}
		/>
	</div>

	{#if filtros.vista === 'extractos'}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Número, consecutivo, placa, contratante, conductor…"
					etiqueta="Buscar extractos"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS}
				valor={filtros.estado}
				onCambiar={(v) => ponerFiltro('estado', v)}
			/>
			<label class="ex-anio">
				<span>Año</span>
				<select
					value={String(filtros.anio)}
					onchange={(e) =>
						ponerFiltro('anio', Number((e.currentTarget as HTMLSelectElement).value))}
				>
					<option value="0">Todos</option>
					{#each anios as a (a)}<option value={String(a)}>{a}</option>{/each}
				</select>
			</label>
			{#if hayFiltros}
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar</button>
			{/if}
		</div>
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={listado?.data ?? []}
					claveFila={(e) => e.id}
					{cargando}
					onFila={(e) => abrirDetalle(e)}
					etiqueta="Extractos de contrato"
				>
					{#snippet celda({ columnaId, fila: e })}
						{#if columnaId === 'numero'}
							<div class="dir-celda">
								<span class="ex-consecutivo">{e.consecutivo}</span>
								<small class="ex-numero">{e.numero_completo}</small>
							</div>
						{:else if columnaId === 'contratante'}
							<div class="dir-celda">
								<span>{e.contratante_nombre ?? '—'}</span>
								<small>{e.origen_destino ?? '—'}</small>
							</div>
						{:else if columnaId === 'vehiculo'}
							<div class="dir-celda">
								<span class="ex-placa">{e.placa ?? '—'}</span>
								<small
									>{[e.numero_interno ? `Int. ${e.numero_interno}` : null, e.clase]
										.filter(Boolean)
										.join(' · ') || '—'}</small
								>
							</div>
						{:else if columnaId === 'conductores'}
							<div class="dir-celda">
								{#each e.conductores as c (c.id)}
									<small class="ex-conductor">{c.nombre}</small>
								{:else}
									<span class="dir-nulo">—</span>
								{/each}
							</div>
						{:else if columnaId === 'vigencia'}
							<div class="dir-celda dir-celda--fecha">
								<span>{fechaLarga(e.vigencia_desde)}</span>
								<small>hasta {fechaLarga(e.vigencia_hasta)}</small>
							</div>
						{:else if columnaId === 'estado'}
							<EstadoPunto
								etiqueta={ESTADO_LABELS[e.estado]}
								color={ESTADO_COLORES[e.estado]}
								apagado={e.estado === 'ANULADO'}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'pdf',
										etiqueta: 'Descargar PDF',
										icono: Download,
										onClick: () => descargar(e)
									},
									{ id: 'ver', etiqueta: 'Ver', icono: Eye, onClick: () => abrirDetalle(e) }
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota(hayFiltros ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltros ? 'Sin resultados' : 'Todavía no hay extractos'}</h3>
							<p>
								Los extractos emitidos aparecen aquí con su estado, su vigencia y su QR de
								validación.
							</p>
							{#if puedeEscribir && !hayFiltros}
								<button type="button" class="btn-primary" onclick={() => abrirNuevo()}
									><Plus size={16} /> Emitir el primero</button
								>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			{#if listado && listado.total > POR_PAGINA}
				<PaginadorLista
					pagina={filtros.pagina}
					total={listado.total}
					porPagina={POR_PAGINA}
					onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
					{cargando}
					nombreItems="extractos"
				/>
			{/if}
		</div>
	{:else}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Nombre, NIT o contrato…"
					etiqueta="Buscar contratantes"
				/>
			</div>
		</div>
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_CONTRATANTE}
					datos={contratantes}
					claveFila={(c) => c.id}
					cargando={cargandoContratantes}
					onFila={puedeEscribir
						? (c) => {
								contratanteEditado = c;
								modalContratante = true;
							}
						: undefined}
					etiqueta="Contratantes"
				>
					{#snippet celda({ columnaId, fila: c })}
						{#if columnaId === 'nombre'}
							<div class="dir-celda"><span>{c.nombre}</span></div>
						{:else if columnaId === 'contrato'}
							<div class="dir-celda">
								<span>{c.numero_contrato ? `Contrato ${c.numero_contrato}` : '—'}</span>
								<small>{c.nit ? `NIT ${conPuntos(c.nit)}` : 'Sin NIT'}</small>
							</div>
						{:else if columnaId === 'responsable'}
							<div class="dir-celda">
								<span>{c.responsable.nombre ?? '—'}</span>
								<small
									>{[
										c.responsable.cedula ? conPuntos(c.responsable.cedula) : null,
										c.responsable.telefono,
										c.responsable.direccion
									]
										.filter(Boolean)
										.join(' · ')}</small
								>
							</div>
						{:else if columnaId === 'usos'}
							<div class="dir-celda dir-celda--fecha">
								<span>{c.usos}</span>
								<small>{c.ultimo_uso_at ? `último ${fechaLarga(c.ultimo_uso_at)}` : '—'}</small>
							</div>
						{:else if columnaId === 'acciones' && puedeEscribir}
							<AccionesFila
								acciones={[
									{
										id: 'editar',
										etiqueta: 'Editar',
										icono: Pencil,
										onClick: () => {
											contratanteEditado = c;
											modalContratante = true;
										}
									},
									{
										id: 'eliminar',
										etiqueta: 'Eliminar',
										icono: Trash2,
										onClick: () => eliminarContratante(c),
										peligrosa: true
									}
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota(filtros.q ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{filtros.q ? 'Sin resultados' : 'No hay contratantes'}</h3>
							<p>Se crean solos al emitir un extracto, o desde «Nuevo contratante».</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
		</div>
	{/if}
</div>

{#if opciones}
	<ModalExtracto
		open={modalNuevo}
		{opciones}
		{base}
		oncerrar={() => (modalNuevo = false)}
		onemitido={emitido}
	/>
{/if}
<ModalDetalleExtracto
	open={modalDetalle}
	extracto={detalle}
	{puedeEscribir}
	oncerrar={() => (modalDetalle = false)}
	ondescargar={descargar}
	onreemplazar={(e) => abrirNuevo(e)}
	onanulado={anulado}
/>
<ModalContratante
	open={modalContratante}
	contratante={contratanteEditado}
	oncerrar={() => (modalContratante = false)}
	onguardado={() => {
		void cargarContratantes();
		opciones = null;
	}}
/>

<style>
	.ex-anio {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ex-anio select {
		padding: 0.4rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.82rem;
	}
	.ex-consecutivo {
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.ex-numero {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.02em;
	}
	.ex-placa {
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	.ex-conductor {
		display: block;
	}
</style>
