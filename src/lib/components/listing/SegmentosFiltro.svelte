<script lang="ts">
	/**
	 * Filtro por segmentos: una etiqueta y un juego de pastillas excluyentes.
	 *
	 * Es el control de «Tipo» y «Estado» de SARLAFT, hecho componente para que
	 * los demás directorios filtren igual y a la vista, sin abrir el panel
	 * lateral para lo más frecuente.
	 */
	export interface Segmento {
		valor: string;
		etiqueta: string;
		/** Color del punto que precede a la etiqueta (estados). */
		punto?: string;
	}

	interface Props {
		etiqueta: string;
		opciones: Segmento[];
		valor: string;
		onCambiar: (valor: string) => void;
	}

	let { etiqueta, opciones, valor, onCambiar }: Props = $props();
</script>

<div class="segmentos" role="group" aria-label={etiqueta}>
	<span class="segmentos-etiqueta">{etiqueta}</span>
	{#each opciones as o (o.valor)}
		<button
			type="button"
			class="segmento"
			class:segmento--activo={valor === o.valor}
			aria-pressed={valor === o.valor}
			onclick={() => onCambiar(o.valor)}
		>
			{#if o.punto}<span class="segmento-punto" style="background:{o.punto}" aria-hidden="true"
				></span>{/if}
			{o.etiqueta}
		</button>
	{/each}
</div>

<style>
	.segmentos {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.15rem;
		padding: 0.25rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 14px;
	}
	.segmentos-etiqueta {
		padding: 0 0.5rem 0 0.65rem;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-very-muted);
	}
	.segmento {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.75rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.segmento:hover {
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.segmento--activo {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
		font-weight: 700;
	}
	.segmento-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
</style>
