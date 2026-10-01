<script lang="ts">
	/**
	 * Acciones de una fila de directorio.
	 *
	 * Iconos grises que casi no se ven hasta que el cursor entra en la fila
	 * (`TablaLista` los revela con `.tl-tr:hover`), y que se destacan solo al
	 * pasar sobre ellos; el destructivo se pone rojo únicamente en ese momento.
	 * Se muestran hasta `visibles` acciones; el resto cae en el menú «⋯».
	 *
	 * Los clics no suben a la fila: la fila entera abre el detalle y aquí se
	 * hace otra cosa.
	 */
	import type { ComponentType } from 'svelte';
	import { Ellipsis } from 'lucide-svelte';

	export interface Accion {
		id: string;
		etiqueta: string;
		/// `ComponentType` y no `Component`: los iconos de lucide-svelte se tipan
		/// como componentes clásicos y `Component` los rechaza.
		icono: ComponentType<any>;
		onClick: () => void;
		/** Se pinta en rojo al pasar el cursor. */
		peligrosa?: boolean;
		/** Se salta sin dejar hueco (permisos, vista actual…). */
		oculta?: boolean;
		deshabilitada?: boolean;
	}

	interface Props {
		acciones: Accion[];
		/** Cuántas van a la vista antes del menú. */
		visibles?: number;
	}

	let { acciones, visibles = 3 }: Props = $props();

	const activas = $derived(acciones.filter((a) => !a.oculta));
	/// Si sobra exactamente una, se muestra en vez de esconderla tras un menú
	/// que solo tendría una entrada.
	const directas = $derived(activas.length <= visibles + 1 ? activas : activas.slice(0, visibles));
	const enMenu = $derived(activas.length <= visibles + 1 ? [] : activas.slice(visibles));

	let abierto = $state(false);
	let contenedor = $state<HTMLDivElement | null>(null);

	function cerrarSiFuera(e: MouseEvent) {
		if (abierto && contenedor && !contenedor.contains(e.target as Node)) abierto = false;
	}
</script>

<svelte:window onclick={cerrarSiFuera} onkeydown={(e) => e.key === 'Escape' && (abierto = false)} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="af-grupo"
	bind:this={contenedor}
	onclick={(e) => e.stopPropagation()}
	onkeydown={(e) => e.stopPropagation()}
>
	{#each directas as a (a.id)}
		<button
			type="button"
			class="af-btn"
			class:af-btn--peligrosa={a.peligrosa}
			title={a.etiqueta}
			aria-label={a.etiqueta}
			disabled={a.deshabilitada}
			onclick={a.onClick}
		>
			<a.icono size={16} strokeWidth={1.8} />
		</button>
	{/each}

	{#if enMenu.length}
		<div class="af-mas">
			<button
				type="button"
				class="af-btn"
				class:af-btn--abierto={abierto}
				title="Más acciones"
				aria-label="Más acciones"
				aria-haspopup="menu"
				aria-expanded={abierto}
				onclick={() => (abierto = !abierto)}
			>
				<Ellipsis size={16} strokeWidth={1.8} />
			</button>
			{#if abierto}
				<div class="af-menu" role="menu">
					{#each enMenu as a (a.id)}
						<button
							type="button"
							class="af-item"
							class:af-item--peligrosa={a.peligrosa}
							role="menuitem"
							disabled={a.deshabilitada}
							onclick={() => {
								abierto = false;
								a.onClick();
							}}
						>
							<a.icono size={15} strokeWidth={1.8} />
							{a.etiqueta}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.af-grupo {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.15rem;
		opacity: 0.32;
		transition: opacity 0.15s ease;
	}
	/* `TablaLista` revela el grupo cuando la fila tiene el cursor o el foco. */
	:global(.tl-tr:hover) .af-grupo,
	:global(.tl-tr:focus-within) .af-grupo,
	.af-grupo:has(.af-btn--abierto) {
		opacity: 1;
	}
	@media (hover: none) {
		.af-grupo {
			opacity: 1;
		}
	}

	.af-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.af-btn:hover:not(:disabled),
	.af-btn--abierto {
		background: var(--au-tint, #ddf7ea);
		border-color: var(--border-default);
		color: var(--emerald-800);
	}
	.af-btn--peligrosa:hover:not(:disabled) {
		background: var(--au-danger-soft, #fff0ed);
		color: var(--au-danger, #b42318);
	}
	.af-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.af-mas {
		position: relative;
	}
	.af-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 30;
		min-width: 190px;
		padding: 0.35rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 14px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
	}
	.af-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
	}
	.af-item:hover:not(:disabled) {
		background: var(--bg-base);
	}
	.af-item--peligrosa {
		color: var(--au-danger, #b42318);
	}
	.af-item--peligrosa:hover:not(:disabled) {
		background: var(--au-danger-soft, #fff0ed);
	}
	.af-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
