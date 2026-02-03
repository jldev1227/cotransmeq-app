<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import SessionTimer from './SessionTimer.svelte';

	const dispatch = createEventDispatcher();

	export let userName = 'Usuario';
	export let userEmail = 'usuario@cotransmeq.com';
	export let userRole = 'Administrador';
	export let isCollapsed = false;
	export let showSessionTimer = false; // Prop para mostrar/ocultar el timer

	let showUserMenu = false;
	let showNotifications = false;

	const notifications = [
		{
			id: 1,
			title: 'Nuevo conductor registrado',
			message: 'Juan Pérez se ha unido al equipo',
			time: '5 min ago',
			unread: true
		},
		{
			id: 2,
			title: 'Ruta completada',
			message: 'Ruta Centro-Norte finalizada exitosamente',
			time: '1 hora ago',
			unread: true
		},
		{
			id: 3,
			title: 'Mantenimiento programado',
			message: 'Vehículo TM-001 necesita revisión',
			time: '2 horas ago',
			unread: false
		}
	];

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
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.user-menu') && !target.closest('.notifications-menu')) {
			showUserMenu = false;
			showNotifications = false;
		}
	}

	// Cerrar menús con Escape
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			showUserMenu = false;
			showNotifications = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<header
	class="apple-transition fixed top-0 right-0 left-0 z-30 h-16 border-b border-gray-200/50 bg-white/80 backdrop-blur-lg backdrop-filter {isCollapsed
		? 'lg:left-20'
		: 'lg:left-64'}"
	in:fly={{ y: -20, duration: 400, delay: 300 }}
>
	<div class="flex h-full items-center justify-between px-4 pl-16 md:px-6 lg:pl-6">
		<!-- Search and Title - Ajustado para mobile -->
		<div class="flex flex-1 items-center" in:fade={{ duration: 600, delay: 400 }}>
			<div class="flex items-center space-x-2 md:space-x-4">
				<h1 class="text-base font-semibold text-gray-900 md:text-xl">Dashboard</h1>
				<!-- <div class="hidden md:block w-px h-6 bg-gray-300"></div>
				<div class="hidden md:flex items-center bg-gray-100/80 rounded-xl px-4 py-2 min-w-0 max-w-md apple-transition focus-within:bg-gray-100 focus-within:ring-2 focus-within:ring-orange-400/20">
					<svg class="w-4 h-4 text-gray-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						placeholder="Buscar vehículos, conductores..."
						class="bg-transparent flex-1 outline-none text-gray-700 placeholder-gray-400 min-w-0"
					/>
				</div> -->
			</div>
		</div>

		<!-- Right Section -->
		<div class="flex items-center space-x-3" in:fade={{ duration: 600, delay: 500 }}>
			<!-- Session Timer (opcional) -->
			<SessionTimer showTimer={showSessionTimer} />

			<!-- Notifications -->
			<!-- <div class="relative notifications-menu">
				<button
					class="p-2 text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-xl apple-transition relative"
					on:click={toggleNotifications}
					aria-label="Notificaciones"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
					</svg>
					<span class="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full flex items-center justify-center">
						<span class="w-1.5 h-1.5 bg-white rounded-full"></span>
					</span>
				</button>
				
				<!-- Notifications Dropdown -->
			<!-- {#if showNotifications}
					<div 
						class="absolute right-0 mt-2 w-80 glass rounded-2xl soft-shadow border border-gray-200/50 overflow-hidden z-50"
						in:fly={{ y: -10, duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<div class="p-4 border-b border-gray-200/50">
							<div class="flex items-center justify-between">
								<h3 class="font-semibold text-gray-900">Notificaciones</h3>
								<button class="text-sm text-orange-600 hover:text-orange-700 apple-transition">
									Marcar todas como leídas
								</button>
							</div>
						</div>
						<div class="max-h-96 overflow-y-auto">
							{#each notifications as notification}
								<div class="p-4 border-b border-gray-200/30 hover:bg-orange-50/50 apple-transition {notification.unread ? 'bg-orange-50/30' : ''}">
									<div class="flex items-start justify-between">
										<div class="flex-1 min-w-0">
											<p class="text-sm font-medium text-gray-900 truncate">
												{notification.title}
											</p>
											<p class="text-sm text-gray-600 mt-1">
												{notification.message}
											</p>
											<p class="text-xs text-gray-400 mt-2">
												{notification.time}
											</p>
										</div>
										{#if notification.unread}
											<div class="w-2 h-2 bg-orange-500 rounded-full ml-3 mt-2 flex-shrink-0"></div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if} -->
			<!-- </div> -->

			<!-- User Menu -->
			<div class="user-menu relative">
				<button
					class="apple-transition group flex items-center space-x-3 rounded-xl p-2 hover:bg-orange-50"
					on:click={toggleUserMenu}
					aria-label="Menú de usuario"
				>
					<!-- Avatar -->
					<div
						class="soft-shadow flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<span class="text-sm font-semibold text-white">
							{userName.charAt(0).toUpperCase()}
						</span>
					</div>

					<!-- User Info (Hidden on small screens) -->
					<div class="hidden min-w-0 text-left md:block">
						<p class="truncate text-sm font-semibold text-gray-900">{userName}</p>
						<p class="truncate text-xs text-gray-500">{userRole}</p>
					</div>

					<!-- Chevron -->
					<svg
						class="apple-transition h-4 w-4 text-gray-400 group-hover:text-orange-600 {showUserMenu
							? 'rotate-180'
							: ''}"
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

				<!-- User Dropdown -->
				{#if showUserMenu}
					<div
						class="glass soft-shadow absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200/50"
						in:fly={{ y: -10, duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<!-- User Profile Header -->
						<div
							class="border-b border-gray-200/50 bg-gradient-to-r from-orange-50 to-orange-100/50 p-4"
						>
							<div class="flex items-center space-x-3">
								<div
									class="soft-shadow flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
								>
									<span class="font-semibold text-white">
										{userName.charAt(0).toUpperCase()}
									</span>
								</div>
								<div class="min-w-0">
									<p class="truncate font-semibold text-gray-900">{userName}</p>
									<p class="truncate text-sm text-gray-600">{userEmail}</p>
									<span
										class="mt-1 inline-block rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-700"
									>
										{userRole}
									</span>
								</div>
							</div>
						</div>

						<!-- Menu Items -->
						<div class="p-2">
							<button
								class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left text-gray-700 hover:bg-orange-50 hover:text-orange-700"
							>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									/>
								</svg>
								Perfil
							</button>
							<button
								class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left text-gray-700 hover:bg-orange-50 hover:text-orange-700"
							>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
								</svg>
								Configuración
							</button>
							<button
								class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left text-gray-700 hover:bg-orange-50 hover:text-orange-700"
							>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								Ayuda
							</button>

							<div class="my-2 border-t border-gray-200/50"></div>

							<button
								class="apple-transition flex w-full items-center rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700"
								on:click={handleLogout}
							>
								<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
									/>
								</svg>
								Cerrar Sesión
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</header>
