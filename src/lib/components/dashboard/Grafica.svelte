<script lang="ts" module>
	import {
		Chart as ChartJS,
		BarController,
		LineController,
		DoughnutController,
		BarElement,
		LineElement,
		PointElement,
		ArcElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend,
		Filler
	} from 'chart.js';
	ChartJS.register(
		BarController,
		LineController,
		DoughnutController,
		BarElement,
		LineElement,
		PointElement,
		ArcElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend,
		Filler
	);

	/** Lee los colores del tema en tiempo de ejecución: así la misma gráfica sale verde aquí y naranja en Cotransmeq. */
	function token(nombre: string, porDefecto: string): string {
		if (typeof document === 'undefined') return porDefecto;
		return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || porDefecto;
	}
	function conAlpha(hex: string, alpha: number): string {
		const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
		if (!m) return hex;
		return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
	}
</script>

<script lang="ts">
	/**
	 * Envoltorio de Chart.js con el estilo del panel: tooltip oscuro,
	 * cuadrícula tenue, paleta de marca. `series` lleva una entrada por
	 * conjunto de datos; `formato` decide cómo se leen los valores.
	 */
	import { Bar, Line, Doughnut } from 'svelte-chartjs';
	import { numero, pesos, pesosCortos, horas } from '$lib/dashboard/formato';

	export interface Serie {
		etiqueta: string;
		datos: number[];
		/** Hex, o `primario` / `oscuro` para los colores de la marca (cambian por empresa). */
		color?: string;
		/** Solo en gráficas de barras: dibuja esta serie como línea encima. */
		linea?: boolean;
	}

	interface Props {
		tipo?: 'barras' | 'lineas' | 'dona';
		etiquetas: string[];
		series: Serie[];
		formato?: 'numero' | 'pesos' | 'horas';
		apilado?: boolean;
		leyenda?: boolean;
		alto?: number;
		/** Rellena bajo las líneas. */
		relleno?: boolean;
	}
	let {
		tipo = 'barras',
		etiquetas,
		series,
		formato = 'numero',
		apilado = false,
		leyenda = true,
		alto = 220,
		relleno = true
	}: Props = $props();

	const PALETA = $derived([
		token('--au-primary', '#079665'),
		token('--au-dark', '#014339'),
		'#f59e0b',
		'#64748b',
		'#8b5cf6',
		'#ef4444',
		'#0ea5e9'
	]);
	const textoMuted = token('--text-muted', '#66756f');
	const bordeSuave = token('--border-subtle', '#e6ece9');

	/// ¿Este tramo es el más alto de su columna? En una pila, Chart.js apila
	/// en el orden de los datasets (el primero abajo), así que corona el de
	/// mayor índice con valor > 0 entre los visibles. Sin pila, siempre.
	function esCima(ctx: any): boolean {
		if (!apilado) return true;
		const chart = ctx.chart;
		const i = ctx.dataIndex;
		let cima = -1;
		chart.data.datasets.forEach((ds: any, di: number) => {
			if (ds.type === 'line' || !chart.isDatasetVisible(di)) return;
			if (Number(ds.data?.[i]) > 0) cima = di;
		});
		return cima === ctx.datasetIndex;
	}

	const fmt = $derived((v: number) =>
		formato === 'pesos' ? pesos(v) : formato === 'horas' ? horas(v) : numero(v)
	);
	const fmtEje = $derived((v: number) =>
		formato === 'pesos' ? pesosCortos(v) : formato === 'horas' ? horas(v) : numero(v)
	);

	const datos = $derived({
		labels: etiquetas,
		datasets: series.map((s, i) => {
			const color =
				s.color === 'primario'
					? PALETA[0]
					: s.color === 'oscuro'
						? PALETA[1]
						: (s.color ?? PALETA[i % PALETA.length]);
			if (tipo === 'dona') {
				return {
					label: s.etiqueta,
					data: s.datos,
					backgroundColor: s.datos.map((_, j) => PALETA[j % PALETA.length]),
					borderColor: '#fff',
					borderWidth: 2,
					hoverOffset: 6
				};
			}
			if (tipo === 'lineas' || s.linea) {
				return {
					type: 'line' as const,
					label: s.etiqueta,
					data: s.datos,
					borderColor: color,
					backgroundColor: relleno ? conAlpha(color, 0.12) : 'transparent',
					fill: relleno && !s.linea,
					tension: 0.35,
					borderWidth: 2,
					pointRadius: etiquetas.length > 40 ? 0 : 2.5,
					pointHoverRadius: 5,
					pointBackgroundColor: color,
					order: 0
				};
			}
			return {
				label: s.etiqueta,
				data: s.datos,
				backgroundColor: color,
				hoverBackgroundColor: conAlpha(color, 0.85),
				/// Radio solo en las esquinas de arriba y solo en el tramo que corona
				/// cada columna: con un radio por tramo, los de abajo de una pila
				/// salían como píldoras sueltas.
				borderRadius: (ctx: any) =>
					esCima(ctx) ? { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 } : 0,
				borderSkipped: false,
				maxBarThickness: 28,
				order: 1
			};
		})
	});

	const opciones = $derived({
		responsive: true,
		maintainAspectRatio: false,
		interaction: { mode: 'index' as const, intersect: false },
		plugins: {
			legend: {
				display: leyenda && (series.length > 1 || tipo === 'dona'),
				position: 'bottom' as const,
				labels: {
					usePointStyle: true,
					pointStyle: 'rectRounded',
					boxWidth: 9,
					boxHeight: 9,
					color: '#33423d',
					font: { size: 11, weight: 600 as const },
					padding: 14
				}
			},
			tooltip: {
				backgroundColor: '#17201d',
				titleColor: '#fff',
				bodyColor: '#d9e3df',
				padding: 10,
				cornerRadius: 10,
				displayColors: series.length > 1,
				callbacks: {
					label: (ctx: any) =>
						` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${fmt(Number(ctx.parsed?.y ?? ctx.parsed ?? 0))}`
				}
			}
		},
		scales:
			tipo === 'dona'
				? {}
				: {
						x: {
							stacked: apilado,
							grid: { display: false },
							ticks: {
								color: textoMuted,
								font: { size: 11 },
								maxRotation: 0,
								autoSkip: true,
								maxTicksLimit: 12
							},
							border: { display: false }
						},
						y: {
							stacked: apilado,
							beginAtZero: true,
							grid: { color: bordeSuave },
							border: { display: false, dash: [3, 3] },
							ticks: {
								color: textoMuted,
								font: { size: 11 },
								maxTicksLimit: 5,
								precision: 0,
								callback: (v: any) => fmtEje(Number(v))
							}
						}
					}
	});
</script>

<div class="grafica" style="height: {alto}px">
	{#if tipo === 'dona'}
		<Doughnut data={datos as any} options={{ ...opciones, cutout: '68%' } as any} />
	{:else if tipo === 'lineas'}
		<Line data={datos as any} options={opciones as any} />
	{:else}
		<Bar data={datos as any} options={opciones as any} />
	{/if}
</div>

<style>
	.grafica {
		position: relative;
		width: 100%;
		min-width: 0;
	}
</style>
