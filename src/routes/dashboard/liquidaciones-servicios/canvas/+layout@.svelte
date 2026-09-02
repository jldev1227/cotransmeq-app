<!--
	+layout@.svelte — layout reset para el canvas de HISTORIAL DE LIQUIDACIONES
	DE SERVICIOS.

	El `@` se salta `dashboard/+layout.svelte`, que monta su `<main>` sin cadena
	de altura: cualquier `h-full` hijo colapsa a 0px y el canvas de Univer se
	queda sin sitio donde dibujar. Es la Regla 1 de README_UNIVER_CANVAS.md, y
	la razón de que los cuatro canvas de terceros tengan un layout igual que
	este.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import UniverAuthGuard from '$lib/components/univer/UniverAuthGuard.svelte';
	import UniverShell from '$lib/components/univer/UniverShell.svelte';
	import '$lib/components/univer/toolbar.css';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	onMount(() => {
		document.documentElement.classList.add('univer-shell-active');
		document.body.classList.add('univer-shell-active');
	});

	onDestroy(() => {
		document.documentElement.classList.remove('univer-shell-active');
		document.body.classList.remove('univer-shell-active');
	});
</script>

<UniverAuthGuard moduleId="liquidaciones-servicios">
	<UniverShell>
		{@render children()}
	</UniverShell>
</UniverAuthGuard>

<style>
	/*
		Imprimir desde el canvas.

		`univer-shell-active` pone `html` y `body` en `position: fixed; inset: 0`
		para darle a Univer un viewport propio con altura conocida. En papel eso
		recorta el documento a la primera página: el editor de liquidaciones se
		abre encima del canvas en un overlay, y al pulsar «Imprimir / PDF» salía
		una hoja cortada con el lienzo de Univer de fondo.

		Se deshace solo al imprimir, y se ocultan las dos piezas que únicamente
		tienen sentido en pantalla. El overlay del editor no cae en la regla
		porque es hermano de `.hs-body`, no descendiente.
	*/
	@media print {
		:global(html.univer-shell-active),
		:global(body.univer-shell-active) {
			position: static !important;
			overflow: visible !important;
			height: auto !important;
			z-index: auto !important;
		}
		:global(.univer-toolbar),
		:global(.hs-body) {
			display: none !important;
		}
	}
</style>
