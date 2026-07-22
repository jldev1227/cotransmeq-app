<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { backOut, quintOut, cubicOut } from 'svelte/easing';

	export let open: boolean = false;
	export let onClose: () => void = () => {};
	export let activeCount: number = 0;
	/** Etiqueta mono corta sobre el título (ej. "FILTROS", "DETALLE") */
	export let eyebrow: string = 'Filtros';
	/** Título editorial grande en Fraunces (ej. "Refinar resultados") */
	export let title: string = '';
	/** Texto secundario bajo el título */
	export let subtitle: string = '';
</script>

{#if open}
	<!-- Backdrop con gradiente y blur -->
	<button
		type="button"
		class="drawer-backdrop"
		aria-label="Cerrar filtros"
		on:click={onClose}
		on:keydown={(e) => e.key === 'Escape' && onClose()}
		transition:fade={{ duration: 240, easing: cubicOut }}
	></button>

	<!-- Panel del drawer (slide desde la derecha con overshoot) -->
	<aside
		class="drawer-panel"
		role="dialog"
		aria-modal="true"
		aria-label={title || eyebrow}
		transition:fly={{
			x: 560,
			duration: 460,
			easing: backOut,
			opacity: 0
		}}
	>
		<!-- Header sticky con stagger interno -->
		<header class="drawer-header">
			<div class="min-w-0 flex-1">
				<div
					class="drawer-eyebrow"
					in:fly={{ y: -8, duration: 360, delay: 120, easing: quintOut }}
				>
					<span class="drawer-eyebrow-dot"></span>
					<span class="drawer-eyebrow-text">{eyebrow}</span>
					{#if activeCount > 0}
						<span
							class="filter-count"
							in:scale={{ duration: 320, start: 0.6, easing: backOut }}
						>
							{activeCount} activo{activeCount === 1 ? '' : 's'}
						</span>
					{/if}
				</div>
				{#if title}
					<h2
						class="drawer-title"
						in:fly={{ y: 10, duration: 420, delay: 200, easing: quintOut }}
					>{title}</h2>
				{/if}
				{#if subtitle}
					<p
						class="drawer-subtitle"
						in:fly={{ y: 8, duration: 400, delay: 280, easing: quintOut }}
					>{subtitle}</p>
				{/if}
			</div>
			<button
				class="filter-close"
				on:click={onClose}
				aria-label="Cerrar"
				in:scale={{ duration: 280, start: 0.5, delay: 100, easing: backOut }}
			>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</header>

		<!-- Chips removibles (slot opcional) -->
		{#if $$slots.chips}
			<div
				class="drawer-chips"
				in:fly={{ y: 12, duration: 380, delay: 340, easing: quintOut }}
			>
				<slot name="chips" />
			</div>
		{/if}

		<!-- Body scrollable -->
		<div
			class="drawer-body"
			in:fly={{ y: 16, duration: 440, delay: 380, easing: quintOut }}
		>
			<slot />
		</div>

		<!-- Footer sticky con acciones (slot opcional) -->
		{#if $$slots.footer}
			<footer
				class="drawer-footer"
				in:fly={{ y: 20, duration: 420, delay: 440, easing: quintOut }}
			>
				<slot name="footer" />
			</footer>
		{/if}
	</aside>
{/if}

<style>
	/* ═══ Backdrop con gradiente y blur ═══ */
	:global(.drawer-backdrop) {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: radial-gradient(
				ellipse at top right,
				rgba(249, 115, 22, 0.12) 0%,
				transparent 50%
			),
			linear-gradient(135deg, rgba(15, 31, 26, 0.55) 0%, rgba(10, 20, 16, 0.65) 100%);
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		border: none;
		cursor: pointer;
	}

	/* ═══ Panel del drawer ═══ */
	:global(.drawer-panel) {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
		width: 440px;
		max-width: 100vw;
		display: flex;
		flex-direction: column;
		background-color: var(--bg-surface);
		border-top-left-radius: 24px;
		border-bottom-left-radius: 24px;
		box-shadow:
			-16px 0 48px rgba(15, 31, 26, 0.18),
			-4px 0 16px rgba(15, 31, 26, 0.08),
			inset 1px 0 0 rgba(255, 255, 255, 0.5);
		overflow: hidden;
		will-change: transform, opacity;
	}

	/* Sutil shimmer vertical en el borde izquierdo del panel */
	:global(.drawer-panel::before) {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 1px;
		background: linear-gradient(
			180deg,
			transparent 0%,
			rgba(249, 115, 22, 0.3) 50%,
			transparent 100%
		);
		pointer-events: none;
	}

	/* ═══ Header ═══ */
	:global(.drawer-header) {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.5rem 1.5rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
		background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);
		position: relative;
	}
	:global(.drawer-eyebrow) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	:global(.drawer-eyebrow-dot) {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--emerald-500);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
		animation: dot-pulse 2.4s var(--ease-apple) infinite;
	}
	:global(.drawer-eyebrow-text) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--emerald-700);
	}
	:global(.drawer-title) {
		font-family: 'Fraunces', 'Georgia', serif;
		font-size: 1.6rem;
		font-weight: 400;
		line-height: 1.2;
		color: var(--bg-charcoal);
		margin: 0 0 0.25rem;
		letter-spacing: -0.01em;
	}
	:global(.drawer-subtitle) {
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text-muted);
		margin: 0;
	}
	:global(.drawer-chips) {
		padding: 0.85rem 1.5rem;
		border-bottom: 1px solid var(--border-subtle);
		background-color: var(--bg-surface);
	}

	/* ═══ Body ═══ */
	:global(.drawer-body) {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 1.25rem 1.5rem 1.5rem;
		/* Scroll suave en iOS */
		-webkit-overflow-scrolling: touch;
	}

	/* ═══ Footer ═══ */
	:global(.drawer-footer) {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.9rem 1.5rem;
		border-top: 1px solid var(--border-subtle);
		background-color: var(--bg-base);
	}

	/* ═══ Responsive ═══ */
	@media (max-width: 640px) {
		:global(.drawer-panel) {
			width: 100vw;
			border-radius: 0;
		}
	}

	/* ═══ Animaciones globales del componente ═══ */
	@keyframes dot-pulse {
		0%, 100% {
			box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
			transform: scale(1);
		}
		50% {
			box-shadow: 0 0 0 5px rgba(249, 115, 22, 0.05);
			transform: scale(1.15);
		}
	}
</style>
