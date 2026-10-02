<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { X } from 'lucide-svelte';
	import TabsVista, { type TabVista } from '$lib/components/ui/TabsVista.svelte';

	/**
	 * Ficha de consulta de un registro de directorio (vehículo, conductor,
	 * cliente, tercero), con el lenguaje de la app móvil: encabezado verde
	 * profundo con la identidad del registro, datos en tarjetas de etiqueta y
	 * valor, y las acciones abajo.
	 *
	 * Es la hermana de solo lectura de `ModalEntidad`: mismo encabezado, mismas
	 * pestañas y mismo pie, para que «ver» y «editar» se sientan una sola cosa.
	 */
	interface Props {
		open: boolean;
		eyebrow: string;
		title: string;
		subtitle?: string | null;
		/** Foto del registro; sin ella se pintan las iniciales del título. */
		foto?: string | null;
		/** Lo que va en el avatar sin foto; por defecto, las iniciales del título. */
		iniciales?: string | null;
		estado?: { etiqueta: string; color: string } | null;
		tabs?: TabVista[];
		tabActiva?: string;
		cargando?: boolean;
		oncerrar: () => void;
		children: Snippet<[string]>;
		/** Botones del pie, a la derecha de «Cerrar». */
		acciones?: Snippet;
	}

	let {
		open,
		eyebrow,
		title,
		subtitle,
		foto,
		iniciales: inicialesPropias = null,
		estado,
		tabs = [],
		tabActiva = $bindable(''),
		cargando = false,
		oncerrar,
		children,
		acciones
	}: Props = $props();

	const tituloId = `md-titulo-${Math.random().toString(36).slice(2, 8)}`;

	const iniciales = $derived(
		inicialesPropias ||
		title
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0])
			.join('')
			.toUpperCase() || '·'
	);

	function onKeydown(e: KeyboardEvent) {
		if (!open || e.key !== 'Escape') return;
		if (document.querySelector('[role="alertdialog"]')) return;
		e.preventDefault();
		oncerrar();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="md-overlay" transition:fade={{ duration: 160 }}>
		<button type="button" class="md-backdrop" aria-label="Cerrar" tabindex="-1" onclick={oncerrar}
		></button>
		<div
			class="md-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby={tituloId}
			tabindex="-1"
			transition:fly={{ y: 18, duration: 320, easing: quintOut }}
		>
			<header class="md-hero">
				<span class="md-orb md-orb-lg"></span>
				<span class="md-orb md-orb-sm"></span>
				<button type="button" class="md-close" aria-label="Cerrar" onclick={oncerrar}>
					<X size={16} strokeWidth={2.5} />
				</button>

				<div class="md-identidad">
					<div class="md-avatar" aria-hidden="true">
						{#if foto}<img src={foto} alt="" />{:else}{iniciales}{/if}
					</div>
					<div class="md-copy">
						<p class="md-eyebrow">{eyebrow}</p>
						<h2 class="md-title" id={tituloId}>{title}</h2>
						{#if subtitle || estado}
							<p class="md-sub">
								{#if subtitle}<span>{subtitle}</span>{/if}
								{#if estado}
									<span class="md-estado">
										<span class="md-punto" style="background: {estado.color}"></span>
										{estado.etiqueta}
									</span>
								{/if}
							</p>
						{/if}
					</div>
				</div>

				{#if tabs.length > 1}
					<div class="md-tabs">
						<TabsVista variante="oscuro" etiqueta="Secciones" {tabs} bind:activa={tabActiva} />
					</div>
				{/if}
			</header>

			<div class="md-body">
				{#if cargando}
					<div class="md-cargando" aria-live="polite">
						<span class="md-spinner" aria-hidden="true"></span>
						Cargando…
					</div>
				{:else}
					{@render children(tabActiva)}
				{/if}
			</div>

			<footer class="md-footer">
				<button type="button" class="btn-secondary" onclick={oncerrar}>Cerrar</button>
				{@render acciones?.()}
			</footer>
		</div>
	</div>
{/if}

<style>
	.md-overlay {
		position: fixed;
		inset: 0;
		z-index: 10040;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px 16px 104px;
	}
	.md-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(4, 31, 26, 0.6);
		backdrop-filter: blur(4px);
	}
	.md-card {
		position: relative;
		width: 100%;
		max-width: 640px;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 28px;
		background: var(--bg-surface);
		box-shadow: 0 16px 48px rgba(0, 29, 23, 0.28);
	}
	.md-card:focus {
		outline: none;
	}

	.md-hero {
		position: relative;
		flex-shrink: 0;
		padding: 22px 22px 0;
		overflow: hidden;
		background: var(--bg-charcoal-deep);
	}
	.md-identidad {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 44px 20px 0;
	}
	/* El avatar ocupa el lugar de la mascota en las alertas de la app. */
	.md-avatar {
		flex-shrink: 0;
		width: 64px;
		height: 64px;
		display: grid;
		place-items: center;
		overflow: hidden;
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.18);
		color: #fff;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 900;
	}
	.md-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.md-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.md-eyebrow {
		margin: 0;
		color: rgba(255, 255, 255, 0.62);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.md-title {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 22px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.md-sub {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		color: rgba(255, 255, 255, 0.78);
		font-size: 13px;
		font-weight: 700;
	}
	.md-estado {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		font-size: 12px;
	}
	.md-punto {
		width: 8px;
		height: 8px;
		border-radius: 999px;
	}
	.md-close {
		position: absolute;
		z-index: 3;
		top: 18px;
		right: 18px;
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
	.md-close:hover {
		background: rgba(255, 255, 255, 0.16);
	}
	.md-orb {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.05);
		pointer-events: none;
	}
	.md-orb-lg {
		width: 200px;
		height: 200px;
		right: -60px;
		top: -100px;
	}
	.md-orb-sm {
		width: 80px;
		height: 80px;
		left: -20px;
		bottom: -40px;
	}
	.md-tabs {
		position: relative;
		z-index: 2;
	}

	.md-body {
		flex: 1;
		min-height: min(260px, 40vh);
		overflow-y: auto;
		padding: 20px 22px;
		background: var(--bg-base);
	}
	.md-cargando {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 200px;
		color: var(--text-muted);
		font-size: 14px;
	}
	.md-spinner {
		width: 16px;
		height: 16px;
		border-radius: 999px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accion);
		animation: md-giro 0.7s linear infinite;
	}
	@keyframes md-giro {
		to {
			transform: rotate(360deg);
		}
	}

	.md-footer {
		flex-shrink: 0;
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 10px;
		padding: 14px 22px;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}

	/* Rejilla de datos: tarjetas blancas de etiqueta y valor sobre el fondo
	   claro, como las tarjetas de las pantallas de detalle de la app. */
	.md-body :global(.md-grid) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.md-body :global(.md-seccion) {
		margin: 18px 0 8px;
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.md-body :global(.md-seccion:first-child) {
		margin-top: 0;
	}

	@media (max-width: 640px) {
		.md-overlay {
			padding: 0;
			align-items: flex-end;
		}
		.md-card {
			max-height: 94vh;
			border-radius: 24px 24px 0 0;
		}
		.md-body :global(.md-grid) {
			grid-template-columns: minmax(0, 1fr);
		}
		.md-footer :global(button),
		.md-footer :global(a) {
			flex: 1;
		}
	}
</style>
