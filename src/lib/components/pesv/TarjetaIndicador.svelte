<script lang="ts">
	/**
	 * Ficha de un indicador.
	 *
	 * Muestra valor, meta, período, tendencia y estado **en texto**, no solo con
	 * color. Y cuando el valor es `null` dice «Sin datos» con el motivo: nunca
	 * un cero, porque un 0 % de cumplimiento y un «no hay con qué calcularlo»
	 * son lo contrario el uno del otro.
	 */
	import type { ResultadoIndicador } from '$lib/types/pesv-centro';
	import CoberturaDatos from './CoberturaDatos.svelte';
	import EstadoBadge from './EstadoBadge.svelte';
	import { ESTADO_INDICADOR, describirTendencia, formatearValor } from './estados';

	interface Props {
		indicador: ResultadoIndicador;
		onAbrir?: (codigo: string) => void;
	}

	let { indicador, onAbrir }: Props = $props();

	const token = $derived(ESTADO_INDICADOR[indicador.status]);
	const tendencia = $derived(describirTendencia(indicador.tendencia));
	const sinDatos = $derived(indicador.value === null);
	const incidencias = $derived(indicador.issues.reduce((a, i) => a + i.count, 0));
</script>

<article class="tarjeta" style="border-left-color: {token.color};">
	<header>
		<div class="titulos">
			<span class="codigo">{indicador.code}</span>
			<h3>{indicador.nombre}</h3>
		</div>
		<EstadoBadge {token} />
	</header>

	<p class="valor" class:sin-datos={sinDatos}>
		{formatearValor(indicador.value, indicador.unit)}
	</p>

	{#if sinDatos && indicador.razonSinDatos}
		<!-- El motivo va en la tarjeta y no escondido en un tooltip: es lo único
		     accionable cuando no hay valor. -->
		<p class="razon">{indicador.razonSinDatos}</p>
	{:else}
		<dl class="datos">
			<div>
				<dt>Meta</dt>
				<dd>
					{indicador.target === null
						? 'Sin meta aprobada'
						: formatearValor(indicador.target, indicador.unit)}
				</dd>
			</div>
			<div>
				<dt>Numerador / denominador</dt>
				<dd class="cifras">
					{indicador.numerator ?? '—'} / {indicador.denominator ?? '—'}
				</dd>
			</div>
		</dl>
	{/if}

	<p
		class="tendencia"
		class:favorable={tendencia.favorable === true}
		class:adversa={tendencia.favorable === false}
	>
		<span aria-hidden="true">{tendencia.icono}</span>
		{tendencia.texto}
	</p>

	<CoberturaDatos cobertura={indicador.dataCoverage} compacto />

	<footer>
		<span class="periodo">{indicador.periodo.etiqueta}</span>
		{#if incidencias > 0}
			<span class="incidencias"
				>{incidencias} {incidencias === 1 ? 'incidencia' : 'incidencias'}</span
			>
		{/if}
		{#if onAbrir}
			<button type="button" class="detalle" onclick={() => onAbrir?.(indicador.code)}>
				Ver fórmula y fuentes
			</button>
		{/if}
	</footer>
</article>

<style>
	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-left-width: 4px;
		border-radius: 0.75rem;
		box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.titulos {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.codigo {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #64748b;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: #0f172a;
		line-height: 1.3;
	}

	.valor {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.valor.sin-datos {
		font-size: 1.125rem;
		color: #64748b;
		font-weight: 600;
	}

	.razon {
		margin: 0;
		font-size: 0.8125rem;
		color: #475569;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
	}

	.datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		margin: 0;
	}

	.datos dt {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.datos dd {
		margin: 0;
		font-size: 0.875rem;
		color: #0f172a;
		font-weight: 500;
	}

	.cifras {
		font-variant-numeric: tabular-nums;
	}

	.tendencia {
		margin: 0;
		font-size: 0.8125rem;
		color: #64748b;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tendencia.favorable {
		color: #15803d;
	}

	.tendencia.adversa {
		color: #b45309;
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid #f1f5f9;
		font-size: 0.75rem;
		color: #64748b;
	}

	.incidencias {
		color: #b45309;
		font-weight: 600;
	}

	.detalle {
		margin-left: auto;
		background: none;
		border: none;
		padding: 0.375rem 0;
		color: #0f172a;
		font-size: 0.75rem;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
		/* 44 px de objetivo táctil sin agrandar la caja: el área extra sale del
		   padding vertical y el enlace sigue pareciendo un enlace. */
		min-height: 2.75rem;
	}

	.detalle:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
		border-radius: 0.25rem;
	}
</style>
