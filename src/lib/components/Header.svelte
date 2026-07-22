<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import SessionTimer from './SessionTimer.svelte';
	import { notificacionesStore } from '$lib/stores/notificaciones';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { notificacionesApi } from '$lib/api/notificaciones';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';
	import { sidebarStore } from '$lib/stores/sidebar';
	import type { Notificacion } from '$lib/api/notificaciones';

	const dispatch = createEventDispatcher();

	export let userName = 'Usuario';
	export let userEmail = 'usuario@cotransmeq.com';
	export let userRole = 'Administrador';
	export let isCollapsed = false;
	export let showSessionTimer = false;

	const PAGE_LABELS: Record<string, string> = {
		flota: 'Flota',
		conductores: 'Conductores',
		servicios: 'Servicios',
		recargos: 'Recargos',
		clientes: 'Clientes',
		asistencias: 'Asistencias',
		'acciones-correctivas': 'Acciones Correctivas',
		evaluaciones: 'Evaluaciones',
		'salidas-nc': 'Salidas No Conformidades',
		nomina: 'Nómina',
		extractos: 'Extractos',
		'liquidaciones-servicios': 'Liquidaciones de Servicios',
		'liquidaciones-terceros': 'Liquidaciones de Terceros',
		sarlaft: 'SARLAFT + PTEE',
		pesv: 'PESV',
		contabilidad: 'Contabilidad',
		terceros: 'Terceros',
		usuarios: 'Equipo',
		perfil: 'Perfil',
		'': 'Dashboard'
	};

	function getActiveSectionFromPath(pathname: string): string {
		if (pathname === '/dashboard') return '';
		if (pathname.startsWith('/dashboard/flota')) return 'flota';
		if (pathname.startsWith('/dashboard/conductores')) return 'conductores';
		if (pathname.startsWith('/dashboard/servicios')) return 'servicios';
		if (pathname.startsWith('/dashboard/recargos')) return 'recargos';
		if (pathname.startsWith('/dashboard/asistencias')) return 'asistencias';
		if (pathname.startsWith('/dashboard/acciones-correctivas')) return 'acciones-correctivas';
		if (pathname.startsWith('/dashboard/evaluaciones')) return 'evaluaciones';
		if (pathname.startsWith('/dashboard/salidas-nc')) return 'salidas-nc';
		if (pathname.startsWith('/dashboard/clientes')) return 'clientes';
		if (pathname.startsWith('/dashboard/nomina')) return 'nomina';
		if (pathname.startsWith('/dashboard/extractos')) return 'extractos';
		if (pathname.startsWith('/dashboard/liquidaciones-servicios')) return 'liquidaciones-servicios';
		if (pathname.startsWith('/dashboard/liquidaciones-terceros')) return 'liquidaciones-terceros';
		if (pathname.startsWith('/dashboard/sarlaft')) return 'sarlaft';
		if (pathname.startsWith('/dashboard/pesv')) return 'pesv';
		if (pathname.startsWith('/dashboard/contabilidad')) return 'contabilidad';
		if (pathname.startsWith('/dashboard/terceros')) return 'terceros';
		if (pathname.startsWith('/dashboard/usuarios')) return 'usuarios';
		if (pathname.startsWith('/dashboard/sesiones')) return 'usuarios';
		if (pathname.startsWith('/dashboard/directorio')) return 'usuarios';
		if (pathname.startsWith('/dashboard/perfil')) return 'perfil';
		return '';
	}

	$: pageTitle = PAGE_LABELS[getActiveSectionFromPath($page.url.pathname)] || 'Dashboard';

	let showUserMenu = false;
	let showNotifications = false;
	let showAllNotifications = false;

	let isMobile = false;
	onMount(() => {
		const checkMobile = () => {
			isMobile = window.innerWidth < 768;
		};
		checkMobile();
		window.addEventListener('resize', checkMobile);
		return () => window.removeEventListener('resize', checkMobile);
	});

	// Full notifications modal state
	let allNotifs: Notificacion[] = [];
	let allNotifsTotal = 0;
	let allNotifsPage = 1;
	let allNotifsTotalPages = 1;
	let allNotifsLoading = false;

	$: notifState = $notificacionesStore;
	$: noLeidas = notifState.noLeidas;
	$: notificaciones = notifState.items.filter(n => !n.leida);

	// Socket listener para nueva-notificacion
	function handleNuevaNotificacion(data: any) {
		const userId = $authStore.user?.id;
		if (!userId) return;
		// Solo agregar si es para este usuario
		if (data.usuario_id === userId) {
			notificacionesStore.agregarNotificacion(data as Notificacion);
		}
	}

	onMount(() => {
		notificacionesStore.cargar();
		notificacionesStore.iniciarPolling();
		socketUtils.on('nueva-notificacion', handleNuevaNotificacion);
	});

	onDestroy(() => {
		notificacionesStore.detenerPolling();
		socketUtils.off('nueva-notificacion', handleNuevaNotificacion);
	});

	function handleLogout() {
		dispatch('logout');
		showUserMenu = false;
	}

	function toggleUserMenu() {
		showUserMenu = !showUserMenu;
		showNotifications = false;
	}

	function toggleNotifications() {
		showNotifications = !showNotifications;
		showUserMenu = false;
		// Al abrir, recargar
		if (showNotifications) {
			notificacionesStore.cargar();
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.user-menu') && !target.closest('.notifications-menu') && !target.closest('[data-bottom-sheet]')) {
			showUserMenu = false;
			showNotifications = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			showUserMenu = false;
			showNotifications = false;
			showAllNotifications = false;
		}
	}

	function marcarTodasLeidas() {
		notificacionesStore.marcarTodasLeidas();
	}

	async function handleNotifClick(notif: Notificacion) {
		// Marcar como leída
		if (!notif.leida) {
			await notificacionesStore.marcarLeida(notif.id);
		}
		showNotifications = false;
		showAllNotifications = false;

		// Navegar según referencia_tipo
		if (notif.referencia_id) {
			if (notif.referencia_tipo === 'actividad_pesv') {
				goto('/dashboard/pesv');
			} else if (notif.tipo.startsWith('LIQUIDACION_')) {
				goto('/dashboard/liquidaciones-servicios');
			}
		}
	}

	async function abrirTodasNotificaciones() {
		showNotifications = false;
		showAllNotifications = true;
		allNotifsPage = 1;
		await cargarTodasNotificaciones();
	}

	async function cargarTodasNotificaciones() {
		allNotifsLoading = true;
		try {
			const res = await notificacionesApi.listar(allNotifsPage, 20);
			allNotifs = res.notificaciones;
			allNotifsTotal = res.total;
			allNotifsTotalPages = res.totalPages;
		} catch (e) {
			console.error('Error cargando todas las notificaciones:', e);
		} finally {
			allNotifsLoading = false;
		}
	}

	async function cambiarPaginaNotifs(p: number) {
		if (p < 1 || p > allNotifsTotalPages) return;
		allNotifsPage = p;
		await cargarTodasNotificaciones();
	}

	function timeAgo(dateStr: string): string {
		const now = Date.now();
		const date = new Date(dateStr).getTime();
		const diff = now - date;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Ahora';
		if (mins < 60) return `${mins} min`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		const days = Math.floor(hrs / 24);
		return `${days}d`;
	}

	function formatDateFull(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('es-CO', {
			day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
		});
	}

	function getNotifIcon(tipo: string): string {
		switch (tipo) {
			case 'LIQUIDACION_ANULADA': return '🚫';
			case 'LIQUIDACION_PENDIENTE': return '📋';
			case 'LIQUIDACION_CREADA': return '🆕';
			case 'LIQUIDACION_ACTUALIZADA': return '✏️';
			case 'ACTIVIDAD_PESV_ASIGNADA': return '📌';
			case 'ACTIVIDAD_PESV_ACTUALIZADA': return '🔄';
			case 'ACTIVIDAD_PESV_VENCIDA': return '⏰';
			default: return '🔔';
		}
	}
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<header
	class="no-print apple-transition fixed top-0 right-0 left-0 z-35 h-16 border-b {isCollapsed
		? 'lg:left-20'
		: 'lg:left-64'}"
	style="background-color: var(--bg-surface); border-color: var(--border-subtle);"
	in:fly={{ y: -20, duration: 400, delay: 300 }}
>
	<div class="flex h-full items-center justify-between gap-3 px-4 md:px-6 lg:pl-6">
		<!-- Left cluster: burger (mobile/tablet) + title -->
		<div class="flex min-w-0 flex-1 items-center gap-2" in:fade={{ duration: 600, delay: 400 }}>
			<!-- Burger menu (mobile/tablet only) — profesonal, dentro del flow -->
			<button
				type="button"
				class="apple-transition btn-icon lg:hidden"
				on:click={() => mobileDrawerStore.toggle()}
				aria-label="Abrir menú"
				aria-expanded={$mobileDrawerStore}
			>
				{#if $mobileDrawerStore}
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				{:else}
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				{/if}
			</button>

			<h1 class="font-display truncate text-xl md:text-2xl" style="color: var(--bg-charcoal); font-weight: 700;">{pageTitle}</h1>
		</div>

		<!-- Right Section -->
		<div class="flex shrink-0 items-center space-x-2 md:space-x-3" in:fade={{ duration: 600, delay: 500 }}>
			<!-- Session Timer (opcional) -->
			<SessionTimer showTimer={showSessionTimer} />

			<!-- Notifications -->
			<div class="relative notifications-menu">
				<button
					class="apple-transition btn-icon relative"
					on:click={toggleNotifications}
					aria-label="Notificaciones"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
					</svg>
					{#if noLeidas > 0}
						<span class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
							{noLeidas > 9 ? '9+' : noLeidas}
						</span>
					{/if}
				</button>

				<!-- Notifications Panel: dropdown en md+ (mobile usa bottom sheet fuera del header) -->
				{#if showNotifications && !isMobile}
					<div
						class="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border bg-white"
						style="border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0,0,0,0.06);"
						in:fly={{ y: -10, duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<div class="p-4" style="border-bottom: 1px solid var(--border-subtle);">
							<div class="flex items-center justify-between">
								<h3 class="font-semibold" style="color: var(--text-primary);">Notificaciones</h3>
								{#if noLeidas > 0}
									<button
										class="apple-transition text-sm"
										style="color: var(--emerald-600);"
										on:click={marcarTodasLeidas}
									>
										Marcar todas como leídas
									</button>
								{/if}
							</div>
						</div>
						<div class="max-h-96 overflow-y-auto">
							{#if notificaciones.length === 0}
								<div class="p-6 text-center text-sm" style="color: var(--text-very-muted);">
									<div class="mb-2 text-2xl">🔔</div>
									No tienes notificaciones
								</div>
							{:else}
								{#each notificaciones as notif (notif.id)}
									<button
										class="apple-transition w-full p-4 text-left {notif.leida ? '' : ''}"
										style="border-bottom: 1px solid var(--border-subtle); background-color: {notif.leida ? 'transparent' : 'rgba(16,185,129,0.04)'};"
										on:click={() => handleNotifClick(notif)}
									>
										<div class="flex items-start gap-3">
											<span class="mt-0.5 text-lg">{getNotifIcon(notif.tipo)}</span>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium" style="color: var(--text-primary);">
													{notif.titulo}
												</p>
												<p class="mt-1 line-clamp-2 text-sm" style="color: var(--text-secondary);">
													{notif.mensaje}
												</p>
												<p class="mt-2 text-xs" style="color: var(--text-very-muted);">
													{timeAgo(notif.created_at)}
												</p>
											</div>
											{#if !notif.leida}
												<div class="ml-2 mt-2 h-2 w-2 flex-shrink-0 rounded-full" style="background-color: var(--emerald-500);"></div>
											{/if}
										</div>
									</button>
								{/each}
							{/if}
						</div>
						<div class="p-2" style="border-top: 1px solid var(--border-subtle);">
							<button
								class="apple-transition w-full rounded-xl py-2 text-center text-sm font-medium"
								style="color: var(--emerald-600);"
								on:click={abrirTodasNotificaciones}
							>
								Ver todas las notificaciones
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- User Menu -->
			<div class="user-menu relative">
				<button
					class="apple-transition group flex items-center space-x-3 rounded-xl p-2"
					style="color: var(--text-secondary);"
					on:click={toggleUserMenu}
					aria-label="Menú de usuario"
				>
					<!-- Avatar -->
					<div
						class="brand-gradient flex h-9 w-9 items-center justify-center rounded-full"
						style="box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);"
					>
						<span class="text-sm font-semibold text-white">
							{userName.charAt(0).toUpperCase()}
						</span>
					</div>

					<!-- User Info (Hidden on small screens) -->
					<div class="hidden min-w-0 text-left md:block">
						<p class="truncate text-sm font-semibold" style="color: var(--text-primary);">{userName}</p>
						<p class="truncate text-xs" style="color: var(--text-muted);">{userRole}</p>
					</div>

					<!-- Chevron -->
					<svg
						class="apple-transition h-4 w-4 {showUserMenu
							? 'rotate-180'
							: ''}"
						style="color: var(--text-very-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>

				<!-- User Dropdown (md+) -->
				{#if showUserMenu && !isMobile}
					<div
						class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border bg-white"
						style="border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0,0,0,0.06);"
						in:fly={{ y: -10, duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<div class="p-4" style="background: linear-gradient(135deg, rgba(16,185,129,0.04), rgba(16,185,129,0.08)); border-bottom: 1px solid var(--border-subtle);">
							<div class="flex items-center space-x-3">
								<div class="brand-gradient flex h-12 w-12 items-center justify-center rounded-xl" style="box-shadow: 0 4px 16px rgba(249, 115, 22, 0.25);">
									<span class="font-display text-lg font-medium text-white">{userName.charAt(0).toUpperCase()}</span>
								</div>
								<div class="min-w-0">
									<p class="truncate font-semibold" style="color: var(--text-primary);">{userName}</p>
									<p class="truncate text-sm" style="color: var(--text-secondary);">{userEmail}</p>
									<span class="mt-1 inline-block rounded-full px-2 py-0.5 text-xs" style="background: rgba(16,185,129,0.08); color: var(--emerald-800);">{userRole}</span>
								</div>
							</div>
						</div>
						<div class="p-2">
							<button class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left" style="color: var(--text-secondary);" on:click={() => { showUserMenu = false; goto('/dashboard/perfil'); }}>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
								Perfil
							</button>
							<button class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left" style="color: var(--text-secondary);">
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
								Configuración
							</button>
							<button class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left" style="color: var(--text-secondary);">
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
								Ayuda
							</button>
							<div class="my-2" style="border-top: 1px solid var(--border-subtle);"></div>
							<button class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left" style="color: #dc2626;" on:click={handleLogout}>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
								Cerrar Sesión
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</header>

<!-- ─── Bottom Sheets (mobile, fuera del header fixed) ─────────────────────── -->

{#if showNotifications && isMobile}
	<div
		class="fixed inset-0 z-[100] bg-black/50"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		on:click|self={() => (showNotifications = false)}
		on:keydown={(e) => e.key === 'Escape' && (showNotifications = false)}
		transition:fade={{ duration: 200 }}
	>
		<div
			data-bottom-sheet
			class="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl"
			in:fly={{ y: 600, duration: 300 }}
			out:fly={{ y: 600, duration: 200 }}
		>
			<div class="relative flex items-center justify-center p-4" style="border-bottom: 1px solid var(--border-subtle);">
				<div class="h-1 w-12 rounded-full" style="background-color: var(--border-default);"></div>
				<button
					class="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg"
					style="color: var(--text-muted);"
					on:click={() => (showNotifications = false)}
					aria-label="Cerrar"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="flex items-center justify-between px-4 pb-4" style="border-bottom: 1px solid var(--border-subtle);">
				<h3 class="font-semibold" style="color: var(--text-primary);">Notificaciones</h3>
				{#if noLeidas > 0}
					<button class="apple-transition text-sm font-medium" style="color: var(--emerald-600);" on:click={marcarTodasLeidas}>Marcar todas</button>
				{/if}
			</div>
			<div class="flex-1 overflow-y-auto">
				{#if notificaciones.length === 0}
					<div class="p-8 text-center text-sm" style="color: var(--text-very-muted);">
						<div class="mb-2 text-3xl">🔔</div>
						No tienes notificaciones
					</div>
				{:else}
					{#each notificaciones as notif (notif.id)}
						<button class="apple-transition w-full p-4 text-left" style="border-bottom: 1px solid var(--border-subtle); background-color: {notif.leida ? 'transparent' : 'rgba(16,185,129,0.04)'};" on:click={() => handleNotifClick(notif)}>
							<div class="flex items-start gap-3">
								<span class="mt-0.5 text-lg">{getNotifIcon(notif.tipo)}</span>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium" style="color: var(--text-primary);">{notif.titulo}</p>
									<p class="mt-1 line-clamp-2 text-sm" style="color: var(--text-secondary);">{notif.mensaje}</p>
									<p class="mt-2 text-xs" style="color: var(--text-very-muted);">{timeAgo(notif.created_at)}</p>
								</div>
								{#if !notif.leida}
									<div class="ml-2 mt-2 h-2 w-2 flex-shrink-0 rounded-full" style="background-color: var(--emerald-500);"></div>
								{/if}
							</div>
						</button>
					{/each}
				{/if}
			</div>
			<div class="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" style="border-top: 1px solid var(--border-subtle);">
				<button class="apple-transition w-full rounded-xl py-3 text-center text-sm font-medium" style="color: var(--emerald-600);" on:click={abrirTodasNotificaciones}>
					Ver todas las notificaciones
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showUserMenu && isMobile}
	<div
		class="fixed inset-0 z-[100] bg-black/50"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		on:click|self={() => (showUserMenu = false)}
		on:keydown={(e) => e.key === 'Escape' && (showUserMenu = false)}
		transition:fade={{ duration: 200 }}
	>
		<div
			data-bottom-sheet
			class="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl"
			in:fly={{ y: 600, duration: 300 }}
			out:fly={{ y: 600, duration: 200 }}
		>
			<div class="relative flex items-center justify-center p-4" style="border-bottom: 1px solid var(--border-subtle);">
				<div class="h-1 w-12 rounded-full" style="background-color: var(--border-default);"></div>
				<button
					class="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg"
					style="color: var(--text-muted);"
					on:click={() => (showUserMenu = false)}
					aria-label="Cerrar"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="overflow-y-auto p-4" style="background: linear-gradient(135deg, rgba(16,185,129,0.04), rgba(16,185,129,0.08));">
				<div class="flex items-center space-x-3">
					<div class="brand-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style="box-shadow: 0 4px 16px rgba(249, 115, 22, 0.25);">
						<span class="font-display text-lg font-medium text-white">{userName.charAt(0).toUpperCase()}</span>
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate font-semibold" style="color: var(--text-primary);">{userName}</p>
						<p class="truncate text-sm" style="color: var(--text-secondary);">{userEmail}</p>
						<span class="mt-1 inline-block rounded-full px-2 py-0.5 text-xs" style="background: rgba(16,185,129,0.08); color: var(--emerald-800);">{userRole}</span>
					</div>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto p-2">
				<button class="apple-transition flex w-full items-center rounded-xl px-3 py-3 text-left text-base" style="color: var(--text-secondary);" on:click={() => { showUserMenu = false; goto('/dashboard/perfil'); }}>
					<svg class="mr-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
					Perfil
				</button>
				<button class="apple-transition flex w-full items-center rounded-xl px-3 py-3 text-left text-base" style="color: var(--text-secondary);">
					<svg class="mr-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
					Configuración
				</button>
				<button class="apple-transition flex w-full items-center rounded-xl px-3 py-3 text-left text-base" style="color: var(--text-secondary);">
					<svg class="mr-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					Ayuda
				</button>
				<div class="my-2" style="border-top: 1px solid var(--border-subtle);"></div>
				<button class="apple-transition flex w-full items-center rounded-xl px-3 py-3 text-left text-base" style="color: #dc2626;" on:click={handleLogout}>
					<svg class="mr-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
					Cerrar Sesión
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Full Notifications Modal -->
{#if showAllNotifications}
	<div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" tabindex="-1" on:click|self={() => showAllNotifications = false} on:keydown={e => e.key === 'Escape' && (showAllNotifications = false)} transition:fade={{ duration: 200 }}>
		<div class="confirm-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden" in:fly={{ y: 30, duration: 300 }}>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4" style="border-bottom: 1px solid var(--border-subtle);">
				<h2 class="font-display text-lg" style="color: var(--bg-charcoal);">🔔 Todas las Notificaciones</h2>
				<div class="flex items-center gap-2">
					{#if noLeidas > 0}
						<button class="rounded-lg px-3 py-1.5 text-sm font-medium" style="color: var(--emerald-600);" on:click={marcarTodasLeidas}>
							Marcar todas como leídas
						</button>
					{/if}
					<button class="flex h-8 w-8 items-center justify-center rounded-lg" style="color: var(--text-muted);" on:click={() => showAllNotifications = false}>✕</button>
				</div>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto">
				{#if allNotifsLoading}
					<div class="flex items-center justify-center py-12">
						<div class="spinner"></div>
					</div>
				{:else if allNotifs.length === 0}
					<div class="py-12 text-center" style="color: var(--text-very-muted);">
						<span class="text-3xl">🔔</span>
						<p class="mt-2">No hay notificaciones</p>
					</div>
				{:else}
					{#each allNotifs as notif (notif.id)}
						<button
							class="w-full px-6 py-4 text-left apple-transition"
							style="border-bottom: 1px solid var(--border-subtle); background-color: {notif.leida ? 'transparent' : 'rgba(16,185,129,0.04)'};"
							on:click={() => handleNotifClick(notif)}
						>
							<div class="flex items-start gap-3">
								<span class="mt-0.5 text-lg">{getNotifIcon(notif.tipo)}</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<p class="text-sm font-medium" style="color: var(--text-primary);">{notif.titulo}</p>
										{#if !notif.leida}
											<span class="h-2 w-2 flex-shrink-0 rounded-full" style="background-color: var(--emerald-500);"></span>
										{/if}
									</div>
									<p class="mt-1 text-sm" style="color: var(--text-secondary);">{notif.mensaje}</p>
									<p class="mt-1 text-xs" style="color: var(--text-very-muted);">{formatDateFull(notif.created_at)}</p>
								</div>
							</div>
						</button>
					{/each}
				{/if}
			</div>

			<!-- Pagination -->
			{#if allNotifsTotalPages > 1}
				<div class="flex items-center justify-between px-6 py-3" style="border-top: 1px solid var(--border-subtle);">
					<span class="text-xs" style="color: var(--text-muted);">Página {allNotifsPage} de {allNotifsTotalPages} ({allNotifsTotal} total)</span>
					<div class="flex gap-1">
						<button class="rounded-lg border px-3 py-1 text-sm disabled:opacity-40" style="border-color: var(--border-default);" disabled={allNotifsPage === 1} on:click={() => cambiarPaginaNotifs(allNotifsPage - 1)}>←</button>
						<button class="rounded-lg border px-3 py-1 text-sm disabled:opacity-40" style="border-color: var(--border-default);" disabled={allNotifsPage === allNotifsTotalPages} on:click={() => cambiarPaginaNotifs(allNotifsPage + 1)}>→</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
