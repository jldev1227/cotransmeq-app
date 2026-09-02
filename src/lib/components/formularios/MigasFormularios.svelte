<!--
	Migas y botón de volver de las rutas de formularios.

	Existe porque estas pantallas se abren EN FRÍO más a menudo de lo que parece:
	se pegan URLs en el chat de HSEQ («mira la v3 del FR-08»), se abren en pestaña
	nueva desde el catálogo y se guardan en marcadores. En todos esos casos no hay
	historial propio, y un `history.back()` a secas deja al usuario en la pantalla
	anterior del navegador —o en nada— en vez de en el padre lógico de la ruta.

	Por eso el volver es SIEMPRE un enlace real al padre (`volverA`): funciona con
	clic central, con ⌘+clic y sin JavaScript. El `history.back()` solo se usa como
	mejora cuando la navegación que trajo aquí fue interna, para devolver al sitio
	exacto del que se venía —con su scroll y sus filtros— en vez de recargar el
	padre desde cero.
-->
<script lang="ts">
	import { afterNavigate } from '$app/navigation';

	/** Un tramo de la ruta. Sin `href` es el tramo actual, que no se enlaza. */
	interface Miga {
		etiqueta: string;
		href?: string;
	}

	interface Props {
		/** Tramos desde la raíz del módulo hasta la pantalla actual. */
		migas: Miga[];
		/** Padre lógico de la ruta. Es el destino real del enlace de volver. */
		volverA: string;
		/** Texto accesible del volver; se muestra junto a la flecha. */
		volverEtiqueta?: string;
	}

	let { migas, volverA, volverEtiqueta = 'Volver' }: Props = $props();

	/// `afterNavigate` dispara también en el montaje con la navegación que trajo
	/// aquí: `enter` es carga en frío (URL pegada, pestaña nueva, F5) y cualquier
	/// otro tipo —`link`, `goto`, `popstate`— significa que hay una entrada propia
	/// a la que volver.
	let hayHistorial = $state(false);
	afterNavigate((nav) => {
		hayHistorial = nav.type !== 'enter';
	});

	function alVolver(evento: MouseEvent) {
		/// Los modificadores mandan: ⌘/ctrl/shift o botón central abren el padre en
		/// otra pestaña, y ahí el href tiene que ganar.
		if (
			evento.defaultPrevented ||
			evento.button !== 0 ||
			evento.metaKey ||
			evento.ctrlKey ||
			evento.shiftKey ||
			evento.altKey
		)
			return;
		if (!hayHistorial) return;
		evento.preventDefault();
		history.back();
	}
</script>

<div class="migas">
	<a class="migas__volver" href={volverA} onclick={alVolver}>
		<span class="migas__flecha" aria-hidden="true">←</span>
		{volverEtiqueta}
	</a>

	<nav class="migas__ruta" aria-label="Ruta de navegación">
		<ol class="migas__lista">
			{#each migas as miga, i (miga.etiqueta + i)}
				<li class="migas__item">
					{#if i > 0}<span class="migas__sep" aria-hidden="true">/</span>{/if}
					{#if miga.href}
						<a class="migas__enlace" href={miga.href}>{miga.etiqueta}</a>
					{:else}
						<span class="migas__actual" aria-current="page">{miga.etiqueta}</span>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
</div>

<style>
	.migas {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
		min-height: 34px;
	}

	/* El volver es el objetivo principal de esta barra: se lee como botón, no
	   como una miga más, porque es la salida de la pantalla. */
	.migas__volver {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		min-height: 34px;
		padding: 0 0.625rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--orange-700, #c2410c);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
		text-decoration: none;
		white-space: nowrap;
	}

	.migas__volver:hover {
		border-color: var(--orange-600, #ea580c);
		background: #f0fdf4;
	}

	.migas__volver:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: 2px;
	}

	.migas__flecha {
		font-size: 0.9375rem;
		line-height: 1;
	}

	.migas__ruta {
		min-width: 0;
	}

	.migas__lista {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.migas__item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.migas__sep {
		color: var(--text-very-muted, #9a9a9a);
	}

	.migas__enlace {
		color: var(--text-muted, #6b6b6b);
		text-decoration: none;
	}

	.migas__enlace:hover {
		color: var(--orange-700, #c2410c);
		text-decoration: underline;
	}

	.migas__actual {
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}
</style>
