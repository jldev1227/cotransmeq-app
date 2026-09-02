<!--
	Cabecera común de las pantallas de formularios.

	Una sola pieza para las cinco rutas porque el problema que resolvía cada una
	por su cuenta era el mismo: decir DÓNDE estoy y CÓMO salgo. Antes cada
	pantalla se inventaba sus migas —o no las tenía—, y el título ocupaba tres
	bloques apilados (migas, título, subtítulo, acciones) que se comían media
	pantalla útil antes del primer dato.

	Aquí la ruta y la salida caben en una línea de 34 px, y el título comparte
	renglón con las acciones primarias. El código HSEQ va PEGADO al título, no en
	una línea propia: es parte de la identidad del formato («HSEQ-FR-08
	Preoperacional»), no un metadato suelto.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import MigasFormularios from './MigasFormularios.svelte';

	interface Miga {
		etiqueta: string;
		href?: string;
	}

	interface Props {
		titulo: string;
		/** Código documental (`HSEQ-FR-08`), si la pantalla trata de un formato. */
		codigo?: string | null;
		subtitulo?: string | null;
		/** Migas + volver. Sin ellas la cabecera es la de la raíz del módulo. */
		migas?: Miga[];
		volverA?: string;
		volverEtiqueta?: string;
		/** Acciones primarias, alineadas con el título. */
		acciones?: Snippet;
		/** Línea de metadatos monoespaciada bajo el título. */
		meta?: Snippet;
	}

	let {
		titulo,
		codigo = null,
		subtitulo = null,
		migas,
		volverA,
		volverEtiqueta,
		acciones,
		meta
	}: Props = $props();
</script>

<header class="cabecera">
	{#if migas && migas.length > 0 && volverA}
		<MigasFormularios {migas} {volverA} {volverEtiqueta} />
	{/if}

	<div class="cabecera__fila">
		<div class="cabecera__texto">
			<h1 class="cabecera__titulo">
				{#if codigo}<span class="cabecera__code">{codigo}</span>{/if}
				{titulo}
			</h1>
			{#if subtitulo}
				<p class="cabecera__sub">{subtitulo}</p>
			{/if}
			{#if meta}
				<p class="cabecera__meta">{@render meta()}</p>
			{/if}
		</div>

		{#if acciones}
			<div class="cabecera__acciones">{@render acciones()}</div>
		{/if}
	</div>
</header>

<style>
	.cabecera {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Título y acciones en el mismo renglón mientras quepan: en un portátil de
	   13" cada bloque apilado de más son 60 px menos de tabla. */
	.cabecera__fila {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.cabecera__texto {
		min-width: 0;
	}

	.cabecera__titulo {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.15;
		color: var(--text-primary, #1a1a1a);
	}

	.cabecera__code {
		padding: 0.125rem 0.4375rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--orange-800, #166534);
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		border-radius: 7px;
	}

	.cabecera__sub {
		margin-top: 0.25rem;
		max-width: 44rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-muted, #6b6b6b);
	}

	.cabecera__meta {
		margin-top: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.cabecera__acciones {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}
</style>
