<script lang="ts">
	/**
	 * Canvas de ANÁLISIS de nómina.
	 *
	 * Era la tercera pestaña de `/dashboard/nomina`, la más grande de las tres
	 * en markup y la única que no escribe nada: solo consulta. Al pasar a
	 * pantalla completa gana justo donde sufría — las gráficas ya no compiten
	 * por el alto con la cáscara del dashboard.
	 *
	 * No monta Univer. La cáscara (`UniverShell`, vía el `+layout@.svelte`) es
	 * solo layout de viewport completo más el toolbar con el «Ir a…»; el
	 * contenido son gráficas de `chart.js` y tablas.
	 *
	 * Sus cuatro sub-pestañas —bonificaciones, recargos, pernotes y
	 * mantenimientos— se quedan DENTRO del canvas. El «Ir a…» sirve para
	 * saltar entre módulos, no para navegar dentro de uno.
	 */
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Bar, Doughnut } from 'svelte-chartjs';
	import {
		AlertCircle,
		BarChart2,
		ChevronLeft,
		ChevronRight,
		Moon,
		Plus,
		TrendingUp,
		Wrench,
		Zap
	} from 'lucide-svelte';
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		BarElement,
		CategoryScale,
		LinearScale,
		ArcElement
	} from 'chart.js';
	import { texto, opcion, firma } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { obtenerAnalisis } from '$lib/api/nomina';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import SelectorCanvasNomina from '$lib/components/univer/SelectorCanvasNomina.svelte';

	ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement);

	// =============================================
	// TIPOS ANALISIS
	// =============================================
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

	const ANALISIS_TABS = [
		{ key: 'bonificaciones', label: 'Bonificaciones', icon: Zap },
		{ key: 'recargos', label: 'Recargos', icon: TrendingUp },
		{ key: 'pernotes', label: 'Pernotes', icon: Moon },
		{ key: 'mantenimientos', label: 'Mantenimientos', icon: Wrench }
	];

	type TabAnalisis = 'bonificaciones' | 'recargos' | 'pernotes' | 'mantenimientos';

	// =============================================
	// FILTROS EN LA URL
	// =============================================
	/**
	 * Los mismos cuatro filtros que tenía la pestaña, con los mismos nombres,
	 * para que los enlaces ya repartidos sigan valiendo.
	 *
	 * `anio` y `mes` son además el eje que trae el «Ir a…» desde los otros
	 * canvas del módulo: llegan como número y aquí se leen como texto porque
	 * es lo que esperan los `<select>` de la barra de filtros.
	 */
	const DEFS = {
		placa: texto(),
		mes: texto(),
		anio: texto(),
		analisis: opcion<TabAnalisis>('bonificaciones')
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	/**
	 * El mes se guarda con cero delante ('09'), que es lo que valen las
	 * opciones del `<select>`. Pero el «Ir a…» de los otros canvas lo manda
	 * como número —allí `mes` es un `number`—, y un `?mes=9` dejaba el
	 * desplegable en blanco y el chip del filtro sin valor, como si no hubiera
	 * filtro puesto cuando sí lo había.
	 */
	function normalizarMes(f: ReturnType<typeof estadoUrl.leerInicial>) {
		if (/^\d$/.test(f.mes)) f.mes = f.mes.padStart(2, '0');
		return f;
	}

	let filtros = $state(normalizarMes(estadoUrl.leerInicial()));

	$effect(() => {
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/// El periodo que viaja al siguiente canvas. Si no hay filtro puesto se
	/// manda el mes en curso, que es lo que el destino habría elegido solo.
	const anioSalto = $derived(Number(filtros.anio) || new Date().getFullYear());
	const mesSalto = $derived(Number(filtros.mes) || new Date().getMonth() + 1);

	// =============================================
	// DATOS
	// =============================================
	let liquidacionesA = $state<LiquidacionA[]>([]);
	let loadingA = $state(true);

	/// Desplegable de placas del filtro. `selectedIndex` arranca en 1 porque el
	/// 0 es la opción «todas».
	let showDropdown = $state(false);
	let selectedIndex = $state(1);

	let pagesBon = $state(1);
	let pagesRec = $state(1);
	let pagesPer = $state(1);

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

	onMount(cargarAnalisis);

	function volver() {
		goto('/dashboard/nomina/canvas');
	}

	function formatCurrency(n: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
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
	const anosA = $derived.by(() => {
		const s = new Set<string>();
		liquidacionesA.forEach((l) => {
			if (l.periodo_start) s.add(new Date(l.periodo_start).getFullYear().toString());
		});
		return Array.from(s).sort((a, b) => +b - +a);
	});

	const placasA = $derived.by(() => {
		const s = new Set<string>();
		liquidacionesA.forEach((l) =>
			l.vehiculos?.forEach((v) => {
				if (v.placa) s.add(v.placa);
			})
		);
		return Array.from(s).sort();
	});

	const placasFiltradas = $derived(
		placasA.filter((p) => p.toLowerCase().includes(filtros.placa.toLowerCase()))
	);

	const liqFiltradas = $derived(
		liquidacionesA.filter((l) => {
			if (!l.periodo_start) return false;
			if (filtros.anio && new Date(l.periodo_start).getFullYear().toString() !== filtros.anio)
				return false;
			if (filtros.placa && !l.vehiculos?.some((v) => v.placa === filtros.placa)) return false;
			return true;
		})
	);

	const datosBon = $derived.by(() => {
		const res: ResBon[] = [];
		liqFiltradas.forEach((liq) => {
			liq.bonificaciones?.forEach((bon) => {
				if (!bon.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === bon.vehiculo_id);
				if (!v || (filtros.placa && v.placa !== filtros.placa)) return;
				const vals = parseValues(bon.values);
				vals.forEach((item) => {
					const mesNorm = normalizeMes(item.mes);
					if (filtros.mes && mesNorm !== filtros.mes) return;
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
	});

	const datosRec = $derived.by(() => {
		const res: ResRec[] = [];
		liqFiltradas.forEach((liq) => {
			liq.recargos?.forEach((rec) => {
				if (!rec.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === rec.vehiculo_id);
				if (!v || (filtros.placa && v.placa !== filtros.placa)) return;
				const mesNorm = normalizeMes(rec.mes);
				if (filtros.mes && mesNorm !== filtros.mes) return;
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
	});

	const datosPer = $derived.by(() => {
		const res: ResPer[] = [];
		liqFiltradas.forEach((liq) => {
			liq.pernotes?.forEach((per) => {
				if (!per.vehiculo_id) return;
				const v = liq.vehiculos?.find((x) => x.id === per.vehiculo_id);
				if (!v || (filtros.placa && v.placa !== filtros.placa)) return;
				if (
					filtros.mes &&
					per.fechas?.length &&
					!per.fechas.some((f) => f?.split('-')[1] === filtros.mes)
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
	});

	const datosMnt = $derived.by(() => {
		const map = new Map<string, ResMnt>();
		liqFiltradas.forEach((liq) => {
			const conductor = getConductorA(liq);
			liq.mantenimientos?.forEach((mnt) => {
				const v = liq.vehiculos?.find((x) => x.id === mnt.vehiculo_id);
				if (!v || (filtros.placa && v.placa !== filtros.placa)) return;
				const vals = parseValues(mnt.values as ValuesItem[] | string);
				vals.forEach((val) => {
					const cantidad = Number(val.quantity) || 0;
					if (cantidad === 0) return;
					const mesNorm = normalizeMes(val.mes);
					if (filtros.mes && mesNorm !== filtros.mes) return;
					const mesLabel = MESES.find((m) => m.valor === mesNorm)?.nombre || val.mes;
					const k = `${v.placa}|${conductor}|${mesLabel}`;
					const e = map.get(k);
					if (e) e.cantidad += cantidad;
					else map.set(k, { placa: v.placa, conductor, mes: mesLabel, cantidad });
				});
			});
		});
		return Array.from(map.values()).filter((r) => r.cantidad > 0);
	});

	// Agrupados para gráficas
	const bonPorPlaca = $derived.by(() => {
		const m: Record<string, number> = {};
		datosBon.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valorTotal;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	});
	const recPorPlaca = $derived.by(() => {
		const m: Record<string, number> = {};
		datosRec.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valor;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	});
	const perPorPlaca = $derived.by(() => {
		const m: Record<string, number> = {};
		datosPer.forEach((i) => {
			m[i.placa] = (m[i.placa] || 0) + i.valorTotal;
		});
		return Object.entries(m).map(([placa, total]) => ({ placa, total }));
	});

	const recPie = $derived.by(() => {
		let s = 0,
			n = 0;
		datosRec.forEach((i) => {
			i.pagaCliente === 'Sí' ? (s += i.valor) : (n += i.valor);
		});
		return [
			{ name: 'Paga cliente', value: s },
			{ name: 'No paga cliente', value: n }
		];
	});

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
				filtros.placa = '';
			} else {
				filtros.placa = placasFiltradas[selectedIndex - 1];
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

	const bonChartData = $derived({
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
	});
	const recChartData = $derived({
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
	});
	const perChartData = $derived({
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
	});
	const pieChartData = $derived({
		labels: recPie.map((d) => d.name),
		datasets: [
			{
				data: recPie.map((d) => d.value),
				backgroundColor: ['#059669cc', '#f97316cc'],
				borderColor: ['#059669', '#f97316'],
				borderWidth: 1
			}
		]
	});

	// Totales
	const totalBon = $derived(datosBon.reduce((s, i) => s + i.valorTotal, 0));
	const totalRec = $derived(datosRec.reduce((s, i) => s + i.valor, 0));
	const totalPer = $derived(datosPer.reduce((s, i) => s + i.valorTotal, 0));
	const totalMnt = $derived(datosMnt.reduce((s, i) => s + i.cantidad, 0));

	// Paginación análisis
	const bonPaginado = $derived(
		datosBon.slice((pagesBon - 1) * ITEMS_PER_PAGE_A, pagesBon * ITEMS_PER_PAGE_A)
	);
	const recPaginado = $derived(
		datosRec.slice((pagesRec - 1) * ITEMS_PER_PAGE_A, pagesRec * ITEMS_PER_PAGE_A)
	);
	const perPaginado = $derived(
		datosPer.slice((pagesPer - 1) * ITEMS_PER_PAGE_A, pagesPer * ITEMS_PER_PAGE_A)
	);
	const totalPagesBon = $derived(Math.max(1, Math.ceil(datosBon.length / ITEMS_PER_PAGE_A)));
	const totalPagesRec = $derived(Math.max(1, Math.ceil(datosRec.length / ITEMS_PER_PAGE_A)));
	const totalPagesPer = $derived(Math.max(1, Math.ceil(datosPer.length / ITEMS_PER_PAGE_A)));

	// Resetear página al cambiar filtros
	$effect(() => {
		if (filtros.placa || filtros.mes || filtros.anio || filtros.analisis) {
			pagesBon = 1;
			pagesRec = 1;
			pagesPer = 1;
		}
	});

	function limpiarFiltros() {
		filtros.placa = '';
		filtros.mes = '';
		filtros.anio = '';
	}
	const hayFiltros = $derived(!!(filtros.placa || filtros.mes || filtros.anio));
</script>

<svelte:head><title>Análisis de Nómina · Cotransmeq</title></svelte:head>

<UniverToolbar
	title="ANÁLISIS"
	subtitle="{liquidacionesA.length} liquidación(es) en el conjunto{hayFiltros
		? '  ·  filtrado'
		: ''}"
	onBack={volver}
	backLabel="Liquidaciones"
>
	{#snippet actions()}
		<SelectorCanvasNomina actual="analisis" anio={anioSalto} mes={mesSalto} />
	{/snippet}
</UniverToolbar>

<div class="analisis-canvas">
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
			<h3 class="mb-1 text-lg font-semibold text-[var(--text-primary)]">Sin datos para analizar</h3>
			<p class="mb-5 text-sm text-[var(--text-muted)]">
				Aún no hay liquidaciones registradas en el sistema.
			</p>
			<button onclick={volver} class="btn-primary apple-transition">
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
						bind:value={filtros.placa}
						onfocus={() => (showDropdown = true)}
						onblur={() => setTimeout(() => (showDropdown = false), 150)}
						onkeydown={handleKeydown}
					/>

					{#if showDropdown && placasFiltradas.length > 0}
						<ul
							class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-[var(--border-default)] bg-white shadow-lg"
						>
							{#each placasFiltradas as p, i}
								<li>
									<button
										type="button"
										class={`apple-transition w-full cursor-pointer px-3 py-2 text-left text-sm ${
											selectedIndex === i + 1
												? 'bg-[rgba(249,115,22,0.12)] text-[var(--emerald-700)]'
												: 'hover:bg-[var(--bg-base)]'
										}`}
										onmousedown={() => (filtros.placa = p)}
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
					<select id="filtro-mes" bind:value={filtros.mes}>
						<option value="">Todos los meses</option>
						{#each MESES as m}<option value={m.valor}>{m.nombre}</option>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label for="filtro-ano" class="filter-field-label">Año</label>
					<select id="filtro-ano" bind:value={filtros.anio}>
						<option value="">Todos los años</option>
						{#each anosA as a}<option value={a}>{a}</option>{/each}
					</select>
				</div>
			</div>
			{#if hayFiltros}
				<div class="filter-chips mt-3">
					{#if filtros.placa}
						<span class="filter-chip">
							Placa: {filtros.placa}
							<button onclick={() => (filtros.placa = '')}>✕</button>
						</span>
					{/if}
					{#if filtros.mes}
						<span class="filter-chip">
							Mes: {MESES.find((m) => m.valor === filtros.mes)?.nombre}
							<button onclick={() => (filtros.mes = '')}>✕</button>
						</span>
					{/if}
					{#if filtros.anio}
						<span class="filter-chip">
							Año: {filtros.anio}
							<button onclick={() => (filtros.anio = '')}>✕</button>
						</span>
					{/if}
					<button
						onclick={limpiarFiltros}
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
						{@const Icono = tab.icon}
						<button
							onclick={() => (filtros.analisis = tab.key as typeof filtros.analisis)}
							class="apple-transition flex items-center gap-2 border-b-2 px-5 py-4 text-sm font-semibold whitespace-nowrap
									{filtros.analisis === tab.key
								? 'border-[var(--emerald-500)] text-[var(--text-primary)]'
								: 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]'}"
						>
							<Icono class="h-4 w-4" />
							{tab.label}
						</button>
					{/each}
				</nav>
			</div>

			<div class="p-4 sm:p-6">
				<!-- ===== BONIFICACIONES ===== -->
				{#if filtros.analisis === 'bonificaciones'}
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
						<h3 class="font-semibold text-[var(--text-secondary)]">Detalle de Bonificaciones</h3>
						<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>{bonPaginado.length} / {datosBon.length}</span
						>
					</div>

					<!-- Mobile -->
					<div class="space-y-3 md:hidden">
						{#if bonPaginado.length > 0}
							{#each bonPaginado as item}
								<div class="list-card flex-col items-stretch p-4">
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
											<span class="font-bold text-[#16A34A]">{formatCurrency(item.valorTotal)}</span
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
									onclick={() => pagesBon--}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronLeft class="h-4 w-4" /></button
								>
								{#each getPageNumbers(pagesBon, totalPagesBon) as p}
									{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
											>...</span
										>
									{:else}
										<button
											onclick={() => (pagesBon = Number(p))}
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
									onclick={() => pagesBon++}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronRight class="h-4 w-4" /></button
								>
							</div>
						</div>
					{/if}

					<!-- ===== RECARGOS ===== -->
				{:else if filtros.analisis === 'recargos'}
					<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">Recargos por Vehículo</h2>

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
								<p class="font-mono-meta mb-1 text-center text-[0.65rem] text-[var(--text-muted)]">
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
											<td class="px-4 py-3 text-[var(--text-secondary)]">{item.empresa_nombre}</td>
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
													<span class="status-pill !bg-[rgba(245,158,11,0.18)] !text-[#92400E]">
														Prop {item.porcentaje_propietario}%
													</span>
												{:else if item.tipo_fila === 'cliente'}
													<span class="status-pill !bg-[rgba(59,130,246,0.10)] !text-[#1D4ED8]">
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
									onclick={() => pagesRec--}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronLeft class="h-4 w-4" /></button
								>
								{#each getPageNumbers(pagesRec, totalPagesRec) as p}
									{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
											>...</span
										>
									{:else}
										<button
											onclick={() => (pagesRec = Number(p))}
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
									onclick={() => pagesRec++}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronRight class="h-4 w-4" /></button
								>
							</div>
						</div>
					{/if}

					<!-- ===== PERNOTES ===== -->
				{:else if filtros.analisis === 'pernotes'}
					<h2 class="mb-4 text-base font-bold text-[var(--text-primary)]">Pernotes por Vehículo</h2>

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
											<span class="font-bold text-[#A16207]">{formatCurrency(item.valorTotal)}</span
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
									onclick={() => pagesPer--}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronLeft class="h-4 w-4" /></button
								>
								{#each getPageNumbers(pagesPer, totalPagesPer) as p}
									{#if p === '...'}<span class="px-2 py-2 text-xs text-[var(--text-muted)]"
											>...</span
										>
									{:else}
										<button
											onclick={() => (pagesPer = Number(p))}
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
									onclick={() => pagesPer++}
									class="apple-transition rounded-lg border border-[var(--border-default)] bg-white p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
									><ChevronRight class="h-4 w-4" /></button
								>
							</div>
						</div>
					{/if}

					<!-- ===== MANTENIMIENTOS ===== -->
				{:else if filtros.analisis === 'mantenimientos'}
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
</div>

<style>
	/* El canvas se queda el alto restante del shell y hace su propio scroll:
	   sin esto las tablas largas empujarían el toolbar fuera del viewport. */
	.analisis-canvas {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--bg-base);
	}
</style>
