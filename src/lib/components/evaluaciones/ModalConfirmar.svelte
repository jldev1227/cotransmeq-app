<script lang="ts">
	/**
	 * Confirmación de una acción que no se deshace.
	 *
	 * Sustituye al `confirm()` del navegador en las pantallas de evaluaciones:
	 * el diálogo nativo no se puede vestir, no sigue la paleta y en móvil tapa
	 * la pantalla con un cuadro del sistema. Este sigue la estructura
	 * `.fixed.inset-0.flex.items-center.justify-center > [role=dialog]`, así
	 * que en pantallas estrechas se convierte solo en hoja inferior.
	 */
	import { fade, scale } from 'svelte/transition';

	interface Props {
		titulo: string;
		mensaje: string;
		/** Texto del botón que confirma. */
		confirmar?: string;
		cancelar?: string;
		/** Rojo: borrar, descartar. Sin él, el botón va en el primario. */
		peligrosa?: boolean;
		procesando?: boolean;
		onConfirmar: () => void;
		onCancelar: () => void;
	}

	let {
		titulo,
		mensaje,
		confirmar = 'Eliminar',
		cancelar = 'Cancelar',
		peligrosa = true,
		procesando = false,
		onConfirmar,
		onCancelar
	}: Props = $props();

	function teclado(e: KeyboardEvent) {
		if (e.key === 'Escape' && !procesando) onCancelar();
	}
</script>

<svelte:window onkeydown={teclado} />

<button
	type="button"
	class="mc-tapa fixed inset-0 z-[100]"
	aria-label="Cerrar"
	onclick={() => !procesando && onCancelar()}
	transition:fade={{ duration: 150 }}
></button>

<div class="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center p-4">
	<div
		class="mc pointer-events-auto"
		role="dialog"
		aria-modal="true"
		aria-labelledby="mc-titulo"
		in:scale={{ duration: 200, start: 0.96 }}
	>
		<span class="mc-icono" class:mc-icono--peligro={peligrosa} aria-hidden="true">
			{#if peligrosa}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			{/if}
		</span>
		<h3 id="mc-titulo" class="mc-titulo">{titulo}</h3>
		<p class="mc-mensaje">{mensaje}</p>
		<div class="mc-acciones">
			<button type="button" class="btn-secondary" onclick={onCancelar} disabled={procesando}>
				{cancelar}
			</button>
			<button
				type="button"
				class="mc-confirmar"
				class:mc-confirmar--peligro={peligrosa}
				class:btn-primary={!peligrosa}
				onclick={onConfirmar}
				disabled={procesando}
			>
				{procesando ? 'Un momento…' : confirmar}
			</button>
		</div>
	</div>
</div>

<style>
	.mc-tapa {
		border: 0;
		padding: 0;
		cursor: default;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.4), rgba(20, 83, 45, 0.55));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
	}
	.mc {
		width: 100%;
		max-width: 26rem;
		padding: 1.5rem 1.5rem 1.25rem;
		background: #fff;
		border-radius: 22px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.mc-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 14px;
		background: var(--au-tint);
		color: var(--au-primary);
		margin-bottom: 0.35rem;
	}
	.mc-icono--peligro {
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}
	.mc-icono svg {
		width: 1.35rem;
		height: 1.35rem;
	}
	.mc-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--au-text);
	}
	.mc-mensaje {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--au-muted);
	}
	.mc-acciones {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.9rem;
	}
	.mc-confirmar--peligro {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1.25rem;
		border: none;
		border-radius: 14px;
		background: var(--au-danger);
		color: #fff;
		font-family: var(--font-sans);
		font-size: 0.875rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 0.15s ease;
	}
	.mc-confirmar--peligro:hover:not(:disabled) {
		filter: brightness(0.92);
	}
	.mc-confirmar:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	@media (max-width: 639.98px) {
		.mc-acciones {
			flex-direction: column-reverse;
		}
		.mc-acciones :global(button) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
