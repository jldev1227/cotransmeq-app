<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, slide, scale } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess, type Area } from '$lib/config/permissions';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';

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
			id: 'sarlaft',
			label: 'SARLAFT / PTEE',
			icon: 'document',
			badge: null,
			href: '/dashboard/sarlaft'
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
		},
		{
			id: 'salidas-nc',
			label: 'Salidas NC',
			icon: 'alert-triangle',
			badge: null,
			href: '/dashboard/salidas-nc'
		},
		{
			id: 'nomina',
			label: 'Nómina',
			icon: 'wallet',
			badge: null,
			href: '/dashboard/nomina'
		},
		// {
		// 	id: 'extractos',
		// 	label: 'Extractos',
		// 	icon: 'file-text',
		// 	badge: null,
		// 	href: '/dashboard/extractos'
		// },
		{
			id: 'liquidaciones-servicios',
			label: 'Liq. Servicios',
			icon: 'receipt',
			badge: null,
			href: '/dashboard/liquidaciones-servicios'
		},
		{
			id: 'liquidaciones-terceros',
			label: 'Liq. Terceros',
			icon: 'receipt',
			badge: null,
			href: '/dashboard/liquidaciones-terceros'
		},
		{
			id: 'pesv',
			label: 'PESV',
			icon: 'pesv-road',
			badge: null,
			href: '/dashboard/pesv'
		},
		{
			id: 'contabilidad',
			label: 'Contabilidad',
			icon: 'calculator',
			badge: null,
			href: '/dashboard/contabilidad'
		},
		{
			id: 'terceros',
			label: 'Terceros',
			icon: 'address-book',
			badge: null,
			href: '/dashboard/terceros'
		},
		{
			id: 'usuarios',
			label: 'Equipo',
			icon: 'user-circle',
			badge: null,
			href: '/dashboard/usuarios'
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

	// Filtrar items del menú según permisos del usuario
	$: currentUser = $authStore.user;
	$: filteredMenuItems = menuItems.filter((item) => {
		if (!currentUser) return false;
		const { allowed } = checkAccess(currentUser.role || currentUser.rol, currentUser.area, item.id);
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
		if (pathname.startsWith('/dashboard/clientes')) return 'clientes';
		if (pathname.startsWith('/dashboard/sarlaft')) return 'sarlaft';
		if (pathname.startsWith('/dashboard/nomina')) return 'nomina';
		// if (pathname.startsWith('/dashboard/extractos')) return 'extractos';
		if (pathname.startsWith('/dashboard/liquidaciones-servicios')) return 'liquidaciones-servicios';
		if (pathname.startsWith('/dashboard/liquidaciones-terceros')) return 'liquidaciones-terceros';
		if (pathname.startsWith('/dashboard/sarlaft')) return 'SARLAFT + PTEE';
		if (pathname.startsWith('/dashboard/pesv')) return 'pesv';
		if (pathname.startsWith('/dashboard/contabilidad')) return 'contabilidad';
		if (pathname.startsWith('/dashboard/terceros')) return 'terceros';
		if (pathname.startsWith('/dashboard/usuarios')) return 'usuarios';
		if (pathname.startsWith('/dashboard/sesiones')) return 'usuarios';
		if (pathname.startsWith('/dashboard/directorio')) return 'usuarios';
		if (pathname.startsWith('/dashboard/perfil')) return 'perfil';
		return 'servicios';
	}

	function handleMenuClick(item: (typeof menuItems)[0]) {
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
			document: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />`,
			'clipboard-list': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />`,
			'shield-check': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />`,
			'alert-triangle': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />`,
			wallet: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />`,
			'file-text': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2" fill="none"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2"/><polyline points="10 9 9 9 8 9" stroke="currentColor" stroke-width="2" fill="none"/>`,
			receipt: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14l6-6M4 4v16l2-1.5L8 20l2-1.5L12 20l2-1.5L16 20l2-1.5L20 20V4l-2 1.5L16 4l-2 1.5L12 4l-2 1.5L8 4 6 5.5 4 4z" /><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/>`,
			'pesv-road': `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 2v.01" />`,
			calculator: `<rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="8" y1="6" x2="16" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="10" x2="10" y2="10" stroke="currentColor" stroke-width="2"/><line x1="14" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="2"/><line x1="8" y1="14" x2="10" y2="14" stroke="currentColor" stroke-width="2"/><line x1="14" y1="14" x2="16" y2="14" stroke="currentColor" stroke-width="2"/><line x1="8" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="2"/><line x1="14" y1="18" x2="16" y2="18" stroke="currentColor" stroke-width="2"/>`,
			'address-book': `<rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 18c0-2.5 2.2-4 5-4s5 1.5 5 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><line x1="2" y1="8" x2="4" y2="8" stroke="currentColor" stroke-width="2"/><line x1="2" y1="14" x2="4" y2="14" stroke="currentColor" stroke-width="2"/>`,
			settings: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
				   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />`,
			'user-circle': `<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="2 0"/>`
		};

		return icons[iconName as keyof typeof icons] || '';
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
		<!-- Logo Area — más editorial, padding generoso -->
		<div
			class="flex-shrink-0"
			style="border-bottom: 1px solid rgba(255,255,255,0.06);"
			in:fade={{ duration: 600, delay: 200 }}
		>
			<div class="flex items-center space-x-3">
				<div class="flex h-16 w-full flex-shrink-0 items-center justify-center overflow-hidden">
					<img
						src="/assets/logo_nombre.webp"
						alt="Cotransmeq"
						class="h-full w-3/3 max-w-[80px] object-contain"
						width="40"
						height="40"
						in:scale={{ duration: 400, start: 0.7, opacity: 0, easing: backOut }}
						out:scale={{ duration: 200, start: 0.85, opacity: 0, easing: cubicOut }}
					/>
				</div>
			</div>
		</div>

		<!-- Navigation Menu -->
		<nav class="flex-1 space-y-1 overflow-y-auto p-4">
			{#each filteredMenuItems as item, index (item.id)}
				<button
					class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-2.5
						{activeSection === item.id ? 'text-white' : 'hover:bg-white/5'}"
					style="color: {activeSection === item.id ? '#ffffff' : 'rgba(252,252,251,0.65)'};
						background-color: {activeSection === item.id ? 'rgba(249,115,22,0.20)' : 'transparent'};
						border: 1px solid {activeSection === item.id ? 'rgba(249,115,22,0.40)' : 'transparent'};"
					on:click={() => handleMenuClick(item)}
					in:fly={{ x: -30, duration: 400, delay: index * 50 + 300 }}
				>
					<!-- Icon -->
					<div class="h-5 w-5 flex-shrink-0">
						<svg
							class="apple-transition h-5 w-5"
							style="color: {activeSection === item.id ? 'var(--emerald-500)' : 'currentColor'};"
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
							<span class="truncate text-sm font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
									style="background-color: var(--emerald-500);"
								>
									{item.badge}
								</span>
							{/if}
						</div>
					{:else if item.badge}
						<!-- Badge for collapsed state -->
						<div
							class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium text-white"
							style="background-color: var(--emerald-500);"
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
			style="color: rgba(252,252,251,0.65);"
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
			<!-- Header con botón cerrar -->
			<div
				class="flex flex-shrink-0 items-center justify-between p-4"
				style="border-bottom: 1px solid rgba(255,255,255,0.06);"
			>
				<div class="flex items-center space-x-3">
			<div
				class="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl"
				style="box-shadow: 0 4px 16px rgba(249, 115, 22, 0.35); background-color: #0f172a;"
			>
				<img
					src="/favicon-32x32.png"
					alt="Cotransmeq"
					class="h-full w-full object-contain"
					width="40"
					height="40"
				/>
			</div>
			<div class="min-w-0">
				<h2 class="truncate font-display text-lg text-white" style="font-weight: 600;">
					Cotransmeq
				</h2>
				<p class="text-xs" style="color: rgba(249,115,22,0.8);">Sistema de Gestión</p>
			</div>
				</div>
				<button
					type="button"
					class="apple-transition flex h-8 w-8 items-center justify-center rounded-lg"
					style="color: rgba(252,252,251,0.65);"
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
				{#each filteredMenuItems as item, index (item.id)}
					<button
						class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-2.5"
						style="color: {activeSection === item.id ? '#ffffff' : 'rgba(252,252,251,0.65)'};
							background-color: {activeSection === item.id ? 'rgba(249,115,22,0.20)' : 'transparent'};
							border: 1px solid {activeSection === item.id ? 'rgba(249,115,22,0.40)' : 'transparent'};"
						on:click={() => handleMenuClick(item)}
					>
						<div class="h-5 w-5 flex-shrink-0">
							<svg
								class="apple-transition h-5 w-5"
								style="color: {activeSection === item.id ? 'var(--emerald-500)' : 'currentColor'};"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								{@html getIcon(item.icon)}
							</svg>
						</div>

						<div class="ml-3 flex min-w-0 flex-1 items-center justify-between">
							<span class="truncate text-sm font-medium">{item.label}</span>
							{#if item.badge}
								<span
									class="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
									style="background-color: var(--emerald-500);"
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
