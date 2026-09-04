<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import MultiSelectFilter from '$lib/components/ui/MultiSelectFilter.svelte';
	import {
		FileText,
		Receipt,
		Users,
		Settings,
		Plus,
		Search,
		Filter,
		X,
		Eye,
		Edit2,
		CheckCircle2,
		Trash2,
		History,
		Ban,
		RotateCcw,
		ChevronDown,
		ChevronUp,
		ChevronLeft,
		ChevronRight,
		Truck,
		AlertCircle,
		Calendar,
		Hash,
		Tag,
		Table2
	} from 'lucide-svelte';
	import ModalOperadoras from '$lib/components/ModalOperadoras.svelte';
	import {
		liquidacionesServiciosAPI,
		getMesLabel,
		liquidacionesTercerosAPI,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type ConfigLiquidadorServicio,
		type TerceroItemHistorial
	} from '$lib/api/liquidaciones-servicios';
	import {
		facturacionLiquidacionesAPI,
		type FacturaInfoMap,
		type FacturaLiquidacion
	} from '$lib/api/facturacionLiquidaciones';
	import ModalFacturar from '$lib/components/ModalFacturar.svelte';
	import SocketEventLogBar from '$lib/components/liquidaciones/SocketEventLogBar.svelte';
	import { checkAccess } from '$lib/config/permissions';
	import {
		cacheLiquidaciones,
		necesitaFetch,
		puedePintar,
		comenzarFetch,
		guardarDatos,
		fallarFetch,
		ensuciar,
		verTab,
		resetCache,
		type TabId
	} from '$lib/stores/liquidacionesServiciosCache';
	import {
		desdePayload,
		registrar,
		marcarVistos,
		limpiarLog,
		type EventoLog
	} from '$lib/stores/socketEventLog';

	const MESES = [
		'ENERO',
		'FEBRERO',
		'MARZO',
		'ABRIL',
		'MAYO',
		'JUNIO',
		'JULIO',
		'AGOSTO',
		'SEPTIEMBRE',
		'OCTUBRE',
		'NOVIEMBRE',
		'DICIEMBRE'
	];
	const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);

	// --- COP input formatting helpers ---
	const fmtCOP = (v: number) => (v ? new Intl.NumberFormat('es-CO').format(v) : '');
	const parseCOP = (s: string) => parseFloat(s.replace(/[.\s]/g, '').replace(',', '.')) || 0;

	function handleCOPFocus(e: FocusEvent) {
		const input = e.target as HTMLInputElement;
		const raw = parseCOP(input.value);
		input.value = raw ? String(raw) : '';
	}
	function handleCOPBlur(e: FocusEvent, field: keyof typeof configForm) {
		const input = e.target as HTMLInputElement;
		const raw = parseCOP(input.value);
		(configForm as any)[field] = raw;
		input.value = fmtCOP(raw);
	}

	let liquidaciones = $state<LiquidacionServicio[]>([]);
	let listLoading = $state(false);
	let listError = $state('');
	let listPage = $state(1);
	let listTotalPages = $state(1);
	let listTotal = $state(0);
	let listBusqueda = $state('');
	let listEstado = $state<EstadoLiquidacionServicio | ''>('');
	let listMes = $state<string | ''>('');
	let listAnio = $state<number | ''>('');
	let listSortBy = $state('');
	let listSortDir = $state<'asc' | 'desc'>('desc');

	// Column header multi-select filters (server-side, Excel-style)
	let colFilterConsecutivo = $state<string[]>([]);
	let colFilterCliente = $state<string[]>([]);
	let colFilterPeriodo = $state<string[]>([]);
	let colFilterEstado = $state<string[]>([]);
	let colFilterFactura = $state<string[]>([]);
	let colFilterLiquidador = $state<string[]>([]);
	let colFilterPlacas = $state<string[]>([]);

	// Popover for placas
	let popoverPlacasVisible = $state(false);
	let popoverPlacas = $state<string[]>([]);
	let popoverPlacasPos = $state({ top: 0, left: 0 });

	// Popover for items (lazy loaded per liquidacion)
	let popoverItemsVisible = $state(false);
	let popoverItems = $state<import('$lib/api/liquidaciones-servicios').ItemLiquidacionServicio[]>([]);
	let popoverItemsPos = $state({ top: 0, left: 0 });
	let popoverItemsLiqId = $state('');
	let popoverItemsLoading = $state(false);
	const itemsCache: Record<
		string,
		import('$lib/api/liquidaciones-servicios').ItemLiquidacionServicio[]
	> = {};
	let itemsHideTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	// Popover for additional consecutivos (Facturas tab)
	let popoverConsecutivosVisible = $state(false);
	let popoverConsecutivos = $state<string[]>([]);
	let popoverConsecutivosPos = $state({ top: 0, left: 0 });
	let popoverConsecutivosHideTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	const CONSECUTIVOS_VISIBLE_LIMIT = 5;

	// ═══ URL ↔ state sync (mismo patrón que /dashboard/recargos) ═══
	// - `hidratado` evita disparar fetch en el ciclo de hidratación desde URL.
	// - `urlSyncTimer` debouncea la escritura a la URL (200ms).
	// - `fetchTimers[tab]` debouncea el fetch de cada tab (350ms), uno por tab.
	// - `last*Filter` resetea listPage/facturasPage/tercerosPage a 1 cuando cambia el filtro.
	// - La caché (`liquidacionesServiciosCache`) evita los fetches redundantes.
	let hidratado = $state(false);
	let urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Un timer de debounce POR TAB.
	 *
	 * Antes había uno solo compartido por los tres reactivos de fetch. Como
	 * cada uno hacía `clearTimeout(fetchDebounceTimer)` antes de programar
	 * el suyo, dos tabs cuyas claves cambiaban en el mismo ciclo — cosa que
	 * pasa al hidratar desde la URL o al limpiar filtros — se cancelaban
	 * mutuamente y uno de los dos no llegaba a pedir nunca.
	 */
	const fetchTimers: Record<TabId, ReturnType<typeof setTimeout> | null> = {
		liquidaciones: null,
		facturas: null,
		terceros: null,
		configuracion: null
	};
	function programarFetch(tab: TabId, fn: () => void, ms = FETCH_DEBOUNCE_MS) {
		const previo = fetchTimers[tab];
		if (previo) clearTimeout(previo);
		fetchTimers[tab] = setTimeout(fn, ms);
	}
	function cancelarFetches() {
		for (const t of Object.keys(fetchTimers) as TabId[]) {
			const h = fetchTimers[t];
			if (h) clearTimeout(h);
			fetchTimers[t] = null;
		}
	}

	// ═══ Claves de caché ═══
	//
	// La firma completa de filtros + página con la que se pidió cada tab. La
	// caché solo sirve un dato si su clave casa con la actual: 50 registros
	// traídos con OTRO filtro son peores que un spinner.
	//
	// OJO: la clave de liquidaciones incluye AHORA el sort y los siete
	// filtros de columna. Antes solo llevaba búsqueda/mes/año/placas, así
	// que ordenar una columna o aplicar un filtro de cabecera estando ya en
	// la página 1 no cambiaba la clave y el fetch no se disparaba nunca —
	// la tabla se quedaba con el orden viejo hasta que tocabas otra cosa.
	function keyLiquidaciones(): string {
		return [
			listBusqueda,
			listMes,
			listAnio,
			listSortBy,
			listSortDir,
			colFilterConsecutivo.join(','),
			colFilterCliente.join(','),
			colFilterPeriodo.join(','),
			colFilterEstado.join(','),
			colFilterFactura.join(','),
			colFilterLiquidador.join(','),
			colFilterPlacas.join(','),
			listPage
		].join('|');
	}
	function keyFacturas(): string {
		return [facturasBusqueda, facturasEstado, facturasPage].join('|');
	}
	function keyTerceros(): string {
		return [tercerosBusqueda, tercerosMes, tercerosAnio, tercerosPlaca, tercerosPage].join('|');
	}
	function keyDeTab(tab: TabId): string {
		if (tab === 'facturas') return keyFacturas();
		if (tab === 'terceros') return keyTerceros();
		if (tab === 'configuracion') return 'config';
		return keyLiquidaciones();
	}
	const URL_SYNC_DEBOUNCE_MS = 200;
	const FETCH_DEBOUNCE_MS = 350;
	// Firma de FILTROS (sin página) de cada tab, solo para detectar cuándo
	// hay que volver a la página 1. La cuenta de "qué se pidió por última
	// vez" ya la lleva la caché (`key` + `fetchedAt`), así que los antiguos
	// `lastFetched*` sobran.
	let lastLiquidacionesFilter = '';
	let lastFacturasFilter = '';
	let lastTercerosFilter = '';

	// Unique values for column filters (from ALL records via metadata)

	// filteredLiquidaciones = liquidaciones (filtering is now server-side)
	const filteredLiquidaciones = $derived(liquidaciones);

	const hasColumnFilter = $derived(colFilterConsecutivo.length > 0 ||
		colFilterCliente.length > 0 ||
		colFilterPeriodo.length > 0 ||
		colFilterEstado.length > 0 ||
		colFilterFactura.length > 0 ||
		colFilterLiquidador.length > 0 ||
		colFilterPlacas.length > 0);

	// Metadata from API
	let listMetadata = $state<{
		globalTotal: number;
		globalCount: number;
		estadoCounts: Record<string, number>;
		clientes: { id: string; nombre: string }[];
		liquidadores: { id: string; nombre: string }[];
		consecutivos: string[];
		periodos: { mes: number; anio: number }[];
		facturas: string[];
		estados: string[];
		placas: string[];
	}>({
		globalTotal: 0,
		globalCount: 0,
		estadoCounts: {},
		clientes: [],
		liquidadores: [],
		consecutivos: [],
		periodos: [],
		facturas: [],
		estados: [],
		placas: []
	});

	const hasActiveFilter = $derived(!!(listBusqueda || hasColumnFilter));

	let detailModal = $state(false);
	let detailLoading = $state(false);
	let detailLiq = $state<LiquidacionServicio | null>(null);

	let deleteModalOpen = $state(false);
	let deleteTargetLiq = $state<LiquidacionServicio | null>(null);
	let deleting = $state(false);

	let anularModalOpen = $state(false);
	let anularTargetId = $state('');
	let anularMotivo = $state('');
	let estadoChanging = $state(false);

	// Historial
	let historialModalOpen = $state(false);
	let historialLoading = $state(false);
	let historialData = $state<import('$lib/api/liquidaciones-servicios').HistorialEstado[]>([]);
	let historialLiqConsecutivo = $state('');
	let historialExpandedId = $state<string | null>(null);

	let facturarModalOpen = $state(false);
	let facturarPreselected = $state<string[]>([]);
	let facturaInfoMap = $state<FacturaInfoMap>({});
	let facturablesParaFacturar = $state<LiquidacionServicio[]>([]);
	let facturablesLoading = $state(false);

	let facturasTab = $state<'liquidaciones' | 'facturas' | 'configuracion' | 'terceros'>('liquidaciones');
	let modalOperadoras = $state(false);

	/**
	 * Agregados de Terceros sobre TODOS los registros del filtro.
	 *
	 * Antes las stat cards se calculaban con `tercerosItems.reduce(...)`, es
	 * decir sobre la PÁGINA (limit 50). "Total Facturado" era el de 50 filas
	 * y cambiaba al pasar de página — que es justo lo que delataba el fallo.
	 * El tab de Liquidaciones ya lo resolvía en el servidor vía `metadata`;
	 * esto lo empareja con el mismo `where` de la consulta paginada.
	 */
	const TERCEROS_METADATA_VACIA = {
		globalCount: 0,
		globalFacturado: 0,
		globalAdmon: 0,
		globalLiquidar: 0,
		globalIngresoEmpresa: 0,
		globalClientes: 0
	};

	const uniqueConsecutivos = $derived(listMetadata.consecutivos || []);
	const uniqueClientes = $derived(listMetadata.clientes.map((c) => c.nombre));
	const uniquePeriodos = $derived((listMetadata.periodos || []).map((p) => `${getMesLabel(p.mes)} ${p.anio}`));
	const uniqueEstados = $derived(listMetadata.estados || []);
	const uniqueFacturas = $derived(listMetadata.facturas || []);
	const uniqueLiquidadores = $derived(listMetadata.liquidadores.map((l) => l.nombre));
	const uniquePlacas = $derived(listMetadata.placas || []);
	let tercerosMetadata = $state({ ...TERCEROS_METADATA_VACIA });

	/** Ídem para Facturas, que tenía el mismo problema con `facturas.reduce`. */
	const FACTURAS_METADATA_VACIA = {
		globalCount: 0,
		globalTotal: 0,
		globalLiquidaciones: 0,
		estadoCounts: {} as Record<string, number>,
		estadoTotales: {} as Record<string, number>
	};
	let facturasMetadata = $state({ ...FACTURAS_METADATA_VACIA });

	// Terceros historial
	let tercerosItems = $state<TerceroItemHistorial[]>([]);
	let tercerosLoading = $state(false);
	let tercerosPage = $state(1);
	let tercerosTotalPages = $state(1);
	let tercerosTotal = $state(0);
	let tercerosBusqueda = $state('');
	let tercerosMes = $state<number | ''>('');
	let tercerosAnio = $state<number | ''>(new Date().getFullYear());
	let tercerosPlaca = $state('');
	let facturas = $state<FacturaLiquidacion[]>([]);
	let facturasLoading = $state(false);
	let facturasPage = $state(1);
	let facturasTotalPages = $state(1);
	let facturasTotal = $state(0);
	let facturasBusqueda = $state('');
	let facturasEstado = $state<'' | 'ACTIVA' | 'ANULADA'>('');

	let anularFacturaModalOpen = $state(false);
	let anularFacturaTarget = $state<FacturaLiquidacion | null>(null);
	let anularFacturaMotivo = $state('');
	let eliminarFacturaModalOpen = $state(false);
	let eliminarFacturaTarget = $state<FacturaLiquidacion | null>(null);
	let eliminandoFactura = $state(false);
	let anulandoFactura = $state(false);

	let detalleFactura = $state<FacturaLiquidacion | null>(null);

	/* ── Config liquidador servicio ── */
	let configLoading = $state(false);
	let configSaving = $state(false);
	let configData = $state<ConfigLiquidadorServicio | null>(null);
	let configForm = $state({
		salario_basico: 0,
		cargo: 'Conductor',
		valor_hora_override: 0,
		conductor_adicional: 0,
		pct_seg_social: 0,
		pct_prestaciones: 0,
		pct_admin: 0,
		prueba_covid: 0
	});
	const configValorHoraAuto = $derived(configForm.salario_basico > 0 ? +(configForm.salario_basico / 235).toFixed(4) : 0);

	async function cargarConfig(forzar = false) {
		// La config es un único registro y cambia muy de vez en cuando, así
		// que basta con no repedirla si ya está en caché y limpia.
		if (!forzar && !necesitaFetch('configuracion', 'config')) return;
		configLoading = !puedePintar('configuracion', 'config');
		comenzarFetch('configuracion');
		try {
			const d = await liquidacionesServiciosAPI.obtenerConfigLiquidador();
			configData = d;
			configForm = {
				salario_basico: d.salario_basico,
				cargo: d.cargo,
				valor_hora_override: d.valor_hora_override,
				conductor_adicional: d.conductor_adicional,
				pct_seg_social: d.pct_seg_social,
				pct_prestaciones: d.pct_prestaciones,
				pct_admin: d.pct_admin,
				prueba_covid: d.prueba_covid
			};
			guardarDatos('configuracion', 'config', d);
		} catch (e: any) {
			// Sin `alert()`: con el prefetch de los 4 tabs al montar, un
			// backend caído disparaba un modal bloqueante por cada tab.
			fallarFetch('configuracion', e?.message || 'Error cargando configuración');
		} finally {
			configLoading = false;
		}
	}

	async function guardarConfig() {
		configSaving = true;
		try {
			const d = await liquidacionesServiciosAPI.actualizarConfigLiquidador(configForm);
			configData = d;
			alert('✅ Configuracion guardada');
		} catch (e: any) {
			alert(e.message || 'Error guardando config');
		} finally {
			configSaving = false;
		}
	}

	// ─── Terceros historial ───
	/**
	 * `forzar` salta la caché. Lo usan el botón de recarga manual y los
	 * handlers de socket cuando el tab está a la vista.
	 */
	async function cargarTerceros(forzar = false) {
		const key = keyTerceros();
		if (!forzar && !necesitaFetch('terceros', key)) return;

		// Solo se enseña spinner si NO hay nada que pintar de esta misma
		// clave. Si lo hay (dato viejo o marcado sucio), la tabla se queda
		// visible y se revalida por detrás: parpadear una tabla que ya
		// estaba bien es peor que mostrarla un segundo desactualizada.
		const pintable = puedePintar('terceros', key);
		tercerosLoading = !pintable;
		comenzarFetch('terceros');
		try {
			const filtros: Record<string, string | number> = { page: tercerosPage, limit: 50 };
			if (tercerosBusqueda) filtros.busqueda = tercerosBusqueda;
			if (tercerosMes !== '') filtros.mes = tercerosMes;
			if (tercerosAnio !== '') filtros.anio = tercerosAnio;
			if (tercerosPlaca) filtros.placa = tercerosPlaca;
			const r = await liquidacionesTercerosAPI.listarHistorial(filtros);
			tercerosItems = r.items;
			tercerosTotal = r.total;
			tercerosTotalPages = r.totalPages;
			// Agregados sobre TODOS los registros del filtro, no sobre la
			// página. Ver `tercerosMetadata`.
			tercerosMetadata = { ...TERCEROS_METADATA_VACIA, ...(r.metadata ?? {}) };
			guardarDatos('terceros', key, {
				items: r.items,
				total: r.total,
				totalPages: r.totalPages,
				metadata: tercerosMetadata
			});
		} catch (e: any) {
			// Antes esto era un `alert()` que bloqueaba la página entera por
			// un fallo de red de un tab que quizá ni estaba visible — y con
			// el prefetch de los 4 tabs al montar serían hasta 4 alerts
			// seguidos. Ahora el error queda en la caché y se pinta en el tab.
			fallarFetch('terceros', e?.message || 'Error cargando historial de terceros');
		} finally {
			tercerosLoading = false;
		}
	}
	function filtrarTerceros() {
		// Reset a página 1; el fetch lo dispara el reactivo `lastTercerosFilter`.
		tercerosPage = 1;
	}
	function onTercerosPlacaInput(value: string) {
		// Update directo al state; el reactivo per-tab debouncea el fetch.
		tercerosPlaca = value;
	}
	function irPaginaTerceros(p: number) {
		tercerosPage = p;
	}

	let highlightedIds = $state<Record<string, 'created' | 'updated'>>({});
	const highlightTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	function addHighlight(id: string, type: 'created' | 'updated') {
		if (highlightTimers[id]) clearTimeout(highlightTimers[id]);
		highlightedIds[id] = type;
		highlightedIds = highlightedIds;
		highlightTimers[id] = setTimeout(() => {
			delete highlightedIds[id];
			highlightedIds = highlightedIds;
			delete highlightTimers[id];
		}, 8000);
	}

	const accessResult = $derived(checkAccess(
		$authStore.user?.role,
		$authStore.user?.area,
		'liquidaciones-servicios',
		$authStore.user?.permisos_rutas
	));
	const isFull = $derived(accessResult.level === 'full');
	const isLimited = $derived(accessResult.level === 'limited');
	const userAreas = $derived(Array.isArray($authStore.user?.area)
		? $authStore.user.area
		: $authStore.user?.area
			? [$authStore.user.area]
			: []);
	const isAdmin = $derived(userAreas.includes('administracion'));
	const isFacturacion = $derived(userAreas.includes('facturacion'));
	const isOperaciones = $derived(userAreas.includes('operaciones'));
	const canLiquidar = $derived(isFull); // admin + operaciones: borrador → liquidada
	const canAprobar = $derived(isAdmin); // solo admin: liquidada → aprobada
	const canAnular = $derived(isAdmin); // solo admin: anular liquidaciones
	const canRevertirABorrador = $derived(isFull); // admin + operaciones: liquidada → borrador
	const canRevertirALiquidada = $derived(isAdmin); // solo admin: aprobada → liquidada

	let logoError = $state(false);

	onMount(async () => {
		// 1) Hidratar state desde URL (deep-link friendly).
		hidratarDesdeUrl();

		// 2) Sembrar los keys de los reactivos per-tab con el state actual,
		//    para que el primer reactive-run no dispare fetches espurios
		//    cuando `hidratado` pase a `true`. El fetch inicial lo hacemos
		//    explícitamente abajo (cargarListado/Facturas/Terceros).
		lastLiquidacionesFilter = keyLiquidaciones().split('|').slice(0, -1).join('|');
		lastFacturasFilter = keyFacturas().split('|').slice(0, -1).join('|');
		lastTercerosFilter = keyTerceros().split('|').slice(0, -1).join('|');

		// 3) Prefetch de LOS CUATRO tabs en paralelo.
		//
		//    Antes solo se cargaba el tab activo, así que cambiar de pestaña
		//    siempre costaba una petición y una espera; y si recargabas en
		//    Facturas y saltabas a Terceros, Terceros salía vacío hasta que
		//    su reactivo disparaba otro fetch.
		//
		//    `allSettled` y no `all`: si un tab falla (permisos, backend a
		//    medias) los otros tres tienen que quedar servidos igual. Cada
		//    `cargar*` ya captura su propio error y lo deja en la caché, así
		//    que aquí no hay nada que manejar — pero `allSettled` protege de
		//    un rechazo inesperado que abortaría el resto.
		//
		//    Se espera al conjunto para que `hidratado = true` ocurra con
		//    todas las claves ya sembradas; si no, los reactivos verían
		//    claves a medio poblar y dispararían un segundo round de fetches.
		verTab(facturasTab);
		await Promise.allSettled([cargarListado(), cargarFacturas(), cargarTerceros(), cargarConfig()]);

		// 4) Suscribir sockets.
		socketUtils.on('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.on('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.on('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.on('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.on('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.on('facturacion-anulada', handleSocketFacturacionAnulada);
		socketUtils.on('liquidacion-tercero-updated', handleSocketTerceroUpdated);

		// 5) Habilitar reactivos de URL-sync + fetch (orden crítico).
		hidratado = true;
	});

	onDestroy(() => {
		socketUtils.off('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.off('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.off('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.off('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.off('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.off('facturacion-anulada', handleSocketFacturacionAnulada);
		socketUtils.off('liquidacion-tercero-updated', handleSocketTerceroUpdated);
		Object.values(highlightTimers).forEach((t) => clearTimeout(t));
		// La caché y el feed son de ESTA visita a la página: si el usuario
		// se va y vuelve, queremos datos frescos y un feed limpio, no los
		// eventos de hace media hora.
		resetCache();
		limpiarLog();
		cancelarFetches();
		if (itemsHideTimer) clearTimeout(itemsHideTimer);
		if (popoverConsecutivosHideTimer) clearTimeout(popoverConsecutivosHideTimer);
		if (urlSyncTimer) clearTimeout(urlSyncTimer);
	});

	/**
	 * Registra el evento en el feed e invalida la caché del tab afectado.
	 *
	 * Es el punto único por el que pasa TODO evento de socket, para que no
	 * haya un tab que se invalide y otro que no según quién escribiera el
	 * handler.
	 *
	 * Devuelve el evento normalizado (o `null` si era propio / sin sobre),
	 * por si quien llama quiere condicionar el resaltado de fila.
	 */
	function procesarEvento(data: any, scope: TabId): EventoLog | null {
		const evt = desdePayload(data, scope);
		const destino: TabId = evt?.scope ?? scope;
		const visible = facturasTab === destino;

		// Los eventos que causa uno mismo no se anuncian: el servidor emite
		// a todos los clientes incluido el emisor, y decirle "creaste LS-045"
		// a quien acaba de pulsar Guardar es ruido puro.
		const propio = !!evt && !!$authStore.user && evt.actor === ($authStore.user.nombre ?? '');
		const registrado = registrar(evt, propio);

		// La caché se ensucia SIEMPRE, también con los eventos propios: la
		// acción cambió datos del servidor (totales, metadata, paginación)
		// que este cliente no puede recalcular solo.
		ensuciar(destino, visible);
		return registrado;
	}

	/**
	 * Refetchea el tab si está a la vista; si no, se queda sucio y con badge
	 * y se resolverá al entrar. Es lo que evita pedir tres listados por un
	 * evento que solo afecta a uno.
	 */
	function refrescarSiVisible(tab: TabId) {
		if (facturasTab !== tab) return;
		if (tab === 'liquidaciones') cargarListado(true);
		else if (tab === 'facturas') cargarFacturas(true);
		else if (tab === 'terceros') cargarTerceros(true);
		else if (tab === 'configuracion') cargarConfig(true);
	}

	function handleSocketCreated(data: any) {
		if (!data?.id) return;
		procesarEvento(data, 'liquidaciones');
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			// Inserción optimista para que la fila aparezca ya. El refetch
			// de fondo la reordena y corrige los totales.
			liquidaciones = [mapped, ...liquidaciones];
			listTotal += 1;
			addHighlight(data.id, 'created');
		}
		refrescarSiVisible('liquidaciones');
	}

	function handleSocketUpdated(data: any) {
		if (!data?.id) return;
		procesarEvento(data, 'liquidaciones');
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			const idx = liquidaciones.findIndex((l) => l.id === data.id);
			if (idx >= 0) {
				liquidaciones[idx] = mapped;
				liquidaciones = [...liquidaciones];
				// Un cambio de estado se resalta como 'updated' en la tabla:
				// el matiz de "solo cambió el estado" lo aporta el feed, y
				// duplicarlo en la fila sería redundante.
				addHighlight(data.id, 'updated');
			}
		}
		// Se refetchea aunque la fila no esté en la página actual: puede
		// haber entrado o salido del filtro, y los contadores por estado de
		// las stat cards cambian igual.
		refrescarSiVisible('liquidaciones');
	}

	function handleSocketDeleted(data: any) {
		if (!data?.id) return;
		procesarEvento(data, 'liquidaciones');
		liquidaciones = liquidaciones.filter((l) => l.id !== data.id);
		listTotal = Math.max(0, listTotal - 1);
		refrescarSiVisible('liquidaciones');
	}

	/**
	 * Terceros. Este evento no existía: el módulo del backend no emitía
	 * nada, así que guardar los terceros de una liquidación no llegaba a
	 * los demás usuarios y el tab solo se enteraba recargando a mano.
	 */
	function handleSocketTerceroUpdated(data: any) {
		procesarEvento(data, 'terceros');
		refrescarSiVisible('terceros');
	}

	function mapLiquidacionFromSocket(d: any): LiquidacionServicio | null {
		if (!d?.id) return null;
		return {
			...d,
			valor_servicios: Number(d.valor_servicios ?? 0),
			valor_recargos: Number(d.valor_recargos ?? 0),
			valor_pernoctes: Number(d.valor_pernoctes ?? 0),
			subtotal: Number(d.subtotal ?? 0),
			porcentaje_iva: Number(d.porcentaje_iva ?? 0),
			valor_iva: Number(d.valor_iva ?? 0),
			total: Number(d.total ?? 0),
			valor_transporte_adicional: Number(d.valor_transporte_adicional ?? 0),
			total_items: d._count?.items ?? d.total_items ?? d.items?.length ?? 0
		};
	}

	// Antes estos dos descartaban el evento si el tab de Facturas no estaba
	// abierto: la factura se creaba, nadie se enteraba, y al entrar al tab
	// se veía la lista vieja. Ahora el tab queda sucio y con badge.
	function handleSocketFacturacionCreated(data: any) {
		procesarEvento(data, 'facturas');
		refrescarSiVisible('facturas');
	}
	function handleSocketFacturacionAnulada(data: any) {
		procesarEvento(data, 'facturas');
		refrescarSiVisible('facturas');
	}

	function handleSocketFacturada(data: any) {
		if (!data?.id) return;
		// Facturar mueve el estado de la liquidación: el evento va con
		// scope 'liquidaciones' desde el servidor.
		procesarEvento(data, 'liquidaciones');
		const idx = liquidaciones.findIndex((l) => l.id === data.id);
		if (idx >= 0) {
			liquidaciones[idx] = { ...liquidaciones[idx], estado: data.estado };
			liquidaciones = [...liquidaciones];
			if (data.numero_factura) {
				facturaInfoMap[data.id] = {
					factura_id: data.factura_id,
					numero_factura: data.numero_factura
				};
				facturaInfoMap = { ...facturaInfoMap };
			} else {
				delete facturaInfoMap[data.id];
				facturaInfoMap = { ...facturaInfoMap };
			}
			addHighlight(data.id, 'updated');
		}
		refrescarSiVisible('liquidaciones');
	}

	async function cargarListado(forzar = false) {
		const key = keyLiquidaciones();
		if (!forzar && !necesitaFetch('liquidaciones', key)) return;

		const pintable = puedePintar('liquidaciones', key);
		listLoading = !pintable;
		listError = '';
		comenzarFetch('liquidaciones');
		try {
			const filtros: Record<string, any> = {
				page: listPage,
				limit: 15,
				/// El backend limita los autoguardados al autor, salvo que la sesión sea administrativa.
				incluir_no_confirmadas: true
			};
			if (listBusqueda) filtros.busqueda = listBusqueda;
			if (listMes) filtros.mes = listMes;
			if (listAnio) filtros.anio = listAnio;
			if (listSortBy) {
				filtros.sortBy = listSortBy;
				filtros.sortDir = listSortDir;
			}
			// Column filters (server-side)
			if (colFilterConsecutivo.length) filtros.consecutivos = colFilterConsecutivo.join(',');
			if (colFilterEstado.length) filtros.estados = colFilterEstado.join(',');
			if (colFilterCliente.length) filtros.cliente_nombres = colFilterCliente.join(',');
			if (colFilterLiquidador.length) filtros.liquidador_nombres = colFilterLiquidador.join(',');
			if (colFilterPeriodo.length) {
				// Convert "Enero 2026" -> "1-2026"
				filtros.periodos = colFilterPeriodo
					.map((p) => {
						const parts = p.split(' ');
						const mesLabel = parts[0];
						const anio = parts[1];
						const meses = [
							'Enero',
							'Febrero',
							'Marzo',
							'Abril',
							'Mayo',
							'Junio',
							'Julio',
							'Agosto',
							'Septiembre',
							'Octubre',
							'Noviembre',
							'Diciembre'
						];
						const mesNum = meses.indexOf(mesLabel) + 1;
						return `${mesNum}-${anio}`;
					})
					.join(',');
			}
			if (colFilterFactura.length) filtros.facturas = colFilterFactura.join(',');
			if (colFilterPlacas.length) filtros.placas = colFilterPlacas.join(',');
			const res = await liquidacionesServiciosAPI.listar(filtros);
			liquidaciones = res.liquidaciones;
			listTotal = res.total;
			listTotalPages = res.totalPages;
			listPage = res.page;
			if (res.metadata)
				/// El servidor no siempre manda las cuatro listas de la cabecera;
				/// las que falten quedan vacías en vez de `undefined`, que
				/// reventaría los `.map` de los desplegables.
				listMetadata = {
					...res.metadata,
					consecutivos: res.metadata.consecutivos ?? [],
					periodos: res.metadata.periodos ?? [],
					facturas: res.metadata.facturas ?? [],
					estados: res.metadata.estados ?? []
				};
			guardarDatos('liquidaciones', key, {
				liquidaciones: res.liquidaciones,
				total: res.total,
				totalPages: res.totalPages,
				metadata: listMetadata
			});
		} catch (err: any) {
			listError = err.message || 'Error al cargar liquidaciones';
			fallarFetch('liquidaciones', listError);
		} finally {
			listLoading = false;
			cargarFacturaInfo();
		}
	}

	async function cargarFacturaInfo() {
		const ids = liquidaciones.map((l) => l.id);
		if (ids.length === 0) {
			facturaInfoMap = {};
			return;
		}
		try {
			facturaInfoMap = await facturacionLiquidacionesAPI.batchFacturaInfo(ids);
		} catch {
			facturaInfoMap = {};
		}
	}

	async function cargarItemsLiquidacion(id: string) {
		if (itemsCache[id]) {
			popoverItems = itemsCache[id];
			return;
		}
		popoverItemsLoading = true;
		try {
			const liq = await liquidacionesServiciosAPI.obtenerPorId(id);
			const items = (liq.items || []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
			itemsCache[id] = items;
			if (popoverItemsLiqId === id) popoverItems = items;
		} catch {
			itemsCache[id] = [];
			if (popoverItemsLiqId === id) popoverItems = [];
		} finally {
			popoverItemsLoading = false;
		}
	}

	function mostrarPopoverItems(e: Event, liqId: string) {
		if (itemsHideTimer) {
			clearTimeout(itemsHideTimer);
			itemsHideTimer = null;
		}
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		popoverItemsPos = { top: rect.bottom + 6, left: rect.left };
		popoverItemsLiqId = liqId;
		popoverItemsVisible = true;
		if (itemsCache[liqId]) {
			popoverItems = itemsCache[liqId];
		} else {
			popoverItems = [];
			cargarItemsLiquidacion(liqId);
		}
	}

	function ocultarPopoverItems() {
		itemsHideTimer = setTimeout(() => {
			popoverItemsVisible = false;
			popoverItemsLiqId = '';
		}, 120);
	}

	function mantenerPopoverItems() {
		if (itemsHideTimer) {
			clearTimeout(itemsHideTimer);
			itemsHideTimer = null;
		}
	}

	function mostrarPopoverConsecutivos(e: Event, fac: FacturaLiquidacion) {
		if (popoverConsecutivosHideTimer) {
			clearTimeout(popoverConsecutivosHideTimer);
			popoverConsecutivosHideTimer = null;
		}
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		popoverConsecutivosPos = {
			top: rect.bottom + 6,
			left: Math.max(8, Math.min(rect.left, window.innerWidth - 320))
		};
		popoverConsecutivos = fac.items
			.slice(CONSECUTIVOS_VISIBLE_LIMIT)
			.map((f) => f.liquidacion?.consecutivo || '')
			.filter(Boolean);
		popoverConsecutivosVisible = true;
	}

	function ocultarPopoverConsecutivos() {
		popoverConsecutivosHideTimer = setTimeout(() => {
			popoverConsecutivosVisible = false;
		}, 120);
	}

	function mantenerPopoverConsecutivos() {
		if (popoverConsecutivosHideTimer) {
			clearTimeout(popoverConsecutivosHideTimer);
			popoverConsecutivosHideTimer = null;
		}
	}

	function filtrar() {
		// Reset a página 1; el fetch lo dispara el reactivo `lastLiquidacionesFilter`.
		listPage = 1;
	}
	function onSearchKeyDown(e: KeyboardEvent) {
		// Enter → saltea el debounce del fetch (UX).
		if (e.key === 'Enter') {
			const t = fetchTimers.liquidaciones;
			if (t) clearTimeout(t);
			cargarListado(true);
		}
	}

	/**
	 * Escribe el estado del tab activo en la URL via `goto(..., { replaceState })`.
	 * Mismo patrón que /dashboard/recargos: la URL refleja la intención del usuario
	 * y permite deep-linking. El reactivo `browser && hidratado` dispara esto
	 * con debounce 200ms cada vez que cambia cualquier input compartido.
	 */
	function syncUrl() {
		if (!browser) return;
		const params = new URLSearchParams();
		if (facturasTab !== 'liquidaciones') params.set('tab', facturasTab);

		if (facturasTab === 'liquidaciones') {
			const s = listBusqueda.trim();
			if (s) params.set('busqueda', s);
			if (listMes) params.set('mes', listMes);
			if (listAnio) params.set('anio', String(listAnio));
			/// Los SIETE filtros de cabecera, no solo las placas. Antes seis de
			/// ellos se perdían al compartir el enlace: quien lo abría veía otra
			/// tabla y ninguna señal de por qué.
			if (colFilterConsecutivo.length) params.set('consecutivos', colFilterConsecutivo.join(','));
			if (colFilterCliente.length) params.set('clientes', colFilterCliente.join(','));
			if (colFilterPeriodo.length) params.set('periodos', colFilterPeriodo.join(','));
			if (colFilterEstado.length) params.set('estados', colFilterEstado.join(','));
			if (colFilterFactura.length) params.set('facturas', colFilterFactura.join(','));
			if (colFilterLiquidador.length) params.set('liquidadores', colFilterLiquidador.join(','));
			if (colFilterPlacas.length) params.set('placas', colFilterPlacas.join(','));
			if (listSortBy) {
				params.set('orden', listSortBy);
				params.set('dir', listSortDir);
			}
			if (listPage > 1) params.set('pagina', String(listPage));
		} else if (facturasTab === 'facturas') {
			const s = facturasBusqueda.trim();
			if (s) params.set('busqueda', s);
			if (facturasEstado) params.set('estado', facturasEstado);
			if (facturasPage > 1) params.set('pagina', String(facturasPage));
		} else if (facturasTab === 'terceros') {
			const s = tercerosBusqueda.trim();
			if (s) params.set('busqueda', s);
			if (tercerosMes !== '') params.set('mes', String(tercerosMes));
			if (tercerosAnio !== '') params.set('anio', String(tercerosAnio));
			if (tercerosPlaca) params.set('placa', tercerosPlaca);
			if (tercerosPage > 1) params.set('pagina', String(tercerosPage));
		}

		const qs = params.toString();
		const target = qs
			? `/dashboard/liquidaciones-servicios?${qs}`
			: '/dashboard/liquidaciones-servicios';
		goto(target, { replaceState: true, noScroll: true, keepFocus: true });
	}

	/**
	 * Lee los search params del tab activo y los aplica al state correspondiente.
	 * Llamada una sola vez en `onMount` antes de marcar `hidratado = true`
	 * (el flag evita que los reactivos de URL-sync / fetch disparen un loop).
	 */
	function hidratarDesdeUrl() {
		if (!browser) return;
		const params = $page.url.searchParams;

		const urlTab = params.get('tab');
		if (urlTab === 'facturas') facturasTab = 'facturas';
		else if (urlTab === 'terceros') facturasTab = 'terceros';
		else if (urlTab === 'configuracion') facturasTab = 'configuracion';
		else facturasTab = 'liquidaciones';

		const urlBusqueda = params.get('busqueda') || '';
		const urlMes = params.get('mes');
		const urlAnio = params.get('anio');

		/// Página del tab activo. El nombre se comparte entre pestañas, igual
		/// que `busqueda` y `mes`: cada una lee la suya.
		const urlPagina = Number(params.get('pagina'));
		const paginaValida = Number.isFinite(urlPagina) && urlPagina >= 1 ? urlPagina : 1;

		const lista = (clave: string): string[] =>
			(params.get(clave) || '').split(',').filter(Boolean);

		if (facturasTab === 'liquidaciones') {
			if (urlBusqueda) listBusqueda = urlBusqueda;
			if (urlMes) listMes = urlMes;
			if (urlAnio) listAnio = Number(urlAnio);
			colFilterConsecutivo = lista('consecutivos');
			colFilterCliente = lista('clientes');
			colFilterPeriodo = lista('periodos');
			colFilterEstado = lista('estados');
			colFilterFactura = lista('facturas');
			colFilterLiquidador = lista('liquidadores');
			colFilterPlacas = lista('placas');
			const urlOrden = params.get('orden');
			if (urlOrden) {
				listSortBy = urlOrden;
				listSortDir = params.get('dir') === 'asc' ? 'asc' : 'desc';
			}
			listPage = paginaValida;
		} else if (facturasTab === 'facturas') {
			if (urlBusqueda) facturasBusqueda = urlBusqueda;
			const urlEstado = params.get('estado');
			if (urlEstado === 'ACTIVA' || urlEstado === 'ANULADA') {
				facturasEstado = urlEstado;
			}
			facturasPage = paginaValida;
		} else if (facturasTab === 'terceros') {
			if (urlBusqueda) tercerosBusqueda = urlBusqueda;
			if (urlMes) {
				const m = parseInt(urlMes, 10);
				if (Number.isFinite(m) && m >= 1 && m <= 12) tercerosMes = m;
			}
			if (urlAnio) {
				const y = parseInt(urlAnio, 10);
				if (Number.isFinite(y) && y >= 2020 && y <= 2100) tercerosAnio = y;
			}
			const urlPlaca = params.get('placa');
			if (urlPlaca) tercerosPlaca = urlPlaca;
			tercerosPage = paginaValida;
		}
	}
	function cambiarTab(id: 'liquidaciones' | 'facturas' | 'terceros' | 'configuracion') {
		// La URL la sincroniza el reactivo `browser && hidratado`; la
		// revalidación del tab, el reactivo de cambio de tab. Aquí solo se
		// mueve el state.
		facturasTab = id;
	}
	/**
	 * Salta a lo que anuncia un evento del feed.
	 *
	 * Cambia al tab afectado y, si es una liquidación, abre su detalle. No
	 * se intenta llevar al usuario a la PÁGINA donde está la fila: con
	 * filtros y orden activos puede no estar en ninguna, y una búsqueda
	 * fallida sería peor que abrir el detalle directo.
	 */
	function irAEvento(evt: EventoLog) {
		if (evt.scope && evt.scope !== facturasTab) {
			cambiarTab(evt.scope);
		}
		if (evt.scope === 'liquidaciones' && evt.entidadId && evt.tipo !== 'deleted') {
			verDetalle(evt.entidadId);
		}
	}

	/**
	 * Recarga manual del tab activo, saltándose la caché.
	 *
	 * Con TTL de 60s y revalidación por socket rara vez hace falta, pero un
	 * usuario que sospecha que ve algo viejo necesita una salida que no sea
	 * F5 — recargar la página entera pierde filtros, scroll y el feed.
	 */
	function recargarTabActivo() {
		const tab = facturasTab;
		const t = fetchTimers[tab];
		if (t) clearTimeout(t);
		if (tab === 'liquidaciones') cargarListado(true);
		else if (tab === 'facturas') cargarFacturas(true);
		else if (tab === 'terceros') cargarTerceros(true);
		else cargarConfig(true);
	}

	function irPagina(p: number) {
		// El fetch lo dispara el reactivo per-tab.
		listPage = p;
	}

	function toggleSort(col: string) {
		if (listSortBy === col) {
			listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
		} else {
			listSortBy = col;
			listSortDir = col === 'fecha' ? 'desc' : 'asc';
		}
		filtrar();
	}

	function sortIcon(col: string) {
		return listSortBy === col ? (listSortDir === 'asc' ? ' ▲' : ' ▼') : '';
	}

	function irNuevaLiquidacion() {
		goto('/dashboard/liquidaciones-servicios/nueva');
	}
	function irEditarLiquidacion(id: string) {
		goto('/dashboard/liquidaciones-servicios/editar/' + id);
	}
	function irVerLiquidacion(id: string) {
		goto('/dashboard/liquidaciones-servicios/' + id + '?mode=view');
	}

	async function verDetalle(id: string) {
		detailModal = true;
		detailLoading = true;
		detailLiq = null;
		try {
			detailLiq = await liquidacionesServiciosAPI.obtenerPorId(id);
		} catch (err: any) {
			alert(err.message || 'Error al cargar liquidacion');
			detailModal = false;
		} finally {
			detailLoading = false;
		}
	}
	function cerrarDetalle() {
		detailModal = false;
		detailLiq = null;
	}

	async function eliminarLiq(id: string) {
		deleting = true;
		try {
			await liquidacionesServiciosAPI.eliminar(id);
			deleteModalOpen = false;
			deleteTargetLiq = null;
		} catch (err: any) {
			alert(err.message || 'Error');
		} finally {
			deleting = false;
		}
	}

	async function cambiarEstado(id: string, estado: EstadoLiquidacionServicio, motivo?: string) {
		try {
			await liquidacionesServiciosAPI.cambiarEstado(id, estado, motivo);
			if (detailLiq?.id === id) detailLiq = { ...detailLiq, estado };
		} catch (err: any) {
			const status = err?.response?.status ?? err?.status;
			const mensaje =
				err?.response?.data?.error ?? err?.data?.error ?? err?.message ?? 'Error al cambiar estado';

			if (status === 403) {
				alert(`⛔ Sin permisos: ${mensaje}`);
			} else {
				alert(mensaje);
			}
		}
	}

	async function cambiarEstadoLiq(
		id: string,
		nuevoEstado: EstadoLiquidacionServicio,
		motivo?: string
	) {
		estadoChanging = true;
		try {
			await cambiarEstado(id, nuevoEstado, motivo);
		} finally {
			estadoChanging = false;
		}
	}

	function abrirAnularModal(id: string) {
		anularTargetId = id;
		anularMotivo = '';
		anularModalOpen = true;
	}

	async function confirmarAnulacion() {
		if (!anularMotivo.trim()) {
			alert('Debes indicar el motivo de la anulacion');
			return;
		}
		await cambiarEstadoLiq(anularTargetId, 'ANULADA', anularMotivo.trim());
		anularModalOpen = false;
		anularTargetId = '';
		anularMotivo = '';
	}

	async function abrirHistorial(liqId: string, consecutivo: string) {
		historialLiqConsecutivo = consecutivo;
		historialExpandedId = null;
		historialModalOpen = true;
		historialLoading = true;
		try {
			historialData = await liquidacionesServiciosAPI.obtenerHistorial(liqId);
		} catch (e: any) {
			alert(e.message || 'Error cargando historial');
			historialData = [];
		} finally {
			historialLoading = false;
		}
	}

	function getAccionLabel(accion: string | null): { label: string; icon: string; color: string } {
		const map: Record<string, { label: string; icon: string; color: string }> = {
			creacion: { label: 'Creación', icon: '🆕', color: '#16a34a' },
			edicion: { label: 'Edición', icon: '✏️', color: '#2563eb' },
			cambio_estado: { label: 'Cambio de estado', icon: '🔄', color: '#d97706' }
		};
		return map[accion || ''] || map.cambio_estado;
	}

	function getEstadoBadge(estado: EstadoLiquidacionServicio) {
		const map: Record<string, { bg: string; text: string; label: string }> = {
			BORRADOR: { bg: '#f1f5f9', text: '#64748b', label: 'Borrador' },
			LIQUIDADA: { bg: '#dbeafe', text: '#2563eb', label: 'Liquidada' },
			APROBADA: { bg: '#dcfce7', text: '#16a34a', label: 'Aprobada' },
			FACTURADA: { bg: '#d1fae5', text: '#ea580c', label: 'Facturada' },
			ANULADA: { bg: '#fee2e2', text: '#dc2626', label: 'Anulada' }
		};
		return map[estado] || map.BORRADOR;
	}

	function abrirModalFacturar() {
		facturarPreselected = [];
		facturablesParaFacturar = [];
		facturarModalOpen = true;
		cargarFacturables();
	}

	async function cargarFacturables() {
		facturablesLoading = true;
		try {
			const res = await liquidacionesServiciosAPI.listar({
				estado: 'APROBADA',
				page: 1,
				limit: 1000
			});
			facturablesParaFacturar = res.liquidaciones;
		} catch (err: any) {
			alert(err.message || 'Error cargando liquidaciones facturables');
			facturablesParaFacturar = [];
		} finally {
			facturablesLoading = false;
		}
	}

	function handleFacturaCreated(_e: CustomEvent<{ factura: any }>) {
		cargarListado();
		facturarModalOpen = false;
	}

	async function cargarFacturas(forzar = false) {
		const key = keyFacturas();
		if (!forzar && !necesitaFetch('facturas', key)) return;

		const pintable = puedePintar('facturas', key);
		facturasLoading = !pintable;
		comenzarFetch('facturas');
		try {
			const res = await facturacionLiquidacionesAPI.listar({
				page: facturasPage,
				limit: 15,
				busqueda: facturasBusqueda || undefined,
				estado: facturasEstado || undefined
			});
			facturas = res.facturas;
			facturasTotal = res.total;
			facturasTotalPages = res.totalPages;
			facturasPage = res.page;
			facturasMetadata = { ...FACTURAS_METADATA_VACIA, ...(res.metadata ?? {}) };
			guardarDatos('facturas', key, {
				facturas: res.facturas,
				total: res.total,
				totalPages: res.totalPages,
				metadata: facturasMetadata
			});
		} catch (e: any) {
			// No se vacía `facturas`: si ya había tabla, dejarla puesta con
			// el aviso es mejor que borrarla por un fallo de red.
			fallarFetch('facturas', e?.message || 'Error cargando facturas');
		} finally {
			facturasLoading = false;
		}
	}

	function filtrarFacturas() {
		// Reset a página 1; el fetch lo dispara el reactivo `lastFacturasFilter`.
		facturasPage = 1;
	}
	function irPaginaFacturas(p: number) {
		facturasPage = p;
	}

	async function verDetalleFactura(id: string) {
		detalleFactura = null;
		try {
			detalleFactura = await facturacionLiquidacionesAPI.obtenerPorId(id);
		} catch (err: any) {
			alert(err.message || 'Error');
		}
	}

	function abrirAnularFactura(fac: FacturaLiquidacion) {
		anularFacturaTarget = fac;
		anularFacturaMotivo = '';
		anularFacturaModalOpen = true;
	}

	async function confirmarAnularFactura() {
		if (!anularFacturaTarget) return;
		anulandoFactura = true;
		try {
			await facturacionLiquidacionesAPI.anular(anularFacturaTarget.id, anularFacturaMotivo);
			anularFacturaModalOpen = false;
			anularFacturaTarget = null;
			cargarFacturas();
			cargarListado();
		} catch (err: any) {
			alert(err.response?.data?.error || err.message || 'Error');
		} finally {
			anulandoFactura = false;
		}
	}

	function abrirEliminarFactura(fac: FacturaLiquidacion) {
		eliminarFacturaTarget = fac;
		eliminarFacturaModalOpen = true;
	}

	async function confirmarEliminarFactura() {
		if (!eliminarFacturaTarget) return;
		eliminandoFactura = true;
		try {
			await facturacionLiquidacionesAPI.eliminar(eliminarFacturaTarget.id);
			eliminarFacturaModalOpen = false;
			eliminarFacturaTarget = null;
			cargarFacturas();
		} catch (err: any) {
			alert(err.response?.data?.error || err.message || 'Error al eliminar factura');
		} finally {
			eliminandoFactura = false;
		}
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Reactivos URL-sync + fetch per-tab (mismo patrón que /dashboard/recargos)
	// ═══════════════════════════════════════════════════════════════════════

	// 1) URL sync: se dispara con CUALQUIER cambio de state compartido
	//    (debounced 200ms para no martillar goto en cada tecla).
	$effect(() => {
		if (browser && hidratado) {
		void facturasTab;
		void listBusqueda;
		void listMes;
		void listAnio;
		void colFilterConsecutivo;
		void colFilterCliente;
		void colFilterPeriodo;
		void colFilterEstado;
		void colFilterFactura;
		void colFilterLiquidador;
		void colFilterPlacas;
		void listSortBy;
		void listSortDir;
		void listPage;
		void facturasPage;
		void tercerosPage;
		void facturasBusqueda;
		void facturasEstado;
		void tercerosBusqueda;
		void tercerosMes;
		void tercerosAnio;
		void tercerosPlaca;

		if (urlSyncTimer) clearTimeout(urlSyncTimer);
		urlSyncTimer = setTimeout(syncUrl, URL_SYNC_DEBOUNCE_MS);
	}
	});

	// 2) Fetch por tab.
	//
	//    Cada uno con SU propio timer (`fetchTimers[tab]`): antes los tres
	//    compartían uno y se cancelaban entre sí cuando dos claves cambiaban
	//    en el mismo ciclo.
	//
	//    `cargar*` decide sola si hay que ir al servidor consultando la
	//    caché, así que el reactivo ya no necesita llevar la cuenta de qué
	//    fue lo último que pidió — esa era la función de los `lastFetched*`.
	//    Aquí solo queda el reseteo de página al cambiar de filtro y el
	//    debounce del tecleo.

	//    ⚠️ Las dependencias de un bloque `$:` las deduce el compilador de
	//    las variables que aparecen EN EL BLOQUE, no de las que lee una
	//    función llamada desde él. Por eso cada reactivo enumera sus
	//    filtros con `void` antes de construir la clave: si solo llamara a
	//    `keyLiquidaciones()`, el bloque no dependería de `listBusqueda` ni
	//    de los filtros de columna y no volvería a correr al cambiarlos.

	// 2a) Liquidaciones.
	$effect(() => {
		if (browser && hidratado) {
		void listBusqueda;
		void listMes;
		void listAnio;
		void listSortBy;
		void listSortDir;
		void colFilterConsecutivo;
		void colFilterCliente;
		void colFilterPeriodo;
		void colFilterEstado;
		void colFilterFactura;
		void colFilterLiquidador;
		void colFilterPlacas;
		void listPage;

		const filterKey = keyLiquidaciones().split('|').slice(0, -1).join('|');
		if (filterKey !== lastLiquidacionesFilter) {
			lastLiquidacionesFilter = filterKey;
			listPage = 1;
		}
		programarFetch('liquidaciones', () => cargarListado());
	}
	});

	// 2b) Facturas.
	$effect(() => {
		if (browser && hidratado) {
		void facturasBusqueda;
		void facturasEstado;
		void facturasPage;

		const filterKey = keyFacturas().split('|').slice(0, -1).join('|');
		if (filterKey !== lastFacturasFilter) {
			lastFacturasFilter = filterKey;
			facturasPage = 1;
		}
		programarFetch('facturas', () => cargarFacturas());
	}
	});

	// 2c) Terceros.
	$effect(() => {
		if (browser && hidratado) {
		void tercerosBusqueda;
		void tercerosMes;
		void tercerosAnio;
		void tercerosPlaca;
		void tercerosPage;

		const filterKey = keyTerceros().split('|').slice(0, -1).join('|');
		if (filterKey !== lastTercerosFilter) {
			lastTercerosFilter = filterKey;
			tercerosPage = 1;
		}
		programarFetch('terceros', () => cargarTerceros());
	}
	});

	// 3) Al cambiar de tab: apagar su badge, marcar sus eventos como vistos
	//    y revalidar si hace falta. El fetch NO pasa por el debounce: el
	//    usuario acaba de pedir ver ese tab.
	$effect(() => {
		const tab = facturasTab;
		if (!browser || !hidratado) return;
		/// Todo dentro de `untrack`: estas funciones leen y escriben las mismas
		/// listas, y un efecto suscrito a lo que él mismo provoca no para nunca.
		/// La única dependencia legítima aquí es la pestaña.
		untrack(() => {
			verTab(tab);
			marcarVistos(tab);
			if (tab === 'liquidaciones') void cargarListado();
			else if (tab === 'facturas') void cargarFacturas();
			else if (tab === 'terceros') void cargarTerceros();
			else if (tab === 'configuracion') void cargarConfig();
		});
	});

	// Badges de pestaña: eventos llegados mientras el tab no estaba a la vista.
	const pendientesPorTab = $derived({
		liquidaciones: $cacheLiquidaciones.liquidaciones.pendientes,
		facturas: $cacheLiquidaciones.facturas.pendientes,
		terceros: $cacheLiquidaciones.terceros.pendientes,
		configuracion: $cacheLiquidaciones.configuracion.pendientes
	});
</script>

<svelte:head>
	<title>Liquidaciones de Servicios · Cotransmeq</title>
</svelte:head>

<div
	class="page-wrap min-h-screen p-4 md:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<!-- Sub-tabs (editorial pill) -->
	<div class="mb-5 flex flex-wrap items-center gap-1.5" in:fade={{ duration: 300 }}>
		{#snippet tabBtn(
			id: 'liquidaciones' | 'facturas' | 'terceros' | 'configuracion',
			label: string,
			icon: any
		)}
			{@const Icono = icon}
			<button
				onclick={() => cambiarTab(id)}
				class="apple-transition inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
				style="background-color: {facturasTab === id
					? 'rgba(249, 115, 22,0.10)'
					: 'var(--bg-surface)'}; color: {facturasTab === id
					? 'var(--orange-700)'
					: 'var(--text-muted)'}; border: 1px solid {facturasTab === id
					? 'rgba(249, 115, 22,0.30)'
					: 'var(--border-subtle)'};"
			>
				<Icono class="h-3.5 w-3.5" />
				{label}
				<!-- Eventos llegados mientras este tab NO estaba a la vista.
				     Es lo que avisa de que hay algo nuevo sin obligar a
				     refetchear los cuatro tabs por cada socket. -->
				{#if pendientesPorTab[id] > 0 && facturasTab !== id}
					<span class="tab-badge" title="{pendientesPorTab[id]} cambio(s) sin ver">
						{pendientesPorTab[id]}
					</span>
				{/if}
			</button>
		{/snippet}

		{@render tabBtn('liquidaciones', 'Liquidaciones', FileText)}
		{#if isAdmin || isFacturacion}
			{@render tabBtn('facturas', 'Facturas', Receipt)}
			{@render tabBtn('terceros', 'Terceros', Users)}
		{/if}
		{#if isAdmin || isOperaciones}
			{@render tabBtn('configuracion', 'Configuración', Settings)}
		{/if}

		<!-- El canvas no es un tab: es una pantalla completa con su propio
		     layout (sin sidebar ni header), así que abrirlo es navegar, no
		     cambiar de pestaña. Va separado a la derecha por eso mismo. -->
		{#if isAdmin || isFacturacion}
			<a
				href="/dashboard/liquidaciones-servicios/canvas"
				class="apple-transition ml-auto inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
				style="background-color: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border-subtle);"
				title="Ver el histórico como hoja de cálculo y facturar desde ahí"
			>
				<Table2 class="h-3.5 w-3.5" />
				Canvas
			</a>
		{/if}
	</div>

	<!-- Feed de eventos de socket. Vive fuera del `{#if}` de tabs a
	     propósito: un evento de Facturas tiene que verse aunque estés en
	     Liquidaciones, que es justo lo que antes se perdía. -->
	<div class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<SocketEventLogBar onVer={irAEvento} />
		</div>
		<button
			class="recargar-btn"
			onclick={recargarTabActivo}
			title="Volver a leer este tab desde el servidor"
			aria-label="Recargar"
		>
			<RotateCcw class="h-3.5 w-3.5" />
		</button>
	</div>

	{#if facturasTab === 'liquidaciones'}
		<!-- Header (page-card editorial) -->
		<div
			class="page-card mb-4"
			style="padding: 1.25rem 1.5rem;"
			in:fly={{ y: 12, duration: 400, easing: quintOut }}
		>
			<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<!-- Título -->
				<div class="flex items-center gap-3">
					<div class="card-icon">
						<FileText class="h-5 w-5 text-white" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<h1
								class="font-display text-2xl"
								style="color: var(--bg-charcoal); font-weight: 400;"
							>
								Liquidaciones de Servicios
							</h1>
							<span
								class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
								style="background: rgba(249, 115, 22,0.08); color: var(--orange-800);"
							>
								<span
									class="h-1.5 w-1.5 animate-pulse rounded-full"
									style="background-color: var(--orange-500);"
								></span>
								En vivo
							</span>
						</div>
						<p class="text-xs" style="color: var(--text-muted);">
							Gestión y seguimiento de liquidaciones de servicios de transporte
						</p>
					</div>
				</div>

				<!-- Stats chips — hidden below xl (redundantes con las Stat Cards de abajo) -->
				<div class="hidden flex-wrap items-center gap-2 xl:flex">
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-white px-3 py-1 text-xs font-semibold"
						style="color: var(--text-secondary);"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
						{listMetadata.globalCount} Total
					</span>
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
						{listMetadata.estadoCounts['LIQUIDADA'] || 0} Liquidadas
					</span>
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
						style="background: rgba(249, 115, 22,0.10); color: var(--orange-700); border: 1px solid rgba(249, 115, 22,0.30);"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
						{listMetadata.estadoCounts['APROBADA'] || 0} Aprobadas
					</span>
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-white px-3 py-1 text-xs font-semibold text-purple-700"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
						{listMetadata.estadoCounts['FACTURADA'] || 0} Facturadas
					</span>
					{#if hasActiveFilter}
						<span
							class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
							style="background: rgba(37,99,235,0.08); color: #2563eb; border: 1px solid rgba(37,99,235,0.30);"
						>
							<Filter class="h-3 w-3" />
							{listTotal} resultado{listTotal !== 1 ? 's' : ''}
						</span>
					{/if}
				</div>

				<!-- Actions — full-width buttons on mobile/tablet, shrink on xl -->
				<div class="flex items-center gap-2 xl:shrink-0">
					{#if (isFull || isLimited) && (isFacturacion || isAdmin)}
						<button
							onclick={abrirModalFacturar}
							class="btn-secondary apple-transition flex-1 xl:flex-none"
						>
							<Receipt class="h-4 w-4" />
							Facturar
						</button>
					{/if}
					{#if isFull}
						<button
							onclick={irNuevaLiquidacion}
							class="btn-primary apple-transition flex-1 xl:flex-none"
						>
							<Plus class="h-4 w-4" />
							Nueva Liquidación
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Filtros -->
		<div class="filter-panel mb-4" in:fly={{ y: 8, duration: 400, delay: 80, easing: quintOut }}>
			<div class="filter-panel-header">
				<span class="filter-panel-title">Filtros</span>
				{#if hasActiveFilter}
					<span class="filter-count">
						{listTotal} resultado{listTotal !== 1 ? 's' : ''}
					</span>
				{/if}
			</div>
			<div class="filter-grid-4">
				<div class="filter-field" style="grid-column: span 2;">
					<label class="filter-field-label" for="liq-search">Búsqueda</label>
					<input
						id="liq-search"
						type="search"
						bind:value={listBusqueda}
						onkeydown={onSearchKeyDown}
						placeholder="Consecutivo, cliente, placa…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="liq-mes">Mes</label>
					<select id="liq-mes" bind:value={listMes} onchange={filtrar}>
						<option value="">Todos los meses</option>
						{#each MESES as m}<option value={m}>{m}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="liq-anio">Año</label>
					<select id="liq-anio" bind:value={listAnio} onchange={filtrar}>
						<option value="">Todos los años</option>
						{#each YEARS as y}<option value={y}>{y}</option>{/each}
					</select>
				</div>
			</div>
			{#if hasActiveFilter}
				<div class="filter-actions">
					<button
						class="filter-clear"
						onclick={() => {
							listBusqueda = '';
							listMes = '';
							listAnio = '';
							listSortBy = '';
							listSortDir = 'desc';
							colFilterConsecutivo = [];
							colFilterCliente = [];
							colFilterPeriodo = [];
							colFilterEstado = [];
							colFilterFactura = [];
							colFilterLiquidador = [];
							colFilterPlacas = [];
							filtrar();
						}}
					>
						<X class="h-3.5 w-3.5" />
						Limpiar filtros
					</button>
				</div>
			{/if}
		</div>

		<!-- Stats Cards -->
		{#if !listLoading}
			{@const filteredTotal = filteredLiquidaciones.reduce((s, l) => s + (l.total || 0), 0)}
			{@const filteredBorrador = filteredLiquidaciones.filter(
				(l) => l.estado === 'BORRADOR'
			).length}
			{@const filteredLiquidada = filteredLiquidaciones.filter(
				(l) => l.estado === 'LIQUIDADA'
			).length}
			{@const filteredAprobada = filteredLiquidaciones.filter(
				(l) => l.estado === 'APROBADA'
			).length}
			{@const filteredFacturada = filteredLiquidaciones.filter(
				(l) => l.estado === 'FACTURADA'
			).length}
			{@const m = listMetadata}
			{@const showFiltered = hasActiveFilter}
			<div
				class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
				in:fly={{ y: 8, duration: 400, delay: 150, easing: quintOut }}
			>
				<div class="stat-card">
					<p class="stat-label">Monto Total</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem;">
						{COP(showFiltered ? filteredTotal : m.globalTotal)}
					</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {COP(m.globalTotal)}
						</p>{/if}
				</div>
				<div class="stat-card">
					<p class="stat-label">Registros</p>
					<p class="stat-value">{showFiltered ? listTotal : m.globalCount}</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {m.globalCount}
						</p>{/if}
				</div>
				<div class="stat-card">
					<p class="stat-label">Borrador</p>
					<p class="stat-value" style="color: var(--text-muted);">
						{showFiltered ? filteredBorrador : m.estadoCounts['BORRADOR'] || 0}
					</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {m.estadoCounts['BORRADOR'] || 0}
						</p>{/if}
				</div>
				<div class="stat-card">
					<p class="stat-label">Liquidadas</p>
					<p class="stat-value" style="color: #2563eb;">
						{showFiltered ? filteredLiquidada : m.estadoCounts['LIQUIDADA'] || 0}
					</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {m.estadoCounts['LIQUIDADA'] || 0}
						</p>{/if}
				</div>
				<div class="stat-card">
					<p class="stat-label">Aprobadas</p>
					<p class="stat-value" style="color: var(--orange-600);">
						{showFiltered ? filteredAprobada : m.estadoCounts['APROBADA'] || 0}
					</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {m.estadoCounts['APROBADA'] || 0}
						</p>{/if}
				</div>
				<div class="stat-card">
					<p class="stat-label">Facturadas</p>
					<p class="stat-value" style="color: #7e22ce;">
						{showFiltered ? filteredFacturada : m.estadoCounts['FACTURADA'] || 0}
					</p>
					{#if showFiltered}<p
							class="font-mono-meta mt-0.5 text-[10px]"
							style="color: var(--text-very-muted);"
						>
							General: {m.estadoCounts['FACTURADA'] || 0}
						</p>{/if}
				</div>
			</div>
		{/if}

		<!-- Canvas Table -->
		<div class="table-card" in:fly={{ y: 12, duration: 400, delay: 200, easing: quintOut }}>
			{#if listLoading}
				<div class="flex items-center justify-center py-20" in:fade>
					<div class="flex flex-col items-center gap-3">
						<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
						<p class="text-sm" style="color: var(--text-muted);">Cargando liquidaciones...</p>
					</div>
				</div>
			{:else if listError}
				<div class="alert alert-error m-4" in:fade>
					<AlertCircle class="h-5 w-5" />
					<div class="flex-1">
						<p class="text-sm font-semibold">{listError}</p>
						<button
							onclick={() => cargarListado()}
							class="apple-transition mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
							style="background: rgba(220,38,38,0.10); color: #991B1B;">Reintentar</button
						>
					</div>
				</div>
			{:else if liquidaciones.length === 0}
				<div
					class="flex flex-col items-center justify-center gap-4 p-16"
					style="background: var(--bg-surface);"
					in:fade
				>
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl"
						style="background: rgba(249, 115, 22,0.08);"
					>
						<FileText class="h-7 w-7" style="color: var(--orange-500);" />
					</div>
					<div class="text-center">
						<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 400;">
							No hay liquidaciones registradas
						</h3>
						<p class="mt-1 text-sm" style="color: var(--text-muted);">
							Crea una nueva haciendo clic en el botón superior
						</p>
					</div>
					{#if isFull}
						<button onclick={irNuevaLiquidacion} class="btn-primary apple-transition">
							<Plus class="h-4 w-4" />
							Nueva Liquidación
						</button>
					{/if}
				</div>
			{:else}
				<!-- ═══ DESKTOP TABLE (hidden on mobile) ═══ -->
				<div class="hidden overflow-x-auto xl:block">
					<table class="w-full" style="min-width:1400px">
						<thead class="table-header sticky top-0 z-20">
							<tr>
								<th class="text-left" style="min-width:100px">
									<span class="flex items-center gap-1">
										<button
											type="button"
											class="group apple-transition inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
											onclick={() => toggleSort('consecutivo')}
										>
											Consecutivo
											<span
												class="transition-colors {listSortBy === 'consecutivo'
													? 'text-orange-500'
													: 'text-zinc-300 group-hover:text-zinc-400'}"
											>
												{#if listSortBy === 'consecutivo' && listSortDir === 'desc'}
													<ChevronDown class="h-3.5 w-3.5" />
												{:else}
													<ChevronUp class="h-3.5 w-3.5" />
												{/if}
											</span>
										</button>
										<MultiSelectFilter
											bind:selected={colFilterConsecutivo}
											options={uniqueConsecutivos}
											placeholder="Todos"
											searchable
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-left" style="min-width:160px">
									<span class="flex items-center gap-1">
										<button
											type="button"
											class="group apple-transition inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
											onclick={() => toggleSort('cliente')}
										>
											Cliente
											<span
												class="transition-colors {listSortBy === 'cliente'
													? 'text-orange-500'
													: 'text-zinc-300 group-hover:text-zinc-400'}"
											>
												{#if listSortBy === 'cliente' && listSortDir === 'desc'}
													<ChevronDown class="h-3.5 w-3.5" />
												{:else}
													<ChevronUp class="h-3.5 w-3.5" />
												{/if}
											</span>
										</button>
										<MultiSelectFilter
											bind:selected={colFilterCliente}
											options={uniqueClientes}
											placeholder="Todos"
											searchable
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-left" style="min-width:120px">
									<span class="flex items-center gap-1">
										<button
											type="button"
											class="group apple-transition inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
											onclick={() => toggleSort('periodo')}
										>
											Periodo
											<span
												class="transition-colors {listSortBy === 'periodo'
													? 'text-orange-500'
													: 'text-zinc-300 group-hover:text-zinc-400'}"
											>
												{#if listSortBy === 'periodo' && listSortDir === 'desc'}
													<ChevronDown class="h-3.5 w-3.5" />
												{:else}
													<ChevronUp class="h-3.5 w-3.5" />
												{/if}
											</span>
										</button>
										<MultiSelectFilter
											bind:selected={colFilterPeriodo}
											options={uniquePeriodos}
											placeholder="Todos"
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-center" style="min-width:100px">
									<span class="flex items-center justify-center gap-1">
										<button
											type="button"
											class="group apple-transition inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
											onclick={() => toggleSort('estado')}
										>
											Estado
											<span
												class="transition-colors {listSortBy === 'estado'
													? 'text-orange-500'
													: 'text-zinc-300 group-hover:text-zinc-400'}"
											>
												{#if listSortBy === 'estado' && listSortDir === 'desc'}
													<ChevronDown class="h-3.5 w-3.5" />
												{:else}
													<ChevronUp class="h-3.5 w-3.5" />
												{/if}
											</span>
										</button>
										<MultiSelectFilter
											bind:selected={colFilterEstado}
											options={uniqueEstados}
											placeholder="Todos"
											labelFn={(e) => getEstadoBadge(e as EstadoLiquidacionServicio).label}
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-center" style="min-width:110px">
									<span class="flex items-center justify-center gap-1">
										Factura
										<MultiSelectFilter
											bind:selected={colFilterFactura}
											options={uniqueFacturas}
											placeholder="Todas"
											searchable
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-center" style="min-width:70px">3° Liq.</th>
								<th class="text-right" style="min-width:120px">
									<button
										type="button"
										class="group apple-transition inline-flex w-full cursor-pointer items-center justify-end gap-1 text-right select-none hover:text-[var(--text-primary)]"
										onclick={() => toggleSort('total')}
									>
										Total
										<span
											class="transition-colors {listSortBy === 'total'
												? 'text-orange-500'
												: 'text-zinc-300 group-hover:text-zinc-400'}"
										>
											{#if listSortBy === 'total' && listSortDir === 'desc'}
												<ChevronDown class="h-3.5 w-3.5" />
											{:else}
												<ChevronUp class="h-3.5 w-3.5" />
											{/if}
										</span>
									</button>
								</th>
								<th class="text-center" style="min-width:60px">Items</th>
								<th class="text-left" style="min-width:120px">
									<span class="flex items-center gap-1">
										Liquidador
										<MultiSelectFilter
											bind:selected={colFilterLiquidador}
											options={uniqueLiquidadores}
											placeholder="Todos"
											searchable
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-left" style="min-width:110px">
									<span class="flex items-center gap-1">
										Placas
										<MultiSelectFilter
											bind:selected={colFilterPlacas}
											options={uniquePlacas}
											placeholder="Todas"
											searchable
											iconOnly
											on:change={filtrar}
										/>
									</span>
								</th>
								<th class="text-left" style="min-width:130px">
									<button
										type="button"
										class="group apple-transition inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--text-primary)]"
										onclick={() => toggleSort('fecha')}
									>
										Fecha
										<span
											class="transition-colors {listSortBy === 'fecha'
												? 'text-orange-500'
												: 'text-zinc-300 group-hover:text-zinc-400'}"
										>
											{#if listSortBy === 'fecha' && listSortDir === 'desc'}
												<ChevronDown class="h-3.5 w-3.5" />
											{:else}
												<ChevronUp class="h-3.5 w-3.5" />
											{/if}
										</span>
									</button>
								</th>
								<th class="text-center" style="min-width:200px">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each filteredLiquidaciones as liq (liq.id)}
								{@const badge = getEstadoBadge(liq.estado)}
								{@const facturaInfo = facturaInfoMap[liq.id]}
								{@const isNew = highlightedIds[liq.id] === 'created'}
								{@const isUpdated = highlightedIds[liq.id] === 'updated'}
								{@const itemsTotal = liq.total_items || 0}
								{@const isUnconfirmed = !liq.confirmada_at}
								<tr
									class="table-row {isNew
										? 'border-l-4 border-l-[var(--orange-500)] !bg-[rgba(249, 115, 22,0.08)]'
										: ''} {isUpdated
										? 'border-l-4 border-l-[#2563EB] !bg-[rgba(37,99,235,0.08)]'
										: ''}"
								>
									<td class="px-4 py-3 text-left text-xs">
										<span class="font-mono-meta text-[12px]" style="color: var(--orange-700);">
											{liq.consecutivo}
										</span>
									</td>
									<td
										class="max-w-[160px] truncate px-4 py-3 text-left text-xs"
										style="color: var(--text-secondary);"
										title={liq.cliente?.nombre || ''}>{liq.cliente?.nombre || '—'}</td
									>
									<td
										class="font-mono-meta px-4 py-3 text-left text-xs"
										style="color: var(--text-secondary); font-size: 0.7rem;"
										>{getMesLabel(liq.mes)} {liq.anio}</td
									>
									<td class="px-4 py-3 text-center text-xs">
										{#if isUnconfirmed}
											<span
												class="status-pill"
												style="background: rgba(245,158,11,0.14); color: #B45309;"
												title="Existe por autoguardado, pero el usuario todavía no pulsó Guardar"
												>Sin guardar</span
											>
										{:else}
											<span class="status-pill" style="background:{badge.bg};color:{badge.text}"
												>{liq.estado}</span
											>
										{/if}
									</td>
									<td class="px-4 py-3 text-center text-xs">
										{#if facturaInfo}
											<span
												class="font-mono-meta inline-block rounded-md px-2 py-0.5 text-[11px]"
												style="background: rgba(168,85,247,0.10); color: #7E22CE;"
												>{facturaInfo.numero_factura}</span
											>
										{:else}
											<span style="color: var(--text-very-muted);">—</span>
										{/if}
									</td>
									<td class="px-4 py-3 text-center text-xs">
										{#if liq.tercero_liquidado}
											<span
												class="font-mono-meta inline-block rounded-md px-2 py-0.5 text-[10px]"
												style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
												>Sí</span
											>
										{:else}
											<span
												class="font-mono-meta inline-block rounded-md px-2 py-0.5 text-[10px]"
												style="background: rgba(220,38,38,0.08); color: #DC2626;">No</span
											>
										{/if}
									</td>
									<td
										class="font-mono-meta px-4 py-3 text-right text-[12px] font-bold"
										style="color: var(--orange-700);">{COP(liq.total || 0)}</td
									>
									<td class="px-4 py-3 text-center text-[11px]">
										{#if itemsTotal === 0}
											<span class="font-mono-meta" style="color: var(--text-very-muted);">—</span>
										{:else}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<div
												class="relative inline-flex items-center gap-1"
												role="button"
												tabindex="0"
												onmouseenter={(e) => mostrarPopoverItems(e, liq.id)}
												onmouseleave={ocultarPopoverItems}
												onfocus={(e) => mostrarPopoverItems(e, liq.id)}
												onblur={ocultarPopoverItems}
											>
												<span
													class="font-mono-meta inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.08); color: var(--orange-700);"
												>
													<Hash class="h-3 w-3" />
													{itemsTotal}
													{itemsTotal === 1 ? 'item' : 'items'}
												</span>
												{#if itemsTotal > 4}
													<span
														class="font-mono-meta inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold"
														style="background: rgba(37,99,235,0.10); color: #2563eb; border: 1px dashed rgba(37,99,235,0.30);"
														title="{itemsTotal - 4} items adicionales"
													>
														+{itemsTotal - 4}
													</span>
												{/if}
											</div>
										{/if}
									</td>
									<td
										class="px-4 py-3 text-left text-xs whitespace-nowrap"
										style="color: var(--text-secondary);"
										>{liq.liquidado_por?.nombre || liq.creado_por?.nombre || '—'}</td
									>
									<td class="px-4 py-3 text-left text-xs">
										{#if liq.placas && liq.placas.length > 0}
											<div class="relative inline-block">
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													class="font-mono-meta apple-transition inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[10px]"
													style="background: rgba(249, 115, 22,0.08); color: var(--orange-700);"
													onmouseenter={(e) => {
														const rect = (e.target as HTMLElement).getBoundingClientRect();
														popoverPlacasPos = { top: rect.bottom + 4, left: rect.left };
														popoverPlacas = liq.placas ?? [];
														popoverPlacasVisible = true;
													}}
													onmouseleave={() => {
														popoverPlacasVisible = false;
													}}
												>
													<svg
														class="h-3 w-3"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
														/>
													</svg>
													{liq.placas.length}
													{liq.placas.length === 1 ? 'placa' : 'placas'}
												</span>
											</div>
										{:else}
											<span class="text-zinc-400">—</span>
										{/if}
									</td>
									<td
										class="px-4 py-3 text-left text-xs whitespace-nowrap"
										style="color: var(--text-muted);"
									>
										<span class="font-mono-meta text-[10px]">
											{liq.created_at
												? new Date(liq.created_at).toLocaleDateString('es-CO', {
														day: 'numeric',
														month: 'short'
													}) +
													' ' +
													new Date(liq.created_at).toLocaleTimeString('es-CO', {
														hour: '2-digit',
														minute: '2-digit',
														hour12: false
													})
												: '—'}
										</span>
									</td>
									<td class="px-4 py-3 text-center whitespace-nowrap">
										<div class="flex items-center justify-center gap-1">
											<button
												class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(249, 115, 22,0.08)]"
												style="color: var(--text-muted);"
												title="Ver"
												onclick={() => irVerLiquidacion(liq.id)}
											>
												<Eye class="h-3.5 w-3.5" />
											</button>
											{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(37,99,235,0.08)]"
													style="color: var(--text-muted);"
													title="Editar"
													onclick={() => irEditarLiquidacion(liq.id)}
												>
													<Edit2 class="h-3.5 w-3.5" />
												</button>
											{/if}
											{#if canLiquidar && liq.estado === 'BORRADOR' && !isUnconfirmed}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
													disabled={estadoChanging}
													onclick={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidar</button
												>
											{/if}
											{#if canAprobar && liq.estado === 'LIQUIDADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
													disabled={estadoChanging}
													onclick={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>Aprobar</button
												>
											{/if}
											{#if canAnular && !isUnconfirmed && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(220,38,38,0.08); color: #B91C1C;"
													disabled={estadoChanging}
													onclick={() => abrirAnularModal(liq.id)}>Anular</button
												>
											{/if}
											{#if isAdmin && liq.estado === 'ANULADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													onclick={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Revertir</button
												>
											{/if}
											{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													onclick={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Borrador</button
												>
											{/if}
											{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													onclick={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidada</button
												>
											{/if}
											{#if isFull && liq.estado === 'BORRADOR'}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(220,38,38,0.08)]"
													style="color: var(--text-muted);"
													title="Eliminar"
													onclick={() => {
														deleteTargetLiq = liq;
														deleteModalOpen = true;
													}}
												>
													<Trash2 class="h-3.5 w-3.5" />
												</button>
											{/if}
											{#if isAdmin}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(0,0,0,0.04)]"
													style="color: var(--text-muted);"
													title="Historial"
													onclick={() => abrirHistorial(liq.id, liq.consecutivo)}
												>
													<History class="h-3.5 w-3.5" />
												</button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- ═══ MOBILE CARDS (shown on mobile only) ═══ -->
				<div class="flex flex-col gap-3 p-3 xl:hidden">
					{#each filteredLiquidaciones as liq (liq.id)}
						{@const badge = getEstadoBadge(liq.estado)}
						{@const facturaInfo = facturaInfoMap[liq.id]}
						{@const isNew = highlightedIds[liq.id] === 'created'}
						{@const isUpdated = highlightedIds[liq.id] === 'updated'}
						{@const isUnconfirmed = !liq.confirmada_at}
						<div
							class="list-card flex-col items-stretch"
							style="border-left: 4px solid {isNew
								? 'var(--orange-500)'
								: isUpdated
									? '#2563EB'
									: 'var(--border-subtle)'};"
						>
							<!-- Card header -->
							<div
								class="flex items-center justify-between"
								style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.6rem; margin-bottom: 0.6rem;"
							>
								<div class="flex items-center gap-2">
									<span class="font-mono-meta text-[12px]" style="color: var(--orange-700);"
										>{liq.consecutivo}</span
									>
									{#if isUnconfirmed}
										<span
											class="status-pill"
											style="background: rgba(245,158,11,0.14); color: #B45309;">Sin guardar</span
										>
									{:else}
										<span class="status-pill" style="background:{badge.bg};color:{badge.text}"
											>{liq.estado}</span
										>
									{/if}
								</div>
								<span
									class="font-mono-meta text-right text-[12px] font-bold"
									style="color: var(--orange-700);">{COP(liq.total || 0)}</span
								>
							</div>
							<!-- Card body -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>CLIENTE</span
									>
									<span
										class="max-w-[60%] truncate text-right text-xs font-medium"
										style="color: var(--text-primary);">{liq.cliente?.nombre || '—'}</span
									>
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>PERIODO</span
									>
									<span class="font-mono-meta text-[10px]" style="color: var(--text-secondary);"
										>{getMesLabel(liq.mes)} {liq.anio}</span
									>
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>FACTURA</span
									>
									{#if facturaInfo}
										<span
											class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
											style="background: rgba(168,85,247,0.10); color: #7E22CE;"
										>
											<Receipt class="h-3 w-3" />
											{facturaInfo.numero_factura}
										</span>
									{:else}
										<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
											>—</span
										>
									{/if}
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>3° LIQ.</span
									>
									{#if liq.tercero_liquidado}
										<span
											class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
											style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
										>
											<CheckCircle2 class="h-3 w-3" />
											Sí
										</span>
									{:else}
										<span
											class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
											style="background: rgba(220,38,38,0.08); color: #DC2626;"
										>
											<X class="h-3 w-3" />
											No
										</span>
									{/if}
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>ITEMS</span
									>
									<div class="flex items-center gap-1">
										<span
											class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
											style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
										>
											<Hash class="h-3 w-3" />
											{liq.total_items || 0}
										</span>
										{#if (liq.total_items || 0) > 4}
											<span
												class="font-mono-meta inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold"
												style="background: rgba(37,99,235,0.10); color: #2563eb; border: 1px dashed rgba(37,99,235,0.30);"
											>
												+{(liq.total_items || 0) - 4}
											</span>
										{/if}
									</div>
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>LIQUIDADOR</span
									>
									<span class="text-[11px]" style="color: var(--text-secondary);"
										>{liq.liquidado_por?.nombre || liq.creado_por?.nombre || '—'}</span
									>
								</div>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);"
										>FECHA</span
									>
									<span class="font-mono-meta text-[10px]" style="color: var(--text-muted);">
										{liq.created_at
											? new Date(liq.created_at).toLocaleDateString('es-CO', {
													day: 'numeric',
													month: 'short'
												}) +
												' ' +
												new Date(liq.created_at).toLocaleTimeString('es-CO', {
													hour: '2-digit',
													minute: '2-digit',
													hour12: false
												})
											: '—'}
									</span>
								</div>
							</div>
							<!-- Card actions -->
							<div
								class="mt-2 flex flex-wrap items-center gap-1"
								style="border-top: 1px solid var(--border-subtle); padding-top: 0.6rem;"
							>
								<button
									class="apple-transition rounded-md p-1.5"
									style="color: var(--orange-700); background: rgba(249, 115, 22,0.08);"
									title="Ver"
									onclick={() => irVerLiquidacion(liq.id)}
								>
									<Eye class="h-3.5 w-3.5" />
								</button>
								{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
									<button
										class="apple-transition rounded-md p-1.5"
										style="color: #2563EB; background: rgba(37,99,235,0.08);"
										title="Editar"
										onclick={() => irEditarLiquidacion(liq.id)}
									>
										<Edit2 class="h-3.5 w-3.5" />
									</button>
								{/if}
								{#if canLiquidar && liq.estado === 'BORRADOR' && !isUnconfirmed}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
										disabled={estadoChanging}
										onclick={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidar</button
									>
								{/if}
								{#if canAprobar && liq.estado === 'LIQUIDADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
										disabled={estadoChanging}
										onclick={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>Aprobar</button
									>
								{/if}
								{#if canAnular && !isUnconfirmed && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(220,38,38,0.08); color: #B91C1C;"
										disabled={estadoChanging}
										onclick={() => abrirAnularModal(liq.id)}>Anular</button
									>
								{/if}
								{#if isAdmin && liq.estado === 'ANULADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										onclick={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Revertir</button
									>
								{/if}
								{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										onclick={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Borrador</button
									>
								{/if}
								{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										onclick={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidada</button
									>
								{/if}
								{#if isFull && liq.estado === 'BORRADOR'}
									<button
										class="apple-transition rounded-md p-1.5"
										style="color: #DC2626; background: rgba(220,38,38,0.08);"
										title="Eliminar"
										onclick={() => {
											deleteTargetLiq = liq;
											deleteModalOpen = true;
										}}
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								{/if}
								{#if isAdmin}
									<button
										class="apple-transition rounded-md p-1.5"
										style="color: var(--text-muted); background: rgba(0,0,0,0.04);"
										title="Historial"
										onclick={() => abrirHistorial(liq.id, liq.consecutivo)}
									>
										<History class="h-3.5 w-3.5" />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Pagination -->
			{#if !listLoading && listTotalPages > 1}
				<div
					class="flex items-center justify-between px-4 py-3"
					style="border-top: 1px solid var(--border-subtle); background: var(--bg-base);"
				>
					<p class="font-mono-meta text-[10px]" style="color: var(--text-muted);">
						Mostrando {(listPage - 1) * 15 + 1}–{Math.min(listPage * 15, listTotal)} de {listTotal}
					</p>
					<div class="flex items-center gap-1">
						<button
							onclick={() => irPagina(listPage - 1)}
							disabled={listPage <= 1}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(listTotalPages, 10)) as _, i}
							<button
								onclick={() => irPagina(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {listPage === i + 1
									? 'var(--orange-500)'
									: 'transparent'}; color: {listPage === i + 1
									? 'white'
									: 'var(--text-secondary)'};">{i + 1}</button
							>
						{/each}
						{#if listTotalPages > 10}<span
								class="font-mono-meta px-1 text-[10px]"
								style="color: var(--text-very-muted);">…</span
							>{/if}
						<button
							onclick={() => irPagina(listPage + 1)}
							disabled={listPage >= listTotalPages}
							aria-label="Página siguiente"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Placas popover -->
		{#if popoverPlacasVisible}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed z-50 rounded-lg p-2"
				style="top:{popoverPlacasPos.top}px;left:{popoverPlacasPos.left}px; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-card-hover);"
				onmouseenter={() => {
					popoverPlacasVisible = true;
				}}
				onmouseleave={() => {
					popoverPlacasVisible = false;
				}}
			>
				<p class="font-mono-meta mb-1 px-1 text-[10px]" style="color: var(--text-very-muted);">
					Placas
				</p>
				{#each popoverPlacas as placa}
					<div
						class="font-mono-meta rounded px-2 py-1 text-[11px]"
						style="color: var(--text-secondary);"
					>
						{placa}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Items popover (lazy loaded) -->
		{#if popoverItemsVisible}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				role="tooltip"
				class="fixed z-50 rounded-lg p-2.5"
				style="top:{popoverItemsPos.top}px;left:{popoverItemsPos.left}px; min-width: 320px; max-width: 420px; max-height: 360px; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-card-hover);"
				onmouseenter={mantenerPopoverItems}
				onmouseleave={ocultarPopoverItems}
			>
				<div class="mb-1.5 flex items-center justify-between px-1">
					<p class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);">
						Items de la liquidación
					</p>
					<span
						class="font-mono-meta rounded-full px-1.5 py-0.5 text-[9px] font-bold"
						style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
					>
						{popoverItems.length}
					</span>
				</div>
				{#if popoverItemsLoading}
					<div class="flex items-center justify-center py-4">
						<div class="spinner" style="width: 1.25rem; height: 1.25rem; border-width: 2px;"></div>
					</div>
				{:else if popoverItems.length === 0}
					<p class="font-mono-meta px-2 py-2 text-[11px]" style="color: var(--text-very-muted);">
						No hay items para mostrar
					</p>
				{:else}
					<div class="space-y-1">
						{#each popoverItems as it, idx}
							<div
								class="flex items-center gap-2 rounded-md px-2 py-1.5"
								style="background: rgba(249, 115, 22,0.04); border: 1px solid var(--border-subtle);"
							>
								<span
									class="font-mono-meta inline-flex h-5 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
									style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
								>
									{idx + 1}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span
											class="font-mono-meta text-[11px] font-bold"
											style="color: var(--orange-700);">{it.placa}</span
										>
										<span class="font-mono-meta text-[9px]" style="color: var(--text-very-muted);"
											>·</span
										>
										<span
											class="font-mono-meta truncate text-[10px]"
											style="color: var(--text-secondary);"
											title={it.recorrido || it.tipo_servicio}
										>
											{it.recorrido || it.tipo_servicio}
										</span>
									</div>
									<div class="flex items-center gap-1.5">
										<span class="font-mono-meta text-[9px]" style="color: var(--text-very-muted);"
											>{it.tipo_servicio}</span
										>
										<span class="font-mono-meta text-[9px]" style="color: var(--text-very-muted);"
											>·</span
										>
										<span
											class="font-mono-meta text-[9px] font-semibold"
											style="color: var(--text-secondary);"
										>
											{it.cantidad}× · {COP(it.valor_final || it.subtotal || 0)}
										</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{:else if facturasTab === 'facturas'}
		<!-- Header (page-card editorial) -->
		<div
			class="page-card mb-4"
			style="padding: 1.25rem 1.5rem;"
			in:fly={{ y: 12, duration: 400, easing: quintOut }}
		>
			<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div class="flex items-center gap-3">
					<div class="card-icon">
						<Receipt class="h-5 w-5 text-white" />
					</div>
					<div>
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Facturas de Liquidaciones
						</h1>
						<p class="text-xs" style="color: var(--text-muted);">
							Gestión de facturas emitidas a partir de liquidaciones aprobadas
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Filtros -->
		<div class="filter-panel mb-4" in:fly={{ y: 8, duration: 400, delay: 80, easing: quintOut }}>
			<div class="filter-panel-header">
				<span class="filter-panel-title">Filtros</span>
				{#if facturasBusqueda || facturasEstado}
					<span class="filter-count">
						{facturasTotal} resultado{facturasTotal !== 1 ? 's' : ''}
					</span>
				{/if}
			</div>
			<div class="filter-grid">
				<div class="filter-field">
					<label class="filter-field-label" for="fac-search">Búsqueda</label>
					<input
						id="fac-search"
						type="text"
						bind:value={facturasBusqueda}
						placeholder="N° factura, cliente…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="fac-estado">Estado</label>
					<select id="fac-estado" bind:value={facturasEstado}>
						<option value="">Todos los estados</option>
						<option value="ACTIVA">Activa</option>
						<option value="ANULADA">Anulada</option>
					</select>
				</div>
			</div>
			{#if facturasBusqueda || facturasEstado}
				<div class="filter-actions">
					<button
						class="filter-clear"
						onclick={() => {
							facturasBusqueda = '';
							facturasEstado = '';
							filtrarFacturas();
						}}
					>
						<X class="h-3.5 w-3.5" />
						Limpiar filtros
					</button>
				</div>
			{/if}
		</div>

		<!-- Stats Cards.
		     Igual que en Terceros: los valores vienen de `facturasMetadata`
		     (servidor, todos los registros del filtro) y no de
		     `facturas.reduce(...)`, que solo veía las 15 de la página. -->
		{#if !facturasLoading && facturas.length > 0}
			<div
				class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
				in:fly={{ y: 8, duration: 400, delay: 150, easing: quintOut }}
			>
				<div class="stat-card">
					<p class="stat-label">Total Facturado</p>
					<p
						class="stat-value font-mono-meta"
						style="font-size: 1.05rem; color: var(--bg-charcoal);"
					>
						{COP(facturasMetadata.globalTotal)}
					</p>
					<p class="stat-sub">{facturasMetadata.globalCount} factura(s)</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Liquidaciones</p>
					<p class="stat-value" style="color: var(--bg-charcoal);">
						{facturasMetadata.globalLiquidaciones}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Activas</p>
					<p class="stat-value" style="color: var(--orange-600);">
						{facturasMetadata.estadoCounts.ACTIVA ?? 0}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Anuladas</p>
					<p class="stat-value" style="color: #DC2626;">
						{facturasMetadata.estadoCounts.ANULADA ?? 0}
					</p>
				</div>
			</div>
		{/if}

		<!-- Canvas Table -->
		<div class="table-card" in:fly={{ y: 12, duration: 400, delay: 200, easing: quintOut }}>
			{#if facturasLoading}
				<div class="flex items-center justify-center py-20" in:fade>
					<div class="flex flex-col items-center gap-3">
						<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
						<p class="text-sm" style="color: var(--text-muted);">Cargando facturas…</p>
					</div>
				</div>
			{:else if facturas.length === 0}
				<div class="flex flex-col items-center justify-center gap-4 p-16" in:fade>
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl"
						style="background: rgba(249, 115, 22,0.08);"
					>
						<Receipt class="h-7 w-7" style="color: var(--orange-500);" />
					</div>
					<div class="text-center">
						<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 400;">
							No se encontraron facturas
						</h3>
						<p class="mt-1 text-sm" style="color: var(--text-muted);">
							Ajusta los filtros o crea nuevas liquidaciones para facturar
						</p>
					</div>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full" style="min-width:1000px">
						<thead class="table-header">
							<tr>
								<th class="text-left" style="min-width:110px">N° Factura</th>
								<th class="text-left" style="min-width:120px">Fecha</th>
								<th class="text-center" style="min-width:100px">Liquidaciones</th>
								<th class="text-right" style="min-width:130px">Total</th>
								<th class="text-center" style="min-width:90px">Estado</th>
								<th class="text-left" style="min-width:120px">Facturado por</th>
								<th class="text-left" style="min-width:150px">Observaciones</th>
								<th class="text-center" style="min-width:120px">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each facturas as fac (fac.id)}
								<tr class="table-row">
									<td class="px-4 py-3 text-left text-xs">
										<span class="font-mono-meta text-[12px] font-bold" style="color: #7E22CE;"
											>{fac.numero_factura}</span
										>
									</td>
									<td
										class="font-mono-meta px-4 py-3 text-left text-xs whitespace-nowrap"
										style="color: var(--text-secondary); font-size: 0.7rem;"
										>{fac.fecha_facturacion
											? new Date(fac.fecha_facturacion).toLocaleDateString('es-CO', {
													day: 'numeric',
													month: 'short',
													year: 'numeric'
												})
											: '—'}</td
									>
									<td
										class="font-mono-meta px-4 py-3 text-center text-[11px]"
										style="color: var(--text-secondary); max-width: 360px;"
									>
										<div class="flex flex-wrap items-center justify-center gap-1.5">
											{#each fac.items.slice(0, CONSECUTIVOS_VISIBLE_LIMIT) as f}
												<span class="status-pill" style="background: #dbeafe; color: #2563eb;"
													>{f.liquidacion?.consecutivo}</span
												>
											{/each}
											{#if fac.items.length > CONSECUTIVOS_VISIBLE_LIMIT}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div
													class="relative inline-block"
													role="button"
													tabindex="0"
													onmouseenter={(e) => mostrarPopoverConsecutivos(e, fac)}
													onmouseleave={ocultarPopoverConsecutivos}
													onfocus={(e) => mostrarPopoverConsecutivos(e, fac)}
													onblur={ocultarPopoverConsecutivos}
												>
													<span
														class="status-pill apple-transition inline-flex cursor-pointer items-center gap-1 font-bold"
														style="background: rgba(37,99,235,0.08); color: #2563eb; border: 1px dashed rgba(37,99,235,0.40);"
														title="Ver {fac.items.length -
															CONSECUTIVOS_VISIBLE_LIMIT} liquidaciones adicionales"
													>
														<Plus class="h-3 w-3" />
														{fac.items.length - CONSECUTIVOS_VISIBLE_LIMIT}
													</span>
												</div>
											{/if}
										</div>
									</td>
									<td
										class="font-mono-meta px-4 py-3 text-right text-[12px] font-bold"
										style="color: var(--orange-700);">{COP(fac.valor_total || 0)}</td
									>
									<td class="px-4 py-3 text-center text-xs">
										{#if fac.estado === 'ACTIVA'}
											<span
												class="status-pill"
												style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
												>Activa</span
											>
										{:else}
											<span
												class="status-pill"
												style="background: rgba(220,38,38,0.08); color: #B91C1C;">Anulada</span
											>
										{/if}
									</td>
									<td class="px-4 py-3 text-left text-xs" style="color: var(--text-secondary);"
										>{fac.facturado_por?.nombre || '—'}</td
									>
									<td
										class="max-w-[150px] truncate px-4 py-3 text-left text-xs"
										style="color: var(--text-secondary);"
										title={fac.observaciones || ''}>{fac.observaciones || '—'}</td
									>
									<td class="px-4 py-3 text-center whitespace-nowrap">
										<div class="flex items-center justify-center gap-1">
											<button
												class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(249, 115, 22,0.08)]"
												style="color: var(--text-muted);"
												title="Ver detalle"
												onclick={() => verDetalleFactura(fac.id)}
											>
												<Eye class="h-3.5 w-3.5" />
											</button>
											{#if fac.estado === 'ACTIVA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(220,38,38,0.08); color: #B91C1C;"
													onclick={() => abrirAnularFactura(fac)}>Anular</button
												>
											{/if}
											{#if fac.estado === 'ANULADA' && (isAdmin || isFacturacion)}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(220,38,38,0.08)]"
													style="color: var(--text-muted);"
													title="Eliminar"
													onclick={() => abrirEliminarFactura(fac)}
												>
													<Trash2 class="h-3.5 w-3.5" />
												</button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Consecutivos popover (additional liquidaciones) -->
				{#if popoverConsecutivosVisible}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						role="tooltip"
						class="fixed z-50 rounded-lg p-2.5"
						style="top:{popoverConsecutivosPos.top}px;left:{popoverConsecutivosPos.left}px; min-width: 200px; max-width: 320px; max-height: 320px; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-card-hover);"
						onmouseenter={mantenerPopoverConsecutivos}
						onmouseleave={ocultarPopoverConsecutivos}
					>
						<div class="mb-1.5 flex items-center justify-between px-1">
							<p class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);">
								Liquidaciones adicionales
							</p>
							<span
								class="font-mono-meta rounded-full px-1.5 py-0.5 text-[9px] font-bold"
								style="background: rgba(37,99,235,0.10); color: #2563eb;"
							>
								{popoverConsecutivos.length}
							</span>
						</div>
						<div class="flex flex-wrap gap-1.5 px-1">
							{#each popoverConsecutivos as consecutivo}
								<span class="status-pill" style="background: #dbeafe; color: #2563eb;">
									{consecutivo}
								</span>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			<!-- Pagination -->
			{#if !facturasLoading && facturasTotalPages > 1}
				<div
					class="flex items-center justify-between px-4 py-3"
					style="border-top: 1px solid var(--border-subtle); background: var(--bg-base);"
				>
					<p class="font-mono-meta text-[10px]" style="color: var(--text-muted);">
						Página {facturasPage} de {facturasTotalPages} — {facturasTotal} registros
					</p>
					<div class="flex items-center gap-1">
						<button
							disabled={facturasPage <= 1}
							onclick={() => irPaginaFacturas(facturasPage - 1)}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(facturasTotalPages, 10)) as _, i}
							<button
								onclick={() => irPaginaFacturas(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {facturasPage === i + 1
									? 'var(--orange-500)'
									: 'transparent'}; color: {facturasPage === i + 1
									? 'white'
									: 'var(--text-secondary)'};">{i + 1}</button
							>
						{/each}
						{#if facturasTotalPages > 10}<span
								class="font-mono-meta px-1 text-[10px]"
								style="color: var(--text-very-muted);">…{facturasTotalPages}</span
							>{/if}
						<button
							disabled={facturasPage >= facturasTotalPages}
							onclick={() => irPaginaFacturas(facturasPage + 1)}
							aria-label="Página siguiente"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>
	{:else if facturasTab === 'terceros'}
		<!-- TERCEROS HISTORIAL SUB-TAB — Canvas style like Recargos -->

		<!-- Header (page-card editorial) -->
		<div
			class="page-card mb-4"
			style="padding: 1.25rem 1.5rem;"
			in:fly={{ y: 12, duration: 400, easing: quintOut }}
		>
			<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div class="flex items-center gap-3">
					<div class="card-icon">
						<Users class="h-5 w-5 text-white" />
					</div>
					<div>
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Historial Liquidaciones de Terceros
						</h1>
						<p class="text-xs" style="color: var(--text-muted);">
							Detalle de liquidaciones asociadas a propietarios externos
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Filtros -->
		<div class="filter-panel mb-4" in:fly={{ y: 8, duration: 400, delay: 80, easing: quintOut }}>
			<div class="filter-panel-header">
				<span class="filter-panel-title">Filtros</span>
				<span class="filter-count">{tercerosTotal} resultado{tercerosTotal !== 1 ? 's' : ''}</span>
			</div>
			<div class="filter-grid-4">
				<div class="filter-field">
					<label class="filter-field-label" for="ter-search">Búsqueda</label>
					<input
						id="ter-search"
						type="search"
						bind:value={tercerosBusqueda}
						placeholder="Consecutivo, tercero, recorrido…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-placa">Placa</label>
					<div class="relative">
						<input id="ter-placa" type="text" bind:value={tercerosPlaca} placeholder="ABC123" />
						{#if tercerosLoading}
							<div class="absolute top-1/2 right-3 -translate-y-1/2">
								<div class="spinner" style="width: 1rem; height: 1rem; border-width: 2px;"></div>
							</div>
						{/if}
					</div>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-mes">Mes</label>
					<select id="ter-mes" bind:value={tercerosMes}>
						<option value="">Todos los meses</option>
						{#each MESES as m, i}<option value={i + 1}>{m}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-anio">Año</label>
					<input
						id="ter-anio"
						type="number"
						bind:value={tercerosAnio}
						min="2020"
						max="2030"
						placeholder="2026"
					/>
				</div>
			</div>
			<div class="filter-actions">
				<button
					class="filter-clear"
					onclick={() => {
						tercerosBusqueda = '';
						tercerosPlaca = '';
						tercerosMes = '';
						tercerosAnio = new Date().getFullYear();
						filtrarTerceros();
					}}
				>
					<X class="h-3.5 w-3.5" />
					Limpiar filtros
				</button>
			</div>
		</div>

		<!-- Stats Panel Terceros.
		     Los valores salen de `tercerosMetadata`, que el servidor calcula
		     sobre TODOS los registros del filtro. Antes eran
		     `tercerosItems.reduce(...)`, o sea la PÁGINA (limit 50): las
		     cifras cambiaban al paginar aunque el filtro fuera el mismo. -->
		{#if !tercerosLoading && tercerosItems.length > 0}
			<div
				class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
				in:fly={{ y: 8, duration: 400, delay: 150, easing: quintOut }}
			>
				<div class="stat-card">
					<p class="stat-label">Registros</p>
					<p class="stat-value" style="color: var(--bg-charcoal);">
						{tercerosMetadata.globalCount}
					</p>
					<p class="stat-sub">
						{tercerosItems.length} en esta página · {tercerosMetadata.globalClientes} cliente(s)
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Total Facturado</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #2563EB;">
						{COP(tercerosMetadata.globalFacturado)}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Admon Total</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #B45309;">
						{COP(tercerosMetadata.globalAdmon)}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">V/Liquidar</p>
					<p
						class="stat-value font-mono-meta"
						style="font-size: 1.05rem; color: var(--orange-600);"
					>
						{COP(tercerosMetadata.globalLiquidar)}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Ing. Cotransmeq</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #7E22CE;">
						{COP(tercerosMetadata.globalIngresoEmpresa)}
					</p>
				</div>
			</div>
		{/if}

		<!-- Canvas Table -->
		<div class="table-card" in:fly={{ y: 12, duration: 400, delay: 200, easing: quintOut }}>
			{#if tercerosLoading}
				<div class="flex items-center justify-center py-20" in:fade>
					<div class="flex flex-col items-center gap-3">
						<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
						<p class="text-sm" style="color: var(--text-muted);">Cargando terceros...</p>
					</div>
				</div>
			{:else if tercerosItems.length === 0}
				<div class="flex flex-col items-center justify-center gap-4 p-16" in:fade>
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl"
						style="background: rgba(249, 115, 22,0.08);"
					>
						<Users class="h-7 w-7" style="color: var(--orange-500);" />
					</div>
					<div class="text-center">
						<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 400;">
							No se encontraron items de terceros
						</h3>
						<p class="mt-1 text-sm" style="color: var(--text-muted);">
							Ajusta los filtros o crea liquidaciones con items de terceros
						</p>
					</div>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full" style="min-width:1600px">
						<thead class="table-header">
							<tr>
								<th class="text-center" style="min-width:40px">#</th>
								<th class="text-left" style="min-width:100px">Consecutivo</th>
								<th class="text-left" style="min-width:150px">Cliente</th>
								<th class="text-left" style="min-width:90px">Placa</th>
								<th class="text-left" style="min-width:110px">N° Planilla</th>
								<th class="text-left" style="min-width:180px">Tercero (Propietario)</th>
								<th class="text-left" style="min-width:200px">Recorrido</th>
								<th class="text-left" style="min-width:110px">Fechas</th>
								<th class="text-right" style="min-width:100px">V/Unidad</th>
								<th class="text-right" style="min-width:110px">Total Fact.</th>
								<th class="text-right" style="min-width:100px">Admon $</th>
								<th class="text-right" style="min-width:110px">V/Liquidar</th>
								<th class="text-right" style="min-width:120px">Ing. Cotransmeq</th>
								<th class="text-center" style="min-width:110px">N° Factura</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each tercerosItems as item, idx}
								{@const facItem = item.liquidacion?.factura_items?.[0]}
								{@const numFactura = facItem?.factura?.numero_factura || ''}
								<tr class="table-row {numFactura ? '!bg-[rgba(249, 115, 22,0.04)]' : ''}">
									<td
										class="font-mono-meta px-3 py-2 text-center text-[10px]"
										style="color: var(--text-very-muted);">{(tercerosPage - 1) * 50 + idx + 1}</td
									>
									<td class="px-3 py-2 text-left text-xs">
										<span
											class="font-mono-meta text-[12px] font-bold"
											style="color: var(--orange-700);"
											>{item.liquidacion?.consecutivo || '—'}</span
										>
									</td>
									<td
										class="max-w-[150px] truncate px-3 py-2 text-left text-xs"
										style="color: var(--text-secondary);"
										title={item.liquidacion?.cliente?.nombre || ''}
										>{item.liquidacion?.cliente?.nombre || '—'}</td
									>
									<td
										class="px-3 py-2 text-left text-xs font-bold"
										style="color: var(--text-primary);">{item.placa}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-left text-[11px]"
										style="color: var(--text-secondary);">{item.item?.numero_planilla || '—'}</td
									>
									<td
										class="max-w-[180px] truncate px-3 py-2 text-left text-xs"
										style="color: var(--text-secondary);"
										title={item.tercero?.nombre_completo || ''}
										>{item.tercero?.nombre_completo || '—'}</td
									>
									<td
										class="max-w-[200px] truncate px-3 py-2 text-left text-xs"
										style="color: var(--text-secondary);"
										title={item.recorrido}>{item.recorrido}</td
									>
									<td
										class="px-3 py-2 text-left text-xs whitespace-nowrap"
										style="color: var(--text-secondary);">{item.fechas}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px] font-semibold"
										style="color: var(--text-primary);">{COP(item.valor_unitario)}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px] font-semibold"
										style="color: var(--text-primary);">{COP(item.total_facturado)}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px]"
										style="color: var(--text-muted);">{COP(item.valor_admin)}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
										style="color: var(--orange-700);">{COP(item.valor_liquidar)}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
										style="color: var(--orange-700);">{COP(item.ingreso_empresa)}</td
									>
									<td class="px-3 py-2 text-center text-xs">
										{#if numFactura}
											<span
												class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
												style="background: rgba(249, 115, 22,0.10); color: var(--orange-700);"
											>
												<Receipt class="h-3 w-3" />
												{numFactura}
											</span>
										{:else}
											<span
												class="font-mono-meta text-[10px]"
												style="color: var(--text-very-muted);">Sin factura</span
											>
										{/if}
									</td>
								</tr>
							{/each}

							<!-- Totals Row -->
							<tr style="background: rgba(249, 115, 22,0.10);">
								<td colspan="8" class="px-3 py-2">
									<span class="font-mono-meta text-[10px]" style="color: var(--text-secondary);"
										>Totales página</span
									>
								</td>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--orange-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_unitario, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--orange-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.total_facturado, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--orange-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_admin, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--orange-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_liquidar, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--orange-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.ingreso_empresa, 0))}</td
								>
								<td class="px-3 py-2"></td>
							</tr>
						</tbody>
					</table>
				</div>
			{/if}

			<!-- Pagination -->
			{#if !tercerosLoading && tercerosTotalPages > 1}
				<div
					class="flex items-center justify-between px-4 py-3"
					style="border-top: 1px solid var(--border-subtle); background: var(--bg-base);"
				>
					<p class="font-mono-meta text-[10px]" style="color: var(--text-muted);">
						Mostrando {(tercerosPage - 1) * 50 + 1} a {Math.min(tercerosPage * 50, tercerosTotal)} de
						{tercerosTotal} registros
					</p>
					<div class="flex items-center gap-1">
						<button
							disabled={tercerosPage <= 1}
							onclick={() => irPaginaTerceros(tercerosPage - 1)}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(tercerosTotalPages, 10)) as _, i}
							<button
								onclick={() => irPaginaTerceros(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {tercerosPage === i + 1
									? 'var(--orange-500)'
									: 'transparent'}; color: {tercerosPage === i + 1
									? 'white'
									: 'var(--text-secondary)'};">{i + 1}</button
							>
						{/each}
						{#if tercerosTotalPages > 10}<span
								class="font-mono-meta px-1 text-[10px]"
								style="color: var(--text-very-muted);">…{tercerosTotalPages}</span
							>{/if}
						<button
							disabled={tercerosPage >= tercerosTotalPages}
							onclick={() => irPaginaTerceros(tercerosPage + 1)}
							aria-label="Página siguiente"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>
	{:else if facturasTab === 'configuracion'}
		<!-- CONFIG SUB-TAB -->
		<div
			class="page-card"
			style="padding: 1.5rem 1.75rem;"
			in:fly={{ y: 12, duration: 400, easing: quintOut }}
		>
			<div class="mb-5 flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div class="card-icon">
						<Settings class="h-5 w-5 text-white" />
					</div>
					<div>
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Configuración del Liquidador
						</h1>
						<p class="text-xs" style="color: var(--text-muted);">
							Parámetros base para el cálculo de servicios de transporte
						</p>
					</div>
				</div>
				<!-- El catálogo de operadoras vive aquí y no en su propia pestaña
				     porque es lo que es: un parámetro del cálculo, no una hoja de
				     datos. Y esta pestaña ya está restringida a Administración u
				     Operaciones, así que no hace falta repetir el guard. -->
				<button
					class="btn-secondary apple-transition"
					style="padding: 0.45rem 0.9rem; font-size: 12px;"
					onclick={() => (modalOperadoras = true)}
				>
					Operadoras
				</button>
			</div>

			{#if configLoading}
				<div class="flex items-center justify-center py-16">
					<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
				</div>
			{:else}
				<div class="filter-grid-4">
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-salario-basico">Salario Básico</label>
						<input
							id="cfg-salario-basico"
							type="text"
							value={fmtCOP(configForm.salario_basico)}
							onfocus={handleCOPFocus}
							onblur={(e) => handleCOPBlur(e, 'salario_basico')}
							inputmode="numeric"
							placeholder="0"
						/>
						<span class="filter-field-label-hint">SMLV vigente</span>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-cargo">Cargo</label>
						<input
							id="cfg-cargo"
							type="text"
							bind:value={configForm.cargo}
							placeholder="Ej. Conductor"
						/>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-valor-hora">Valor Hora Override</label>
						<input
							id="cfg-valor-hora"
							type="text"
							value={fmtCOP(configForm.valor_hora_override)}
							onfocus={handleCOPFocus}
							onblur={(e) => handleCOPBlur(e, 'valor_hora_override')}
							inputmode="numeric"
							placeholder="0"
						/>
						<span class="filter-field-label-hint">0 = auto ({COP(configValorHoraAuto)})</span>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-conductor-adicional"
							>Conductor Adicional</label
						>
						<input
							id="cfg-conductor-adicional"
							type="text"
							value={fmtCOP(configForm.conductor_adicional)}
							onfocus={handleCOPFocus}
							onblur={(e) => handleCOPBlur(e, 'conductor_adicional')}
							inputmode="numeric"
							placeholder="0"
						/>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-pct-seg-social">% Seg. Social</label>
						<input
							id="cfg-pct-seg-social"
							type="number"
							step="0.01"
							bind:value={configForm.pct_seg_social}
							placeholder="0.00"
						/>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-pct-prestaciones">% Prestaciones</label>
						<input
							id="cfg-pct-prestaciones"
							type="number"
							step="0.01"
							bind:value={configForm.pct_prestaciones}
							placeholder="0.00"
						/>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-pct-admin">% Admin</label>
						<input
							id="cfg-pct-admin"
							type="number"
							step="0.01"
							bind:value={configForm.pct_admin}
							placeholder="0.00"
						/>
					</div>
					<div class="filter-field">
						<label class="filter-field-label" for="cfg-prueba-covid">Prueba Covid</label>
						<input
							id="cfg-prueba-covid"
							type="text"
							value={fmtCOP(configForm.prueba_covid)}
							onfocus={handleCOPFocus}
							onblur={(e) => handleCOPBlur(e, 'prueba_covid')}
							inputmode="numeric"
							placeholder="0"
						/>
						<span class="filter-field-label-hint">0 = sin cobro</span>
					</div>
				</div>

				<div
					class="mt-6 flex justify-end"
					style="border-top: 1px dashed var(--border-subtle); padding-top: 1rem;"
				>
					<button
						class="btn-primary apple-transition"
						onclick={guardarConfig}
						disabled={configSaving}
					>
						{#if configSaving}
							<div class="spinner" style="width: 1rem; height: 1rem; border-width: 2px;"></div>
							Guardando…
						{:else}
							<CheckCircle2 class="h-4 w-4" />
							Guardar Configuración
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- DETAIL MODAL -->
{#if detailModal}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-bg" onclick={(e) => { if (e.target === e.currentTarget) cerrarDetalle(); }}>
		<div class="modal-box">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<FileText class="h-4 w-4" style="color: var(--orange-500);" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						{detailLiq?.consecutivo || 'Detalle'}
					</h3>
				</div>
				<div class="flex items-center gap-2">
					{#if detailLiq && (detailLiq.estado === 'BORRADOR' || (isAdmin && detailLiq.estado === 'LIQUIDADA'))}
						<button
							class="btn-secondary apple-transition"
							style="padding: 0.4rem 0.85rem; font-size: 11px;"
							onclick={() => {
								cerrarDetalle();
								if (detailLiq) irEditarLiquidacion(detailLiq.id);
							}}
						>
							<Edit2 class="h-3 w-3" />
							Editar
						</button>
					{/if}
					{#if detailLiq}
						<button
							class="btn-primary apple-transition"
							style="padding: 0.4rem 0.85rem; font-size: 11px;"
							onclick={() => {
								cerrarDetalle();
								if (detailLiq) irVerLiquidacion(detailLiq.id);
							}}
						>
							<Eye class="h-3 w-3" />
							Ver
						</button>
					{/if}
					<button class="btn-icon" onclick={cerrarDetalle}>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
			<div class="modal-body">
				{#if detailLoading}
					<div class="flex items-center justify-center py-12">
						<div class="spinner" style="width: 2rem; height: 2rem; border-width: 3px;"></div>
					</div>
				{:else if detailLiq}
					<div class="det-grid">
						<div>
							<div class="det-label">Consecutivo</div>
							<div
								class="det-value font-mono-meta"
								style="color: var(--orange-700); font-size: 0.9rem;"
							>
								{detailLiq.consecutivo}
							</div>
						</div>
						<div>
							<div class="det-label">Cliente</div>
							<div class="det-value">{detailLiq.cliente?.nombre || '—'}</div>
						</div>
						<div>
							<div class="det-label">NIT</div>
							<div class="det-value font-mono-meta">{detailLiq.cliente?.nit || '—'}</div>
						</div>
						<div>
							<div class="det-label">Periodo</div>
							<div class="det-value">{getMesLabel(detailLiq.mes)} {detailLiq.anio}</div>
						</div>
						<div>
							<div class="det-label">Estado</div>
							<div class="det-value">
								<span
									class="status-pill"
									style="background:{getEstadoBadge(detailLiq.estado).bg};color:{getEstadoBadge(
										detailLiq.estado
									).text}">{detailLiq.estado}</span
								>
							</div>
						</div>
						<div>
							<div class="det-label">Fecha de Creación</div>
							<div class="det-value">
								{detailLiq.created_at
									? new Date(detailLiq.created_at).toLocaleDateString('es-CO', {
											day: '2-digit',
											month: 'long',
											year: 'numeric'
										})
									: '—'}
							</div>
						</div>
					</div>

					{#if detailLiq.estado === 'ANULADA' && detailLiq.motivo_anulacion}
						<div class="det-anulacion">
							<div class="det-anulacion-hd">
								<Ban class="h-3.5 w-3.5" />
								Motivo de Anulación
							</div>
							<div class="det-anulacion-body">{detailLiq.motivo_anulacion}</div>
						</div>
					{/if}

					{#if detailLiq.items && detailLiq.items.length > 0}
						<div class="det-tbl-wrap">
							<table class="det-tbl">
								<thead>
									<tr>
										<th>Placa</th>
										<th>F. Inicial</th>
										<th>F. Final</th>
										<th>Recorrido</th>
										<th>Tipo Servicio</th>
										<th class="text-center">Cant.</th>
										<th class="text-right">Vr. Unit.</th>
										<th class="text-right">Subtotal</th>
										<th class="text-center">Dcto</th>
										<th class="text-right">Vr. Final</th>
									</tr>
								</thead>
								<tbody>
									{#each detailLiq.items as it}
										<tr>
											<td
												class="font-mono-meta"
												style="color: var(--orange-700); font-weight: 700;">{it.placa}</td
											>
											<td
												>{it.fecha_inicial
													? new Date(it.fecha_inicial).toLocaleDateString('es-CO')
													: '—'}</td
											>
											<td
												>{it.fecha_final
													? new Date(it.fecha_final).toLocaleDateString('es-CO')
													: '—'}</td
											>
											<td class="recorrido-cell">{it.recorrido || ''}</td>
											<td class="tipo-cell">{it.tipo_servicio}</td>
											<td class="text-center font-semibold">{it.cantidad}</td>
											<td class="mc">{COP(it.valor_unitario)}</td>
											<td class="mc">{COP(it.subtotal || it.cantidad * it.valor_unitario)}</td>
											<td class="text-center">{it.porcentaje_descuento || 0}%</td>
											<td class="mc" style="color: var(--orange-700); font-weight: 700;">
												{COP(it.valor_final || it.subtotal || it.cantidad * it.valor_unitario)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					<div class="det-totals">
						<div class="det-total-row">
							<span>Servicios</span>
							<span class="font-mono-meta">{COP(detailLiq.valor_servicios || 0)}</span>
						</div>
						<div class="det-total-row">
							<span>Recargos</span>
							<span class="font-mono-meta">{COP(detailLiq.valor_recargos || 0)}</span>
						</div>
						<div class="det-total-row">
							<span>Subtotal</span>
							<span class="font-mono-meta">{COP(detailLiq.subtotal || 0)}</span>
						</div>
						<div class="det-total-row">
							<span>IVA ({detailLiq.porcentaje_iva || 0}%)</span>
							<span class="font-mono-meta">{COP(detailLiq.valor_iva || 0)}</span>
						</div>
						<div class="det-total-row main">
							<span>TOTAL</span>
							<span class="font-mono-meta">{COP(detailLiq.total || 0)}</span>
						</div>
					</div>

					<div class="estado-actions">
						{#if canLiquidar && detailLiq.estado === 'BORRADOR'}
							<button
								class="btn-primary apple-transition"
								style="padding: 0.45rem 0.95rem; font-size: 12px;"
								onclick={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}
							>
								<CheckCircle2 class="h-3.5 w-3.5" />
								Liquidar
							</button>
						{/if}
						{#if canAprobar && detailLiq.estado === 'LIQUIDADA'}
							<button
								class="btn-primary apple-transition"
								style="padding: 0.45rem 0.95rem; font-size: 12px;"
								onclick={() => detailLiq && cambiarEstado(detailLiq.id, 'APROBADA')}
							>
								<CheckCircle2 class="h-3.5 w-3.5" />
								Aprobar
							</button>
						{/if}
						{#if canAnular && detailLiq.estado !== 'ANULADA' && detailLiq.estado !== 'FACTURADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(220,38,38,0.08); color: #B91C1C; border: 1px solid rgba(220,38,38,0.20); font-size: 12px; font-weight: 600;"
								onclick={() => detailLiq && abrirAnularModal(detailLiq.id)}
							>
								<Ban class="h-3.5 w-3.5" />
								Anular
							</button>
						{/if}
						{#if isAdmin && detailLiq.estado === 'ANULADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								onclick={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}
							>
								<RotateCcw class="h-3.5 w-3.5" />
								Revertir
							</button>
						{/if}
						{#if canRevertirABorrador && detailLiq.estado === 'LIQUIDADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								onclick={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}
							>
								<RotateCcw class="h-3.5 w-3.5" />
								A Borrador
							</button>
						{/if}
						{#if canRevertirALiquidada && detailLiq.estado === 'APROBADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								onclick={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}
							>
								<RotateCcw class="h-3.5 w-3.5" />
								A Liquidada
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: ELIMINAR LIQUIDACION -->
{#if deleteModalOpen && deleteTargetLiq}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		onclick={(e) => {
			if (e.target !== e.currentTarget) return;
			deleteModalOpen = false;
			deleteTargetLiq = null;
		}}
	>
		<div class="modal-box" style="max-width:440px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<Trash2 class="h-4 w-4" style="color: #DC2626;" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Eliminar Liquidación
					</h3>
				</div>
				<button
					class="btn-icon"
					onclick={() => {
						deleteModalOpen = false;
						deleteTargetLiq = null;
					}}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div class="modal-body">
				<div class="mb-4 text-center">
					<div
						class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
						style="background: rgba(220,38,38,0.08);"
					>
						<AlertCircle class="h-7 w-7" style="color: #DC2626;" />
					</div>
					<p class="text-sm font-semibold" style="color: var(--text-primary);">
						¿Estás seguro de eliminar esta liquidación?
					</p>
				</div>
				<div class="confirm-data">
					<div>
						<dt>Consecutivo</dt>
						<dd class="font-mono-meta" style="color: var(--orange-700);">
							{deleteTargetLiq.consecutivo}
						</dd>
					</div>
					<div>
						<dt>Cliente</dt>
						<dd>{deleteTargetLiq.cliente?.nombre || '—'}</dd>
					</div>
					<div>
						<dt>Total</dt>
						<dd class="font-mono-meta" style="color: var(--orange-700);">
							{COP(deleteTargetLiq.total || 0)}
						</dd>
					</div>
				</div>
				<div class="alert alert-error mb-4" style="padding: 0.65rem 0.85rem; font-size: 12px;">
					<AlertCircle class="h-4 w-4" />
					<span>Esta acción es irreversible. Se eliminarán todos los items asociados.</span>
				</div>
				<div class="flex justify-end gap-2">
					<button
						class="btn-secondary apple-transition"
						onclick={() => {
							deleteModalOpen = false;
							deleteTargetLiq = null;
						}}>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none;"
						disabled={deleting}
						onclick={() => deleteTargetLiq && eliminarLiq(deleteTargetLiq.id)}
					>
						{#if deleting}
							<div
								class="spinner"
								style="width: 0.9rem; height: 0.9rem; border-width: 2px; border-top-color: white;"
							></div>
							Eliminando…
						{:else}
							<Trash2 class="h-3.5 w-3.5" />
							Eliminar
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: ANULAR LIQUIDACION -->
{#if anularModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-bg" onclick={(e) => { if (e.target === e.currentTarget) anularModalOpen = false; }}>
		<div class="modal-box" style="max-width:480px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<Ban class="h-4 w-4" style="color: #DC2626;" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Anular Liquidación
					</h3>
				</div>
				<button class="btn-icon" onclick={() => (anularModalOpen = false)}>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div class="modal-body">
				<p class="mb-3 text-sm" style="color: var(--text-secondary);">
					Esta acción cambiará el estado a <strong style="color: #DC2626;">ANULADA</strong>. Indica
					el motivo de la anulación para su debida corrección.
				</p>
				<label
					for="anular-motivo"
					class="filter-field-label"
					style="margin-bottom: 0.35rem; display: block;"
				>
					Motivo de anulación <span style="color: #DC2626;">*</span>
				</label>
				<textarea
					id="anular-motivo"
					bind:value={anularMotivo}
					rows="4"
					placeholder="Ej: Error en valores, datos incorrectos del cliente, duplicidad..."
					class="input-glow w-full rounded-xl border p-2.5 text-sm"
					style="border-color: var(--border-default); background: var(--bg-surface); resize: vertical; font-family: inherit;"
				></textarea>
				<div class="mt-4 flex justify-end gap-2">
					<button class="btn-secondary apple-transition" onclick={() => (anularModalOpen = false)}
						>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none; opacity: {!anularMotivo.trim() ||
						estadoChanging
							? '0.5'
							: '1'};"
						disabled={!anularMotivo.trim() || estadoChanging}
						onclick={confirmarAnulacion}
					>
						{#if estadoChanging}
							<div
								class="spinner"
								style="width: 0.9rem; height: 0.9rem; border-width: 2px; border-top-color: white;"
							></div>
							Anulando…
						{:else}
							<Ban class="h-3.5 w-3.5" />
							Confirmar Anulación
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: DETALLE FACTURA -->
{#if detalleFactura}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-bg" onclick={(e) => { if (e.target === e.currentTarget) detalleFactura = null; }}>
		<div class="modal-box factura-detail-modal" style="max-width:680px">
			<!-- Header -->
			<div class="modal-hd">
				<div class="flex min-w-0 items-center gap-3">
					<div class="factura-detail-icon" aria-hidden="true">
						<Receipt class="h-4 w-4 text-white" />
					</div>
					<div class="min-w-0">
						<span class="factura-detail-eyebrow">Detalle de factura</span>
						<h3 class="factura-detail-title">
							Factura
							<span class="factura-detail-num">#{detalleFactura.numero_factura}</span>
						</h3>
					</div>
				</div>
				<button class="btn-icon" onclick={() => (detalleFactura = null)} aria-label="Cerrar">
					<X class="h-3.5 w-3.5" />
				</button>
			</div>

			<div class="modal-body">
				<!-- Status + Total row (destacado, editorial) -->
				<div class="factura-detail-summary">
					<div>
						<span class="factura-detail-label">Estado</span>
						<div class="mt-1">
							{#if detalleFactura.estado === 'ACTIVA'}
								<span class="factura-detail-badge factura-detail-badge--ok">
									<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
									Activa
								</span>
							{:else}
								<span class="factura-detail-badge factura-detail-badge--anulada">
									<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
									Anulada
								</span>
							{/if}
						</div>
					</div>
					<div class="text-right">
						<span class="factura-detail-label">Valor total</span>
						<p class="factura-detail-total">{COP(detalleFactura.valor_total || 0)}</p>
					</div>
				</div>

				<!-- Data grid -->
				<div class="factura-detail-grid">
					<div class="factura-detail-cell">
						<span class="factura-detail-label">N° Factura</span>
						<p class="factura-detail-num factura-detail-num--inline">
							#{detalleFactura.numero_factura}
						</p>
					</div>

					<div class="factura-detail-cell">
						<span class="factura-detail-label">Fecha facturación</span>
						<p class="factura-detail-value">
							{detalleFactura.fecha_facturacion
								? new Date(detalleFactura.fecha_facturacion).toLocaleDateString('es-CO', {
										day: 'numeric',
										month: 'long',
										year: 'numeric'
									})
								: '—'}
						</p>
					</div>

					<div class="factura-detail-cell">
						<span class="factura-detail-label">Facturado por</span>
						<p class="factura-detail-value">
							{detalleFactura.facturado_por?.nombre || '—'}
						</p>
					</div>

					{#if detalleFactura.anulado_por}
						<div class="factura-detail-cell">
							<span class="factura-detail-label">Anulado por</span>
							<p class="factura-detail-value factura-detail-value--danger">
								{detalleFactura.anulado_por?.nombre || '—'}
							</p>
						</div>
					{/if}

					{#if detalleFactura.observaciones}
						<div class="factura-detail-cell factura-detail-cell--full">
							<span class="factura-detail-label">Observaciones</span>
							<p class="factura-detail-value factura-detail-value--soft">
								{detalleFactura.observaciones}
							</p>
						</div>
					{/if}

					{#if detalleFactura.motivo_anulacion}
						<div class="factura-detail-cell factura-detail-cell--full">
							<span class="factura-detail-label factura-detail-label--danger">
								Motivo de anulación
							</span>
							<p class="factura-detail-value factura-detail-value--danger">
								{detalleFactura.motivo_anulacion}
							</p>
						</div>
					{/if}
				</div>

				<!-- Liquidaciones asociadas -->
				<div class="mt-5">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="factura-detail-section-title">Liquidaciones asociadas</h4>
						<span class="factura-detail-count">
							{detalleFactura.items?.length || 0}
							{detalleFactura.items?.length === 1 ? 'registro' : 'registros'}
						</span>
					</div>

					<div class="factura-detail-tbl-wrap">
						<table class="factura-detail-tbl">
							<thead>
								<tr>
									<th class="text-left">Consecutivo</th>
									<th class="text-left">Cliente</th>
									<th class="text-left">Periodo</th>
									<th class="text-right">Valor</th>
								</tr>
							</thead>
							<tbody>
								{#each detalleFactura.items || [] as item}
									<tr>
										<td class="factura-detail-tbl-num">
											{item.liquidacion?.consecutivo || '—'}
										</td>
										<td>{item.liquidacion?.cliente?.nombre || '—'}</td>
										<td class="factura-detail-tbl-meta">
											{MESES[(item.liquidacion?.mes ?? 0) - 1] ?? ''}
											{item.liquidacion?.anio ? ` ${item.liquidacion.anio}` : ''}
										</td>
										<td class="factura-detail-tbl-amount text-right">
											{COP(item.valor_liquidacion || 0)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>

				<!-- Footer actions -->
				<div class="mt-5 flex justify-end">
					<button class="btn-secondary apple-transition" onclick={() => (detalleFactura = null)}
						>Cerrar</button
					>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: ANULAR FACTURA -->
{#if anularFacturaModalOpen && anularFacturaTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		onclick={(e) => {
			if (e.target !== e.currentTarget) return;
			anularFacturaModalOpen = false;
			anularFacturaTarget = null;
		}}
	>
		<div class="modal-box" style="max-width:480px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<Ban class="h-4 w-4" style="color: #DC2626;" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Anular Factura
					</h3>
				</div>
				<button
					class="btn-icon"
					onclick={() => {
						anularFacturaModalOpen = false;
						anularFacturaTarget = null;
					}}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div class="modal-body">
				<div class="mb-3 text-center">
					<div
						class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
						style="background: rgba(220,38,38,0.08);"
					>
						<AlertCircle class="h-7 w-7" style="color: #DC2626;" />
					</div>
					<p class="text-sm font-semibold" style="color: var(--text-primary);">
						¿Anular la factura <span class="font-mono-meta" style="color: #7E22CE;"
							>#{anularFacturaTarget.numero_factura}</span
						>?
					</p>
					<p class="mt-1 text-xs" style="color: var(--text-muted);">
						Las liquidaciones asociadas volverán a estado LIQUIDADA.
					</p>
				</div>
				<label
					for="anular-factura-motivo"
					class="filter-field-label"
					style="margin-bottom: 0.35rem; display: block;"
				>
					Motivo de anulación <span style="color: #DC2626;">*</span>
				</label>
				<textarea
					id="anular-factura-motivo"
					bind:value={anularFacturaMotivo}
					rows="3"
					placeholder="Ej: Error en número de factura, liquidaciones incorrectas..."
					class="input-glow w-full rounded-xl border p-2.5 text-sm"
					style="border-color: var(--border-default); background: var(--bg-surface); resize: vertical; font-family: inherit;"
				></textarea>
				<div class="mt-4 flex justify-end gap-2">
					<button
						class="btn-secondary apple-transition"
						onclick={() => {
							anularFacturaModalOpen = false;
							anularFacturaTarget = null;
						}}>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none; opacity: {!anularFacturaMotivo.trim() ||
						anulandoFactura
							? '0.5'
							: '1'};"
						disabled={!anularFacturaMotivo.trim() || anulandoFactura}
						onclick={confirmarAnularFactura}
					>
						{#if anulandoFactura}
							<div
								class="spinner"
								style="width: 0.9rem; height: 0.9rem; border-width: 2px; border-top-color: white;"
							></div>
							Anulando…
						{:else}
							<Ban class="h-3.5 w-3.5" />
							Confirmar Anulación
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: ELIMINAR FACTURA -->
{#if eliminarFacturaModalOpen && eliminarFacturaTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		onclick={(e) => {
			if (e.target !== e.currentTarget) return;
			eliminarFacturaModalOpen = false;
			eliminarFacturaTarget = null;
		}}
	>
		<div class="modal-box" style="max-width:440px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<Trash2 class="h-4 w-4" style="color: #DC2626;" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Eliminar Factura
					</h3>
				</div>
				<button
					class="btn-icon"
					onclick={() => {
						eliminarFacturaModalOpen = false;
						eliminarFacturaTarget = null;
					}}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div class="modal-body">
				<div class="mb-4 text-center">
					<div
						class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
						style="background: rgba(220,38,38,0.08);"
					>
						<AlertCircle class="h-7 w-7" style="color: #DC2626;" />
					</div>
					<p class="text-sm font-semibold" style="color: var(--text-primary);">
						¿Eliminar permanentemente la factura <span
							class="font-mono-meta"
							style="color: #7E22CE;">#{eliminarFacturaTarget.numero_factura}</span
						>?
					</p>
				</div>
				<div class="alert alert-error mb-4" style="padding: 0.65rem 0.85rem; font-size: 12px;">
					<AlertCircle class="h-4 w-4" />
					<span
						>Esta acción es irreversible. Se eliminarán la factura y todos sus ítems asociados.</span
					>
				</div>
				<div class="flex justify-end gap-2">
					<button
						class="btn-secondary apple-transition"
						onclick={() => {
							eliminarFacturaModalOpen = false;
							eliminarFacturaTarget = null;
						}}>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none; opacity: {eliminandoFactura
							? '0.5'
							: '1'};"
						disabled={eliminandoFactura}
						onclick={confirmarEliminarFactura}
					>
						{#if eliminandoFactura}
							<div
								class="spinner"
								style="width: 0.9rem; height: 0.9rem; border-width: 2px; border-top-color: white;"
							></div>
							Eliminando…
						{:else}
							<Trash2 class="h-3.5 w-3.5" />
							Confirmar Eliminación
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL FACTURAR -->
<ModalFacturar
	bind:open={facturarModalOpen}
	liquidaciones={facturablesParaFacturar}
	preselectedIds={facturarPreselected}
	loading={facturablesLoading}
	on:created={handleFacturaCreated}
	on:close={() => (facturarModalOpen = false)}
/>

<!-- MODAL: HISTORIAL DE MODIFICACIONES -->
{#if historialModalOpen}
	<div class="modal-bg" onclick={(e) => { if (e.target === e.currentTarget) historialModalOpen = false; }}>
		<div class="modal-box" style="max-width:720px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<History class="h-4 w-4" style="color: var(--orange-500);" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Historial — <span class="font-mono-meta" style="color: var(--orange-700);"
							>#{historialLiqConsecutivo}</span
						>
					</h3>
				</div>
				<button class="btn-icon" onclick={() => (historialModalOpen = false)}>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div style="padding: 1.25rem 1.5rem;">
				{#if historialLoading}
					<div class="flex flex-col items-center justify-center gap-3 py-12">
						<div class="spinner" style="width: 2rem; height: 2rem; border-width: 3px;"></div>
						<p class="text-sm" style="color: var(--text-muted);">Cargando historial...</p>
					</div>
				{:else if historialData.length === 0}
					<div class="py-12 text-center" style="color: var(--text-muted);">
						No hay registros de historial.
					</div>
				{:else}
					<div class="historial-timeline">
						{#each historialData as entry, i}
							{@const info = getAccionLabel(entry.accion)}
							<div class="historial-entry">
								<div class="historial-dot" style="background: {info.color}; color: white;">
									<span class="text-base">{info.icon}</span>
								</div>
								<div class="historial-content">
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="font-mono-meta"
											style="background:{info.color}15;color:{info.color};border:1px solid {info.color}33; padding: 0.2rem 0.55rem; border-radius: 5px; font-size: 10px;"
											>{info.label}</span
										>
										{#if entry.estado_anterior && entry.estado_nuevo && entry.estado_anterior !== entry.estado_nuevo}
											<span class="text-xs" style="color: var(--text-secondary);">
												<span class="font-mono-meta" style="color: var(--text-muted);"
													>{entry.estado_anterior}</span
												>
												→
												<strong class="font-mono-meta" style="color: var(--text-primary);"
													>{entry.estado_nuevo}</strong
												>
											</span>
										{:else if entry.estado_nuevo}
											<span class="text-xs" style="color: var(--text-secondary);">
												Estado: <strong class="font-mono-meta">{entry.estado_nuevo}</strong>
											</span>
										{/if}
									</div>
									<div
										class="font-mono-meta mt-1 text-[10px]"
										style="color: var(--text-very-muted);"
									>
										{entry.usuario?.nombre || 'Sistema'} — {new Date(
											entry.created_at
										).toLocaleString('es-CO')}
									</div>
									{#if entry.motivo}
										<div
											class="mt-1 text-xs"
											style="color: #B45309; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.20); border-radius: 8px; padding: 0.4rem 0.6rem;"
										>
											💬 {entry.motivo}
										</div>
									{/if}
									{#if entry.snapshot}
										<button
											class="btn-ghost apple-transition"
											style="font-size: 11px; margin-top: 0.35rem;"
											onclick={() =>
												(historialExpandedId = historialExpandedId === entry.id ? null : entry.id)}
										>
											{historialExpandedId === entry.id ? '▼ Ocultar snapshot' : '▶ Ver snapshot'}
										</button>
										{#if historialExpandedId === entry.id}
											<div class="snapshot-box">
												<div class="snapshot-summary">
													<span>📄 Items: <strong>{entry.snapshot.items?.length ?? 0}</strong></span
													>
													<span
														>💰 Total: <strong class="font-mono-meta"
															>${(entry.snapshot.valor_total ?? 0).toLocaleString('es-CO')}</strong
														></span
													>
													{#if entry.snapshot.empresa}<span>🏢 {entry.snapshot.empresa}</span>{/if}
													{#if entry.snapshot.ruta}<span>🛣 {entry.snapshot.ruta}</span>{/if}
												</div>
												{#if entry.snapshot.items?.length}
													<div class="mt-2 overflow-x-auto">
														<table class="snapshot-table">
															<thead>
																<tr>
																	<th>Placa</th>
																	<th>Recorrido</th>
																	<th>Tipo</th>
																	<th>Cant</th>
																	<th>Valor</th>
																</tr>
															</thead>
															<tbody>
																{#each entry.snapshot.items as item}
																	<tr>
																		<td>{item.placa || '-'}</td>
																		<td>{item.recorrido || item.nombre_recorrido || '-'}</td>
																		<td>{item.tipo_servicio || '-'}</td>
																		<td>{item.cantidad ?? '-'}</td>
																		<td class="font-mono-meta"
																			>${(item.valor_unitario ?? item.valor ?? 0).toLocaleString(
																				'es-CO'
																			)}</td
																		>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Catálogo de operadoras. Se abre desde la pestaña de Configuración, que ya
     está restringida a Administración u Operaciones. `onCambios` recarga la
     configuración para que el resto de la pantalla no se quede con la lista
     vieja tras añadir o retirar una. -->
<ModalOperadoras
	open={modalOperadoras}
	onClose={() => (modalOperadoras = false)}
	onCambios={() => cargarConfig(true)}
/>

<style>
	.page-wrap {
		background: var(--bg-base);
		min-height: 100%;
	}

	.recargar-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		margin-bottom: 0.75rem;
		border-radius: 0.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.recargar-btn:hover {
		color: var(--bg-charcoal);
		background: rgba(0, 0, 0, 0.03);
	}

	/* ── Badge de eventos pendientes en la pestaña ────────── */
	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.25rem;
		border-radius: 9999px;
		background: var(--orange-600);
		color: #fff;
		font-size: 0.625rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	/* Segunda línea de una stat card: contexto del número de arriba
	   (cuántos hay en esta página, cuántos clientes…). */
	.stat-sub {
		margin-top: 0.15rem;
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	/* ── Modales (estructura) ─────────────────────────────── */
	.modal-bg {
		position: fixed;
		inset: 0;
		background: rgba(15, 31, 26, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		animation: modalFadeIn 0.25s var(--ease-apple, cubic-bezier(0.25, 0.46, 0.45, 0.94));
	}
	@keyframes modalFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.modal-box {
		background: var(--bg-surface);
		border-radius: 20px;
		max-width: 900px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border-subtle);
		animation: modalSlideUp 0.3s var(--ease-apple, cubic-bezier(0.25, 0.46, 0.45, 0.94));
	}
	@keyframes modalSlideUp {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.modal-hd {
		padding: 1.1rem 1.5rem;
		border-bottom: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.modal-body {
		padding: 1.25rem 1.5rem;
	}

	/* ── Modal: Detalle de Factura (sistema landing) ─────── */
	.factura-detail-icon {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		flex-shrink: 0;
	}

	.factura-detail-eyebrow {
		display: inline-block;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
	}

	.factura-detail-title {
		font-family: 'Fraunces', Georgia, serif;
		font-weight: 500;
		font-size: 1.2rem;
		color: var(--bg-charcoal);
		line-height: 1.2;
		margin: 0.2rem 0 0;
	}

	.factura-detail-num {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		color: #7e22ce;
		letter-spacing: 0.05em;
	}

	.factura-detail-num--inline {
		margin: 0.2rem 0 0;
		font-size: 0.95rem;
	}

	/* Summary row: Estado + Total */
	.factura-detail-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.15rem;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.1));
		border: 1px solid rgba(249, 115, 22, 0.22);
		border-radius: 14px;
		margin-bottom: 1.25rem;
	}

	.factura-detail-label {
		display: block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}
	.factura-detail-label--danger {
		color: #b91c1c;
	}

	.factura-detail-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid;
	}
	.factura-detail-badge--ok {
		background: rgba(249, 115, 22, 0.1);
		color: var(--orange-700);
		border-color: rgba(249, 115, 22, 0.3);
	}
	.factura-detail-badge--anulada {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.25);
	}

	.factura-detail-total {
		font-family: 'Fraunces', Georgia, serif;
		font-weight: 500;
		font-size: 1.45rem;
		color: #166534;
		margin: 0.15rem 0 0;
		line-height: 1.1;
	}

	/* Data grid */
	.factura-detail-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem 1rem;
		background: #ffffff;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 1rem 1.15rem;
	}

	.factura-detail-cell {
		padding: 0.5rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.factura-detail-cell:nth-last-child(-n + 2) {
		border-bottom: none;
	}
	.factura-detail-cell--full {
		grid-column: 1 / -1;
	}

	.factura-detail-value {
		font-size: 0.92rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0.25rem 0 0;
	}
	.factura-detail-value--soft {
		font-weight: 400;
		color: var(--text-secondary);
	}
	.factura-detail-value--danger {
		color: #b91c1c;
	}

	/* Section title + count */
	.factura-detail-section-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		margin: 0;
	}

	.factura-detail-count {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--orange-700);
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		letter-spacing: 0.05em;
	}

	/* Tabla asociada */
	.factura-detail-tbl-wrap {
		max-height: 280px;
		overflow-y: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: white;
	}

	.factura-detail-tbl {
		width: 100%;
		font-size: 0.85rem;
		border-collapse: collapse;
	}
	.factura-detail-tbl thead {
		position: sticky;
		top: 0;
		background: #fcfcfb;
		z-index: 1;
	}
	.factura-detail-tbl th {
		padding: 0.65rem 0.85rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border-subtle);
	}
	.factura-detail-tbl td {
		padding: 0.6rem 0.85rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
		color: var(--text-secondary);
	}
	.factura-detail-tbl tbody tr:last-child td {
		border-bottom: none;
	}
	.factura-detail-tbl tbody tr:hover {
		background: rgba(249, 115, 22, 0.04);
	}

	.factura-detail-tbl-num {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		color: var(--orange-700);
		letter-spacing: 0.05em;
	}
	.factura-detail-tbl-meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}
	.factura-detail-tbl-amount {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		color: var(--orange-700);
	}

	/* ── Detalle de liquidación (grid + celdas) ──────────── */
	.det-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}
	@media (max-width: 720px) {
		.det-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	.det-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--text-very-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 0.25rem;
	}
	.det-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.det-anulacion {
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		border-radius: 12px;
		padding: 0.85rem 1rem;
		margin-bottom: 1.1rem;
	}
	.det-anulacion-hd {
		font-size: 0.75rem;
		font-weight: 700;
		color: #dc2626;
		margin-bottom: 0.35rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', monospace;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.det-anulacion-body {
		font-size: 0.85rem;
		color: #7f1d1d;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.det-tbl-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		margin-top: 1rem;
		background: var(--bg-surface);
	}
	.det-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}
	.det-tbl th {
		background: var(--bg-base);
		color: var(--text-muted);
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.6rem 0.65rem;
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
		white-space: nowrap;
	}
	.det-tbl td {
		padding: 0.55rem 0.65rem;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
	}
	.det-tbl .mc {
		text-align: right;
		font-family: 'JetBrains Mono', monospace;
	}
	.det-tbl .recorrido-cell {
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.det-tbl .tipo-cell {
		font-size: 0.7rem;
	}
	.det-tbl tr:last-child td {
		border-bottom: none;
	}
	.det-totals {
		margin-top: 1rem;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		padding: 0.9rem 1.1rem;
	}
	.det-total-row {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.det-total-row.main {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--orange-700);
		padding-top: 0.55rem;
		border-top: 1px solid var(--border-subtle);
		margin-top: 0.4rem;
	}
	.estado-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 1.1rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--border-subtle);
	}

	/* ── Historial (timeline editorial) ──────────────────── */
	.historial-timeline {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.historial-entry {
		display: flex;
		gap: 0.85rem;
		position: relative;
		padding-bottom: 1.25rem;
	}
	.historial-entry:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 0.95rem;
		top: 2rem;
		bottom: 0;
		width: 2px;
		background: var(--border-subtle);
	}
	.historial-dot {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		flex-shrink: 0;
		color: #fff;
		box-shadow: 0 0 0 3px var(--bg-surface);
	}
	.historial-content {
		flex: 1;
		min-width: 0;
		padding-top: 0.15rem;
	}
	.snapshot-box {
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		padding: 0.75rem 0.9rem;
		margin-top: 0.5rem;
	}
	.snapshot-summary {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.snapshot-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.7rem;
	}
	.snapshot-table th {
		background: rgba(0, 0, 0, 0.04);
		padding: 0.3rem 0.5rem;
		text-align: left;
		font-weight: 700;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.snapshot-table td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
	}
</style>
