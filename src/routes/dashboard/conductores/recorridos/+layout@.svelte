<script lang="ts">
	/**
	 * Layout del canvas de recorridos.
	 *
	 * El `@` del nombre es obligatorio: se salta `dashboard/+layout.svelte` para
	 * que el canvas ocupe la ventana entera. Con el layout del dashboard, el
	 * `position: fixed` del shell queda dentro de un contenedor con padding y la
	 * hoja aparece recortada.
	 */
	import { onMount, onDestroy } from 'svelte';
	import UniverAuthGuard from '$lib/components/univer/UniverAuthGuard.svelte';
	import UniverShell from '$lib/components/univer/UniverShell.svelte';
	import '$lib/components/univer/toolbar.css';

	let { children } = $props();

	onMount(() => {
		document.documentElement.classList.add('univer-shell-active');
		document.body.classList.add('univer-shell-active');
	});
	onDestroy(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('univer-shell-active');
		document.body.classList.remove('univer-shell-active');
	});
</script>

<UniverAuthGuard moduleId="recorridos">
	<UniverShell>
		{@render children()}
	</UniverShell>
</UniverAuthGuard>

<style>
	/* Al imprimir hay que revertir el `position: fixed` del shell, o sale una
	   hoja cortada con el lienzo de Univer de fondo. */
	@media print {
		:global(html.univer-shell-active),
		:global(body.univer-shell-active) {
			position: static !important;
			overflow: visible !important;
			height: auto !important;
		}
	}
</style>
