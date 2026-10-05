<script lang="ts">
	/**
	 * Estado de carga DENTRO del panel: la misma pantalla de espera de la app
	 * móvil (mascota trabajando, barra de progreso y una línea de estado) que
	 * `AuthLoading`, pero sin tapar cabecera ni menú: ocupa el hueco del
	 * contenido que está cargando.
	 *
	 * Dos tamaños: `pantalla` para páginas enteras (detalle de un servicio,
	 * redirecciones) y `bloque` para una tabla o una pestaña que carga dentro
	 * de una página que ya se ve. Sustituye a los spinners sueltos: así todas
	 * las esperas se ven igual que al entrar.
	 */
	import { mascota as mascotaDe, type MascotIntent } from '$lib/mascot';

	interface Props {
		/** Línea de estado bajo la barra, p. ej. «Cargando servicios…». */
		texto: string;
		tamano?: 'pantalla' | 'bloque';
		mascota?: MascotIntent;
	}

	let { texto, tamano = 'bloque', mascota = 'procesando' }: Props = $props();

	const imagen = $derived(mascotaDe(mascota));
</script>

<div class="carga carga--{tamano}" role="status" aria-live="polite">
	<img class="carga-mascota" src={imagen.src} alt={imagen.alt} width="418" height="418" />
	<div class="carga-barra" aria-hidden="true">
		<span class="carga-relleno"></span>
	</div>
	<p class="carga-texto">{texto}</p>
</div>

<style>
	.carga {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.9rem;
		padding: 2.5rem 1.5rem;
		color: var(--au-text, #014339);
		font-family: var(--font-sans);
		animation: carga-aparecer 0.35s ease-out;
	}
	/* Página entera: el alto de la ventana menos la cabecera. */
	.carga--pantalla {
		min-height: calc(100vh - 64px);
		gap: 1.25rem;
	}
	.carga--bloque {
		min-height: 14rem;
	}

	.carga-mascota {
		width: 8.5rem;
		height: 8.5rem;
		object-fit: contain;
		animation: carga-respirar 2.4s ease-in-out infinite;
	}
	.carga--bloque .carga-mascota {
		width: 5.5rem;
		height: 5.5rem;
	}

	.carga-barra {
		position: relative;
		width: 190px;
		height: 4px;
		border-radius: 999px;
		background: var(--au-tint, #ddf7ea);
		overflow: hidden;
	}
	.carga--bloque .carga-barra {
		width: 140px;
	}
	.carga-relleno {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 40%;
		border-radius: 999px;
		background: var(--au-primary, #079665);
		animation: carga-deslizar 1.15s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	.carga-texto {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--au-muted, #66756f);
	}
	.carga--bloque .carga-texto {
		font-size: 0.8rem;
	}

	@keyframes carga-aparecer {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes carga-deslizar {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(360%);
		}
	}
	@keyframes carga-respirar {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-5px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.carga-mascota {
			animation: none;
		}
		.carga-relleno {
			width: 100%;
			animation: carga-pulso 1.6s ease-in-out infinite;
		}
		@keyframes carga-pulso {
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
