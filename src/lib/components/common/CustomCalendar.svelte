<script lang="ts">
	/**
	 * Cuadrícula mensual de servicios.
	 *
	 * La semana empieza el lunes (como en Colombia) y los días de los meses
	 * vecinos se pintan atenuados en vez de quedar como huecos. Cada servicio
	 * es una tira con el filo del color de su estado, su hora y «placa ·
	 * conductor». Más de tres en un día se resumen en «+N más», que abre el
	 * panel del día.
	 *
	 * Si el contenedor es angosto (teléfono, barra lateral abierta en una
	 * pantalla pequeña) la cuadrícula no cabe: se cambia por una agenda con
	 * solo los días que tienen servicios.
	 */
	import type { FestivoColombiano } from '$lib/utils/festivosColombia';
	import { getEstadoColor, getEstadoText, type ServicioConRelaciones } from '$lib/types/servicios';

	type Props = {
		mes: number;
		anio: number;
		eventosPorDia: Map<string, ServicioConRelaciones[]>;
		festivos: FestivoColombiano[];
		/** Campo con el que se ubicó cada servicio: de ahí sale su hora. */
		campoFecha: 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion';
		diaSeleccionado?: string | null;
		onEventClick: (servicio: ServicioConRelaciones) => void;
		onDayClick?: (clave: string) => void;
	};

	let {
		mes,
		anio,
		eventosPorDia,
		festivos,
		campoFecha,
		diaSeleccionado = null,
		onEventClick,
		onDayClick
	}: Props = $props();

	const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
	const VISIBLES = 3;

	function clave(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/** Semanas completas de lunes a domingo que cubren el mes. */
	const celdas = $derived.by(() => {
		const primero = new Date(anio, mes, 1);
		const desfase = (primero.getDay() + 6) % 7; // lunes = 0
		const dias = new Date(anio, mes + 1, 0).getDate();
		const total = Math.ceil((desfase + dias) / 7) * 7;
		return Array.from({ length: total }, (_, i) => {
			const fecha = new Date(anio, mes, 1 - desfase + i);
			return { fecha, clave: clave(fecha), delMes: fecha.getMonth() === mes };
		});
	});

	const hoy = clave(new Date());
	const festivoDe = $derived(new Map(festivos.map((f) => [f.fechaCompleta, f.nombre])));

	/** Días del mes con servicios, en orden, para la agenda. */
	const diasConServicios = $derived(
		celdas.filter((c) => c.delMes && (eventosPorDia.get(c.clave)?.length ?? 0) > 0)
	);

	function hora(s: ServicioConRelaciones): string | null {
		const raw = s[campoFecha] || s.fecha_solicitud;
		if (!raw) return null;
		const d = new Date(raw);
		if (Number.isNaN(d.getTime())) return null;
		return new Intl.DateTimeFormat('es-CO', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(d);
	}

	function resumen(s: ServicioConRelaciones): string {
		const partes = [s.vehiculo?.placa, s.conductor?.nombre?.split(' ')[0]].filter(Boolean);
		return partes.length ? partes.join(' · ') : (s.cliente?.nombre ?? 'Sin asignar');
	}

	function ruta(s: ServicioConRelaciones): string {
		const o = s.origen_especifico || s.origen?.nombre_municipio || '—';
		const d = s.destino_especifico || s.destino?.nombre_municipio || '—';
		return `${o} → ${d}`;
	}

	function diaLargo(fecha: Date): string {
		return new Intl.DateTimeFormat('es-CO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(fecha);
	}
</script>

{#snippet tira(s: ServicioConRelaciones)}
	{@const h = hora(s)}
	<button
		type="button"
		class="cc-tira"
		style="--c: {getEstadoColor(s.estado)}"
		class:cc-tira--apagada={s.estado === 'cancelado'}
		title="{getEstadoText(s.estado)} · {ruta(s)}"
		onclick={(e) => {
			e.stopPropagation();
			onEventClick(s);
		}}
	>
		{#if h}<span class="cc-hora">{h}</span>{/if}
		<span class="cc-resumen">{resumen(s)}</span>
	</button>
{/snippet}

<div class="cc">
	<!-- ═══ Cuadrícula ═══ -->
	<div class="cc-mes" role="grid" aria-label="Servicios del mes">
		<div class="cc-semana cc-cabeza" role="row">
			{#each DIAS_SEMANA as d, i (d)}
				<div class="cc-dia-nombre" class:cc-finde={i >= 5} role="columnheader">{d}</div>
			{/each}
		</div>
		<div class="cc-cuerpo">
			{#each celdas as c, i (c.clave)}
				{@const eventos = eventosPorDia.get(c.clave) ?? []}
				{@const festivo = festivoDe.get(c.clave)}
				<div
					class="cc-celda"
					class:cc-celda--fuera={!c.delMes}
					class:cc-finde={i % 7 >= 5}
					class:cc-celda--hoy={c.clave === hoy}
					class:cc-celda--elegida={diaSeleccionado === c.clave}
					role="gridcell"
					tabindex={c.delMes ? 0 : -1}
					aria-label="{diaLargo(c.fecha)}: {eventos.length} servicios"
					onclick={() => c.delMes && onDayClick?.(c.clave)}
					onkeydown={(e) => {
						if (c.delMes && (e.key === 'Enter' || e.key === ' ')) {
							e.preventDefault();
							onDayClick?.(c.clave);
						}
					}}
				>
					<div class="cc-celda-cabeza">
						<span class="cc-numero" class:cc-numero--festivo={!!festivo}>{c.fecha.getDate()}</span>
						{#if festivo && c.delMes}
							<span class="cc-festivo" title={festivo}>{festivo}</span>
						{:else if eventos.length > 0 && c.delMes}
							<span class="cc-cuenta">{eventos.length}</span>
						{/if}
					</div>
					{#if c.delMes}
						<div class="cc-tiras">
							{#each eventos.slice(0, VISIBLES) as s (s.id)}
								{@render tira(s)}
							{/each}
							{#if eventos.length > VISIBLES}
								<button
									type="button"
									class="cc-mas"
									onclick={(e) => {
										e.stopPropagation();
										onDayClick?.(c.clave);
									}}
								>
									+{eventos.length - VISIBLES} más
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- ═══ Agenda (contenedor angosto) ═══ -->
	<div class="cc-agenda">
		{#if diasConServicios.length === 0}
			<p class="cc-agenda-vacia">No hay servicios este mes.</p>
		{:else}
			{#each diasConServicios as c (c.clave)}
				{@const festivo = festivoDe.get(c.clave)}
				<section class="cc-agenda-dia" class:cc-celda--hoy={c.clave === hoy}>
					<h3>
						<span class="cc-numero">{c.fecha.getDate()}</span>
						<span class="cc-agenda-fecha">{diaLargo(c.fecha)}</span>
						{#if festivo}<span class="cc-festivo">{festivo}</span>{/if}
					</h3>
					<div class="cc-agenda-lista">
						{#each eventosPorDia.get(c.clave) ?? [] as s (s.id)}
							<button
								type="button"
								class="cc-agenda-item"
								style="--c: {getEstadoColor(s.estado)}"
								onclick={() => onEventClick(s)}
							>
								<span class="cc-hora">{hora(s) ?? '—'}</span>
								<span class="cc-agenda-texto">
									<strong>{ruta(s)}</strong>
									<small>{getEstadoText(s.estado)} · {resumen(s)}</small>
								</span>
							</button>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</div>
</div>

<style>
	.cc {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}

	/* ── Cuadrícula ── */
	.cc-mes {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	.cc-semana,
	.cc-cuerpo {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.cc-cabeza {
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-base);
	}
	.cc-dia-nombre {
		padding: 0.6rem 0.75rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.cc-dia-nombre.cc-finde {
		color: var(--text-very-muted);
	}
	.cc-cuerpo {
		flex: 1;
		grid-auto-rows: minmax(7.25rem, 1fr);
	}
	.cc-celda {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding: 6px 6px 8px;
		border-right: 1px solid var(--border-subtle);
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
		outline: none;
		transition: background-color 0.15s;
	}
	.cc-celda:nth-child(7n) {
		border-right: 0;
	}
	.cc-celda.cc-finde {
		background: color-mix(in srgb, var(--bg-base) 55%, transparent);
	}
	.cc-celda:hover,
	.cc-celda:focus-visible {
		background: color-mix(in srgb, var(--accion) 5%, transparent);
	}
	.cc-celda--fuera {
		cursor: default;
		background: transparent !important;
	}
	.cc-celda--fuera .cc-numero {
		color: var(--text-very-muted);
		opacity: 0.55;
	}
	.cc-celda--elegida {
		background: color-mix(in srgb, var(--accion) 8%, transparent) !important;
		box-shadow: inset 0 0 0 2px var(--accion);
	}
	.cc-celda-cabeza {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		min-height: 24px;
	}
	.cc-numero {
		display: inline-grid;
		place-items: center;
		min-width: 24px;
		height: 24px;
		padding: 0 4px;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.cc-numero--festivo {
		color: #dc2626;
	}
	.cc-celda--hoy .cc-numero {
		background: var(--accion);
		color: #fff;
	}
	.cc-festivo {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 6px;
		border-radius: 999px;
		background: #fef2f2;
		font-size: 0.62rem;
		font-weight: 700;
		color: #b91c1c;
	}
	.cc-cuenta {
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--text-very-muted);
		font-variant-numeric: tabular-nums;
	}
	.cc-tiras {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.cc-tira {
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		padding: 3px 6px;
		border: 0;
		border-left: 3px solid var(--c);
		border-radius: 6px;
		background: color-mix(in srgb, var(--c) 11%, var(--bg-surface));
		font: inherit;
		font-size: 0.7rem;
		text-align: left;
		color: var(--text-primary);
		cursor: pointer;
		transition:
			background-color 0.15s,
			transform 0.15s;
	}
	.cc-tira:hover {
		background: color-mix(in srgb, var(--c) 20%, var(--bg-surface));
	}
	.cc-tira:focus-visible {
		outline: 2px solid var(--c);
		outline-offset: 1px;
	}
	.cc-tira--apagada {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.cc-hora {
		flex-shrink: 0;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.cc-resumen {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.cc-mas {
		align-self: flex-start;
		padding: 1px 6px;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
	}
	.cc-mas:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}

	/* ── Agenda ── */
	.cc-agenda {
		display: none;
		flex-direction: column;
	}
	@container (max-width: 760px) {
		.cc-mes {
			display: none;
		}
		.cc-agenda {
			display: flex;
		}
	}
	.cc-agenda-vacia {
		margin: 0;
		padding: 2.5rem 1rem;
		text-align: center;
		font-size: 0.86rem;
		color: var(--text-muted);
	}
	.cc-agenda-dia {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.cc-agenda-dia h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
	}
	.cc-agenda-fecha {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.cc-agenda-fecha::first-letter {
		text-transform: uppercase;
	}
	.cc-agenda-lista {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cc-agenda-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid var(--border-subtle);
		border-left: 3px solid var(--c);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.cc-agenda-item:hover {
		background: color-mix(in srgb, var(--c) 7%, var(--bg-surface));
	}
	.cc-agenda-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.cc-agenda-texto strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.cc-agenda-texto small {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
</style>
