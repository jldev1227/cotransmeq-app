<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Un dato de la ficha de consulta: etiqueta pequeña arriba y valor en
	 * negrita, en una tarjeta blanca. Sin valor se dice «Sin registrar» en vez
	 * de dejar el hueco o un guion, que en una ficha parece un error de carga.
	 */
	interface Props {
		etiqueta: string;
		valor?: string | number | null;
		/** Números de documento, placas, montos: cifras alineadas. */
		mono?: boolean;
		completo?: boolean;
		/** Contenido propio en lugar de `valor` (un enlace, una lista). */
		children?: Snippet;
	}

	let { etiqueta, valor = null, mono = false, completo = false, children }: Props = $props();

	const vacio = $derived(valor == null || String(valor).trim() === '');
</script>

<div class="dato" class:completo>
	<span class="etiqueta">{etiqueta}</span>
	{#if children}
		<span class="valor">{@render children()}</span>
	{:else if vacio}
		<span class="valor nulo">Sin registrar</span>
	{:else}
		<span class="valor" class:mono>{valor}</span>
	{/if}
</div>

<style>
	.dato {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.completo {
		grid-column: 1 / -1;
	}
	.etiqueta {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.valor {
		color: var(--text-primary);
		font-size: 14.5px;
		font-weight: 800;
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.mono {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
	}
	.nulo {
		color: var(--text-very-muted);
		font-weight: 600;
		font-style: italic;
	}
</style>
