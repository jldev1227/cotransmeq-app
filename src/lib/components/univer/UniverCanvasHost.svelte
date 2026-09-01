<!--
	UniverCanvasHost — dueño único del contenedor del canvas Univer.

	REGLA CRÍTICA #2 (height chain):
	  Univer inyecta su propio árbol de divs (.univer-workbench,
	  [data-u-comp='workbench-layout'], canvas, etc.). Cada nivel debe tener
	  `height:100% !important` o el canvas mide 0 aunque el host tenga
	  altura correcta. Esos selectores viven aquí y SOLO aquí.

	REGLA CRÍTICA #3 (container always mounted):
	  El host nunca se desmonta. Loading y error son overlays absolutos
	  sobre el host, nunca lo reemplazan. Esto evita la carrera entre el
	  `{#if loading}{:else}` y el `bind:this` del container — el engine
	  SIEMPRE tiene un DOM node al que atarse en `onMount`.

	Uso:
	  <UniverCanvasHost bind:container loading={loading} error={loadError}>
	    <button onclick={refetch}>Reintentar</button>
	  </UniverCanvasHost>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		container: HTMLDivElement | null;
		loading?: boolean;
		error?: string;
		onRetry?: () => void;
		loadingLabel?: string;
		errorLabel?: string;
		loadingSnippet?: Snippet;
		errorSnippet?: Snippet;
	}

	let {
		container = $bindable(),
		loading = false,
		error = '',
		onRetry,
		loadingLabel = 'Cargando…',
		errorLabel,
		loadingSnippet,
		errorSnippet
	}: Props = $props();
</script>

<div class="univer-host" bind:this={container}>
	{#if loading}
		<div class="univer-overlay univer-overlay-loading">
			{#if loadingSnippet}
				{@render loadingSnippet()}
			{:else}
				<div class="univer-spinner-lg"></div>
				<span>{loadingLabel}</span>
			{/if}
		</div>
	{:else if error}
		<div class="univer-overlay univer-overlay-error">
			{#if errorSnippet}
				{@render errorSnippet()}
			{:else}
				<p>❌ {error}</p>
				{#if onRetry}
					<button class="univer-btn univer-btn-retry" onclick={onRetry}>
						{errorLabel ?? 'Reintentar'}
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ─── Host: el ÚNICO div al que Univer se ata ──────────────────── */
	.univer-host {
		flex: 1 1 auto;
		min-height: 0;
		position: relative;
		width: 100%;
		overflow: hidden;
		background: #fff;
	}

	/* ─── REGLA #2: cadena de altura Univer ──────────────────────────
	   `> div:first-child` y NO `> div` a secas. Univer cuelga del host TRES
	   hijos directos, y solo el primero es el workbench:

	     [0] el workbench — el que necesita la cadena de altura.
	     [1] la raíz de PORTALES (menús, tooltips, popups de Univer).
	     [2] `#univer-doc-selection-container-…`, la capa de selección del
	         editor de celda, que Univer coloca con `position: fixed` y un
	         `left/top` calculados, SIN tamaño: se dimensiona sola con su
	         contenido.

	   A los dos últimos, `width/height: 100% !important` les hacía un daño
	   distinto y nada evidente:

	   · En el contenedor del editor, que es `fixed`, el 100% se resuelve
	     contra el VIEWPORT. Al editar una celda quedaba un rectángulo
	     invisible de pantalla completa, anclado en la celda y con
	     `z-index: 1000`, tapando todo lo que hubiera a su derecha y por
	     debajo. Doble clic para editar y las celdas de la derecha dejaban de
	     responder al clic — arriba, abajo y a la izquierda sí, porque quedan
	     fuera del rectángulo. Se cerraba al pulsar Escape y por eso parecía
	     intermitente.

	   · En la raíz de portales, que es estática, los 100% la convertían en un
	     bloque del tamaño del host y la empujaban ENTERA por debajo del
	     borde inferior, así que los popups propios de Univer nacían fuera de
	     la pantalla.

	   El `:first-child` no cambia nada para el workbench: la regla de abajo
	   ya lo cubría con la misma declaración. */
	:global(.univer-host > div:first-child),
	:global(.univer-host .univer-container),
	:global(.univer-host .univer-workbench),
	:global(.univer-host .univer-editor-container),
	:global(.univer-host [data-u-comp='workbench-layout']) {
		height: 100% !important;
		width: 100% !important;
		display: flex !important;
		flex-direction: column !important;
	}
	:global(.univer-host canvas) {
		height: 100% !important;
	}

	/* ─── Overlays (loading / error): absolutos sobre el host ─────── */
	.univer-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		z-index: 5;
		font-size: 13px;
		font-weight: 500;
		pointer-events: auto;
	}
	.univer-overlay-loading {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(4px);
		color: #374151;
	}
	.univer-overlay-error {
		background: rgba(254, 242, 242, 0.95);
		backdrop-filter: blur(4px);
		color: #b91c1c;
	}
	.univer-spinner-lg {
		width: 36px;
		height: 36px;
		border: 3px solid rgba(16, 185, 129, 0.2);
		border-top-color: #10b981;
		border-radius: 50%;
		animation: univer-spin-lg 0.7s linear infinite;
	}
	@keyframes univer-spin-lg {
		to {
			transform: rotate(360deg);
		}
	}
	.univer-btn-retry {
		padding: 8px 16px;
		background: #dc2626;
		color: white;
		border-radius: 8px;
		border: none;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
</style>