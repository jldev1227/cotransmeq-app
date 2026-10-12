<script lang="ts">
	import { AREA_LABELS } from '$lib/config/permissions';

	/**
	 * Selector de áreas por pastillas, con varias a la vez.
	 *
	 * Lo comparten editar, alta manual e invitar: eran tres copias del mismo
	 * `{#each AREA_LABELS}` con su propio `toggle`. La lista sale de
	 * `AREA_LABELS` para que un área nueva aparezca aquí sin tocar nada.
	 */
	interface Props {
		seleccion: string[];
		onCambiar: (areas: string[]) => void;
		etiqueta?: string;
		requerido?: boolean;
	}

	let { seleccion, onCambiar, etiqueta = 'Áreas', requerido = false }: Props = $props();

	const idEtiqueta = `sa-${Math.random().toString(36).slice(2, 8)}`;

	function alternar(area: string) {
		onCambiar(
			seleccion.includes(area) ? seleccion.filter((a) => a !== area) : [...seleccion, area]
		);
	}
</script>

<div class="sa" role="group" aria-labelledby={idEtiqueta}>
	<span class="sa-etiqueta" id={idEtiqueta}>
		{etiqueta}
		{#if requerido}<span class="sa-req" aria-hidden="true">*</span>{/if}
	</span>
	<div class="sa-pastillas">
		{#each Object.entries(AREA_LABELS) as [clave, label] (clave)}
			{@const activa = seleccion.includes(clave)}
			<button
				type="button"
				class="sa-pastilla"
				class:sa-pastilla--activa={activa}
				aria-pressed={activa}
				onclick={() => alternar(clave)}
			>
				{label}
			</button>
		{/each}
	</div>
</div>

<style>
	.sa {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	/* Igual que la etiqueta de `Campo`, para que no se note el cambio de pieza. */
	.sa-etiqueta {
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.sa-req {
		margin-left: 2px;
		color: #dc2626;
	}
	.sa-pastillas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.sa-pastilla {
		min-height: 36px;
		padding: 0.4rem 0.85rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s,
			color 0.15s;
	}
	.sa-pastilla:hover {
		border-color: var(--border-emphasis);
		color: var(--text-primary);
	}
	.sa-pastilla:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}
	/* La marcada usa el tinte de la marca, como el segmento activo de los
	   filtros (en Cotransmeq la escala esmeralda es naranja). */
	.sa-pastilla--activa,
	.sa-pastilla--activa:hover {
		background: var(--au-tint, #ddf7ea);
		border-color: var(--emerald-500);
		color: var(--emerald-800);
	}
</style>
