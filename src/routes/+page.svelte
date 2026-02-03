<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { fade } from 'svelte/transition';

	let mounted = false;

	onMount(() => {
		// Inicializar el store de auth
		authStore.init();

		// Verificar autenticación y redirigir apropiadamente
		if (authStore.isAuthenticated()) {
			goto('/dashboard');
		} else {
			goto('/login');
		}

		mounted = true;
	});
</script>

<svelte:head>
	<title>Cotransmeq - Sistema de Gestión</title>
	<meta name="description" content="Sistema de gestión para empresa de transporte Cotransmeq" />
</svelte:head>

{#if mounted}
	<div
		class="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-900 via-orange-800 to-slate-900"
		in:fade={{ duration: 400 }}
	>
		<div class="text-center">
			<div
				class="soft-shadow mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600"
			>
				<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 10V3L4 14h7v7l9-11h-7z"
					/>
				</svg>
			</div>
			<h1 class="mb-1 text-2xl font-semibold text-white">Cotransmeq</h1>
			<p class="text-sm text-orange-200">Redirigiendo...</p>
		</div>
	</div>
{/if}
