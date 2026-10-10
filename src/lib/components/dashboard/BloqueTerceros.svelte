<script lang="ts">
	/**
	 * Tarjetas de liquidaciones de terceros que comparten Facturación y
	 * Contabilidad: mes a mes, previstas para pagar (con el enlace al canvas
	 * del mes que resalta el botón de estado), ranking completo de terceros y
	 * de placas. Van dentro de la rejilla de 12 columnas de la sección.
	 */
	import Tarjeta from './Tarjeta.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import { numero, pesos, pesosCortos } from '$lib/dashboard/formato';
	import { mesCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();
</script>

<Tarjeta
	titulo="Liquidaciones de terceros mes a mes"
	subtitulo="Cierres finales por mes y estado (sin anuladas)"
	columnas={8}
	enlace="/dashboard/liquidaciones-terceros"
>
	<Grafica
		etiquetas={datos.terceros_mes_a_mes.map((m: any) => mesCorto(m.anio, m.mes))}
		series={[
			{
				etiqueta: 'Pagadas',
				datos: datos.terceros_mes_a_mes.map((m: any) => m.pagada)
			},
			{
				etiqueta: 'Aprobadas (por pagar)',
				datos: datos.terceros_mes_a_mes.map((m: any) => m.aprobada),
				color: '#f59e0b'
			},
			{
				etiqueta: 'Borrador',
				datos: datos.terceros_mes_a_mes.map((m: any) => m.borrador),
				color: '#94a3b8'
			}
		]}
		formato="pesos"
		apilado
		alto={230}
	/>
</Tarjeta>

<Tarjeta
	titulo="Previstas para pagar"
	subtitulo="Cierres aprobados que aún no están marcados como pagados"
	columnas={4}
	tono={datos.previstas_pagar.total ? 'alerta' : 'normal'}
	enlace="/dashboard/liquidaciones-terceros"
>
	{#if datos.previstas_pagar.por_mes.length === 0}
		<p class="bt-ok">Todo lo aprobado ya está marcado como facturado.</p>
	{:else}
		<ul class="bt-lista">
			{#each datos.previstas_pagar.por_mes as m (`${m.anio}-${m.mes}`)}
				<li>
					<div class="bt-mes">
						<span class="bt-mes-etq">{mesCorto(m.anio, m.mes)}</span>
						<span class="bt-mes-sub"
							>{numero(m.n)}
							{m.n === 1 ? 'cierre aprobado' : 'cierres aprobados'} · {pesos(m.valor)}</span
						>
					</div>
					<a
						class="bt-accion"
						href={m.enlace}
						title="Abre el canvas de ese mes y resalta el botón de estado">Marcar pagadas</a
					>
				</li>
			{/each}
		</ul>
		<p class="bt-nota">
			Si ya se pagaron, entra al mes y cámbiales el estado: el botón queda resaltado al llegar.
		</p>
	{/if}
</Tarjeta>

<Tarjeta
	titulo="Pagado por tercero"
	subtitulo="Todos los terceros del periodo, de mayor a menor"
	columnas={6}
	enlace="/dashboard/terceros"
>
	<div class="bt-scroll">
		<Ranking
			items={datos.ranking_terceros.map((t: any) => ({
				etiqueta: t.tercero,
				valor: t.valor,
				secundario: `${t.n} ${t.n === 1 ? 'cierre' : 'cierres'}${t.identificacion ? ` · ${t.identificacion}` : ''}`,
				href: t.enlace
			}))}
			formato="pesos"
			vacio="Sin cierres de terceros en el periodo"
		/>
	</div>
</Tarjeta>

<Tarjeta
	titulo="Pagado por placa"
	subtitulo="Todas las placas del periodo, de mayor a menor"
	columnas={6}
	enlace="/dashboard/flota"
>
	<div class="bt-scroll">
		<Ranking
			items={datos.ranking_placas.map((p: any) => ({
				etiqueta: p.placa,
				valor: p.valor,
				secundario: p.tercero ?? '',
				href: p.enlace
			}))}
			formato="pesos"
			vacio="Sin cierres de terceros en el periodo"
		/>
	</div>
</Tarjeta>

<style>
	.bt-ok {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--au-dark);
	}
	.bt-scroll {
		max-height: 420px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.bt-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.bt-lista li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-top: 1px dashed var(--border-subtle);
	}
	.bt-lista li:first-child {
		border-top: 0;
	}
	.bt-mes {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bt-mes-etq {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text-primary);
		text-transform: capitalize;
	}
	.bt-mes-sub {
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.bt-accion {
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 800;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		background: var(--au-dark);
		color: #fff;
		text-decoration: none;
		white-space: nowrap;
	}
	.bt-accion:hover {
		background: var(--au-dark-2);
	}
	.bt-nota {
		margin: 0.6rem 0 0;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
</style>
