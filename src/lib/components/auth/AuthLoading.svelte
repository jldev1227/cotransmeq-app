<script lang="ts">
	/**
	 * Pantalla completa de espera: arranque del login, la raíz mientras decide
	 * adónde mandar, y el panel mientras hidrata la sesión.
	 *
	 * Es la misma pantalla que la app móvil pinta al verificar el acceso:
	 * mascota trabajando, barra de progreso y una línea de estado. Existe
	 * para que cada ruta no vuelva a inventar su propio loader.
	 */
	import { fade } from 'svelte/transition';
	import { mascota as mascotaDe, type MascotIntent } from '$lib/mascot';

	interface Props {
		/** Línea de estado bajo la barra. */
		texto: string;
		mascota?: MascotIntent;
	}

	let { texto, mascota = 'procesando' }: Props = $props();

	const imagen = $derived(mascotaDe(mascota));
</script>

<div class="loading" out:fade={{ duration: 250 }}>
	<div class="loading-inner" in:fade={{ duration: 400 }}>
		<img class="loading-mascot" src={imagen.src} alt={imagen.alt} width="418" height="418" />
		<img
			class="loading-logo"
			src="/assets/logo_nombre.webp"
			alt="Cotransmeq S.A.S"
			width="160"
			height="55"
		/>
		<div class="loading-track" aria-hidden="true">
			<span class="loading-fill"></span>
		</div>
		<p class="loading-text" role="status">{texto}</p>
	</div>
</div>

<style>
	.loading {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: var(--au-bg);
		color: var(--au-text);
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
	}

	.loading-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
	}

	.loading-mascot {
		width: 8.5rem;
		height: 8.5rem;
		object-fit: contain;
		animation: breathe 2.4s ease-in-out infinite;
	}

	.loading-logo {
		height: 44px;
		width: auto;
		display: block;
	}

	.loading-track {
		position: relative;
		width: 190px;
		height: 4px;
		border-radius: 999px;
		background: var(--au-tint);
		overflow: hidden;
	}
	.loading-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 40%;
		border-radius: 999px;
		background: var(--au-primary);
		animation: slide 1.15s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	.loading-text {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--au-muted);
	}

	@keyframes slide {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(360%);
		}
	}
	@keyframes breathe {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-5px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-mascot {
			animation: none;
		}
		/* Conserva un movimiento mínimo: pulso de opacidad en la barra. */
		.loading-fill {
			width: 100%;
			animation: pulse 1.6s ease-in-out infinite;
		}
		@keyframes pulse {
			0%,
			100% {
				opacity: 0.35;
			}
			50% {
				opacity: 1;
			}
		}
	}
</style>
