<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		obtenerLiquidaciones,
		obtenerAnalisis,
		eliminarLiquidacion,
		generarDesprendibles,
		verificarEstadoDesprendibles
	} from '$lib/api/nomina';
	import type { LiquidacionesParams } from '$lib/api/nomina';
	import type { Liquidacion } from '$lib/types/nomina';
	import { toast } from 'svelte-sonner';
	import {
		Users, Plus, Edit, Trash2, Eye, FileText, Mail, TrendingUp, Clock,
		ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
		BarChart2, Zap, Moon, Wrench, AlertCircle
	} from 'lucide-svelte';
	import LiquidacionDetalleModal from '$lib/components/nomina/LiquidacionDetalleModal.svelte';
	// Chart.js via svelte-chartjs
	import { Bar, Doughnut } from 'svelte-chartjs';
	import {
		Chart, Title, Tooltip, Legend, BarElement,
		CategoryScale, LinearScale, ArcElement
	} from 'chart.js';
	Chart.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement);

	// =============================================
	// TIPOS ANALISIS
	// =============================================
	interface VehiculoA { id: string; placa: string; }
	// values llega como string JSON o array según endpoint
	interface ValuesItem { mes: string; quantity: number; }
	interface BonificacionA {
		vehiculo_id: string; name: string; value: number | string;
		values?: ValuesItem[] | string;
	}
	interface RecargoA {
		vehiculo_id: string; valor: number | string; pag_cliente: boolean;
		empresa_id?: string;
		// El endpoint /analisis usa "clientes"; otras rutas pueden usar "empresa"
		clientes?: { id?: string; nombre: string };
		empresa?:  { id?: string; nombre: string };
		mes: string;
	}
	interface PernoteA { vehiculo_id: string; cantidad: number; valor: number | string; fechas: string[]; }
	interface MantenimientoA {
		vehiculo_id: string;
		values: ValuesItem[] | string; // también puede llegar como string
	}
	interface LiquidacionA {
		id: string; periodo_start?: string; periodo_end?: string;
		// el endpoint devuelve conductor con nombre completo ya concatenado
		conductor?: { nombre?: string; apellido?: string };
		vehiculos?: VehiculoA[];
		bonificaciones?: BonificacionA[];
		recargos?: RecargoA[];
		pernotes?: PernoteA[];
		mantenimientos?: MantenimientoA[];
	}
	interface ResBon { placa: string; nombre: string; mes: string; cantidad: number; valorUnitario: number; valorTotal: number; conductor: string; }
	interface ResRec { placa: string; valor: number; pagaCliente: string; empresa_id: string; empresa_nombre: string; mes: string; conductor: string; }
	interface ResPer { placa: string; cantidad: number; valor: number; valorTotal: number; fechas: string[]; conductor: string; }
	interface ResMnt { placa: string; conductor: string; mes: string; cantidad: number; }

	// =============================================
	// CONSTANTES
	// =============================================
	const MESES = [
		{ valor: '01', nombre: 'Enero' }, { valor: '02', nombre: 'Febrero' },
		{ valor: '03', nombre: 'Marzo' }, { valor: '04', nombre: 'Abril' },
		{ valor: '05', nombre: 'Mayo' }, { valor: '06', nombre: 'Junio' },
		{ valor: '07', nombre: 'Julio' }, { valor: '08', nombre: 'Agosto' },
		{ valor: '09', nombre: 'Septiembre' }, { valor: '10', nombre: 'Octubre' },
		{ valor: '11', nombre: 'Noviembre' }, { valor: '12', nombre: 'Diciembre' }
	];
	const MESES_MAP: Record<string, string> = {
		Enero:'01', Febrero:'02', Marzo:'03', Abril:'04', Mayo:'05', Junio:'06',
		Julio:'07', Agosto:'08', Septiembre:'09', Octubre:'10', Noviembre:'11', Diciembre:'12'
	};
	const ITEMS_PER_PAGE_A = 10;

	const MAIN_TABS = [
		{ key: 'liquidaciones', label: 'Liquidaciones', icon: FileText },
		{ key: 'analisis',      label: 'Análisis',      icon: BarChart2 }
	];
	const ANALISIS_TABS = [
		{ key: 'bonificaciones',  label: 'Bonificaciones', icon: Zap },
		{ key: 'recargos',        label: 'Recargos',       icon: TrendingUp },
		{ key: 'pernotes',        label: 'Pernotes',       icon: Moon },
		{ key: 'mantenimientos',  label: 'Mantenimientos', icon: Wrench }
	];

	// =============================================
	// TAB PRINCIPAL (desde URL)
	// =============================================
	$: mainTab = $page.url.searchParams.get('tab') ?? 'liquidaciones';

	function setMainTab(tab: string) {
		const u = new URL($page.url.href);
		u.searchParams.set('tab', tab);
		goto(u.toString(), { replaceState: true, noScroll: true });
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

	let pagination = { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false };
	let stats = { totalRegistros: 0, totalPendientes: 0, montoTotal: 0 };
	let sortBy = '';
	let sortOrder: 'asc' | 'desc' = 'desc';
	let nominaMonth = '';

	// =============================================
	// ESTADO — ANÁLISIS
	// =============================================
	let liquidacionesA: LiquidacionA[] = [];
	let loadingA = true;
	let filtroPlaca = '';
	let filtroMes = '';
	let filtroAno = '';
	let analisisTab: 'bonificaciones' | 'recargos' | 'pernotes' | 'mantenimientos' = 'bonificaciones';
	let pagesBon = 1, pagesRec = 1, pagesPer = 1;

	// =============================================
	// CICLO DE VIDA
	// =============================================
	onMount(async () => {
		await Promise.all([cargarLiquidaciones(), cargarAnalisis()]);
	});

	// =============================================
	// API — LISTA
	// =============================================
	async function cargarLiquidaciones() {
		try {
			loading = true;
			const params: LiquidacionesParams = { page: pagination.page, limit: pagination.limit };
			if (searchTerm.trim()) params.search = searchTerm.trim();
			if (sortBy) { params.sortBy = sortBy; params.sortOrder = sortOrder; }
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
			const r = await obtenerAnalisis();
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
	// ACCIONES — LISTA
	// =============================================
	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => { pagination.page = 1; cargarLiquidaciones(); }, 400);
	}
	function toggleSort(col: string) {
		if (sortBy === col) { sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'; }
		else { sortBy = col; sortOrder = 'desc'; }
		pagination.page = 1; cargarLiquidaciones();
	}
	function handleMonthChange() { pagination.page = 1; cargarLiquidaciones(); }
	function clearMonthFilter() { nominaMonth = ''; pagination.page = 1; cargarLiquidaciones(); }
	function goToPage(p: number) { if (p < 1 || p > pagination.totalPages) return; pagination.page = p; cargarLiquidaciones(); }
	function handleLimitChange() { pagination.page = 1; cargarLiquidaciones(); }

	function irACrear() { goto('/dashboard/nomina/agregar'); }
	function irAEditar(id: string) { goto(`/dashboard/nomina/editar/${id}`); }
	function verDetalle(id: string) { detalleId = id; showDetalleModal = true; }

	function confirmarEliminar(id: string) { liquidacionToDelete = id; showDeleteModal = true; }
	async function eliminar() {
		if (!liquidacionToDelete) return;
		try {
			await eliminarLiquidacion(liquidacionToDelete);
			toast.success('Liquidación eliminada correctamente');
			await cargarLiquidaciones();
			showDeleteModal = false; liquidacionToDelete = null;
		} catch { toast.error('Error al eliminar la liquidación'); }
	}

	function toggleSelection(id: string) {
		selectedLiquidaciones.has(id) ? selectedLiquidaciones.delete(id) : selectedLiquidaciones.add(id);
		selectedLiquidaciones = selectedLiquidaciones;
	}
	function toggleSelectAll() {
		selectedLiquidaciones.size === liquidaciones.length
			? selectedLiquidaciones.clear()
			: liquidaciones.forEach((l) => selectedLiquidaciones.add(l.id));
		selectedLiquidaciones = selectedLiquidaciones;
	}

	async function generarDesprendiblesSeleccionados() {
		if (selectedLiquidaciones.size === 0) { toast.error('Selecciona al menos una liquidación'); return; }
		try {
			generatingPDFs = true; pdfProgress = 0;
			const r = await generarDesprendibles(Array.from(selectedLiquidaciones));
			toast.success('Generando desprendibles...');
			const interval = setInterval(async () => {
				try {
					const s = await verificarEstadoDesprendibles(r.jobId);
					pdfProgress = s.progress || 0;
					if (s.status === 'completed') {
						clearInterval(interval); generatingPDFs = false; pdfProgress = 0;
						toast.success('Desprendibles generados y enviados');
						selectedLiquidaciones.clear(); selectedLiquidaciones = selectedLiquidaciones;
					} else if (s.status === 'failed') {
						clearInterval(interval); generatingPDFs = false; pdfProgress = 0;
						toast.error('Error al generar desprendibles');
					}
				} catch { clearInterval(interval); generatingPDFs = false; pdfProgress = 0; }
			}, 2000);
		} catch { toast.error('Error al generar desprendibles'); generatingPDFs = false; pdfProgress = 0; }
	}

	// =============================================
	// FORMATO
	// =============================================
	function formatCurrency(n: number) {
		return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
	}
	function formatDate(s: string) {
		if (!s) return 'Sin fecha';
		const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
		return isNaN(d.getTime()) ? 'Sin fecha' : d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
	}
	function formatDateShort(s: string) {
		if (!s) return '';
		const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
		return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
	function formatShort(n: number) {
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
		return `$${n}`;
	}
	function getEstadoColor(e: string) {
		return e === 'Liquidado' ? 'bg-green-100 text-green-700' : e === 'Pendiente' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700';
	}
	function getPageNumbers(cur: number, total: number): (number | string)[] {
		const pages: (number | string)[] = [];
		if (total <= 7) { for (let i = 1; i <= total; i++) pages.push(i); }
		else {
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
			try { return JSON.parse(raw) as ValuesItem[]; } catch { return []; }
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
		let ini = sorted[0], ant = sorted[0];
		for (let i = 1; i < sorted.length; i++) {
			const diff = Math.round((new Date(sorted[i]).getTime() - new Date(ant).getTime()) / 86400000);
			if (diff === 1) { ant = sorted[i]; }
			else { grupos.push(ini === ant ? ini : `${ini} al ${ant}`); ini = sorted[i]; ant = sorted[i]; }
		}
		grupos.push(ini === ant ? ini : `${ini} al ${ant}`);
		return grupos;
	}



	// =============================================
	// ANÁLISIS — DATOS DERIVADOS
	// =============================================
	$: anosA = (() => {
		const s = new Set<string>();
		liquidacionesA.forEach(l => { if (l.periodo_start) s.add(new Date(l.periodo_start).getFullYear().toString()); });
		return Array.from(s).sort((a, b) => +b - +a);
	})();

	$: placasA = (() => {
		const s = new Set<string>();
		liquidacionesA.forEach(l => l.vehiculos?.forEach(v => { if (v.placa) s.add(v.placa); }));
		return Array.from(s).sort();
	})();

	$: liqFiltradas = liquidacionesA.filter(l => {
		if (!l.periodo_start) return false;
		if (filtroAno && new Date(l.periodo_start).getFullYear().toString() !== filtroAno) return false;
		if (filtroPlaca && !l.vehiculos?.some(v => v.placa === filtroPlaca)) return false;
		return true;
	});

	$: datosBon = (() => {
		const res: ResBon[] = [];
		liqFiltradas.forEach(liq => {
			liq.bonificaciones?.forEach(bon => {
				if (!bon.vehiculo_id) return;
				const v = liq.vehiculos?.find(x => x.id === bon.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const vals = parseValues(bon.values);
				vals.forEach(item => {
					const mesNorm = normalizeMes(item.mes);
					if (filtroMes && mesNorm !== filtroMes) return;
					if (item.quantity <= 0) return;
					const vu = Number(bon.value);
					// Mostrar el mes en formato legible
					const mesLabel = MESES.find(m => m.valor === mesNorm)?.nombre || item.mes;
					res.push({ placa: v.placa, nombre: bon.name, mes: mesLabel, cantidad: item.quantity, valorUnitario: vu, valorTotal: vu * item.quantity, conductor: getConductorA(liq) });
				});
			});
		});
		const map = new Map<string, ResBon>();
		res.forEach(item => {
			const k = `${item.placa}|${item.nombre}|${item.valorUnitario}|${item.conductor}`;
			const e = map.get(k);
			if (e) { e.cantidad += item.cantidad; e.valorTotal += item.valorTotal; }
			else map.set(k, { ...item });
		});
		return Array.from(map.values());
	})();

	$: datosRec = (() => {
		const res: ResRec[] = [];
		liqFiltradas.forEach(liq => {
			liq.recargos?.forEach(rec => {
				if (!rec.vehiculo_id) return;
				const v = liq.vehiculos?.find(x => x.id === rec.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const mesNorm = normalizeMes(rec.mes);
				if (filtroMes && mesNorm !== filtroMes) return;
				const mesLabel = MESES.find(m => m.valor === mesNorm)?.nombre || rec.mes;
				res.push({
					placa: v.placa, valor: Number(rec.valor),
					pagaCliente: rec.pag_cliente ? 'Sí' : 'No',
					empresa_id: rec.empresa_id,
					empresa_nombre: getEmpresaNombre(rec),
					mes: mesLabel,
					conductor: getConductorA(liq)
				});
			});
		});
		return res;
	})();

	$: datosPer = (() => {
		const res: ResPer[] = [];
		liqFiltradas.forEach(liq => {
			liq.pernotes?.forEach(per => {
				if (!per.vehiculo_id) return;
				const v = liq.vehiculos?.find(x => x.id === per.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				if (filtroMes && per.fechas?.length && !per.fechas.some(f => f?.split('-')[1] === filtroMes)) return;
				res.push({ placa: v.placa, cantidad: per.cantidad, valor: Number(per.valor), valorTotal: Number(per.valor) * per.cantidad, fechas: per.fechas, conductor: getConductorA(liq) });
			});
		});
		return res;
	})();

	$: datosMnt = (() => {
		const map = new Map<string, ResMnt>();
		liqFiltradas.forEach(liq => {
			const conductor = getConductorA(liq);
			liq.mantenimientos?.forEach(mnt => {
				const v = liq.vehiculos?.find(x => x.id === mnt.vehiculo_id);
				if (!v || (filtroPlaca && v.placa !== filtroPlaca)) return;
				const vals = parseValues(mnt.values as ValuesItem[] | string);
				vals.forEach(val => {
					const cantidad = Number(val.quantity) || 0;
					if (cantidad === 0) return;
					const mesNorm = normalizeMes(val.mes);
					if (filtroMes && mesNorm !== filtroMes) return;
					const mesLabel = MESES.find(m => m.valor === mesNorm)?.nombre || val.mes;
					const k = `${v.placa}|${conductor}|${mesLabel}`;
					const e = map.get(k);
					if (e) e.cantidad += cantidad;
					else map.set(k, { placa: v.placa, conductor, mes: mesLabel, cantidad });
				});
			});
		});
		return Array.from(map.values()).filter(r => r.cantidad > 0);
	})();

	// Agrupados para gráficas
	$: bonPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosBon.forEach(i => { m[i.placa] = (m[i.placa] || 0) + i.valorTotal; });
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();
	$: recPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosRec.forEach(i => { m[i.placa] = (m[i.placa] || 0) + i.valor; });
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();
	$: perPorPlaca = (() => {
		const m: Record<string, number> = {};
		datosPer.forEach(i => { m[i.placa] = (m[i.placa] || 0) + i.valorTotal; });
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	})();

	$: recPie = (() => {
		let s = 0, n = 0;
		datosRec.forEach(i => { i.pagaCliente === 'Sí' ? (s += i.valor) : (n += i.valor); });
		return [{ name: 'Paga cliente', value: s }, { name: 'No paga cliente', value: n }];
	})();

	const BAR_OPTS = (_label: string, _color: string) => ({
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { display: false },
			tooltip: {
				callbacks: {
					label: (ctx: any) => {
						const v = ctx.parsed.y;
						return ' ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v);
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
					label: (ctx: any) => ' ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(ctx.parsed)
				}
			}
		},
		cutout: '60%'
	};

	$: bonChartData = {
		labels: bonPorPlaca.map(d => d.placa),
		datasets: [{ label: 'Bonificaciones', data: bonPorPlaca.map(d => d.total), backgroundColor: '#059669cc', borderColor: '#059669', borderWidth: 1, borderRadius: 4 }]
	};
	$: recChartData = {
		labels: recPorPlaca.map(d => d.placa),
		datasets: [{ label: 'Recargos', data: recPorPlaca.map(d => d.total), backgroundColor: '#f97316cc', borderColor: '#f97316', borderWidth: 1, borderRadius: 4 }]
	};
	$: perChartData = {
		labels: perPorPlaca.map(d => d.placa),
		datasets: [{ label: 'Pernotes', data: perPorPlaca.map(d => d.total), backgroundColor: '#eab308cc', borderColor: '#eab308', borderWidth: 1, borderRadius: 4 }]
	};
	$: pieChartData = {
		labels: recPie.map(d => d.name),
		datasets: [{ data: recPie.map(d => d.value), backgroundColor: ['#059669cc', '#f97316cc'], borderColor: ['#059669', '#f97316'], borderWidth: 1 }]
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
		pagesBon = 1; pagesRec = 1; pagesPer = 1;
	}

	function limpiarFiltros() { filtroPlaca = ''; filtroMes = ''; filtroAno = ''; }
	$: hayFiltros = !!(filtroPlaca || filtroMes || filtroAno);
</script>

<svelte:head>
	<title>Nómina - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 sm:p-6">

	<!-- ======== HEADER ======== -->
	<div class="mb-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
					<div class="rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 p-3 shadow-lg shadow-orange-500/30">
						<Users class="h-7 w-7 text-white" />
					</div>
					Sistema de Nómina
				</h1>
				<p class="mt-1.5 text-gray-500 text-sm">Gestión de liquidaciones y desprendibles de pago</p>
			</div>

			{#if mainTab === 'liquidaciones'}
				<button
					on:click={irACrear}
					class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl hover:-translate-y-0.5 text-sm"
				>
					<Plus class="h-4 w-4" /> Nueva Liquidación
				</button>
			{/if}
		</div>

		<!-- Tab principal -->
		<div class="mt-4 flex gap-1 rounded-xl bg-white p-1 shadow-md w-fit">
			{#each MAIN_TABS as tab}
				<button
					on:click={() => setMainTab(tab.key)}
					class="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all
						{mainTab === tab.key
							? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md'
							: 'text-gray-600 hover:bg-gray-100'}"
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
		<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Total Liquidaciones</p>
						<p class="text-2xl font-bold text-gray-900">{stats.totalRegistros}</p>
						<p class="text-xs text-gray-400 mt-1">registros</p>
					</div>
					<div class="rounded-lg bg-orange-100 p-3"><FileText class="h-6 w-6 text-orange-600" /></div>
				</div>
			</div>
			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Liquidaciones Pendientes</p>
						<p class="text-2xl font-bold text-gray-900">{stats.totalPendientes}</p>
						<p class="text-xs text-gray-400 mt-1">por procesar</p>
					</div>
					<div class="rounded-lg bg-yellow-100 p-3"><Clock class="h-6 w-6 text-yellow-600" /></div>
				</div>
			</div>
			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Monto Total</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(stats.montoTotal)}</p>
					</div>
					<div class="rounded-lg bg-amber-100 p-3"><TrendingUp class="h-6 w-6 text-amber-600" /></div>
				</div>
			</div>
		</div>

		<!-- Búsqueda y filtros -->
		<div class="mb-4 rounded-xl bg-white p-4 shadow-md">
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div class="flex flex-1 flex-wrap items-center gap-3">
					<input
						type="text" bind:value={searchTerm} on:input={handleSearch}
						placeholder="Buscar por conductor, cédula o ID..."
						class="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
					/>
					<div class="flex items-center gap-2">
						<label for="nomina-month" class="whitespace-nowrap text-sm font-medium text-gray-600">Nómina:</label>
						<input id="nomina-month" type="month" bind:value={nominaMonth} on:change={handleMonthChange}
							class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20" />
					</div>
					{#if nominaMonth}
						<button on:click={clearMonthFilter} class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors" title="Limpiar filtro">✕</button>
					{/if}
				</div>
				{#if selectedLiquidaciones.size > 0}
					<button on:click={generarDesprendiblesSeleccionados} disabled={generatingPDFs}
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50">
						{#if generatingPDFs}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>{pdfProgress}%
						{:else}
							<Mail class="h-4 w-4" />Generar y Enviar ({selectedLiquidaciones.size})
						{/if}
					</button>
				{/if}
			</div>
		</div>

		<!-- Tabla de liquidaciones -->
		<div class="rounded-xl bg-white shadow-md overflow-hidden">
			{#if loading}
				<div class="flex items-center justify-center py-16">
					<div class="text-center">
						<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
						<p class="text-gray-500">Cargando liquidaciones...</p>
					</div>
				</div>

			{:else if liquidaciones.length === 0}
				<div class="py-16 text-center">
					<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50">
						<FileText class="h-8 w-8 text-orange-400" />
					</div>
					<h3 class="text-lg font-semibold text-gray-700 mb-1">Sin liquidaciones</h3>
					<p class="text-sm text-gray-500 mb-4">
						{searchTerm || nominaMonth ? 'No hay resultados para los filtros aplicados.' : 'Aún no hay liquidaciones registradas.'}
					</p>
					{#if !searchTerm && !nominaMonth}
						<button on:click={irACrear} class="rounded-lg bg-orange-500 px-5 py-2 text-sm text-white font-semibold hover:bg-orange-600 transition-colors">
							Crear primera liquidación
						</button>
					{/if}
				</div>

			{:else}
				<div class="overflow-x-auto">
					<table class="w-full">
						<thead class="bg-gray-50">
							<tr>
								<th class="px-4 py-3 text-left">
									<input type="checkbox"
										checked={selectedLiquidaciones.size === liquidaciones.length && liquidaciones.length > 0}
										on:change={toggleSelectAll}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
								</th>
								<th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">
									<button on:click={() => toggleSort('periodo')} class="flex items-center gap-1 hover:text-orange-600 transition-colors">
										Período
										{#if sortBy === 'periodo'}{#if sortOrder === 'desc'}<ChevronDown class="h-4 w-4 text-orange-600" />{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
									</button>
								</th>
								<th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">
									<button on:click={() => toggleSort('conductor')} class="flex items-center gap-1 hover:text-orange-600 transition-colors">
										Conductor
										{#if sortBy === 'conductor'}{#if sortOrder === 'desc'}<ChevronDown class="h-4 w-4 text-orange-600" />{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
									</button>
								</th>
								<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">Días Lab.</th>
								<th class="px-4 py-3 text-right text-sm font-semibold text-gray-700">
									<button on:click={() => toggleSort('monto')} class="ml-auto flex items-center gap-1 hover:text-orange-600 transition-colors">
										Monto
										{#if sortBy === 'monto'}{#if sortOrder === 'desc'}<ChevronDown class="h-4 w-4 text-orange-600" />{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
									</button>
								</th>
								<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">
									<button on:click={() => toggleSort('estado')} class="mx-auto flex items-center gap-1 hover:text-orange-600 transition-colors">
										Estado
										{#if sortBy === 'estado'}{#if sortOrder === 'desc'}<ChevronDown class="h-4 w-4 text-orange-600" />{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
									</button>
								</th>
								<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-200">
							{#each liquidaciones as liq (liq.id)}
								<tr class="hover:bg-gray-50 transition-colors">
									<td class="px-4 py-3">
										<input type="checkbox" checked={selectedLiquidaciones.has(liq.id)} on:change={() => toggleSelection(liq.id)}
											class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
									</td>
									<td class="px-4 py-3">
										<p class="text-sm font-medium text-gray-900">{formatDate(liq.periodo_inicio)}</p>
										<p class="text-sm text-gray-500">hasta {formatDate(liq.periodo_fin)}</p>
									</td>
									<td class="px-4 py-3">
										<p class="font-medium text-gray-900">{liq.conductor?.nombre || 'N/A'}</p>
										<p class="text-xs text-gray-500">ID: {liq.id.substring(0, 8)}...</p>
									</td>
									<td class="px-4 py-3 text-center">
										<p class="font-semibold text-gray-900">{liq.dias_laborados ?? 0}</p>
										{#if liq.dias_laborados_villanueva}
											<p class="text-xs text-orange-600 font-medium">{liq.dias_laborados_villanueva} en Villa.</p>
										{/if}
									</td>
									<td class="px-4 py-3 text-right">
										<p class="text-lg font-bold text-gray-900">{formatCurrency(liq.total_devengado || 0)}</p>
										<p class="text-xs text-gray-500">Devengado: {formatCurrency(liq.salario_devengado || 0)}</p>
									</td>
									<td class="px-4 py-3 text-center">
										<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {getEstadoColor(liq.estado || 'Pendiente')}">
											{liq.estado || 'Pendiente'}
										</span>
										{#if liq.fecha_liquidacion}
											<p class="text-xs text-gray-400 mt-1">{formatDateShort(liq.fecha_liquidacion)}</p>
										{/if}
									</td>
									<td class="px-4 py-3">
										<div class="flex items-center justify-center gap-1">
											<button on:click={() => verDetalle(liq.id)} class="rounded-lg p-2 text-blue-600 hover:bg-blue-50 transition-colors" title="Ver detalle"><Eye class="h-4 w-4" /></button>
											<button on:click={() => irAEditar(liq.id)} class="rounded-lg p-2 text-orange-600 hover:bg-orange-50 transition-colors" title="Editar"><Edit class="h-4 w-4" /></button>
											<button on:click={() => confirmarEliminar(liq.id)} class="rounded-lg p-2 text-red-600 hover:bg-red-50 transition-colors" title="Eliminar"><Trash2 class="h-4 w-4" /></button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Paginación lista -->
				<div class="border-t border-gray-200 bg-gray-50 px-4 py-3">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div class="text-sm text-gray-600">
							Mostrando <span class="font-semibold">{(pagination.page - 1) * pagination.limit + 1}</span> a
							<span class="font-semibold">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> de
							<span class="font-semibold">{pagination.total}</span> registros
						</div>
						<div class="flex items-center gap-4">
							<div class="flex items-center gap-2">
								<span class="text-xs font-medium text-gray-600">Mostrar:</span>
								<select bind:value={pagination.limit} on:change={handleLimitChange}
									class="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-900 focus:border-orange-500 focus:outline-none">
									<option value={10}>10</option><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
								</select>
							</div>
							<div class="flex items-center gap-1">
								<button disabled={!pagination.hasPrev} on:click={() => goToPage(pagination.page - 1)}
									class="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors">
									<ChevronLeft class="h-4 w-4" />
								</button>
								{#each getPageNumbers(pagination.page, pagination.totalPages) as p}
									{#if p === '...'}
										<span class="px-2 text-xs text-gray-400">...</span>
									{:else}
										<button on:click={() => goToPage(Number(p))}
											class="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold shadow-sm transition-colors
											{p === pagination.page ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}">
											{p}
										</button>
									{/if}
								{/each}
								<button disabled={!pagination.hasNext} on:click={() => goToPage(pagination.page + 1)}
									class="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors">
									<ChevronRight class="h-4 w-4" />
								</button>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>

	<!-- ================================================================ -->
	<!--  TAB: ANÁLISIS                                                    -->
	<!-- ================================================================ -->
	{:else if mainTab === 'analisis'}

		{#if loadingA}
			<div class="flex items-center justify-center py-24">
				<div class="text-center">
					<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
					<p class="text-gray-500">Cargando datos de análisis...</p>
				</div>
			</div>

		{:else if liquidacionesA.length === 0}
			<!-- Fallback: sin liquidaciones en absoluto -->
			<div class="rounded-xl bg-white shadow-md py-20 text-center">
				<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50">
					<AlertCircle class="h-8 w-8 text-orange-400" />
				</div>
				<h3 class="text-lg font-semibold text-gray-700 mb-1">Sin datos para analizar</h3>
				<p class="text-sm text-gray-500 mb-5">Aún no hay liquidaciones registradas en el sistema.</p>
				<button on:click={() => setMainTab('liquidaciones')} class="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm text-white font-semibold hover:bg-orange-600 transition-colors">
					<Plus class="h-4 w-4" /> Crear primera liquidación
				</button>
			</div>

		{:else}
			<!-- Filtros -->
			<div class="mb-5 rounded-xl bg-white p-4 shadow-md">
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<div>
						<label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Placa</label>
						<select bind:value={filtroPlaca} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20">
							<option value="">Todas las placas</option>
							{#each placasA as p}<option value={p}>{p}</option>{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Mes</label>
						<select bind:value={filtroMes} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20">
							<option value="">Todos los meses</option>
							{#each MESES as m}<option value={m.valor}>{m.nombre}</option>{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Año</label>
						<select bind:value={filtroAno} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20">
							<option value="">Todos los años</option>
							{#each anosA as a}<option value={a}>{a}</option>{/each}
						</select>
					</div>
				</div>
				{#if hayFiltros}
					<div class="mt-3 flex flex-wrap gap-2 items-center">
						{#if filtroPlaca}
							<span class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-0.5 text-xs font-medium text-orange-700">
								Placa: {filtroPlaca}<button on:click={() => (filtroPlaca = '')} class="ml-0.5 hover:text-orange-900">✕</button>
							</span>
						{/if}
						{#if filtroMes}
							<span class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-0.5 text-xs font-medium text-orange-700">
								Mes: {MESES.find(m => m.valor === filtroMes)?.nombre}<button on:click={() => (filtroMes = '')} class="ml-0.5 hover:text-orange-900">✕</button>
							</span>
						{/if}
						{#if filtroAno}
							<span class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-0.5 text-xs font-medium text-orange-700">
								Año: {filtroAno}<button on:click={() => (filtroAno = '')} class="ml-0.5 hover:text-orange-900">✕</button>
							</span>
						{/if}
						<button on:click={limpiarFiltros} class="text-xs text-gray-400 underline hover:text-gray-600">Limpiar todo</button>
					</div>
				{/if}
			</div>

			<!-- Resumen -->
			<div class="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
				{#each [
					{ label: 'Bonificaciones', value: formatCurrency(totalBon), count: datosBon.length },
					{ label: 'Recargos',       value: formatCurrency(totalRec), count: datosRec.length },
					{ label: 'Pernotes',       value: formatCurrency(totalPer), count: datosPer.length },
					{ label: 'Mantenimientos', value: String(totalMnt),          count: datosMnt.length }
				] as card}
					<div class="rounded-xl bg-white p-4 shadow-md">
						<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
						<p class="mt-1 text-lg font-bold text-gray-900 truncate">{card.value}</p>
						<p class="text-xs text-gray-400">{card.count} registros</p>
					</div>
				{/each}
			</div>

			<!-- Tabs de análisis -->
			<div class="rounded-xl bg-white shadow-md overflow-hidden">
				<div class="border-b border-gray-200 bg-gray-50">
					<nav class="flex overflow-x-auto">
						{#each ANALISIS_TABS as tab}
							<button
								on:click={() => (analisisTab = tab.key as typeof analisisTab)}
								class="flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors
									{analisisTab === tab.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}"
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
						<h2 class="text-base font-bold text-gray-800 mb-4">Bonificaciones por Vehículo</h2>

						{#if bonPorPlaca.length > 0}
							<div class="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3" style="height:200px">
								<Bar data={bonChartData} options={BAR_OPTS('Bonificaciones', '#059669')} />
							</div>
						{:else}
							<div class="mb-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-10 text-center">
								<BarChart2 class="mx-auto h-9 w-9 text-gray-300 mb-2" />
								<p class="text-sm text-gray-400">Sin bonificaciones para los filtros aplicados</p>
							</div>
						{/if}

						<div class="flex items-center justify-between mb-3">
							<h3 class="font-semibold text-gray-700">Detalle de Bonificaciones</h3>
							<span class="text-xs text-gray-500">{bonPaginado.length} de {datosBon.length} registros</span>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if bonPaginado.length > 0}
								{#each bonPaginado as item}
									<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
										<p class="font-semibold text-sm text-gray-800">{item.placa} — {item.nombre}</p>
										<p class="text-xs text-gray-500 mb-3">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between"><span class="text-gray-500">Mes</span><span>{item.mes}</span></div>
											<div class="flex justify-between"><span class="text-gray-500">Cantidad</span><span>{item.cantidad}</span></div>
											<div class="flex justify-between"><span class="text-gray-500">V. Unitario</span><span>{formatCurrency(item.valorUnitario)}</span></div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-gray-700">Total</span>
												<span class="font-bold text-green-600">{formatCurrency(item.valorTotal)}</span>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div class="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
									<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
									<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div class="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
							<table class="w-full text-sm">
								<thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
									<tr>
										{#each ['Placa','Conductor','Tipo','Mes','Cantidad','V. Unitario','V. Total'] as h}
											<th class="px-4 py-3 text-left font-semibold">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#if bonPaginado.length > 0}
										{#each bonPaginado as item}
											<tr class="hover:bg-gray-50 transition-colors">
												<td class="px-4 py-3 font-medium text-gray-900">{item.placa}</td>
												<td class="px-4 py-3 text-gray-600">{item.conductor}</td>
												<td class="px-4 py-3 text-gray-600">{item.nombre}</td>
												<td class="px-4 py-3 text-gray-600">{item.mes}</td>
												<td class="px-4 py-3">{item.cantidad}</td>
												<td class="px-4 py-3">{formatCurrency(item.valorUnitario)}</td>
												<td class="px-4 py-3 font-semibold text-green-600">{formatCurrency(item.valorTotal)}</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="7" class="py-12 text-center">
												<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
												<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						<!-- Paginación bon -->
						{#if totalPagesBon > 1}
							<div class="mt-4 flex items-center justify-between">
								<span class="text-xs text-gray-500">Página {pagesBon} de {totalPagesBon}</span>
								<div class="flex gap-1">
									<button disabled={pagesBon === 1} on:click={() => pagesBon--} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft class="h-4 w-4"/></button>
									{#each getPageNumbers(pagesBon, totalPagesBon) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-gray-400">...</span>
										{:else}
											<button on:click={() => (pagesBon = Number(p))} class="h-9 w-9 rounded-lg text-xs font-bold border transition-colors {p === pagesBon ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white border-transparent shadow' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">{p}</button>
										{/if}
									{/each}
									<button disabled={pagesBon === totalPagesBon} on:click={() => pagesBon++} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight class="h-4 w-4"/></button>
								</div>
							</div>
						{/if}

					<!-- ===== RECARGOS ===== -->
					{:else if analisisTab === 'recargos'}
						<h2 class="text-base font-bold text-gray-800 mb-4">Recargos por Vehículo</h2>

						<div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
							<!-- Barras recargos -->
							{#if recPorPlaca.length > 0}
								<div class="rounded-xl border border-gray-100 bg-gray-50 p-3" style="height:200px">
									<Bar data={recChartData} options={BAR_OPTS('Recargos', '#f97316')} />
								</div>
							{:else}
								<div class="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-10 text-center flex flex-col items-center justify-center">
									<BarChart2 class="h-9 w-9 text-gray-300 mb-2" />
									<p class="text-sm text-gray-400">Sin recargos</p>
								</div>
							{/if}

							<!-- Donut paga cliente -->
							<div class="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col justify-center" style="height:200px">
								{#if recPie[0].value + recPie[1].value > 0}
									<p class="text-xs font-semibold text-center text-gray-500 mb-1 uppercase tracking-wide">Paga cliente vs Empresa</p>
									<Doughnut data={pieChartData} options={DONUT_OPTS} />
								{:else}
									<div class="flex flex-col items-center justify-center h-full gap-2">
										<div class="h-20 w-20 rounded-full border-4 border-dashed border-gray-200 flex items-center justify-center">
											<p class="text-xs text-gray-400 text-center px-1">Sin datos</p>
										</div>
									</div>
								{/if}
							</div>
						</div>

						<div class="flex items-center justify-between mb-3">
							<h3 class="font-semibold text-gray-700">Detalle de Recargos</h3>
							<span class="text-xs text-gray-500">{recPaginado.length} de {datosRec.length} registros</span>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if recPaginado.length > 0}
								{#each recPaginado as item}
									<div class="rounded-lg border p-4 shadow-sm {item.pagaCliente === 'No' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}">
										<p class="font-semibold text-sm text-gray-800">{item.placa} — {item.empresa_nombre}</p>
										<p class="text-xs text-gray-500 mb-3">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between"><span class="text-gray-500">Mes</span><span>{item.mes}</span></div>
											<div class="flex justify-between">
												<span class="text-gray-500">Paga cliente</span>
												<span class="font-medium {item.pagaCliente === 'Sí' ? 'text-green-600' : 'text-red-600'}">{item.pagaCliente}</span>
											</div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-gray-700">Valor</span>
												<span class="font-bold">{formatCurrency(item.valor)}</span>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div class="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
									<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
									<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div class="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
							<table class="w-full text-sm">
								<thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
									<tr>
										{#each ['Placa','Conductor','Cliente','Mes','Valor','Paga Cliente'] as h}
											<th class="px-4 py-3 text-left font-semibold">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#if recPaginado.length > 0}
										{#each recPaginado as item}
											<tr class="hover:bg-gray-50 transition-colors {item.pagaCliente === 'No' ? 'bg-red-50' : ''}">
												<td class="px-4 py-3 font-medium text-gray-900">{item.placa}</td>
												<td class="px-4 py-3 text-gray-600">{item.conductor}</td>
												<td class="px-4 py-3 text-gray-600">{item.empresa_nombre}</td>
												<td class="px-4 py-3 text-gray-600">{item.mes}</td>
												<td class="px-4 py-3 font-semibold">{formatCurrency(item.valor)}</td>
												<td class="px-4 py-3">
													<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {item.pagaCliente === 'Sí' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
														{item.pagaCliente}
													</span>
												</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="6" class="py-12 text-center">
												<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
												<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						{#if totalPagesRec > 1}
							<div class="mt-4 flex items-center justify-between">
								<span class="text-xs text-gray-500">Página {pagesRec} de {totalPagesRec}</span>
								<div class="flex gap-1">
									<button disabled={pagesRec === 1} on:click={() => pagesRec--} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft class="h-4 w-4"/></button>
									{#each getPageNumbers(pagesRec, totalPagesRec) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-gray-400">...</span>
										{:else}
											<button on:click={() => (pagesRec = Number(p))} class="h-9 w-9 rounded-lg text-xs font-bold border transition-colors {p === pagesRec ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white border-transparent shadow' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">{p}</button>
										{/if}
									{/each}
									<button disabled={pagesRec === totalPagesRec} on:click={() => pagesRec++} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight class="h-4 w-4"/></button>
								</div>
							</div>
						{/if}

					<!-- ===== PERNOTES ===== -->
					{:else if analisisTab === 'pernotes'}
						<h2 class="text-base font-bold text-gray-800 mb-4">Pernotes por Vehículo</h2>

						{#if perPorPlaca.length > 0}
							<div class="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3" style="height:200px">
								<Bar data={perChartData} options={BAR_OPTS('Pernotes', '#eab308')} />
							</div>
						{:else}
							<div class="mb-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-10 text-center">
								<Moon class="mx-auto h-9 w-9 text-gray-300 mb-2" />
								<p class="text-sm text-gray-400">Sin pernotes para los filtros aplicados</p>
							</div>
						{/if}

						<div class="flex items-center justify-between mb-3">
							<h3 class="font-semibold text-gray-700">Detalle de Pernotes</h3>
							<span class="text-xs text-gray-500">{perPaginado.length} de {datosPer.length} registros</span>
						</div>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if perPaginado.length > 0}
								{#each perPaginado as item}
									<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
										<p class="font-semibold text-sm text-gray-800">{item.placa}</p>
										<p class="text-xs text-gray-500 mb-3">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between"><span class="text-gray-500">Cantidad</span><span>{item.cantidad}</span></div>
											<div class="flex justify-between"><span class="text-gray-500">V. Unitario</span><span>{formatCurrency(item.valor)}</span></div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-gray-700">Total</span>
												<span class="font-bold text-yellow-600">{formatCurrency(item.valorTotal)}</span>
											</div>
											{#if item.fechas?.length}
												<div class="border-t pt-1.5">
													<p class="text-xs text-gray-500 mb-0.5">Fechas:</p>
													<p class="text-xs text-gray-700">{agruparFechas(item.fechas).join(', ')}</p>
												</div>
											{/if}
										</div>
									</div>
								{/each}
							{:else}
								<div class="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
									<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
									<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div class="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
							<table class="w-full text-sm">
								<thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
									<tr>
										{#each ['Placa','Conductor','Cantidad','V. Unitario','V. Total','Fechas'] as h}
											<th class="px-4 py-3 text-left font-semibold">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#if perPaginado.length > 0}
										{#each perPaginado as item}
											<tr class="hover:bg-gray-50 transition-colors">
												<td class="px-4 py-3 font-medium text-gray-900">{item.placa}</td>
												<td class="px-4 py-3 text-gray-600">{item.conductor}</td>
												<td class="px-4 py-3">{item.cantidad}</td>
												<td class="px-4 py-3">{formatCurrency(item.valor)}</td>
												<td class="px-4 py-3 font-semibold text-yellow-600">{formatCurrency(item.valorTotal)}</td>
												<td class="px-4 py-3 text-gray-600 text-xs max-w-xs">
													{#if item.fechas?.length}
														{agruparFechas(item.fechas).join(', ')}
													{:else}
														<span class="text-gray-400">—</span>
													{/if}
												</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="6" class="py-12 text-center">
												<AlertCircle class="mx-auto h-8 w-8 text-gray-300 mb-2" />
												<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						{#if totalPagesPer > 1}
							<div class="mt-4 flex items-center justify-between">
								<span class="text-xs text-gray-500">Página {pagesPer} de {totalPagesPer}</span>
								<div class="flex gap-1">
									<button disabled={pagesPer === 1} on:click={() => pagesPer--} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft class="h-4 w-4"/></button>
									{#each getPageNumbers(pagesPer, totalPagesPer) as p}
										{#if p === '...'}<span class="px-2 py-2 text-xs text-gray-400">...</span>
										{:else}
											<button on:click={() => (pagesPer = Number(p))} class="h-9 w-9 rounded-lg text-xs font-bold border transition-colors {p === pagesPer ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white border-transparent shadow' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">{p}</button>
										{/if}
									{/each}
									<button disabled={pagesPer === totalPagesPer} on:click={() => pagesPer++} class="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight class="h-4 w-4"/></button>
								</div>
							</div>
						{/if}

					<!-- ===== MANTENIMIENTOS ===== -->
					{:else if analisisTab === 'mantenimientos'}
						<h2 class="text-base font-bold text-gray-800 mb-4">Mantenimientos por Vehículo</h2>

						<!-- Mobile -->
						<div class="space-y-3 md:hidden">
							{#if datosMnt.length > 0}
								{#each datosMnt as item}
									<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
										<p class="font-semibold text-sm text-gray-800">{item.placa}</p>
										<p class="text-xs text-gray-500 mb-3">{item.conductor}</p>
										<div class="space-y-1.5 text-sm">
											<div class="flex justify-between"><span class="text-gray-500">Mes</span><span>{item.mes}</span></div>
											<div class="flex justify-between border-t pt-1.5">
												<span class="font-semibold text-gray-700">Cantidad</span>
												<span class="font-bold text-purple-600">{item.cantidad}</span>
											</div>
										</div>
									</div>
								{/each}
							{:else}
								<div class="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
									<Wrench class="mx-auto h-8 w-8 text-gray-300 mb-2" />
									<p class="text-sm text-gray-400">Sin mantenimientos{hayFiltros ? ' para los filtros aplicados' : ''}</p>
								</div>
							{/if}
						</div>

						<!-- Desktop -->
						<div class="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
							<table class="w-full text-sm">
								<thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
									<tr>
										{#each ['Placa','Conductor','Mes','Cantidad Total'] as h}
											<th class="px-4 py-3 text-left font-semibold">{h}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#if datosMnt.length > 0}
										{#each datosMnt as item}
											<tr class="hover:bg-gray-50 transition-colors">
												<td class="px-4 py-3 font-medium text-gray-900">{item.placa}</td>
												<td class="px-4 py-3 text-gray-600">{item.conductor}</td>
												<td class="px-4 py-3 text-gray-600">{item.mes}</td>
												<td class="px-4 py-3 font-bold text-purple-600">{item.cantidad}</td>
											</tr>
										{/each}
									{:else}
										<tr>
											<td colspan="4" class="py-12 text-center">
												<Wrench class="mx-auto h-8 w-8 text-gray-300 mb-2" />
												<p class="text-sm text-gray-400">Sin registros{hayFiltros ? ' para los filtros aplicados' : ''}</p>
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
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		on:click={() => (showDeleteModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="button" tabindex="-1">
		<div class="rounded-xl bg-white p-6 shadow-xl max-w-md w-full mx-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog" tabindex="0">
			<h3 class="text-xl font-bold text-gray-900 mb-2">Confirmar eliminación</h3>
			<p class="text-gray-500 text-sm mb-6">¿Estás seguro de que deseas eliminar esta liquidación? Esta acción no se puede deshacer.</p>
			<div class="flex gap-3 justify-end">
				<button on:click={() => (showDeleteModal = false)} class="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors">Cancelar</button>
				<button on:click={eliminar} class="rounded-lg bg-red-600 px-4 py-2 text-sm text-white font-semibold hover:bg-red-700 transition-colors">Eliminar</button>
			</div>
		</div>
	</div>
{/if}