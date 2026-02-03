<script lang="ts">
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

<!-- Página de redirección a servicios -->
<div class="flex min-h-screen items-center justify-center">
	<div class="text-center">
		<div
			class="soft-shadow mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600"
		>
			<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		</div>
		<p class="text-gray-600">Redirigiendo a servicios...</p>
	</div>
</div>
