<!--
	+layout@.svelte — layout reset para la page Univer de **nómina** (una hoja
	por conductor del periodo).

	El `@` no es decorativo: sin él, la página cuelga de
	`dashboard/+layout.svelte` y el canvas queda dentro de un
	`<main class="flex-1 overflow-y-auto">` cuya altura no se propaga, así que
	Univer se monta con 0 px de alto. Saltarse ese layout es lo que da el
	viewport completo. A cambio se pierde su guard de autenticación, y por eso
	`UniverAuthGuard` va aquí.
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

<UniverAuthGuard moduleId="nomina">
	<UniverShell>
		{@render children()}
	</UniverShell>
</UniverAuthGuard>
