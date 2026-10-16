<script lang="ts">
	import { resolve } from '$app/paths';
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
	import PanelSugerencias from './PanelSugerencias.svelte';
	import { numero, pesos, pesosCortos, fechaCorta } from '$lib/dashboard/formato';
	import { mesCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: unknown;
	}
	interface FuenteFinanciera {
		id: string;
		etiqueta: string;
		valor: number | null;
		cantidad: number | null;
		incluida_en_margen: boolean;
	}
	interface DatosFacturacion {
		kpis: {
			por_facturar: number;
			por_facturar_valor: number;
			por_aprobar: number;
			por_aprobar_valor: number;
			facturado: number;
			facturas: number;
			facturas_anuladas: number;
		};
		finanzas: {
			ingresos: {
				liquidado: number;
				liquidaciones: number;
				facturado: number;
				cartera: { saldo_vencido: number; vencidas: number } | null;
			};
			costos: { identificados: number; fuentes: FuenteFinanciera[] };
			margen: { valor: number; porcentaje: number | null; parcial: boolean };
		};
		previstas_pagar?: { total: number; valor: number };
		por_facturar: Array<{
			id: string;
			enlace: string;
			consecutivo: string;
			cliente: string | null;
			mes: number;
			anio: number;
			fecha_aprobacion: string | null;
			total: number;
		}>;
		facturado_mes_a_mes: Array<{ anio: number; mes: number; valor: number }>;
		ranking_clientes: Array<{
			cliente: string;
			valor: number;
			facturas: number;
			nit: string | null;
			enlace: string;
		}>;
		ranking_terceros?: unknown;
	}
	let { datos: datosCrudos }: Props = $props();
	const datos = $derived(datosCrudos as DatosFacturacion);
	const resolverRuta = resolve as unknown as (enlace: string) => string;
	const k = $derived(datos.kpis);
	const fin = $derived(datos.finanzas);
	const fuente = (id: string) =>
		(fin.costos.fuentes as FuenteFinanciera[]).find((x) => x.id === id);
	const sugerencias = $derived.by(() => {
		const items: Array<{
			id: string;
			prioridad: 'critica' | 'alta' | 'oportunidad' | 'info';
			titulo: string;
			evidencia: string;
			accion: string;
			enlace?: string;
		}> = [];
		const ingresos = Number(fin.ingresos.liquidado ?? 0);
		const margen = fin.margen.porcentaje;
		if (ingresos > 0 && fin.margen.valor < 0)
			items.push({
				id: 'margen-negativo',
				prioridad: 'critica' as const,
				titulo: `Los costos identificados superan los ingresos en ${pesosCortos(Math.abs(fin.margen.valor))}`,
				evidencia: `El margen estimado está en ${Math.round(margen ?? 0)}%${fin.margen.parcial ? ' y todavía faltan fuentes de costo' : ''}.`,
				accion:
					'Revisa tarifas por recorrido, pagos a terceros y los gastos de mayor peso antes de aceptar nuevos servicios similares.',
				enlace: '/dashboard/liquidaciones-servicios'
			});
		else if (ingresos > 0 && margen !== null && margen < 12)
			items.push({
				id: 'margen-bajo',
				prioridad: 'alta' as const,
				titulo: `El margen estimado es estrecho: ${Math.round(margen)}%`,
				evidencia: `${pesosCortos(fin.margen.valor)} quedan luego de restar ${pesosCortos(fin.costos.identificados)} en costos registrados.`,
				accion:
					'Prioriza la revisión de trayectos con mayor pago a terceros y renegocia tarifas que no cubran los costos asociados.',
				enlace: '/dashboard/liquidaciones-servicios'
			});

		const vencida = fin.ingresos.cartera;
		if (vencida && vencida.saldo_vencido > 0)
			items.push({
				id: 'cartera-vencida',
				prioridad: 'critica' as const,
				titulo: `${pesosCortos(vencida.saldo_vencido)} de cartera ya están vencidos`,
				evidencia: `${numero(vencida.vencidas)} facturas del periodo aún tienen saldo después de abonos y retenciones.`,
				accion:
					'Contacta a los clientes con mayor saldo vencido y registra el seguimiento de cobro.',
				enlace: '/dashboard/cartera'
			});

		if (k.por_facturar > 0)
			items.push({
				id: 'por-facturar',
				prioridad: 'alta' as const,
				titulo: `${numero(k.por_facturar)} liquidaciones aprobadas siguen sin factura`,
				evidencia: `${pesosCortos(k.por_facturar_valor)} están listas para facturarse, pero aún no aparecen en cartera.`,
				accion: 'Relaciona cada factura para habilitar el cobro y el control de vencimientos.',
				enlace: '/dashboard/liquidaciones-servicios?estado=APROBADA'
			});

		const profesional = Number(fuente('profesionales')?.valor ?? 0);
		if (ingresos > 0 && profesional > 0 && profesional / ingresos >= 0.08)
			items.push({
				id: 'costo-profesional',
				prioridad: 'oportunidad' as const,
				titulo: `Servicios profesionales: ${pesosCortos(profesional)} (${Math.round((profesional / ingresos) * 100)}% de los ingresos liquidados)`,
				evidencia:
					'Este valor suma los gastos de empresa clasificados como servicios profesionales.',
				accion:
					'Revisa beneficiarios, recurrencia y alcance para separar honorarios recurrentes de trabajos puntuales.',
				enlace: '/dashboard/viaticos'
			});
		const viaticos = Number(fuente('viaticos')?.valor ?? 0);
		if (ingresos > 0 && viaticos > 0 && viaticos / ingresos >= 0.1)
			items.push({
				id: 'viaticos-altos',
				prioridad: viaticos / ingresos >= 0.2 ? ('alta' as const) : ('oportunidad' as const),
				titulo: `Viáticos legalizados: ${pesosCortos(viaticos)} (${Math.round((viaticos / ingresos) * 100)}% de los ingresos liquidados)`,
				evidencia:
					'El porcentaje compara gastos legalizados por conductores con el valor de liquidaciones de servicio del periodo.',
				accion:
					'Compara gastos por conductor y servicio; valida que cada legalización tenga soporte y corresponda al recorrido.',
				enlace: '/dashboard/viaticos'
			});

		const pendientes = datos.previstas_pagar;
		if (pendientes && pendientes.total > 0)
			items.push({
				id: 'terceros-por-pagar',
				prioridad: 'alta' as const,
				titulo: `${pesosCortos(pendientes.valor)} están aprobados y esperan pago a terceros`,
				evidencia: `${numero(pendientes.total)} cierres todavía no tienen estado de pagados.`,
				accion: 'Programa los pagos y concilia el soporte para anticipar necesidades de caja.',
				enlace: '/dashboard/liquidaciones-terceros'
			});

		const faltan = fin.costos.fuentes
			.filter((f) => f.valor === null)
			.map((f) => f.etiqueta.toLowerCase());
		if (fin.margen.parcial && faltan.length)
			items.push({
				id: 'cobertura-costos',
				prioridad: 'info' as const,
				titulo: 'El margen mostrado es parcial',
				evidencia: `No se pueden consultar estas fuentes: ${faltan.join(', ')}.`,
				accion:
					'Incluye los módulos faltantes en el análisis antes de usar el margen como resultado final.'
			});

		return items.slice(0, 5);
	});
</script>

<PanelSugerencias
	titulo="Decisiones sugeridas para Finanzas"
	bajada="Alertas y oportunidades calculadas con facturación, costos registrados y cartera del periodo."
	items={sugerencias}
/>

<section class="fin-resumen page-card" aria-label="Rentabilidad operativa estimada">
	<header class="fin-resumen-cabecera">
		<div>
			<p class="fin-eyebrow">ANÁLISIS DE RENTABILIDAD</p>
			<h2>Utilidad estimada y margen</h2>
			<p>Margen operativo estimado a partir de las fuentes disponibles en tu usuario.</p>
		</div>
		<span class="fin-cobertura" class:fin-parcial={fin.margen.parcial}
			>{fin.margen.parcial ? 'Cobertura parcial' : 'Acceso a todas las fuentes'}</span
		>
	</header>
	<div class="fin-kpis">
		<div class="fin-kpi">
			<span>Ingresos liquidados</span>
			<strong>{pesosCortos(fin.ingresos.liquidado)}</strong>
			<small>{numero(fin.ingresos.liquidaciones)} liquidaciones no anuladas</small>
		</div>
		<div class="fin-kpi">
			<span>Costos identificados</span>
			<strong>{pesosCortos(fin.costos.identificados)}</strong>
			<small>Nómina, terceros, viáticos y gastos operativos disponibles</small>
		</div>
		<div class="fin-kpi" class:fin-kpi--negativo={fin.margen.valor < 0}>
			<span>{fin.margen.parcial ? 'Utilidad parcial estimada' : 'Utilidad estimada'}</span>
			<strong>{pesosCortos(fin.margen.valor)}</strong>
			<small
				>{fin.margen.porcentaje === null
					? 'Sin ingresos liquidados para calcular el porcentaje'
					: `${Math.round(fin.margen.porcentaje)}% de los ingresos liquidados`}</small
			>
		</div>
		<div class="fin-kpi">
			<span>Facturado en el periodo</span>
			<strong>{pesosCortos(fin.ingresos.facturado)}</strong>
			<small>{numero(k.facturas)} facturas vigentes registradas</small>
		</div>
	</div>
	<div class="fin-costos">
		<div class="fin-costos-titulo">
			<strong>Composición de costos registrados</strong><a href={resolve('/dashboard/viaticos')}
				>Ver gastos y viáticos ↗</a
			>
		</div>
		<div class="fin-fuentes">
			{#each fin.costos.fuentes as f (f.id)}
				<div class="fin-fuente" class:fin-fuente--excluida={!f.incluida_en_margen}>
					<span>{f.etiqueta}</span>
					<strong>{f.valor === null ? 'Sin acceso' : pesosCortos(f.valor)}</strong>
					{#if f.valor !== null && f.cantidad !== null}<small
							>{numero(f.cantidad)} registros{f.incluida_en_margen
								? ''
								: ' · fuera del margen para evitar doble conteo'}</small
						>{/if}
				</div>
			{/each}
		</div>
	</div>
	<p class="fin-nota">
		Las liquidaciones de servicio y de terceros se asignan por mes de servicio; nómina, facturas y
		egresos usan las fechas de sus registros. La nómina refleja el neto liquidado. Se excluyen del
		margen pagos directos a conductores y gastos de mantenimiento que podrían duplicarse con nómina
		u órdenes. Los costos de terceros, combustible y mantenimiento pueden cruzarse si también se
		incluyeron en un cierre. El resultado no incluye gastos fijos o impuestos no registrados.
	</p>
</section>

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
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- URL de backend normalizada por resolverRuta. -->
						<a href={resolverRuta(l.enlace)}>
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
			etiquetas={datos.facturado_mes_a_mes.map((m) => mesCorto(m.anio, m.mes))}
			series={[{ etiqueta: 'Facturado', datos: datos.facturado_mes_a_mes.map((m) => m.valor) }]}
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
				items={datos.ranking_clientes.map((c) => ({
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
	.fin-resumen {
		margin: 0.85rem 0;
		padding: 0;
		overflow: hidden;
	}
	.fin-resumen-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.15rem 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.fin-eyebrow {
		margin: 0 0 0.25rem;
		color: var(--au-primary-strong);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.fin-resumen-cabecera h2 {
		margin: 0;
		color: var(--text-primary);
		font-size: 1rem;
		font-weight: 750;
	}
	.fin-resumen-cabecera p:last-child {
		margin: 0.2rem 0 0;
		color: var(--text-muted);
		font-size: 0.73rem;
	}
	.fin-cobertura {
		flex: none;
		padding: 0.28rem 0.6rem;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		color: var(--au-primary-strong);
		background: rgba(var(--au-primary-rgb), 0.07);
		font-size: 0.65rem;
		font-weight: 750;
	}
	.fin-cobertura.fin-parcial {
		color: #9a6700;
		background: #fffbeb;
		border-color: #fde68a;
	}
	.fin-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
	}
	.fin-kpi {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.24rem;
		padding: 0.9rem 1rem;
		border-right: 1px solid var(--border-subtle);
		border-bottom: 1px solid var(--border-subtle);
	}
	.fin-kpi:last-child {
		border-right: 0;
	}
	.fin-kpi span {
		color: var(--text-muted);
		font-size: 0.67rem;
		font-weight: 700;
	}
	.fin-kpi strong {
		color: var(--text-primary);
		font-size: clamp(1.05rem, 1.5vw, 1.35rem);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.fin-kpi small {
		color: var(--text-muted);
		font-size: 0.66rem;
		line-height: 1.35;
	}
	.fin-kpi--negativo strong {
		color: #b91c1c;
	}
	.fin-costos {
		padding: 0.8rem 1.15rem 0.5rem;
	}
	.fin-costos-titulo {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--text-primary);
		font-size: 0.76rem;
	}
	.fin-costos-titulo a {
		color: var(--au-primary-strong);
		font-size: 0.68rem;
		font-weight: 700;
		text-decoration: none;
	}
	.fin-fuentes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
		gap: 0.5rem;
		margin-top: 0.65rem;
	}
	.fin-fuente {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border-subtle);
		border-radius: 0.65rem;
	}
	.fin-fuente span {
		color: var(--text-muted);
		font-size: 0.66rem;
		line-height: 1.35;
	}
	.fin-fuente strong {
		color: var(--text-primary);
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
	}
	.fin-fuente small {
		color: var(--text-muted);
		font-size: 0.61rem;
		line-height: 1.35;
	}
	.fin-fuente--excluida {
		border-style: dashed;
		background: rgba(148, 163, 184, 0.04);
	}
	.fin-nota {
		margin: 0.3rem 1.15rem 0.9rem;
		padding-top: 0.55rem;
		border-top: 1px dashed var(--border-subtle);
		color: var(--text-muted);
		font-size: 0.64rem;
		line-height: 1.45;
	}
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
	@media (max-width: 620px) {
		.fin-resumen-cabecera {
			padding: 0.85rem;
		}
		.fin-kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.fin-kpi {
			padding: 0.75rem;
		}
		.fin-fuentes {
			grid-template-columns: 1fr;
		}
		.fin-nota {
			margin-inline: 0.85rem;
		}
	}
</style>
