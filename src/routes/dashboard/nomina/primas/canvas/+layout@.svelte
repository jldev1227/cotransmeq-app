<!--
	+layout@.svelte — layout reset para el canvas de **primas de nómina**.

	Aquí NO se monta ningún motor de Univer: primas son tablas y formularios; no hay
	`chart.js` aquí. Se usa la misma cáscara porque `UniverShell` es solo
	eso —cabecera de altura fija y un `main` que se queda el resto del
	viewport—, y es lo que da a los canvas del módulo un toolbar común con su
	«Ir a…».

	El `@` no es decorativo: sin él, la página cuelga de
	`dashboard/+layout.svelte` y queda dentro de un
	`<main class="flex-1 overflow-y-auto">` cuya altura no se propaga. A cambio
	se pierde su guard de autenticación, y por eso `UniverAuthGuard` va aquí.
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
