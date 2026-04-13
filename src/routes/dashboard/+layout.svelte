<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketStore } from '$lib/socket';
	import { sidebarStore } from '$lib/stores/sidebar';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Header from '$lib/components/Header.svelte';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { isTokenExpired, getTimeUntilExpiration } from '$lib/utils/jwt';

	let mounted = false;
	let tokenCheckInterval: ReturnType<typeof setInterval> | null = null;

	// Reactive declarations
	$: user = $authStore.user;
	$: isConnected = $socketStore.connected;
	$: token = $authStore.token;

	/**
	 * Verifica si el token ha expirado y cierra sesión automáticamente
	 */
	function checkTokenExpiration() {
		if (!token) {
			return;
		}

		const expired = isTokenExpired(token);

		if (expired) {
			toast.error('Tu sesión ha expirado. Por favor, inicia sesión nuevamente.');
			authStore.logout();
			return;
		}

		const timeRemaining = getTimeUntilExpiration(token);
		const minutesRemaining = Math.floor(timeRemaining / 1000 / 60);

		// Advertir cuando quedan 5 minutos o menos
		if (minutesRemaining <= 5 && minutesRemaining > 0) {
			toast.warning(`Tu sesión expirará en ${minutesRemaining} minutos. Guarda tu trabajo.`);
		}
	}

	onMount(() => {
		// Inicializar auth store
		authStore.init();
		mounted = true;

		// Verificar token inmediatamente
		checkTokenExpiration();

		// Verificar token cada 60 segundos (1 minuto)
		tokenCheckInterval = setInterval(() => {
			checkTokenExpiration();
		}, 60000); // 60000ms = 1 minuto
	});

	onDestroy(() => {
		// Limpiar el intervalo cuando el componente se desmonte
		if (tokenCheckInterval) {
			clearInterval(tokenCheckInterval);
		}
	});

	function handleSectionChange(event: CustomEvent) {
		// Manejar cambio de sección si es necesario
		console.log('Sección cambiada:', event.detail.section);
	}

	function handleToggleCollapse() {
		sidebarStore.toggle();
	}

	function handleLogout() {
		authStore.logout();
	}
</script>

<svelte:head>
	<title>Dashboard - Cotransmeq</title>
</svelte:head>

{#if mounted && user}
	<div class="min-h-screen bg-gray-50/50" in:fade={{ duration: 400 }}>
		<!-- Sidebar -->
		<Sidebar
			isCollapsed={$sidebarStore}
			on:sectionChange={handleSectionChange}
			on:toggleCollapse={handleToggleCollapse}
		/>

		<!-- Main Content Area -->
		<div class="flex flex-col overflow-hidden">
			<!-- Header -->
			<Header
				userName={user?.nombre || 'Usuario'}
				userEmail={user?.correo || 'usuario@cotransmeq.com'}
				userRole={user?.role || user?.rol || 'Usuario'}
				isCollapsed={$sidebarStore}
				showSessionTimer={false}
				on:logout={handleLogout}
			/>

			<!-- Page Content -->
			<main
				class="flex-1 overflow-x-hidden overflow-y-auto pt-16 {$sidebarStore
					? 'lg:ml-20'
					: 'lg:ml-64'} apple-transition"
			>
				<!-- Socket Connection Status -->
				{#if !isConnected}
					<div class="m-4 rounded border-l-4 border-orange-500 bg-orange-100 p-4 text-orange-700">
						<div class="flex">
							<div class="flex-shrink-0">
								<svg class="h-5 w-5 text-orange-400" viewBox="0 0 20 20" fill="currentColor">
									<path
										fill-rule="evenodd"
										d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div class="ml-3">
								<p class="text-sm">
									Conexión en tiempo real no disponible. Algunas funciones pueden estar limitadas.
								</p>
							</div>
						</div>
					</div>
				{/if}

				<!-- Slot para el contenido de las páginas -->
				<slot />
			</main>
		</div>
	</div>
{:else}
	<!-- Loading state -->
	<div
		class="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-900 via-orange-800 to-slate-900"
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
			<p class="text-sm text-orange-200">Cargando dashboard...</p>
		</div>
	</div>
{/if}
