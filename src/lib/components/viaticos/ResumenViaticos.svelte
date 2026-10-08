<script lang="ts">
	/**
	 * Tablero de viáticos: cuánto salió en anticipos a conductores, cuánto legalizaron con sus
	 * facturas y cuánto gastó la empresa por su cuenta (oficina, mantenimientos…), por semana, mes
	 * o un rango personalizado.
	 *
	 * Gráfica de barras agrupadas (una sola escala en pesos: las tres series son dinero). Colores de
	 * la paleta categórica validada (posiciones 1–3, que pasan todos los pares): la serie siempre es
	 * el mismo color aunque cambie el rango. La aguamarina queda bajo 3:1 sobre el fondo, así que la
	 * gráfica lleva leyenda y una vista en tabla con las mismas cifras.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Bar } from 'svelte-chartjs';
	import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
	import { Table2, BarChart3 } from 'lucide-svelte';
	import {
		CATEGORIA_LABELS,
		moneda,
		viaticosEmpresaAPI,
		type Agrupacion,
		type ResumenViaticos
	} from '$lib/api/viaticos';

	ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	interface Props {
		/** Cambia cuando se registra o elimina algo, para recalcular. */
		version?: number;
	}
	let { version = 0 }: Props = $props();

	const SERIES = {
		anticipos: { etiqueta: 'Anticipos a conductores', color: '#2a78d6' },
		gastos_empresa: { etiqueta: 'Gastos de la empresa', color: '#eb6834' },
		legalizado: { etiqueta: 'Legalizado por conductores', color: '#1baf7a' }
	} as const;
	type Serie = keyof typeof SERIES;

	type Modo = 'semanas' | 'meses' | 'personalizado';
	let modo = $state<Modo>('semanas');
	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const hoy = new Date();
	let desdePersonal = $state(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
	let hastaPersonal = $state(iso(hoy));
	let agruparPersonal = $state<Agrupacion | 'auto'>('auto');
	let vistaTabla = $state(false);

	/// Rango y agrupación de cada modo: 12 semanas o 12 meses hasta hoy; el personalizado agrupa
	/// solo según su largo si no se elige.
	const rango = $derived.by((): { desde: string; hasta: string; agrupar: Agrupacion } => {
		if (modo === 'semanas') {
			const d = new Date(hoy);
			d.setDate(d.getDate() - 7 * 11 - ((d.getDay() + 6) % 7));
			return { desde: iso(d), hasta: iso(hoy), agrupar: 'semana' };
		}
		if (modo === 'meses') return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1)), hasta: iso(hoy), agrupar: 'mes' };
		const dias = (new Date(hastaPersonal).getTime() - new Date(desdePersonal).getTime()) / 86_400_000 + 1;
		const auto: Agrupacion = dias <= 45 ? 'dia' : dias <= 200 ? 'semana' : 'mes';
		return { desde: desdePersonal, hasta: hastaPersonal, agrupar: agruparPersonal === 'auto' ? auto : agruparPersonal };
	});

	let datos = $state<ResumenViaticos | null>(null);
	let cargando = $state(true);
	let consulta = 0;

	$effect(() => {
		const r = rango;
		void version;
		untrack(() => void cargar(r));
	});

	async function cargar(r: { desde: string; hasta: string; agrupar: Agrupacion }) {
		if (!r.desde || !r.hasta || r.hasta < r.desde) return;
		const actual = ++consulta;
		cargando = true;
		try {
			const d = await viaticosEmpresaAPI.resumen(r);
			if (actual === consulta) datos = d;
		} catch (error) {
			if (actual === consulta) toast.error(error instanceof Error ? error.message : 'No se pudo calcular el resumen');
		} finally {
			if (actual === consulta) cargando = false;
		}
	}

	const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	function etiquetaPeriodo(p: { desde: string; hasta: string }, agrupar: Agrupacion) {
		const [y, m, d] = p.desde.split('-').map(Number);
		if (agrupar === 'mes') return `${MESES[m - 1]} ${String(y).slice(2)}`;
		if (agrupar === 'dia') return `${d} ${MESES[m - 1]}`;
		const [, m2, d2] = p.hasta.split('-').map(Number);
		return m === m2 ? `${d}–${d2} ${MESES[m - 1]}` : `${d} ${MESES[m - 1]}–${d2} ${MESES[m2 - 1]}`;
	}

	/// Pesos abreviados para el eje: $1,2 M, $350 mil.
	function corto(v: number) {
		if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
		if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000).toLocaleString('es-CO')} mil`;
		return `$${v}`;
	}

	const ORDEN: Serie[] = ['anticipos', 'gastos_empresa', 'legalizado'];
	const grafica = $derived.by(() => {
		if (!datos) return null;
		const agrupar = datos.rango.agrupar;
		return {
			labels: datos.periodos.map((p) => etiquetaPeriodo(p, agrupar)),
			datasets: ORDEN.map((k) => ({
				label: SERIES[k].etiqueta,
				data: datos!.periodos.map((p) => p[k]),
				backgroundColor: SERIES[k].color,
				hoverBackgroundColor: SERIES[k].color,
				/// Extremo redondeado arriba, anclado a la base; separación de 2 px entre barras.
				borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
				borderSkipped: 'bottom' as const,
				borderColor: '#ffffff',
				borderWidth: { left: 1, right: 1, top: 0, bottom: 0 },
				maxBarThickness: 22,
				categoryPercentage: 0.72,
				barPercentage: 0.9
			}))
		};
	});

	const opciones = {
		responsive: true,
		maintainAspectRatio: false,
		interaction: { mode: 'index' as const, intersect: false },
		plugins: {
			legend: {
				position: 'top' as const,
				align: 'start' as const,
				labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, color: '#33423d', font: { size: 12, weight: 600 as const } }
			},
			tooltip: {
				backgroundColor: '#17201d',
				padding: 10,
				cornerRadius: 10,
				boxPadding: 4,
				usePointStyle: true,
				callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${c.dataset.label}: ${moneda(c.parsed.y ?? 0)}` }
			}
		},
		scales: {
			x: { grid: { display: false }, ticks: { color: '#66756f', font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 }, border: { color: '#dfe7e3' } },
			y: {
				beginAtZero: true,
				grid: { color: '#edf3f0' },
				border: { display: false },
				ticks: { color: '#66756f', font: { size: 11 }, maxTicksLimit: 5, callback: (v: string | number) => corto(Number(v)) }
			}
		}
	};

	const maxCategoria = $derived(Math.max(1, ...(datos?.por_categoria.map((c) => c.valor) ?? [0])));
	const maxConductor = $derived(Math.max(1, ...(datos?.top_conductores.map((c) => c.valor) ?? [0])));
	const maxPlaca = $derived(Math.max(1, ...(datos?.top_placas.map((c) => c.valor) ?? [0])));
	const sinMovimientos = $derived(!!datos && datos.totales.egresos === 0 && datos.totales.legalizado === 0);
</script>

<section class="rv" aria-label="Resumen de viáticos">
	<div class="rv-controles">
		<div class="rv-segmentos" role="radiogroup" aria-label="Periodo">
			{#each [['semanas', 'Semanal'], ['meses', 'Mensual'], ['personalizado', 'Personalizado']] as [valor, etiqueta] (valor)}
				<button
					type="button"
					role="radio"
					aria-checked={modo === valor}
					class="rv-segmento"
					class:activo={modo === valor}
					onclick={() => (modo = valor as Modo)}>{etiqueta}</button
				>
			{/each}
		</div>
		{#if modo === 'personalizado'}
			<div class="rv-rango">
				<label>Desde <input type="date" bind:value={desdePersonal} max={hastaPersonal} /></label>
				<label>Hasta <input type="date" bind:value={hastaPersonal} min={desdePersonal} /></label>
				<label
					>Ver por
					<select bind:value={agruparPersonal}>
						<option value="auto">Automático</option>
						<option value="dia">Día</option>
						<option value="semana">Semana</option>
						<option value="mes">Mes</option>
					</select>
				</label>
			</div>
		{:else}
			<p class="rv-ayuda">{modo === 'semanas' ? 'Últimas 12 semanas, de lunes a domingo' : 'Últimos 12 meses'}</p>
		{/if}
	</div>

	{#if !datos && cargando}
		<div class="page-card rv-cargando">Calculando…</div>
	{:else if datos}
		<div class="rv-tiles" class:atenuado={cargando}>
			<div class="page-card rv-tile">
				<span class="rv-tile-etiqueta"><i style="background:{SERIES.anticipos.color}"></i>Anticipos a conductores</span>
				<strong>{moneda(datos.totales.anticipos)}</strong>
				<span class="rv-tile-sub">{datos.totales.cantidad_anticipos} anticipo{datos.totales.cantidad_anticipos === 1 ? '' : 's'}</span>
			</div>
			<div class="page-card rv-tile">
				<span class="rv-tile-etiqueta"><i style="background:{SERIES.gastos_empresa.color}"></i>Gastos de la empresa</span>
				<strong>{moneda(datos.totales.gastos_empresa)}</strong>
				<span class="rv-tile-sub"
					>{datos.totales.cantidad_gastos_empresa} gasto{datos.totales.cantidad_gastos_empresa === 1 ? '' : 's'}{datos.totales.gastos_tercero
						? ` · + ${moneda(datos.totales.gastos_tercero)} a cargo de terceros`
						: ''}</span
				>
			</div>
			<div class="page-card rv-tile">
				<span class="rv-tile-etiqueta"><i style="background:{SERIES.legalizado.color}"></i>Legalizado por conductores</span>
				<strong>{moneda(datos.totales.legalizado)}</strong>
				<span class="rv-tile-sub">facturas reportadas en la app</span>
			</div>
			<div class="page-card rv-tile rv-tile-hoy">
				<span class="rv-tile-etiqueta">En manos de conductores hoy</span>
				<strong>{moneda(datos.totales.en_manos_de_conductores)}</strong>
				<span class="rv-tile-sub">saldo de anticipos sin legalizar</span>
			</div>
		</div>

		<div class="page-card rv-grafica" class:atenuado={cargando}>
			<div class="rv-grafica-cabecera">
				<div>
					<h2>Lo que salió por {datos.rango.agrupar === 'mes' ? 'mes' : datos.rango.agrupar === 'semana' ? 'semana' : 'día'}</h2>
					<p>Total en el periodo: <strong>{moneda(datos.totales.egresos)}</strong> entre anticipos y gastos directos</p>
				</div>
				<button type="button" class="rv-vista" onclick={() => (vistaTabla = !vistaTabla)} aria-pressed={vistaTabla}>
					{#if vistaTabla}<BarChart3 size={15} /> Ver gráfica{:else}<Table2 size={15} /> Ver tabla{/if}
				</button>
			</div>
			{#if sinMovimientos}
				<p class="rv-vacio">No hubo anticipos ni gastos en este periodo.</p>
			{:else if vistaTabla}
				<div class="rv-tabla-wrap">
					<table class="rv-tabla">
						<thead>
							<tr>
								<th>Periodo</th>
								{#each ORDEN as k (k)}<th class="num">{SERIES[k].etiqueta}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each datos.periodos as p (p.clave)}
								<tr>
									<td>{etiquetaPeriodo(p, datos.rango.agrupar)}</td>
									{#each ORDEN as k (k)}<td class="num">{p[k] ? moneda(p[k]) : '—'}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if grafica}
				<div class="rv-lienzo">
					<Bar data={grafica} options={opciones} />
				</div>
			{/if}
		</div>

		<div class="rv-desgloses" class:atenuado={cargando}>
			<div class="page-card rv-lista">
				<h3>Gastos de la empresa por categoría</h3>
				{#each datos.por_categoria as c (c.categoria)}
					<div class="rv-fila">
						<span class="rv-fila-etiqueta">{CATEGORIA_LABELS[c.categoria]}</span>
						<span class="rv-barra"><span class:con-valor={c.valor > 0} style="width:{(c.valor / maxCategoria) * 100}%; background:{SERIES.gastos_empresa.color}"></span></span>
						<span class="rv-fila-valor">{c.valor ? moneda(c.valor) : '—'}</span>
					</div>
				{/each}
			</div>
			<div class="page-card rv-lista">
				<h3>Conductores con más anticipos</h3>
				{#each datos.top_conductores as c (c.id)}
					<div class="rv-fila">
						<span class="rv-fila-etiqueta" title={c.etiqueta}>{c.etiqueta}</span>
						<span class="rv-barra"><span class:con-valor={c.valor > 0} style="width:{(c.valor / maxConductor) * 100}%; background:{SERIES.anticipos.color}"></span></span>
						<span class="rv-fila-valor">{moneda(c.valor)}</span>
					</div>
				{:else}
					<p class="rv-vacio">Sin anticipos en el periodo.</p>
				{/each}
			</div>
			<div class="page-card rv-lista">
				<h3>Placas con más anticipos</h3>
				{#each datos.top_placas as c (c.id)}
					<div class="rv-fila">
						<span class="rv-fila-etiqueta">{c.etiqueta}</span>
						<span class="rv-barra"><span class:con-valor={c.valor > 0} style="width:{(c.valor / maxPlaca) * 100}%; background:{SERIES.anticipos.color}"></span></span>
						<span class="rv-fila-valor">{moneda(c.valor)}</span>
					</div>
				{:else}
					<p class="rv-vacio">Sin anticipos en el periodo.</p>
				{/each}
			</div>
			{#if datos.fondos.length}
				<div class="page-card rv-lista">
					<h3>Saldo para anticipos de operaciones</h3>
					{#each datos.fondos as f (f.usuario_id)}
						<div class="rv-fila rv-fila-fondo">
							<span class="rv-fila-etiqueta">{f.nombre}</span>
							<span class="rv-fila-valor" class:negativo={f.saldo <= 0}>{moneda(f.saldo)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.rv {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.rv-controles {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
	}
	.rv-segmentos {
		display: inline-flex;
		padding: 3px;
		border-radius: 12px;
		background: var(--border-subtle);
	}
	.rv-segmento {
		padding: 0.45rem 0.95rem;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		transition: background-color 160ms ease, color 160ms ease;
	}
	.rv-segmento.activo {
		background: var(--bg-surface);
		color: var(--text-primary);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}
	.rv-rango {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.rv-rango label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
	}
	.rv-rango input,
	.rv-rango select {
		height: 34px;
		padding: 0 0.6rem;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 13px;
	}
	.rv-ayuda {
		font-size: 12px;
		color: var(--text-muted);
	}
	.rv-cargando,
	.rv-vacio {
		color: var(--text-muted);
		font-size: 13px;
	}
	.rv-vacio {
		padding: 0.5rem 0;
	}
	.rv-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 0.75rem;
	}
	.rv-tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 1rem 1.15rem;
	}
	.rv-tile-etiqueta {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.rv-tile-etiqueta i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.rv-tile strong {
		font-size: 1.45rem;
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.rv-tile-sub {
		font-size: 12px;
		color: var(--text-muted);
	}
	.rv-tile-hoy {
		background: var(--color-emerald-50);
	}
	.rv-grafica {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.rv-grafica-cabecera {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.rv-grafica h2 {
		font-size: 15px;
		font-weight: 700;
		color: var(--text-primary);
	}
	.rv-grafica p {
		font-size: 12px;
		color: var(--text-muted);
	}
	.rv-vista {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.rv-lienzo {
		position: relative;
		height: 300px;
	}
	.rv-tabla-wrap {
		overflow-x: auto;
	}
	.rv-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.rv-tabla th,
	.rv-tabla td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
		color: var(--text-primary);
	}
	.rv-tabla th {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rv-tabla .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.rv-desgloses {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 0.75rem;
	}
	.rv-lista {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.rv-lista h3 {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.15rem;
	}
	.rv-fila {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		font-size: 12.5px;
	}
	.rv-fila-fondo {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.rv-fila-etiqueta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.rv-barra {
		height: 8px;
		border-radius: 999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.rv-barra span {
		display: block;
		height: 100%;
		border-radius: 999px;
	}
	/* Un valor positivo pero diminuto se ve igual; un cero no pinta nada. */
	.rv-barra span.con-valor {
		min-width: 3px;
	}
	.rv-fila-valor {
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.rv-fila-valor.negativo {
		color: #b45309;
	}
	.atenuado {
		opacity: 0.55;
		transition: opacity 160ms ease;
	}
	@media (max-width: 640px) {
		.rv-grafica-cabecera {
			flex-direction: column;
		}
		.rv-lienzo {
			height: 240px;
		}
	}
</style>
