<script lang="ts">
	/**
	 * Sección «Facturación»: liquidaciones aprobadas pendientes de facturar,
	 * facturado del periodo y mes a mes, ranking completo de clientes, y lo de
	 * terceros (mes a mes, previstas para pagar, ranking de terceros y placas).
	 */
	import { FileCheck2, Receipt, Wallet } from 'lucide-svelte';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import BloqueTerceros from './BloqueTerceros.svelte';
	import { numero, pesos, pesosCortos, fechaCorta } from '$lib/dashboard/formato';
	import { mesCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();
	const k = $derived(datos.kpis);
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Por facturar"
		valor={numero(k.por_facturar)}
		detalle={`${pesosCortos(k.por_facturar_valor)} en liquidaciones aprobadas sin factura`}
		tono={k.por_facturar ? 'ambar' : 'verde'}
		icono={FileCheck2}
		href="/dashboard/liquidaciones-servicios?estado=APROBADA"
	/>
	<Kpi
		etiqueta="Por aprobar"
		valor={numero(k.por_aprobar)}
		detalle={`${pesosCortos(k.por_aprobar_valor)} liquidadas, esperando aprobación`}
		icono={FileCheck2}
		href="/dashboard/liquidaciones-servicios?estado=LIQUIDADA"
	/>
	<Kpi
		etiqueta="Facturado en el periodo"
		valor={pesosCortos(k.facturado)}
		detalle={`${numero(k.facturas)} facturas${k.facturas_anuladas ? ` · ${numero(k.facturas_anuladas)} anuladas` : ''}`}
		tono="verde"
		icono={Receipt}
		href="/dashboard/liquidaciones-servicios?estado=FACTURADA"
	/>
	{#if datos.previstas_pagar}
		<Kpi
			etiqueta="Terceros previstos para pagar"
			valor={pesosCortos(datos.previstas_pagar.valor)}
			detalle={`${numero(datos.previstas_pagar.total)} cierres aprobados sin marcar como pagados`}
			tono={datos.previstas_pagar.total ? 'ambar' : 'verde'}
			icono={Wallet}
			href="/dashboard/liquidaciones-terceros"
		/>
	{/if}
</div>

<div class="sec-rejilla">
	<Tarjeta
		titulo="Pendientes de facturar"
		subtitulo="Liquidaciones de servicios aprobadas: falta facturar y relacionar la factura"
		columnas={5}
		tono={datos.por_facturar.length ? 'alerta' : 'normal'}
		enlace="/dashboard/liquidaciones-servicios?estado=APROBADA"
	>
		{#if datos.por_facturar.length === 0}
			<p class="sec-ok">No hay liquidaciones aprobadas sin facturar.</p>
		{:else}
			<ul class="sec-lista">
				{#each datos.por_facturar.slice(0, 12) as l (l.id)}
					<li>
						<a href={l.enlace}>
							<span class="sec-lista-titulo">{l.consecutivo} · {l.cliente ?? 'Sin cliente'}</span>
							<span class="sec-lista-sub"
								>{mesCorto(l.anio, l.mes)}{l.fecha_aprobacion
									? ` · aprobada el ${fechaCorta(l.fecha_aprobacion)}`
									: ''}</span
							>
						</a>
						<span class="sec-valor">{pesos(l.total)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Facturado mes a mes"
		subtitulo="Por fecha de facturación, sin anuladas"
		columnas={7}
		enlace="/dashboard/liquidaciones-servicios?estado=FACTURADA"
	>
		<Grafica
			etiquetas={datos.facturado_mes_a_mes.map((m: any) => mesCorto(m.anio, m.mes))}
			series={[
				{ etiqueta: 'Facturado', datos: datos.facturado_mes_a_mes.map((m: any) => m.valor) }
			]}
			formato="pesos"
			leyenda={false}
			alto={220}
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Facturado por cliente"
		subtitulo="Todos los clientes facturados en el periodo, de mayor a menor"
		columnas={datos.ranking_terceros ? 4 : 12}
		enlace="/dashboard/clientes"
	>
		<div class="sec-scroll">
			<Ranking
				items={datos.ranking_clientes.map((c: any) => ({
					etiqueta: c.cliente,
					valor: c.valor,
					secundario: `${c.facturas} fact.${c.nit ? ` · ${c.nit}` : ''}`,
					href: c.enlace
				}))}
				formato="pesos"
				vacio="Sin facturas en el periodo"
			/>
		</div>
	</Tarjeta>

	{#if datos.ranking_terceros}
		<BloqueTerceros {datos} />
	{/if}
</div>

<style>
	.sec-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}
	.sec-rejilla {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 0.85rem;
	}
	.sec-ok {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--au-dark);
	}
	.sec-scroll {
		max-height: 420px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.sec-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.sec-lista li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0;
		border-top: 1px dashed var(--border-subtle);
		min-width: 0;
	}
	.sec-lista li:first-child {
		border-top: 0;
	}
	.sec-lista a {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		text-decoration: none;
		color: inherit;
	}
	.sec-lista a:hover .sec-lista-titulo {
		color: var(--au-primary-strong);
	}
	.sec-lista-titulo {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sec-lista-sub {
		font-size: 0.7rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sec-valor {
		flex-shrink: 0;
		font-size: 0.76rem;
		font-weight: 800;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
