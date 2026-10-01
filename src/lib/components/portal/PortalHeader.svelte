<!--
	Cabecera de una pantalla del portal: el «hero» de la app móvil.

	Bloque sobre el verde de marca con dos círculos decorativos, un eyebrow,
	el título grande, una línea de contexto y la mascota de la pantalla. Es la
	misma pieza para las cinco páginas, así que al cambiar de pestaña el título
	no se mueve de sitio ni de tamaño.

	`meta` es una sola línea corta (la fecha, el período, un saludo). Un
	párrafo largo empuja el contenido real fuera de la primera pantalla del
	teléfono, que es justo lo que el conductor viene a ver.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { mascota as mascotaDe, type MascotIntent } from '$lib/mascot';

	interface Props {
		titulo: string;
		/** Línea corta de contexto: la fecha del día, el período, el conteo. */
		meta?: string | null;
		/** Rótulo pequeño en mayúsculas sobre el título. */
		eyebrow?: string;
		/** Reacción de la mascota que acompaña a la pantalla. */
		mascota?: MascotIntent | null;
		/** Controles compactos arriba a la derecha (chip de sync, refrescar). */
		acciones?: Snippet;
	}

	let {
		titulo,
		meta = null,
		eyebrow = 'Portal del conductor',
		mascota = null,
		acciones
	}: Props = $props();

	const imagen = $derived(mascota ? mascotaDe(mascota) : null);
</script>

<header class="ph" class:ph--con-mascota={!!imagen}>
	<span class="ph__orbe ph__orbe--grande" aria-hidden="true"></span>
	<span class="ph__orbe ph__orbe--chico" aria-hidden="true"></span>
	<div class="ph__texto">
		<span class="ph__eyebrow">{eyebrow}</span>
		<h1 class="ph__titulo">{titulo}</h1>
		{#if meta}<p class="ph__meta">{meta}</p>{/if}
	</div>
	{#if acciones}
		<div class="ph__acciones">{@render acciones()}</div>
	{/if}
	{#if imagen}
		<img class="ph__mascota" src={imagen.src} alt="" aria-hidden="true" />
	{/if}
</header>

<style>
	.ph {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		min-height: 11.5rem;
		padding: 1.25rem;
		border-radius: 28px;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 70%);
		color: #fff;
		overflow: hidden;
		isolation: isolate;
	}
	.ph__orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		z-index: -1;
	}
	.ph__orbe--grande {
		width: 180px;
		height: 180px;
		right: -55px;
		top: -70px;
	}
	.ph__orbe--chico {
		width: 80px;
		height: 80px;
		left: -24px;
		bottom: -34px;
	}
	.ph__texto {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.ph--con-mascota .ph__texto {
		max-width: calc(100% - 7.6rem);
	}
	@media (min-width: 768px) {
		.ph--con-mascota .ph__texto {
			max-width: 68%;
		}
	}
	.ph__eyebrow {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.ph__titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.75rem;
		font-weight: 900;
		letter-spacing: -0.03em;
		line-height: 1.12;
		color: #fff;
	}
	.ph__meta {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--au-hero-text, #d4f3e5);
	}
	.ph__mascota {
		position: absolute;
		right: -0.45rem;
		bottom: -0.45rem;
		width: 8.6rem;
		height: 8.6rem;
		object-fit: contain;
		pointer-events: none;
		z-index: 1;
		filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.25));
	}
	/* Los controles van arriba a la derecha, como el botón del hero de la app,
	   y pueden envolver en pantallas de 320 px. */
	.ph__acciones {
		position: absolute;
		top: 0.9rem;
		right: 0.9rem;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 0.375rem;
	}
	/* Sobre el verde, los botones de las páginas (refrescar, chip de sync)
	   pasan a translúcidos, sea cual sea su estilo propio. */
	.ph__acciones :global(button) {
		background: rgba(255, 255, 255, 0.13) !important;
		border: 1px solid rgba(255, 255, 255, 0.18) !important;
		color: #fff !important;
		box-shadow: none !important;
		border-radius: 999px !important;
	}
	.ph__acciones :global(button:hover:not(:disabled)) {
		background: rgba(255, 255, 255, 0.22) !important;
	}
	@media (min-width: 768px) {
		.ph {
			min-height: 12.5rem;
			padding: 1.5rem 1.6rem;
		}
		.ph__titulo {
			font-size: 2rem;
		}
		.ph__mascota {
			right: 0.5rem;
			bottom: -0.5rem;
			width: 10.5rem;
			height: 10.5rem;
		}
	}
</style>
