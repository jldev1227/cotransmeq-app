<script lang="ts">
	/**
	 * Conteos de la cabecera de un directorio, como pastillas en una fila.
	 *
	 * Reemplaza a las tarjetas de resumen (`stat-card`) que ocupaban una franja
	 * entera antes de la lista. Aquí cada cifra es un chip con su punto de
	 * color: se leen de un vistazo y dejan el espacio a los registros. Si se
	 * pasa `onElegir`, cada chip filtra la lista al pulsarlo y se marca cuando
	 * su filtro está puesto.
	 */
	export interface Conteo {
		clave: string;
		etiqueta: string;
		valor: number | string;
		/** Color del punto. Sin él no se pinta punto (por ejemplo, «Total»). */
		color?: string;
	}

	interface Props {
		conteos: Conteo[];
		/** Clave del conteo cuyo filtro está activo. */
		activo?: string | null;
		onElegir?: (clave: string) => void;
	}

	let { conteos, activo = null, onElegir }: Props = $props();
</script>

<div class="conteos" role={onElegir ? 'group' : undefined}>
	{#each conteos as c (c.clave)}
		{#if onElegir}
			<button
				type="button"
				class="conteo conteo--boton"
				class:conteo--activo={activo === c.clave}
				onclick={() => onElegir(c.clave)}
				aria-pressed={activo === c.clave}
			>
				{#if c.color}<span class="punto" style="background:{c.color}" aria-hidden="true"
					></span>{/if}
				<span class="etiqueta">{c.etiqueta}</span>
				<span class="valor">{c.valor}</span>
			</button>
		{:else}
			<span class="conteo">
				{#if c.color}<span class="punto" style="background:{c.color}" aria-hidden="true"
					></span>{/if}
				<span class="etiqueta">{c.etiqueta}</span>
				<span class="valor">{c.valor}</span>
			</span>
		{/if}
	{/each}
</div>

<style>
	.conteos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.conteo {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		font-family: inherit;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		line-height: 1.2;
		white-space: nowrap;
	}
	.conteo--boton {
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.conteo--boton:hover {
		border-color: var(--emerald-500);
	}
	.conteo--activo {
		background: var(--au-tint, #ddf7ea);
		border-color: var(--emerald-500);
		color: var(--emerald-800);
	}
	.punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.valor {
		font-size: 0.85rem;
		letter-spacing: 0;
		color: var(--text-primary);
	}
	.conteo--activo .valor {
		color: var(--emerald-800);
	}
</style>
