<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, slide, scale } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess, AREA_LABELS, type Area } from '$lib/config/permissions';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';
	import { MENU_ITEMS, type MenuItem } from '$lib/config/menu';
	import SidebarIcon, {
		SIDEBAR_ICON_SIZE,
		SIDEBAR_ICON_STROKE
	} from '$lib/components/SidebarIcon.svelte';
	import { ChevronsLeft } from 'lucide-svelte';

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

	/// La cabecera del cajón es la del menú de la app móvil: saludo, primer
	/// nombre, fecha de hoy y el área, sobre el verde de marca. No lleva botón
	/// de cerrar: el cajón se cierra tocando el fondo, como en cualquier cajón.
	function primerNombre(nombre: string | undefined | null): string {
		const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
		return primero
			? primero.charAt(0).toLocaleUpperCase('es') + primero.slice(1).toLocaleLowerCase('es')
			: 'Equipo';
	}

	function saludo(hora: number): string {
		if (hora < 12) return 'Buenos días';
		if (hora < 19) return 'Buenas tardes';
		return 'Buenas noches';
	}

	$: hoy = (() => {
		const t = new Date().toLocaleDateString('es-CO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		return t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
	})();

	$: areasUsuario = (() => {
		const a = currentUser?.area as unknown;
		const lista = Array.isArray(a) ? a : a ? [a] : [];
		return lista.map((x) => AREA_LABELS[x as Area] ?? String(x));
	})();
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
					class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl py-2.5
						{isCollapsed ? 'justify-center px-2' : 'px-3'}
						{activeSection === item.id ? 'text-white' : 'hover:bg-white/5'}"
					style="color: {activeSection === item.id ? '#ffffff' : 'rgba(255, 255, 255,0.65)'};
						background-color: {activeSection === item.id ? 'rgba(255,255,255,0.14)' : 'transparent'};
						border: 1px solid {activeSection === item.id ? 'rgba(255,255,255,0.28)' : 'transparent'};"
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
			<!-- Cabecera: la del menú de la app móvil. Sin botón de cerrar. -->
			<div class="cajon-cabecera">
				<span class="cajon-orbe cajon-orbe--grande" aria-hidden="true"></span>
				<span class="cajon-orbe cajon-orbe--chico" aria-hidden="true"></span>
				<div class="cajon-copy">
					<span class="cajon-eyebrow">Sistema de gestión</span>
					<span class="cajon-saludo">{saludo(new Date().getHours())},</span>
					<span class="cajon-nombre">{primerNombre(currentUser?.nombre)}</span>
					<span class="cajon-hoy">{hoy}</span>
					{#if areasUsuario.length}
						<span class="cajon-areas">
							{#each areasUsuario as area (area)}
								<span class="cajon-area">{area}</span>
							{/each}
						</span>
					{/if}
				</div>
			</div>

			<!-- Navigation Menu -->
			<nav class="flex-1 space-y-1 overflow-y-auto p-4">
				{#each filteredMenuItems as item (item.id)}
					<button
						class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-2.5"
						style="color: {activeSection === item.id ? '#ffffff' : 'rgba(255, 255, 255,0.65)'};
							background-color: {activeSection === item.id ? 'rgba(255,255,255,0.14)' : 'transparent'};
							border: 1px solid {activeSection === item.id ? 'rgba(255,255,255,0.28)' : 'transparent'};"
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

<style>
	/* ── Cabecera del cajón móvil ── */
	.cajon-cabecera {
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
		padding: calc(env(safe-area-inset-top, 0px) + 1.35rem) 1.35rem 1.35rem;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 100%);
	}
	.cajon-orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
	}
	.cajon-orbe--grande {
		width: 150px;
		height: 150px;
		right: -40px;
		top: -60px;
	}
	.cajon-orbe--chico {
		width: 70px;
		height: 70px;
		left: -22px;
		bottom: -30px;
	}
	.cajon-copy {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.cajon-eyebrow {
		margin-bottom: 6px;
		font-size: 0.58rem;
		font-weight: 900;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.cajon-saludo {
		font-size: 0.82rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.8);
	}
	.cajon-nombre {
		font-size: 1.4rem;
		font-weight: 900;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cajon-hoy {
		margin-top: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.75);
	}
	.cajon-areas {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
	}
	.cajon-area {
		padding: 3px 9px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		font-size: 0.68rem;
		font-weight: 700;
		color: #fff;
	}
</style>
