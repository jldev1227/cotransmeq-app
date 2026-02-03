<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { building } from '$app/environment';
	import { onMount } from 'svelte';

	const dispatch = createEventDispatcher();

	export let isCollapsed = false;

	let isMobile = false;
	let isDrawerOpen = false;

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

	const menuItems = [
		// {
		// 	id: 'dashboard',
		// 	label: 'Dashboard',
		// 	icon: 'dashboard',
		// 	badge: null,
		// 	href: '/dashboard'
		// },
		{
			id: 'flota',
			label: 'Flota',
			icon: 'truck',
			badge: null,
			href: '/dashboard/flota'
		},
		{
			id: 'conductores',
			label: 'Conductores',
			icon: 'users',
			badge: null,
			href: '/dashboard/conductores'
		},
		{
			id: 'servicios',
			label: 'Servicios',
			icon: 'clock',
			// badge: '8',
			badge: null,
			href: '/dashboard/servicios'
		},
		{
			id: 'recargos',
			label: 'Recargos',
			icon: 'calendar-clock',
			badge: null,
			href: '/dashboard/recargos'
		},
		{
			id: 'clientes',
			label: 'Clientes',
			icon: 'building',
			badge: null,
			href: '/dashboard/clientes'
		},
		{
			id: 'asistencias',
			label: 'Asistencias',
			icon: 'clipboard',
			badge: null,
			href: '/dashboard/asistencias'
		},
		{
			id: 'acciones-correctivas',
			label: 'Acciones C/P',
			icon: 'shield-check',
			badge: null,
			href: '/dashboard/acciones-correctivas'
		},
		{
			id: 'evaluaciones',
			label: 'Evaluaciones',
			icon: 'clipboard-list',
			badge: null,
			href: '/dashboard/evaluaciones'
		}
		// {
		// 	id: 'rutas',
		// 	label: 'Rutas',
		// 	icon: 'map',
		// 	badge: null,
		// 	href: '/dashboard/rutas'
		// },
		// {
		// 	id: 'planillas',
		// 	label: 'Planillas',
		// 	icon: 'calendar',
		// 	badge: '3',
		// 	href: '/dashboard/planillas'
		// }
		// {
		// 	id: 'reportes',
		// 	label: 'Reportes',
		// 	icon: 'chart',
		// 	badge: null,
		// 	href: '/dashboard/reportes'
		// },
		// {
		// 	id: 'configuracion',
		// 	label: 'Configuración',
		// 	icon: 'settings',
		// 	badge: null,
		// 	href: '/dashboard/configuracion'
		// }
	];

	function getActiveSectionFromPath(pathname: string): string {
		// if (pathname === '/dashboard') return 'dashboard';
		if (pathname.startsWith('/dashboard/flota')) return 'flota';
		if (pathname.startsWith('/dashboard/conductores')) return 'conductores';
		if (pathname.startsWith('/dashboard/servicios')) return 'servicios';
		if (pathname.startsWith('/dashboard/recargos')) return 'recargos';
		if (pathname.startsWith('/dashboard/asistencias')) return 'asistencias';
		if (pathname.startsWith('/dashboard/acciones-correctivas')) return 'acciones-correctivas';
		if (pathname.startsWith('/dashboard/evaluaciones')) return 'evaluaciones';
		if (pathname.startsWith('/dashboard/clientes')) return 'clientes';
		// if (pathname.startsWith('/dashboard/rutas')) return 'rutas';
		// if (pathname.startsWith('/dashboard/planillas')) return 'planillas';
		// if (pathname.startsWith('/dashboard/reportes')) return 'reportes';
		// if (pathname.startsWith('/dashboard/configuracion')) return 'configuracion';
		return 'servicios';
	}

	function handleMenuClick(item: (typeof menuItems)[0]) {
		goto(item.href);
		dispatch('sectionChange', { section: item.id });

		// Cerrar drawer en mobile después de navegar
		if (isMobile) {
			isDrawerOpen = false;
		}
	}

	function toggleDrawer() {
		isDrawerOpen = !isDrawerOpen;
	}

	function closeDrawer() {
		isDrawerOpen = false;
	}

	function getIcon(iconName: string) {
		const icons = {
			dashboard: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 5a2 2 0 012-2h4a2 2 0 012 2v6H8V5z" />`,
			truck: `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="7" cy="17" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 17h6"/><circle cx="17" cy="17" r="3" stroke="currentColor" stroke-width="2" fill="none"/>`,
			users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 3.128a4 4 0 0 1 0 7.744" stroke="currentColor" stroke-width="2" fill="none"/><path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2" fill="none"/>`,
			map: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />`,
			calendar: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />`,
			'calendar-clock': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /><circle cx="16" cy="16" r="4" fill="currentColor" fill-opacity="0.9"/><path d="M16 14.5v1.5l1 1" stroke="white" stroke-width="1" stroke-linecap="round"/>`,
			clock: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`,
			building: `
				<rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
				
				<!-- Ventanas -->
				<rect x="7.5" y="5" width="1" height="1" fill="currentColor"/>
				<rect x="11.5" y="5" width="1" height="1" fill="currentColor"/>
				<rect x="15.5" y="5" width="1" height="1" fill="currentColor"/>

				<rect x="7.5" y="9" width="1" height="1" fill="currentColor"/>
				<rect x="11.5" y="9" width="1" height="1" fill="currentColor"/>
				<rect x="15.5" y="9" width="1" height="1" fill="currentColor"/>

				<rect x="7.5" y="13" width="1" height="1" fill="currentColor"/>
				<rect x="11.5" y="13" width="1" height="1" fill="currentColor"/>
				<rect x="15.5" y="13" width="1" height="1" fill="currentColor"/>

				<!-- Puerta -->
				<rect x="10" y="17" width="4" height="5" fill="currentColor"/>
			`,
			chart: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />`,
			clipboard: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />`,
			'clipboard-list': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />`,
			'shield-check': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />`,
			settings: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />`
		};

		return icons[iconName as keyof typeof icons] || '';
	}
</script>

<!-- Desktop Sidebar (lg+) -->
<div
	class="apple-transition fixed top-0 left-0 z-40 hidden h-full lg:block {isCollapsed
		? 'w-20'
		: 'w-64'}"
	in:fly={{ x: -100, duration: 400 }}
>
	<!-- Sidebar Background -->
	<div class="glass-dark relative h-full border-r border-white/10">
		<!-- Logo Area -->
		<div class="border-b border-white/10 p-6" in:fade={{ duration: 600, delay: 200 }}>
			<div class="flex items-center space-x-3">
				<div
					class="soft-shadow flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
				>
					<span class="text-lg font-bold text-white">T</span>
				</div>
				{#if !isCollapsed}
					<div class="min-w-0" in:fade={{ duration: 300 }}>
						<h2 class="truncate text-lg font-semibold text-white">Cotransmeq</h2>
						<p class="text-xs text-orange-200">Sistema de Gestión</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Navigation Menu -->
		<nav class="flex-1 space-y-1 overflow-y-auto p-4">
			{#each menuItems as item, index (item.id)}
				<button
					class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-3
						{activeSection === item.id
						? 'border border-orange-400/30 bg-orange-500/20 text-orange-300'
						: 'text-orange-100/70 hover:bg-white/5 hover:text-orange-200'}"
					on:click={() => handleMenuClick(item)}
					in:fly={{ x: -30, duration: 400, delay: index * 50 + 300 }}
				>
					<!-- Icon -->
					<div class="h-5 w-5 flex-shrink-0">
						<svg
							class="apple-transition h-5 w-5 {activeSection === item.id
								? 'text-orange-400'
								: 'text-current'}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							{@html getIcon(item.icon)}
						</svg>
					</div>

					<!-- Label and Badge -->
					{#if !isCollapsed}
						<div
							class="ml-3 flex min-w-0 flex-1 items-center justify-between"
							in:fade={{ duration: 200 }}
						>
							<span class="truncate font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white"
								>
									{item.badge}
								</span>
							{/if}
						</div>
					{:else if item.badge}
						<!-- Badge for collapsed state -->
						<div
							class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-xs font-medium text-white"
						>
							{item.badge}
						</div>
					{/if}

					<!-- Active indicator -->
					{#if activeSection === item.id}
						<div
							class="absolute inset-0 rounded-xl bg-gradient-to-r from-orange-400/5 to-orange-500/5"
						></div>
					{/if}
				</button>
			{/each}
		</nav>

		<!-- Collapse Toggle -->
		<div class="border-t border-white/10 p-4">
			<button
				class="apple-transition group flex w-full items-center justify-center rounded-xl px-3 py-3 text-orange-100/70 hover:bg-white/5 hover:text-orange-200"
				on:click={() => dispatch('toggleCollapse')}
			>
				<svg
					class="apple-transition h-5 w-5 {isCollapsed ? 'rotate-180' : ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
					/>
				</svg>
				{#if !isCollapsed}
					<span class="ml-3 font-medium" in:fade={{ duration: 200 }}>Contraer</span>
				{/if}
			</button>
		</div>
	</div>
</div>

<!-- Mobile Menu Button (fixed en esquina superior izquierda) -->
<button
	type="button"
	class="fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 shadow-lg transition-colors hover:bg-orange-600 lg:hidden"
	on:click={toggleDrawer}
	aria-label="Abrir menú"
>
	<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M4 6h16M4 12h16M4 18h16"
		/>
	</svg>
</button>

<!-- Mobile Drawer -->
{#if isMobile && isDrawerOpen}
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
		<div class="glass-dark relative h-full border-r border-white/10">
			<!-- Header con botón cerrar -->
			<div class="flex items-center justify-between border-b border-white/10 p-4">
				<div class="flex items-center space-x-3">
					<div
						class="soft-shadow flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<span class="text-lg font-bold text-white">T</span>
					</div>
					<div class="min-w-0">
						<h2 class="truncate text-lg font-semibold text-white">Cotransmeq</h2>
						<p class="text-xs text-orange-200">Sistema de Gestión</p>
					</div>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-lg text-orange-100/70 transition-colors hover:bg-white/10 hover:text-white"
					on:click={closeDrawer}
					aria-label="Cerrar menú"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Navigation Menu -->
			<nav class="flex-1 space-y-1 overflow-y-auto p-4">
				{#each menuItems as item, index (item.id)}
					<button
						class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-3
							{activeSection === item.id
							? 'border border-orange-400/30 bg-orange-500/20 text-orange-300'
							: 'text-orange-100/70 hover:bg-white/5 hover:text-orange-200'}"
						on:click={() => handleMenuClick(item)}
					>
						<!-- Icon -->
						<div class="h-5 w-5 flex-shrink-0">
							<svg
								class="apple-transition h-5 w-5 {activeSection === item.id
									? 'text-orange-400'
									: 'text-current'}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								{@html getIcon(item.icon)}
							</svg>
						</div>

						<!-- Label and Badge -->
						<div class="ml-3 flex min-w-0 flex-1 items-center justify-between">
							<span class="truncate font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white"
								>
									{item.badge}
								</span>
							{/if}
						</div>

						<!-- Active indicator -->
						{#if activeSection === item.id}
							<div
								class="absolute inset-0 rounded-xl bg-gradient-to-r from-orange-400/5 to-orange-500/5"
							></div>
						{/if}
					</button>
				{/each}
			</nav>
		</div>
	</div>
{/if}
