<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { Toaster } from 'svelte-sonner';
	import { enUniverShell } from '$lib/stores/univerShell';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	/**
	 * Los canvas Univer bajan los avisos a la esquina inferior derecha.
	 *
	 * Arriba a la derecha está el toolbar: año, mes, «Ir a…», el buscador de
	 * hoja con su desplegable, la presencia y el indicador de autoguardado.
	 * Un toast ahí tapa justo lo que uno mira para saber si su edición se
	 * guardó. Abajo solo está la barra de pestañas.
	 *
	 * El `<Toaster>` es único a propósito: montar uno por canvas duplicaría
	 * cada aviso, porque svelte-sonner pinta la misma cola en todas sus
	 * instancias.
	 */
	const posicionToast = $derived($enUniverShell ? 'bottom-right' : 'top-right');

	/**
	 * En el canvas, los 24px de separación por defecto dejarían el toast
	 * ENCIMA de la barra de pestañas y del zoom, que es con lo que se navega
	 * entre hojas. Se sube lo justo para que quede apoyado sobre ella.
	 *
	 * Objeto parcial a propósito: svelte-sonner rellena los lados que no
	 * vengan con su valor por defecto, así que esto solo toca el de abajo.
	 */
	const offsetToast = $derived($enUniverShell ? { bottom: 52 } : undefined);

	onMount(() => {
		// Solo inicializar auth si NO estamos en una ruta pública
		const isPublicRoute = $page.url.pathname.startsWith('/public');

		if (!isPublicRoute) {
			// Inicializar el store de autenticación al cargar la app
			authStore.init();
		}
	});
</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="icon" href={favicon} />
</svelte:head>

<Toaster richColors position={posicionToast} offset={offsetToast} />

{@render children?.()}
