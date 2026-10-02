<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import ToastProvider from '$lib/components/ui/ToastProvider.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import ConfirmHost from '$lib/components/ui/ConfirmHost.svelte';
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

<!-- Un solo `<Toaster>` para toda la app: abajo al centro. -->
<ToastProvider />
<!-- Un solo tooltip para todos los `title` de la app. -->
<Tooltip />
<!-- Un solo diálogo para todos los `confirmar()` de la app. -->
<ConfirmHost />

{@render children?.()}
