<script lang="ts">
	/**
	 * Indicadores básicos de siniestralidad: días sin accidentes, eventos por
	 * mes y tipo, víctimas, costo estimado y el cumplimiento del plazo de 15
	 * días para investigar.
	 *
	 * La tasa por cada 100.000 km NO se pinta: el kilometraje de la flota aún
	 * no es confiable y el servidor devuelve `null` con el motivo, que se
	 * muestra para que nadie la busque y crea que falta por error.
	 *
	 * El gráfico es de barras apiladas hechas con CSS (no hace falta una
	 * librería para doce columnas): colores fijos por tipo, leyenda siempre
	 * visible, total escrito sobre cada barra y la tabla a un clic, porque el
	 * aguamarina del casi-accidente no llega a 3:1 sobre el fondo blanco.
	 */
	import {
		TIPO_LABELS,
		moneda,
		type IndicadoresIncidentes,
		type TipoIncidente
	} from '$lib/api/incidentes';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';

	interface Props {
		datos: IndicadoresIncidentes | null;
		cargando?: boolean;
	}
	let { datos, cargando = false }: Props = $props();

	const TIPOS: TipoIncidente[] = ['ACCIDENTE_TRANSITO', 'INCIDENTE', 'CASI_ACCIDENTE'];
	const maximo = $derived(Math.max(1, ...(datos?.serie.map((p) => p.total) ?? [0])));
	let activo = $state<string | null>(null);

	const nombreMes = (mes: string, largo = false) =>
		new Date(`${mes}-01T00:00:00Z`).toLocaleDateString('es-CO', {
			month: largo ? 'long' : 'short',
			year: largo ? 'numeric' : undefined,
			timeZone: 'UTC'
		});

	const aTiempo = $derived.by(() => {
		const i = datos?.investigacion;
		if (!i || i.cerradas === 0) return null;
		return Math.round((i.cerradas_a_tiempo / i.cerradas) * 100);
	});
</script>

{#if cargando && !datos}
	<CargaMascota texto="Calculando indicadores…" />
{:else if datos}
	<section class="ind" aria-label="Indicadores de siniestralidad">
		<div class="ind-tiles">
			<div class="ind-tile ind-tile--hero">
				<span class="ind-etq">Días sin accidentes de tránsito</span>
				<strong>{datos.dias_sin_accidentes ?? '—'}</strong>
				<small>
					{#if datos.ultimo_accidente}
						Último: {new Date(`${datos.ultimo_accidente}T00:00:00Z`).toLocaleDateString('es-CO', {
							day: 'numeric',
							month: 'long',
							year: 'numeric',
							timeZone: 'UTC'
						})}
					{:else}
						Sin accidentes registrados
					{/if}
				</small>
			</div>
			<div class="ind-tile">
				<span class="ind-etq">Eventos · últimos {datos.meses} meses</span>
				<strong>{datos.totales.eventos}</strong>
				<small
					>{datos.totales.accidentes} accidentes · {datos.totales.incidentes} incidentes · {datos
						.totales.casi_accidentes} casi-accidentes</small
				>
			</div>
			<div class="ind-tile">
				<span class="ind-etq">Lesionados · fallecidos</span>
				<strong>{datos.totales.lesionados} · {datos.totales.fallecidos}</strong>
				<small>Costo estimado {moneda(datos.totales.costo_estimado)}</small>
			</div>
			<div class="ind-tile">
				<span class="ind-etq">Investigaciones</span>
				<strong>{datos.investigacion.abiertas}</strong>
				<small>
					abiertas{#if datos.investigacion.vencidas}
						· <span class="ind-alerta">{datos.investigacion.vencidas} con el plazo vencido</span
						>{/if}
					{#if aTiempo !== null}· {aTiempo} % cerradas en 15 días{/if}
				</small>
			</div>
		</div>

		<div class="ind-grafico">
			<div class="ind-cab">
				<h3>Eventos por mes y tipo</h3>
				<ul class="ind-leyenda">
					{#each TIPOS as t}
						<li>
							<span style="background:{TIPO_LABELS[t].color}" aria-hidden="true"
							></span>{TIPO_LABELS[t].corto}
						</li>
					{/each}
				</ul>
			</div>
			<div class="ind-barras" role="list">
				{#each datos.serie as p (p.mes)}
					<div
						class="ind-col"
						role="listitem"
						aria-label="{nombreMes(
							p.mes,
							true
						)}: {p.ACCIDENTE_TRANSITO} accidentes, {p.INCIDENTE} incidentes, {p.CASI_ACCIDENTE} casi-accidentes"
						onmouseenter={() => (activo = p.mes)}
						onmouseleave={() => (activo = null)}
					>
						<div class="ind-pila" style="height:{(p.total / maximo) * 100}%">
							{#if p.total > 0}<span class="ind-total">{p.total}</span>{/if}
							{#each TIPOS as t}
								{#if p[t] > 0}
									<span class="ind-seg" style="flex:{p[t]};background:{TIPO_LABELS[t].color}"
									></span>
								{/if}
							{/each}
						</div>
						<span class="ind-mes">{nombreMes(p.mes)}</span>
						{#if activo === p.mes}
							<div class="ind-tip" role="tooltip">
								<strong>{nombreMes(p.mes, true)}</strong>
								{#each TIPOS as t}
									<span
										><i style="background:{TIPO_LABELS[t].color}"></i>{TIPO_LABELS[t].corto}: {p[
											t
										]}</span
									>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<details class="ind-tabla">
				<summary>Ver como tabla</summary>
				<table>
					<thead>
						<tr>
							<th>Mes</th>
							{#each TIPOS as t}<th>{TIPO_LABELS[t].corto}</th>{/each}
							<th>Total</th>
						</tr>
					</thead>
					<tbody>
						{#each datos.serie as p (p.mes)}
							<tr>
								<td>{nombreMes(p.mes, true)}</td>
								{#each TIPOS as t}<td>{p[t]}</td>{/each}
								<td><strong>{p.total}</strong></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</details>
			<p class="ind-nota">
				Accidentes por cada 100.000 km: sin dato. {datos.motivo_sin_km}
			</p>
		</div>
	</section>
{/if}

<style>
	.ind {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.ind-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
	}
	.ind-tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: var(--shadow-card);
	}
	.ind-tile strong {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		line-height: 1.2;
	}
	.ind-tile--hero strong {
		font-size: 2.2rem;
	}
	.ind-tile small {
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.ind-etq {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ind-alerta {
		color: #b42318;
		font-weight: 700;
	}
	.ind-grafico {
		padding: 1rem 1.1rem 0.8rem;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: var(--shadow-card);
	}
	.ind-cab {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	.ind-cab h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.ind-leyenda {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
	.ind-leyenda li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.ind-leyenda span {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.ind-barras {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		align-items: end;
		gap: 6px;
		height: 150px;
		padding-top: 18px;
		border-bottom: 1px solid var(--border-default);
	}
	.ind-col {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		height: 100%;
	}
	.ind-pila {
		position: relative;
		display: flex;
		flex-direction: column-reverse;
		gap: 2px;
		width: min(28px, 70%);
		min-height: 0;
	}
	.ind-seg {
		min-height: 3px;
	}
	.ind-pila .ind-seg:last-child {
		border-radius: 4px 4px 0 0;
	}
	.ind-total {
		position: absolute;
		top: -17px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ind-mes {
		position: absolute;
		bottom: -20px;
		font-size: 0.7rem;
		color: var(--text-muted);
		text-transform: capitalize;
		white-space: nowrap;
	}
	.ind-tip {
		position: absolute;
		bottom: calc(100% + 4px);
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 9rem;
		padding: 8px 10px;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		box-shadow: var(--shadow-card-hover);
		font-size: 0.75rem;
		color: var(--text-secondary);
		pointer-events: none;
	}
	.ind-tip strong {
		color: var(--text-primary);
		text-transform: capitalize;
	}
	.ind-tip i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 2px;
	}
	.ind-tabla {
		margin-top: 1.75rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.ind-tabla summary {
		cursor: pointer;
		color: var(--text-muted);
	}
	.ind-tabla table {
		width: 100%;
		margin-top: 0.5rem;
		border-collapse: collapse;
	}
	.ind-tabla th,
	.ind-tabla td {
		padding: 4px 8px;
		border-bottom: 1px solid var(--border-subtle);
		text-align: right;
	}
	.ind-tabla th:first-child,
	.ind-tabla td:first-child {
		text-align: left;
		text-transform: capitalize;
	}
	.ind-nota {
		margin: 0.6rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
</style>
