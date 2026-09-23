<!--
	Bloque con título dentro de una pantalla del portal.

	Dos tonos, y la diferencia es deliberada:

	  - `accion` (por defecto): lo que el conductor TIENE QUE HACER. Tarjetas
	    elevadas sobre el fondo, con sombra: piden que se toquen.
	  - `historial`: lo que YA hizo. Va sobre un fondo hundido, sin sombra y tras
	    una línea de separación, porque es registro, no tarea.

	Sin esa distinción «Por diligenciar» y «Últimos envíos» se leían igual, y el
	conductor tenía que ponerse a leer los títulos para saber si un renglón era
	trabajo pendiente o un acuse de algo ya entregado.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		titulo: string;
		tono?: 'accion' | 'historial';
		/** Dato corto a la derecha del título: un conteo, un período. */
		meta?: string | null;
		children: Snippet;
	}

	let { titulo, tono = 'accion', meta = null, children }: Props = $props();
</script>

<section class="ps ps--{tono}">
	<div class="ps__cabeza">
		<h2 class="ps__titulo">{titulo}</h2>
		{#if meta}<span class="ps__meta">{meta}</span>{/if}
	</div>
	<div class="ps__cuerpo">
		{@render children()}
	</div>
</section>

<style>
	.ps {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ps__cabeza {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.ps__titulo {
		margin: 0;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #6b6b6b);
	}

	.ps__meta {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	/* ── Historial ──────────────────────────────────────────────────────────
	   Separado del resto por una línea y hundido sobre el fondo. La franja
	   superior es lo que marca «a partir de aquí ya no hay nada que hacer». */
	.ps--historial {
		margin-top: 0.75rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
	}

	.ps--historial .ps__cuerpo {
		padding: 0.5rem;
		border-radius: 14px;
		background: var(--bg-sunken, rgba(0, 0, 0, 0.025));
	}

	/* Las filas de historial pierden la sombra y el borde de las tarjetas de
	   acción: sobre el fondo hundido ya se distinguen, y con sombra volvían a
	   parecer algo que hay que tocar. */
	.ps--historial .ps__cuerpo :global(.recibo) {
		background: transparent;
		border: none;
		border-radius: 8px;
		box-shadow: none;
	}

	.ps--historial .ps__cuerpo :global(.recibo + .recibo),
	.ps--historial .ps__cuerpo :global(li + li .recibo) {
		border-top: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.ps--historial .ps__cuerpo :global(a.recibo:active) {
		background: var(--bg-surface, #fff);
	}
</style>
