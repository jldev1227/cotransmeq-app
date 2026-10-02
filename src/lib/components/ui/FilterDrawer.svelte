<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { X } from 'lucide-svelte';

	/**
	 * Panel lateral de filtros de los listados.
	 *
	 * Mismo lenguaje que los modales de directorio y la app móvil: encabezado
	 * verde profundo con la etiqueta, el título y cuántos filtros hay puestos;
	 * cuerpo sobre el fondo claro; acciones en un pie blanco.
	 *
	 * Entra con un deslizamiento corto y una curva sin rebote. Antes llegaba
	 * con `backOut` (se pasaba de largo y volvía) y cada bloque de dentro
	 * entraba con su propio retraso: medio segundo de movimiento para abrir
	 * un panel de filtros.
	 */
	export let open: boolean = false;
	export let onClose: () => void = () => {};
	export let activeCount: number = 0;
	/** Etiqueta corta sobre el título (ej. "Filtros"). */
	export let eyebrow: string = 'Filtros';
	/** Título del panel (ej. "Refinar resultados"). */
	export let title: string = '';
	/** Texto secundario bajo el título. */
	export let subtitle: string = '';

	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onClose();
	}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
	<button
		type="button"
		class="fd-backdrop"
		aria-label="Cerrar filtros"
		tabindex="-1"
		on:click={onClose}
		transition:fade={{ duration: 160 }}
	></button>

	<aside
		class="fd-panel"
		role="dialog"
		aria-modal="true"
		aria-label={title || eyebrow}
		transition:fly={{ x: 48, duration: 240, easing: cubicOut }}
	>
		<header class="fd-hero">
			<span class="fd-orb"></span>
			<div class="fd-copy">
				<p class="fd-eyebrow">
					{eyebrow.toUpperCase()}
					{#if activeCount > 0}
						<span class="fd-count">{activeCount} activo{activeCount === 1 ? '' : 's'}</span>
					{/if}
				</p>
				{#if title}<h2 class="fd-title">{title}</h2>{/if}
				{#if subtitle}<p class="fd-sub">{subtitle}</p>{/if}
			</div>
			<button type="button" class="fd-close" on:click={onClose} aria-label="Cerrar">
				<X size={16} strokeWidth={2.5} />
			</button>
		</header>

		{#if $$slots.chips}
			<div class="fd-chips">
				<slot name="chips" />
			</div>
		{/if}

		<div class="fd-body">
			<slot />
		</div>

		{#if $$slots.footer}
			<footer class="fd-footer">
				<slot name="footer" />
			</footer>
		{/if}
	</aside>
{/if}

<style>
	.fd-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(4, 31, 26, 0.5);
		backdrop-filter: blur(3px);
	}

	.fd-panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
		width: 440px;
		max-width: 100vw;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-base);
		border-radius: 28px 0 0 28px;
		box-shadow: -16px 0 48px rgba(0, 29, 23, 0.22);
	}

	.fd-hero {
		position: relative;
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 24px 22px 22px;
		overflow: hidden;
		background: var(--bg-charcoal-deep);
	}
	.fd-orb {
		position: absolute;
		width: 200px;
		height: 200px;
		right: -60px;
		top: -100px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.05);
		pointer-events: none;
	}
	.fd-copy {
		position: relative;
		z-index: 1;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fd-eyebrow {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		color: rgba(255, 255, 255, 0.62);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.fd-count {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--accion);
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.fd-title {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 22px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
	}
	.fd-sub {
		margin: 0;
		color: rgba(255, 255, 255, 0.72);
		font-size: 13px;
		line-height: 1.45;
	}
	.fd-close {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		cursor: pointer;
	}
	.fd-close:hover {
		background: rgba(255, 255, 255, 0.16);
	}

	.fd-chips {
		flex-shrink: 0;
		padding: 12px 22px;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}

	.fd-body {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 20px 22px 24px;
		-webkit-overflow-scrolling: touch;
	}
	/* Cada campo del filtro, como un dato de las fichas: tarjeta blanca. */
	.fd-body :global(.filter-field) {
		padding: 12px 14px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}

	.fd-footer {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 22px;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}
	/* El slot de pie suele envolver sus botones en un div propio. */
	.fd-footer > :global(div) {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		width: 100%;
	}

	@media (max-width: 640px) {
		.fd-panel {
			width: 100vw;
			border-radius: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.fd-panel,
		.fd-backdrop {
			transition: none;
		}
	}
</style>
