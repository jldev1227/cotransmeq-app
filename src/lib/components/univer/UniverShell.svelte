<!--
	UniverShell — layout de pantalla completa para pages Univer.

	REGLA #1 (altura viewport):
	  El shell usa position:fixed; inset:0 + reset global de html/body/#svelte
	  para garantizar que el contenedor de Univer SIEMPRE tenga viewport-completo
	  disponible. Sin esto, cualquier `h-full` de la page hija colapsa a 0
	  dentro del <main class="flex-1 overflow-y-auto"> del dashboard.

	REGLA #3 (header altura fija):
	  El grid usa `--univer-header-h: 52px` para la fila del header. La toolbar
	  NO puede crecer más allá de esa altura — el contenido que pase se trunca.
	  Esto garantiza que el `flex: 1 1 auto` del canvas host siempre reciba el
	  espacio vertical restante del viewport.

	Uso:
	  <UniverShell>
	    {#snippet header()}
	      <UniverToolbar title="..." subtitle="..." onBack={...}>
	        {#snippet actions()}...{/snippet}
	      </UniverToolbar>
	    {/snippet}
	    <UniverCanvasHost bind:container ... />
	  </UniverShell>
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { univerShell } from '$lib/stores/univerShell';

	interface Props {
		header?: Snippet;
		children?: Snippet;
	}

	let { header, children }: Props = $props();

	// El shell se anuncia para que el `<Toaster>` del layout raíz baje los
	// avisos a la esquina inferior derecha. En un canvas, la superior está
	// ocupada por el toolbar y sus desplegables. Va aquí y no en cada
	// `+layout@.svelte` porque este componente lo monta todo canvas y solo un
	// canvas: uno nuevo queda cubierto sin acordarse de nada.
	//
	// El alta y la baja van las dos en `onMount` —la baja como su función de
	// limpieza— para que ninguna corra en el servidor: el store es de módulo
	// y allí lo compartirían todas las peticiones.
	onMount(() => {
		univerShell.entrar();
		return () => univerShell.salir();
	});
</script>

{#if header}
	<div class="univer-shell-header">
		{@render header()}
	</div>
{/if}
<div class="univer-shell-main">
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	/* Reset global: el shell controla el viewport entero.
	   Importante: NO usar overflow:hidden en html/body fuera del shell —
	   eso rompería el scroll normal del resto del dashboard. */
	:global(.univer-shell-active html),
	:global(.univer-shell-active body) {
		margin: 0 !important;
		padding: 0 !important;
		height: 100% !important;
		overflow: hidden !important;
		background: #fff !important;
	}
	:global(.univer-shell-active #svelte) {
		height: 100% !important;
		display: flex !important;
		flex-direction: column !important;
	}

	/* El shell mismo: viewport completo, flex column.
	   El header (si existe) tiene altura FIJA (--univer-header-h). El main
	   absorbe el resto con flex: 1 1 auto + min-height: 0. Como las pages
	   renderizan la toolbar dentro de children (no vía snippet header),
	   la cadena flex garantiza que el main SIEMPRE reciba la altura sobrante
	   con o sin header — un grid con template-rows rompería esto (el main
	   caería en la fila de 52px). */
	:global(.univer-shell-active) {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		background: #f8fafc;
		/* Altura de la barra superior, y ancho del carril lateral
		   (`UniverSideRail`). Es 56 y no 52 porque 56 es lo que MIDE el
		   toolbar con sus controles actuales (10px de padding arriba y abajo
		   más un control de 32px con bordes); el 52 de antes era nominal y no
		   lo aplicaba nadie, porque ninguna page monta el snippet `header` —
		   todas renderizan la toolbar dentro de `children`.

		   Ahora sí manda: `toolbar.css` la usa como MÍNIMO de la barra y el
		   carril como ancho, así que el canvas queda enmarcado con el mismo
		   grosor por arriba y por la derecha, y las cuatro canvas comparten
		   una sola cifra. */
		--univer-header-h: 56px;
	}

	.univer-shell-header {
		flex: 0 0 var(--univer-header-h, 52px);
		height: var(--univer-header-h, 52px);
		min-height: 0;
		overflow: hidden;
	}

	.univer-shell-main {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>