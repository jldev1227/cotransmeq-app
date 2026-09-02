<!--
	+layout@.svelte — layout reset para el canvas ANUAL de liquidaciones
	ocasionales.

	Misma justificación que en `canvas/+layout@.svelte`:
	saltarse `dashboard/+layout.svelte` para obtener un viewport completo
	sin sidebar/header, que es lo que impide que el canvas Univer tenga
	altura suficiente.
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

<UniverAuthGuard moduleId="liquidaciones-terceros">
	<UniverShell>
		{@render children()}
	</UniverShell>
</UniverAuthGuard>
