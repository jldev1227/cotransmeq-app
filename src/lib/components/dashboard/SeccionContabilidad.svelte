<script lang="ts">
	/**
	 * Sección «Contabilidad»: terceros con datos incompletos y todo lo de
	 * liquidaciones de terceros (sin lo de facturas, que es de Facturación).
	 */
	import { BookUser, UserX, Wallet } from 'lucide-svelte';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import BloqueTerceros from './BloqueTerceros.svelte';
	import { numero, pesosCortos } from '$lib/dashboard/formato';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();
	const k = $derived(datos.kpis);
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Terceros activos"
		valor={numero(k.terceros)}
		icono={BookUser}
		href="/dashboard/terceros"
	/>
	<Kpi
		etiqueta="Sin NIT o cédula"
		valor={numero(k.sin_identificacion)}
		detalle="No se les puede emitir certificado ni cruzar pagos"
		tono={k.sin_identificacion ? 'rojo' : 'verde'}
		icono={UserX}
	/>
	<Kpi
		etiqueta="Sin teléfono ni correo"
		valor={numero(k.sin_contacto)}
		detalle={k.sin_ambos
			? `${numero(k.sin_ambos)} sin identificación ni contacto`
			: 'Sin forma de avisarles'}
		tono={k.sin_contacto ? 'ambar' : 'verde'}
		icono={UserX}
	/>
	{#if datos.previstas_pagar}
		<Kpi
			etiqueta="Previstos para pagar"
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
		titulo="Terceros con datos incompletos"
		subtitulo="Primero los que más cierres tienen"
		columnas={12}
		tono={datos.terceros_incompletos.length ? 'alerta' : 'normal'}
		enlace="/dashboard/terceros"
	>
		{#if datos.terceros_incompletos.length === 0}
			<p class="sec-ok">Todos los terceros activos tienen identificación y contacto.</p>
		{:else}
			<ul class="sec-columnas">
				{#each datos.terceros_incompletos as t (t.id)}
					<li>
						<a href={t.enlace}>
							<span class="sec-lista-titulo">{t.nombre}</span>
							<span class="sec-lista-sub"
								>Falta: {t.faltan.join(' · ')}{t.liquidaciones
									? ` · ${t.liquidaciones} cierres`
									: ''}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
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
	/* Lista larga que fluye en columnas según el ancho real del main. */
	.sec-columnas {
		list-style: none;
		margin: 0;
		padding: 0;
		columns: 3 18rem;
		column-gap: 1.25rem;
	}
	.sec-columnas li {
		break-inside: avoid;
		padding: 0.35rem 0;
		border-bottom: 1px dashed var(--border-subtle);
	}
	.sec-columnas a {
		display: flex;
		flex-direction: column;
		min-width: 0;
		text-decoration: none;
		color: inherit;
	}
	.sec-columnas a:hover .sec-lista-titulo {
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
	}
</style>
