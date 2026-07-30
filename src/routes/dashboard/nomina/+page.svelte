<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { socketStore, connectSocket } from '$lib/stores/socket';
	import {
		obtenerLiquidaciones,
		obtenerAnalisis,
		eliminarLiquidacion,
		previewDesprendibles,
		enviarDesprendibles,
		generatePayslipsZip,
		downloadSinglePayslipPdf, // New import for single PDF download
		toggleDesprendibleVisible,
		toggleDesprendibleTablasVisible,
		obtenerPrimas,
		crearPrima,
		editarPrima,
		eliminarPrima as eliminarPrimaApi,
		obtenerLiquidacionPorId,
		previewPrimas,
		enviarPrimas,
		togglePrimaPortalVisible,
		obtenerPrimaConFirma,
		obtenerFirmaPrima,
		obtenerPrimaFirmaEnriquecida
	} from '$lib/api/nomina';
	import type { LiquidacionesParams } from '$lib/api/nomina';
	import type {
		Liquidacion,
		Prima,
		CreatePrimaPayload,
		PrimasStats,
		PrimaEstado
	} from '$lib/types/nomina';
	import PrimaFormModal from '$lib/components/nomina/PrimaFormModal.svelte';
	import { generarPdfPrima } from '$lib/utils/pdfPrima';
	import { toast } from 'svelte-sonner';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import {
		Users,
		Plus,
		Edit,
		Trash2,
		Eye,
		FileText,
		Mail,
		TrendingUp,
		Clock,
		ChevronUp,
		ChevronDown,
		ChevronsUpDown,
		ChevronLeft,
		ChevronRight,
		BarChart2,
		Zap,
		Moon,
		Wrench,
		AlertCircle,
		Send,
		Download,
		CheckCircle,
		XCircle,
		X,
		Sparkles
	} from 'lucide-svelte';
	import LiquidacionDetalleModal from '$lib/components/nomina/LiquidacionDetalleModal.svelte';
	// Chart.js via svelte-chartjs
	import { Bar, Doughnut } from 'svelte-chartjs';
	import {
		Chart,
		Title,
		Tooltip,
		Legend,
		BarElement,
		CategoryScale,
		LinearScale,
		ArcElement
	} from 'chart.js';
	Chart.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement);

	// =============================================
	// TIPOS ANALISIS
	// =============================================
	interface VehiculoA {
		id: string;
		placa: string;
	}
	// values llega como string JSON o array según endpoint
	interface ValuesItem {
		mes: string;
		quantity: number;
	}
	interface BonificacionA {
		vehiculo_id: string;
		name: string;
		value: number | string;
		values?: ValuesItem[] | string;
	}
	interface RecargoA {
		vehiculo_id: string;
		valor: number | string;
		pag_cliente: boolean;
		empresa_id?: string;
		porcentaje_propietario?: number | string | null;
		// El endpoint /analisis usa "clientes"; otras rutas pueden usar "empresa"
		clientes?: { id?: string; nombre: string };
		empresa?: { id?: string; nombre: string };
		mes: string;
	}
	interface PernoteA {
		vehiculo_id: string;
		cantidad: number;
		valor: number | string;
		fechas: string[];
	}
	interface MantenimientoA {
		vehiculo_id: string;
		values: ValuesItem[] | string; // también puede llegar como string
	}
	interface LiquidacionA {
		id: string;
		periodo_start?: string;
		periodo_end?: string;
		// el endpoint devuelve conductor con nombre completo ya concatenado
		conductor?: { nombre?: string; apellido?: string };
		vehiculos?: VehiculoA[];
		bonificaciones?: BonificacionA[];
		recargos?: RecargoA[];
		pernotes?: PernoteA[];
		mantenimientos?: MantenimientoA[];
	}
	interface ResBon {
		placa: string;
		nombre: string;
		mes: string;
		cantidad: number;
		valorUnitario: number;
		valorTotal: number;
		conductor: string;
	}
	interface ResRec {
		placa: string;
		valor: number;
		pagaCliente: string;
		empresa_id: string;
		empresa_nombre: string;
		mes: string;
		conductor: string;
		tipo_fila?: 'cliente' | 'propietario';
		porcentaje_propietario?: number;
	}
	interface ResPer {
		placa: string;
		cantidad: number;
		valor: number;
		valorTotal: number;
		fechas: string[];
		conductor: string;
	}
	interface ResMnt {
		placa: string;
		conductor: string;
		mes: string;
		cantidad: number;
	}

	// =============================================
	// CONSTANTES
	// =============================================
	const MESES = [
		{ valor: '01', nombre: 'Enero' },
		{ valor: '02', nombre: 'Febrero' },
		{ valor: '03', nombre: 'Marzo' },
		{ valor: '04', nombre: 'Abril' },
		{ valor: '05', nombre: 'Mayo' },
		{ valor: '06', nombre: 'Junio' },
		{ valor: '07', nombre: 'Julio' },
		{ valor: '08', nombre: 'Agosto' },
		{ valor: '09', nombre: 'Septiembre' },
		{ valor: '10', nombre: 'Octubre' },
		{ valor: '11', nombre: 'Noviembre' },
		{ valor: '12', nombre: 'Diciembre' }
	];
	const MESES_MAP: Record<string, string> = {
		Enero: '01',
		Febrero: '02',
		Marzo: '03',
		Abril: '04',
		Mayo: '05',
		Junio: '06',
		Julio: '07',
		Agosto: '08',
		Septiembre: '09',
		Octubre: '10',
		Noviembre: '11',
		Diciembre: '12'
	};
	const ITEMS_PER_PAGE_A = 10;

	const MAIN_TABS = [
		{ key: 'liquidaciones', label: 'Liquidaciones', icon: FileText },
		{ key: 'primas', label: 'Primas', icon: Sparkles },
		{ key: 'analisis', label: 'Análisis', icon: BarChart2 }
	];
	const ANALISIS_TABS = [
		{ key: 'bonificaciones', label: 'Bonificaciones', icon: Zap },
		{ key: 'recargos', label: 'Recargos', icon: TrendingUp },
		{ key: 'pernotes', label: 'Pernotes', icon: Moon },
		{ key: 'mantenimientos', label: 'Mantenimientos', icon: Wrench }
	];

	// =============================================
	// TAB PRINCIPAL (desde URL)
	// =============================================
	$: mainTab = $page.url.searchParams.get('tab') ?? 'liquidaciones';

	function setMainTab(tab: string) {
		const u = new URL($page.url.href);
		u.searchParams.set('tab', tab);
		goto(u.toString(), { replaceState: true, noScroll: true });
		// Limpiar selecciones entre tabs para que la barra de bulk no muestre IDs del otro tab
		selectedLiquidaciones.clear();
		selectedLiquidaciones = selectedLiquidaciones;
		selectedPrimas.clear();
		selectedPrimas = selectedPrimas;
	}

	// =============================================
	// CACHE KEY (sessionStorage)
	// =============================================
	const CACHE_KEY = 'nomina_filters';

	function saveFiltersToCache() {
		try {
			sessionStorage.setItem(
				CACHE_KEY,
				JSON.stringify({
					searchTerm,
					nominaMonth,
					sortBy,
					sortOrder,
					page: pagination.page
				})
			);
		} catch {
			/* ignore */
		}
	}

	function loadFiltersFromCache() {
		try {
			const raw = sessionStorage.getItem(CACHE_KEY);
			if (!raw) return;
			const cached = JSON.parse(raw);
			if (cached.searchTerm) searchTerm = cached.searchTerm;
			if (cached.nominaMonth) nominaMonth = cached.nominaMonth;
			if (cached.sortBy) sortBy = cached.sortBy;
			if (cached.sortOrder) sortOrder = cached.sortOrder;
			if (cached.page) pagination.page = cached.page;
		} catch {
			/* ignore */
		}
	}

	// =============================================
	// ESTADO — LIQUIDACIONES LIST
	// =============================================
	let liquidaciones: Liquidacion[] = [];
	let loading = true;
	let searchTerm = '';
	let searchTimeout: ReturnType<typeof setTimeout>;
	let selectedLiquidaciones: Set<string> = new Set();
	let showDeleteModal = false;
	let liquidacionToDelete: string | null = null;
	let showDetalleModal = false;
	let detalleId = '';
	let generatingPDFs = false;
	let pdfProgress = 0;
	let downloadingSinglePdf: string | null = null; // Stores the ID of the payslip being downloaded
	let generatingBulkPdfZip = false; // New state variable for bulk PDF zip download
	// Preview modal para envío de desprendibles
	let showPreviewModal = false;
	let previewItems: Array<{
		liquidacionId: string;
		conductor: string;
		email: string | null;
		periodo_inicio: string;
		periodo_fin: string;
		sueldo_total: number;
		estado: string;
		canSend: boolean;
	}> = [];
	let previewLoading = false;
	let sendingEmails = false;
	let sendResults: Array<{
		liquidacionId: string;
		conductor: string;
		email?: string;
		status: 'enviado' | 'error';
		message?: string;
	}> = [];
	let sendComplete = false;

	let pagination = { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false };
	let stats = {
		totalRegistros: 0,
		totalPendientes: 0,
		montoTotal: 0,
		totalVisibles: 0,
		totalFirmados: 0
	};
	let sortBy = '';
	let sortOrder: 'asc' | 'desc' = 'desc';
	let nominaMonth = '';

	// =============================================
	// ESTADO — PRIMAS
	// =============================================
	let primas: Prima[] = [];
	let loadingPrimas = true;
	let searchPrimas = '';
	let searchPrimasTimeout: ReturnType<typeof setTimeout>;
	let selectedPrimas: Set<string> = new Set();
	let showDeletePrimaModal = false;
	let primaToDelete: string | null = null;
	let showPrimaFormModal = false;
	let primaToEdit: Prima | null = null;
	let savingPrima = false;
	let downloadingPrimaPdf: string | null = null;

	// Preview / envío de primas (separado del de liquidaciones)
	let showPreviewPrimasModal = false;
	let previewPrimaItems: Array<{
		primaId: string;
		conductor: string;
		email: string | null;
		mes: number;
		anio: number;
		prima: number;
		prima_pendiente: number | null;
		estado: string;
		canSend: boolean;
	}> = [];
	let previewPrimasLoading = false;
	let sendingPrimasEmails = false;
	let sendPrimasResults: Array<{
		primaId: string;
		conductor: string;
		email?: string;
		status: 'enviado' | 'error';
		message?: string;
		portalLink?: string;
	}> = [];
	let sendPrimasComplete = false;
	let paginationPrimas = {
		total: 0,
		page: 1,
		limit: 20,
		totalPages: 0,
		hasNext: false,
		hasPrev: false
	};
	let statsPrimas: PrimasStats = { total: 0, totalPendientes: 0, totalPagados: 0, montoTotal: 0 };
	let filtroPrimaMes: number | '' = '';
	let filtroPrimaAnio: number | '' = '';
	let sortByPrima = '';
	let sortOrderPrima: 'asc' | 'desc' = 'desc';

	// =============================================
	// ESTADO — ANÁLISIS
	// =============================================
	let liquidacionesA: LiquidacionA[] = [];
	let loadingA = true;
	let filtroPlaca = '';
	let showDropdown = false;
	let selectedIndex = 1;
	let filtroMes = '';
	let filtroAno = '';
	let analisisTab: 'bonificaciones' | 'recargos' | 'pernotes' | 'mantenimientos' = 'bonificaciones';
	let pagesBon = 1,
		pagesRec = 1,
		pagesPer = 1;

	// =============================================
	// CICLO DE VIDA
	// =============================================
	onMount(() => {
		const disconnect = connectSocket();

		$socketStore?.on('progress:start', ({ total }) => {
			generatingBulkPdfZip = true;
			pdfProgress = 0;
			toast.info(`Iniciando generación de ${total} PDFs...`);
		});

		$socketStore?.on('progress:update', ({ current, total }) => {
			pdfProgress = Math.round((current / total) * 100);
		});

		$socketStore?.on('progress:complete', () => {
			generatingBulkPdfZip = false;
			pdfProgress = 100;
			toast.success('ZIP de desprendibles generado y listo para descargar.');
		});

		$socketStore?.on('progress:error', ({ message }) => {
			generatingBulkPdfZip = false;
			toast.error(message);
		});

		return () => {
			disconnect?.();
		};
	});

	onMount(async () => {
		loadFiltersFromCache();
		await Promise.all([cargarLiquidaciones(), cargarAnalisis(), cargarPrimas()]);
	});

	// =============================================
	// API — LISTA
	// =============================================
	async function cargarLiquidaciones() {
		try {
			loading = true;
			const params: LiquidacionesParams = { page: pagination.page, limit: pagination.limit };
			if (searchTerm.trim()) params.search = searchTerm.trim();
			if (sortBy) {
				params.sortBy = sortBy;
				params.sortOrder = sortOrder;
			}
			if (nominaMonth) params.nomina_month = nominaMonth;
			const r = await obtenerLiquidaciones(params);
			liquidaciones = r.data || [];
			if (r.pagination) pagination = { ...pagination, ...r.pagination };
			if (r.stats) stats = r.stats;
		} catch {
			toast.error('Error al cargar las liquidaciones');
		} finally {
			loading = false;
		}
	}

	async function cargarAnalisis() {
		try {
			loadingA = true;
			const r: any = await obtenerAnalisis();
			// El endpoint devuelve { data: { liquidaciones: [...] } }
			// Intentamos varias formas de llegar al array por si el apiClient
			// ya desenvuelve algún nivel.
			const raw = r?.data?.liquidaciones ?? r?.liquidaciones ?? r?.data ?? r ?? [];
			liquidacionesA = (Array.isArray(raw) ? raw : []) as LiquidacionA[];
		} catch (e) {
			console.error('Error análisis:', e);
			toast.error('Error al cargar datos de análisis');
		} finally {
			loadingA = false;
		}
	}

	// =============================================
	// API — PRIMAS
	// =============================================
	async function cargarPrimas() {
		try {
			loadingPrimas = true;
			const params: any = { page: paginationPrimas.page, limit: paginationPrimas.limit };
			if (searchPrimas.trim()) params.search = searchPrimas.trim();
			if (filtroPrimaMes) params.mes = filtroPrimaMes;
			if (filtroPrimaAnio) params.anio = filtroPrimaAnio;
			if (sortByPrima) {
				params.sortBy = sortByPrima;
				params.sortOrder = sortOrderPrima;
			}
			const t0 = performance.now();
			const r: any = await obtenerPrimas(params);
			const dt = Math.round(performance.now() - t0);
			primas = r.data?.primas || r.data || [];
			
			const totalFirmados = primas.filter((p: any) => {
				return (
					p.firmado === true ||
					p.firmado === 1 ||
					p.firmado === 'true' ||
					p.firmada === true ||
					p.firmada === 1 ||
					p.firmada === 'true' ||
					p.is_firmado === true ||
					(Array.isArray(p.firmas_primas) && p.firmas_primas.length > 0) ||
					p.fecha_firma != null
				);
			}).length;
			if (r.data?.pagination) paginationPrimas = { ...paginationPrimas, ...r.data.pagination };
			if (r.data?.stats) statsPrimas = r.data.stats;
			// Persistir en sessionStorage para que el mock de envío de emails
			// pueda resolver el email del conductor sin volver a la API.
			try {
				sessionStorage.setItem('primas_cache', JSON.stringify(primas));
			} catch {
				/* ignore */
			}
		} catch (e) {
			console.error('❌ [Primas] Error cargando primas:', e);
			toast.error('Error al cargar las primas');
		} finally {
			loadingPrimas = false;
		}
	}

	function handleSearchPrimas() {
		clearTimeout(searchPrimasTimeout);
		searchPrimasTimeout = setTimeout(() => {
			paginationPrimas.page = 1;
			cargarPrimas();
		}, 400);
	}

	function handlePrimaMesChange() {
		paginationPrimas.page = 1;
		cargarPrimas();
	}

	function clearPrimaFilters() {
		searchPrimas = '';
		filtroPrimaMes = '';
		filtroPrimaAnio = '';
		paginationPrimas.page = 1;
		cargarPrimas();
	}

	function togglePrimaSelection(id: string) {
		selectedPrimas.has(id) ? selectedPrimas.delete(id) : selectedPrimas.add(id);
		selectedPrimas = selectedPrimas;
	}

	function abrirCrearPrima() {
		primaToEdit = null;
		showPrimaFormModal = true;
	}

	function abrirEditarPrima(p: Prima) {
		primaToEdit = p;
		showPrimaFormModal = true;
	}

	function confirmarEliminarPrima(id: string) {
		primaToDelete = id;
		showDeletePrimaModal = true;
	}

	async function eliminarPrima() {
		if (!primaToDelete) return;
		try {
			await eliminarPrimaApi(primaToDelete);
			toast.success('Prima eliminada correctamente');
			await cargarPrimas();
			showDeletePrimaModal = false;
			primaToDelete = null;
		} catch (e) {
			toast.error('Error al eliminar la prima');
		}
	}

	async function handleGuardarPrima(payload: CreatePrimaPayload) {
		try {
			savingPrima = true;
			if (primaToEdit) {
				await editarPrima(primaToEdit.id, payload);
				toast.success('Prima actualizada');
			} else {
				await crearPrima(payload);
				toast.success('Prima creada');
			}
			showPrimaFormModal = false;
			primaToEdit = null;
			await cargarPrimas();
		} catch (e: any) {
			console.error('Error guardando prima:', e);
			toast.error(e?.response?.data?.message || 'Error al guardar la prima');
		} finally {
			savingPrima = false;
		}
	}

	async function handleDescargarPdfPrima(p: Prima) {
		try {
			downloadingPrimaPdf = p.id;
			const firmas: any[] = [];
			let firmaOrigen: 'prima' | 'nomina' | null = null;

			try {
				// 1) PRIORIDAD: Firma propia de la prima (vía endpoint enriquecido del dashboard)
				//    Este endpoint usa auth de admin, por lo que funciona aunque no haya
				//    sesión de portal del conductor. El backend aplica fallback automático
				//    a firma de nómina del mismo conductor del mismo mes/año (±1 mes).
				try {
					const firmaEnriquecida: any = await obtenerPrimaFirmaEnriquecida(p.id);
					if (firmaEnriquecida?.presignedUrl) {
						firmas.push({
							presignedUrl: firmaEnriquecida.presignedUrl,
							fecha_firma: firmaEnriquecida.fecha_firma
						});
						firmaOrigen = firmaEnriquecida.origen || 'prima';
					}
				} catch (e) {
					console.warn(
						'[Prima PDF] No se pudo obtener firma de prima vía endpoint enriquecido (admin):',
						e
					);
				}
			} catch (e) {
				console.warn('No se pudo obtener firma para la prima:', e);
			}

			await generarPdfPrima(p, firmas);
			if (firmas.length) {
				const msg =
					firmaOrigen === 'prima'
						? 'PDF generado con firma de prima del conductor'
						: 'PDF generado con firma del desprendible (mismo periodo)';
				toast.success(msg);
			} else {
				toast('PDF generado sin firma', {
					description:
						'El conductor aún no ha firmado esta prima ni el desprendible del mismo periodo.',
					duration: 5000
				});
			}
		} catch (e) {
			console.error('Error generando PDF de prima:', e);
			toast.error('Error al generar el PDF de prima');
		} finally {
			downloadingPrimaPdf = null;
		}
	}

	function getPrimaMesLabel(mes: number): string {
		const nombres = [
			'',
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
		return nombres[mes] || 'N/A';
	}

	function getPrimaEstadoColor(e: PrimaEstado): string {
		return e === 'Pagado'
			? 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)]'
			: 'bg-[rgba(245,158,11,0.10)] text-[#92400E]';
	}

	function getPrimaFirmaInfo(p: Prima): { label: string; classes: string; icon: any } {
		const raw: any = p as any;
		const firmadoFlag =
			raw?.firmado === true ||
			raw?.firmado === 1 ||
			raw?.firmado === 'true' ||
			raw?.firmada === true ||
			raw?.firmada === 1 ||
			raw?.firmada === 'true' ||
			raw?.is_firmado === true ||
			(typeof raw?.firmas_primas_count === 'number' && raw.firmas_primas_count > 0) ||
			(Array.isArray(raw?.firmas_primas) && raw.firmas_primas.length > 0) ||
			raw?.fecha_firma != null;

		if (firmadoFlag) {
			return {
				label: 'Firmado',
				classes: 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)]',
				icon: CheckCircle
			};
		}
		return {
			label: 'Sin firmar',
			classes: 'bg-[var(--bg-base)] text-[var(--text-muted)]',
			icon: XCircle
		};
	}

	// ── Selección / Bulk actions / Preview / Envío (primas) ─────────
	function togglePrimaSelectAll() {
		if (selectedPrimas.size === primas.length) {
			selectedPrimas.clear();
		} else {
			primas.forEach((p) => selectedPrimas.add(p.id));
		}
		selectedPrimas = selectedPrimas;
	}

	async function handleBulkTogglePrimaVisible(visible: boolean) {
		if (selectedPrimas.size === 0) {
			toast.error('Selecciona al menos una prima');
			return;
		}
		try {
			const ids = Array.from(selectedPrimas);
			await togglePrimaPortalVisible(ids, visible);
			toast.success(
				`${ids.length} prima(s) ${visible ? 'visibles en portal' : 'ocultas del portal'}`
			);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function handleTogglePrimaVisible(id: string) {
		try {
			await togglePrimaPortalVisible([id], true);
			toast.success('Prima visible en el portal del conductor');
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function abrirPreviewPrimas() {
		if (selectedPrimas.size === 0) {
			toast.error('Selecciona al menos una prima');
			return;
		}
		try {
			previewPrimasLoading = true;
			sendPrimasComplete = false;
			sendPrimasResults = [];
			showPreviewPrimasModal = true;
			const r = await previewPrimas(Array.from(selectedPrimas));
			previewPrimaItems = r.items ?? [];
		} catch (err: any) {
			toast.error('Error al cargar preview de primas');
			showPreviewPrimasModal = false;
		} finally {
			previewPrimasLoading = false;
		}
	}

	async function confirmarEnvioPrimas() {
		const idsToSend = previewPrimaItems.filter((p) => p.canSend).map((p) => p.primaId);
		if (idsToSend.length === 0) {
			toast.error('No hay conductores con email válido');
			return;
		}
		try {
			sendingPrimasEmails = true;
			const r = await enviarPrimas(idsToSend);
			sendPrimasResults = r.resultados ?? [];
			sendPrimasComplete = true;
			const ok = r.enviados ?? 0;
			const err = r.errores ?? 0;
			toast.success(`${ok} email(s) enviado(s)${err ? `, ${err} con error` : ''}`);
			selectedPrimas.clear();
			selectedPrimas = selectedPrimas;
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al enviar primas');
		} finally {
			sendingPrimasEmails = false;
		}
	}

	function cerrarPreviewPrimasModal() {
		showPreviewPrimasModal = false;
		previewPrimaItems = [];
		sendPrimasResults = [];
		sendPrimasComplete = false;
	}

	// =============================================
	// ACCIONES — LISTA
	// =============================================
	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
			saveFiltersToCache();
			cargarLiquidaciones();
		}, 400);
	}
	function toggleSort(col: string) {
		if (sortBy === col) {
			sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
		} else {
			sortBy = col;
			sortOrder = 'desc';
		}
		pagination.page = 1;
		saveFiltersToCache();
		cargarLiquidaciones();
	}
	function handleMonthChange() {
		pagination.page = 1;
		saveFiltersToCache();
		cargarLiquidaciones();
	}
	function clearMonthFilter() {
		nominaMonth = '';
		pagination.page = 1;
		saveFiltersToCache();
		cargarLiquidaciones();
	}
	function goToPage(p: number) {
		if (p < 1 || p > pagination.totalPages) return;
		pagination.page = p;
		saveFiltersToCache();
		cargarLiquidaciones();
	}
	function handleLimitChange() {
		pagination.page = 1;
		saveFiltersToCache();
		cargarLiquidaciones();
	}

	function irACrear() {
		goto('/dashboard/nomina/agregar');
	}
	function irAEditar(id: string) {
		goto(`/dashboard/nomina/editar/${id}`);
	}
	function verDetalle(id: string) {
		detalleId = id;
		showDetalleModal = true;
	}

	function confirmarEliminar(id: string) {
		liquidacionToDelete = id;
		showDeleteModal = true;
	}
	async function eliminar() {
		if (!liquidacionToDelete) return;
		try {
			await eliminarLiquidacion(liquidacionToDelete);
			toast.success('Liquidación eliminada correctamente');
			await cargarLiquidaciones();
			showDeleteModal = false;
			liquidacionToDelete = null;
		} catch {
			toast.error('Error al eliminar la liquidación');
		}
	}

	function toggleSelection(id: string) {
		selectedLiquidaciones.has(id)
			? selectedLiquidaciones.delete(id)
			: selectedLiquidaciones.add(id);
		selectedLiquidaciones = selectedLiquidaciones;
	}
	function toggleSelectAll() {
		selectedLiquidaciones.size === liquidaciones.length
			? selectedLiquidaciones.clear()
			: liquidaciones.forEach((l) => selectedLiquidaciones.add(l.id));
		selectedLiquidaciones = selectedLiquidaciones;
	}

	async function abrirPreviewDesprendibles() {
		if (selectedLiquidaciones.size === 0) {
			toast.error('Selecciona al menos una liquidación');
			return;
		}
		try {
			previewLoading = true;
			sendComplete = false;
			sendResults = [];
			showPreviewModal = true;
			const r = await previewDesprendibles(Array.from(selectedLiquidaciones));
			previewItems = r.data?.items ?? [];
		} catch (err: any) {
			toast.error('Error al cargar preview');
			showPreviewModal = false;
		} finally {
			previewLoading = false;
		}
	}

	async function confirmarEnvioDesprendibles() {
		const idsToSend = previewItems.filter((p) => p.canSend).map((p) => p.liquidacionId);
		if (idsToSend.length === 0) {
			toast.error('No hay conductores con email válido');
			return;
		}
		try {
			sendingEmails = true;
			const r = await enviarDesprendibles(idsToSend);
			sendResults = r.data?.resultados ?? [];
			sendComplete = true;
			toast.success(r.message || `${r.data?.enviados} email(s) enviado(s)`);
			selectedLiquidaciones.clear();
			selectedLiquidaciones = selectedLiquidaciones;
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al enviar desprendibles');
		} finally {
			sendingEmails = false;
		}
	}

	async function handleToggleVisible(id: string, currentValue: boolean) {
		try {
			await toggleDesprendibleVisible([id], !currentValue);
			const idx = liquidaciones.findIndex((l) => l.id === id);
			if (idx !== -1) {
				liquidaciones[idx].desprendible_visible = !currentValue;
				liquidaciones = liquidaciones;
			}
			toast.success(
				!currentValue ? 'Desprendible visible en portal' : 'Desprendible oculto del portal'
			);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function handleToggleTablaRecargos(id: string, currentValue: boolean) {
		try {
			await toggleDesprendibleTablasVisible([id], !currentValue);
			const idx = liquidaciones.findIndex((l) => l.id === id);
			if (idx !== -1) {
				liquidaciones[idx].mostrar_recargos = !currentValue;
				liquidaciones = liquidaciones;
			}
			toast.success(
				!currentValue ? 'Tablas visible en Desprendible' : 'Tablas oculto en Desprendible'
			);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function handleBulkToggleVisible(visible: boolean) {
		if (selectedLiquidaciones.size === 0) {
			toast.error('Selecciona al menos una liquidación');
			return;
		}
		try {
			const ids = Array.from(selectedLiquidaciones);
			await toggleDesprendibleVisible(ids, visible);
			liquidaciones = liquidaciones.map((l) =>
				ids.includes(l.id) ? { ...l, desprendible_visible: visible } : l
			);
			toast.success(`${ids.length} desprendible(s) ${visible ? 'visibles' : 'ocultos'}`);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	function cerrarPreviewModal() {
		showPreviewModal = false;
		previewItems = [];
		sendResults = [];
		sendComplete = false;
	}

	async function handleDownloadSinglePayslip(liquidacion: Liquidacion) {
		if (!liquidacion?.id || !liquidacion?.conductor?.nombre || !liquidacion?.periodo_fin) {
			toast.error('Datos de liquidación incompletos para descargar PDF');
			return;
		}

		downloadingSinglePdf = liquidacion.id;
		try {
			const response = await downloadSinglePayslipPdf(liquidacion.id);

			const blob = new Blob([response], { type: 'application/pdf' });
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;

			// Format filename: conductor_name_month_year.pdf
			const conductorName = liquidacion.conductor.nombre.replace(/\s+/g, '_').toLowerCase();
			const date = new Date(liquidacion.periodo_fin);
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const year = date.getFullYear();
			a.download = `desprendible_${conductorName}_${month}_${year}.pdf`;

			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);

			toast.success('Desprendible PDF descargado');
		} catch (err: any) {
			console.error('Error al descargar PDF:', err);
			toast.error(err?.response?.data?.message || 'Error al descargar el desprendible PDF');
		} finally {
			downloadingSinglePdf = null;
		}
	}

	async function handleDownloadBulkPayslipsZip() {
		if (selectedLiquidaciones.size === 0) {
			toast.error('Selecciona al menos una liquidación para descargar desprendibles');
			return;
		}

		if (!$socketStore) {
			toast.error('Socket no conectado. Reintentando...');
			connectSocket();
			return;
		}

		generatingBulkPdfZip = true;
		try {
			const ids = Array.from(selectedLiquidaciones);
			const response = await generatePayslipsZip(ids, $socketStore.id);

			const blob = new Blob([response], { type: 'application/zip' });
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `desprendibles_multiples_${new Date().toISOString().split('T')[0]}.zip`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);

			toast.success(`${ids.length} desprendibles PDF (ZIP) descargados`);
			selectedLiquidaciones.clear();
			selectedLiquidaciones = selectedLiquidaciones;
		} catch (err: any) {
			console.error('Error al descargar ZIP de desprendibles:', err);
			toast.error(err?.response?.data?.message || 'Error al generar el ZIP de desprendibles');
		} finally {
			generatingBulkPdfZip = false;
		}
	}

	// =============================================
	// FORMATO
	// =============================================	function formatCurrency(n: number) {
	function formatCurrency(n: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}
	function formatDateShort(s: string) {
		if (!s) return '';
		const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
		return isNaN(d.getTime())
			? ''
			: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
	function formatShort(n: number) {
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
		return `$${n}`;
	}
	function getEstadoColor(e: string) {
		return e === 'Liquidado'
			? 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)]'
			: e === 'Pendiente'
				? 'bg-[rgba(245,158,11,0.10)] text-[#92400E]'
				: 'bg-[var(--bg-base)] text-[var(--text-secondary)]';
	}
	function getPageNumbers(cur: number, total: number): (number | string)[] {
		const pages: (number | string)[] = [];
		if (total <= 7) {
			for (let i = 1; i <= total; i++) pages.push(i);
		} else {
			pages.push(1);
			if (cur > 3) pages.push('...');
			for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.push(i);
			if (cur < total - 2) pages.push('...');
			pages.push(total);
		}
		return pages;
	}

	// =============================================
	// ANÁLISIS — HELPERS
	// =============================================

	/** values puede llegar como string JSON o ya como array */
	function parseValues(raw: ValuesItem[] | string | undefined): ValuesItem[] {
		if (!raw) return [];
		if (typeof raw === 'string') {
			try {
				return JSON.parse(raw) as ValuesItem[];
			} catch {
				return [];
			}
		}
		return raw;
	}

	/**
	 * Normaliza el campo mes a número de 2 dígitos ("01".."12").
	 * Acepta: "Enero", "2026-01", "01"
	 */
	function normalizeMes(mes: string): string {
		if (!mes) return '';
		// Formato YYYY-MM
		if (/^\d{4}-\d{2}$/.test(mes)) return mes.split('-')[1];
		// Nombre de mes
		return MESES_MAP[mes] || mes;
	}

	/** El endpoint devuelve conductor.nombre ya con apellido concatenado */
	function getConductorA(liq: LiquidacionA): string {
		return liq.conductor?.nombre?.trim() || 'Sin nombre';
	}

	/** Nombre de empresa: clientes.nombre o empresa.nombre */
	function getEmpresaNombre(rec: RecargoA): string {
		return rec.clientes?.nombre || rec.empresa?.nombre || '—';
	}

	function agruparFechas(fechas: string[]): string[] {
		if (!fechas?.length) return [];
		const sorted = [...fechas].sort();
		const grupos: string[] = [];
		let ini = sorted[0],
			ant = sorted[0];
		for (let i = 1; i < sorted.length; i++) {
			const diff = Math.round((new Date(sorted[i]).getTime() - new Date(ant).getTime()) / 86400000);
			if (diff === 1) {
				ant = sorted[i];
			} else {
				grupos.push(ini === ant ? ini : `${ini} al ${ant}`);
				ini = sorted[i];
				ant = sorted[i];
			}
		}
		grupos.push(ini === ant ? ini : `${ini} al ${ant}`);
		return grupos;
	}

	// =============================================
	// ANÁLISIS — DATOS DERIVADOS
	// =============================================
	$: anosA = (() => {
		const s = new Set<string>();
		liquidacionesA.forEach((l) => {
			if (l.periodo_start) s.add(new Date(l.periodo_start).getFullYear().toString());
		});
		return Array.from(s).sort((a, b) => +b - +a);
	})();

	$: selectedIndex = 1;

	$: placasA = (() => {
		const s = new Set<string>();
		liquidacionesA.forEach((l) =>
			l.vehiculos?.forEach((v) => {
				if (v.placa) s.add(v.placa);
			})
		);
		return Array.from(s).sort();
	})();

	$: placasFiltradas = placasA.filter((p) => p.toLowerCase().includes(filtroPlaca.toLowerCase()));

	$: liqFiltradas = liquidacionesA.filter((l) => {
		if (!l.periodo_start) return false;
		if (filtroAno && new Date(l.periodo_start).getFullYear().toString() !== filtroAno) return false;
		if (filtroPlaca && !l.vehiculos?.some((v) => v.placa === filtroPlaca)) return false;
		return true;
	});

	$: datosBon = (() => {
		const res: ResBon[] = [];
		liqFiltradas.forEach((liq) => {
			liq.bonificaciones?.forEach((bon) => {
				if (!bon.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === bon.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const vals = parseValues(bon.values);
				vals.forEach((item) => {
					const mesNorm = normalizeMes(item.mes);
					if (filtroMes && mesNorm !== filtroMes) return;
					if (item.quantity <= 0) return;
					const vu = Number(bon.value);
					// Mostrar el mes en formato legible
					const mesLabel = MESES.find((m) => m.valor === mesNorm)?.nombre || item.mes;
					res.push({
						placa: v.placa,
						nombre: bon.name,
						mes: mesLabel,
						cantidad: item.quantity,
						valorUnitario: vu,
						valorTotal: vu * item.quantity,
						conductor: getConductorA(liq)
					});
				});
			});
		});
		const map = new Map<string, ResBon>();
		res.forEach((item) => {
			const k = `${item.placa}|${item.nombre}|${item.valorUnitario}|${item.conductor}`;
			const e = map.get(k);
			if (e) {
				e.cantidad += item.cantidad;
				e.valorTotal += item.valorTotal;
			} else map.set(k, { ...item });
		});
		return Array.from(map.values());
	})();

	$: datosRec = (() => {
		const res: ResRec[] = [];
		liqFiltradas.forEach((liq) => {
			liq.recargos?.forEach((rec) => {
				if (!rec.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === rec.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const mesNorm = normalizeMes(rec.mes);
				if (filtroMes && mesNorm !== filtroMes) return;
				const mesLabel = MESES.find((m) => m.valor === mesNorm)?.nombre || rec.mes;
				const valorTotal = Number(rec.valor);
				const pctProp = Number(rec.porcentaje_propietario || 0);

				if (pctProp > 0) {
					// Split: fila del cliente (valor - porcentaje) y fila del propietario (porcentaje)
					const valorPropietario = Math.round((valorTotal * pctProp) / 100);
					const valorCliente = valorTotal - valorPropietario;
					res.push({
						placa: v.placa,
						valor: valorCliente,
						pagaCliente: rec.pag_cliente ? 'Sí' : 'No',
						empresa_id: rec.empresa_id ?? '',
						empresa_nombre: getEmpresaNombre(rec),
						mes: mesLabel,
						conductor: getConductorA(liq),
						tipo_fila: 'cliente',
						porcentaje_propietario: pctProp
					});
					res.push({
						placa: v.placa,
						valor: valorPropietario,
						pagaCliente: rec.pag_cliente ? 'Sí' : 'No',
						empresa_id: rec.empresa_id ?? '',
						empresa_nombre: getEmpresaNombre(rec),
						mes: mesLabel,
						conductor: getConductorA(liq),
						tipo_fila: 'propietario',
						porcentaje_propietario: pctProp
					});
				} else {
					res.push({
						placa: v.placa,
						valor: valorTotal,
						pagaCliente: rec.pag_cliente ? 'Sí' : 'No',
						empresa_id: rec.empresa_id ?? '',
						empresa_nombre: getEmpresaNombre(rec),
						mes: mesLabel,
						conductor: getConductorA(liq)
					});
				}
			});
		});
		return res;
	})();

	$: datosPer = (() => {
		const res: ResPer[] = [];
		liqFiltradas.forEach((liq) => {
			liq.pernotes?.forEach((per) => {
				if (!per.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === per.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				if (
					filtroMes &&
					per.fechas?.length &&
					!per.fechas.some((f) => f?.split('-')[1] === filtroMes)
				)
					return;
				res.push({
					placa: v.placa,
					cantidad: per.cantidad,
					valor: Number(per.valor),
					valorTotal: Number(per.valor) * per.cantidad,
					fechas: per.fechas,
					conductor: getConductorA(liq)
				});
			});
		});
		return res;
	})();

	$: datosMnt = (() => {
		const map = new Map<string, ResMnt>();
		liqFiltradas.forEach((liq) => {
			const conductor = getConductorA(liq);
			liq.mantenimientos?.forEach((mnt) => {
				const v = liq.vehiculos?.find((x) => x.id === mnt.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const vals = parseValues(mnt.values as ValuesItem[] | string);
				vals.forEach((val) => {
					const cantidad = Number(val.quantity) || 0;
					if (cantidad === 0) return;
					const mesNorm = normalizeMes(val.mes);
					if (filtroMes && mesNorm !== filtroMes) return;
					const mesLabel = MESES.find((m) => m.valor === mesNorm)?.nombre || val.mes;
					const k = `${v.placa}|${conductor}|${mesLabel}`;
					const e = map.get(k);
					if (e) e.cantidad += cantidad;
					else map.set(k, { placa: v.placa, conductor, mes: mesLabel, cantidad });
				});
			});
		});
		return Array.from(map.values()).filter((r) => r.cantidad > 0);
	})();

	// Agrupados para gráficas
	$: bonPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosBon.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valorTotal;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();
	$: recPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosRec.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valor;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();
	$: perPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosPer.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valorTotal;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();

	$: recPie = (() => {
		let s = 0,
			n = 0;
		datosRec.forEach((i) => {
			i.pagaCliente === 'Sí' ? (s += i.valor) : (n += i.valor);
		});
		return [
			{ name: 'Paga cliente', value: s },
			{ name: 'No paga cliente', value: n }
		];
	})();

	function handleKeydown(e: KeyboardEvent) {
		if (!showDropdown) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = (selectedIndex + 1) % (placasFiltradas.length + 1);
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex =
				(selectedIndex - 1 + (placasFiltradas.length + 1)) % (placasFiltradas.length + 1);
		}

		if (e.key === 'Enter') {
			e.preventDefault();

			if (selectedIndex === 0) {
				filtroPlaca = '';
			} else {
				filtroPlaca = placasFiltradas[selectedIndex - 1];
			}

			showDropdown = false;
		}
	}

	const BAR_OPTS = (_label: string, _color: string) => ({
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { display: false },
			tooltip: {
				callbacks: {
					label: (ctx: any) => {
						const v = ctx.parsed.y;
						return (
							' ' +
							new Intl.NumberFormat('es-CO', {
								style: 'currency',
								currency: 'COP',
								minimumFractionDigits: 0
							}).format(v)
						);
					}
				}
			}
		},
		scales: {
			x: { grid: { display: false }, ticks: { font: { size: 11 } } },
			y: {
				grid: { color: '#f3f4f6' },
				border: { dash: [4, 4] },
				ticks: {
					font: { size: 10 },
					callback: (v: any) => {
						if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
						if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k';
						return '$' + v;
					}
				}
			}
		}
	});

	const DONUT_OPTS = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { position: 'bottom' as const, labels: { font: { size: 11 }, padding: 12 } },
			tooltip: {
				callbacks: {
					label: (ctx: any) =>
						' ' +
						new Intl.NumberFormat('es-CO', {
							style: 'currency',
							currency: 'COP',
							minimumFractionDigits: 0
						}).format(ctx.parsed)
				}
			}
		},
		cutout: '60%'
	};

	$: bonChartData = {
		labels: bonPorPlaca.map((d) => d.placa),
		datasets: [
			{
				label: 'Bonificaciones',
				data: bonPorPlaca.map((d) => d.total),
				backgroundColor: '#059669cc',
				borderColor: '#059669',
				borderWidth: 1,
				borderRadius: 4
			}
		]
	};
	$: recChartData = {
		labels: recPorPlaca.map((d) => d.placa),
		datasets: [
			{
				label: 'Recargos',
				data: recPorPlaca.map((d) => d.total),
				backgroundColor: '#f97316cc',
				borderColor: '#f97316',
				borderWidth: 1,
				borderRadius: 4
			}
		]
	};
	$: perChartData = {
		labels: perPorPlaca.map((d) => d.placa),
		datasets: [
			{
				label: 'Pernotes',
				data: perPorPlaca.map((d) => d.total),
				backgroundColor: '#eab308cc',
				borderColor: '#eab308',
				borderWidth: 1,
				borderRadius: 4
			}
		]
	};
	$: pieChartData = {
		labels: recPie.map((d) => d.name),
		datasets: [
			{
				data: recPie.map((d) => d.value),
				backgroundColor: ['#059669cc', '#f97316cc'],
				borderColor: ['#059669', '#f97316'],
				borderWidth: 1
			}
		]
	};

	// Totales
	$: totalBon = datosBon.reduce((s, i) => s + i.valorTotal, 0);
	$: totalRec = datosRec.reduce((s, i) => s + i.valor, 0);
	$: totalPer = datosPer.reduce((s, i) => s + i.valorTotal, 0);
	$: totalMnt = datosMnt.reduce((s, i) => s + i.cantidad, 0);

	// Paginación análisis
	$: bonPaginado = datosBon.slice((pagesBon - 1) * ITEMS_PER_PAGE_A, pagesBon * ITEMS_PER_PAGE_A);
	$: recPaginado = datosRec.slice((pagesRec - 1) * ITEMS_PER_PAGE_A, pagesRec * ITEMS_PER_PAGE_A);
	$: perPaginado = datosPer.slice((pagesPer - 1) * ITEMS_PER_PAGE_A, pagesPer * ITEMS_PER_PAGE_A);
	$: totalPagesBon = Math.max(1, Math.ceil(datosBon.length / ITEMS_PER_PAGE_A));
	$: totalPagesRec = Math.max(1, Math.ceil(datosRec.length / ITEMS_PER_PAGE_A));
	$: totalPagesPer = Math.max(1, Math.ceil(datosPer.length / ITEMS_PER_PAGE_A));

	// Resetear página al cambiar filtros
	$: if (filtroPlaca || filtroMes || filtroAno || analisisTab) {
		pagesBon = 1;
		pagesRec = 1;
		pagesPer = 1;
	}

	function limpiarFiltros() {
		filtroPlaca = '';
		filtroMes = '';
		filtroAno = '';
	}
	$: hayFiltros = !!(filtroPlaca || filtroMes || filtroAno);
</script>

<svelte:head>
	<title>Nómina - Transmeralda</title>
</svelte:head>

<div
	class="nomina-page min-h-screen p-4 sm:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<!-- ======== HEADER ======== -->
	<div class="mb-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<span class="eyebrow">Gestión · Nómina</span>
				<h1
					class="font-display mt-2 flex items-center gap-3 text-2xl font-normal tracking-tight text-[var(--bg-charcoal)] sm:text-3xl"
				>
					<div class="card-icon">
						<Users class="h-5 w-5 text-white" />
					</div>
					Sistema de Nómina
				</h1>
				<p class="mt-1.5 text-sm text-[var(--text-secondary)]">
					Gestión de liquidaciones y desprendibles de pago
				</p>
			</div>

			{#if mainTab === 'liquidaciones'}
				<button on:click={irACrear} class="btn-primary apple-transition">
					<Plus class="h-4 w-4" /> Nueva Liquidación
				</button>
			{/if}
		</div>

		<!-- Tab principal -->
		<div
			class="mt-5 flex w-fit gap-1 rounded-xl border border-[var(--border-subtle)] bg-white p-1"
		>
			{#each MAIN_TABS as tab}
				<button
					on:click={() => setMainTab(tab.key)}
					class="apple-transition flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold
						{mainTab === tab.key
						? 'bg-[var(--bg-charcoal)] text-white shadow-sm'
						: 'text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]'}"
				>
					<svelte:component this={tab.icon} class="h-4 w-4" />
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- ================================================================ -->
	<!--  TAB: LIQUIDACIONES                                               -->
	<!-- ================================================================ -->
	{#if mainTab === 'liquidaciones'}
		<!-- Estadísticas -->
		<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Total Liquidaciones</p>
						<p class="stat-value">{stats.totalRegistros}</p>
						<p class="mt-0.5 text-[10px] text-[var(--text-very-muted)]">registros</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.10)]"
					>
						<FileText class="h-5 w-5 text-[var(--emerald-600)]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Pendientes</p>
						<p class="stat-value">{stats.totalPendientes}</p>
						<p class="mt-0.5 text-[10px] text-[var(--text-very-muted)]">por procesar</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(234,179,8,0.12)]"
					>
						<Clock class="h-5 w-5 text-[#A16207]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Monto Total</p>
						<p class="stat-value">{formatShort(stats.montoTotal)}</p>
						<p class="mt-0.5 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
							{formatCurrency(stats.montoTotal)}
						</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.12)]"
					>
						<TrendingUp class="h-5 w-5 text-[#D97706]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Visibles</p>
						<p class="stat-value">{stats.totalVisibles}</p>
						<p class="mt-0.5 text-[10px] text-[var(--text-very-muted)]">en portal</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(59,130,246,0.10)]"
					>
						<Eye class="h-5 w-5 text-[#2563EB]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Firmados</p>
						<p class="stat-value">{stats.totalFirmados}</p>
						<p class="mt-0.5 text-[10px] text-[var(--text-very-muted)]">desprendibles</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(168,85,247,0.10)]"
					>
						<CheckCircle class="h-5 w-5 text-[#9333EA]" />
					</div>
				</div>
			</div>
		</div>

		<!-- Búsqueda y filtros -->
		<div class="page-card mb-4">
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div class="flex flex-1 flex-wrap items-center gap-3">
					<input
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Buscar por conductor, cédula o ID..."
						class="input-glow min-w-0 flex-1 rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm"
					/>
					<div class="flex items-center gap-2">
						<label
							for="nomina-month"
							class="font-mono-meta text-[0.65rem] whitespace-nowrap text-[var(--text-muted)]"
							>Nómina:</label
						>
						<input
							id="nomina-month"
							type="month"
							bind:value={nominaMonth}
							on:change={handleMonthChange}
							class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					{#if nominaMonth}
						<button
							on:click={clearMonthFilter}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-base)]"
							title="Limpiar filtro">✕</button
						>
					{/if}
				</div>
				{#if selectedLiquidaciones.size > 0}
					<div class="flex items-center gap-2">
						<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>{selectedLiquidaciones.size} sel.</span
						>
						<button
							on:click={toggleSelectAll}
							class="text-xs font-semibold text-[var(--emerald-600)] underline transition-colors hover:text-[var(--emerald-700)]"
						>
							{selectedLiquidaciones.size === liquidaciones.length
								? 'Deseleccionar'
								: 'Seleccionar todo'}
						</button>
						<div class="h-4 w-px bg-[var(--border-default)]"></div>
						<button
							on:click={() => handleBulkToggleVisible(true)}
							class="apple-transition flex items-center gap-1.5 rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[var(--emerald-700)] hover:bg-[rgba(16,185,129,0.14)]"
							title="Hacer visibles en el portal"
						>
							<Eye class="h-3.5 w-3.5" />Mostrar
						</button>
						<button
							on:click={() => handleBulkToggleVisible(false)}
							class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
							title="Ocultar del portal"
						>
							<XCircle class="h-3.5 w-3.5" />Ocultar
						</button>
						<button
							on:click={abrirPreviewDesprendibles}
							class="apple-transition flex items-center gap-1.5 rounded-lg bg-[var(--bg-charcoal)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--bg-charcoal-deep)]"
						>
							<Send class="h-3.5 w-3.5" />Enviar ({selectedLiquidaciones.size})
						</button>
						<button
							on:click={handleDownloadBulkPayslipsZip}
							disabled={generatingBulkPdfZip}
							class="apple-transition flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
						>
							{#if generatingBulkPdfZip}
								<div class="relative w-full">
									<div class="h-3.5 w-full animate-pulse rounded-full bg-blue-300"></div>
									<div
										class="absolute top-0 left-0 h-3.5 rounded-full bg-blue-600"
										style="width: {pdfProgress}%"
									></div>
									<span
										class="absolute inset-0 flex items-center justify-center text-xs font-medium text-white"
										>{pdfProgress}%</span
									>
								</div>
							{:else}
								<Download class="h-3.5 w-3.5" />Descargar Desprendibles (ZIP) ({selectedLiquidaciones.size})
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Tabla de liquidaciones -->
		<div class="table-card">
			{#if loading}
				<div class="flex items-center justify-center py-16">
					<div class="text-center">
						<div class="spinner mx-auto mb-4"></div>
						<p class="text-[var(--text-muted)]">Cargando liquidaciones...</p>
					</div>
				</div>
			{:else if liquidaciones.length === 0}
				<div class="py-16 text-center">
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-base)]"
					>
						<FileText class="h-8 w-8 text-[var(--text-very-muted)]" />
					</div>
					<h3 class="mb-1 text-lg font-semibold text-[var(--text-primary)]">
						Sin liquidaciones
					</h3>
					<p class="mb-4 text-sm text-[var(--text-muted)]">
						{searchTerm || nominaMonth
							? 'No hay resultados para los filtros aplicados.'
							: 'Aún no hay liquidaciones registradas.'}
					</p>
					{#if !searchTerm && !nominaMonth}
						<button on:click={irACrear} class="btn-primary apple-transition">
							Crear primera liquidación
						</button>
					{/if}
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="table-header">
							<tr>
								<th class="text-left">
									<button
										on:click={() => toggleSort('periodo')}
										class="flex items-center gap-1 transition-colors hover:text-[var(--emerald-600)]"
									>
										Período
										{#if sortBy === 'periodo'}{#if sortOrder === 'desc'}<ChevronDown
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{:else}<ChevronUp
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{/if}{:else}<ChevronsUpDown
												class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
											/>{/if}
									</button>
								</th>
								<th class="text-left">
									<button
										on:click={() => toggleSort('conductor')}
										class="flex items-center gap-1 transition-colors hover:text-[var(--emerald-600)]"
									>
										Conductor
										{#if sortBy === 'conductor'}{#if sortOrder === 'desc'}<ChevronDown
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{:else}<ChevronUp
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{/if}{:else}<ChevronsUpDown
												class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
											/>{/if}
									</button>
								</th>
								<th class="text-center">Parex / Veh.</th>
								<th class="text-center">Días</th>
								<th class="text-right">
									<button
										on:click={() => toggleSort('monto')}
										class="ml-auto flex items-center gap-1 transition-colors hover:text-[var(--emerald-600)]"
									>
										Monto
										{#if sortBy === 'monto'}{#if sortOrder === 'desc'}<ChevronDown
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{:else}<ChevronUp
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{/if}{:else}<ChevronsUpDown
												class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
											/>{/if}
									</button>
								</th>
								<th class="text-right">Adicionales</th>
								<th class="text-center">
									<button
										on:click={() => toggleSort('estado')}
										class="mx-auto flex items-center gap-1 transition-colors hover:text-[var(--emerald-600)]"
									>
										Estado
										{#if sortBy === 'estado'}{#if sortOrder === 'desc'}<ChevronDown
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{:else}<ChevronUp
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{/if}{:else}<ChevronsUpDown
												class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
											/>{/if}
									</button>
								</th>
								<th class="text-center">Visible</th>
								<th class="text-center">Tablas</th>
								<th class="text-center">
									<button
										on:click={() => toggleSort('firmado')}
										class="mx-auto flex items-center gap-1 transition-colors hover:text-[var(--emerald-600)]"
									>
										Firmado
										{#if sortBy === 'firmado'}{#if sortOrder === 'desc'}<ChevronDown
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{:else}<ChevronUp
													class="h-3.5 w-3.5 text-[var(--emerald-600)]"
												/>{/if}{:else}<ChevronsUpDown
												class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
											/>{/if}
									</button>
								</th>
								<th class="text-center">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each liquidaciones as liq (liq.id)}
								<tr
									class="table-row {selectedLiquidaciones.has(liq.id)
										? '!bg-[rgba(16,185,129,0.08)]'
										: ''}"
									on:click={() => toggleSelection(liq.id)}
								>
									<td class="px-3 py-2.5">
										<p class="font-mono-meta text-[0.7rem] text-[var(--emerald-700)]">
											{formatDateShort(liq.periodo_inicio)}
										</p>
										<p class="text-[10px] text-[var(--text-muted)]">
											a {formatDateShort(liq.periodo_fin)}
										</p>
									</td>
									<td class="px-3 py-2.5">
										<p class="text-xs font-semibold text-[var(--text-primary)]">
											{liq.conductor?.nombre || 'N/A'}
										</p>
										<p class="text-[10px] text-[var(--text-muted)]">
											CC: {liq.conductor?.cedula || liq.conductor_id?.substring(0, 8) || '—'}
										</p>
									</td>
									<td class="px-3 py-2.5 text-center">
										{#if liq.ajuste_parex}
											<span
												class="status-pill"
												style="background: rgba(59,130,246,0.10); color: #1D4ED8;"
												>Sí</span
											>
										{:else}
											<span
												class="status-pill"
												style="background: rgba(0,0,0,0.04); color: var(--text-muted);"
												>No</span
											>
										{/if}
										<p class="mt-0.5 text-[10px] text-[var(--text-muted)]">
											{liq.vehiculos?.length || 0} veh.
										</p>
									</td>
									<td class="px-3 py-2.5 text-center">
										<p class="font-semibold text-[var(--text-primary)]">
											{liq.dias_laborados ?? 0}
										</p>
										{#if liq.dias_laborados_villanueva}
											<p class="text-[10px] font-semibold text-[var(--emerald-600)]">
												{liq.dias_laborados_villanueva} Villa.
											</p>
										{/if}
									</td>
									<td class="px-3 py-2.5 text-right">
										<p class="text-sm font-bold text-[var(--text-primary)]">
											{formatCurrency(liq.neto_pagado || liq.sueldo_total || 0)}
										</p>
										<p class="text-[10px] text-[var(--text-muted)]">
											Dev: {formatCurrency(liq.total_devengado || 0)}
										</p>
									</td>
									<td class="px-3 py-2.5 text-right">
										<p class="text-[10px] font-semibold text-[#C2410C]">
											Rec: {formatCurrency(liq.total_recargos || 0)}
										</p>
										<p class="text-[10px] font-semibold text-[var(--emerald-600)]">
											Bon: {formatCurrency(liq.total_bonificaciones || 0)}
										</p>
									</td>
									<td class="px-3 py-2.5 text-center">
										<span class="status-pill {getEstadoColor(liq.estado || 'Pendiente')}">
											{liq.estado || 'Pendiente'}
										</span>
									</td>
									<td class="px-3 py-2.5 text-center">
										<button
											on:click|stopPropagation={() =>
												handleToggleVisible(liq.id, liq.desprendible_visible ?? false)}
											class="apple-transition inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold
											{liq.desprendible_visible
												? 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)] hover:bg-[rgba(16,185,129,0.18)]'
												: 'bg-[rgba(0,0,0,0.04)] text-[var(--text-muted)] hover:bg-[rgba(0,0,0,0.08)]'}"
											title={liq.desprendible_visible
												? 'Visible en portal - Click para ocultar'
												: 'Oculto del portal - Click para mostrar'}
										>
											{#if liq.desprendible_visible}
												<CheckCircle class="h-3 w-3" />Sí
											{:else}
												<XCircle class="h-3 w-3" />No
											{/if}
										</button>
									</td>
									<td class="px-3 py-2.5 text-center">
										<button
											on:click={() =>
												handleToggleTablaRecargos(liq.id, liq.mostrar_recargos ?? false)}
											class="apple-transition inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold
										{liq.mostrar_recargos
												? 'bg-[rgba(249,115,22,0.10)] text-[#C2410C] hover:bg-[rgba(249,115,22,0.18)]'
												: 'bg-[rgba(0,0,0,0.04)] text-[var(--text-muted)] hover:bg-[rgba(0,0,0,0.08)]'}"
											title={liq.mostrar_recargos
												? 'Tablas visible en desprendible - Click para ocultar'
												: 'Tablas oculto en edsprendible - Click para mostrar'}
										>
											{#if liq.mostrar_recargos}
												<CheckCircle class="h-3.5 w-3.5" />Sí
											{:else}
												<XCircle class="h-3.5 w-3.5" />No
											{/if}
										</button>
									</td>
									<td class="px-3 py-2.5 text-center">
										{#if liq.firmas_desprendibles && liq.firmas_desprendibles.length > 0}
											<span
												class="status-pill"
												style="background: rgba(168,85,247,0.10); color: #7E22CE;"
											>
												<CheckCircle class="h-3 w-3" />Sí
											</span>
										{:else}
											<span
												class="status-pill"
												style="background: rgba(0,0,0,0.04); color: var(--text-muted);"
											>
												<XCircle class="h-3 w-3" />No
											</span>
										{/if}
									</td>
									<td class="px-3 py-2.5">
										<div class="flex items-center justify-center gap-0.5">
											<button
												on:click|stopPropagation={() => verDetalle(liq.id)}
												class="apple-transition rounded-md p-1.5 text-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
												title="Ver detalle"><Eye class="h-3.5 w-3.5" /></button
											>
											<button
												on:click|stopPropagation={() => handleDownloadSinglePayslip(liq)}
												disabled={downloadingSinglePdf === liq.id}
												class="apple-transition rounded-md p-1.5 text-[#9333EA] hover:bg-[rgba(147,51,234,0.08)] disabled:opacity-50"
												title="Descargar PDF"
											>
												{#if downloadingSinglePdf === liq.id}
													<div
														class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#9333EA] border-t-transparent"
													></div>
												{:else}
													<Download class="h-3.5 w-3.5" />
												{/if}
											</button>
											<button
												on:click|stopPropagation={() => irAEditar(liq.id)}
												class="apple-transition rounded-md p-1.5 text-[var(--emerald-600)] hover:bg-[rgba(16,185,129,0.08)]"
												title="Editar"><Edit class="h-3.5 w-3.5" /></button
											>
											<button
												on:click|stopPropagation={() => confirmarEliminar(liq.id)}
												class="apple-transition rounded-md p-1.5 text-[#DC2626] hover:bg-[rgba(220,38,38,0.08)]"
												title="Eliminar"><Trash2 class="h-3.5 w-3.5" /></button
											>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Paginación lista -->
				<div class="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div class="text-xs text-[var(--text-secondary)]">
							Mostrando <span class="font-semibold text-[var(--text-primary)]"
								>{(pagination.page - 1) * pagination.limit + 1}</span
							>
							a
							<span class="font-semibold text-[var(--text-primary)]"
								>{Math.min(pagination.page * pagination.limit, pagination.total)}</span
							>
							de
							<span class="font-semibold text-[var(--text-primary)]">{pagination.total}</span>
						</div>
						<div class="flex items-center gap-4">
							<div class="flex items-center gap-2">
								<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
									>Mostrar:</span
								>
								<select
									bind:value={pagination.limit}
									on:change={handleLimitChange}
									class="input-glow rounded-lg border border-[var(--border-default)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--text-primary)]"
								>
									<option value={10}>10</option><option value={20}>20</option><option value={50}
										>50</option
									><option value={100}>100</option>
								</select>
							</div>
							<div class="flex items-center gap-1">
								<button
									disabled={!pagination.hasPrev}
									on:click={() => goToPage(pagination.page - 1)}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									<ChevronLeft class="h-4 w-4" />
								</button>
								{#each getPageNumbers(pagination.page, pagination.totalPages) as p}
									{#if p === '...'}
										<span class="px-2 text-xs text-[var(--text-muted)]">...</span>
									{:else}
										<button
											on:click={() => goToPage(Number(p))}
											class="apple-transition flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold
											{p === pagination.page
												? 'bg-[var(--bg-charcoal)] text-white'
												: 'border border-[var(--border-default)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'}"
										>
											{p}
										</button>
									{/if}
								{/each}
								<button
									disabled={!pagination.hasNext}
									on:click={() => goToPage(pagination.page + 1)}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									<ChevronRight class="h-4 w-4" />
								</button>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- ================================================================ -->
		<!--  TAB: PRIMAS                                                      -->
		<!-- ================================================================ -->
	{:else if mainTab === 'primas'}
		<!-- Estadísticas -->
		<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Total Primas</p>
						<p class="stat-value">{statsPrimas.total}</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.10)]"
					>
						<Sparkles class="h-5 w-5 text-[var(--emerald-600)]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Pendientes</p>
						<p class="stat-value">{statsPrimas.totalPendientes}</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(234,179,8,0.12)]"
					>
						<Clock class="h-5 w-5 text-[#A16207]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Pagadas</p>
						<p class="stat-value">{statsPrimas.totalPagados}</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(34,197,94,0.12)]"
					>
						<CheckCircle class="h-5 w-5 text-[#16A34A]" />
					</div>
				</div>
			</div>
			<div class="stat-card">
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="stat-label">Monto Total</p>
						<p class="stat-value">{formatCurrency(statsPrimas.montoTotal)}</p>
					</div>
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.12)]"
					>
						<TrendingUp class="h-5 w-5 text-[#D97706]" />
					</div>
				</div>
			</div>
		</div>

		<!-- Búsqueda y filtros -->
		<div class="page-card mb-4">
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div class="flex flex-1 flex-wrap items-center gap-3">
					<input
						type="text"
						bind:value={searchPrimas}
						on:input={handleSearchPrimas}
						placeholder="Buscar por conductor o cédula..."
						class="input-glow min-w-0 flex-1 rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm"
					/>
					<select
						bind:value={filtroPrimaMes}
						on:change={handlePrimaMesChange}
						class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					>
						<option value="">Todos los meses</option>
						{#each Array.from({ length: 12 }, (_, i) => i + 1) as m}
							<option value={m}>{getPrimaMesLabel(m)}</option>
						{/each}
					</select>
					<input
						type="number"
						bind:value={filtroPrimaAnio}
						on:change={handlePrimaMesChange}
						placeholder="Año"
						min="2000"
						max="2100"
						class="input-glow w-24 rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					/>
					{#if searchPrimas || filtroPrimaMes || filtroPrimaAnio}
						<button
							on:click={clearPrimaFilters}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-base)]"
							>✕ Limpiar</button
						>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					{#if selectedPrimas.size > 0}
						<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>{selectedPrimas.size} sel.</span
						>
						<button
							on:click={togglePrimaSelectAll}
							class="text-xs font-semibold text-[var(--emerald-600)] underline transition-colors hover:text-[var(--emerald-700)]"
						>
							{selectedPrimas.size === primas.length ? 'Deseleccionar' : 'Seleccionar todo'}
						</button>
						<div class="h-4 w-px bg-[var(--border-default)]"></div>
						<button
							on:click={() => handleBulkTogglePrimaVisible(true)}
							class="apple-transition flex items-center gap-1.5 rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[var(--emerald-700)] hover:bg-[rgba(16,185,129,0.14)]"
							title="Hacer visibles en el portal"
						>
							<Eye class="h-3.5 w-3.5" />Mostrar
						</button>
						<button
							on:click={() => handleBulkTogglePrimaVisible(false)}
							class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
							title="Ocultar del portal"
						>
							<XCircle class="h-3.5 w-3.5" />Ocultar
						</button>
						<button
							on:click={abrirPreviewPrimas}
							class="apple-transition flex items-center gap-1.5 rounded-lg bg-[var(--bg-charcoal)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--bg-charcoal-deep)]"
						>
							<Send class="h-3.5 w-3.5" />Enviar ({selectedPrimas.size})
						</button>
					{:else}
						<button on:click={abrirCrearPrima} class="btn-primary apple-transition">
							<Plus class="h-4 w-4" /> Nueva Prima
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Tabla de primas -->
		<div class="table-card">
			{#if loadingPrimas}
				<div class="flex items-center justify-center py-16">
					<div class="text-center">
						<div class="spinner mx-auto mb-4"></div>
						<p class="text-[var(--text-muted)]">Cargando primas...</p>
					</div>
				</div>
			{:else if primas.length === 0}
				<div class="py-16 text-center">
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-base)]"
					>
						<Sparkles class="h-8 w-8 text-[var(--text-very-muted)]" />
					</div>
					<h3 class="mb-1 text-lg font-semibold text-[var(--text-primary)]">Sin primas</h3>
					<p class="mb-4 text-sm text-[var(--text-muted)]">
						{searchPrimas || filtroPrimaMes || filtroPrimaAnio
							? 'No hay resultados para los filtros aplicados.'
							: 'Aún no hay primas registradas.'}
					</p>
					{#if !searchPrimas && !filtroPrimaMes && !filtroPrimaAnio}
						<button on:click={abrirCrearPrima} class="btn-primary apple-transition">
							Crear primera prima
						</button>
					{/if}
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="table-header">
							<tr>
								<th class="w-10 text-left">
									<input
										type="checkbox"
										checked={primas.length > 0 && selectedPrimas.size === primas.length}
										on:change={togglePrimaSelectAll}
										class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
									/>
								</th>
								<th class="text-left">Conductor</th>
								<th class="text-center">Periodo</th>
								<th class="text-center">Días</th>
								<th class="text-right">Prima</th>
								<th class="text-right">Prima Pendiente</th>
								<th class="text-center">Estado</th>
								<th class="text-center">Firmado</th>
								<th class="text-center">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each primas as p (p.id)}
								{@const firma = getPrimaFirmaInfo(p)}
								<tr
									class="table-row border-l-2 {selectedPrimas.has(p.id)
										? '!border-l-[var(--emerald-500)] !bg-[rgba(16,185,129,0.08)]'
										: 'border-l-transparent'}"
								>
									<td class="w-10 px-3 py-2.5">
										<input
											type="checkbox"
											checked={selectedPrimas.has(p.id)}
											on:change={() => togglePrimaSelection(p.id)}
											class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
										/>
									</td>
									<td class="px-3 py-2.5">
										<p class="text-xs font-semibold text-[var(--text-primary)]">
											{p.conductor?.nombre || 'N/A'}
											{p.conductor?.apellido || ''}
										</p>
										<p class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											CC: {(p.conductor as any)?.numero_identificacion ||
												p.conductor?.cedula ||
												'—'}
										</p>
									</td>
									<td class="px-3 py-2.5 text-center">
										<p class="font-mono-meta text-[0.7rem] text-[var(--emerald-700)]">
											{getPrimaMesLabel(p.mes)}
											{p.anio}
										</p>
									</td>
									<td class="px-3 py-2.5 text-center">
										<p class="text-sm font-semibold text-[var(--text-primary)]">
											{p.tiempo_trabajado_dias ?? 0}
										</p>
									</td>
									<td class="px-3 py-2.5 text-right">
										<p class="text-sm font-bold text-[var(--text-primary)]">
											{formatCurrency(p.prima)}
										</p>
									</td>
									<td class="px-3 py-2.5 text-right">
										{#if p.prima_pendiente && Number(p.prima_pendiente) > 0}
											<p class="text-sm font-semibold text-[var(--emerald-600)]">
												+{formatCurrency(p.prima_pendiente)}
											</p>
										{:else}
											<p class="text-[10px] text-[var(--text-very-muted)]">—</p>
										{/if}
									</td>
									<td class="px-3 py-2.5 text-center">
										<span class="status-pill {getPrimaEstadoColor(p.estado)}">
											{p.estado}
										</span>
									</td>
									<td class="px-3 py-2.5 text-center">
										<span
											class="status-pill {firma.classes}"
											title={p.firmado
												? 'Prima firmada por el conductor'
												: 'Pendiente de firma del conductor'}
										>
											<svelte:component this={firma.icon} class="h-3 w-3" />
											{firma.label}
										</span>
									</td>
									<td class="px-3 py-2.5">
										<div class="flex items-center justify-center gap-1">
											<button
												on:click={() => handleTogglePrimaVisible(p.id)}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563EB]"
												title="Hacer visible en portal del conductor"
											>
												<Eye class="h-3.5 w-3.5" />
											</button>
											<button
												on:click={() => handleDescargarPdfPrima(p)}
												disabled={downloadingPrimaPdf === p.id}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(16,185,129,0.08)] hover:text-[var(--emerald-600)] disabled:opacity-50"
												title="Descargar PDF de Prima"
											>
												{#if downloadingPrimaPdf === p.id}
													<div
														class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--emerald-500)] border-t-transparent"
													></div>
												{:else}
													<Download class="h-3.5 w-3.5" />
												{/if}
											</button>
											<button
												on:click={() => abrirEditarPrima(p)}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563EB]"
												title="Editar"
											>
												<Edit class="h-3.5 w-3.5" />
											</button>
											<button
												on:click={() => confirmarEliminarPrima(p.id)}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#DC2626]"
												title="Eliminar"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<!-- Modal Eliminar Prima -->
		{#if showDeletePrimaModal}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
				<div class="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
					<div class="mb-4 flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(220,38,38,0.10)]">
							<AlertCircle class="h-5 w-5 text-[#DC2626]" />
						</div>
						<h3 class="text-lg font-semibold text-[var(--text-primary)]">Eliminar Prima</h3>
					</div>
					<p class="mb-6 text-sm text-[var(--text-muted)]">
						¿Está seguro que desea eliminar esta prima? Esta acción no se puede deshacer.
					</p>
					<div class="flex justify-end gap-2">
						<button
							on:click={() => {
								showDeletePrimaModal = false;
								primaToDelete = null;
							}}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
							>Cancelar</button
						>
						<button
							on:click={eliminarPrima}
							class="apple-transition rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B91C1C]"
							>Eliminar</button
						>
					</div>
				</div>
			</div>
		{/if}

		<!-- Modal Crear/Editar Prima -->
		<PrimaFormModal
			show={showPrimaFormModal}
			prima={primaToEdit}
			{loading}
			onClose={() => {
				showPrimaFormModal = false;
				primaToEdit = null;
			}}
			onSubmit={handleGuardarPrima}
		/>

		<!-- ================================================================ -->
		<!--  TAB: ANÁLISIS                                                    -->
		<!-- ================================================================ -->
	{:else if mainTab === 'analisis'}
		{#if loadingA}
			<div class="flex items-center justify-center py-24">
				<div class="text-center">
					<div class="spinner mx-auto mb-4"></div>
					<p class="text-[var(--text-muted)]">Cargando datos de análisis...</p>
				</div>
			</div>
		{:else if liquidacionesA.length === 0}
			<div class="table-card py-20 text-center">
				<div
					class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-base)]"
				>
					<AlertCircle class="h-8 w-8 text-[var(--text-very-muted)]" />
				</div>
				<h3 class="mb-1 text-lg font-semibold text-[var(--text-primary)]">
					Sin datos para analizar
				</h3>
				<p class="mb-5 text-sm text-[var(--text-muted)]">
					Aún no hay liquidaciones registradas en el sistema.
				</p>
				<button
					on:click={() => setMainTab('liquidaciones')}
					class="btn-primary apple-transition"
				>
					<Plus class="h-4 w-4" /> Crear primera liquidación
				</button>
			</div>
		{:else}
			<!-- Filtros -->
			<div class="page-card mb-5">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div class="filter-field relative w-full">
						<label for="filtro-placa" class="filter-field-label">Placa</label>
						<input
							id="filtro-placa"
							type="text"
							placeholder="Buscar placa..."
							bind:value={filtroPlaca}
							on:focus={() => (showDropdown = true)}
							on:blur={() => setTimeout(() => (showDropdown = false), 150)}
							on:keydown={handleKeydown}
						/>

						{#if showDropdown && placasFiltradas.length > 0}
							<ul
								class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-[var(--border-default)] bg-white shadow-lg"
							>
								{#each placasFiltradas as p, i}
									<li>
										<button
											type="button"
											class={`w-full cursor-pointer px-3 py-2 text-left text-sm apple-transition ${
												selectedIndex === i + 1
													? 'bg-[rgba(16,185,129,0.12)] text-[var(--emerald-700)]'
													: 'hover:bg-[var(--bg-base)]'
											}`}
											on:mousedown={() => (filtroPlaca = p)}
										>
											{p}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
					<div class="filter-field">
						<label for="filtro-mes" class="filter-field-label">Mes</label>
						<select id="filtro-mes" bind:value={filtroMes}>
							<option value="">Todos los meses</option>
							{#each MESES as m}<option value={m.valor}>{m.nombre}</option>{/each}
						</select>
					</div>
					<div class="filter-field">
						<label for="filtro-ano" class="filter-field-label">Año</label>
						<select id="filtro-ano" bind:value={filtroAno}>
							<option value="">Todos los años</option>
							{#each anosA as a}<option value={a}>{a}</option>{/each}
						</select>
					</div>
				</div>
				{#if hayFiltros}
					<div class="filter-chips mt-3">
						{#if filtroPlaca}
							<span class="filter-chip">
								Placa: {filtroPlaca}
								<button on:click={() => (filtroPlaca = '')}>✕</button>
							</span>
						{/if}
						{#if filtroMes}
							<span class="filter-chip">
								Mes: {MESES.find((m) => m.valor === filtroMes)?.nombre}
								<button on:click={() => (filtroMes = '')}>✕</button>
							</span>
						{/if}
						{#if filtroAno}
							<span class="filter-chip">
								Año: {filtroAno}
								<button on:click={() => (filtroAno = '')}>✕</button>
							</span>
						{/if}
						<button
							on:click={limpiarFiltros}
							class="font-mono-meta text-[0.65rem] text-[var(--text-muted)] underline hover:text-[var(--emerald-700)]"
							>Limpiar todo</button
						>
					</div>
				{/if}
			</div>

			<!-- Resumen -->
			<div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each [{ label: 'Bonificaciones', value: formatCurrency(totalBon), count: datosBon.length }, { label: 'Recargos', value: formatCurrency(totalRec), count: datosRec.length }, { label: 'Pernotes', value: formatCurrency(totalPer), count: datosPer.length }, { label: 'Mantenimientos', value: String(totalMnt), count: datosMnt.length }] as card}
					<div class="stat-card">
						<p class="stat-label">{card.label}</p>
						<p class="stat-value truncate">{card.value}</p>
						<p class="text-[10px] text-[var(--text-very-muted)]">{card.count} registros</p>
					</div>
				{/each}
			</div>

			<!-- Tabs de análisis -->
			<div class="table-card">
				<div class="border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
					<nav class="flex overflow-x-auto">
						{#each ANALISIS_TABS as tab}
							<button
								on:click={() => (analisisTab = tab.key as typeof analisisTab)}
								class="apple-transition flex items-center gap-2 border-b-2 px-5 py-4 text-sm font-semibold whitespace-nowrap
									{analisisTab === tab.key
									? 'border-[var(--emerald-500)] text-[var(--text-primary)]'
									: 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]'}"
							>
								<svelte:component this={tab.icon} class="h-4 w-4" />
								{tab.label}
							</button>
						{/each}
					</nav>
				</div>

				<div class="p-4 sm:p-6">
					<!-- ===== BONIFICACIONES ===== -->
					{#if analisisTab === 'bonificaciones'}
						<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">
							Bonificaciones por Vehículo
						</h2>

						{#if bonPorPlaca.length > 0}
							<div
								class="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
								style="height:200px"
							>
								<Bar data={bonChartData} options={BAR_OPTS('Bonificaciones', '#059669')} />
							</div>
						{:else}
							<div
								class="mb-4 rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] py-10 text-center"
							>
								<BarChart2 class="mx-auto mb-2 h-9 w-9 text-[var(--text-very-muted)]" />
								<p class="text-sm text-[var(--text-muted)]">
									Sin bonificaciones para los filtros aplicados
								</p>
							</div>
						{/if}

						<div class="mb-3 flex items-center justify-between">
							<h3 class="font-semibold text-[var(--text-secondary)]">
								Detalle de Bonificaciones
							</h3>
							<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
								>{bonPaginado.length} / {datosBon.length}</span
							>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if bonPaginado.length > 0}
								{#each bonPaginado as item}
									<div
										class="list-card flex-col items-stretch p-4"
									>
										<p class="text-sm font-semibold text-[var(--text-primary)]">
											{item.placa} — {item.nombre}
										</p>
										<p class="mb-3 text-xs text-[var(--text-muted)]">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Mes</span><span>{item.mes}</span>
											</div>
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Cantidad</span><span
													>{item.cantidad}</span
												>
											</div>
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">V. Unitario</span><span
													>{formatCurrency(item.valorUnitario)}</span
												>
											</div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-[var(--text-secondary)]">Total</span>
												<span class="font-bold text-[#16A34A]"
													>{formatCurrency(item.valorTotal)}</span
												>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div
									class="rounded-xl border-2 border-dashed border-[var(--border-subtle)] py-12 text-center"
								>
									<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
									<p class="text-sm text-[var(--text-muted)]">
										Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
									</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div
							class="hidden overflow-x-auto rounded-xl border border-[var(--border-subtle)] md:block"
						>
							<table class="w-full text-sm">
								<thead class="table-header">
									<tr>
										{#each ['Placa', 'Conductor', 'Tipo', 'Mes', 'Cantidad', 'V. Unitario', 'V. Total'] as h}
											<th class="text-left">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-[var(--border-subtle)]">
									{#if bonPaginado.length > 0}
										{#each bonPaginado as item}
											<tr class="table-row">
												<td class="px-4 py-3 font-medium text-[var(--text-primary)]">{item.placa}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.conductor}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.nombre}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.mes}</td>
												<td class="px-4 py-3">{item.cantidad}</td>
												<td class="px-4 py-3">{formatCurrency(item.valorUnitario)}</td>
												<td class="px-4 py-3 font-bold text-[#16A34A]"
													>{formatCurrency(item.valorTotal)}</td
												>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="7" class="py-12 text-center">
												<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
												<p class="text-sm text-[var(--text-muted)]">
													Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
												</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						<!-- Paginación bon -->
						{#if totalPagesBon > 1}
							<div
								class="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2"
							>
								<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
									>Página {pagesBon} de {totalPagesBon}</span
								>
								<div class="flex gap-1">
									<button
										disabled={pagesBon === 1}
										on:click={() => pagesBon--}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronLeft class="h-4 w-4" /></button
									>
									{#each getPageNumbers(pagesBon, totalPagesBon) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
												>...</span
											>
										{:else}
											<button
												on:click={() => (pagesBon = Number(p))}
												class="apple-transition h-9 w-9 rounded-lg border text-xs font-bold {p ===
												pagesBon
													? 'border-transparent bg-[var(--bg-charcoal)] text-white'
													: 'border-[var(--border-default)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'}"
												>{p}</button
											>
										{/if}
									{/each}
									<button
										disabled={pagesBon === totalPagesBon}
										on:click={() => pagesBon++}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronRight class="h-4 w-4" /></button
									>
								</div>
							</div>
						{/if}

						<!-- ===== RECARGOS ===== -->
					{:else if analisisTab === 'recargos'}
						<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">
							Recargos por Vehículo
						</h2>

						<div class="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
							{#if recPorPlaca.length > 0}
								<div
									class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
									style="height:200px"
								>
									<Bar data={recChartData} options={BAR_OPTS('Recargos', '#f97316')} />
								</div>
							{:else}
								<div
									class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] py-10 text-center"
								>
									<BarChart2 class="mb-2 h-9 w-9 text-[var(--text-very-muted)]" />
									<p class="text-sm text-[var(--text-muted)]">Sin recargos</p>
								</div>
							{/if}

							<div
								class="flex flex-col justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
								style="height:200px"
							>
								{#if recPie[0].value + recPie[1].value > 0}
									<p
										class="mb-1 text-center font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
									>
										PAGA CLIENTE VS EMPRESA
									</p>
									<Doughnut data={pieChartData} options={DONUT_OPTS} />
								{:else}
									<div class="flex h-full flex-col items-center justify-center gap-2">
										<div
											class="flex h-20 w-20 items-center justify-center rounded-full border-4 border-dashed border-[var(--border-default)]"
										>
											<p class="px-1 text-center text-xs text-[var(--text-muted)]">Sin datos</p>
										</div>
									</div>
								{/if}
							</div>
						</div>

						<div class="mb-3 flex items-center justify-between">
							<h3 class="font-semibold text-[var(--text-secondary)]">Detalle de Recargos</h3>
							<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
								>{recPaginado.length} / {datosRec.length}</span
							>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if recPaginado.length > 0}
								{#each recPaginado as item}
									<div
										class="list-card flex-col items-stretch p-4 {item.tipo_fila === 'propietario'
											? '!border-[rgba(245,158,11,0.35)] !bg-[rgba(245,158,11,0.06)]'
											: item.pagaCliente === 'No'
												? '!border-[rgba(220,38,38,0.25)] !bg-[rgba(220,38,38,0.04)]'
												: ''}"
									>
										<div class="flex items-center gap-2">
											<p class="text-sm font-semibold text-[var(--text-primary)]">
												{item.placa} — {item.empresa_nombre}
											</p>
											{#if item.tipo_fila}
												<span
													class="status-pill {item.tipo_fila === 'propietario'
														? '!bg-[rgba(245,158,11,0.18)] !text-[#92400E]'
														: '!bg-[rgba(59,130,246,0.10)] !text-[#1D4ED8]'}"
												>
													{item.tipo_fila === 'propietario'
														? `Prop ${item.porcentaje_propietario}%`
														: `Cli ${100 - (item.porcentaje_propietario || 0)}%`}
												</span>
											{/if}
										</div>
										<p class="mb-3 text-xs text-[var(--text-muted)]">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Mes</span><span>{item.mes}</span>
											</div>
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Paga cliente</span>
												<span
													class="font-semibold {item.pagaCliente === 'Sí'
														? 'text-[#16A34A]'
														: 'text-[#DC2626]'}">{item.pagaCliente}</span
												>
											</div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-[var(--text-secondary)]">Valor</span>
												<span class="font-bold text-[var(--text-primary)]"
													>{formatCurrency(item.valor)}</span
												>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div
									class="rounded-xl border-2 border-dashed border-[var(--border-subtle)] py-12 text-center"
								>
									<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
									<p class="text-sm text-[var(--text-muted)]">
										Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
									</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div
							class="hidden overflow-x-auto rounded-xl border border-[var(--border-subtle)] md:block"
						>
							<table class="w-full text-sm">
								<thead class="table-header">
									<tr>
										{#each ['Placa', 'Conductor', 'Cliente', 'Mes', 'Valor', 'Paga Cliente', 'Asume'] as h}
											<th class="text-left">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-[var(--border-subtle)]">
									{#if recPaginado.length > 0}
										{#each recPaginado as item}
											<tr
												class="table-row {item.tipo_fila === 'propietario'
													? '!bg-[rgba(245,158,11,0.06)]'
													: item.pagaCliente === 'No'
														? '!bg-[rgba(220,38,38,0.04)]'
														: ''}"
											>
												<td class="px-4 py-3 font-medium text-[var(--text-primary)]">{item.placa}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.conductor}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]"
													>{item.empresa_nombre}</td
												>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.mes}</td>
												<td class="px-4 py-3 font-bold text-[var(--text-primary)]">
													{formatCurrency(item.valor)}
												</td>
												<td class="px-4 py-3">
													<span
														class="status-pill {item.pagaCliente === 'Sí'
															? '!bg-[rgba(22,163,74,0.10)] !text-[#15803D]'
															: '!bg-[rgba(220,38,38,0.10)] !text-[#991B1B]'}"
													>
														{item.pagaCliente}
													</span>
												</td>
												<td class="px-4 py-3">
													{#if item.tipo_fila === 'propietario'}
														<span
															class="status-pill !bg-[rgba(245,158,11,0.18)] !text-[#92400E]"
														>
															Prop {item.porcentaje_propietario}%
														</span>
													{:else if item.tipo_fila === 'cliente'}
														<span
															class="status-pill !bg-[rgba(59,130,246,0.10)] !text-[#1D4ED8]"
														>
															Cli {100 - (item.porcentaje_propietario || 0)}%
														</span>
													{:else}
														<span class="text-xs text-[var(--text-very-muted)]">—</span>
													{/if}
												</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="7" class="py-12 text-center">
												<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
												<p class="text-sm text-[var(--text-muted)]">
													Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
												</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						{#if totalPagesRec > 1}
							<div
								class="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2"
							>
								<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
									>Página {pagesRec} de {totalPagesRec}</span
								>
								<div class="flex gap-1">
									<button
										disabled={pagesRec === 1}
										on:click={() => pagesRec--}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronLeft class="h-4 w-4" /></button
									>
									{#each getPageNumbers(pagesRec, totalPagesRec) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
												>...</span
											>
										{:else}
											<button
												on:click={() => (pagesRec = Number(p))}
												class="apple-transition h-9 w-9 rounded-lg border text-xs font-bold {p ===
												pagesRec
													? 'border-transparent bg-[var(--bg-charcoal)] text-white'
													: 'border-[var(--border-default)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'}"
												>{p}</button
											>
										{/if}
									{/each}
									<button
										disabled={pagesRec === totalPagesRec}
										on:click={() => pagesRec++}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronRight class="h-4 w-4" /></button
									>
								</div>
							</div>
						{/if}

						<!-- ===== PERNOTES ===== -->
					{:else if analisisTab === 'pernotes'}
						<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">
							Pernotes por Vehículo
						</h2>

						{#if perPorPlaca.length > 0}
							<div
								class="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
								style="height:200px"
							>
								<Bar data={perChartData} options={BAR_OPTS('Pernotes', '#eab308')} />
							</div>
						{:else}
							<div
								class="mb-4 rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] py-10 text-center"
							>
								<Moon class="mx-auto mb-2 h-9 w-9 text-[var(--text-very-muted)]" />
								<p class="text-sm text-[var(--text-muted)]">
									Sin pernotes para los filtros aplicados
								</p>
							</div>
						{/if}

						<div class="mb-3 flex items-center justify-between">
							<h3 class="font-semibold text-[var(--text-secondary)]">Detalle de Pernotes</h3>
							<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
								>{perPaginado.length} / {datosPer.length}</span
							>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if perPaginado.length > 0}
								{#each perPaginado as item}
									<div class="list-card flex-col items-stretch p-4">
										<p class="text-sm font-semibold text-[var(--text-primary)]">{item.placa}</p>
										<p class="mb-3 text-xs text-[var(--text-muted)]">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Cantidad</span><span
													>{item.cantidad}</span
												>
											</div>
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">V. Unitario</span><span
													>{formatCurrency(item.valor)}</span
												>
											</div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-[var(--text-secondary)]">Total</span>
												<span class="font-bold text-[#A16207]"
													>{formatCurrency(item.valorTotal)}</span
												>
											</div>
											{#if item.fechas?.length}
												<div class="border-t pt-1.5">
													<p class="mb-0.5 text-xs text-[var(--text-muted)]">Fechas:</p>
													<p class="text-xs text-[var(--text-secondary)]">
														{agruparFechas(item.fechas).join(', ')}
													</p>
												</div>
											{/if}
										</div>
									</div>
								{/each}
							{:else}
								<div
									class="rounded-xl border-2 border-dashed border-[var(--border-subtle)] py-12 text-center"
								>
									<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
									<p class="text-sm text-[var(--text-muted)]">
										Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
									</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div
							class="hidden overflow-x-auto rounded-xl border border-[var(--border-subtle)] md:block"
						>
							<table class="w-full text-sm">
								<thead class="table-header">
									<tr>
										{#each ['Placa', 'Conductor', 'Cantidad', 'V. Unitario', 'V. Total', 'Fechas'] as h}
											<th class="text-left">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-[var(--border-subtle)]">
									{#if perPaginado.length > 0}
										{#each perPaginado as item}
											<tr class="table-row">
												<td class="px-4 py-3 font-medium text-[var(--text-primary)]">{item.placa}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.conductor}</td>
												<td class="px-4 py-3">{item.cantidad}</td>
												<td class="px-4 py-3">{formatCurrency(item.valor)}</td>
												<td class="px-4 py-3 font-bold text-[#A16207]"
													>{formatCurrency(item.valorTotal)}</td
												>
												<td class="max-w-xs px-4 py-3 text-xs text-[var(--text-secondary)]">
													{#if item.fechas?.length}
														{agruparFechas(item.fechas).join(', ')}
													{:else}
														<span class="text-[var(--text-very-muted)]">—</span>
													{/if}
												</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="6" class="py-12 text-center">
												<AlertCircle class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
												<p class="text-sm text-[var(--text-muted)]">
													Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
												</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						{#if totalPagesPer > 1}
							<div
								class="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2"
							>
								<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
									>Página {pagesPer} de {totalPagesPer}</span
								>
								<div class="flex gap-1">
									<button
										disabled={pagesPer === 1}
										on:click={() => pagesPer--}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronLeft class="h-4 w-4" /></button
									>
									{#each getPageNumbers(pagesPer, totalPagesPer) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
												>...</span
											>
										{:else}
											<button
												on:click={() => (pagesPer = Number(p))}
												class="apple-transition h-9 w-9 rounded-lg border text-xs font-bold {p ===
												pagesPer
													? 'border-transparent bg-[var(--bg-charcoal)] text-white'
													: 'border-[var(--border-default)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'}"
												>{p}</button
											>
										{/if}
									{/each}
									<button
										disabled={pagesPer === totalPagesPer}
										on:click={() => pagesPer++}
										class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
										><ChevronRight class="h-4 w-4" /></button
									>
								</div>
							</div>
						{/if}

						<!-- ===== MANTENIMIENTOS ===== -->
					{:else if analisisTab === 'mantenimientos'}
						<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">
							Mantenimientos por Vehículo
						</h2>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if datosMnt.length > 0}
								{#each datosMnt as item}
									<div class="list-card flex-col items-stretch p-4">
										<p class="text-sm font-semibold text-[var(--text-primary)]">{item.placa}</p>
										<p class="mb-3 text-xs text-[var(--text-muted)]">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between">
												<span class="text-[var(--text-muted)]">Mes</span><span>{item.mes}</span>
											</div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-[var(--text-secondary)]">Cantidad</span>
												<span class="font-bold text-[#9333EA]">{item.cantidad}</span>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div
									class="rounded-xl border-2 border-dashed border-[var(--border-subtle)] py-12 text-center"
								>
									<Wrench class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
									<p class="text-sm text-[var(--text-muted)]">
										Sin mantenimientos{hayFiltros ? ' para los filtros aplicados' : ''}
									</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div
							class="hidden overflow-x-auto rounded-xl border border-[var(--border-subtle)] md:block"
						>
							<table class="w-full text-sm">
								<thead class="table-header">
									<tr>
										{#each ['Placa', 'Conductor', 'Mes', 'Cantidad Total'] as h}
											<th class="text-left">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-[var(--border-subtle)]">
									{#if datosMnt.length > 0}
										{#each datosMnt as item}
											<tr class="table-row">
												<td class="px-4 py-3 font-medium text-[var(--text-primary)]">{item.placa}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.conductor}</td>
												<td class="px-4 py-3 text-[var(--text-secondary)]">{item.mes}</td>
												<td class="px-4 py-3 font-bold text-[#9333EA]">{item.cantidad}</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="4" class="py-12 text-center">
												<Wrench class="mx-auto mb-2 h-8 w-8 text-[var(--text-very-muted)]" />
												<p class="text-sm text-[var(--text-muted)]">
													Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}
												</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Modal detalle -->
<LiquidacionDetalleModal
	liquidacionId={detalleId}
	bind:show={showDetalleModal}
	onClose={() => (showDetalleModal = false)}
/>

<!-- Modal eliminar -->
{#if showDeleteModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		on:click={() => (showDeleteModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="button"
		tabindex="-1"
	>
		<div
			class="mx-4 w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-white p-6 shadow-2xl"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog"
			tabindex="0"
		>
			<h3 class="mb-2 font-display text-xl font-medium text-[var(--text-primary)]">
				Confirmar eliminación
			</h3>
			<p class="mb-6 text-sm text-[var(--text-muted)]">
				¿Estás seguro de que deseas eliminar esta liquidación? Esta acción no se puede deshacer.
			</p>
			<div class="flex justify-end gap-3">
				<button
					on:click={() => (showDeleteModal = false)}
					class="apple-transition rounded-xl px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
					>Cancelar</button
				>
				<button
					on:click={eliminar}
					class="apple-transition rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B91C1C]"
					>Eliminar</button
				>
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- Modal Preview Desprendibles -->
<!-- ═══════════════════════════════════════════════════════════ -->
{#if showPreviewModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		on:click={cerrarPreviewModal}
		on:keydown={(e) => e.key === 'Escape' && cerrarPreviewModal()}
		role="button"
		tabindex="-1"
	>
		<div
			class="confirm-card relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0"
			on:click|stopPropagation
			on:keydown={() => {}}
			role="dialog"
			tabindex="0"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[var(--border-subtle)] bg-gradient-to-r from-[var(--emerald-500)] to-[var(--emerald-600)] px-6 py-4"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
						<Mail class="h-5 w-5 text-white" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-white">Enviar Desprendibles</h2>
						<p class="text-sm text-white/80">Preview de notificaciones por email</p>
					</div>
				</div>
				<button
					on:click={cerrarPreviewModal}
					class="apple-transition rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto bg-white p-6">
				{#if previewLoading}
					<div class="flex flex-col items-center justify-center py-12">
						<div class="spinner mb-4"></div>
						<p class="text-sm text-[var(--text-muted)]">Cargando datos de conductores...</p>
					</div>
				{:else if sendComplete}
					<div class="space-y-3">
						<div
							class="hint-card mb-4 flex items-center gap-3"
						>
							<CheckCircle class="h-6 w-6 flex-shrink-0 text-[var(--emerald-600)]" />
							<div>
								<p class="font-semibold text-[var(--text-primary)]">Envío completado</p>
								<p class="text-sm text-[var(--text-secondary)]">
									{sendResults.filter((r) => r.status === 'enviado').length} enviado(s),
									{sendResults.filter((r) => r.status === 'error').length} error(es)
								</p>
							</div>
						</div>
						{#each sendResults as result}
							<div
								class="list-card flex items-center gap-3 p-3 {result.status === 'error'
									? '!border-[rgba(220,38,38,0.25)] !bg-[rgba(220,38,38,0.04)]'
									: ''}"
							>
								{#if result.status === 'enviado'}
									<CheckCircle class="h-5 w-5 flex-shrink-0 text-[var(--emerald-600)]" />
								{:else}
									<XCircle class="h-5 w-5 flex-shrink-0 text-[#DC2626]" />
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-semibold text-[var(--text-primary)]">
										{result.conductor}
									</p>
									<p class="truncate text-xs text-[var(--text-muted)]">
										{result.email || 'Sin email'}
									</p>
								</div>
								{#if result.status === 'error'}
									<span
										class="status-pill !bg-[rgba(220,38,38,0.10)] !text-[#991B1B]"
										>{result.message}</span
									>
								{:else}
									<span
										class="status-pill !bg-[rgba(16,185,129,0.10)] !text-[var(--emerald-700)]"
										>Enviado</span
									>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="mb-4 flex items-center gap-4">
						<div
							class="hint-card flex items-center gap-2 px-3 py-2"
						>
							<CheckCircle class="h-4 w-4 text-[var(--emerald-600)]" />
							<span class="text-sm font-semibold text-[var(--emerald-700)]"
								>{previewItems.filter((p) => p.canSend).length} con email</span
							>
						</div>
						{#if previewItems.filter((p) => !p.canSend).length > 0}
							<div
								class="flex items-center gap-2 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
							>
								<AlertCircle class="h-4 w-4 text-[#D97706]" />
								<span class="text-sm font-semibold text-[#92400E]"
									>{previewItems.filter((p) => !p.canSend).length} sin email</span
								>
							</div>
						{/if}
					</div>

					<div class="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
						<table class="w-full text-sm">
							<thead class="table-header">
								<tr>
									<th class="text-left">Conductor</th>
									<th class="text-left">Email</th>
									<th class="text-right">Monto</th>
									<th class="text-center">Estado</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-[var(--border-subtle)]">
								{#each previewItems as item}
									<tr class="table-row {!item.canSend ? 'opacity-60' : ''}">
										<td class="px-4 py-3">
											<p class="text-sm font-semibold text-[var(--text-primary)]">
												{item.conductor}
											</p>
											<p class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
												{formatDateShort(item.periodo_inicio)} – {formatDateShort(item.periodo_fin)}
											</p>
										</td>
										<td class="px-4 py-3">
											{#if item.email}
												<span class="text-sm text-[var(--text-secondary)]">{item.email}</span>
											{:else}
												<span class="text-xs text-[#D97706] italic">Sin email registrado</span>
											{/if}
										</td>
										<td class="px-4 py-3 text-right text-sm font-bold text-[var(--text-primary)] tabular-nums">
											{formatCurrency(Number(item.sueldo_total) || 0)}
										</td>
										<td class="px-4 py-3 text-center">
											{#if item.canSend}
												<span
													class="status-pill !bg-[rgba(16,185,129,0.10)] !text-[var(--emerald-700)]"
												>
													<span class="mr-1.5 h-1.5 w-1.5 rounded-full bg-[var(--emerald-500)]"></span>
													Listo
												</span>
											{:else}
												<span
													class="status-pill !bg-[rgba(245,158,11,0.10)] !text-[#92400E]"
												>
													<span class="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#F59E0B]"></span>
													Sin email
												</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-4">
				{#if sendComplete}
					<div></div>
					<button on:click={cerrarPreviewModal} class="btn-secondary apple-transition">
						Cerrar
					</button>
				{:else}
					<p class="text-xs text-[var(--text-muted)]">
						Se enviará un email con link al Portal del Conductor
					</p>
					<div class="flex items-center gap-3">
						<button
							on:click={cerrarPreviewModal}
							disabled={sendingEmails}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"
						>
							Cancelar
						</button>
						<button
							on:click={confirmarEnvioDesprendibles}
							disabled={sendingEmails || previewItems.filter((p) => p.canSend).length === 0}
							class="apple-transition flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
							style="background: linear-gradient(135deg, #10B981, #059669);"
						>
							{#if sendingEmails}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Enviando...
							{:else}
								<Send class="h-4 w-4" />
								Enviar {previewItems.filter((p) => p.canSend).length} Email(s)
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════ -->
<!-- MODAL: PREVIEW / ENVÍO DE PRIMAS                         -->
<!-- ═══════════════════════════════════════════════════════ -->
{#if showPreviewPrimasModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		on:click={cerrarPreviewPrimasModal}
		on:keydown={(e) => e.key === 'Escape' && cerrarPreviewPrimasModal()}
		role="button"
		tabindex="-1"
	>
		<div
			class="confirm-card relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0"
			on:click|stopPropagation
			on:keydown={() => {}}
			role="dialog"
			tabindex="0"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[var(--border-subtle)] bg-gradient-to-r from-[#F59E0B] to-[#D97706] px-6 py-4"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
						<Sparkles class="h-5 w-5 text-white" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-white">Enviar Primas</h2>
						<p class="text-sm text-white/80">Vista previa de liquidaciones de prima por email</p>
					</div>
				</div>
				<button
					on:click={cerrarPreviewPrimasModal}
					class="apple-transition rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto bg-white p-6">
				{#if previewPrimasLoading}
					<div class="flex flex-col items-center justify-center py-12">
						<div
							class="spinner mb-4"
							style="border-top-color: #F59E0B; border-color: rgba(245,158,11,0.20);"
						></div>
						<p class="text-sm text-[var(--text-muted)]">Cargando datos de conductores...</p>
					</div>
				{:else if sendPrimasComplete}
					<div class="space-y-3">
						<div
							class="mb-4 flex items-center gap-3 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] p-4"
						>
							<CheckCircle class="h-6 w-6 flex-shrink-0 text-[#D97706]" />
							<div>
								<p class="font-semibold text-[var(--text-primary)]">Envío de primas completado</p>
								<p class="text-sm text-[var(--text-secondary)]">
									{sendPrimasResults.filter((r) => r.status === 'enviado').length} enviado(s),
									{sendPrimasResults.filter((r) => r.status === 'error').length} error(es)
								</p>
							</div>
						</div>
						{#each sendPrimasResults as result}
							<div
								class="list-card flex items-center gap-3 p-3 {result.status === 'error'
									? '!border-[rgba(220,38,38,0.25)] !bg-[rgba(220,38,38,0.04)]'
									: ''}"
							>
								{#if result.status === 'enviado'}
									<CheckCircle class="h-5 w-5 flex-shrink-0 text-[#D97706]" />
								{:else}
									<XCircle class="h-5 w-5 flex-shrink-0 text-[#DC2626]" />
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-semibold text-[var(--text-primary)]">
										{result.conductor}
									</p>
									<p class="truncate text-xs text-[var(--text-muted)]">
										{result.email || 'Sin email'}
									</p>
								</div>
								{#if result.status === 'error'}
									<span
										class="status-pill !bg-[rgba(220,38,38,0.10)] !text-[#991B1B]"
										>{result.message}</span
									>
								{:else}
									<span
										class="status-pill !bg-[rgba(245,158,11,0.10)] !text-[#92400E]"
										>Enviado</span
									>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="mb-4 flex items-center gap-4">
						<div
							class="flex items-center gap-2 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
						>
							<CheckCircle class="h-4 w-4 text-[#D97706]" />
							<span class="text-sm font-semibold text-[#92400E]"
								>{previewPrimaItems.filter((p) => p.canSend).length} con email</span
							>
						</div>
						{#if previewPrimaItems.filter((p) => !p.canSend).length > 0}
							<div
								class="flex items-center gap-2 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
							>
								<AlertCircle class="h-4 w-4 text-[#D97706]" />
								<span class="text-sm font-semibold text-[#92400E]"
									>{previewPrimaItems.filter((p) => !p.canSend).length} sin email</span
								>
							</div>
						{/if}
					</div>

					<div class="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
						<table class="w-full text-sm">
							<thead class="table-header">
								<tr>
									<th class="text-left">Conductor</th>
									<th class="text-left">Email</th>
									<th class="text-center">Periodo</th>
									<th class="text-right">Monto</th>
									<th class="text-center">Estado</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-[var(--border-subtle)]">
								{#each previewPrimaItems as item}
									<tr class="table-row">
										<td class="px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
											{item.conductor}
										</td>
										<td class="px-4 py-3 text-sm text-[var(--text-secondary)]">
											{#if item.email}
												<span>{item.email}</span>
											{:else}
												<span class="text-xs text-[var(--text-very-muted)] italic">Sin email</span>
											{/if}
										</td>
										<td class="px-4 py-3 text-center font-mono-meta text-[0.7rem] text-[var(--emerald-700)]">
											{getPrimaMesLabel(item.mes)}
											{item.anio}
										</td>
										<td class="px-4 py-3 text-right text-sm font-bold text-[var(--text-primary)]">
											{formatCurrency(item.prima + (item.prima_pendiente || 0))}
										</td>
										<td class="px-4 py-3 text-center">
											{#if item.canSend}
												<span
													class="status-pill !bg-[rgba(245,158,11,0.10)] !text-[#92400E]"
												>Listo</span>
											{:else}
												<span
													class="status-pill !bg-[rgba(0,0,0,0.04)] !text-[var(--text-muted)]"
												>Sin email</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-4">
				{#if sendPrimasComplete}
					<div></div>
					<button on:click={cerrarPreviewPrimasModal} class="btn-secondary apple-transition">
						Cerrar
					</button>
				{:else}
					<p class="text-xs text-[var(--text-muted)]">
						Se enviará un email con link al Portal del Conductor
						<span class="text-[#D97706]">(highlight de prima)</span>
					</p>
					<div class="flex items-center gap-3">
						<button
							on:click={cerrarPreviewPrimasModal}
							disabled={sendingPrimasEmails}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"
						>
							Cancelar
						</button>
						<button
							on:click={confirmarEnvioPrimas}
							disabled={sendingPrimasEmails ||
								previewPrimaItems.filter((p) => p.canSend).length === 0}
							class="apple-transition flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
							style="background: linear-gradient(135deg, #F59E0B, #D97706);"
						>
							{#if sendingPrimasEmails}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Enviando...
							{:else}
								<Send class="h-4 w-4" />
								Enviar {previewPrimaItems.filter((p) => p.canSend).length} Email(s)
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
