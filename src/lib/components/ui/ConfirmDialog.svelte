<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { mascota, type MascotIntent } from '$lib/mascot';
	import type { ConfirmTone } from '$lib/stores/confirm';

	/**
	 * Tarjeta de confirmación de la app móvil (`context/app-alert.tsx`):
	 * encabezado verde bosque con la mascota asomada, mensaje y acciones
	 * abajo. Es solo presentación; la usan `ConfirmHost` (para `confirmar()`)
	 * y los modales de eliminar/restaurar que necesitan contenido propio.
	 */
	interface Props {
		open: boolean;
		title: string;
		message?: string;
		tone?: ConfirmTone;
		eyebrow?: string;
		mascot?: MascotIntent;
		confirmText?: string;
		/** `null` oculta el botón de cancelar. */
		cancelText?: string | null;
		loading?: boolean;
		loadingText?: string;
		confirmDisabled?: boolean;
		/** `false`: un clic en el fondo no cancela (operaciones de peso). */
		closeOnBackdrop?: boolean;
		onconfirm?: () => void;
		oncancel?: () => void;
		children?: Snippet;
	}

	let {
		open,
		title,
		message = '',
		tone = 'info',
		eyebrow,
		mascot,
		confirmText = 'Confirmar',
		cancelText = 'Cancelar',
		loading = false,
		loadingText,
		confirmDisabled = false,
		closeOnBackdrop = true,
		onconfirm,
		oncancel,
		children
	}: Props = $props();

	/// Mismo acento claro que el eyebrow de las alertas de la app.
	const ACENTO = '#FDBA74';

	const TONO: Record<ConfirmTone, { eyebrow: string; mascot: MascotIntent }> = {
		info: { eyebrow: 'INFORMACIÓN', mascot: 'ayuda' },
		success: { eyebrow: 'TODO LISTO', mascot: 'exito' },
		warning: { eyebrow: 'ATENCIÓN', mascot: 'advertencia' },
		danger: { eyebrow: 'CONFIRMA ESTA ACCIÓN', mascot: 'advertencia' }
	};

	const imagen = $derived(mascota(mascot ?? TONO[tone].mascot));
	const tituloId = `confirm-titulo-${Math.random().toString(36).slice(2, 8)}`;
	let botonConfirmar = $state<HTMLButtonElement | null>(null);

	/// El foco va al botón principal al abrir, como en un diálogo nativo:
	/// Enter confirma y Escape cancela sin tocar el mouse.
	$effect(() => {
		if (open && botonConfirmar) botonConfirmar.focus();
	});

	function cancelar() {
		if (loading) return;
		oncancel?.();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelar();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="cd-overlay" transition:fade={{ duration: 160 }}>
		<button
			type="button"
			class="cd-backdrop"
			aria-label="Cerrar"
			tabindex={closeOnBackdrop ? 0 : -1}
			onclick={() => closeOnBackdrop && cancelar()}
		></button>
		<div
			class="cd-card"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby={tituloId}
			transition:fly={{ y: 18, duration: 320, easing: quintOut }}
		>
			<div class="cd-hero">
				<span class="cd-orb cd-orb-lg"></span>
				<span class="cd-orb cd-orb-sm"></span>
				<div class="cd-hero-copy">
					<p class="cd-eyebrow" style="color: {ACENTO}">{eyebrow ?? TONO[tone].eyebrow}</p>
					<h2 class="cd-title" id={tituloId}>{title}</h2>
				</div>
				<img class="cd-mascot" src={imagen.src} alt={imagen.alt} width="140" height="140" />
			</div>

			<div class="cd-body">
				{#if message}<p class="cd-message">{message}</p>{/if}
				{@render children?.()}
				<div class="cd-actions">
					{#if cancelText !== null}
						<button
							type="button"
							class="cd-btn cd-btn-cancel"
							onclick={cancelar}
							disabled={loading}
						>
							{cancelText}
						</button>
					{/if}
					<button
						type="button"
						bind:this={botonConfirmar}
						class="cd-btn"
						class:cd-btn-danger={tone === 'danger'}
						onclick={() => onconfirm?.()}
						disabled={loading || confirmDisabled}
					>
						{#if loading}<span class="cd-spinner" aria-hidden="true"></span>{/if}
						{loading ? (loadingText ?? confirmText) : confirmText}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.cd-overlay {
		position: fixed;
		inset: 0;
		/* Por encima de los canvas de Univer (`.univer-shell-active`, 9999) y
		   de sus modales (hasta 9980): una confirmación pedida desde ellos
		   quedaba tapada. */
		z-index: 10050;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 36px 16px;
	}
	.cd-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		cursor: default;
		background: rgba(4, 31, 26, 0.72);
		backdrop-filter: blur(4px);
	}
	.cd-card {
		position: relative;
		width: 100%;
		max-width: 430px;
		max-height: 100%;
		overflow: auto;
		border-radius: 28px;
		background: #fff;
		box-shadow: 0 16px 48px rgba(0, 29, 23, 0.28);
	}
	.cd-hero {
		position: relative;
		min-height: 164px;
		padding: 22px;
		overflow: hidden;
		background: var(--bg-charcoal-deep);
	}
	.cd-hero-copy {
		position: relative;
		z-index: 2;
		width: 64%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cd-eyebrow {
		margin: 0;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.cd-title {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 25px;
		line-height: 30px;
		font-weight: 900;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.cd-mascot {
		position: absolute;
		z-index: 2;
		right: -1px;
		bottom: -8px;
		width: 140px;
		height: 140px;
		object-fit: contain;
		pointer-events: none;
	}
	.cd-orb {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
	}
	.cd-orb-lg {
		width: 180px;
		height: 180px;
		right: -55px;
		top: -80px;
	}
	.cd-orb-sm {
		width: 75px;
		height: 75px;
		left: -18px;
		bottom: -28px;
	}
	.cd-body {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 20px;
	}
	.cd-message {
		margin: 0;
		color: var(--text-muted);
		font-size: 14px;
		line-height: 21px;
		white-space: pre-line;
	}
	.cd-actions {
		display: flex;
		gap: 10px;
	}
	.cd-btn {
		flex: 1;
		min-height: 48px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0 14px;
		border: 0;
		border-radius: 16px;
		background: var(--accion);
		color: #fff;
		font-size: 15px;
		font-weight: 900;
		cursor: pointer;
		transition:
			opacity 0.15s,
			transform 0.15s;
	}
	.cd-btn:hover:not(:disabled) {
		background: var(--accion-hover);
	}
	.cd-btn:active:not(:disabled) {
		transform: scale(0.985);
	}
	.cd-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.cd-btn:focus-visible {
		outline: 3px solid color-mix(in srgb, var(--accion) 35%, transparent);
		outline-offset: 2px;
	}
	.cd-btn-danger {
		background: #b42318;
	}
	.cd-btn-danger:hover:not(:disabled) {
		background: #912018;
	}
	.cd-btn-cancel,
	.cd-btn-cancel:hover:not(:disabled) {
		background: #fff;
		color: var(--bg-charcoal-deep);
		border: 1.5px solid var(--border-default);
	}
	.cd-btn-cancel:hover:not(:disabled) {
		background: var(--bg-base);
	}
	.cd-spinner {
		width: 16px;
		height: 16px;
		border-radius: 999px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		animation: cd-giro 0.7s linear infinite;
	}
	@keyframes cd-giro {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 420px) {
		.cd-title {
			font-size: 21px;
			line-height: 26px;
		}
		.cd-mascot {
			width: 116px;
			height: 116px;
		}
		.cd-actions {
			flex-direction: column-reverse;
		}
	}
</style>
