<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	// Redirigir automáticamente a servicios
	onMount(() => {
		goto('/dashboard/servicios', { replaceState: true });
	});
</script>

<svelte:head>
	<title>Dashboard - Cotransmeq</title>
</svelte:head>

<!-- Página de redirección a servicios: misma espera que al entrar -->
<CargaMascota tamano="pantalla" texto="Redirigiendo a servicios…" />
