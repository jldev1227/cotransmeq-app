<script lang="ts">
	/**
	 * Lo que queda de un anticipo. La barra muestra lo que queda (no lo
	 * gastado) y una marca en el 15 %: por debajo se avisó a operaciones y al
	 * conductor. `compacta` es la versión de una celda de tabla.
	 */
	import { colorSaldo, moneda, type Saldo } from '$lib/api/viaticos';

	interface Props {
		saldo: Saldo;
		compacta?: boolean;
	}
	let { saldo, compacta = false }: Props = $props();

	const ancho = $derived(Math.max(0, Math.min(100, saldo.porcentaje_restante)));
	const color = $derived(colorSaldo(saldo));
</script>

{#if compacta}
	<div class="bs bs--compacta">
		<div class="bs-cifras">
			<strong style:color={saldo.saldo < 0 ? '#b42318' : undefined}>{moneda(saldo.saldo)}</strong>
			<small>de {moneda(saldo.valor)}</small>
		</div>
		<div class="bs-pista" aria-hidden="true">
			<div class="bs-relleno" style:width="{ancho}%" style:background={color}></div>
			<div class="bs-marca"></div>
		</div>
	</div>
{:else}
	<section class="bs" aria-label="Saldo del anticipo">
		<div class="bs-principal">
			<span class="bs-etiqueta">Saldo disponible</span>
			<strong class="bs-saldo" style:color={saldo.saldo < 0 ? '#b42318' : undefined}
				>{moneda(saldo.saldo)}</strong
			>
			<span class="bs-porcentaje" style:color
				>{Math.round(saldo.porcentaje_restante)} % del anticipo</span
			>
		</div>
		<div
			class="bs-pista bs-pista--grande"
			role="meter"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={ancho}
			aria-label="Porcentaje restante"
		>
			<div class="bs-relleno" style:width="{ancho}%" style:background={color}></div>
			<div class="bs-marca" title="15 %: alerta de saldo bajo"></div>
		</div>
		<dl class="bs-totales">
			<div>
				<dt>Anticipado</dt>
				<dd>{moneda(saldo.valor)}</dd>
			</div>
			<div>
				<dt>Gastos reportados</dt>
				<dd>{moneda(saldo.gastado)}</dd>
			</div>
		</dl>
		{#if saldo.saldo < 0}
			<p class="bs-nota">El conductor reportó {moneda(-saldo.saldo)} más de lo anticipado.</p>
		{/if}
	</section>
{/if}

<style>
	.bs {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 18px;
		padding: 16px 18px;
		border-radius: 18px;
		background: var(--au-tint);
	}
	.bs--compacta {
		gap: 6px;
		min-width: 150px;
		margin: 0;
		padding: 0;
		background: none;
	}
	.bs-cifras {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-variant-numeric: tabular-nums;
	}
	.bs-cifras strong {
		color: var(--text-primary);
		font-size: 14px;
	}
	.bs-cifras small {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.bs-principal {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
	}
	.bs-etiqueta {
		flex-basis: 100%;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.bs-saldo {
		color: var(--au-dark);
		font-size: 28px;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.bs-porcentaje {
		font-size: 13px;
		font-weight: 700;
	}
	.bs-pista {
		position: relative;
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-secondary) 18%, transparent);
	}
	.bs-pista--grande {
		height: 10px;
	}
	.bs-relleno {
		height: 100%;
		border-radius: inherit;
		transition: width 0.3s ease;
	}
	.bs-marca {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 15%;
		width: 2px;
		background: color-mix(in srgb, var(--text-primary) 45%, transparent);
	}
	.bs-totales {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 28px;
		margin: 0;
	}
	.bs-totales div {
		display: flex;
		flex-direction: column;
	}
	.bs-totales dt {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.bs-totales dd {
		margin: 0;
		color: var(--text-primary);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.bs-nota {
		margin: 0;
		color: #b42318;
		font-size: 13px;
		font-weight: 600;
	}
</style>
