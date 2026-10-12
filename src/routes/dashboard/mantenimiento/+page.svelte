<script lang="ts">
	/**
	 * Mantenimiento de flota.
	 *
	 * Tres vistas: los PLANES preventivos de cada vehículo (vencidos y próximos
	 * primero), las ÓRDENES de trabajo (preventivas y correctivas) y los
	 * COSTOS por vehículo y por mes. Cerrar una orden preventiva mueve su plan.
	 *
	 * Enlaces que abren algo al llegar, y se quitan de la URL al consumirse:
	 *  - `?plan=<id>`: el aviso diario de un plan vencido o próximo;
	 *  - `?orden=<id>`: una orden concreta (desde la ficha del vehículo);
	 *  - `?preoperacional=<id>`: el aviso de un preoperacional con ítems en Malo;
	 *  - `?vehiculo=<id>&nuevo=orden|plan`: crear desde la ficha del vehículo.
	 *
	 * Misma cáscara que los directorios (`dir-*` de app.css y `listing/`).
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Eye, Pencil, Plus, Wrench } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import ModalPlan from '$lib/components/mantenimiento/ModalPlan.svelte';
	import ModalOrden from '$lib/components/mantenimiento/ModalOrden.svelte';
	import ModalDetalleOrden from '$lib/components/mantenimiento/ModalDetalleOrden.svelte';
	import ModalDetallePlan from '$lib/components/mantenimiento/ModalDetallePlan.svelte';
	import ModalNovedadesPreoperacional from '$lib/components/mantenimiento/ModalNovedadesPreoperacional.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { mascota } from '$lib/mascot';
	import {
		ESTADO_ORDEN,
		ESTADO_PLAN,
		TIPO_ORDEN,
		fecha as fmtFecha,
		km as fmtKm,
		mantenimientoAPI,
		moneda,
		periodicidad,
		restante,
		type CostosMantenimiento,
		type InicialOrden,
		type ListadoOrdenes,
		type ListadoPlanes,
		type OpcionesMantenimiento,
		type Orden,
		type OrdenDetalle,
		type Plan,
		type PlanDetalle,
		type ResumenMantenimiento
	} from '$lib/api/mantenimiento';

	const POR_PAGINA_PLANES = 50;
	const POR_PAGINA_ORDENES = 20;

	const puedeEscribir = $derived(
		!!$authStore.user && authStore.getAccessLevel('mantenimiento') === 'full'
	);
	/// El envío completo de un preoperacional vive en `formularios`; sin ese
	/// módulo se queda en el resumen de novedades.
	const puedeFormularios = $derived(!!$authStore.user && !!authStore.getAccessLevel('formularios'));

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		vista: string;
		q: string;
		/** Estado de los planes. */
		estado: string;
		categoria: string;
		/** Estado de las órdenes: `abiertas` por defecto, que es lo que hay que mover. */
		estado_orden: string;
		tipo: string;
		desde: string;
		hasta: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		vista: opcion('planes'),
		q: texto(),
		estado: opcion('todos'),
		categoria: opcion('todas'),
		estado_orden: opcion('abiertas'),
		tipo: opcion('todos'),
		desde: texto(),
		hasta: texto(),
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
	function cambiarVista(vista: string) {
		filtros = { ...filtros, vista, q: '', pagina: 1 };
	}
	const hayFiltrosPlanes = $derived(
		!!filtros.q || filtros.estado !== 'todos' || filtros.categoria !== 'todas'
	);
	const hayFiltrosOrdenes = $derived(
		!!filtros.q || filtros.estado_orden !== 'abiertas' || filtros.tipo !== 'todos'
	);
	function limpiarFiltros() {
		filtros = { ...limpiarFiltrosDe(DEFS, filtros), vista: filtros.vista };
	}

	// ── Datos comunes ────────────────────────────────────────────────────
	let opciones = $state<OpcionesMantenimiento | null>(null);
	let resumen = $state<ResumenMantenimiento | null>(null);

	async function cargarResumen() {
		try {
			resumen = await mantenimientoAPI.resumen();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo cargar el resumen');
		}
	}
	async function cargarOpciones() {
		try {
			opciones = await mantenimientoAPI.opciones();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las opciones');
		}
	}

	// ── Planes ───────────────────────────────────────────────────────────
	let planes = $state<ListadoPlanes | null>(null);
	let cargandoPlanes = $state(true);

	$effect(() => {
		if (filtros.vista !== 'planes') return;
		void filtros.q;
		void filtros.estado;
		void filtros.categoria;
		void filtros.pagina;
		void cargarPlanes();
	});

	async function cargarPlanes() {
		cargandoPlanes = true;
		try {
			planes = await mantenimientoAPI.planes({
				q: filtros.q || undefined,
				estado: filtros.estado,
				categoria: filtros.categoria === 'todas' ? undefined : filtros.categoria,
				page: filtros.pagina,
				limit: POR_PAGINA_PLANES
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los planes');
		} finally {
			cargandoPlanes = false;
		}
	}

	const SEGMENTOS_PLAN = [
		{ valor: 'todos', etiqueta: 'Todos' },
		/// Vencidos + próximos: lo que alguien tiene que mover (enlace del panel de inicio).
		{ valor: 'alerta', etiqueta: 'Por atender' },
		{ valor: 'vencido', etiqueta: 'Vencidos', punto: ESTADO_PLAN.vencido.color },
		{ valor: 'proximo', etiqueta: 'Próximos', punto: ESTADO_PLAN.proximo.color },
		{ valor: 'al_dia', etiqueta: 'Al día', punto: ESTADO_PLAN.al_dia.color },
		{ valor: 'sin_datos', etiqueta: 'Sin datos', punto: ESTADO_PLAN.sin_datos.color },
		{ valor: 'pausado', etiqueta: 'Pausados', punto: ESTADO_PLAN.pausado.color }
	];

	const COLUMNAS_PLAN: ColumnDef<Plan, any>[] = [
		{ id: 'vehiculo', header: 'Vehículo', enableSorting: false, size: 200 },
		{ id: 'plan', header: 'Plan', enableSorting: false },
		{ id: 'ultimo', header: 'Último', enableSorting: false, size: 150 },
		{ id: 'proximo', header: 'Próximo', enableSorting: false, size: 150 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 190 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];

	// ── Órdenes ──────────────────────────────────────────────────────────
	let ordenes = $state<ListadoOrdenes | null>(null);
	let cargandoOrdenes = $state(true);

	$effect(() => {
		if (filtros.vista !== 'ordenes') return;
		void filtros.q;
		void filtros.estado_orden;
		void filtros.tipo;
		void filtros.pagina;
		void cargarOrdenes();
	});

	async function cargarOrdenes() {
		cargandoOrdenes = true;
		try {
			ordenes = await mantenimientoAPI.ordenes({
				q: filtros.q || undefined,
				estado: filtros.estado_orden,
				tipo: filtros.tipo,
				page: filtros.pagina,
				limit: POR_PAGINA_ORDENES
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las órdenes');
		} finally {
			cargandoOrdenes = false;
		}
	}

	const SEGMENTOS_ORDEN = $derived([
		{ valor: 'abiertas', etiqueta: 'Abiertas' },
		{ valor: 'PROGRAMADO', etiqueta: 'Por iniciar', punto: ESTADO_ORDEN.PROGRAMADO.color },
		{ valor: 'EN_CURSO', etiqueta: 'En curso', punto: ESTADO_ORDEN.EN_CURSO.color },
		{ valor: 'EJECUTADO', etiqueta: 'Cerradas', punto: ESTADO_ORDEN.EJECUTADO.color },
		{ valor: 'CANCELADO', etiqueta: 'Anuladas', punto: ESTADO_ORDEN.CANCELADO.color },
		{ valor: 'todas', etiqueta: 'Todas' }
	]);

	const COLUMNAS_ORDEN: ColumnDef<Orden, any>[] = [
		{ id: 'ot', header: 'OT · Fecha', enableSorting: false, size: 130 },
		{ id: 'vehiculo', header: 'Vehículo', enableSorting: false, size: 180 },
		{ id: 'trabajo', header: 'Trabajo · Taller', enableSorting: false },
		{ id: 'costo', header: 'Costo', enableSorting: false, size: 130 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 120 },
		{ id: 'acciones', header: '', enableSorting: false, size: 80 }
	];

	// ── Costos ───────────────────────────────────────────────────────────
	let costos = $state<CostosMantenimiento | null>(null);
	let cargandoCostos = $state(false);

	$effect(() => {
		if (filtros.vista !== 'costos') return;
		void filtros.desde;
		void filtros.hasta;
		void cargarCostos();
	});

	async function cargarCostos() {
		cargandoCostos = true;
		try {
			costos = await mantenimientoAPI.costos({
				desde: filtros.desde || undefined,
				hasta: filtros.hasta || undefined
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudieron calcular los costos');
		} finally {
			cargandoCostos = false;
		}
	}

	type FilaCosto = CostosMantenimiento['por_vehiculo'][number];
	const COLUMNAS_COSTO: ColumnDef<FilaCosto, any>[] = [
		{ id: 'vehiculo', header: 'Vehículo', enableSorting: false },
		{ id: 'ordenes', header: 'Órdenes', enableSorting: false, size: 140 },
		{ id: 'repuestos', header: 'Repuestos', enableSorting: false, size: 140 },
		{ id: 'mano_obra', header: 'Mano de obra', enableSorting: false, size: 140 },
		{ id: 'total', header: 'Total', enableSorting: false, size: 150 }
	];

	const MESES = [
		'ene',
		'feb',
		'mar',
		'abr',
		'may',
		'jun',
		'jul',
		'ago',
		'sep',
		'oct',
		'nov',
		'dic'
	];
	const nombreMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

	// ── Cabecera ─────────────────────────────────────────────────────────
	const conteos = $derived([
		{
			clave: 'vencido',
			etiqueta: 'Vencidos',
			valor: resumen?.planes.vencido ?? 0,
			color: ESTADO_PLAN.vencido.color
		},
		{
			clave: 'proximo',
			etiqueta: 'Próximos',
			valor: resumen?.planes.proximo ?? 0,
			color: ESTADO_PLAN.proximo.color
		},
		{
			clave: 'abiertas',
			etiqueta: 'Órdenes abiertas',
			valor: resumen?.ordenes.abiertas ?? 0,
			color: ESTADO_ORDEN.PROGRAMADO.color
		},
		{ clave: 'costo_mes', etiqueta: 'Costo del mes', valor: moneda(resumen?.costo_mes.total ?? 0) }
	]);
	const conteoActivo = $derived(
		filtros.vista === 'planes' && (filtros.estado === 'vencido' || filtros.estado === 'proximo')
			? filtros.estado
			: filtros.vista === 'ordenes' && filtros.estado_orden === 'abiertas'
				? 'abiertas'
				: null
	);
	function elegirConteo(clave: string) {
		if (clave === 'vencido' || clave === 'proximo')
			filtros = {
				...filtros,
				vista: 'planes',
				estado: filtros.estado === clave ? 'todos' : clave,
				pagina: 1
			};
		else if (clave === 'abiertas')
			filtros = { ...filtros, vista: 'ordenes', estado_orden: 'abiertas', pagina: 1 };
		else if (clave === 'costo_mes' && resumen)
			filtros = {
				...filtros,
				vista: 'costos',
				desde: `${resumen.costo_mes.mes}-01`,
				hasta: resumen.hoy
			};
	}

	// ── Modales ──────────────────────────────────────────────────────────
	let modalPlan = $state(false);
	let planEditado = $state<PlanDetalle | null>(null);
	let vehiculosParaPlan = $state<string[]>([]);
	let modalOrden = $state(false);
	let ordenEditada = $state<OrdenDetalle | null>(null);
	let inicialOrden = $state<InicialOrden | null>(null);
	let detalleOrdenId = $state<string | null>(null);
	let detallePlanId = $state<string | null>(null);
	let versionPlan = $state(0);
	let preoperacionalId = $state<string | null>(null);

	async function asegurarOpciones() {
		if (!opciones) await cargarOpciones();
		return opciones;
	}
	async function nuevoPlan(vehiculos: string[] = []) {
		if (!(await asegurarOpciones())) return;
		planEditado = null;
		vehiculosParaPlan = vehiculos;
		modalPlan = true;
	}
	async function editarPlan(p: PlanDetalle) {
		if (!(await asegurarOpciones())) return;
		planEditado = p;
		modalPlan = true;
	}
	async function nuevaOrden(inicial: InicialOrden | null = null) {
		if (!(await asegurarOpciones())) return;
		ordenEditada = null;
		inicialOrden = inicial;
		detallePlanId = null;
		preoperacionalId = null;
		modalOrden = true;
	}
	async function editarOrden(o: OrdenDetalle) {
		if (!(await asegurarOpciones())) return;
		ordenEditada = o;
		inicialOrden = null;
		modalOrden = true;
	}
	function verOrden(id: string) {
		detallePlanId = null;
		detalleOrdenId = id;
	}

	/// Tras cualquier cambio se recarga lo que está a la vista y la cabecera.
	function refrescar() {
		void cargarResumen();
		if (filtros.vista === 'planes') void cargarPlanes();
		else if (filtros.vista === 'ordenes') void cargarOrdenes();
		else void cargarCostos();
		versionPlan += 1;
	}

	/// Enlaces de los avisos y de la ficha del vehículo: se consumen una vez.
	$effect(() => {
		const p = page.url.searchParams;
		const plan = p.get('plan');
		const orden = p.get('orden');
		const preop = p.get('preoperacional');
		const nuevo = p.get('nuevo');
		const vehiculo = p.get('vehiculo');
		if (!plan && !orden && !preop && !nuevo) return;
		const url = new URL(page.url);
		for (const k of ['plan', 'orden', 'preoperacional', 'nuevo', 'vehiculo'])
			url.searchParams.delete(k);
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		if (plan) detallePlanId = plan;
		else if (orden) detalleOrdenId = orden;
		else if (preop) preoperacionalId = preop;
		else if (nuevo === 'orden') void nuevaOrden({ tipo: 'CORRECTIVO', vehiculo_id: vehiculo });
		else if (nuevo === 'plan') void nuevoPlan(vehiculo ? [vehiculo] : []);
	});

	/// Un aviso de mantenimiento que llega por socket mueve la cabecera.
	function alLlegarNotificacion(n: { referencia_tipo?: string }) {
		if (n?.referencia_tipo?.startsWith('mant:') || n?.referencia_tipo === 'preop_malo')
			void cargarResumen();
	}
	onMount(() => {
		void cargarResumen();
		void cargarOpciones();
		socketUtils.on('nueva-notificacion', alLlegarNotificacion);
		return () => socketUtils.off('nueva-notificacion', alLlegarNotificacion);
	});
</script>

<svelte:head>
	<title>Mantenimiento · Panel</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Mantenimiento</h1>
			<p class="dir-desc">
				Planes preventivos por kilometraje y por tiempo, órdenes de trabajo del taller y lo que
				cuesta cada vehículo. Un plan avisa a los {opciones?.umbrales.km ?? 500} km o {opciones
					?.umbrales.dias ?? 15}
				días de tocar; cerrar su orden lo deja al día.
			</p>
			<div class="dir-conteos">
				<ResumenConteos {conteos} activo={conteoActivo} onElegir={elegirConteo} />
			</div>
		</div>
		{#if puedeEscribir}
			<div class="dir-cabecera-acciones">
				<button type="button" class="btn-secondary" onclick={() => nuevoPlan()}>
					<Plus size={16} strokeWidth={2.4} />
					Nuevo plan
				</button>
				<button type="button" class="btn-primary" onclick={() => nuevaOrden()}>
					<Wrench size={16} strokeWidth={2.4} />
					Nueva orden
				</button>
			</div>
		{/if}
	</header>

	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{ id: 'planes', label: 'Planes', cuenta: resumen?.planes.total ?? null },
				{ id: 'ordenes', label: 'Órdenes', cuenta: resumen?.ordenes.abiertas || null },
				{ id: 'costos', label: 'Costos' }
			]}
			activa={filtros.vista}
			etiqueta="Vistas de mantenimiento"
			onCambiar={cambiarVista}
		/>
	</div>

	{#if filtros.vista === 'planes'}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Placa, marca o plan…"
					etiqueta="Buscar planes"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS_PLAN.map((s) => ({
					...s,
					etiqueta:
						s.valor !== 'todos' && planes
							? `${s.etiqueta} ${
									s.valor === 'alerta'
										? planes.conteos.vencido + planes.conteos.proximo
										: (planes.conteos[s.valor as keyof typeof planes.conteos] ?? 0)
								}`
							: s.etiqueta
				}))}
				valor={filtros.estado}
				onCambiar={(v) => ponerFiltro('estado', v)}
			/>
			<label class="mt-select">
				<span>Tipo</span>
				<select
					value={filtros.categoria}
					onchange={(e) => ponerFiltro('categoria', (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="todas">Todos</option>
					{#each opciones?.categorias ?? [] as c (c.clave)}<option value={c.clave}
							>{c.etiqueta}</option
						>{/each}
				</select>
			</label>
			{#if hayFiltrosPlanes}
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar</button>
			{/if}
		</div>
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_PLAN}
					datos={planes?.items ?? []}
					claveFila={(p) => p.id}
					cargando={cargandoPlanes}
					onFila={(p) => (detallePlanId = p.id)}
					etiqueta="Planes de mantenimiento"
				>
					{#snippet celda({ columnaId, fila: p })}
						{#if columnaId === 'vehiculo'}
							<CeldaIdentidad
								codigo={p.vehiculo.placa}
								titulo={[p.vehiculo.marca, p.vehiculo.linea].filter(Boolean).join(' ') ||
									'Sin marca'}
								subtitulo={p.km_actual ? fmtKm(p.km_actual) : 'Sin kilometraje'}
							/>
						{:else if columnaId === 'plan'}
							<div class="dir-celda">
								<span>{p.nombre}</span>
								<small>{periodicidad(p)}</small>
							</div>
						{:else if columnaId === 'ultimo'}
							<div class="dir-celda dir-celda--fecha">
								<span>{fmtFecha(p.ultima_ejecucion_fecha)}</span>
								<small>{fmtKm(p.ultima_ejecucion_km)}</small>
							</div>
						{:else if columnaId === 'proximo'}
							<div class="dir-celda dir-celda--fecha">
								<span>{fmtFecha(p.proxima_fecha)}</span>
								<small>{fmtKm(p.proximo_km)}</small>
							</div>
						{:else if columnaId === 'estado'}
							<div class="dir-celda">
								<EstadoPunto
									etiqueta={ESTADO_PLAN[p.estado].etiqueta}
									color={ESTADO_PLAN[p.estado].color}
									apagado={p.estado === 'pausado'}
								/>
								<small
									>{p.orden_abierta
										? `OT ${p.orden_abierta.consecutivo} ${ESTADO_ORDEN[p.orden_abierta.estado].etiqueta.toLowerCase()}`
										: restante(p)}</small
								>
							</div>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									p.orden_abierta
										? {
												id: 'ot',
												etiqueta: `Ver OT ${p.orden_abierta.consecutivo}`,
												icono: Eye,
												onClick: () => verOrden(p.orden_abierta!.id)
											}
										: {
												id: 'orden',
												etiqueta: 'Abrir orden',
												icono: Wrench,
												onClick: () =>
													nuevaOrden({ tipo: 'PREVENTIVO', plan_id: p.id, descripcion: p.nombre }),
												oculta: !puedeEscribir || !p.activo
											},
									{
										id: 'ver',
										etiqueta: 'Ver plan',
										icono: Eye,
										onClick: () => (detallePlanId = p.id)
									}
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota(hayFiltrosPlanes ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltrosPlanes ? 'Sin resultados' : 'Todavía no hay planes'}</h3>
							<p>
								Un plan dice cada cuántos kilómetros o meses toca un mantenimiento. Se aplica a
								varios vehículos a la vez y avisa antes de vencerse.
							</p>
							{#if puedeEscribir && !hayFiltrosPlanes}
								<button type="button" class="btn-primary" onclick={() => nuevoPlan()}
									><Plus size={16} /> Crear el primero</button
								>
							{:else if hayFiltrosPlanes}
								<button type="button" class="btn-secondary" onclick={limpiarFiltros}
									>Limpiar filtros</button
								>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			{#if planes && planes.total > POR_PAGINA_PLANES}
				<PaginadorLista
					pagina={filtros.pagina}
					total={planes.total}
					porPagina={POR_PAGINA_PLANES}
					onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
					cargando={cargandoPlanes}
					nombreItems="planes"
				/>
			{/if}
		</div>
	{:else if filtros.vista === 'ordenes'}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="OT, placa, trabajo, taller o factura…"
					etiqueta="Buscar órdenes"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS_ORDEN}
				valor={filtros.estado_orden}
				onCambiar={(v) => ponerFiltro('estado_orden', v)}
			/>
			<SegmentosFiltro
				etiqueta="Tipo"
				opciones={[
					{ valor: 'todos', etiqueta: 'Todas' },
					{ valor: 'PREVENTIVO', etiqueta: 'Preventivas' },
					{ valor: 'CORRECTIVO', etiqueta: 'Correctivas' }
				]}
				valor={filtros.tipo}
				onCambiar={(v) => ponerFiltro('tipo', v)}
			/>
			{#if hayFiltrosOrdenes}
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar</button>
			{/if}
		</div>
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_ORDEN}
					datos={ordenes?.items ?? []}
					claveFila={(o) => o.id}
					cargando={cargandoOrdenes}
					onFila={(o) => verOrden(o.id)}
					etiqueta="Órdenes de trabajo"
				>
					{#snippet celda({ columnaId, fila: o })}
						{#if columnaId === 'ot'}
							<div class="dir-celda dir-celda--fecha">
								<span class="mt-ot">OT {o.consecutivo}</span>
								<small>{fmtFecha(o.fecha_ejecucion ?? o.fecha)}</small>
							</div>
						{:else if columnaId === 'vehiculo'}
							<div class="dir-celda">
								<span class="mt-placa">{o.vehiculo.placa}</span>
								<small>{TIPO_ORDEN[o.tipo]}{o.plan ? ` · ${o.plan.nombre}` : ''}</small>
							</div>
						{:else if columnaId === 'trabajo'}
							<div class="dir-celda">
								<span class="mt-trabajo">{o.descripcion}</span>
								<small
									>{o.taller ?? 'Sin taller'}{o.adjuntos
										? ` · ${o.adjuntos} soporte${o.adjuntos === 1 ? '' : 's'}`
										: ''}</small
								>
							</div>
						{:else if columnaId === 'costo'}
							<span class="mt-dinero">{moneda(o.costo)}</span>
						{:else if columnaId === 'estado'}
							<EstadoPunto
								etiqueta={ESTADO_ORDEN[o.estado].etiqueta}
								color={ESTADO_ORDEN[o.estado].color}
								apagado={o.estado === 'CANCELADO'}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{ id: 'ver', etiqueta: 'Ver', icono: Eye, onClick: () => verOrden(o.id) }
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota(hayFiltrosOrdenes ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>
								{filtros.estado_orden === 'abiertas' && !filtros.q
									? 'No hay órdenes abiertas'
									: 'Sin resultados'}
							</h3>
							<p>
								Las órdenes preventivas se abren desde su plan; las correctivas, por una falla o por
								un preoperacional con ítems en Malo.
							</p>
							{#if puedeEscribir}
								<button type="button" class="btn-primary" onclick={() => nuevaOrden()}
									><Plus size={16} /> Nueva orden</button
								>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			{#if ordenes && ordenes.total > POR_PAGINA_ORDENES}
				<PaginadorLista
					pagina={filtros.pagina}
					total={ordenes.total}
					porPagina={POR_PAGINA_ORDENES}
					onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
					cargando={cargandoOrdenes}
					nombreItems="órdenes"
				/>
			{/if}
		</div>
	{:else}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<label class="mt-select">
				<span>Desde</span>
				<input
					type="date"
					value={filtros.desde || costos?.desde || ''}
					onchange={(e) =>
						(filtros = { ...filtros, desde: (e.currentTarget as HTMLInputElement).value })}
				/>
			</label>
			<label class="mt-select">
				<span>Hasta</span>
				<input
					type="date"
					value={filtros.hasta || costos?.hasta || ''}
					onchange={(e) =>
						(filtros = { ...filtros, hasta: (e.currentTarget as HTMLInputElement).value })}
				/>
			</label>
			{#if costos}
				<ResumenConteos
					conteos={[
						{ clave: 'total', etiqueta: 'Total', valor: moneda(costos.totales.total) },
						{ clave: 'prev', etiqueta: 'Preventivo', valor: moneda(costos.totales.preventivo) },
						{ clave: 'corr', etiqueta: 'Correctivo', valor: moneda(costos.totales.correctivo) },
						{ clave: 'ord', etiqueta: 'Órdenes cerradas', valor: costos.totales.ordenes }
					]}
				/>
			{/if}
			{#if filtros.desde || filtros.hasta}
				<button
					type="button"
					class="btn-secondary"
					onclick={() => (filtros = { ...filtros, desde: '', hasta: '' })}>Año en curso</button
				>
			{/if}
		</div>
		<div class="mt-costos" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista">
				<TablaLista
					columnas={COLUMNAS_COSTO}
					datos={costos?.por_vehiculo ?? []}
					claveFila={(v) => v.vehiculo_id}
					cargando={cargandoCostos}
					etiqueta="Costo de mantenimiento por vehículo"
				>
					{#snippet celda({ columnaId, fila: v })}
						{#if columnaId === 'vehiculo'}
							<CeldaIdentidad
								codigo={v.placa}
								titulo={[v.marca, v.linea].filter(Boolean).join(' ') || 'Sin marca'}
							/>
						{:else if columnaId === 'ordenes'}
							<div class="dir-celda">
								<span>{v.ordenes}</span>
								<small>{v.preventivas} prev. · {v.correctivas} corr.</small>
							</div>
						{:else if columnaId === 'repuestos'}
							<span class="mt-dinero">{moneda(v.repuestos)}</span>
						{:else if columnaId === 'mano_obra'}
							<span class="mt-dinero">{moneda(v.mano_obra)}</span>
						{:else if columnaId === 'total'}
							<strong class="mt-dinero">{moneda(v.total)}</strong>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>Sin órdenes cerradas en el periodo</h3>
							<p>El costo cuenta las órdenes cerradas por la fecha en que se hizo el trabajo.</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
			{#if costos?.por_mes.length}
				<section class="page-card mt-meses">
					<h2>Por mes</h2>
					<table>
						<thead>
							<tr><th>Mes</th><th>Preventivo</th><th>Correctivo</th><th>Total</th></tr>
						</thead>
						<tbody>
							{#each costos.por_mes as m (m.mes)}
								<tr>
									<td>{nombreMes(m.mes)}</td>
									<td>{moneda(m.preventivo)}</td>
									<td>{moneda(m.correctivo)}</td>
									<td><strong>{moneda(m.total)}</strong></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}
		</div>
	{/if}
</div>

{#if opciones}
	<ModalPlan
		open={modalPlan}
		{opciones}
		plan={planEditado}
		vehiculosIniciales={vehiculosParaPlan}
		oncerrar={() => (modalPlan = false)}
		onguardado={refrescar}
	/>
	<ModalOrden
		open={modalOrden}
		{opciones}
		orden={ordenEditada}
		inicial={inicialOrden}
		oncerrar={() => (modalOrden = false)}
		onguardado={(o) => {
			refrescar();
			detalleOrdenId = o.id;
		}}
	/>
{/if}
<ModalDetalleOrden
	open={detalleOrdenId !== null && !modalOrden}
	ordenId={detalleOrdenId}
	hoy={opciones?.hoy ?? resumen?.hoy ?? new Date().toISOString().slice(0, 10)}
	{puedeEscribir}
	oncerrar={() => (detalleOrdenId = null)}
	oneditar={editarOrden}
	oncambio={refrescar}
/>
<ModalDetallePlan
	open={detallePlanId !== null && !modalPlan && !modalOrden}
	planId={detallePlanId}
	version={versionPlan}
	{puedeEscribir}
	oncerrar={() => (detallePlanId = null)}
	oneditar={editarPlan}
	oncrearorden={(p) => nuevaOrden({ tipo: 'PREVENTIVO', plan_id: p.id, descripcion: p.nombre })}
	onverorden={(o) => verOrden(o.id)}
	oncambio={refrescar}
/>
<ModalNovedadesPreoperacional
	open={preoperacionalId !== null}
	envioId={preoperacionalId}
	{puedeEscribir}
	{puedeFormularios}
	oncerrar={() => (preoperacionalId = null)}
	oncrearcorrectiva={(i) => nuevaOrden({ tipo: 'CORRECTIVO', ...i })}
/>

<style>
	.mt-select {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mt-select select,
	.mt-select input {
		padding: 0.4rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.82rem;
	}
	.mt-ot,
	.mt-placa {
		font-weight: 800;
		letter-spacing: 0.03em;
	}
	.mt-trabajo {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.mt-dinero {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* Por vehículo arriba y por mes debajo: la tabla de vehículos necesita
	   todo el ancho para sus cinco columnas de dinero. */
	.mt-costos {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 0;
	}
	.mt-meses {
		padding: 1rem 1.25rem;
	}
	.mt-meses h2 {
		margin: 0 0 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.mt-meses table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}
	.mt-meses th {
		padding: 0.35rem 0.4rem;
		text-align: right;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.mt-meses td {
		padding: 0.4rem;
		border-top: 1px solid var(--border-subtle);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.mt-meses th:first-child,
	.mt-meses td:first-child {
		text-align: left;
	}
</style>
