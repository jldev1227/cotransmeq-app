<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesDropdown, { type AccionMenu } from '$lib/components/AccionesDropdown.svelte';
	import { mascota } from '$lib/mascot';
	import {
		ArrowDown,
		CalendarDays,
		Eye,
		List,
		Map as MapIcon,
		Pencil,
		Plus,
		Share2,
		SlidersHorizontal,
		Smartphone,
		Table2,
		Ticket,
		Trash2,
		X
	} from 'lucide-svelte';
	import { authStore } from '$lib/stores/auth';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { browser } from '$app/environment';
	import { fade, fly } from 'svelte/transition';
	import { serviciosStore, serviciosPorEstado } from '$lib/stores/servicios';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import {
		recursos,
		conductoresOptions,
		vehiculosOptions,
		clientesOptions
	} from '$lib/stores/recursos';
	import {
		getEstadoText,
		getEstadoColor,
		formatCurrency,
		formatDateTime,
		type ServicioConRelaciones,
		type EstadoServicio
	} from '$lib/types/servicios';
	import {
		labelPropositoServicio,
		normalizarPropositoServicio
	} from '$lib/config/proposito-servicio';
	import ModalTicket from '$lib/components/servicios/ModalTicket.svelte';
	import ModalFormServicio from '$lib/components/servicios/ModalFormServicio.svelte';
	import ModalConfirm from '$lib/components/common/ModalConfirm.svelte';
	import CalendarServicio from '$lib/components/servicios/CalendarServicio.svelte';
	import CanvasServicios from '$lib/components/servicios/CanvasServicios.svelte';
	import { toast } from '$lib/stores/toast';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import { socketUtils } from '$lib/socket';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';

	// Labels para los chips removibles del FilterDrawer
	// ── Permisos ──────────────────────────────────────────────────────
	// `Consulta` (`read`) entra a la pantalla pero no escribe. Se lee
	// `$authStore` a propósito para que el derived se recalcule cuando la
	// sesión termine de hidratarse. El backend aplica lo mismo sobre las
	// rutas de escritura de `servicios`; esto sólo evita ofrecer un botón
	// que iba a devolver 403.
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('servicios') === 'full'
	);

	const ESTADO_SERVICIO_LABELS: Record<string, string> = {
		solicitado: 'Solicitado',
		en_curso: 'En Curso',
		planificado: 'Planificado',
		realizado: 'Realizado',
		cancelado: 'Cancelado',
		liquidado: 'Liquidado'
	};
	const ORDENAR_POR_LABELS: Record<string, string> = {
		fecha_solicitud: 'Fecha solicitud',
		fecha_realizacion: 'Fecha realización',
		estado: 'Estado',
		cliente: 'Cliente',
		conductor: 'Conductor'
	};
	const CAMPO_FECHA_LABELS: Record<string, string> = {
		fecha_solicitud: 'Solicitud',
		created_at: 'Creación',
		fecha_realizacion: 'Realización',
		fecha_finalizacion: 'Finalización'
	};

	function getOpcionLabel(opciones: any[], id: string | null): string {
		if (!id) return '';
		return opciones.find((o: any) => o.value === id)?.label ?? '';
	}

	/**
	 * Filtros de la página, declarados una vez.
	 *
	 * Los nombres `view`, `mes`, `anio` y `campo_fecha` son los que la página
	 * ya escribía —eran los ÚNICOS que llegaban a la URL— y se conservan para
	 * no romper enlaces guardados. El resto es nuevo: hasta ahora la búsqueda,
	 * el estado, los filtros avanzados, el orden y la página no salían de la
	 * memoria, así que una vista filtrada no se podía compartir ni sobrevivía a
	 * una recarga.
	 */
	interface FiltrosServicios {
		view: string;
		q: string;
		estado: string;
		conductor: string;
		vehiculo: string;
		cliente: string;
		desde: string;
		hasta: string;
		campo: string;
		orden: string;
		dir: string;
		pagina: number;
		/** Solo tienen sentido en la vista de calendario. */
		mes: number;
		anio: number;
		campo_fecha: string;
	}

	const HOY = new Date();

	const DEFS: DefinicionesFiltros<FiltrosServicios> = {
		view: opcion('lista'),
		q: texto(),
		estado: opcion(''),
		conductor: texto(),
		vehiculo: texto(),
		cliente: texto(),
		desde: texto(),
		hasta: texto(),
		campo: opcion('fecha_solicitud'),
		orden: opcion('fecha_solicitud'),
		dir: opcion('desc'),
		pagina: numero(1),
		mes: numero(HOY.getMonth() + 1),
		anio: numero(HOY.getFullYear()),
		campo_fecha: opcion('fecha_realizacion')
	};

	const estadoUrl = crearEstadoUrl(DEFS);

	// Estados locales
	let filtroEstado = $state<EstadoServicio | ''>('');
	let busqueda = $state('');
	let busquedaTimeout: ReturnType<typeof setTimeout> | null = null;
	let mostrarFiltros = $state(false);
	let mostrarModalTicket = $state(false);
	let mostrarModalFormServicio = $state(false);
	let mostrarModalConfirm = $state(false);
	let servicioSeleccionado = $state<ServicioConRelaciones | null>(null);

	let servicioEditar = $state<ServicioConRelaciones | null>(null);
	let servicioAEliminar = $state<ServicioConRelaciones | null>(null);
	let inicializado = $state(false);

	type VistaActiva = 'lista' | 'calendario' | 'canvas';
	type CampoFechaCal = 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion';
	let vistaActiva = $state<VistaActiva>('lista');
	let calMes = $state(new Date().getMonth());
	let calAnio = $state(new Date().getFullYear());
	let calCampoFecha = $state<CampoFechaCal>('fecha_realizacion');

	// Filtros avanzados
	let conductorSeleccionado = $state<string | null>(null);
	let vehiculoSeleccionado = $state<string | null>(null);
	let clienteSeleccionado = $state<string | null>(null);
	let filtroFechaDesde = $state('');
	let filtroFechaHasta = $state('');
	let campoFecha = $state<
		'fecha_solicitud' | 'fecha_realizacion' | 'created_at' | 'fecha_finalizacion'
	>('fecha_solicitud');
	let ordenarPor = $state('fecha_solicitud');
	let ordenDireccion = $state<'asc' | 'desc'>('desc');

	// Paginación
	let paginaActual = $state(1);
	let itemsPorPagina = $state(20);

	// Estado del canvas (paginación infinita, sin límite total)
	let canvasServicios = $state<ServicioConRelaciones[]>([]);
	let canvasLoadingInicial = $state(false);
	let canvasCargandoMas = $state(false);
	let canvasPage = $state(1);
	let canvasTotal = $state(0);
	let canvasHasMore = $state(true);
	let canvasFetchToken = $state(0);
	let canvasError = $state<string | null>(null);
	let canvasFirmaFiltros = $state('');
	const CANVAS_PAGE_SIZE = 20;
	// Sort del canvas. Default: fecha_solicitud desc (equivale al endpoint).
	// El toggle invierte la dirección sin filtrar → el count N/Total se preserva
	// (ej. 80/1104 sigue siendo 80/1104, solo cambia el orden de los 80 cargados).
	let canvasSortField = $state('fecha_solicitud');
	let canvasSortDirection = $state<'asc' | 'desc'>('desc');

	// ═══ Cache del canvas: prioriza cache antes que request ═══
	// Estructura: Map<keyCache, { data, total, ts }>
	// Clave: `${firmaFiltros}__p${page}` (incluye TODOS los filtros + página)
	// TTL: 60s. El refresh al hacer scroll → si la entrada existe y está
	// fresca, sirve directo sin request (clave en la observación del usuario:
	// "scrolling refresh que adiciona servicios debería cargarlos en cache").
	// Los servicios YA en memoria (canvasServicios) se conservan al cambiar
	// de página y se concatenan con el resultado cacheado/nuevo.
	type CanvasCacheEntry = { data: ServicioConRelaciones[]; total: number; ts: number };
	const canvasCache: Map<string, CanvasCacheEntry> = new Map();
	// Set de keys en vuelo para deduplicar requests concurrentes (evita
	// que 2 scrolls rápidos al mismo sentinel disparen 2 fetches iguales).
	const canvasInflight: Set<string> = new Set();
	const CANVAS_CACHE_TTL_MS = 60_000;

	function canvasCacheKey(firma: string, page: number): string {
		return `${firma}__p${page}`;
	}

	function canvasCacheGet(key: string): CanvasCacheEntry | null {
		const entry = canvasCache.get(key);
		if (!entry) return null;
		if (Date.now() - entry.ts > CANVAS_CACHE_TTL_MS) {
			canvasCache.delete(key);
			return null;
		}
		return entry;
	}

	function canvasCachePut(key: string, data: ServicioConRelaciones[], total: number) {
		canvasCache.set(key, { data, total, ts: Date.now() });
		// Poda básica: si la cache crece mucho, borrar las más viejas.
		if (canvasCache.size > 60) {
			const ahora = Date.now();
			for (const [k, v] of canvasCache.entries()) {
				if (ahora - v.ts > CANVAS_CACHE_TTL_MS) canvasCache.delete(k);
			}
		}
	}

	function canvasCacheInvalidate() {
		canvasCache.clear();
		canvasInflight.clear();
	}

	// ═══ Normalized match: prioriza cache antes que request y matchea
	// contra columnas prioritarias (NO contra SI/NO ni kilómetros).
	// Usado como safety-net cliente: si la búsqueda del backend no filtra
	// lo suficiente, aplicamos este filtro sobre `canvasServicios` para
	// garantizar el comportamiento pedido por el usuario.
	function normalizarTexto(s: string | null | undefined): string {
		if (!s) return '';
		return s
			.toString()
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// Columnas prioritarias para el match (en este orden lógico de importancia):
	//   #solicitud, placa, conductor (nombre+apellido), divipol/municipio origen
	//   y destino. NO incluye SI/NO, km inicial/final/total, ni duraciones.
	type ServicioMatchable = Pick<
		ServicioConRelaciones,
		| 'id'
		| 'numero_planilla'
		| 'conductor'
		| 'vehiculo'
		| 'origen'
		| 'destino'
		| 'origen_especifico'
		| 'destino_especifico'
	> & { recargos_planillas?: any[] };

	function servicioMatch(servicio: ServicioMatchable, term: string): boolean {
		if (!term) return true;
		const t = normalizarTexto(term);
		if (!t) return true;

		// #solicitud (short id)
		if (servicio.id && servicio.id.slice(0, 8).toLowerCase().includes(t)) return true;
		// planilla
		if (servicio.numero_planilla && normalizarTexto(servicio.numero_planilla).includes(t))
			return true;
		// placa
		if (servicio.vehiculo?.placa && normalizarTexto(servicio.vehiculo.placa).includes(t))
			return true;
		// conductor
		const conductorTxt = `${servicio.conductor?.nombre ?? ''} ${servicio.conductor?.apellido ?? ''}`;
		if (conductorTxt && normalizarTexto(conductorTxt).includes(t)) return true;
		// divipol origen / municipio origen / origen específico
		if (servicio.origen) {
			const dep = String(servicio.origen.codigo_departamento ?? '').padStart(2, '0');
			const mun = String(servicio.origen.codigo_municipio ?? '').padStart(5, '0');
			const divipol = `${dep}${mun}`;
			if (divipol.includes(t)) return true;
			if (normalizarTexto(servicio.origen.nombre_municipio).includes(t)) return true;
			if (normalizarTexto(servicio.origen.nombre_departamento).includes(t)) return true;
		}
		if (servicio.origen_especifico && normalizarTexto(servicio.origen_especifico).includes(t))
			return true;
		// divipol destino / municipio destino / destino específico
		if (servicio.destino) {
			const dep = String(servicio.destino.codigo_departamento ?? '').padStart(2, '0');
			const mun = String(servicio.destino.codigo_municipio ?? '').padStart(5, '0');
			const divipol = `${dep}${mun}`;
			if (divipol.includes(t)) return true;
			if (normalizarTexto(servicio.destino.nombre_municipio).includes(t)) return true;
			if (normalizarTexto(servicio.destino.nombre_departamento).includes(t)) return true;
		}
		if (servicio.destino_especifico && normalizarTexto(servicio.destino_especifico).includes(t))
			return true;
		return false;
	}

	// Servicios visibles en el canvas: primero aplica el normalized match
	// cliente si hay búsqueda (safety-net), y deduplica por id.
	let canvasServiciosVisibles = $derived.by(() => {
		const term = busqueda?.trim() ?? '';
		if (!term) return canvasServicios;
		return canvasServicios.filter((s) => servicioMatch(s, term));
	});

	let stats = $derived($serviciosStore.stats);
	let servicios = $derived($serviciosStore.servicios);
	let loading = $derived($serviciosStore.loading);
	let pagination = $derived($serviciosStore.pagination);
	let totalPaginas = $derived(pagination.totalPages);
	let conductores = $derived($conductoresOptions);
	let vehiculos = $derived($vehiculosOptions);
	let clientes = $derived($clientesOptions);

	// Filtros activos (para chips removibles del FilterDrawer)
	let activeFilters = $derived([
		...(filtroEstado
			? [
					{
						key: 'estado',
						label: 'Estado',
						value: ESTADO_SERVICIO_LABELS[filtroEstado] ?? filtroEstado
					}
				]
			: []),
		...(conductorSeleccionado
			? [
					{
						key: 'conductor',
						label: 'Conductor',
						value: getOpcionLabel(conductores, conductorSeleccionado)
					}
				]
			: []),
		...(vehiculoSeleccionado
			? [
					{
						key: 'vehiculo',
						label: 'Vehículo',
						value: getOpcionLabel(vehiculos, vehiculoSeleccionado)
					}
				]
			: []),
		...(clienteSeleccionado
			? [
					{
						key: 'cliente',
						label: 'Cliente',
						value: getOpcionLabel(clientes, clienteSeleccionado)
					}
				]
			: []),
		...(filtroFechaDesde || filtroFechaHasta
			? [
					{
						key: 'fecha',
						label: 'Fechas',
						value:
							`${filtroFechaDesde || '∞'} → ${filtroFechaHasta || '∞'}` +
							(campoFecha !== 'fecha_solicitud' ? ` · ${CAMPO_FECHA_LABELS[campoFecha]}` : '')
					}
				]
			: []),
		...(ordenarPor !== 'fecha_solicitud' || ordenDireccion !== 'desc'
			? [
					{
						key: 'orden',
						label: 'Orden',
						value: `${ORDENAR_POR_LABELS[ordenarPor] ?? ordenarPor} ${ordenDireccion === 'asc' ? '↑' : '↓'}`
					}
				]
			: []),
		...(busqueda.trim()
			? [{ key: 'search', label: 'Búsqueda', value: `"${busqueda.trim()}"` }]
			: [])
	]);

	function clearFilter(key: string) {
		if (key === 'estado') {
			filtroEstado = '';
			handleEstadoChange();
		}
		if (key === 'conductor') {
			conductorSeleccionado = null;
			handleSelectChange();
		}
		if (key === 'vehiculo') {
			vehiculoSeleccionado = null;
			handleSelectChange();
		}
		if (key === 'cliente') {
			clienteSeleccionado = null;
			handleSelectChange();
		}
		if (key === 'fecha') {
			filtroFechaDesde = '';
			filtroFechaHasta = '';
			campoFecha = 'fecha_solicitud';
			handleFechaChange();
		}
		if (key === 'orden') {
			ordenarPor = 'fecha_solicitud';
			ordenDireccion = 'desc';
			handleOrdenChange();
		}
		if (key === 'search') {
			busqueda = '';
		}
	}

	/**
	 * Restaura el estado que describe la URL.
	 *
	 * Se hace UNA sola vez, al montar. Antes esto vivía en un `$effect` que
	 * reaccionaba a cada cambio de `pageState.url` — y como la propia página
	 * escribe la URL, el efecto volvía a leerla y podía pisar lo que el usuario
	 * acababa de tocar.
	 */
	function restaurarDesdeUrl() {
		if (!browser) return;
		/// Se lee de `window.location` y no de `pageState.url`: esto corre en el
		/// cuerpo del componente, durante la hidratación, y ahí `pageState` aún
		/// puede no reflejar la URL con la que se abrió la página. La del
		/// navegador siempre es la correcta y esta lectura ocurre una sola vez.
		const f = estadoUrl.leer(new URL(window.location.href));

		if (f.view === 'lista' || f.view === 'calendario' || f.view === 'canvas') {
			vistaActiva = f.view;
		}
		busqueda = f.q;
		filtroEstado = f.estado as EstadoServicio | '';
		conductorSeleccionado = f.conductor || null;
		vehiculoSeleccionado = f.vehiculo || null;
		clienteSeleccionado = f.cliente || null;
		filtroFechaDesde = f.desde;
		filtroFechaHasta = f.hasta;
		campoFecha = f.campo as typeof campoFecha;
		ordenarPor = f.orden;
		ordenDireccion = f.dir === 'asc' ? 'asc' : 'desc';
		paginaActual = Math.max(1, f.pagina);

		if (f.mes >= 1 && f.mes <= 12) calMes = f.mes - 1;
		if (f.anio >= 2020 && f.anio <= 2100) calAnio = f.anio;
		if (
			f.campo_fecha === 'fecha_solicitud' ||
			f.campo_fecha === 'fecha_realizacion' ||
			f.campo_fecha === 'fecha_finalizacion'
		) {
			calCampoFecha = f.campo_fecha as CampoFechaCal;
		}
	}

	/**
	 * Se restaura AQUÍ, en el cuerpo del componente, y no en `onMount`.
	 *
	 * Los efectos corren después del primer render pero antes de `onMount`, así
	 * que con la restauración en `onMount` el efecto que escribe la URL se
	 * adelantaba: veía los filtros vacíos y reescribía la barra de direcciones
	 * sin ellos. Abrir un enlace con `?q=algo` lo borraba antes de leerlo.
	 */
	restaurarDesdeUrl();

	/**
	 * Enlace profundo al ticket: `/dashboard/servicios?ticket=<id>` abre el
	 * modal del ticket de ese servicio. Lo usa el asistente («ábreme el ticket
	 * del servicio…»), que solo sabe navegar a rutas, y sirve igual para
	 * compartir el enlace.
	 *
	 * El parámetro se lee AQUÍ, en el cuerpo, por la misma razón que
	 * `restaurarDesdeUrl`: el efecto que escribe la URL lo borraría antes de
	 * que un `onMount` lo viera. El efecto de abajo cubre las navegaciones
	 * posteriores (el asistente pide otro ticket sin salir de la pantalla).
	 * Una vez abierto, el parámetro se quita de la barra: cerrar el modal no
	 * debe reabrirlo, ni quedar en el historial.
	 */
	let ticketPendiente = $state<string | null>(browser ? pageState.url.searchParams.get('ticket') : null);

	$effect(() => {
		const id = pageState.url.searchParams.get('ticket');
		if (id) ticketPendiente = id;
	});

	$effect(() => {
		if (!inicializado || !ticketPendiente) return;
		const id = ticketPendiente;
		ticketPendiente = null;
		void abrirTicketPorId(id);
	});

	async function abrirTicketPorId(id: string) {
		const servicio = servicios.find((s) => s.id === id) ?? (await serviciosStore.obtenerServicio(id));
		if (!servicio) {
			toast.error('No se encontró el servicio del ticket');
			return;
		}
		servicioSeleccionado = servicio;
		mostrarModalTicket = true;
		const url = new URL(pageState.url);
		if (url.searchParams.has('ticket')) {
			url.searchParams.delete('ticket');
			replaceState(url, pageState.state);
		}
	}

	function cambiarVista(vista: VistaActiva) {
		vistaActiva = vista;
		syncUrl();
		if (vista === 'canvas') {
			cargarCanvasInicial();
		}
	}

	function obtenerFirmaFiltrosCanvas() {
		return JSON.stringify({
			filtroEstado,
			busqueda: busqueda?.trim() ?? '',
			conductorSeleccionado,
			vehiculoSeleccionado,
			clienteSeleccionado,
			filtroFechaDesde,
			filtroFechaHasta,
			campoFecha,
			ordenarPor: canvasSortField,
			ordenDireccion: canvasSortDirection
		});
	}

	async function fetchCanvasPage(page: number, tokenActual: number) {
		const baseURL = import.meta.env.VITE_API_URL;
		const token = localStorage.getItem('transmeralda_token');
		const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

		const params = new URLSearchParams({ page: String(page), limit: String(CANVAS_PAGE_SIZE) });
		if (filtroEstado) params.set('estado', filtroEstado);
		if (busqueda?.trim()) params.set('search', busqueda.trim());
		if (conductorSeleccionado) params.set('conductor_id', conductorSeleccionado);
		if (vehiculoSeleccionado) params.set('vehiculo_id', vehiculoSeleccionado);
		if (clienteSeleccionado) params.set('cliente_id', clienteSeleccionado);
		if (canvasSortField) params.set('orderBy', canvasSortField);
		if (canvasSortDirection) params.set('orderDirection', canvasSortDirection);
		if (filtroFechaDesde) params.set('fecha_desde', filtroFechaDesde);
		if (filtroFechaHasta) params.set('fecha_hasta', filtroFechaHasta);
		if (filtroFechaDesde || filtroFechaHasta) params.set('campo_fecha', campoFecha);

		const res = await fetch(`${baseURL}/api/servicios?${params.toString()}`, { headers });
		if (!res.ok) throw new Error(`Error ${res.status} al cargar página ${page}`);
		const json = await res.json();
		if (!json.success) throw new Error(json.message || 'Error al cargar servicios');
		return {
			data: (json.data ?? []) as ServicioConRelaciones[],
			total: json.pagination?.total ?? 0
		};
	}

	async function cargarCanvasInicial() {
		if (!browser) return;
		const tokenActual = ++canvasFetchToken;
		const firma = obtenerFirmaFiltrosCanvas();
		canvasFirmaFiltros = firma;
		canvasServicios = [];
		canvasPage = 1;
		canvasTotal = 0;
		canvasHasMore = true;
		canvasError = null;
		canvasLoadingInicial = true;

		// Cache check: prioriza cache antes que request. Si la firma+filtro+page 1
		// ya están cacheados y frescos (TTL 60s), servimos desde cache sin request.
		const cacheKey = canvasCacheKey(firma, 1);
		const cached = canvasCacheGet(cacheKey);
		if (cached) {
			canvasServicios = [...cached.data];
			canvasTotal = cached.total;
			canvasPage = 2;
			canvasHasMore = canvasServicios.length < canvasTotal;
			canvasLoadingInicial = false;
			return;
		}

		try {
			const { data, total } = await fetchCanvasPage(1, tokenActual);
			if (tokenActual !== canvasFetchToken) return;
			canvasCachePut(canvasCacheKey(firma, 1), data, total);
			canvasServicios = data;
			canvasTotal = total;
			canvasPage = 2;
			canvasHasMore = data.length === CANVAS_PAGE_SIZE && canvasServicios.length < canvasTotal;
		} catch (error: any) {
			if (tokenActual !== canvasFetchToken) return;
			console.error('❌ Error cargando canvas inicial:', error);
			canvasError = error.message || 'Error desconocido';
			toast.error('Error al cargar el canvas: ' + canvasError);
		} finally {
			if (tokenActual === canvasFetchToken) {
				canvasLoadingInicial = false;
			}
		}
	}

	async function cargarMasCanvas() {
		if (!browser) return;
		if (canvasCargandoMas || canvasLoadingInicial || !canvasHasMore) return;

		const firma = canvasFirmaFiltros || obtenerFirmaFiltrosCanvas();
		const cacheKey = canvasCacheKey(firma, canvasPage);

		// Cache check + dedupe de requests concurrentes.
		const cached = canvasCacheGet(cacheKey);
		if (cached) {
			const existentes = new Set(canvasServicios.map((s) => s.id));
			const nuevos = cached.data.filter((s) => !existentes.has(s.id));
			if (nuevos.length > 0) canvasServicios = [...canvasServicios, ...nuevos];
			canvasTotal = cached.total || canvasTotal;
			canvasPage += 1;
			canvasHasMore = canvasServicios.length < canvasTotal;
			return;
		}

		if (canvasInflight.has(cacheKey)) return;
		canvasInflight.add(cacheKey);

		const tokenActual = canvasFetchToken;
		canvasCargandoMas = true;
		canvasError = null;

		try {
			const { data, total } = await fetchCanvasPage(canvasPage, tokenActual);
			if (tokenActual !== canvasFetchToken) return;

			canvasCachePut(cacheKey, data, total);
			const existentes = new Set(canvasServicios.map((s) => s.id));
			const nuevos = data.filter((s) => !existentes.has(s.id));
			canvasServicios = [...canvasServicios, ...nuevos];
			canvasTotal = total || canvasTotal;
			canvasPage += 1;
			canvasHasMore = nuevos.length === CANVAS_PAGE_SIZE && canvasServicios.length < canvasTotal;
		} catch (error: any) {
			if (tokenActual !== canvasFetchToken) return;
			console.error('❌ Error cargando más servicios:', error);
			canvasError = error.message || 'Error desconocido';
			toast.error('Error al cargar más servicios: ' + canvasError);
		} finally {
			canvasInflight.delete(cacheKey);
			if (tokenActual === canvasFetchToken) {
				canvasCargandoMas = false;
			}
		}
	}

	/**
	 * Estado actual de la página como conjunto de filtros.
	 *
	 * Antes solo llegaban a la URL `view`, `mes`, `anio` y `campo_fecha`: el
	 * resto —búsqueda, estado, conductor, vehículo, cliente, rango de fechas,
	 * orden y página— se quedaba en memoria, así que una vista filtrada no se
	 * podía compartir ni sobrevivía a una recarga.
	 */
	const filtrosActuales = $derived<FiltrosServicios>({
		view: vistaActiva,
		q: busqueda,
		estado: filtroEstado,
		conductor: conductorSeleccionado ?? '',
		vehiculo: vehiculoSeleccionado ?? '',
		cliente: clienteSeleccionado ?? '',
		desde: filtroFechaDesde,
		hasta: filtroFechaHasta,
		campo: campoFecha,
		orden: ordenarPor,
		dir: ordenDireccion,
		pagina: paginaActual,
		mes: calMes + 1,
		anio: calAnio,
		campo_fecha: calCampoFecha
	});

	/// Un único punto de escritura. `syncUrl()` se conserva como nombre porque
	/// lo llaman una docena de sitios del marcado.
	function syncUrl() {
		if (!browser) return;
		/// La URL actual se lee con `untrack` a propósito: sin él, este efecto
		/// dependería de `pageState.url` — que él mismo acaba de escribir— y se
		/// reejecutaría en cada navegación, provocando un render de más
		/// mientras el usuario todavía está escribiendo en el buscador.
		untrack(() => estadoUrl.escribir(pageState.url, filtrosActuales));
	}

	$effect(() => {
		void filtrosActuales;
		syncUrl();
	});

	function onCalMesAnioChange(nuevoMes: number, nuevoAnio: number) {
		calMes = nuevoMes;
		calAnio = nuevoAnio;
		syncUrl();
	}

	function onCalCampoFechaChange(campo: CampoFechaCal) {
		calCampoFecha = campo;
		syncUrl();
	}

	/**
	 * Handler del sort por columna del canvas.
	 * - Si la columna clickeada es la misma → invierte la dirección (toggle).
	 * - Si es otra columna → adopta esa columna con dirección default.
	 *   Para columnas de fecha/numérico/strings, `desc` arranca con
	 *   "mayor/más reciente primero" (consistente con el default del endpoint).
	 *
	 * Importante: cambiar sort NO reduce el total ni el count cargado.
	 * Solo invierte el orden de los mismos N servicios ya en memoria + re-pide
	 * la página 1 al backend. El footer sigue mostrando `N/Total` (mismo N).
	 */
	async function handleCanvasSort(field: string, direction: 'asc' | 'desc') {
		if (canvasSortField === field && canvasSortDirection === direction) return;
		canvasSortField = field;
		canvasSortDirection = direction;
		// Invalidar cache: nueva firma de filtros → nuevas keys
		canvasCacheInvalidate();
		await cargarCanvasInicial();
	}

	async function cargarServicios(forceRefresh = false) {
		const params: any = {
			page: paginaActual,
			limit: itemsPorPagina,
			orderBy: ordenarPor,
			orderDirection: ordenDireccion
		};
		if (filtroEstado) params.estado = filtroEstado;
		if (busqueda?.trim()) params.search = busqueda.trim();
		if (conductorSeleccionado) params.conductor_id = conductorSeleccionado;
		if (vehiculoSeleccionado) params.vehiculo_id = vehiculoSeleccionado;
		if (clienteSeleccionado) params.cliente_id = clienteSeleccionado;
		if (filtroFechaDesde) params.fecha_desde = filtroFechaDesde;
		if (filtroFechaHasta) params.fecha_hasta = filtroFechaHasta;
		if (filtroFechaDesde || filtroFechaHasta) params.campo_fecha = campoFecha;
		await serviciosStore.obtenerServicios(params, forceRefresh);
	}

	function handleBusquedaChange() {
		if (!inicializado) return;
		clearTimeout(busquedaTimeout);
		busquedaTimeout = setTimeout(() => {
			paginaActual = 1;
			cargarServicios();
		}, 500);
	}

	$effect(() => {
		if (inicializado && busqueda !== undefined) handleBusquedaChange();
	});

	function handleEstadoChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleSelectChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleFechaChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleOrdenChange() {
		if (!inicializado) return;
		cargarServicios();
	}

	$effect(() => {
		if (inicializado && vistaActiva === 'canvas') {
			const firma = obtenerFirmaFiltrosCanvas();
			if (firma !== canvasFirmaFiltros && !canvasLoadingInicial) {
				cargarCanvasInicial();
			}
		}
	});

	async function irPagina(pagina: number) {
		if (pagina >= 1 && pagina <= totalPaginas) {
			paginaActual = pagina;
			await cargarServicios();
		}
	}

	onMount(async () => {
		await serviciosStore.inicializar();
		await recursos.cargarTodos();
		inicializado = true;
		await cargarServicios();

		if (vistaActiva === 'canvas') cargarCanvasInicial();

		/**
		 * El caché del canvas también tiene que enterarse de los cambios.
		 *
		 * `serviciosStore` parchea SU lista cuando llega un evento, pero el
		 * canvas mantiene su propia copia con un TTL de 60 s y nadie la
		 * invalidaba: durante hasta un minuto el canvas mostraba un servicio ya
		 * cancelado, o no mostraba uno recién creado, mientras la vista de lista
		 * —la misma pantalla— ya estaba al día.
		 */
		const alCambiarUnServicio = () => {
			canvasCacheInvalidate();
			if (vistaActiva === 'canvas') cargarCanvasInicial();
		};

		bajasSocket = [
			socketUtils.on('servicio:creado', alCambiarUnServicio),
			socketUtils.on('servicio:actualizado', alCambiarUnServicio),
			socketUtils.on('servicio:estado-actualizado', alCambiarUnServicio),
			socketUtils.on('servicio:cancelado', alCambiarUnServicio),
			socketUtils.on('servicio:eliminado', alCambiarUnServicio)
		];
	});

	let bajasSocket: Array<() => void> = [];

	onDestroy(() => {
		for (const baja of bajasSocket) baja();
		bajasSocket = [];
		serviciosStore.limpiarSocket();
	});

	function verDetalle(id: string) {
		goto(`/dashboard/servicios/${id}`);
	}

	async function limpiarFiltros() {
		filtroEstado = '';
		busqueda = '';
		conductorSeleccionado = null;
		vehiculoSeleccionado = null;
		clienteSeleccionado = null;
		filtroFechaDesde = '';
		filtroFechaHasta = '';
		campoFecha = 'fecha_solicitud';
		ordenarPor = 'fecha_solicitud';
		ordenDireccion = 'desc';
		paginaActual = 1;
		await serviciosStore.obtenerStats();
		await cargarServicios(true);
	}

	function handleNuevoServicio() {
		servicioEditar = null;
		mostrarModalFormServicio = true;
	}
	function handleEditarServicio(servicio: ServicioConRelaciones) {
		servicioEditar = servicio;
		mostrarModalFormServicio = true;
	}
	function handleModalFormClose() {
		mostrarModalFormServicio = false;
		servicioEditar = null;
	}
	async function handleModalFormSuccess() {
		mostrarModalFormServicio = false;
		servicioEditar = null;
		await serviciosStore.obtenerServicios({}, true);
	}

	function cambiarFiltroEstado(estado: EstadoServicio) {
		filtroEstado = estado;
		paginaActual = 1;
		cargarServicios();
	}

	async function handleCompartirServicio(servicio: ServicioConRelaciones) {
		try {
			let token = servicio.share_token;
			if (!token) {
				token = (await serviciosStore.generarShareToken(servicio.id)) ?? undefined;
				if (!token) {
					alert('Error al generar enlace compartible');
					return;
				}
			}
			const shareUrl = `${window.location.origin}/public/servicio/${token}`;
			await navigator.clipboard.writeText(shareUrl);
			alert('✅ Enlace copiado al portapapeles!\n\n' + shareUrl);
		} catch (error) {
			console.error('Error compartiendo servicio:', error);
			alert('Error al compartir servicio');
		}
	}

	function handleEliminarServicio(servicio: ServicioConRelaciones) {
		servicioAEliminar = servicio;
		mostrarModalConfirm = true;
	}

	async function confirmarEliminacion() {
		if (!servicioAEliminar) return;
		try {
			await serviciosStore.eliminar(servicioAEliminar.id);
			mostrarModalConfirm = false;
			servicioAEliminar = null;
			await cargarServicios(true);
			toast.success('Servicio eliminado exitosamente');
		} catch (error: any) {
			toast.error('Error al eliminar servicio: ' + (error.message || 'Error desconocido'));
		}
	}

	function cancelarEliminacion() {
		mostrarModalConfirm = false;
		servicioAEliminar = null;
	}

	async function handleDescargarRutograma(servicio: ServicioConRelaciones) {
		try {
			const token = localStorage.getItem('transmeralda_token');
			const baseURL = import.meta.env.VITE_API_URL;
			const response = await fetch(`${baseURL}/api/servicios/${servicio.id}/rutograma`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				throw new Error(errorData?.message || `Error ${response.status}`);
			}
			const blob = await response.blob();
			const blobUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = `rutograma-${servicio.origen_especifico || 'servicio'}-${servicio.destino_especifico || ''}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(blobUrl);
			toast.success('Rutograma descargado exitosamente');
		} catch (error: any) {
			toast.error('Error al descargar rutograma: ' + (error.message || 'Error desconocido'));
		}
	}

	/// «12 oct · 08:00»; el año solo cuando no es el actual. Las tres fechas de
	/// un servicio van apiladas en una misma celda y el año repetido tres veces
	/// era la mitad del ancho.
	function fechaCorta(fecha: string | Date): string {
		const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
		if (Number.isNaN(d.getTime())) return '—';
		const mismoAnio = d.getFullYear() === new Date().getFullYear();
		const dia = new Intl.DateTimeFormat('es-CO', {
			day: 'numeric',
			month: 'short',
			...(mismoAnio ? {} : { year: '2-digit' })
		})
			.format(d)
			.replace('.', '');
		const hora = new Intl.DateTimeFormat('es-CO', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(d);
		return `${dia} · ${hora}`;
	}

	// ── Cáscara de listado: conteos, vistas y menú de acciones ──────────
	const ESTADOS_RESUMEN = ['solicitado', 'planificado', 'en_curso', 'realizado', 'cancelado'] as const;
	const ETIQUETA_RESUMEN: Record<(typeof ESTADOS_RESUMEN)[number], string> = {
		solicitado: 'Solicitados',
		planificado: 'Planificados',
		en_curso: 'En curso',
		realizado: 'Realizados',
		cancelado: 'Cancelados'
	};
	const VISTAS: { id: VistaActiva; etiqueta: string; icono: typeof List }[] = [
		{ id: 'lista', etiqueta: 'Lista', icono: List },
		{ id: 'canvas', etiqueta: 'Excel', icono: Table2 },
		{ id: 'calendario', etiqueta: 'Calendario', icono: CalendarDays }
	];

	/** Pulsar un conteo filtra por ese estado; pulsar el activo (o «Servicios») lo quita. */
	function elegirEstadoResumen(clave: string) {
		filtroEstado = !clave || filtroEstado === clave ? '' : (clave as EstadoServicio);
		paginaActual = 1;
		cargarServicios();
	}

	const origenDe = (s: ServicioConRelaciones) =>
		s.origen_especifico || s.origen?.nombre_municipio || 'Sin origen';
	const destinoDe = (s: ServicioConRelaciones) =>
		s.destino_especifico || s.destino?.nombre_municipio || 'Sin destino';

	/// Las mismas seis acciones que antes eran iconos sueltos en la fila.
	function accionesDeServicio(servicio: ServicioConRelaciones): AccionMenu[] {
		return [
			{ id: 'ver', etiqueta: 'Ver detalle', icono: Eye, tono: 'ver', destacada: true, onSelect: () => verDetalle(servicio.id) },
			...(puedeEditar
				? [{ id: 'editar', etiqueta: 'Editar', icono: Pencil, tono: 'editar' as const, destacada: true, onSelect: () => handleEditarServicio(servicio) }]
				: []),
			{
				id: 'ticket',
				etiqueta: 'Ticket',
				icono: Ticket,
				onSelect: () => {
					servicioSeleccionado = servicio;
					mostrarModalTicket = true;
				}
			},
			{ id: 'rutograma', etiqueta: 'Rutograma PDF', icono: MapIcon, onSelect: () => handleDescargarRutograma(servicio) },
			{ id: 'compartir', etiqueta: 'Compartir enlace', icono: Share2, onSelect: () => handleCompartirServicio(servicio) },
			...(puedeEditar
				? [{ id: 'eliminar', etiqueta: 'Eliminar', icono: Trash2, tono: 'eliminar' as const, destacada: true, separadorAntes: true, onSelect: () => handleEliminarServicio(servicio) }]
				: [])
		];
	}
</script>

<svelte:head>
	<title>Servicios - Cotransmeq</title>
</svelte:head>

<!-- Cáscara de los listados (`dir-*` de app.css), la misma de liquidaciones de
     servicios, extractos y los directorios: una cabecera con los conteos, las
     pestañas de vista, la barra de búsqueda y la tabla que pasa a tarjetas
     cuando su contenedor es angosto. -->
<div class="dir-pagina srv-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Gestión de servicios</h1>
			<p class="dir-desc">Administra y monitorea todos los servicios de transporte.</p>
			{#if stats}
				<div class="dir-conteos">
					<!-- Cada estado filtra la lista; pulsar el activo lo quita. -->
					<ResumenConteos
						conteos={[
							{ clave: '', etiqueta: 'Servicios', valor: stats.total },
							...ESTADOS_RESUMEN.map((e) => ({
								clave: e,
								etiqueta: ETIQUETA_RESUMEN[e],
								valor: stats?.[e] ?? 0,
								color: getEstadoColor(e)
							}))
						]}
						activo={filtroEstado || null}
						onElegir={elegirEstadoResumen}
					/>
				</div>
			{/if}
		</div>

		<div class="dir-cabecera-acciones">
			{#if puedeEditar}
				<button data-tour="srv-btn-nuevo" onclick={handleNuevoServicio} class="btn-primary">
					<Plus class="h-4 w-4" />
					Nuevo servicio
				</button>
			{/if}
		</div>
	</header>

	<!-- Pestañas con la forma de `TabsVista`, como en liquidaciones. -->
	<div class="srv-tabs" role="tablist" aria-label="Vistas de servicios">
		{#each VISTAS as v (v.id)}
			{@const Icono = v.icono}
			<button
				type="button"
				role="tab"
				class="srv-tab"
				class:activa={vistaActiva === v.id}
				aria-selected={vistaActiva === v.id}
				onclick={() => cambiarVista(v.id)}
			>
				<Icono class="h-3.5 w-3.5" />
				{v.etiqueta}
			</button>
		{/each}
	</div>

	<!-- Búsqueda y filtros: sirven a las tres vistas. -->
	<div class="dir-filtros">
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={busqueda}
				onBuscar={() => {}}
				placeholder="#solicitud, placa, conductor, municipio de origen o destino…"
				etiqueta="Buscar servicios"
			/>
		</div>
		<button
			type="button"
			class="btn-secondary srv-btn-filtros"
			class:srv-btn-filtros--activo={mostrarFiltros || activeFilters.length > 0}
			onclick={() => (mostrarFiltros = !mostrarFiltros)}
		>
			<SlidersHorizontal class="h-4 w-4" />
			Filtros
			{#if activeFilters.length > 0}
				<span class="srv-contador">{activeFilters.length}</span>
			{/if}
		</button>
		{#if activeFilters.length > 0}
			<button type="button" class="btn-secondary" onclick={limpiarFiltros}>
				<X class="h-3.5 w-3.5" />
				Limpiar
			</button>
		{/if}
	</div>

	<!-- Panel de filtros (drawer lateral) — renderizado fuera del .glass card
	     para que position:fixed no quede atrapado por el backdrop-filter -->
	<FilterDrawer
		open={mostrarFiltros}
		onClose={() => (mostrarFiltros = false)}
		eyebrow="Filtros"
		title="Refinar resultados"
		subtitle="Filtra los servicios por estado, recurso o rango de fechas."
		activeCount={activeFilters.length}
	>
		<div slot="chips" class="flex flex-wrap gap-1.5">
			{#each activeFilters as chip, i (chip.key)}
				<span class="chip-pop-in" style="animation-delay: {i * 60}ms">
					<button class="filter-chip" onclick={() => clearFilter(chip.key)}>
						<span style="color: var(--text-muted); font-weight: 500;">{chip.label}:</span>
						<span>{chip.value}</span>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
							><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
						>
					</button>
				</span>
			{/each}
		</div>

		<div class="flex flex-col gap-5">
			<div class="filter-field">
				<label for="filtro-estado" class="filter-field-label">
					Estado del servicio
					{#if filtroEstado}<span class="filter-field-label-hint">filtrado</span>{/if}
				</label>
				<select id="filtro-estado" bind:value={filtroEstado} onchange={handleEstadoChange}>
					<option value="">Todos los estados</option>
					<option value="solicitado">Solicitado</option>
					<option value="en_curso">En Curso</option>
					<option value="planificado">Planificado</option>
					<option value="realizado">Realizado</option>
					<option value="cancelado">Cancelado</option>
					<option value="liquidado">Liquidado</option>
				</select>
			</div>

			<div class="filter-field">
				<label for="filtro-conductor" class="filter-field-label">
					Conductor
					{#if conductorSeleccionado}<span class="filter-field-label-hint">filtrado</span>{/if}
				</label>
				<SelectBuscable
					opciones={conductores}
					valor={conductorSeleccionado}
					placeholder="Todos los conductores"
					placeholderBusqueda="Buscar conductor por nombre o cédula…"
					onSeleccionar={(v) => {
						conductorSeleccionado = v;
						handleSelectChange();
					}}
				/>
			</div>

			<div class="filter-field">
				<label for="filtro-vehiculo" class="filter-field-label">
					Vehículo
					{#if vehiculoSeleccionado}<span class="filter-field-label-hint">filtrado</span>{/if}
				</label>
				<SelectBuscable
					opciones={vehiculos}
					valor={vehiculoSeleccionado}
					placeholder="Todos los vehículos"
					placeholderBusqueda="Buscar vehículo por placa o marca…"
					icono="truck"
					onSeleccionar={(v) => {
						vehiculoSeleccionado = v;
						handleSelectChange();
					}}
				/>
			</div>

			<div class="filter-field">
				<label for="filtro-cliente" class="filter-field-label">
					Cliente
					{#if clienteSeleccionado}<span class="filter-field-label-hint">filtrado</span>{/if}
				</label>
				<SelectBuscable
					opciones={clientes}
					valor={clienteSeleccionado}
					placeholder="Todos los clientes"
					placeholderBusqueda="Buscar cliente por nombre o NIT…"
					icono="building"
					onSeleccionar={(v) => {
						clienteSeleccionado = v;
						handleSelectChange();
					}}
				/>
			</div>

			<div class="h-px w-full" style="background-color: var(--border-subtle);"></div>

			<div class="filter-field">
				<label for="filtro-campo-fecha" class="filter-field-label">
					Tipo de fecha
					{#if campoFecha !== 'fecha_solicitud'}<span class="filter-field-label-hint">filtrado</span
						>{/if}
				</label>
				<select id="filtro-campo-fecha" bind:value={campoFecha} onchange={handleFechaChange}>
					<option value="fecha_solicitud">Fecha de solicitud</option>
					<option value="created_at">Fecha de creación</option>
					<option value="fecha_realizacion">Fecha de realización</option>
					<option value="fecha_finalizacion">Fecha de finalización</option>
				</select>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="filter-field">
					<label for="filtro-fecha-desde" class="filter-field-label">
						Desde
						{#if filtroFechaDesde}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-fecha-desde"
						type="date"
						bind:value={filtroFechaDesde}
						onchange={handleFechaChange}
					/>
				</div>
				<div class="filter-field">
					<label for="filtro-fecha-hasta" class="filter-field-label">
						Hasta
						{#if filtroFechaHasta}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-fecha-hasta"
						type="date"
						bind:value={filtroFechaHasta}
						onchange={handleFechaChange}
					/>
				</div>
			</div>

			<div class="h-px w-full" style="background-color: var(--border-subtle);"></div>

			<div class="grid grid-cols-2 gap-3">
				<div class="filter-field">
					<label for="filtro-ordenar-por" class="filter-field-label">
						Ordenar por
						{#if ordenarPor !== 'fecha_solicitud'}<span class="filter-field-label-hint"
								>filtrado</span
							>{/if}
					</label>
					<select id="filtro-ordenar-por" bind:value={ordenarPor} onchange={handleOrdenChange}>
						<option value="fecha_solicitud">Fecha solicitud</option>
						<option value="fecha_realizacion">Fecha realización</option>
						<option value="estado">Estado</option>
						<option value="cliente">Cliente</option>
						<option value="conductor">Conductor</option>
					</select>
				</div>
				<div class="filter-field">
					<label for="filtro-orden-direccion" class="filter-field-label">
						Dirección
						{#if ordenDireccion !== 'desc'}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select
						id="filtro-orden-direccion"
						bind:value={ordenDireccion}
						onchange={handleOrdenChange}
					>
						<option value="asc">Ascendente</option>
						<option value="desc">Descendente</option>
					</select>
				</div>
			</div>
		</div>

		<div slot="footer">
			<button class="filter-clear" onclick={limpiarFiltros} disabled={activeFilters.length === 0}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
					><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
				>
				Limpiar
			</button>
			<button class="btn-primary" onclick={() => (mostrarFiltros = false)}>
				Ver resultados
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
					><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" /></svg
				>
			</button>
		</div>
	</FilterDrawer>

	{#if vistaActiva === 'lista'}
		<div class="srv-marco" in:fly={{ y: 12, duration: 400, delay: 60 }}>
			{#if loading}
				<CargaMascota texto="Cargando servicios…" />
			{:else if servicios.length === 0}
				{@const filtrado = activeFilters.length > 0}
				<div class="dir-vacio">
					<img src={mascota(filtrado ? 'vacio' : 'exito').src} alt="" width="418" height="418" />
					<h3>{filtrado ? 'Sin resultados' : 'Todavía no hay servicios'}</h3>
					<p>
						{filtrado
							? 'Ningún servicio coincide con estos filtros.'
							: 'Los servicios aparecen aquí con su ruta, su conductor y sus fechas.'}
					</p>
					{#if filtrado}
						<button type="button" class="btn-secondary" onclick={limpiarFiltros}>
							Limpiar filtros
						</button>
					{:else if puedeEditar}
						<button onclick={handleNuevoServicio} class="btn-primary">
							<Plus class="h-4 w-4" />
							Nuevo servicio
						</button>
					{/if}
				</div>
			{:else}
				<!-- ═══ Tabla, o tarjetas si el contenedor es angosto (ver `.srv-marco`) ═══ -->
				<div class="srv-scroll srv-vista-tabla">
					<table class="srv-tabla" style="min-width: 1040px">
						<thead>
							<tr>
								<th style="min-width: 210px">Ruta</th>
								<th style="min-width: 120px">Estado</th>
								<th style="min-width: 170px">Cliente</th>
								<th style="min-width: 190px">Conductor · vehículo</th>
								<th style="min-width: 150px">Servicio</th>
								<th style="min-width: 200px">Fechas</th>
								<th style="width: 64px"></th>
							</tr>
						</thead>
						<tbody>
							{#each servicios as servicio, index (servicio?.id || `temp-${index}`)}
								<tr>
									<td>
										<div class="srv-ruta">
											<span class="srv-ruta-origen" title={origenDe(servicio)}>{origenDe(servicio)}</span>
											<span class="srv-ruta-destino" title={destinoDe(servicio)}>
												<ArrowDown class="h-3 w-3" />
												{destinoDe(servicio)}
											</span>
										</div>
									</td>
									<td>
										<div class="srv-estado">
											<EstadoPunto
												etiqueta={getEstadoText(servicio.estado)}
												color={getEstadoColor(servicio.estado)}
												apagado={servicio.estado === 'cancelado'}
											/>
											{#if servicio.ejecucion?.iniciado_at}
												<span
													class="srv-app"
													title={servicio.ejecucion.liberado_at
														? 'Iniciado y liberado por el conductor desde la app'
														: 'Iniciado por el conductor desde la app'}
												>
													<Smartphone class="h-3 w-3" />
													{servicio.ejecucion.liberado_at ? 'Liberado' : 'Iniciado'}
												</span>
											{/if}
										</div>
									</td>
									<td>
										<div class="dir-celda">
											<span class="srv-texto" title={servicio.cliente?.nombre || ''}
												>{servicio.cliente?.nombre || 'Sin cliente'}</span
											>
											{#if servicio.cliente?.nit}<small>NIT {servicio.cliente.nit}</small>{/if}
										</div>
									</td>
									<td>
										<div class="dir-celda">
											{#if servicio.conductor}
												<span
													class="srv-texto"
													title="{servicio.conductor.nombre} {servicio.conductor.apellido}"
													>{servicio.conductor.nombre} {servicio.conductor.apellido}</span
												>
											{:else}
												<span class="dir-nulo">Sin conductor</span>
											{/if}
											{#if servicio.vehiculo}
												<small class="srv-vehiculo">
													<span class="srv-placa">{servicio.vehiculo.placa}</span>
													{[servicio.vehiculo.marca, servicio.vehiculo.modelo]
														.filter(Boolean)
														.join(' ')}
												</small>
											{:else}
												<small class="dir-nulo">Sin vehículo</small>
											{/if}
										</div>
									</td>
									<td>
										<div class="dir-celda">
											<span>{labelPropositoServicio(servicio.proposito_servicio)}</span>
											<small class="srv-mono"
												>{servicio.numero_planilla
													? `Planilla ${servicio.numero_planilla}`
													: 'Sin planilla'}</small
											>
										</div>
									</td>
									<td class="srv-nowrap">
										{@render lineaFechas(servicio)}
									</td>
									<td class="srv-acciones">
										<AccionesDropdown
											etiqueta="Acciones del servicio {origenDe(servicio)}"
											acciones={accionesDeServicio(servicio)}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- ═══ Tarjetas: una por servicio ═══ -->
				<ul class="srv-tarjetas srv-vista-tarjetas">
					{#each servicios as servicio, index (servicio?.id || `temp-${index}`)}
						<li class="srv-tarjeta">
							<div class="srv-tarjeta-cabeza">
								<div class="srv-ruta">
									<span class="srv-ruta-origen">{origenDe(servicio)}</span>
									<span class="srv-ruta-destino">
										<ArrowDown class="h-3 w-3" />
										{destinoDe(servicio)}
									</span>
								</div>
								<AccionesDropdown
									etiqueta="Acciones del servicio {origenDe(servicio)}"
									acciones={accionesDeServicio(servicio)}
								/>
							</div>
							<div class="srv-estado srv-tarjeta-estado">
								<EstadoPunto
									etiqueta={getEstadoText(servicio.estado)}
									color={getEstadoColor(servicio.estado)}
									apagado={servicio.estado === 'cancelado'}
								/>
								{#if servicio.ejecucion?.iniciado_at}
									<span class="srv-app">
										<Smartphone class="h-3 w-3" />
										{servicio.ejecucion.liberado_at ? 'Liberado' : 'Iniciado'}
									</span>
								{/if}
							</div>
							<dl class="srv-tarjeta-datos">
								<div>
									<dt>Cliente</dt>
									<dd>{servicio.cliente?.nombre || 'Sin cliente'}</dd>
								</div>
								<div>
									<dt>Conductor</dt>
									<dd>
										{servicio.conductor
											? `${servicio.conductor.nombre} ${servicio.conductor.apellido}`
											: 'Sin conductor'}
									</dd>
								</div>
								<div>
									<dt>Vehículo</dt>
									<dd class="srv-mono">{servicio.vehiculo?.placa ?? '—'}</dd>
								</div>
								<div>
									<dt>Servicio</dt>
									<dd>{labelPropositoServicio(servicio.proposito_servicio)}</dd>
								</div>
								<div>
									<dt>Planilla</dt>
									<dd class="srv-mono">{servicio.numero_planilla || '—'}</dd>
								</div>
								<div>
									<dt>Fechas</dt>
									<dd>{@render lineaFechas(servicio)}</dd>
								</div>
							</dl>
						</li>
					{/each}
				</ul>

				<div class="srv-pie">
					<PaginadorLista
						pagina={pagination.page}
						total={pagination.total}
						porPagina={pagination.limit}
						cargando={loading}
						nombreItems="servicios"
						onCambiar={irPagina}
					/>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet lineaFechas(servicio: ServicioConRelaciones)}
		<!-- Solicitud → realización → finalización, con lo pendiente en hueco. -->
		<ol class="srv-fechas">
			{#each [{ etiqueta: 'Solicitud', valor: servicio.fecha_solicitud }, { etiqueta: 'Realización', valor: servicio.fecha_realizacion }, { etiqueta: 'Finalización', valor: servicio.fecha_finalizacion }] as f (f.etiqueta)}
				<li class="srv-fecha" class:srv-fecha--pendiente={!f.valor}>
					<span class="srv-fecha-punto" aria-hidden="true"></span>
					<span class="srv-fecha-etiqueta">{f.etiqueta}</span>
					<span class="srv-fecha-valor">{f.valor ? fechaCorta(f.valor) : 'Pendiente'}</span>
				</li>
			{/each}
		</ol>
	{/snippet}

<!-- ═══════════════════════════════════════════
	     CALENDARIO — vista alternativa
	     ═══════════════════════════════════════════ -->
	{#if vistaActiva === 'calendario'}
		<div in:fly={{ y: 12, duration: 350 }}>
			<CalendarServicio
				bind:mes={calMes}
				bind:anio={calAnio}
				bind:campoFecha={calCampoFecha}
				filtros={{
					estado: filtroEstado,
					conductorId: conductorSeleccionado || undefined,
					vehiculoId: vehiculoSeleccionado || undefined,
					clienteId: clienteSeleccionado || undefined
				}}
				onMesAnioChange={onCalMesAnioChange}
				onCampoFechaChange={onCalCampoFechaChange}
				coincide={busqueda.trim() ? (s) => servicioMatch(s, busqueda.trim()) : undefined}
				{puedeEditar}
				onEditar={handleEditarServicio}
				onEliminar={handleEliminarServicio}
			/>
		</div>
	{/if}

	<!-- ═══════════════════════════════════════════
	     CANVAS — vista readonly tipo spreadsheet
	     ═══════════════════════════════════════════ -->
	{#if vistaActiva === 'canvas'}
		<CanvasServicios
			servicios={canvasServiciosVisibles}
			loadingInicial={canvasLoadingInicial}
			cargandoMas={canvasCargandoMas}
			hasMore={canvasHasMore}
			totalGeneral={canvasTotal}
			sortField={canvasSortField}
			sortDirection={canvasSortDirection}
			onRefresh={cargarCanvasInicial}
			onLoadMore={cargarMasCanvas}
			onSort={handleCanvasSort}
		/>
	{/if}
</div>

<!-- Modales -->
{#if mostrarModalTicket && servicioSeleccionado}
	<ModalTicket
		servicio={servicioSeleccionado}
		onClose={() => {
			mostrarModalTicket = false;
			servicioSeleccionado = null;
		}}
	/>
{/if}

{#if mostrarModalFormServicio}
	<ModalFormServicio
		isOpen={mostrarModalFormServicio}
		servicio={servicioEditar}
		onClose={handleModalFormClose}
		onSuccess={handleModalFormSuccess}
	/>
{/if}

{#if servicioAEliminar}
	<ModalConfirm
		isOpen={mostrarModalConfirm}
		title="¿Eliminar servicio?"
		message={`¿Estás seguro de que deseas eliminar el servicio de ${servicioAEliminar.cliente?.nombre || 'N/A'} (${servicioAEliminar.origen_especifico || servicioAEliminar.origen?.nombre_municipio || 'N/A'} → ${servicioAEliminar.destino_especifico || servicioAEliminar.destino?.nombre_municipio || 'N/A'})? Esta acción no se puede deshacer.`}
		confirmText="Eliminar"
		cancelText="Cancelar"
		type="danger"
		on:confirm={confirmarEliminacion}
		on:cancel={cancelarEliminacion}
	/>
{/if}

<style>
	/* ── Cáscara: la de liquidaciones de servicios y los directorios (`dir-*` de app.css) ── */
	.srv-pagina {
		height: auto;
		min-height: 100%;
	}

	/* ── Pestañas: la forma de `TabsVista` (variante clara) ── */
	.srv-tabs {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1.5px solid var(--border-default);
		flex-shrink: 0;
	}
	.srv-tabs::-webkit-scrollbar {
		display: none;
	}
	.srv-tab {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: -1.5px;
		padding: 10px 14px;
		border: 1.5px solid transparent;
		border-bottom: 0;
		border-radius: 12px 12px 0 0;
		background: transparent;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.srv-tab:hover {
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.srv-tab.activa {
		background: var(--bg-surface);
		border-color: var(--border-default);
		color: var(--bg-charcoal-deep);
		box-shadow: inset 0 3px 0 var(--accion);
	}
	.srv-tab:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: -2px;
	}

	/* ── Barra de filtros ── */
	.srv-btn-filtros--activo {
		border-color: var(--accion);
		color: var(--text-primary);
	}
	.srv-contador {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		background: var(--accion);
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	/* ── Tabla: los mismos tokens que `TablaLista` y liquidaciones ── */
	/* Tabla o tarjetas según el ancho del PROPIO contenedor, no de la ventana. */
	.srv-marco {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 22px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}
	.srv-scroll {
		overflow-x: auto;
	}
	.srv-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.srv-tabla thead th {
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 0.7rem 1.1rem;
		background: var(--bg-base);
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
		white-space: nowrap;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.srv-tabla tbody tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background-color 0.15s;
	}
	.srv-tabla tbody tr:last-child {
		border-bottom: 0;
	}
	.srv-tabla tbody tr:hover {
		background: color-mix(in srgb, var(--text-primary) 2.5%, transparent);
	}
	.srv-tabla td {
		height: 64px;
		padding: 0.6rem 1.1rem;
		vertical-align: middle;
		color: var(--text-primary);
	}
	.srv-acciones {
		width: 1%;
		text-align: right;
		white-space: nowrap;
	}
	.srv-nowrap {
		white-space: nowrap;
	}

	/* ── Contenido de las celdas ── */
	.srv-ruta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 16rem;
	}
	.srv-ruta-origen {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 800;
		color: var(--text-primary);
	}
	.srv-ruta-destino {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.srv-ruta-destino :global(svg) {
		flex-shrink: 0;
		color: var(--text-very-muted);
	}
	.srv-estado {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	.srv-app {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--accion) 30%, transparent);
		background: color-mix(in srgb, var(--accion) 8%, transparent);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.srv-texto {
		display: block;
		max-width: 15rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.srv-vehiculo {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.srv-placa {
		padding: 0 5px;
		border-radius: 5px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--text-primary);
	}
	.srv-mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.01em;
	}

	.srv-vista-tarjetas {
		display: none;
	}
	@container (max-width: 1000px) {
		.srv-vista-tabla {
			display: none;
		}
		.srv-vista-tarjetas {
			display: flex;
		}
	}

	/* ── Tarjetas ── */
	.srv-tarjetas {
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.srv-tarjeta {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.srv-tarjeta-cabeza {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.srv-tarjeta-estado {
		flex-direction: row;
		align-items: center;
		margin: 0.35rem 0 0.6rem;
	}
	.srv-tarjeta-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 0.4rem 1rem;
		margin: 0;
	}
	.srv-tarjeta-datos dt {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-very-muted);
	}
	.srv-tarjeta-datos dd {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.srv-pie {
		border-top: 1px solid var(--border-subtle);
	}

	/* ═══ Fechas del servicio: línea de tiempo vertical en la celda ═══ */
	.srv-fechas {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.srv-fecha {
		position: relative;
		display: grid;
		grid-template-columns: 8px 4.9rem auto;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		line-height: 16px;
	}
	/* El trazo que une cada punto con el siguiente. */
	.srv-fecha:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 3px;
		top: 12px;
		height: 10px;
		width: 2px;
		border-radius: 1px;
		background: var(--border-default, #dee7e3);
	}
	.srv-fecha-punto {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--emerald-500, #079665);
	}
	.srv-fecha-etiqueta {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted, #66756f);
	}
	.srv-fecha-valor {
		font-variant-numeric: tabular-nums;
		color: var(--text-primary, #17201d);
	}
	.srv-fecha--pendiente .srv-fecha-punto {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--border-default, #dee7e3);
	}
	.srv-fecha--pendiente .srv-fecha-valor {
		color: var(--text-very-muted, #8e9c96);
		font-style: italic;
	}
</style>
