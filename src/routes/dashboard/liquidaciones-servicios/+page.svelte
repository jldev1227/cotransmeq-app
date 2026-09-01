<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
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
	import { checkAccess } from '$lib/config/permissions';
	import { each } from 'chart.js/helpers';

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

	let liquidaciones: LiquidacionServicio[] = [];
	let listLoading = false;
	let listError = '';
	let listPage = 1;
	let listTotalPages = 1;
	let listTotal = 0;
	let listBusqueda = '';
	let listEstado: EstadoLiquidacionServicio | '' = '';
	let listMes: string | '' = '';
	let listAnio: number | '' = '';
	let listSortBy = '';
	let listSortDir: 'asc' | 'desc' = 'desc';
	let searchInputValue = '';
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Column header multi-select filters (server-side, Excel-style)
	let colFilterConsecutivo: string[] = [];
	let colFilterCliente: string[] = [];
	let colFilterPeriodo: string[] = [];
	let colFilterEstado: string[] = [];
	let colFilterFactura: string[] = [];
	let colFilterLiquidador: string[] = [];
	let colFilterPlacas: string[] = [];

	// Popover for placas
	let popoverPlacasVisible = false;
	let popoverPlacas: string[] = [];
	let popoverPlacasPos = { top: 0, left: 0 };

	// Popover for items (lazy loaded per liquidacion)
	let popoverItemsVisible = false;
	let popoverItems: import('$lib/api/liquidaciones-servicios').ItemLiquidacionServicio[] = [];
	let popoverItemsPos = { top: 0, left: 0 };
	let popoverItemsLiqId = '';
	let popoverItemsLoading = false;
	const itemsCache: Record<
		string,
		import('$lib/api/liquidaciones-servicios').ItemLiquidacionServicio[]
	> = {};
	let itemsHideTimer: ReturnType<typeof setTimeout> | null = null;

	// Unique values for column filters (from ALL records via metadata)
	$: uniqueConsecutivos = listMetadata.consecutivos || [];
	$: uniqueClientes = listMetadata.clientes.map((c) => c.nombre);
	$: uniquePeriodos = (listMetadata.periodos || []).map((p) => `${getMesLabel(p.mes)} ${p.anio}`);
	$: uniqueEstados = listMetadata.estados || [];
	$: uniqueFacturas = listMetadata.facturas || [];
	$: uniqueLiquidadores = listMetadata.liquidadores.map((l) => l.nombre);
	$: uniquePlacas = listMetadata.placas || [];

	// filteredLiquidaciones = liquidaciones (filtering is now server-side)
	$: filteredLiquidaciones = liquidaciones;

	$: hasColumnFilter =
		colFilterConsecutivo.length > 0 ||
		colFilterCliente.length > 0 ||
		colFilterPeriodo.length > 0 ||
		colFilterEstado.length > 0 ||
		colFilterFactura.length > 0 ||
		colFilterLiquidador.length > 0 ||
		colFilterPlacas.length > 0;

	// Metadata from API
	let listMetadata: {
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
	} = {
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
	};

	$: hasActiveFilter = !!(listBusqueda || hasColumnFilter);

	let detailModal = false;
	let detailLoading = false;
	let detailLiq: LiquidacionServicio | null = null;

	let deleteModalOpen = false;
	let deleteTargetLiq: LiquidacionServicio | null = null;
	let deleting = false;

	let anularModalOpen = false;
	let anularTargetId = '';
	let anularMotivo = '';
	let estadoChanging = false;

	// Historial
	let historialModalOpen = false;
	let historialLoading = false;
	let historialData: import('$lib/api/liquidaciones-servicios').HistorialEstado[] = [];
	let historialLiqConsecutivo = '';
	let historialExpandedId: string | null = null;

	let facturarModalOpen = false;
	let facturarPreselected: string[] = [];
	let facturaInfoMap: FacturaInfoMap = {};
	let facturablesParaFacturar: LiquidacionServicio[] = [];
	let facturablesLoading = false;

	let facturasTab: 'liquidaciones' | 'facturas' | 'configuracion' | 'terceros' = 'liquidaciones';

	// Terceros historial
	let tercerosItems: TerceroItemHistorial[] = [];
	let tercerosLoading = false;
	let tercerosPage = 1;
	let tercerosTotalPages = 1;
	let tercerosTotal = 0;
	let tercerosBusqueda = '';
	let tercerosMes: number | '' = '';
	let tercerosAnio: number | '' = new Date().getFullYear();
	let tercerosPlaca = '';
	let tercerosPlacaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let facturas: FacturaLiquidacion[] = [];
	let facturasLoading = false;
	let facturasPage = 1;
	let facturasTotalPages = 1;
	let facturasTotal = 0;
	let facturasBusqueda = '';
	let facturasEstado: '' | 'ACTIVA' | 'ANULADA' = '';

	let anularFacturaModalOpen = false;
	let anularFacturaTarget: FacturaLiquidacion | null = null;
	let anularFacturaMotivo = '';
	let eliminarFacturaModalOpen = false;
	let eliminarFacturaTarget: FacturaLiquidacion | null = null;
	let eliminandoFactura = false;
	let anulandoFactura = false;

	let detalleFactura: FacturaLiquidacion | null = null;

	/* ── Config liquidador servicio ── */
	let configLoading = false;
	let configSaving = false;
	let configData: ConfigLiquidadorServicio | null = null;
	let configForm = {
		salario_basico: 0,
		cargo: 'Conductor',
		valor_hora_override: 0,
		conductor_adicional: 0,
		pct_seg_social: 0,
		pct_prestaciones: 0,
		pct_admin: 0,
		prueba_covid: 0
	};
	$: configValorHoraAuto =
		configForm.salario_basico > 0 ? +(configForm.salario_basico / 235).toFixed(4) : 0;

	async function cargarConfig() {
		configLoading = true;
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
		} catch (e: any) {
			alert(e.message || 'Error cargando config');
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
	async function cargarTerceros() {
		tercerosLoading = true;
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
		} catch (e: any) {
			alert(e.message || 'Error cargando historial terceros');
		} finally {
			tercerosLoading = false;
		}
	}
	function filtrarTerceros() {
		tercerosPage = 1;
		cargarTerceros();
	}
	function onTercerosPlacaInput(value: string) {
		tercerosPlaca = value;
		if (tercerosPlacaDebounceTimer) clearTimeout(tercerosPlacaDebounceTimer);
		tercerosPlacaDebounceTimer = setTimeout(() => {
			filtrarTerceros();
		}, 400);
	}
	function irPaginaTerceros(p: number) {
		tercerosPage = p;
		cargarTerceros();
	}

	let highlightedIds: Record<string, 'created' | 'updated'> = {};
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

	$: accessResult = checkAccess(
		$authStore.user?.role,
		$authStore.user?.area,
		'liquidaciones-servicios'
	);
	$: isFull = accessResult.level === 'full';
	$: isLimited = accessResult.level === 'limited';
	$: userAreas = Array.isArray($authStore.user?.area)
		? $authStore.user.area
		: $authStore.user?.area
			? [$authStore.user.area]
			: [];
	$: isAdmin = userAreas.includes('administracion');
	$: isFacturacion = userAreas.includes('facturacion');
	$: isOperaciones = userAreas.includes('operaciones');
	$: canLiquidar = isFull; // admin + operaciones: borrador → liquidada
	$: canAprobar = isAdmin; // solo admin: liquidada → aprobada
	$: canAnular = isAdmin; // solo admin: anular liquidaciones
	$: canRevertirABorrador = isFull; // admin + operaciones: liquidada → borrador
	$: canRevertirALiquidada = isAdmin; // solo admin: aprobada → liquidada

	let logoError = false;

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const urlTab = params.get('tab');
		const urlBusqueda = params.get('busqueda') || '';
		const urlMes = params.get('mes');
		const urlAnio = params.get('anio');
		const urlPlacas = params.get('placas');

		if (urlTab === 'facturas') facturasTab = 'facturas';
		else if (urlTab === 'terceros') facturasTab = 'terceros';
		else if (urlTab === 'configuracion') facturasTab = 'configuracion';
		else facturasTab = 'liquidaciones';

		listBusqueda = urlBusqueda;
		searchInputValue = urlBusqueda;
		if (urlMes) listMes = urlMes;
		if (urlAnio) listAnio = Number(urlAnio);
		if (urlPlacas) colFilterPlacas = urlPlacas.split(',').filter(Boolean);

		if (facturasTab === 'liquidaciones') await cargarListado();
		if (facturasTab === 'facturas') cargarFacturas();
		if (facturasTab === 'terceros') cargarTerceros();
		if (facturasTab === 'configuracion') cargarConfig();

		socketUtils.on('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.on('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.on('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.on('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.on('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.on('facturacion-anulada', handleSocketFacturacionAnulada);
	});

	onDestroy(() => {
		socketUtils.off('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.off('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.off('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.off('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.off('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.off('facturacion-anulada', handleSocketFacturacionAnulada);
		Object.values(highlightTimers).forEach((t) => clearTimeout(t));
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		if (tercerosPlacaDebounceTimer) clearTimeout(tercerosPlacaDebounceTimer);
		if (itemsHideTimer) clearTimeout(itemsHideTimer);
	});

	function handleSocketCreated(data: any) {
		if (!data?.id) return;
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			liquidaciones = [mapped, ...liquidaciones];
			listTotal += 1;
			addHighlight(data.id, 'created');
		}
	}

	function handleSocketUpdated(data: any) {
		if (!data?.id) return;
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			const idx = liquidaciones.findIndex((l) => l.id === data.id);
			if (idx >= 0) {
				liquidaciones[idx] = mapped;
				liquidaciones = [...liquidaciones];
				addHighlight(data.id, 'updated');
			} else {
				cargarListado();
			}
		}
	}

	function handleSocketDeleted(data: any) {
		if (!data?.id) return;
		liquidaciones = liquidaciones.filter((l) => l.id !== data.id);
		listTotal = Math.max(0, listTotal - 1);
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

	function handleSocketFacturacionCreated(_data: any) {
		if (facturasTab === 'facturas') cargarFacturas();
	}
	function handleSocketFacturacionAnulada(_data: any) {
		if (facturasTab === 'facturas') cargarFacturas();
	}

	function handleSocketFacturada(data: any) {
		if (!data?.id) return;
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
	}

	async function cargarListado() {
		listLoading = true;
		listError = '';
		try {
			const filtros: Record<string, any> = { page: listPage, limit: 15 };
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
				listMetadata = {
					consecutivos: [],
					periodos: [],
					facturas: [],
					estados: [],
					...res.metadata
				};
		} catch (err: any) {
			listError = err.message || 'Error al cargar liquidaciones';
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

	function filtrar() {
		listPage = 1;
		updateUrl();
		cargarListado();
	}
	function onSearchInput(value: string) {
		searchInputValue = value;
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			listBusqueda = searchInputValue;
			updateUrl();
			filtrar();
		}, 400);
	}
	function onSearchKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
			listBusqueda = searchInputValue;
			filtrar();
		}
	}
	function resetUrlParams() {
		window.history.replaceState({}, '', window.location.pathname);
	}
	function updateUrl() {
		const params = new URLSearchParams(window.location.search);
		if (facturasTab !== 'liquidaciones') params.set('tab', facturasTab);
		else params.delete('tab');
		if (listBusqueda) params.set('busqueda', listBusqueda);
		else params.delete('busqueda');
		if (listMes) params.set('mes', listMes);
		else params.delete('mes');
		if (listAnio) params.set('anio', String(listAnio));
		if (colFilterPlacas.length) params.set('placas', colFilterPlacas.join(','));
		else params.delete('placas');
		const qs = params.toString();
		window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
	}
	function cambiarTab(
		id: 'liquidaciones' | 'facturas' | 'terceros' | 'configuracion'
	) {
		facturasTab = id;
		updateUrl();
		if (id === 'facturas') cargarFacturas();
		if (id === 'terceros') cargarTerceros();
		if (id === 'configuracion') cargarConfig();
	}
	function irPagina(p: number) {
		listPage = p;
		cargarListado();
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

	async function cargarFacturas() {
		facturasLoading = true;
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
		} catch {
			facturas = [];
		} finally {
			facturasLoading = false;
		}
	}

	function filtrarFacturas() {
		facturasPage = 1;
		cargarFacturas();
	}
	function irPaginaFacturas(p: number) {
		facturasPage = p;
		cargarFacturas();
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
			<button
				on:click={() => cambiarTab(id)}
				class="apple-transition inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
				style="background-color: {facturasTab === id
					? 'rgba(249, 115, 22,0.10)'
					: 'var(--bg-surface)'}; color: {facturasTab === id
					? 'var(--emerald-700)'
					: 'var(--text-muted)'}; border: 1px solid {facturasTab === id
					? 'rgba(249, 115, 22,0.30)'
					: 'var(--border-subtle)'};"
			>
				<svelte:component this={icon} class="h-3.5 w-3.5" />
				{label}
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
								style="background: rgba(249, 115, 22,0.08); color: var(--emerald-800);"
							>
								<span
									class="h-1.5 w-1.5 animate-pulse rounded-full"
									style="background-color: var(--emerald-500);"
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
						style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700); border: 1px solid rgba(249, 115, 22,0.30);"
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
							on:click={abrirModalFacturar}
							class="btn-secondary apple-transition flex-1 xl:flex-none"
						>
							<Receipt class="h-4 w-4" />
							Facturar
						</button>
					{/if}
					{#if isFull}
						<button
							on:click={irNuevaLiquidacion}
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
						bind:value={searchInputValue}
						on:input={(e) => onSearchInput((e.target as HTMLInputElement).value)}
						on:keydown={onSearchKeyDown}
						placeholder="Consecutivo, cliente, placa…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="liq-mes">Mes</label>
					<select id="liq-mes" bind:value={listMes} on:change={filtrar}>
						<option value="">Todos los meses</option>
						{#each MESES as m}<option value={m}>{m}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="liq-anio">Año</label>
					<select id="liq-anio" bind:value={listAnio} on:change={filtrar}>
						<option value="">Todos los años</option>
						{#each YEARS as y}<option value={y}>{y}</option>{/each}
					</select>
				</div>
			</div>
			{#if hasActiveFilter}
				<div class="filter-actions">
					<button
						class="filter-clear"
						on:click={() => {
							searchInputValue = '';
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
					<p class="stat-value" style="color: var(--emerald-600);">
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
							on:click={() => cargarListado()}
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
						<FileText class="h-7 w-7" style="color: var(--emerald-500);" />
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
						<button on:click={irNuevaLiquidacion} class="btn-primary apple-transition">
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
											on:click={() => toggleSort('consecutivo')}
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
											on:click={() => toggleSort('cliente')}
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
											on:click={() => toggleSort('periodo')}
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
											on:click={() => toggleSort('estado')}
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
										on:click={() => toggleSort('total')}
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
										on:click={() => toggleSort('fecha')}
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
								<tr
									class="table-row {isNew
										? 'border-l-4 border-l-[var(--emerald-500)] !bg-[rgba(249, 115, 22,0.08)]'
										: ''} {isUpdated
										? 'border-l-4 border-l-[#2563EB] !bg-[rgba(37,99,235,0.08)]'
										: ''}"
								>
									<td class="px-4 py-3 text-left text-xs">
										<span class="font-mono-meta text-[12px]" style="color: var(--emerald-700);">
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
										<span class="status-pill" style="background:{badge.bg};color:{badge.text}"
											>{liq.estado}</span
										>
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
												style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
										style="color: var(--emerald-700);">{COP(liq.total || 0)}</td
									>
									<td class="px-4 py-3 text-center text-[11px]">
										{#if itemsTotal === 0}
											<span class="font-mono-meta" style="color: var(--text-very-muted);">—</span>
										{:else}
											<div
												class="relative inline-flex items-center gap-1"
												role="button"
												tabindex="0"
												on:mouseenter={(e) => mostrarPopoverItems(e, liq.id)}
												on:mouseleave={ocultarPopoverItems}
												on:focus={(e) => mostrarPopoverItems(e, liq.id)}
												on:blur={ocultarPopoverItems}
											>
												<span
													class="font-mono-meta inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.08); color: var(--emerald-700);"
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
												<span
													class="font-mono-meta apple-transition inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[10px]"
													style="background: rgba(249, 115, 22,0.08); color: var(--emerald-700);"
													on:mouseenter={(e) => {
														const rect = (e.target as HTMLElement).getBoundingClientRect();
														popoverPlacasPos = { top: rect.bottom + 4, left: rect.left };
														popoverPlacas = liq.placas ?? [];
														popoverPlacasVisible = true;
													}}
													on:mouseleave={() => {
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
												on:click={() => irVerLiquidacion(liq.id)}
											>
												<Eye class="h-3.5 w-3.5" />
											</button>
											{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(37,99,235,0.08)]"
													style="color: var(--text-muted);"
													title="Editar"
													on:click={() => irEditarLiquidacion(liq.id)}
												>
													<Edit2 class="h-3.5 w-3.5" />
												</button>
											{/if}
											{#if canLiquidar && liq.estado === 'BORRADOR'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
													disabled={estadoChanging}
													on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidar</button
												>
											{/if}
											{#if canAprobar && liq.estado === 'LIQUIDADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
													disabled={estadoChanging}
													on:click={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>Aprobar</button
												>
											{/if}
											{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(220,38,38,0.08); color: #B91C1C;"
													disabled={estadoChanging}
													on:click={() => abrirAnularModal(liq.id)}>Anular</button
												>
											{/if}
											{#if isAdmin && liq.estado === 'ANULADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Revertir</button
												>
											{/if}
											{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Borrador</button
												>
											{/if}
											{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(245,158,11,0.10); color: #B45309;"
													disabled={estadoChanging}
													on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidada</button
												>
											{/if}
											{#if isFull && liq.estado === 'BORRADOR'}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(220,38,38,0.08)]"
													style="color: var(--text-muted);"
													title="Eliminar"
													on:click={() => {
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
													on:click={() => abrirHistorial(liq.id, liq.consecutivo)}
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
						<div
							class="list-card flex-col items-stretch"
							style="border-left: 4px solid {isNew
								? 'var(--emerald-500)'
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
									<span class="font-mono-meta text-[12px]" style="color: var(--emerald-700);"
										>{liq.consecutivo}</span
									>
									<span class="status-pill" style="background:{badge.bg};color:{badge.text}"
										>{liq.estado}</span
									>
								</div>
								<span
									class="font-mono-meta text-right text-[12px] font-bold"
									style="color: var(--emerald-700);">{COP(liq.total || 0)}</span
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
											style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
										style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
									style="color: var(--emerald-700); background: rgba(249, 115, 22,0.08);"
									title="Ver"
									on:click={() => irVerLiquidacion(liq.id)}
								>
									<Eye class="h-3.5 w-3.5" />
								</button>
								{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
									<button
										class="apple-transition rounded-md p-1.5"
										style="color: #2563EB; background: rgba(37,99,235,0.08);"
										title="Editar"
										on:click={() => irEditarLiquidacion(liq.id)}
									>
										<Edit2 class="h-3.5 w-3.5" />
									</button>
								{/if}
								{#if canLiquidar && liq.estado === 'BORRADOR'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
										disabled={estadoChanging}
										on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidar</button
									>
								{/if}
								{#if canAprobar && liq.estado === 'LIQUIDADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
										disabled={estadoChanging}
										on:click={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>Aprobar</button
									>
								{/if}
								{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(220,38,38,0.08); color: #B91C1C;"
										disabled={estadoChanging}
										on:click={() => abrirAnularModal(liq.id)}>Anular</button
									>
								{/if}
								{#if isAdmin && liq.estado === 'ANULADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Revertir</button
									>
								{/if}
								{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>Borrador</button
									>
								{/if}
								{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
									<button
										class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
										style="background: rgba(245,158,11,0.10); color: #B45309;"
										disabled={estadoChanging}
										on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>Liquidada</button
									>
								{/if}
								{#if isFull && liq.estado === 'BORRADOR'}
									<button
										class="apple-transition rounded-md p-1.5"
										style="color: #DC2626; background: rgba(220,38,38,0.08);"
										title="Eliminar"
										on:click={() => {
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
										on:click={() => abrirHistorial(liq.id, liq.consecutivo)}
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
							on:click={() => irPagina(listPage - 1)}
							disabled={listPage <= 1}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(listTotalPages, 10)) as _, i}
							<button
								on:click={() => irPagina(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {listPage === i + 1
									? 'var(--emerald-500)'
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
							on:click={() => irPagina(listPage + 1)}
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
			<div
				class="fixed z-50 rounded-lg p-2"
				style="top:{popoverPlacasPos.top}px;left:{popoverPlacasPos.left}px; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-card-hover);"
				on:mouseenter={() => {
					popoverPlacasVisible = true;
				}}
				on:mouseleave={() => {
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
			<div
				role="tooltip"
				class="fixed z-50 rounded-lg p-2.5"
				style="top:{popoverItemsPos.top}px;left:{popoverItemsPos.left}px; min-width: 320px; max-width: 420px; max-height: 360px; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-card-hover);"
				on:mouseenter={mantenerPopoverItems}
				on:mouseleave={ocultarPopoverItems}
			>
				<div class="mb-1.5 flex items-center justify-between px-1">
					<p class="font-mono-meta text-[10px]" style="color: var(--text-very-muted);">
						Items de la liquidación
					</p>
					<span
						class="font-mono-meta rounded-full px-1.5 py-0.5 text-[9px] font-bold"
						style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
									style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
								>
									{idx + 1}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span
											class="font-mono-meta text-[11px] font-bold"
											style="color: var(--emerald-700);">{it.placa}</span
										>
										<span
											class="font-mono-meta text-[9px]"
											style="color: var(--text-very-muted);">·</span
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
										<span
											class="font-mono-meta text-[9px]"
											style="color: var(--text-very-muted);">{it.tipo_servicio}</span
										>
										<span
											class="font-mono-meta text-[9px]"
											style="color: var(--text-very-muted);">·</span
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
						on:input={filtrarFacturas}
						placeholder="N° factura, cliente…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="fac-estado">Estado</label>
					<select id="fac-estado" bind:value={facturasEstado} on:change={filtrarFacturas}>
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
						on:click={() => {
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

		<!-- Stats Cards -->
		{#if !facturasLoading && facturas.length > 0}
			{@const totalValor = facturas.reduce((s, f) => s + (f.valor_total || 0), 0)}
			{@const countActiva = facturas.filter((f) => f.estado === 'ACTIVA').length}
			{@const countAnulada = facturas.filter((f) => f.estado === 'ANULADA').length}
			{@const totalLiqs = facturas.reduce((s, f) => s + (f.items?.length || 0), 0)}
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
						{COP(totalValor)}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Liquidaciones</p>
					<p class="stat-value" style="color: var(--bg-charcoal);">{totalLiqs}</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Activas</p>
					<p class="stat-value" style="color: var(--emerald-600);">{countActiva}</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Anuladas</p>
					<p class="stat-value" style="color: #DC2626;">{countAnulada}</p>
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
						<Receipt class="h-7 w-7" style="color: var(--emerald-500);" />
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
										class="font-mono-meta px-4 py-3 text-center text-[11px] space-x-2"
										style="color: var(--text-secondary);"
									>
										{#each fac.items as f}
											<span
												class="status-pill"
												style="background: #dbeafe; color: #2563eb;"
												>{f.liquidacion?.consecutivo}</span
											>
										{/each}
									</td>
									<td
										class="font-mono-meta px-4 py-3 text-right text-[12px] font-bold"
										style="color: var(--emerald-700);">{COP(fac.valor_total || 0)}</td
									>
									<td class="px-4 py-3 text-center text-xs">
										{#if fac.estado === 'ACTIVA'}
											<span
												class="status-pill"
												style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
												on:click={() => verDetalleFactura(fac.id)}
											>
												<Eye class="h-3.5 w-3.5" />
											</button>
											{#if fac.estado === 'ACTIVA'}
												<button
													class="apple-transition rounded-md px-2 py-1 text-[10px] font-semibold"
													style="background: rgba(220,38,38,0.08); color: #B91C1C;"
													on:click={() => abrirAnularFactura(fac)}>Anular</button
												>
											{/if}
											{#if fac.estado === 'ANULADA' && (isAdmin || isFacturacion)}
												<button
													class="apple-transition rounded-lg p-1.5 transition-colors hover:bg-[rgba(220,38,38,0.08)]"
													style="color: var(--text-muted);"
													title="Eliminar"
													on:click={() => abrirEliminarFactura(fac)}
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
							on:click={() => irPaginaFacturas(facturasPage - 1)}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(facturasTotalPages, 10)) as _, i}
							<button
								on:click={() => irPaginaFacturas(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {facturasPage === i + 1
									? 'var(--emerald-500)'
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
							on:click={() => irPaginaFacturas(facturasPage + 1)}
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
						on:keydown={(e) => e.key === 'Enter' && filtrarTerceros()}
						placeholder="Consecutivo, tercero, recorrido…"
					/>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-placa">Placa</label>
					<div class="relative">
						<input
							id="ter-placa"
							type="text"
							value={tercerosPlaca}
							on:input={(e) => onTercerosPlacaInput((e.target as HTMLInputElement).value)}
							on:keydown={(e) => {
								if (e.key === 'Enter') {
									if (tercerosPlacaDebounceTimer) clearTimeout(tercerosPlacaDebounceTimer);
									filtrarTerceros();
								}
							}}
							placeholder="ABC123"
						/>
						{#if tercerosLoading}
							<div class="absolute top-1/2 right-3 -translate-y-1/2">
								<div class="spinner" style="width: 1rem; height: 1rem; border-width: 2px;"></div>
							</div>
						{/if}
					</div>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-mes">Mes</label>
					<select
						id="ter-mes"
						value={tercerosMes === '' ? '' : String(tercerosMes)}
						on:change={(e) => {
							const v = (e.target as HTMLSelectElement).value;
							tercerosMes = v === '' ? '' : parseInt(v);
							filtrarTerceros();
						}}
					>
						<option value="">Todos los meses</option>
						{#each MESES as m, i}<option value={String(i + 1)}>{m}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label class="filter-field-label" for="ter-anio">Año</label>
					<input
						id="ter-anio"
						type="number"
						bind:value={tercerosAnio}
						on:change={filtrarTerceros}
						min="2020"
						max="2030"
						placeholder="2026"
					/>
				</div>
			</div>
			<div class="filter-actions">
				<button
					class="filter-clear"
					on:click={() => {
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

		<!-- Stats Panel Terceros -->
		{#if !tercerosLoading && tercerosItems.length > 0}
			<div
				class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
				in:fly={{ y: 8, duration: 400, delay: 150, easing: quintOut }}
			>
				<div class="stat-card">
					<p class="stat-label">Registros</p>
					<p class="stat-value" style="color: var(--bg-charcoal);">{tercerosItems.length}</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Total Facturado</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #2563EB;">
						{COP(tercerosItems.reduce((s, i) => s + i.total_facturado, 0))}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Admon Total</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #B45309;">
						{COP(tercerosItems.reduce((s, i) => s + i.valor_admin, 0))}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">V/Liquidar</p>
					<p
						class="stat-value font-mono-meta"
						style="font-size: 1.05rem; color: var(--emerald-600);"
					>
						{COP(tercerosItems.reduce((s, i) => s + i.valor_liquidar, 0))}
					</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Ing. Cotransmeq</p>
					<p class="stat-value font-mono-meta" style="font-size: 1.05rem; color: #7E22CE;">
						{COP(tercerosItems.reduce((s, i) => s + i.ingreso_empresa, 0))}
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
						<Users class="h-7 w-7" style="color: var(--emerald-500);" />
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
											style="color: var(--emerald-700);"
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
										style="color: var(--emerald-700);">{COP(item.valor_liquidar)}</td
									>
									<td
										class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
										style="color: var(--emerald-700);">{COP(item.ingreso_empresa)}</td
									>
									<td class="px-3 py-2 text-center text-xs">
										{#if numFactura}
											<span
												class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
												style="background: rgba(249, 115, 22,0.10); color: var(--emerald-700);"
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
									style="color: var(--emerald-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_unitario, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--emerald-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.total_facturado, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--emerald-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_admin, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--emerald-800);"
									>{COP(tercerosItems.reduce((s, i) => s + i.valor_liquidar, 0))}</td
								>
								<td
									class="font-mono-meta px-3 py-2 text-right text-[11px] font-bold"
									style="color: var(--emerald-800);"
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
							on:click={() => irPaginaTerceros(tercerosPage - 1)}
							aria-label="Página anterior"
							class="apple-transition rounded-lg p-1.5 disabled:opacity-40"
							style="color: var(--text-muted);"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						{#each Array(Math.min(tercerosTotalPages, 10)) as _, i}
							<button
								on:click={() => irPaginaTerceros(i + 1)}
								class="apple-transition font-mono-meta min-w-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold"
								style="background: {tercerosPage === i + 1
									? 'var(--emerald-500)'
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
							on:click={() => irPaginaTerceros(tercerosPage + 1)}
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
			<div class="mb-5 flex items-center gap-3">
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
							on:focus={handleCOPFocus}
							on:blur={(e) => handleCOPBlur(e, 'salario_basico')}
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
							on:focus={handleCOPFocus}
							on:blur={(e) => handleCOPBlur(e, 'valor_hora_override')}
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
							on:focus={handleCOPFocus}
							on:blur={(e) => handleCOPBlur(e, 'conductor_adicional')}
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
							on:focus={handleCOPFocus}
							on:blur={(e) => handleCOPBlur(e, 'prueba_covid')}
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
						on:click={guardarConfig}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-bg" on:click|self={cerrarDetalle}>
		<div class="modal-box">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<FileText class="h-4 w-4" style="color: var(--emerald-500);" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						{detailLiq?.consecutivo || 'Detalle'}
					</h3>
				</div>
				<div class="flex items-center gap-2">
					{#if detailLiq && (detailLiq.estado === 'BORRADOR' || (isAdmin && detailLiq.estado === 'LIQUIDADA'))}
						<button
							class="btn-secondary apple-transition"
							style="padding: 0.4rem 0.85rem; font-size: 11px;"
							on:click={() => {
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
							on:click={() => {
								cerrarDetalle();
								if (detailLiq) irVerLiquidacion(detailLiq.id);
							}}
						>
							<Eye class="h-3 w-3" />
							Ver
						</button>
					{/if}
					<button class="btn-icon" on:click={cerrarDetalle}>
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
								style="color: var(--emerald-700); font-size: 0.9rem;"
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
												style="color: var(--emerald-700); font-weight: 700;">{it.placa}</td
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
											<td class="mc" style="color: var(--emerald-700); font-weight: 700;">
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
								on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}
							>
								<CheckCircle2 class="h-3.5 w-3.5" />
								Liquidar
							</button>
						{/if}
						{#if canAprobar && detailLiq.estado === 'LIQUIDADA'}
							<button
								class="btn-primary apple-transition"
								style="padding: 0.45rem 0.95rem; font-size: 12px;"
								on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'APROBADA')}
							>
								<CheckCircle2 class="h-3.5 w-3.5" />
								Aprobar
							</button>
						{/if}
						{#if canAnular && detailLiq.estado !== 'ANULADA' && detailLiq.estado !== 'FACTURADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(220,38,38,0.08); color: #B91C1C; border: 1px solid rgba(220,38,38,0.20); font-size: 12px; font-weight: 600;"
								on:click={() => detailLiq && abrirAnularModal(detailLiq.id)}
							>
								<Ban class="h-3.5 w-3.5" />
								Anular
							</button>
						{/if}
						{#if isAdmin && detailLiq.estado === 'ANULADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}
							>
								<RotateCcw class="h-3.5 w-3.5" />
								Revertir
							</button>
						{/if}
						{#if canRevertirABorrador && detailLiq.estado === 'LIQUIDADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}
							>
								<RotateCcw class="h-3.5 w-3.5" />
								A Borrador
							</button>
						{/if}
						{#if canRevertirALiquidada && detailLiq.estado === 'APROBADA'}
							<button
								class="apple-transition"
								style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem; border-radius: 12px; background: rgba(245,158,11,0.10); color: #B45309; border: 1px solid rgba(245,158,11,0.20); font-size: 12px; font-weight: 600;"
								on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		on:click|self={() => {
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
					on:click={() => {
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
						<dd class="font-mono-meta" style="color: var(--emerald-700);">
							{deleteTargetLiq.consecutivo}
						</dd>
					</div>
					<div>
						<dt>Cliente</dt>
						<dd>{deleteTargetLiq.cliente?.nombre || '—'}</dd>
					</div>
					<div>
						<dt>Total</dt>
						<dd class="font-mono-meta" style="color: var(--emerald-700);">
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
						on:click={() => {
							deleteModalOpen = false;
							deleteTargetLiq = null;
						}}>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none;"
						disabled={deleting}
						on:click={() => deleteTargetLiq && eliminarLiq(deleteTargetLiq.id)}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-bg" on:click|self={() => (anularModalOpen = false)}>
		<div class="modal-box" style="max-width:480px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<Ban class="h-4 w-4" style="color: #DC2626;" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Anular Liquidación
					</h3>
				</div>
				<button class="btn-icon" on:click={() => (anularModalOpen = false)}>
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
					<button class="btn-secondary apple-transition" on:click={() => (anularModalOpen = false)}
						>Cancelar</button
					>
					<button
						class="apple-transition inline-flex items-center gap-1.5"
						style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; border-radius: 12px; background: #DC2626; color: white; font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 16px rgba(220,38,38,0.30); border: none; opacity: {!anularMotivo.trim() ||
						estadoChanging
							? '0.5'
							: '1'};"
						disabled={!anularMotivo.trim() || estadoChanging}
						on:click={confirmarAnulacion}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-bg" on:click|self={() => (detalleFactura = null)}>
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
				<button class="btn-icon" on:click={() => (detalleFactura = null)} aria-label="Cerrar">
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
					<button class="btn-secondary apple-transition" on:click={() => (detalleFactura = null)}
						>Cerrar</button
					>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL: ANULAR FACTURA -->
{#if anularFacturaModalOpen && anularFacturaTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		on:click|self={() => {
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
					on:click={() => {
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
						on:click={() => {
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
						on:click={confirmarAnularFactura}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-bg"
		on:click|self={() => {
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
					on:click={() => {
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
						on:click={() => {
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
						on:click={confirmarEliminarFactura}
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
	<div class="modal-bg" on:click|self={() => (historialModalOpen = false)}>
		<div class="modal-box" style="max-width:720px">
			<div class="modal-hd">
				<div class="flex items-center gap-2">
					<History class="h-4 w-4" style="color: var(--emerald-500);" />
					<h3 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
						Historial — <span class="font-mono-meta" style="color: var(--emerald-700);"
							>#{historialLiqConsecutivo}</span
						>
					</h3>
				</div>
				<button class="btn-icon" on:click={() => (historialModalOpen = false)}>
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
											on:click={() =>
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

<style>
	.page-wrap {
		background: var(--bg-base);
		min-height: 100%;
	}

	/* ── Modales (estructura landing-cotransmeq) ─────────── */
	.modal-bg {
		position: fixed;
		inset: 0;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		animation: modalFadeIn 0.2s var(--ease-apple, cubic-bezier(0.25, 0.46, 0.45, 0.94));
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
		border-radius: 24px;
		max-width: 900px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
		border: 1px solid var(--border-subtle);
		animation: modalSlideUp 0.4s var(--ease-apple, cubic-bezier(0.25, 0.46, 0.45, 0.94));
		display: flex;
		flex-direction: column;
	}
	@keyframes modalSlideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.modal-hd {
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);
		flex-shrink: 0;
	}
	.modal-body {
		padding: 1.25rem 1.5rem;
		flex: 1;
		min-height: 0;
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
		color: var(--emerald-500);
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}

	.factura-detail-title {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-weight: 600;
		font-size: 1.2rem;
		color: var(--bg-charcoal);
		line-height: 1.2;
		margin: 0.2rem 0 0;
		letter-spacing: -0.01em;
	}

	.factura-detail-num {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-weight: 700;
		color: var(--emerald-500);
		letter-spacing: 0.05em;
		font-variant-numeric: tabular-nums;
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
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
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
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
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
		color: var(--emerald-700);
		border-color: rgba(249, 115, 22, 0.3);
	}
	.factura-detail-badge--anulada {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.25);
	}

	.factura-detail-total {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-weight: 700;
		font-size: 1.45rem;
		color: var(--emerald-700);
		margin: 0.15rem 0 0;
		line-height: 1.1;
		letter-spacing: -0.01em;
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
		color: var(--emerald-700);
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
		background: #faf7f2;
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
		color: var(--emerald-700);
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
		color: var(--emerald-700);
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
		color: var(--emerald-700);
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
