<!--
	Bloque con título dentro de una pantalla del portal.

	La cabeza es la `SectionHeader` de la app móvil: título en negrita y un
	dato corto a la derecha. Dos tonos, y la diferencia es deliberada:

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
		gap: 0.6rem;
	}

	.ps__cabeza {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0 0.125rem;
	}

	.ps__titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.2;
		color: var(--text-primary, #17201d);
	}

	.ps__meta {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted, #66756f);
		white-space: nowrap;
	}

	/* ── Historial ──────────────────────────────────────────────────────────
	   Separado del resto por una línea y hundido sobre el fondo. La franja
	   superior es lo que marca «a partir de aquí ya no hay nada que hacer». */
	.ps--historial {
		margin-top: 0.75rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-default, #dee7e3);
	}

	.ps--historial .ps__titulo {
		font-size: 1rem;
		color: var(--text-muted, #66756f);
	}

	.ps--historial .ps__cuerpo {
		padding: 0.5rem;
		border-radius: 16px;
		background: rgba(1, 67, 57, 0.04);
	}

	/* Las filas de historial pierden la sombra y el borde de las tarjetas de
	   acción: sobre el fondo hundido ya se distinguen, y con sombra volvían a
	   parecer algo que hay que tocar. */
	.ps--historial .ps__cuerpo :global(.recibo) {
		background: transparent;
		border: none;
		border-radius: 10px;
		box-shadow: none;
	}

	.ps--historial .ps__cuerpo :global(.recibo + .recibo),
	.ps--historial .ps__cuerpo :global(li + li .recibo) {
		border-top: 1px solid var(--border-subtle, #edf3f0);
	}

	.ps--historial .ps__cuerpo :global(a.recibo:active) {
		background: var(--bg-surface, #fff);
	}
</style>
