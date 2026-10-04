<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';
	import { MENU_ITEMS, type MenuItem } from '$lib/config/menu';
	import SidebarIcon, {
		SIDEBAR_ICON_SIZE,
		SIDEBAR_ICON_STROKE
	} from '$lib/components/SidebarIcon.svelte';
	import { ChevronsLeft } from 'lucide-svelte';
	import SidebarCabecera from '$lib/components/SidebarCabecera.svelte';

	const dispatch = createEventDispatcher();

	export let isCollapsed = false;

	let isMobile = false;

	// Detectar tamaño de pantalla
	onMount(() => {
		const checkMobile = () => {
			isMobile = window.innerWidth < 1024; // lg breakpoint
		};

		checkMobile();
		window.addEventListener('resize', checkMobile);

		return () => {
			window.removeEventListener('resize', checkMobile);
		};
	});

	// Determinar sección activa basada en la URL actual
	$: activeSection = getActiveSectionFromPath($page.url.pathname);


	// Filtrar items del menú según permisos del usuario
	$: currentUser = $authStore.user;
	$: filteredMenuItems = MENU_ITEMS.filter((item) => {
		if (!currentUser) return false;
		// `permisos_rutas` es una lista blanca por usuario: si la tiene, manda
		// ella y no el área. Sin pasarla aquí el menú mostraría entradas que el
		// guard de ruta y la API rechazan un clic después.
		const { allowed } = checkAccess(
			currentUser.role || currentUser.rol,
			currentUser.area,
			item.id,
			currentUser.permisos_rutas
		);
		return allowed;
	});

	function getActiveSectionFromPath(pathname: string): string {
		// if (pathname === '/dashboard') return 'dashboard';
		if (pathname.startsWith('/dashboard/flota')) return 'flota';
		if (pathname.startsWith('/dashboard/conductores')) return 'conductores';
		if (pathname.startsWith('/dashboard/servicios')) return 'servicios';
		if (pathname.startsWith('/dashboard/recargos')) return 'recargos';
		if (pathname.startsWith('/dashboard/asistencias')) return 'asistencias';
		if (pathname.startsWith('/dashboard/acciones-correctivas')) return 'acciones-correctivas';
		if (pathname.startsWith('/dashboard/evaluaciones')) return 'evaluaciones';
		if (pathname.startsWith('/dashboard/salidas-nc')) return 'salidas-nc';
		/// Antes que `/dashboard/formularios`: `startsWith` no distingue prefijos
		/// que se solapan, pero estas dos rutas no lo hacen. Se deja junto por
		/// legibilidad.
		if (pathname.startsWith('/dashboard/mis-formularios')) return 'mis-formularios';
		if (pathname.startsWith('/dashboard/formularios')) return 'formularios';
		if (pathname.startsWith('/dashboard/clientes')) return 'clientes';
		if (pathname.startsWith('/dashboard/sarlaft')) return 'sarlaft';
		if (pathname.startsWith('/dashboard/nomina')) return 'nomina';
		// if (pathname.startsWith('/dashboard/extractos')) return 'extractos';
		if (pathname.startsWith('/dashboard/liquidaciones-servicios')) return 'liquidaciones-servicios';
		// Todas las rutas de terceros (incluidos ambos canvas) resaltan la
		// única entrada del menú: «Liq. Terceros».
		if (pathname.startsWith('/dashboard/liquidaciones-terceros')) return 'liquidaciones-terceros';
		if (pathname.startsWith('/dashboard/sarlaft')) return 'SARLAFT + PTEE';
		if (pathname.startsWith('/dashboard/pesv')) return 'pesv';
		if (pathname.startsWith('/dashboard/certificados')) return 'certificados';
		if (pathname.startsWith('/dashboard/terceros')) return 'terceros';
		if (pathname.startsWith('/dashboard/usuarios')) return 'usuarios';
		if (pathname.startsWith('/dashboard/sesiones')) return 'usuarios';
		if (pathname.startsWith('/dashboard/directorio')) return 'usuarios';
		if (pathname.startsWith('/dashboard/perfil')) return 'perfil';
		return 'servicios';
	}

	function handleMenuClick(item: MenuItem) {
		goto(item.href);
		dispatch('sectionChange', { section: item.id });

		// Cerrar drawer en mobile después de navegar
		if (isMobile) {
			mobileDrawerStore.close();
		}
	}

	function closeDrawer() {
		mobileDrawerStore.close();
	}
</script>

<!-- Desktop Sidebar (lg+) — fondo charcoal profundo (no glass) -->
<div
	class="no-print apple-transition fixed top-0 left-0 z-40 hidden h-full lg:block {isCollapsed
		? 'w-24'
		: 'w-64'}"
	in:fly={{ x: -100, duration: 400 }}
	style="background-color: var(--bg-charcoal-deep); border-right: 1px solid rgba(255,255,255,0.06);"
>
	<div class="relative flex h-full flex-col">
		<!-- Cabecera: la del menú de la app móvil; compacta con el menú contraído -->
		<SidebarCabecera compacta={isCollapsed} />

		<!-- Navigation Menu -->
		<nav class="flex-1 space-y-1 overflow-y-auto p-4">
			{#each filteredMenuItems as item, index (item.id)}
				<button
					class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl py-2.5
						{isCollapsed ? 'justify-center px-2' : 'px-3'}
						{activeSection === item.id ? 'text-white' : 'hover:bg-white/5'}"
					style="color: {activeSection === item.id ? '#ffffff' : 'rgba(255, 255, 255,0.65)'};
						background-color: {activeSection === item.id ? 'rgba(255,255,255,0.14)' : 'transparent'};
						border: 1px solid {activeSection === item.id ? 'rgba(255,255,255,0.28)' : 'transparent'};"
					data-tour={`nav-${item.id}`}
					on:click={() => handleMenuClick(item)}
					in:fly={{ x: -30, duration: 400, delay: index * 50 + 300 }}
					title={isCollapsed ? item.label : undefined}
					aria-label={isCollapsed ? item.label : undefined}
				>
					<SidebarIcon icon={item.icon} active={activeSection === item.id} />

					<!-- Label and Badge -->
					{#if !isCollapsed}
						<div
							class="ml-3 flex min-w-0 flex-1 items-center justify-between"
							in:fade={{ duration: 200 }}
						>
							<span class="truncate text-sm font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
									style="background-color: var(--orange-500);"
								>
									{item.badge}
								</span>
							{/if}
						</div>
					{:else if item.badge}
						<!-- Badge for collapsed state -->
						<div
							class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium text-white"
							style="background-color: var(--orange-500);"
						>
							{item.badge}
						</div>
					{/if}
				</button>
			{/each}
		</nav>

		<!-- Collapse Toggle -->
		<div class="flex-shrink-0 p-4" style="border-top: 1px solid rgba(255,255,255,0.06);">
			<button
				class="apple-transition group flex w-full items-center justify-center rounded-xl px-3 py-2.5"
				style="color: rgba(255, 255, 255,0.65);"
				on:click={() => dispatch('toggleCollapse')}
				title={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
				aria-label={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
			>
				<ChevronsLeft
					class="apple-transition h-5 w-5 {isCollapsed ? 'rotate-180' : ''}"
					size={SIDEBAR_ICON_SIZE}
					strokeWidth={SIDEBAR_ICON_STROKE}
				/>
				{#if !isCollapsed}
					<span class="ml-3 text-sm font-medium" in:fade={{ duration: 200 }}>Contraer</span>
				{/if}
			</button>
		</div>
	</div>
</div>

<!-- Mobile Drawer -->
{#if isMobile && $mobileDrawerStore}
	<!-- Overlay -->
	<button
		type="button"
		class="fixed inset-0 z-[60] cursor-pointer bg-black/50 backdrop-blur-sm"
		on:click={closeDrawer}
		on:keydown={(e) => e.key === 'Escape' && closeDrawer()}
		aria-label="Cerrar menú"
		transition:fade={{ duration: 200 }}
	></button>

	<!-- Drawer -->
	<div class="fixed top-0 left-0 z-[70] h-full w-64" transition:fly={{ x: -300, duration: 300 }}>
		<div
			class="relative flex h-full flex-col"
			style="background-color: var(--bg-charcoal-deep); border-right: 1px solid rgba(255,255,255,0.06);"
		>
			<!-- Cabecera: la del menú de la app móvil. Sin botón de cerrar: el fondo cierra. -->
			<SidebarCabecera conSafeArea />

			<!-- Navigation Menu -->
			<nav class="flex-1 space-y-1 overflow-y-auto p-4">
				{#each filteredMenuItems as item (item.id)}
					<button
						class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-2.5"
						style="color: {activeSection === item.id ? '#ffffff' : 'rgba(255, 255, 255,0.65)'};
							background-color: {activeSection === item.id ? 'rgba(255,255,255,0.14)' : 'transparent'};
							border: 1px solid {activeSection === item.id ? 'rgba(255,255,255,0.28)' : 'transparent'};"
						data-tour={`nav-${item.id}`}
						on:click={() => handleMenuClick(item)}
					>
						<SidebarIcon icon={item.icon} active={activeSection === item.id} />

						<div class="ml-3 flex min-w-0 flex-1 items-center justify-between">
							<span class="truncate text-sm font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
									style="background-color: var(--orange-500);"
								>
									{item.badge}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</nav>
		</div>
	</div>
{/if}
