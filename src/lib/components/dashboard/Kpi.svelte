<script lang="ts">
	/**
	 * Cifra grande con etiqueta y una línea de contexto. El tono colorea el
	 * valor: verde para lo bueno, ámbar para lo que pide atención, rojo para
	 * lo vencido.
	 */
	import type { ComponentType } from 'svelte';

	interface Props {
		etiqueta: string;
		valor: string | number;
		detalle?: string;
		tono?: 'neutro' | 'verde' | 'ambar' | 'rojo';
		icono?: ComponentType;
		href?: string;
	}
	let { etiqueta, valor, detalle, tono = 'neutro', icono: Icono, href }: Props = $props();
</script>

{#if href}
	<a class="kpi kpi--{tono} kpi--enlace" {href}>
		{#if Icono}<span class="kpi-icono"><Icono size={16} strokeWidth={2.2} /></span>{/if}
		<span class="kpi-etiqueta">{etiqueta}</span>
		<span class="kpi-valor">{valor}</span>
		{#if detalle}<span class="kpi-detalle">{detalle}</span>{/if}
	</a>
{:else}
	<div class="kpi kpi--{tono}">
		{#if Icono}<span class="kpi-icono"><Icono size={16} strokeWidth={2.2} /></span>{/if}
		<span class="kpi-etiqueta">{etiqueta}</span>
		<span class="kpi-valor">{valor}</span>
		{#if detalle}<span class="kpi-detalle">{detalle}</span>{/if}
	</div>
{/if}

<style>
	.kpi {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		padding: 0.85rem 1rem;
		border-radius: 16px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		box-shadow: var(--shadow-card);
		text-decoration: none;
		color: inherit;
	}
	.kpi--enlace {
		transition:
			transform 0.15s var(--ease-apple),
			border-color 0.15s var(--ease-apple);
	}
	.kpi--enlace:hover {
		transform: translateY(-1px);
		border-color: var(--au-primary);
	}
	.kpi-icono {
		position: absolute;
		top: 0.75rem;
		right: 0.85rem;
		display: inline-flex;
		width: 28px;
		height: 28px;
		align-items: center;
		justify-content: center;
		border-radius: 9px;
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.kpi--ambar .kpi-icono {
		background: #fdf1d6;
		color: #9a6700;
	}
	.kpi--rojo .kpi-icono {
		background: #fde8e8;
		color: #b42318;
	}
	.kpi-etiqueta {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding-right: 2.25rem;
	}
	.kpi-valor {
		font-family: var(--font-display);
		font-size: 1.65rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.kpi--verde .kpi-valor {
		color: var(--au-dark);
	}
	.kpi--ambar .kpi-valor {
		color: #9a6700;
	}
	.kpi--rojo .kpi-valor {
		color: #b42318;
	}
	.kpi-detalle {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
</style>
