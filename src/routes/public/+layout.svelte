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

<div class="public-shell">
	<slot />
</div>

<style>
	.public-shell {
		min-height: 100vh;
		min-height: 100dvh;
		background-color: #faf7f2;
		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
		color: #1a1a1a;
		-webkit-font-smoothing: antialiased;
	}
</style>
