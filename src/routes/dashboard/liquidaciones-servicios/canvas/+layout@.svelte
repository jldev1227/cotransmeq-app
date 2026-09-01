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
