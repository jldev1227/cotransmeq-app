<!--
	Cabecera de una pantalla del portal.

	Una sola forma para las cinco páginas: título a la izquierda, controles
	compactos a la derecha. Antes había cuatro convenciones distintas
	(`head__titulo`, `page-title`, `header-title`, y una con emoji), así que al
	cambiar de pestaña se movía el título de tamaño y de sitio.

	Lo que NO lleva es subtítulo largo. Un párrafo explicativo bajo el título
	empuja el contenido real fuera de la primera pantalla del teléfono, que es
	justo lo que el conductor viene a ver. Si hace falta un dato de contexto va en
	`meta`, en una línea corta.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		titulo: string;
		/** Línea corta de contexto: la fecha del día, el período, el conteo. */
		meta?: string | null;
		/** Controles compactos alineados a la derecha (chip de sync, refrescar). */
		acciones?: Snippet;
	}

	let { titulo, meta = null, acciones }: Props = $props();
</script>

<header class="ph">
	<div class="ph__texto">
		<h1 class="ph__titulo">{titulo}</h1>
		{#if meta}<p class="ph__meta">{meta}</p>{/if}
	</div>
	{#if acciones}
		<div class="ph__acciones">{@render acciones()}</div>
	{/if}
</header>

<style>
	.ph {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.ph__texto {
		min-width: 0;
	}

	.ph__titulo {
		margin: 0;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.15;
		color: var(--text-primary, #1a1a1a);
	}

	.ph__meta {
		margin: 0.1875rem 0 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	/* Los controles se alinean con la primera línea del título y pueden envolver:
	   en pantallas de 320 px el chip de sincronización solo no cabe al lado de un
	   título largo. */
	.ph__acciones {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
</style>
