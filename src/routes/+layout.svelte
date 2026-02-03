<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { Toaster } from 'svelte-sonner';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

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

<Toaster richColors position="top-right" />

{@render children?.()}
