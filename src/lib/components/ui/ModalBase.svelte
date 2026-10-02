<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { X } from 'lucide-svelte';

	/**
	 * Cascarón genérico de los modales de la app, con el lenguaje de la app
	 * móvil: encabezado verde profundo de la marca (etiqueta, título, subtítulo),
	 * cuerpo sobre el fondo claro y un pie blanco para las acciones.
	 *
	 * Es la base visual que comparten los modales de los canvas de Univer
	 * (cierres, nómina, facturas, configuraciones…) con los de directorio
	 * (`ModalEntidad`, `ModalDetalle`). Solo pone la carcasa: el contenido, las
	 * pestañas o el formulario los trae cada modal.
	 *
	 * Va por encima del canvas (`.univer-shell-active`, z-index 9999) y por
	 * debajo de los diálogos de confirmación (10050), que se abren encima.
	 */
	interface Props {
		open: boolean;
		title: string;
		eyebrow?: string;
		subtitle?: string | null;
		/** Ancho máximo: sm 440 · md 640 · lg 860 · xl 1120 · full (casi toda la ventana). */
		tamano?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
		/** `false` mientras se guarda o en modales de peso: el fondo no cierra. */
		cerrarAlFondo?: boolean;
		/** Bloquea el cierre (botón, Escape y fondo), p. ej. durante un envío. */
		bloqueado?: boolean;
		/** Cuerpo sin relleno, para tablas u hojas que van de borde a borde. */
		sinRelleno?: boolean;
		oncerrar: () => void;
		children: Snippet;
		/** Acciones del pie (botones `btn-primary` / `btn-secondary` / `btn-danger`). */
		pie?: Snippet;
		/** Contenido extra bajo el título, dentro del encabezado (pestañas, chips). */
		cabecera?: Snippet;
		/** Elementos a la derecha del título, antes del botón de cerrar. */
		accionesCabecera?: Snippet;
	}

	let {
		open,
		title,
		eyebrow,
		subtitle = null,
		tamano = 'md',
		cerrarAlFondo = true,
		bloqueado = false,
		sinRelleno = false,
		oncerrar,
		children,
		pie,
		cabecera,
		accionesCabecera
	}: Props = $props();

	const tituloId = `mb-titulo-${Math.random().toString(36).slice(2, 8)}`;

	function cerrar() {
		if (!bloqueado) oncerrar();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open || e.key !== 'Escape') return;
		/// Si hay una confirmación abierta encima, Escape es de ella.
		if (document.querySelector('[role="alertdialog"]')) return;
		e.preventDefault();
		cerrar();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="mb-overlay" transition:fade={{ duration: 160 }}>
		<button
			type="button"
			class="mb-backdrop"
			aria-label="Cerrar"
			tabindex="-1"
			onclick={() => cerrarAlFondo && cerrar()}
		></button>
		<div
			class="mb-card mb-card--{tamano}"
			role="dialog"
			aria-modal="true"
			aria-labelledby={tituloId}
			tabindex="-1"
			transition:fly={{ y: 18, duration: 300, easing: quintOut }}
		>
			<header class="mb-hero">
				<span class="mb-orb mb-orb-lg"></span>
				<span class="mb-orb mb-orb-sm"></span>
				<div class="mb-fila">
					<div class="mb-copy">
						{#if eyebrow}<p class="mb-eyebrow">{eyebrow.toUpperCase()}</p>{/if}
						<h2 class="mb-title" id={tituloId}>{title}</h2>
						{#if subtitle}<p class="mb-sub">{subtitle}</p>{/if}
					</div>
					{#if accionesCabecera}<div class="mb-hero-acciones">{@render accionesCabecera()}</div>{/if}
					<button
						type="button"
						class="mb-close"
						aria-label="Cerrar"
						onclick={cerrar}
						disabled={bloqueado}
					>
						<X size={16} strokeWidth={2.5} />
					</button>
				</div>
				{#if cabecera}<div class="mb-hero-extra">{@render cabecera()}</div>{/if}
			</header>

			<div class="mb-body" class:mb-body--sin-relleno={sinRelleno}>
				{@render children()}
			</div>

			{#if pie}
				<footer class="mb-footer">{@render pie()}</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.mb-overlay {
		position: fixed;
		inset: 0;
		z-index: 10040;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px 16px;
	}
	.mb-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(4, 31, 26, 0.6);
		backdrop-filter: blur(4px);
	}
	.mb-card {
		position: relative;
		width: 100%;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 28px;
		background: var(--bg-surface);
		box-shadow: 0 16px 48px rgba(0, 29, 23, 0.28);
	}
	.mb-card:focus {
		outline: none;
	}
	.mb-card--sm {
		max-width: 440px;
	}
	.mb-card--md {
		max-width: 640px;
	}
	.mb-card--lg {
		max-width: 860px;
	}
	.mb-card--xl {
		max-width: 1120px;
	}
	.mb-card--full {
		max-width: min(1440px, 100%);
		height: 100%;
	}

	.mb-hero {
		position: relative;
		flex-shrink: 0;
		padding: 20px 22px;
		overflow: hidden;
		background: var(--bg-charcoal-deep);
	}
	.mb-hero:has(.mb-hero-extra) {
		padding-bottom: 0;
	}
	.mb-fila {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.mb-copy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mb-eyebrow {
		margin: 0;
		color: rgba(255, 255, 255, 0.62);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.mb-title {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 22px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.mb-sub {
		margin: 0;
		color: rgba(255, 255, 255, 0.72);
		font-size: 13px;
		line-height: 1.45;
	}
	.mb-hero-acciones {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mb-hero-extra {
		position: relative;
		z-index: 2;
		margin-top: 16px;
	}
	.mb-close {
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
	.mb-close:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
	}
	.mb-close:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.mb-orb {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.05);
		pointer-events: none;
	}
	.mb-orb-lg {
		width: 200px;
		height: 200px;
		right: -60px;
		top: -100px;
	}
	.mb-orb-sm {
		width: 80px;
		height: 80px;
		left: -20px;
		bottom: -40px;
	}

	.mb-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 20px 22px;
		background: var(--bg-base);
	}
	.mb-body--sin-relleno {
		padding: 0;
	}

	.mb-footer {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 10px;
		padding: 14px 22px;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}

	@media (max-width: 640px) {
		.mb-overlay {
			padding: 0;
			align-items: flex-end;
		}
		.mb-card {
			max-height: 94vh;
			border-radius: 24px 24px 0 0;
		}
		.mb-card--full {
			height: 94vh;
		}
		.mb-footer :global(button),
		.mb-footer :global(a) {
			flex: 1;
		}
	}
</style>
