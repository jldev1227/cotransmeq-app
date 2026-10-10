<script lang="ts" module>
	export interface TabEntidad {
		id: string;
		label: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { X } from 'lucide-svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { confirmar } from '$lib/stores/confirm';
	import { formularioAbierto } from '$lib/stores/formularioAbierto';

	/**
	 * Cascarón común de los formularios de directorio (vehículo, conductor,
	 * cliente): el mismo modal para crear y para editar, con pestañas según lo
	 * que la entidad necesite.
	 *
	 * Antes cada directorio lo resolvía distinto —flota con modal, conductores
	 * y clientes con una página `/agregar` y edición en línea en el detalle—,
	 * así que el mismo gesto se aprendía tres veces. Aquí vive todo lo que no
	 * depende de la entidad: encabezado de la marca, pestañas con el conteo de
	 * errores, pie con las acciones, Escape/fondo y el aviso de cambios sin
	 * guardar. Cada formulario solo pone sus campos y su validación.
	 */
	interface Props {
		open: boolean;
		/** Texto pequeño sobre el título: «NUEVO CONDUCTOR», «EDITAR CLIENTE». */
		eyebrow: string;
		title: string;
		subtitle?: string;
		tabs: TabEntidad[];
		tabActiva: string;
		/** Errores por pestaña: la pestaña se marca y se cuenta. */
		erroresPorTab?: Record<string, number>;
		guardando?: boolean;
		cargando?: boolean;
		textoGuardar?: string;
		/** Si hay cambios, cerrar pide confirmación. */
		sucio?: boolean;
		onguardar: () => void;
		oncerrar: () => void;
		children: Snippet<[string]>;
	}

	let {
		open,
		eyebrow,
		title,
		subtitle,
		tabs,
		tabActiva = $bindable(),
		erroresPorTab = {},
		guardando = false,
		cargando = false,
		textoGuardar = 'Guardar',
		sucio = false,
		onguardar,
		oncerrar,
		children
	}: Props = $props();

	/// Avisa a `ToastProvider` para que los toasts no tapen el pie del modal.
	$effect(() => {
		if (!open) return;
		formularioAbierto.entrar();
		return () => formularioAbierto.salir();
	});

	const tituloId = `de-titulo-${Math.random().toString(36).slice(2, 8)}`;

	async function cerrar() {
		if (guardando) return;
		if (
			sucio &&
			!(await confirmar({
				tone: 'warning',
				title: '¿Descartar los cambios?',
				message: 'Lo que escribiste en este formulario no se ha guardado.',
				confirmText: 'Descartar',
				cancelText: 'Seguir editando'
			}))
		) {
			return;
		}
		oncerrar();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open || e.key !== 'Escape') return;
		/// Si hay un diálogo de confirmación encima, Escape es suyo.
		if (document.querySelector('[role="alertdialog"]')) return;
		e.preventDefault();
		void cerrar();
	}

	function enviar(e: SubmitEvent) {
		e.preventDefault();
		if (!guardando && !cargando) onguardar();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="de-overlay" transition:fade={{ duration: 160 }}>
		<button type="button" class="de-backdrop" aria-label="Cerrar" tabindex="-1" onclick={cerrar}
		></button>
		<div
			class="de-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby={tituloId}
			tabindex="-1"
			transition:fly={{ y: 18, duration: 320, easing: quintOut }}
		>
			<form class="de-form" novalidate onsubmit={enviar}>
				<header class="de-hero">
					<span class="de-orb de-orb-lg"></span>
					<span class="de-orb de-orb-sm"></span>
					<div class="de-hero-copy">
						<p class="de-eyebrow">{eyebrow}</p>
						<h2 class="de-title" id={tituloId}>{title}</h2>
						{#if subtitle}<p class="de-subtitle">{subtitle}</p>{/if}
					</div>
					<button
						type="button"
						class="de-close"
						aria-label="Cerrar"
						onclick={cerrar}
						disabled={guardando}
					>
						<X size={16} strokeWidth={2.5} />
					</button>

					{#if tabs.length > 1}
						<div class="de-tabs">
							<TabsVista
								variante="oscuro"
								etiqueta="Secciones del formulario"
								tabs={tabs.map((t) => ({ ...t, errores: erroresPorTab[t.id] ?? 0 }))}
								bind:activa={tabActiva}
							/>
						</div>
					{/if}
				</header>

				<div class="de-body" role="tabpanel">
					{#if cargando}
						<CargaMascota texto="Cargando…" />
					{:else}
						{@render children(tabActiva)}
					{/if}
				</div>

				<footer class="de-footer">
					<button type="button" class="de-btn de-btn-cancel" onclick={cerrar} disabled={guardando}>
						Cancelar
					</button>
					<button type="submit" class="de-btn" disabled={guardando || cargando}>
						{#if guardando}<span class="de-spinner" aria-hidden="true"
							></span>Guardando…{:else}{textoGuardar}{/if}
					</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

<style>
	.de-overlay {
		position: fixed;
		inset: 0;
		/* Bajo los diálogos de confirmación (10050), que se abren encima. */
		z-index: 10040;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Abajo queda sitio para los toasts (abajo al centro): un aviso de
		   validación no debe tapar Cancelar/Guardar. */
		padding: 24px 16px 104px;
	}
	.de-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(4, 31, 26, 0.6);
		backdrop-filter: blur(4px);
	}
	.de-card {
		position: relative;
		width: 100%;
		max-width: 720px;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 24px;
		background: var(--bg-surface);
		box-shadow: 0 16px 48px rgba(0, 29, 23, 0.28);
	}

	.de-form {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.de-card:focus {
		outline: none;
	}

	.de-hero {
		position: relative;
		flex-shrink: 0;
		padding: 22px 22px 0;
		overflow: hidden;
		background: var(--bg-charcoal-deep);
	}
	.de-hero-copy {
		position: relative;
		z-index: 2;
		padding-right: 44px;
		padding-bottom: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.de-eyebrow {
		margin: 0;
		color: rgba(255, 255, 255, 0.62);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.de-title {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 22px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.de-subtitle {
		margin: 0;
		color: rgba(255, 255, 255, 0.72);
		font-size: 13px;
	}
	.de-close {
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
	.de-close:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
	}
	.de-orb {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.05);
		pointer-events: none;
	}
	.de-orb-lg {
		width: 200px;
		height: 200px;
		right: -60px;
		top: -100px;
	}
	.de-orb-sm {
		width: 80px;
		height: 80px;
		left: -20px;
		bottom: -40px;
	}

	.de-tabs {
		position: relative;
		z-index: 2;
	}

	.de-body {
		flex: 1;
		/* Alto estable entre pestañas: sin esto el modal saltaba al pasar de
		   una pestaña larga a una corta. */
		min-height: min(340px, 50vh);
		overflow-y: auto;
		padding: 22px;
	}

	.de-footer {
		flex-shrink: 0;
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 22px;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-base);
	}
	/* Mismos botones que `.btn-primary` / `.btn-secondary` de app.css, que a
	   su vez copian los de la app móvil. */
	.de-btn {
		min-height: 44px;
		min-width: 120px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0 18px;
		border: 0;
		border-radius: 16px;
		background: var(--accion);
		color: #fff;
		font-size: 14px;
		font-weight: 800;
		box-shadow: var(--shadow-btn);
		cursor: pointer;
	}
	.de-btn:hover:not(:disabled) {
		background: var(--accion-hover);
		box-shadow: var(--shadow-btn-hover);
	}
	.de-btn:active:not(:disabled) {
		transform: scale(0.985);
	}
	.de-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.de-btn-cancel,
	.de-btn-cancel:hover:not(:disabled) {
		background: var(--bg-surface);
		color: var(--bg-charcoal-deep);
		border: 1.5px solid var(--border-default);
		box-shadow: none;
	}
	.de-btn-cancel:hover:not(:disabled) {
		background: var(--bg-base);
		border-color: var(--border-emphasis);
	}
	.de-spinner {
		width: 16px;
		height: 16px;
		border-radius: 999px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		animation: de-giro 0.7s linear infinite;
	}
	@keyframes de-giro {
		to {
			transform: rotate(360deg);
		}
	}

	/* Rejilla y controles que comparten los tres formularios. */
	.de-body :global(.de-grid) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.de-body :global(.de-full) {
		grid-column: 1 / -1;
	}
	.de-body :global(.de-input) {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.de-body :global(.de-input::placeholder) {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.de-body :global(textarea.de-input) {
		resize: vertical;
	}
	.de-body :global(.de-input:focus) {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.de-body :global(.de-input[aria-invalid='true']) {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.de-body :global(.de-input:disabled) {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	@media (max-width: 640px) {
		.de-overlay {
			padding: 0;
			align-items: flex-end;
		}
		.de-card {
			max-height: 94vh;
			border-radius: 24px 24px 0 0;
		}
		.de-body :global(.de-grid) {
			grid-template-columns: minmax(0, 1fr);
		}
		.de-footer .de-btn {
			flex: 1;
		}
	}
</style>
