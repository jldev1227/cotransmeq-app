<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import '../../app.css';

	onMount(() => {
		// Fullscreen para el mapa
		document.body.style.overflow = 'hidden';
	});

	onDestroy(() => {
		document.body.style.overflow = '';
	});
</script>

<!-- Encabezado simple sin autenticación -->
<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<slot />
