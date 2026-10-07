<script lang="ts">
	/**
	 * Viáticos: anticipos entregados a conductores y su legalización.
	 *
	 * Dos vistas: los ANTICIPOS (con su saldo calculado por el servidor) y las
	 * SOLICITUDES de más dinero que los conductores hacen desde la app. Aprobar
	 * una solicitud abre el formulario del anticipo con el valor pedido y con
	 * conductor y placa fijos.
	 *
	 * Misma cáscara que los directorios (`dir-*` de app.css y `listing/`). Los
	 * enlaces de las notificaciones llegan con `?anticipo=<id>` o
	 * `?solicitud=<id>`.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Check, Eye, Pencil, Plus, Trash2, X } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import ModalAnticipo from '$lib/components/viaticos/ModalAnticipo.svelte';
	import ModalDetalleAnticipo from '$lib/components/viaticos/ModalDetalleAnticipo.svelte';
	import ModalMotivo from '$lib/components/viaticos/ModalMotivo.svelte';
	import BarraSaldo from '$lib/components/viaticos/BarraSaldo.svelte';
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
	import {
		METODO_LABELS,
		colorSaldo,
		etiquetaSaldo,
		fechaCorta,
		moneda,
		viaticosAPI,
		type AnticipoDetalle,
		type AnticipoResumen,
		type FiltroEstadoAnticipo,
		type ListadoAnticipos,
		type SolicitudListada
	} from '$lib/api/viaticos';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 15;

	const puedeEscribir = $derived(
		!!$authStore.user && authStore.getAccessLevel('viaticos') === 'full'
	);

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		vista: string;
		q: string;
		estado: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		vista: opcion('anticipos'),
		q: texto(),
		estado: opcion('todos'),
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
	const hayFiltros = $derived(!!filtros.q || filtros.estado !== 'todos');

	const COLOR = { con_saldo: '#22c55e', saldo_bajo: '#f59e0b', agotados: '#ef4444' };
	const SEGMENTOS = [
		{ valor: 'todos', etiqueta: 'Todos' },
		{ valor: 'con_saldo', etiqueta: 'Con saldo', punto: COLOR.con_saldo },
		{ valor: 'saldo_bajo', etiqueta: 'Saldo bajo', punto: COLOR.saldo_bajo },
		{ valor: 'agotados', etiqueta: 'Agotados', punto: COLOR.agotados }
	];

	// ── Anticipos ────────────────────────────────────────────────────────
	let listado = $state<ListadoAnticipos | null>(null);
	let cargando = $state(true);

	$effect(() => {
		if (filtros.vista !== 'anticipos') return;
		void filtros.q;
		void filtros.estado;
		void filtros.pagina;
		void cargarAnticipos();
	});

	async function cargarAnticipos() {
		cargando = true;
		try {
			listado = await viaticosAPI.listar({
				q: filtros.q || undefined,
				estado: filtros.estado as FiltroEstadoAnticipo,
				page: filtros.pagina,
				limit: POR_PAGINA
			});
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los anticipos');
		} finally {
			cargando = false;
		}
	}

	const resumen = $derived([
		{ clave: 'todos', etiqueta: 'Anticipos', valor: listado?.conteos.todos ?? 0 },
		{
			clave: 'saldo_bajo',
			etiqueta: 'Saldo bajo',
			valor: listado?.conteos.saldo_bajo ?? 0,
			color: COLOR.saldo_bajo
		},
		{
			clave: 'agotados',
			etiqueta: 'Agotados',
			valor: listado?.conteos.agotados ?? 0,
			color: COLOR.agotados
		},
		{
			clave: 'saldo',
			etiqueta: 'Saldo en manos de conductores',
			valor: moneda(listado?.totales.saldo ?? 0)
		}
	]);
	function elegirConteo(clave: string) {
		if (clave === 'saldo') return;
		ponerFiltro('estado', filtros.estado === clave ? 'todos' : clave);
	}

	const COLUMNAS: ColumnDef<AnticipoResumen, any>[] = [
		{ id: 'conductor', header: 'Conductor · Placa', enableSorting: false },
		{ id: 'concepto', header: 'Concepto', enableSorting: false },
		{ id: 'entrega', header: 'Entrega', enableSorting: false, size: 170 },
		{ id: 'saldo', header: 'Saldo', enableSorting: false, size: 190 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 150 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];

	// ── Solicitudes ──────────────────────────────────────────────────────
	let solicitudes = $state<SolicitudListada[]>([]);
	let cargandoSolicitudes = $state(false);
	let estadoSolicitudes = $state<'PENDIENTE' | 'todas'>('PENDIENTE');

	$effect(() => {
		if (filtros.vista !== 'solicitudes') return;
		void estadoSolicitudes;
		void cargarSolicitudes();
	});

	async function cargarSolicitudes() {
		cargandoSolicitudes = true;
		try {
			solicitudes = await viaticosAPI.solicitudes(estadoSolicitudes);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las solicitudes');
		} finally {
			cargandoSolicitudes = false;
		}
	}

	const COLUMNAS_SOLICITUD: ColumnDef<SolicitudListada, any>[] = [
		{ id: 'conductor', header: 'Conductor · Placa', enableSorting: false },
		{ id: 'valor', header: 'Solicita', enableSorting: false, size: 150 },
		{ id: 'origen', header: 'Anticipo de origen', enableSorting: false },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 140 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];
	const ESTADO_SOLICITUD = {
		PENDIENTE: { etiqueta: 'Pendiente', color: '#f59e0b' },
		APROBADA: { etiqueta: 'Aprobada', color: '#22c55e' },
		RECHAZADA: { etiqueta: 'Rechazada', color: '#ef4444' }
	} as const;

	function recargar() {
		void cargarAnticipos();
		if (filtros.vista === 'solicitudes') void cargarSolicitudes();
	}

	// ── Modales ──────────────────────────────────────────────────────────
	let formAbierto = $state(false);
	let enEdicion = $state<AnticipoDetalle | null>(null);
	let aprobando = $state<SolicitudListada | null>(null);
	let detalleId = $state<string | null>(null);
	let rechazando = $state<SolicitudListada | null>(null);

	function abrirNuevo() {
		enEdicion = null;
		aprobando = null;
		formAbierto = true;
	}
	function abrirEdicion(a: AnticipoDetalle) {
		detalleId = null;
		aprobando = null;
		enEdicion = a;
		formAbierto = true;
	}
	async function abrirAprobacion(solicitudId: string) {
		try {
			const s = await viaticosAPI.solicitud(solicitudId);
			if (s.estado !== 'PENDIENTE') {
				toast.info(`Esa solicitud ya fue ${s.estado === 'APROBADA' ? 'aprobada' : 'rechazada'}.`);
				return;
			}
			detalleId = null;
			enEdicion = null;
			aprobando = s;
			formAbierto = true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo abrir la solicitud');
		}
	}
	async function eliminar(a: { id: string; concepto: string; conductor: { nombre: string } }) {
		const ok = await confirmarEliminacion({
			title: '¿Eliminar el anticipo?',
			message: `«${a.concepto}» de ${a.conductor.nombre}. Solo se puede si no tiene gastos vigentes.`
		});
		if (!ok) return;
		try {
			await viaticosAPI.eliminar(a.id);
			toast.success('Anticipo eliminado');
			detalleId = null;
			recargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
		}
	}
	async function rechazar(motivo: string) {
		if (!rechazando) return;
		try {
			await viaticosAPI.rechazar(rechazando.id, motivo);
			toast.success('Solicitud rechazada. El conductor fue notificado.');
			recargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo rechazar');
			throw error;
		}
	}

	/// Enlaces de las notificaciones: se consumen una vez y se quitan de la URL.
	$effect(() => {
		const anticipo = page.url.searchParams.get('anticipo');
		const solicitud = page.url.searchParams.get('solicitud');
		if (!anticipo && !solicitud) return;
		const url = new URL(page.url);
		url.searchParams.delete('anticipo');
		url.searchParams.delete('solicitud');
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		if (anticipo) detalleId = anticipo;
		if (solicitud) {
			filtros = { ...filtros, vista: 'solicitudes' };
			if (puedeEscribir) void abrirAprobacion(solicitud);
		}
	});
</script>

<svelte:head>
	<title>Viáticos — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Viáticos</h1>
			<p class="dir-desc">
				Anticipos entregados a los conductores, los gastos con que los legalizan desde la app y sus
				solicitudes de más dinero. Al bajar del 15 % del anticipo se avisa a operaciones y al
				conductor.
			</p>
			<div class="dir-conteos">
				<ResumenConteos
					conteos={resumen}
					activo={filtros.vista === 'anticipos' && filtros.estado !== 'todos'
						? filtros.estado
						: null}
					onElegir={elegirConteo}
				/>
			</div>
		</div>
		{#if puedeEscribir}
			<div class="dir-cabecera-acciones">
				<button type="button" class="btn-primary" onclick={abrirNuevo}>
					<Plus size={16} strokeWidth={2.4} />
					Registrar anticipo
				</button>
			</div>
		{/if}
	</header>

	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{ id: 'anticipos', label: 'Anticipos', cuenta: listado?.conteos.todos ?? null },
				{ id: 'solicitudes', label: 'Solicitudes', cuenta: listado?.solicitudes_pendientes || null }
			]}
			activa={filtros.vista}
			etiqueta="Vistas de viáticos"
			onCambiar={(v) => (filtros = { ...filtros, vista: v })}
		/>
	</div>

	{#if filtros.vista === 'anticipos'}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Conductor, documento, placa, concepto, comprobante…"
					etiqueta="Buscar anticipos"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Saldo"
				opciones={SEGMENTOS}
				valor={filtros.estado}
				onCambiar={(v) => ponerFiltro('estado', v)}
			/>
		</div>

		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={listado?.data ?? []}
					claveFila={(a) => a.id}
					{cargando}
					onFila={(a) => (detalleId = a.id)}
					etiqueta="Anticipos de viáticos"
				>
					{#snippet celda({ columnaId, fila: a })}
						{#if columnaId === 'conductor'}
							<CeldaIdentidad
								codigo={a.vehiculo.placa}
								titulo={a.conductor.nombre}
								subtitulo={a.conductor.numero_identificacion
									? `CC ${a.conductor.numero_identificacion}`
									: ''}
							/>
						{:else if columnaId === 'concepto'}
							<div class="dir-celda vt-concepto">
								<span>{a.concepto}</span>
								{#if a.solicitud_pendiente}
									<small class="vt-pide"
										>Pide {moneda(a.solicitud_pendiente.valor_solicitado)}</small
									>
								{:else if a.solicitud_id}
									<small>Por solicitud del conductor</small>
								{/if}
							</div>
						{:else if columnaId === 'entrega'}
							<div class="dir-celda dir-celda--fecha">
								<span>{fechaCorta(a.fecha)}</span>
								<small>
									{a.metodo === 'TRANSFERENCIA'
										? [a.entidad, a.numero_comprobante].filter(Boolean).join(' · ') ||
											METODO_LABELS[a.metodo]
										: a.tarjeta_cuenta}
								</small>
							</div>
						{:else if columnaId === 'saldo'}
							<BarraSaldo saldo={a} compacta />
						{:else if columnaId === 'estado'}
							<EstadoPunto etiqueta={etiquetaSaldo(a)} color={colorSaldo(a)} />
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'ver',
										etiqueta: 'Ver detalle',
										icono: Eye,
										onClick: () => (detalleId = a.id)
									},
									...(puedeEscribir && a.solicitud_pendiente
										? [
												{
													id: 'aprobar',
													etiqueta: 'Aprobar solicitud',
													icono: Check,
													onClick: () => abrirAprobacion(a.solicitud_pendiente!.id)
												}
											]
										: []),
									...(puedeEscribir
										? [
												{
													id: 'editar',
													etiqueta: 'Editar',
													icono: Pencil,
													onClick: async () => abrirEdicion(await viaticosAPI.detalle(a.id))
												},
												{
													id: 'eliminar',
													etiqueta: 'Eliminar',
													icono: Trash2,
													onClick: () => eliminar(a),
													peligrosa: true
												}
											]
										: [])
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota(hayFiltros ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltros ? 'Sin resultados' : 'No hay anticipos registrados'}</h3>
							<p>
								{hayFiltros
									? 'Ningún anticipo coincide con la búsqueda o el filtro de saldo.'
									: 'Registra el primer anticipo con su comprobante o la tarjeta de la que salió.'}
							</p>
							{#if hayFiltros}
								<button type="button" class="btn-secondary" onclick={limpiarFiltros}
									>Limpiar filtros</button
								>
							{:else if puedeEscribir}
								<button type="button" class="btn-primary" onclick={abrirNuevo}>
									<Plus size={16} strokeWidth={2.4} /> Registrar anticipo
								</button>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				total={listado?.meta.total ?? 0}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="anticipos"
				onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
			/>
		</div>
	{:else}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={[
					{ valor: 'PENDIENTE', etiqueta: 'Pendientes', punto: ESTADO_SOLICITUD.PENDIENTE.color },
					{ valor: 'todas', etiqueta: 'Todas' }
				]}
				valor={estadoSolicitudes}
				onCambiar={(v) => (estadoSolicitudes = v as 'PENDIENTE' | 'todas')}
			/>
		</div>
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_SOLICITUD}
					datos={solicitudes}
					claveFila={(s) => s.id}
					cargando={cargandoSolicitudes}
					onFila={(s) => (detalleId = s.anticipo_origen.id)}
					etiqueta="Solicitudes de viáticos"
				>
					{#snippet celda({ columnaId, fila: s })}
						{#if columnaId === 'conductor'}
							<CeldaIdentidad
								codigo={s.vehiculo.placa}
								titulo={s.conductor.nombre}
								subtitulo={fechaCorta(s.created_at)}
							/>
						{:else if columnaId === 'valor'}
							<div class="dir-celda">
								<span class="vt-monto">{moneda(s.valor_solicitado)}</span>
								{#if s.observaciones}<small class="vt-obs" title={s.observaciones}
										>«{s.observaciones}»</small
									>{/if}
							</div>
						{:else if columnaId === 'origen'}
							<div class="dir-celda vt-concepto">
								<span>{s.anticipo_origen.concepto}</span>
								<small
									>Le quedan {moneda(s.anticipo_origen.saldo)} de {moneda(
										s.anticipo_origen.valor
									)}</small
								>
							</div>
						{:else if columnaId === 'estado'}
							<EstadoPunto
								etiqueta={ESTADO_SOLICITUD[s.estado].etiqueta}
								color={ESTADO_SOLICITUD[s.estado].color}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'ver',
										etiqueta: 'Ver anticipo de origen',
										icono: Eye,
										onClick: () => (detalleId = s.anticipo_origen.id)
									},
									...(puedeEscribir && s.estado === 'PENDIENTE'
										? [
												{
													id: 'aprobar',
													etiqueta: 'Aprobar',
													icono: Check,
													onClick: () => abrirAprobacion(s.id)
												},
												{
													id: 'rechazar',
													etiqueta: 'Rechazar',
													icono: X,
													onClick: () => (rechazando = s),
													peligrosa: true
												}
											]
										: [])
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota('exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{estadoSolicitudes === 'PENDIENTE' ? 'Nada pendiente' : 'Sin solicitudes'}</h3>
							<p>Cuando un conductor pida más dinero desde la app, la solicitud aparecerá aquí.</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
		</div>
	{/if}
</div>

<ModalAnticipo
	open={formAbierto}
	anticipo={enEdicion}
	solicitud={aprobando}
	oncerrar={() => (formAbierto = false)}
	onguardado={(a) => {
		recargar();
		if (aprobando) detalleId = a.id;
	}}
/>

<ModalDetalleAnticipo
	open={!!detalleId}
	anticipoId={detalleId}
	{puedeEscribir}
	oncerrar={() => (detalleId = null)}
	oneditar={abrirEdicion}
	onaprobar={abrirAprobacion}
	oneliminar={eliminar}
	oncambio={recargar}
/>

<ModalMotivo
	open={!!rechazando}
	titulo="Rechazar solicitud"
	descripcion={rechazando
		? `${rechazando.conductor.nombre} pidió ${moneda(rechazando.valor_solicitado)}. Le llegará una notificación con el motivo.`
		: ''}
	textoConfirmar="Rechazar"
	placeholder="Ej. El viaje ya terminó"
	oncerrar={() => (rechazando = null)}
	onconfirmar={rechazar}
/>

<style>
	.vt-concepto {
		max-width: 26rem;
		min-width: 12rem;
	}
	.vt-concepto span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vt-pide {
		color: #b45309 !important;
		font-weight: 700;
	}
	.vt-monto {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.vt-obs {
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
