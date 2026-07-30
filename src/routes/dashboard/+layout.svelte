<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketStore, socketManager } from '$lib/socket';
	import { sidebarStore } from '$lib/stores/sidebar';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Header from '$lib/components/Header.svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from '$lib/stores/toast';
	import { isTokenExpired, getTimeUntilExpiration } from '$lib/utils/jwt';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { checkAccess, AREA_LABELS, type Area } from '$lib/config/permissions';

	let mounted = false;
	let tokenCheckInterval: ReturnType<typeof setInterval> | null = null;

	// Modal sesión cerrada remotamente
	let sesionCerradaModal = false;
	let sesionCerradaMotivoMsg = '';
	let sesionCerradaCountdown = 5;
	let sesionCerradaTimer: ReturnType<typeof setInterval> | null = null;

	function mostrarSesionCerrada(motivo: string) {
		sesionCerradaMotivoMsg = motivo;
		sesionCerradaModal = true;
		sesionCerradaCountdown = 5;
		if (sesionCerradaTimer) clearInterval(sesionCerradaTimer);
		sesionCerradaTimer = setInterval(() => {
			sesionCerradaCountdown -= 1;
			if (sesionCerradaCountdown <= 0) {
				if (sesionCerradaTimer) clearInterval(sesionCerradaTimer);
				authStore.logout();
			}
		}, 1000);
	}

	// Reactive declarations
	$: user = $authStore.user;
	$: isConnected = $socketStore.connected;
	$: token = $authStore.token;

	// Guard reactivo: verificar permisos al cambiar de ruta
	$: if (mounted && user && $page.url.pathname !== '/dashboard') {
		checkRoutePermission($page.url.pathname);
	}

	function checkRoutePermission(pathname: string) {
		const match = pathname.match(/^\/dashboard\/([^/]+)/);
		if (!match) return;
		const moduleId = match[1];

		const { allowed } = checkAccess(
			user?.role || user?.rol,
			user?.area,
			moduleId
		);

		if (!allowed) {
			toast.error('No tienes permiso para acceder a esta sección');
			goto('/dashboard/servicios');
		}
	}

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
		}, 60000);

		// Escuchar cierre de sesión remoto
		socketManager.on('sesion-cerrada', (data: { motivo: string }) => {
			mostrarSesionCerrada(data?.motivo || 'Tu sesión fue cerrada por un administrador.');
		});
	});

	onDestroy(() => {
		if (tokenCheckInterval) clearInterval(tokenCheckInterval);
		if (sesionCerradaTimer) clearInterval(sesionCerradaTimer);
		socketManager.off('sesion-cerrada');
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
	<title>Dashboard - Transmeralda</title>
</svelte:head>

{#if mounted && user}
	<div class="min-h-screen" style="background-color: var(--bg-base);" in:fade={{ duration: 400 }}>
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
				userEmail={user?.correo || 'usuario@transmeralda.com'}
				userRole={user?.area && Array.isArray(user.area) && user.area.length > 0 ? user.area.map((a: string) => AREA_LABELS[a as Area] || a).join(', ') : 'Usuario'}
				isCollapsed={$sidebarStore}
				showSessionTimer={false}
				on:logout={handleLogout}
			/>

			<!-- Page Content -->
			<main
				class="flex-1 overflow-x-hidden overflow-y-auto pt-16 {$sidebarStore
					? 'lg:ml-24'
					: 'lg:ml-64'} apple-transition"
			>
				<!-- Slot para el contenido de las páginas -->
				<slot />
			</main>
		</div>
	</div>

	<!-- ═══ TOAST PERSISTENTE — Conexión en tiempo real (top-center) ═══ -->
	{#if !isConnected}
		<div
			class="pointer-events-none fixed left-1/2 top-[68px] z-[9998] -translate-x-1/2 px-4"
			role="status"
			aria-live="polite"
			in:fly={{ y: -16, duration: 320, easing: quintOut }}
			out:fade={{ duration: 200 }}
		>
			<div
				class="apple-transition pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-full px-4 py-2 backdrop-blur-md"
				style="background:rgba(254,243,199,0.92); border:1px solid rgba(245,158,11,0.35); box-shadow:0 8px 28px rgba(245,158,11,0.18), 0 2px 8px rgba(0,0,0,0.04);"
			>
				<!-- Ping dot (sin SVG grande) -->
				<span class="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
						style="background:#f59e0b"
					></span>
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full" style="background:#d97706"
					></span>
				</span>

				<!-- Texto principal — Inter Tight con jerarquía clara -->
				<span
					class="font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
					style="color:#92400e"
				>
					Sin conexión
				</span>
				<span
					class="hidden h-3 w-px sm:inline-block"
					style="background:rgba(146,64,14,0.25)"
					aria-hidden="true"
				></span>
				<span class="hidden text-[12.5px] font-medium sm:inline" style="color:#78350f">
					Conexión en tiempo real no disponible — algunas funciones pueden estar limitadas
				</span>
				<span class="text-[12.5px] font-medium sm:hidden" style="color:#78350f">
					Sin conexión en tiempo real
				</span>
			</div>
		</div>
	{/if}

	<!-- ─── Modal: Sesión cerrada remotamente ───────────────────────────────── -->
	{#if sesionCerradaModal}
		<!-- Backdrop con blur (paleta landing) -->
		<button
			type="button"
			class="fixed inset-0 z-[9999] cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
			aria-label="Cerrar modal"
			transition:fade={{ duration: 200 }}
		></button>

		<div
			class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
		>
			<div
				class="w-full max-w-sm overflow-hidden"
				style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
			>
				<!-- Banda superior (gradiente rojo editorial) -->
				<div
					class="flex items-center gap-3 px-6 py-5"
					style="background: linear-gradient(135deg, #dc2626, #b91c1c);"
				>
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
						<svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
						</svg>
					</div>
					<div>
						<h2 class="font-display text-base font-medium text-white">Sesión cerrada</h2>
						<p class="text-xs text-red-100">Acción realizada por un administrador</p>
					</div>
				</div>

				<!-- Cuerpo -->
				<div class="px-6 py-6 text-center">
					<p class="mb-5 text-sm leading-relaxed" style="color: var(--text-secondary);">
						{sesionCerradaMotivoMsg}
					</p>
					<div class="flex flex-col items-center gap-2">
						<div class="relative flex h-16 w-16 items-center justify-center">
							<svg class="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
								<circle cx="18" cy="18" r="15.9" fill="none" stroke="#fee2e2" stroke-width="3"/>
								<circle cx="18" cy="18" r="15.9" fill="none" stroke="#dc2626" stroke-width="3"
									stroke-dasharray="100"
									stroke-dashoffset="{100 - (sesionCerradaCountdown / 5) * 100}"
									stroke-linecap="round"
									style="transition: stroke-dashoffset 0.9s linear;"/>
							</svg>
							<span class="font-display text-2xl font-medium text-red-600">{sesionCerradaCountdown}</span>
						</div>
						<p class="text-xs" style="color: var(--text-very-muted);">Redirigiendo al inicio de sesión…</p>
					</div>
				</div>

				<!-- Footer -->
				<div class="border-t px-6 py-4" style="border-color: var(--border-subtle);">
					<button
						on:click={() => { if (sesionCerradaTimer) clearInterval(sesionCerradaTimer); authStore.logout(); }}
						class="btn-primary w-full"
						style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 4px 16px rgba(220,38,38,0.3);"
					>
						Ir a inicio de sesión ahora
					</button>
				</div>
			</div>
		</div>
	{/if}

{:else}
	<!-- Loading state — fondo cálido con marca editorial -->
	<div class="flex min-h-screen items-center justify-center" style="background-color: var(--bg-base);">
		<div class="text-center">
			<div
				class="mx-auto mb-5 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl"
				style="box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);"
			>
				<img
					src="/android-chrome-192x192.png"
					alt="Transmeralda"
					class="h-full w-full object-contain"
					width="80"
					height="80"
				/>
			</div>
			<h1 class="font-display mb-1 text-3xl" style="color: var(--bg-charcoal);">Transmeralda</h1>
			<p class="text-sm" style="color: var(--text-muted);">Cargando dashboard…</p>
		</div>
	</div>
{/if}
