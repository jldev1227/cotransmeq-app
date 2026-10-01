<script lang="ts">
	/**
	 * Canvas de ANÁLISIS de nómina.
	 *
	 * Solo consulta: no monta Univer. La cáscara (`UniverShell`, vía el
	 * `+layout@.svelte`) es el viewport completo más la barra con el «Ir a…»;
	 * el contenido son filtros, cifras, gráficas de `chart.js` y tablas.
	 *
	 * Lee `GET /api/nomina/analisis`, que devuelve cada liquidación del canvas
	 * ya resuelta —periodo, estado, firma, totales del desprendible y detalle
	 * por vehículo— y los catálogos para filtrar. Los filtros de años, meses,
	 * placas, conductores y estados viajan al servidor y a la URL; la búsqueda
	 * libre, «paga cliente», la pestaña, el orden y la página se resuelven en el
	 * cliente sobre lo que llegó.
	 */
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Bar, Doughnut } from 'svelte-chartjs';
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
	import {
		ArrowUpDown,
		ChevronLeft,
		ChevronRight,
		Download,
		ExternalLink,
		RefreshCw,
		Search,
		X
	} from 'lucide-svelte';
	import { lista, opcion, texto, firma } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		nominaCanvasAPI,
		type AnalisisNominaDTO,
		type LiquidacionAnalisis
	} from '$lib/api/nomina-canvas';
	import { COLOR_HOJA_POR_ESTADO, claseBadgeEstado } from '$lib/editor/builders/nomina-estado';
	import { mascota } from '$lib/mascot';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import SelectorCanvasNomina from '$lib/components/univer/SelectorCanvasNomina.svelte';
	import SelectorMultiple from '$lib/components/listing/SelectorMultiple.svelte';

	ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement);

	// =============================================
	// CONSTANTES
	// =============================================
	const MESES = [
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
	const MES_CORTO = [
		'Ene',
		'Feb',
		'Mar',
		'Abr',
		'May',
		'Jun',
		'Jul',
		'Ago',
		'Sep',
		'Oct',
		'Nov',
		'Dic'
	];
	const ESTADOS = ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'PAGADA', 'FIRMADA', 'ANULADA'];
	const ETIQUETA_ESTADO: Record<string, string> = {
		BORRADOR: 'Borrador',
		LIQUIDADA: 'Liquidada',
		APROBADA: 'Aprobada',
		PAGADA: 'Pagada',
		FIRMADA: 'Firmada',
		ANULADA: 'Anulada'
	};
	const POR_PAGINA = 15;

	type Tab = 'resumen' | 'bonificaciones' | 'recargos' | 'pernotes' | 'mantenimientos';
	const TABS: { key: Tab; label: string }[] = [
		{ key: 'resumen', label: 'Liquidaciones' },
		{ key: 'bonificaciones', label: 'Bonificaciones' },
		{ key: 'recargos', label: 'Recargos' },
		{ key: 'pernotes', label: 'Pernoctes' },
		{ key: 'mantenimientos', label: 'Mantenimientos' }
	];

	// =============================================
	// FILTROS EN LA URL
	// =============================================
	const DEFS = {
		anios: lista(),
		meses: lista(),
		placas: lista(),
		conductores: lista(),
		estados: lista(),
		pagaCliente: opcion<'todos' | 'si' | 'no'>('todos'),
		q: texto(),
		analisis: opcion<Tab>('resumen')
	};
	const estadoUrl = crearEstadoUrl(DEFS);

	/**
	 * Compatibilidad con los enlaces antiguos y con el «Ir a…» de los otros
	 * canvas, que mandan `anio` y `mes` en singular (y `placa`): se vuelcan en
	 * las listas. `mes=9` y `mes=09` valen igual.
	 */
	function conLegado(f: ReturnType<typeof estadoUrl.leerInicial>) {
		if (!browser) return f;
		const p = page.url.searchParams;
		const anio = p.get('anio');
		const mes = p.get('mes');
		const placa = p.get('placa');
		if (anio && !f.anios.length) f.anios = [anio];
		if (mes && !f.meses.length) f.meses = [String(Number(mes)).padStart(2, '0')];
		if (placa && !f.placas.length) f.placas = [placa.toUpperCase()];
		f.meses = f.meses.map((m) => String(Number(m)).padStart(2, '0'));
		/// Una vez volcados, los parámetros antiguos se quitan de la barra: si
		/// se quedaran, al soltar un chip la URL seguiría diciendo `mes=09` y
		/// recargar lo volvería a poner.
		if (anio || mes || placa) {
			const u = new URL(window.location.href);
			for (const k of ['anio', 'mes', 'placa']) u.searchParams.delete(k);
			window.history.replaceState(window.history.state, '', u.toString());
		}
		return f;
	}

	let filtros = $state(conLegado(estadoUrl.leerInicial()));

	$effect(() => {
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/// El periodo que viaja al siguiente canvas: el primer año y mes elegidos,
	/// o el mes en curso si no hay filtro.
	const anioSalto = $derived(Number(filtros.anios[0]) || new Date().getFullYear());
	const mesSalto = $derived(Number(filtros.meses[0]) || new Date().getMonth() + 1);

	// =============================================
	// DATOS
	// =============================================
	let datos = $state<AnalisisNominaDTO | null>(null);
	let cargando = $state(true);
	let errorCarga = $state('');
	let firmaCargada = '';

	/// Lo que decide una nueva consulta al servidor. La búsqueda libre, «paga
	/// cliente», la pestaña y la página no: se resuelven sobre lo que ya llegó.
	const firmaServidor = $derived(
		JSON.stringify([
			filtros.anios,
			filtros.meses,
			filtros.placas,
			filtros.conductores,
			filtros.estados
		])
	);

	async function cargar(forzar = false) {
		const f = firmaServidor;
		if (!forzar && f === firmaCargada) return;
		cargando = true;
		errorCarga = '';
		try {
			const r = await nominaCanvasAPI.analisis({
				anios: filtros.anios.map(Number).filter(Boolean),
				meses: filtros.meses.map(Number).filter(Boolean),
				placas: filtros.placas,
				conductores: filtros.conductores,
				estados: filtros.estados
			});
			datos = r;
			firmaCargada = f;
		} catch (e: any) {
			errorCarga = e?.response?.data?.error || e?.message || 'No se pudo cargar el análisis.';
			toast.error(errorCarga);
		} finally {
			cargando = false;
		}
	}

	$effect(() => {
		void firmaServidor;
		void cargar();
	});

	function volver() {
		goto('/dashboard/nomina');
	}

	// =============================================
	// UTILIDADES
	// =============================================
	const cop = new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	});
	const fmt = (n: number) => cop.format(Math.round(n || 0));
	const fmtCorto = (v: number) => {
		const a = Math.abs(v);
		if (a >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)} mM`;
		if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)} M`;
		if (a >= 1_000) return `$${Math.round(v / 1_000)} k`;
		return `$${Math.round(v)}`;
	};
	const num = new Intl.NumberFormat('es-CO');

	function normalizar(s: string) {
		return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}

	/** «Septiembre», «Sep», «09», «9» → «09». */
	function mesClave(m: string): string {
		const t = normalizar(String(m ?? '').trim());
		if (/^\d{1,2}$/.test(t)) return t.padStart(2, '0');
		const i = MESES.findIndex(
			(n) => normalizar(n) === t || normalizar(n).startsWith(t.slice(0, 3))
		);
		return i >= 0 ? String(i + 1).padStart(2, '0') : t;
	}
	const mesNombre = (clave: string) => MESES[Number(clave) - 1] ?? clave;
	const periodoCorto = (l: LiquidacionAnalisis) => `${MES_CORTO[l.mes - 1] ?? l.mes} ${l.anio}`;
	const periodoLargo = (l: LiquidacionAnalisis) => {
		const ini = l.periodo_start.slice(8, 10);
		const fin = l.periodo_end.slice(8, 10);
		const mIni = Number(l.periodo_start.slice(5, 7));
		return `${ini} ${MES_CORTO[mIni - 1] ?? ''} – ${fin} ${MES_CORTO[l.mes - 1] ?? ''} ${l.anio}`;
	};

	function fechasAgrupadas(fechas: string[]): string {
		if (!fechas?.length) return '—';
		const sorted = [...fechas].sort();
		const grupos: string[] = [];
		let ini = sorted[0];
		let ant = sorted[0];
		for (let i = 1; i < sorted.length; i++) {
			const diff = Math.round(
				(new Date(sorted[i]).getTime() - new Date(ant).getTime()) / 86_400_000
			);
			if (diff === 1) ant = sorted[i];
			else {
				grupos.push(ini === ant ? ini.slice(5) : `${ini.slice(5)} al ${ant.slice(5)}`);
				ini = sorted[i];
				ant = sorted[i];
			}
		}
		grupos.push(ini === ant ? ini.slice(5) : `${ini.slice(5)} al ${ant.slice(5)}`);
		return grupos.join(', ');
	}

	// =============================================
	// FILTRADO EN CLIENTE
	// =============================================
	const liqs = $derived.by(() => {
		const todas = datos?.liquidaciones ?? [];
		const q = normalizar(filtros.q.trim());
		if (!q) return todas;
		return todas.filter(
			(l) =>
				normalizar(l.conductor.nombre).includes(q) ||
				(l.conductor.cedula ?? '').includes(q) ||
				l.vehiculos.some((v) => normalizar(v.placa).includes(q))
		);
	});

	const placaPasa = (placa: string | null) =>
		!filtros.placas.length || (!!placa && filtros.placas.includes(placa));
	const mesPasa = (clave: string) => !filtros.meses.length || filtros.meses.includes(clave);

	// ── Bonificaciones ──
	interface FilaBon {
		placa: string;
		conductor: string;
		nombre: string;
		mes: string;
		mesClave: string;
		anio: number;
		cantidad: number;
		valorUnitario: number;
		total: number;
	}
	const filasBon = $derived.by(() => {
		const mapa = new Map<string, FilaBon>();
		for (const l of liqs) {
			for (const b of l.bonificaciones) {
				if (!placaPasa(b.placa)) continue;
				for (const v of b.valores) {
					const mk = mesClave(v.mes);
					if (!mesPasa(mk) || v.cantidad <= 0) continue;
					const k = `${b.placa}|${b.nombre}|${b.valor_unitario}|${l.conductor.nombre}|${l.anio}|${mk}`;
					const e = mapa.get(k);
					if (e) {
						e.cantidad += v.cantidad;
						e.total += v.cantidad * b.valor_unitario;
					} else {
						mapa.set(k, {
							placa: b.placa ?? '—',
							conductor: l.conductor.nombre,
							nombre: b.nombre,
							mes: mesNombre(mk),
							mesClave: mk,
							anio: l.anio,
							cantidad: v.cantidad,
							valorUnitario: b.valor_unitario,
							total: v.cantidad * b.valor_unitario
						});
					}
				}
			}
		}
		return Array.from(mapa.values());
	});

	// ── Recargos ──
	interface FilaRec {
		placa: string;
		conductor: string;
		cliente: string;
		mes: string;
		mesClave: string;
		anio: number;
		valor: number;
		pagaCliente: boolean;
		parte: 'cliente' | 'propietario' | null;
		porcentaje: number;
	}
	const filasRec = $derived.by(() => {
		const res: FilaRec[] = [];
		for (const l of liqs) {
			for (const r of l.recargos) {
				if (!placaPasa(r.placa)) continue;
				const mk = mesClave(r.mes);
				if (!mesPasa(mk)) continue;
				if (filtros.pagaCliente === 'si' && !r.paga_cliente) continue;
				if (filtros.pagaCliente === 'no' && r.paga_cliente) continue;
				const base = {
					placa: r.placa ?? '—',
					conductor: l.conductor.nombre,
					cliente: r.cliente || '—',
					mes: mesNombre(mk),
					mesClave: mk,
					anio: l.anio,
					pagaCliente: r.paga_cliente,
					porcentaje: r.porcentaje_propietario
				};
				if (r.porcentaje_propietario > 0) {
					const prop = Math.round((r.valor * r.porcentaje_propietario) / 100);
					res.push({ ...base, valor: r.valor - prop, parte: 'cliente' });
					res.push({ ...base, valor: prop, parte: 'propietario' });
				} else {
					res.push({ ...base, valor: r.valor, parte: null });
				}
			}
		}
		return res;
	});

	// ── Pernoctes ──
	interface FilaPer {
		placa: string;
		conductor: string;
		cliente: string;
		anio: number;
		cantidad: number;
		valorUnitario: number;
		total: number;
		fechas: string;
	}
	const filasPer = $derived.by(() => {
		const res: FilaPer[] = [];
		for (const l of liqs) {
			for (const p of l.pernotes) {
				if (!placaPasa(p.placa)) continue;
				if (
					filtros.meses.length &&
					p.fechas.length &&
					!p.fechas.some((f) => filtros.meses.includes(f.slice(5, 7)))
				)
					continue;
				res.push({
					placa: p.placa ?? '—',
					conductor: l.conductor.nombre,
					cliente: p.cliente || '—',
					anio: l.anio,
					cantidad: p.cantidad,
					valorUnitario: p.valor_unitario,
					total: p.cantidad * p.valor_unitario,
					fechas: fechasAgrupadas(p.fechas)
				});
			}
		}
		return res;
	});

	// ── Mantenimientos ──
	interface FilaMnt {
		placa: string;
		conductor: string;
		mes: string;
		mesClave: string;
		anio: number;
		cantidad: number;
	}
	const filasMnt = $derived.by(() => {
		const mapa = new Map<string, FilaMnt>();
		for (const l of liqs) {
			for (const m of l.mantenimientos) {
				if (!placaPasa(m.placa)) continue;
				for (const v of m.valores) {
					const mk = mesClave(v.mes);
					if (!mesPasa(mk) || v.cantidad <= 0) continue;
					const k = `${m.placa}|${l.conductor.nombre}|${l.anio}|${mk}`;
					const e = mapa.get(k);
					if (e) e.cantidad += v.cantidad;
					else
						mapa.set(k, {
							placa: m.placa ?? '—',
							conductor: l.conductor.nombre,
							mes: mesNombre(mk),
							mesClave: mk,
							anio: l.anio,
							cantidad: v.cantidad
						});
				}
			}
		}
		return Array.from(mapa.values());
	});

	// =============================================
	// CIFRAS Y GRÁFICAS
	// =============================================
	const totales = $derived.by(() => {
		const t = {
			liquidaciones: liqs.length,
			conductores: new Set(liqs.map((l) => l.conductor.id ?? l.conductor.nombre)).size,
			placas: new Set(liqs.flatMap((l) => l.vehiculos.map((v) => v.placa))).size,
			devengado: 0,
			neto: 0,
			bonificaciones: 0,
			recargos: 0,
			pernotes: 0,
			deducciones: 0,
			dias: 0,
			firmadas: 0,
			mantenimientos: filasMnt.reduce((s, f) => s + f.cantidad, 0),
			bonFilas: filasBon.reduce((s, f) => s + f.total, 0),
			recFilas: filasRec.reduce((s, f) => s + f.valor, 0),
			perFilas: filasPer.reduce((s, f) => s + f.total, 0)
		};
		for (const l of liqs) {
			t.devengado += l.salario_devengado;
			t.neto += l.sueldo_total;
			t.bonificaciones += l.total_bonificaciones;
			t.recargos += l.total_recargos;
			t.pernotes += l.total_pernotes;
			t.deducciones += l.salud + l.pension + l.total_anticipos;
			t.dias += l.dias_laborados;
			if (l.estado_flujo === 'FIRMADA') t.firmadas++;
		}
		return t;
	});

	const porEstado = $derived.by(() => {
		const m = new Map<string, number>();
		for (const l of liqs) m.set(l.estado_flujo, (m.get(l.estado_flujo) ?? 0) + 1);
		return ESTADOS.filter((e) => m.has(e)).map((e) => ({ estado: e, n: m.get(e) ?? 0 }));
	});

	/// Serie mensual sobre las liquidaciones: lo que el desprendible imprime,
	/// que es lo que se pagó, no lo que las pestañas de detalle reparten.
	const porMes = $derived.by(() => {
		const m = new Map<string, { bon: number; rec: number; per: number; neto: number }>();
		for (const l of liqs) {
			const k = `${l.anio}-${String(l.mes).padStart(2, '0')}`;
			const e = m.get(k) ?? { bon: 0, rec: 0, per: 0, neto: 0 };
			e.bon += l.total_bonificaciones;
			e.rec += l.total_recargos;
			e.per += l.total_pernotes;
			e.neto += l.sueldo_total;
			m.set(k, e);
		}
		return Array.from(m.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => ({
				clave: k,
				etiqueta: `${MES_CORTO[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`,
				...v
			}));
	});

	const porPlaca = $derived.by(() => {
		const m = new Map<string, number>();
		for (const f of filasBon) m.set(f.placa, (m.get(f.placa) ?? 0) + f.total);
		for (const f of filasRec) m.set(f.placa, (m.get(f.placa) ?? 0) + f.valor);
		for (const f of filasPer) m.set(f.placa, (m.get(f.placa) ?? 0) + f.total);
		return Array.from(m.entries())
			.filter(([p]) => p !== '—')
			.sort(([, a], [, b]) => b - a)
			.slice(0, 14)
			.map(([placa, total]) => ({ placa, total }));
	});

	const pagaCliente = $derived.by(() => {
		let si = 0;
		let no = 0;
		for (const f of filasRec) f.pagaCliente ? (si += f.valor) : (no += f.valor);
		return { si, no };
	});

	/// Colores de marca leídos del CSS: la gráfica sigue a la empresa sin
	/// repetir hexadecimales en dos repositorios.
	let colores = $state({
		primario: '#079665',
		oscuro: '#014339',
		ambar: '#f59e0b',
		azul: '#0ea5e9'
	});
	onMount(() => {
		const css = getComputedStyle(document.documentElement);
		const leer = (v: string, def: string) => css.getPropertyValue(v).trim() || def;
		colores = {
			primario: leer('--au-primary', colores.primario),
			oscuro: leer('--au-dark', colores.oscuro),
			ambar: '#f59e0b',
			azul: '#0ea5e9'
		};
	});

	const opcionesBarra = (apilada: boolean, moneda = true) => ({
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: apilada
				? { position: 'bottom' as const, labels: { font: { size: 11 }, boxWidth: 12, padding: 14 } }
				: { display: false },
			tooltip: {
				callbacks: {
					label: (ctx: any) =>
						` ${ctx.dataset.label ?? ''}: ${moneda ? fmt(ctx.parsed.y) : num.format(ctx.parsed.y)}`
				}
			}
		},
		scales: {
			x: { stacked: apilada, grid: { display: false }, ticks: { font: { size: 11 } } },
			y: {
				stacked: apilada,
				grid: { color: 'rgba(0,0,0,0.05)' },
				border: { dash: [4, 4] },
				ticks: { font: { size: 10 }, callback: (v: any) => (moneda ? fmtCorto(Number(v)) : v) }
			}
		}
	});
	const opcionesDona = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				position: 'bottom' as const,
				labels: { font: { size: 11 }, boxWidth: 12, padding: 12 }
			},
			tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
		},
		cutout: '62%'
	};
	const opcionesDonaConteo = {
		...opcionesDona,
		plugins: {
			...opcionesDona.plugins,
			tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.label}: ${ctx.parsed}` } }
		}
	};

	const datosMes = $derived({
		labels: porMes.map((m) => m.etiqueta),
		datasets: [
			{
				label: 'Bonificaciones',
				data: porMes.map((m) => m.bon),
				backgroundColor: colores.primario,
				borderRadius: 4
			},
			{
				label: 'Recargos',
				data: porMes.map((m) => m.rec),
				backgroundColor: colores.ambar,
				borderRadius: 4
			},
			{
				label: 'Pernoctes',
				data: porMes.map((m) => m.per),
				backgroundColor: colores.azul,
				borderRadius: 4
			}
		]
	});
	const datosPlaca = $derived({
		labels: porPlaca.map((p) => p.placa),
		datasets: [
			{
				label: 'Total',
				data: porPlaca.map((p) => p.total),
				backgroundColor: colores.oscuro,
				borderRadius: 4
			}
		]
	});
	const datosEstados = $derived({
		labels: porEstado.map((e) => ETIQUETA_ESTADO[e.estado] ?? e.estado),
		datasets: [
			{
				data: porEstado.map((e) => e.n),
				backgroundColor: porEstado.map((e) => COLOR_HOJA_POR_ESTADO[e.estado] ?? '#94a3b8'),
				borderWidth: 0
			}
		]
	});
	const datosPaga = $derived({
		labels: ['Paga el cliente', 'Asume la empresa'],
		datasets: [
			{
				data: [pagaCliente.si, pagaCliente.no],
				backgroundColor: [colores.primario, colores.ambar],
				borderWidth: 0
			}
		]
	});

	// =============================================
	// TABLA: ORDEN, PÁGINA Y EXPORTACIÓN
	// =============================================
	let orden = $state<{ col: string; dir: 1 | -1 }>({ col: '', dir: 1 });
	let pagina = $state(1);

	function ordenarPor(col: string) {
		orden = orden.col === col ? { col, dir: orden.dir === 1 ? -1 : 1 } : { col, dir: 1 };
	}

	function ordenar<T extends Record<string, any>>(filas: T[]): T[] {
		if (!orden.col) return filas;
		const { col, dir } = orden;
		return [...filas].sort((a, b) => {
			const x = a[col];
			const y = b[col];
			if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
			return String(x ?? '').localeCompare(String(y ?? ''), 'es') * dir;
		});
	}

	const filasActivas = $derived.by<Record<string, any>[]>(() => {
		switch (filtros.analisis) {
			case 'bonificaciones':
				return ordenar(filasBon);
			case 'recargos':
				return ordenar(filasRec);
			case 'pernotes':
				return ordenar(filasPer);
			case 'mantenimientos':
				return ordenar(filasMnt);
			default:
				return ordenar(liqs as unknown as Record<string, any>[]);
		}
	});
	const totalPaginas = $derived(Math.max(1, Math.ceil(filasActivas.length / POR_PAGINA)));
	const filasPagina = $derived(filasActivas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA));

	$effect(() => {
		void filtros.analisis;
		void filtros.q;
		void filtros.pagaCliente;
		void firmaServidor;
		pagina = 1;
	});
	$effect(() => {
		void filtros.analisis;
		orden = { col: '', dir: 1 };
	});

	interface Columna {
		key: string;
		label: string;
		num?: boolean;
		fmt?: (v: any, fila: any) => string;
	}
	const COLUMNAS: Record<Tab, Columna[]> = {
		resumen: [
			{ key: 'conductor', label: 'Conductor', fmt: (_v, f) => f.conductor.nombre },
			{ key: 'periodo_end', label: 'Periodo', fmt: (_v, f) => periodoLargo(f) },
			{
				key: 'vehiculos',
				label: 'Placas',
				fmt: (v) => v.map((x: any) => x.placa).join(', ') || '—'
			},
			{ key: 'estado_flujo', label: 'Estado', fmt: (v) => ETIQUETA_ESTADO[v] ?? v },
			{ key: 'dias_laborados', label: 'Días', num: true, fmt: (v) => num.format(v) },
			{ key: 'salario_devengado', label: 'Devengado', num: true, fmt: fmt },
			{ key: 'total_bonificaciones', label: 'Bonos', num: true, fmt: fmt },
			{ key: 'total_recargos', label: 'Recargos', num: true, fmt: fmt },
			{ key: 'total_pernotes', label: 'Pernoctes', num: true, fmt: fmt },
			{
				key: 'salud',
				label: 'Deducciones',
				num: true,
				fmt: (_v, f) => fmt(f.salud + f.pension + f.total_anticipos)
			},
			{ key: 'sueldo_total', label: 'Neto', num: true, fmt: fmt }
		],
		bonificaciones: [
			{ key: 'placa', label: 'Placa' },
			{ key: 'conductor', label: 'Conductor' },
			{ key: 'nombre', label: 'Bonificación' },
			{ key: 'mesClave', label: 'Mes', fmt: (_v, f) => `${f.mes} ${f.anio}` },
			{ key: 'cantidad', label: 'Cantidad', num: true, fmt: (v) => num.format(v) },
			{ key: 'valorUnitario', label: 'V. unitario', num: true, fmt: fmt },
			{ key: 'total', label: 'Total', num: true, fmt: fmt }
		],
		recargos: [
			{ key: 'placa', label: 'Placa' },
			{ key: 'conductor', label: 'Conductor' },
			{ key: 'cliente', label: 'Cliente' },
			{ key: 'mesClave', label: 'Mes', fmt: (_v, f) => `${f.mes} ${f.anio}` },
			{ key: 'pagaCliente', label: 'Paga cliente', fmt: (v) => (v ? 'Sí' : 'No') },
			{
				key: 'parte',
				label: 'Asume',
				fmt: (v, f) =>
					v === 'propietario'
						? `Propietario ${f.porcentaje}%`
						: v === 'cliente'
							? `Cliente ${100 - f.porcentaje}%`
							: '—'
			},
			{ key: 'valor', label: 'Valor', num: true, fmt: fmt }
		],
		pernotes: [
			{ key: 'placa', label: 'Placa' },
			{ key: 'conductor', label: 'Conductor' },
			{ key: 'cliente', label: 'Cliente' },
			{ key: 'fechas', label: 'Fechas' },
			{ key: 'cantidad', label: 'Cantidad', num: true, fmt: (v) => num.format(v) },
			{ key: 'valorUnitario', label: 'V. unitario', num: true, fmt: fmt },
			{ key: 'total', label: 'Total', num: true, fmt: fmt }
		],
		mantenimientos: [
			{ key: 'placa', label: 'Placa' },
			{ key: 'conductor', label: 'Conductor' },
			{ key: 'mesClave', label: 'Mes', fmt: (_v, f) => `${f.mes} ${f.anio}` },
			{ key: 'cantidad', label: 'Mantenimientos', num: true, fmt: (v) => num.format(v) }
		]
	};
	const columnas = $derived(COLUMNAS[filtros.analisis]);
	const celda = (c: Columna, f: any) => (c.fmt ? c.fmt(f[c.key], f) : String(f[c.key] ?? ''));

	function exportarCsv() {
		const cols = columnas;
		const lineas = [cols.map((c) => `"${c.label}"`).join(';')];
		for (const f of filasActivas) {
			lineas.push(cols.map((c) => `"${celda(c, f).replace(/"/g, '""')}"`).join(';'));
		}
		const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `analisis-nomina-${filtros.analisis}-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success(`${filasActivas.length} fila(s) exportadas.`);
	}

	function abrirEnCanvas(l: LiquidacionAnalisis) {
		const p = new URLSearchParams({
			anio: String(l.anio),
			mes: String(l.mes),
			desde: String(l.corte || 21),
			liquidacion: l.id
		});
		goto(`/dashboard/nomina/canvas?${p.toString()}`);
	}

	// =============================================
	// FILTROS: ALTERNAR
	// =============================================
	function alternar(clave: 'anios' | 'meses' | 'estados', valor: string) {
		const actual = filtros[clave];
		filtros[clave] = actual.includes(valor)
			? actual.filter((v) => v !== valor)
			: [...actual, valor];
	}
	function limpiarFiltros() {
		filtros.anios = [];
		filtros.meses = [];
		filtros.placas = [];
		filtros.conductores = [];
		filtros.estados = [];
		filtros.pagaCliente = 'todos';
		filtros.q = '';
	}
	const nFiltros = $derived(
		filtros.anios.length +
			filtros.meses.length +
			filtros.placas.length +
			filtros.conductores.length +
			filtros.estados.length +
			(filtros.pagaCliente !== 'todos' ? 1 : 0) +
			(filtros.q.trim() ? 1 : 0)
	);

	const opcionesPlacas = $derived(
		(datos?.catalogos.placas ?? []).map((p) => ({ valor: p, etiqueta: p }))
	);
	const opcionesConductores = $derived(
		(datos?.catalogos.conductores ?? []).map((c) => ({ valor: c.id, etiqueta: c.nombre }))
	);
	const aniosCatalogo = $derived.by(() => {
		const s = new Set<string>((datos?.catalogos.anios ?? []).map(String));
		for (const a of filtros.anios) s.add(a);
		return Array.from(s).sort((a, b) => Number(b) - Number(a));
	});
	const subtitulo = $derived(
		datos
			? `${totales.liquidaciones} liquidación(es) · ${totales.conductores} conductor(es) · ${totales.placas} placa(s) · Σ neto ${fmt(totales.neto)}`
			: 'cargando…'
	);
</script>

<svelte:head><title>Análisis de Nómina · Cotransmeq</title></svelte:head>

<UniverToolbar title="ANÁLISIS" subtitle={subtitulo} onBack={volver} backLabel="Liquidaciones">
	{#snippet actions()}
		<button
			type="button"
			class="univer-btn univer-btn-dark"
			onclick={() => cargar(true)}
			disabled={cargando}
			title="Volver a leer del servidor"
		>
			<RefreshCw size={13} class={cargando ? 'an-girar' : ''} /> Actualizar
		</button>
		<button
			type="button"
			class="univer-btn univer-btn-dark"
			onclick={exportarCsv}
			disabled={!filasActivas.length}
			title="Descargar la pestaña activa como CSV, con los filtros puestos"
		>
			<Download size={13} /> Exportar CSV
		</button>
		<span class="univer-divider-v"></span>
		<SelectorCanvasNomina actual="analisis" anio={anioSalto} mes={mesSalto} />
	{/snippet}
</UniverToolbar>

<div class="an">
	<!-- ── Filtros ── -->
	<section class="an-card an-filtros">
		<div class="an-filtros-fila">
			<div class="an-grupo">
				<span class="an-grupo-etiqueta">Años</span>
				<div class="an-chips">
					{#each aniosCatalogo as a (a)}
						<button
							type="button"
							class="an-chip"
							class:an-chip--activo={filtros.anios.includes(a)}
							aria-pressed={filtros.anios.includes(a)}
							onclick={() => alternar('anios', a)}>{a}</button
						>
					{/each}
					{#if !aniosCatalogo.length}<span class="an-nota">Sin años</span>{/if}
				</div>
			</div>
			<div class="an-grupo an-grupo--meses">
				<span class="an-grupo-etiqueta">Meses</span>
				<div class="an-chips">
					{#each MES_CORTO as m, i (m)}
						{@const clave = String(i + 1).padStart(2, '0')}
						<button
							type="button"
							class="an-chip an-chip--mes"
							class:an-chip--activo={filtros.meses.includes(clave)}
							aria-pressed={filtros.meses.includes(clave)}
							title={MESES[i]}
							onclick={() => alternar('meses', clave)}>{m}</button
						>
					{/each}
				</div>
			</div>
		</div>

		<div class="an-filtros-fila an-filtros-fila--selectores">
			<SelectorMultiple
				etiqueta="Placas"
				placeholder="Buscar placa…"
				opciones={opcionesPlacas}
				seleccion={filtros.placas}
				onCambiar={(s) => (filtros.placas = s)}
			/>
			<SelectorMultiple
				etiqueta="Conductores"
				placeholder="Nombre…"
				opciones={opcionesConductores}
				seleccion={filtros.conductores}
				onCambiar={(s) => (filtros.conductores = s)}
			/>
			<div class="an-grupo">
				<span class="an-grupo-etiqueta">Estados</span>
				<div class="an-chips">
					{#each ESTADOS as e (e)}
						<button
							type="button"
							class="an-chip"
							class:an-chip--activo={filtros.estados.includes(e)}
							aria-pressed={filtros.estados.includes(e)}
							onclick={() => alternar('estados', e)}
						>
							<span
								class="an-punto"
								style="background:{COLOR_HOJA_POR_ESTADO[e]}"
								aria-hidden="true"
							></span>{ETIQUETA_ESTADO[e]}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="an-filtros-fila an-filtros-fila--pie">
			<label class="an-buscador">
				<Search size={15} />
				<input
					type="search"
					bind:value={filtros.q}
					placeholder="Buscar conductor, cédula o placa…"
					aria-label="Buscar"
				/>
			</label>
			<div class="an-segmentos" role="group" aria-label="Paga cliente">
				<span class="an-grupo-etiqueta">Paga cliente</span>
				{#each [['todos', 'Todos'], ['si', 'Sí'], ['no', 'No']] as [v, l] (v)}
					<button
						type="button"
						class="an-segmento"
						class:an-segmento--activo={filtros.pagaCliente === v}
						aria-pressed={filtros.pagaCliente === v}
						onclick={() => (filtros.pagaCliente = v as 'todos' | 'si' | 'no')}>{l}</button
					>
				{/each}
			</div>
			<div class="an-filtros-resumen">
				{#if nFiltros}
					<span class="an-nota"
						>{nFiltros} filtro{nFiltros === 1 ? '' : 's'} · {totales.liquidaciones} liquidación(es)</span
					>
					<button type="button" class="an-limpiar" onclick={limpiarFiltros}
						><X size={12} /> Limpiar</button
					>
				{:else}
					<span class="an-nota">Todo el histórico · {totales.liquidaciones} liquidación(es)</span>
				{/if}
			</div>
		</div>
	</section>

	{#if cargando && !datos}
		<div class="an-estado">
			<img src={mascota('procesando').src} alt="" class="an-estado-mascota" aria-hidden="true" />
			<p>Cargando el análisis…</p>
		</div>
	{:else if errorCarga && !datos}
		<div class="an-estado">
			<img src={mascota('advertencia').src} alt="" class="an-estado-mascota" aria-hidden="true" />
			<p>{errorCarga}</p>
			<button type="button" class="btn-secondary" onclick={() => cargar(true)}>Reintentar</button>
		</div>
	{:else if datos && !liqs.length}
		<div class="an-estado">
			<img src={mascota('vacio').src} alt="" class="an-estado-mascota" aria-hidden="true" />
			<p>Ninguna liquidación cumple los filtros.</p>
			{#if nFiltros}<button type="button" class="btn-secondary" onclick={limpiarFiltros}
					>Quitar filtros</button
				>{/if}
		</div>
	{:else if datos}
		<!-- ── Cifras ── -->
		<section class="an-cifras" class:an-cargando={cargando}>
			{#each [{ etiqueta: 'Liquidaciones', valor: num.format(totales.liquidaciones), detalle: `${totales.conductores} conductores · ${totales.placas} placas` }, { etiqueta: 'Neto pagado', valor: fmt(totales.neto), detalle: `${num.format(totales.dias)} días laborados`, fuerte: true }, { etiqueta: 'Devengado', valor: fmt(totales.devengado), detalle: 'salario del periodo' }, { etiqueta: 'Bonificaciones', valor: fmt(totales.bonificaciones), detalle: `${filasBon.length} filas en detalle` }, { etiqueta: 'Recargos', valor: fmt(totales.recargos), detalle: `${filasRec.length} filas en detalle` }, { etiqueta: 'Pernoctes', valor: fmt(totales.pernotes), detalle: `${filasPer.length} filas en detalle` }, { etiqueta: 'Deducciones', valor: fmt(totales.deducciones), detalle: 'salud, pensión y anticipos' }, { etiqueta: 'Firmadas', valor: `${totales.firmadas} / ${totales.liquidaciones}`, detalle: `${totales.mantenimientos} mantenimientos` }] as c (c.etiqueta)}
				<div class="an-cifra" class:an-cifra--fuerte={c.fuerte}>
					<span class="an-cifra-etiqueta">{c.etiqueta}</span>
					<span class="an-cifra-valor">{c.valor}</span>
					<span class="an-cifra-detalle">{c.detalle}</span>
				</div>
			{/each}
		</section>

		<!-- ── Gráficas ── -->
		<section class="an-graficas" class:an-cargando={cargando}>
			<div class="an-card an-grafica an-grafica--ancha">
				<header class="an-card-cabecera">
					<h2>Por mes</h2>
					<span>Bonificaciones, recargos y pernoctes pagados en cada corte</span>
				</header>
				<div class="an-lienzo">
					{#if porMes.length}
						<Bar data={datosMes} options={opcionesBarra(true)} />
					{:else}
						<p class="an-sin">Sin datos</p>
					{/if}
				</div>
			</div>
			<div class="an-card an-grafica">
				<header class="an-card-cabecera">
					<h2>Por placa</h2>
					<span>Las {porPlaca.length} con más bonos, recargos y pernoctes</span>
				</header>
				<div class="an-lienzo">
					{#if porPlaca.length}
						<Bar data={datosPlaca} options={opcionesBarra(false)} />
					{:else}
						<p class="an-sin">Sin datos</p>
					{/if}
				</div>
			</div>
			<div class="an-card an-grafica">
				<header class="an-card-cabecera">
					<h2>Estados</h2>
					<span>Liquidaciones por estado del flujo</span>
				</header>
				<div class="an-lienzo">
					{#if porEstado.length}
						<Doughnut data={datosEstados} options={opcionesDonaConteo} />
					{:else}
						<p class="an-sin">Sin datos</p>
					{/if}
				</div>
			</div>
			<div class="an-card an-grafica">
				<header class="an-card-cabecera">
					<h2>Recargos</h2>
					<span>Quién los asume</span>
				</header>
				<div class="an-lienzo">
					{#if pagaCliente.si + pagaCliente.no > 0}
						<Doughnut data={datosPaga} options={opcionesDona} />
					{:else}
						<p class="an-sin">Sin recargos</p>
					{/if}
				</div>
			</div>
		</section>

		<!-- ── Tablas ── -->
		<section class="an-card an-tabla-card" class:an-cargando={cargando}>
			<div class="an-tabs" role="tablist">
				{#each TABS as t (t.key)}
					<button
						type="button"
						role="tab"
						class="an-tab"
						class:an-tab--activo={filtros.analisis === t.key}
						aria-selected={filtros.analisis === t.key}
						onclick={() => (filtros.analisis = t.key)}
					>
						{t.label}
						<span class="an-tab-n">
							{t.key === 'resumen'
								? liqs.length
								: t.key === 'bonificaciones'
									? filasBon.length
									: t.key === 'recargos'
										? filasRec.length
										: t.key === 'pernotes'
											? filasPer.length
											: filasMnt.length}
						</span>
					</button>
				{/each}
			</div>

			{#if !filasActivas.length}
				<div class="an-estado an-estado--corto">
					<img src={mascota('vacio').src} alt="" class="an-estado-mascota" aria-hidden="true" />
					<p>Sin registros en esta pestaña para los filtros puestos.</p>
				</div>
			{:else}
				<div class="an-scroll">
					<table class="an-tabla">
						<thead>
							<tr>
								{#each columnas as c (c.key)}
									<th class:an-th--num={c.num}>
										<button type="button" class="an-th-btn" onclick={() => ordenarPor(c.key)}>
											{c.label}
											<ArrowUpDown
												size={12}
												class={orden.col === c.key ? 'an-orden--activo' : ''}
											/>
											{#if orden.col === c.key}<span class="an-orden-dir"
													>{orden.dir === 1 ? '↑' : '↓'}</span
												>{/if}
										</button>
									</th>
								{/each}
								{#if filtros.analisis === 'resumen'}<th class="an-th--acc"></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each filasPagina as f, i (filtros.analisis + (f.id ?? i) + (pagina - 1) * POR_PAGINA)}
								<tr
									class:an-tr--prop={f.parte === 'propietario'}
									class:an-tr--empresa={filtros.analisis === 'recargos' && f.pagaCliente === false}
								>
									{#each columnas as c (c.key)}
										<td class:an-td--num={c.num} data-etiqueta={c.label}>
											{#if c.key === 'estado_flujo'}
												<span class="an-estado-pill {claseBadgeEstado(f.estado_flujo)}">
													<span
														class="an-punto"
														style="background:{COLOR_HOJA_POR_ESTADO[f.estado_flujo]}"
													></span>
													{ETIQUETA_ESTADO[f.estado_flujo] ?? f.estado_flujo}
												</span>
											{:else if c.key === 'conductor' && filtros.analisis === 'resumen'}
												<span class="an-conductor">
													<strong>{f.conductor.nombre}</strong>
													{#if f.conductor.cedula}<small>C.C. {f.conductor.cedula}</small>{/if}
												</span>
											{:else if c.key === 'pagaCliente'}
												<span class="an-si-no" class:an-si-no--si={f.pagaCliente}
													>{f.pagaCliente ? 'Sí' : 'No'}</span
												>
											{:else if c.key === 'sueldo_total' || c.key === 'total' || (c.key === 'valor' && filtros.analisis === 'recargos')}
												<strong>{celda(c, f)}</strong>
											{:else}
												{celda(c, f)}
											{/if}
										</td>
									{/each}
									{#if filtros.analisis === 'resumen'}
										<td class="an-td--acc">
											<button
												type="button"
												class="an-abrir"
												onclick={() => abrirEnCanvas(f as LiquidacionAnalisis)}
												title="Abrir esta liquidación en el canvas de nómina"
											>
												<ExternalLink size={14} /> Canvas
											</button>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<footer class="an-paginador">
					<span class="an-nota">
						{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, filasActivas.length)} de {num.format(
							filasActivas.length
						)}
					</span>
					<div class="an-paginas">
						<button
							type="button"
							class="an-pag"
							disabled={pagina === 1}
							onclick={() => pagina--}
							aria-label="Anterior"
						>
							<ChevronLeft size={15} />
						</button>
						<span class="an-pag-actual">Página {pagina} de {totalPaginas}</span>
						<button
							type="button"
							class="an-pag"
							disabled={pagina === totalPaginas}
							onclick={() => pagina++}
							aria-label="Siguiente"
						>
							<ChevronRight size={15} />
						</button>
					</div>
				</footer>
			{/if}
		</section>
	{/if}
</div>

<style>
	.an {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.25rem 2rem;
		overflow-y: auto;
		background: var(--bg-base);
	}
	@media (min-width: 1024px) {
		.an {
			padding: 1.25rem 1.75rem 2.5rem;
		}
	}
	/* Hijos de una columna flex con scroll: sin esto la última tarjeta se
	   encogía para caber en la ventana y la tabla quedaba con alto cero. */
	.an > * {
		flex-shrink: 0;
	}
	.an-card {
		background: var(--bg-surface);
		border-radius: 20px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.an-cargando {
		opacity: 0.6;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}
	:global(.an-girar) {
		animation: an-girar 0.9s linear infinite;
	}
	@keyframes an-girar {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Filtros ── */
	.an-filtros {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem 1.1rem;
	}
	.an-filtros-fila {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem 1.5rem;
		align-items: flex-start;
	}
	.an-filtros-fila--selectores {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem 1.25rem;
	}
	@media (min-width: 900px) {
		.an-filtros-fila--selectores {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.6fr);
		}
	}
	.an-filtros-fila--pie {
		align-items: center;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}
	.an-grupo {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.an-grupo--meses {
		flex: 1;
	}
	.an-grupo-etiqueta {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.an-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.an-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.38rem 0.7rem;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}
	.an-chip:hover {
		border-color: var(--emerald-500);
		color: var(--text-primary);
	}
	.an-chip--activo {
		background: var(--au-tint, #ddf7ea);
		border-color: transparent;
		color: var(--emerald-800);
	}
	.an-chip--mes {
		padding: 0.38rem 0.55rem;
		min-width: 2.6rem;
		justify-content: center;
	}
	.an-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.an-buscador {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 16rem;
		height: 40px;
		padding: 0 0.85rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		color: var(--text-very-muted);
	}
	.an-buscador:focus-within {
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb, 7, 150, 101), 0.12);
	}
	.an-buscador input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.an-buscador input:focus {
		outline: none;
	}
	.an-segmentos {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.25rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 14px;
	}
	.an-segmentos .an-grupo-etiqueta {
		padding: 0 0.5rem 0 0.6rem;
	}
	.an-segmento {
		padding: 0.4rem 0.75rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
	}
	.an-segmento--activo {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
		font-weight: 700;
	}
	.an-filtros-resumen {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-left: auto;
	}
	.an-nota {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.an-limpiar {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.7rem;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary);
		cursor: pointer;
	}
	.an-limpiar:hover {
		border-color: var(--emerald-500);
	}

	/* ── Estados vacíos ── */
	.an-estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3.5rem 1rem;
		text-align: center;
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	.an-estado--corto {
		padding: 2.5rem 1rem;
	}
	.an-estado p {
		margin: 0;
	}
	.an-estado-mascota {
		width: 8rem;
		height: 8rem;
		object-fit: contain;
	}

	/* ── Cifras ── */
	.an-cifras {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	@media (min-width: 768px) {
		.an-cifras {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	@media (min-width: 1400px) {
		.an-cifras {
			grid-template-columns: repeat(8, minmax(0, 1fr));
		}
	}
	.an-cifra {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		padding: 0.85rem 1rem;
		background: var(--bg-surface);
		border-radius: 18px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.an-cifra--fuerte {
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 100%);
		color: #fff;
	}
	.an-cifra-etiqueta {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.an-cifra--fuerte .an-cifra-etiqueta {
		color: var(--au-eyebrow, #a9efcb);
	}
	.an-cifra-valor {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.an-cifra--fuerte .an-cifra-valor {
		color: #fff;
	}
	.an-cifra-detalle {
		font-size: 0.68rem;
		color: var(--text-very-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.an-cifra--fuerte .an-cifra-detalle {
		color: rgba(255, 255, 255, 0.7);
	}

	/* ── Gráficas ── */
	.an-graficas {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	@media (min-width: 900px) {
		.an-graficas {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.an-grafica--ancha {
			grid-column: 1 / -1;
		}
	}
	@media (min-width: 1400px) {
		.an-graficas {
			grid-template-columns: 2fr 1fr 1fr 1fr;
		}
		.an-grafica--ancha {
			grid-column: auto;
		}
	}
	.an-grafica {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem 1.1rem 0.9rem;
		min-width: 0;
	}
	.an-card-cabecera {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.an-card-cabecera h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.98rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	.an-card-cabecera span {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.an-lienzo {
		position: relative;
		height: 230px;
	}
	.an-sin {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		margin: 0;
		border: 2px dashed var(--border-subtle);
		border-radius: 14px;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	/* ── Tabla ── */
	.an-tabla-card {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.an-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.6rem 0.75rem 0;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--border-subtle);
	}
	.an-tabs::-webkit-scrollbar {
		display: none;
	}
	.an-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		flex-shrink: 0;
		padding: 0.6rem 0.9rem;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
	}
	.an-tab:hover {
		color: var(--text-primary);
	}
	.an-tab--activo {
		color: var(--emerald-800);
		border-bottom-color: var(--emerald-500);
		font-weight: 700;
	}
	.an-tab-n {
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: var(--bg-base);
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.an-tab--activo .an-tab-n {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
	}
	.an-scroll {
		overflow-x: auto;
	}
	.an-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}
	.an-tabla th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.55rem 0.85rem;
		background: var(--bg-base);
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
		white-space: nowrap;
	}
	.an-th-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		cursor: pointer;
	}
	.an-th-btn:hover {
		color: var(--text-primary);
	}
	.an-th-btn :global(svg) {
		opacity: 0.4;
	}
	.an-th-btn :global(.an-orden--activo) {
		opacity: 1;
		color: var(--emerald-800);
	}
	.an-orden-dir {
		color: var(--emerald-800);
	}
	.an-th--num,
	.an-td--num {
		text-align: right;
	}
	.an-th--num .an-th-btn {
		flex-direction: row-reverse;
	}
	.an-tabla td {
		padding: 0.6rem 0.85rem;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		vertical-align: middle;
	}
	.an-td--num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.an-tabla tbody tr:hover td {
		background: rgba(var(--au-primary-rgb, 7, 150, 101), 0.04);
	}
	.an-tr--prop td {
		background: rgba(245, 158, 11, 0.06);
	}
	.an-tr--empresa td {
		background: rgba(220, 38, 38, 0.035);
	}
	.an-conductor {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.an-conductor strong {
		color: var(--text-primary);
		font-weight: 700;
	}
	.an-conductor small {
		font-size: 0.68rem;
		color: var(--text-very-muted);
	}
	.an-estado-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.an-si-no {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: rgba(220, 38, 38, 0.1);
		font-size: 0.7rem;
		font-weight: 700;
		color: #991b1b;
	}
	.an-si-no--si {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
	}
	.an-td--acc {
		text-align: right;
		white-space: nowrap;
	}
	.an-abrir {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-primary);
		cursor: pointer;
	}
	.an-abrir:hover {
		border-color: var(--emerald-500);
		color: var(--emerald-800);
	}
	.an-paginador {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		border-top: 1px solid var(--border-subtle);
	}
	.an-paginas {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.an-pag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	.an-pag:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.an-pag-actual {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	/* ── Móvil: la tabla se apila en tarjetas ── */
	@media (max-width: 767.98px) {
		.an-tabla thead {
			display: none;
		}
		.an-tabla,
		.an-tabla tbody,
		.an-tabla tr,
		.an-tabla td {
			display: block;
			width: 100%;
		}
		.an-tabla tr {
			margin: 0.6rem 0.75rem;
			padding: 0.4rem 0.75rem;
			border: 1px solid var(--border-subtle);
			border-radius: 14px;
		}
		.an-tabla td {
			display: flex;
			justify-content: space-between;
			gap: 0.75rem;
			padding: 0.4rem 0;
			border-bottom: 1px dashed var(--border-subtle);
			text-align: right;
		}
		.an-tabla td:last-child {
			border-bottom: none;
		}
		.an-tabla td::before {
			content: attr(data-etiqueta);
			flex-shrink: 0;
			font-size: 0.62rem;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--text-muted);
			text-align: left;
		}
		.an-td--acc::before {
			content: '';
		}
	}
</style>
