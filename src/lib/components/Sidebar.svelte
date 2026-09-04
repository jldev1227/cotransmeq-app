<script lang="ts">
	import { createEventDispatcher, type ComponentType } from 'svelte';
	import { fade, fly, slide, scale } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess, type Area } from '$lib/config/permissions';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';
	import SidebarIcon, {
		SIDEBAR_ICON_SIZE,
		SIDEBAR_ICON_STROKE
	} from '$lib/components/SidebarIcon.svelte';
	/**
	 * Iconos del sidebar.
	 *
	 * Regla al elegir uno: a 18 px lo que se distingue es la SILUETA, no el
	 * detalle. Dos variantes del mismo glifo base —`ClipboardList` y
	 * `ClipboardCheck`, `CalendarClock` y `CalendarCheck`, `Users` y `UserCog`—
	 * son la misma mancha gris, y el usuario acaba leyendo la etiqueta cada vez,
	 * que es tanto como no tener icono.
	 *
	 * Así que ninguna familia repite base: hay UN calendario, UN portapapeles,
	 * UNA silueta de persona genérica. Cuando dos módulos caían en la misma
	 * familia, gana el que la use de forma más literal y el otro se mueve a un
	 * glifo que además dice mejor qué hace.
	 */
	import {
		BookUser,
		Building2,
		Calculator,
		CalendarCheck,
		ChevronsLeft,
		ClipboardPen,
		HandCoins,
		IdCard,
		LayoutTemplate,
		ListChecks,
		ReceiptText,
		Route,
		ShieldCheck,
		Timer,
		TrafficCone,
		TriangleAlert,
		Truck,
		UserCog,
		Wallet,
		Wrench,
		X
	} from 'lucide-svelte';

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

	type MenuItem = {
		id: string;
		label: string;
		/// Componente de `lucide-svelte`, no un nombre de icono. Antes esto era una
		/// cadena que `getIcon()` resolvía contra un mapa de SVG escritos a mano e
		/// inyectados con `{@html}`: un `icon` mal escrito renderizaba un hueco en
		/// silencio. Con el componente, eso es un error de compilación.
		icon: ComponentType;
		badge: string | null;
		href: string;
	};

	const menuItems: MenuItem[] = [
		// {
		// 	id: 'dashboard',
		// 	label: 'Dashboard',
		// 	icon: LayoutDashboard,
		// 	badge: null,
		// 	href: '/dashboard'
		// },
		{
			id: 'flota',
			label: 'Flota',
			icon: Truck,
			badge: null,
			href: '/dashboard/flota'
		},
		{
			id: 'conductores',
			label: 'Conductores',
			/// Licencia, no «personas»: `Users` era la silueta genérica y competía
			/// con `UserCog` de Equipo. Un conductor se identifica por su pase.
			icon: IdCard,
			badge: null,
			href: '/dashboard/conductores'
		},
		{
			id: 'servicios',
			label: 'Servicios',
			/// Un reloj describía la planilla, no el servicio. `Route` es el trayecto,
			/// que es lo que se despacha aquí, y deja el reloj libre para «Recargos»,
			/// donde el tiempo sí es lo que se liquida.
			icon: Route,
			// badge: '8',
			badge: null,
			href: '/dashboard/servicios'
		},
		{
			id: 'recargos',
			label: 'Recargos',
			/// Un recargo es tiempo (nocturno, festivo, extra), no una fecha del
			/// calendario. Además deja `CalendarCheck` de Asistencias como el
			/// único calendario del menú.
			icon: Timer,
			badge: null,
			href: '/dashboard/recargos'
		},
		{
			id: 'clientes',
			label: 'Clientes',
			icon: Building2,
			badge: null,
			href: '/dashboard/clientes'
		},
		{
			id: 'sarlaft',
			label: 'SARLAFT / PTEE',
			/// Lupa sobre documento: el módulo es debida diligencia sobre terceros,
			/// no el archivo genérico que sugería el icono de documento.
			/// SARLAFT/PTEE es cumplimiento y prevención de riesgo, no búsqueda
			/// documental. `FileSearch` además se confundía con `FileStack`.
			icon: ShieldCheck,
			badge: null,
			href: '/dashboard/sarlaft'
		},
		{
			id: 'asistencias',
			label: 'Asistencias',
			icon: CalendarCheck,
			badge: null,
			href: '/dashboard/asistencias'
		},
		{
			id: 'acciones-correctivas',
			label: 'Acciones C/P',
			/// Antes compartía escudo con PESV y los dos se leían como «seguridad».
			/// Una acción correctiva es una reparación: la llave inglesa lo separa.
			icon: Wrench,
			badge: null,
			href: '/dashboard/acciones-correctivas'
		},
		{
			id: 'evaluaciones',
			label: 'Evaluaciones',
			/// Lista de criterios calificados. Sin portapapeles: ese glifo queda
			/// para «Mis formularios», que es donde de verdad se diligencia.
			icon: ListChecks,
			badge: null,
			href: '/dashboard/evaluaciones'
		},
		{
			id: 'salidas-nc',
			label: 'Salidas NC',
			icon: TriangleAlert,
			badge: null,
			href: '/dashboard/salidas-nc'
		},
		{
			id: 'formularios',
			label: 'Formularios',
			/// El CONSTRUCTOR: se arman plantillas colocando bloques. Distinguirlo
			/// de «Mis formularios» importa más que ningún otro par del menú,
			/// porque son el mismo dominio visto desde los dos lados —quien
			/// diseña el formato y quien lo rellena—.
			icon: LayoutTemplate,
			badge: null,
			href: '/dashboard/formularios'
		},
		{
			/**
			 * Entrada propia y no un enlace dentro de «Formularios».
			 *
			 * `formularios` es el módulo del constructor y solo lo tienen
			 * `administracion`/`hseq`/`operaciones`. `mis-formularios` es
			 * `general: true`, así que esta es la única entrada que ve alguien de
			 * contabilidad o mantenimiento a quien le asignaron un formato —y son
			 * exactamente las personas que necesitan llegar aquí—.
			 */
			id: 'mis-formularios',
			label: 'Mis formularios',
			/// Portapapeles con PLUMA: aquí se diligencia. `ClipboardCheck` era
			/// indistinguible del `ClipboardList` de Evaluaciones a este tamaño.
			icon: ClipboardPen,
			badge: null,
			href: '/dashboard/mis-formularios'
		},
		{
			id: 'nomina',
			label: 'Nómina',
			icon: Wallet,
			badge: null,
			/// El módulo ya no tiene listado: su puerta es el canvas.
			href: '/dashboard/nomina/canvas'
		},
		// {
		// 	id: 'extractos',
		// 	label: 'Extractos',
		// 	icon: FileText,
		// 	badge: null,
		// 	href: '/dashboard/extractos'
		// },
		{
			id: 'liquidaciones-servicios',
			label: 'Liq. Servicios',
			icon: ReceiptText,
			badge: null,
			/// Entra directo al canvas de historial, igual que «Liq. Terceros»: el
			/// listado de `/dashboard/liquidaciones-servicios` es la capa pre-Univer
			/// y sigue accesible por url, pero ya no es la puerta del módulo.
			href: '/dashboard/liquidaciones-servicios'
		},
		{
			id: 'liquidaciones-terceros',
			label: 'Liq. Terceros',
			/// «Liq. Servicios» y «Liq. Terceros» llevaban el mismo recibo, así que
			/// colapsado el menú eran indistinguibles. Terceros es el pago que sale
			/// hacia afuera; de ahí las monedas en la mano.
			icon: HandCoins,
			badge: null,
			href: '/dashboard/liquidaciones-terceros'
		},
		// «Liq. Terceros — Adicionales» se eliminó del menú: el canvas de
		// adicionales se abre desde el selector «Ir a…» del toolbar del canvas
		// de cierres, que es a donde /dashboard/liquidaciones-terceros redirige.
		// OJO: el moduleId `liquidaciones-terceros-adicionales` SIGUE existiendo en
		// `config/permissions.ts` porque el `+layout@.svelte` del canvas se lo pasa
		// a `UniverAuthGuard`, y `checkAccess` deniega todo moduleId desconocido.
		{
			id: 'pesv',
			label: 'PESV',
			/// Seguridad vial, no seguridad a secas: el cono lo dice sin repetir el
			/// escudo que ya usaban «Acciones C/P».
			icon: TrafficCone,
			badge: null,
			href: '/dashboard/pesv'
		},
		{
			id: 'certificados',
			label: 'Certificados',
			icon: Calculator,
			badge: null,
			href: '/dashboard/certificados'
		},
		{
			id: 'terceros',
			label: 'Terceros',
			icon: BookUser,
			badge: null,
			href: '/dashboard/terceros'
		},
		{
			id: 'usuarios',
			label: 'Equipo',
			/// La entrada cubre usuarios, sesiones y directorio: es administración de
			/// cuentas, y el engranaje la distingue de «Conductores», que también son
			/// personas pero no se gestionan aquí.
			icon: UserCog,
			badge: null,
			href: '/dashboard/usuarios'
		}
		// {
		// 	id: 'rutas',
		// 	label: 'Rutas',
		// 	icon: Map,
		// 	badge: null,
		// 	href: '/dashboard/rutas'
		// },
		// {
		// 	id: 'planillas',
		// 	label: 'Planillas',
		// 	icon: Calendar,
		// 	badge: '3',
		// 	href: '/dashboard/planillas'
		// }
		// {
		// 	id: 'reportes',
		// 	label: 'Reportes',
		// 	icon: ChartColumn,
		// 	badge: null,
		// 	href: '/dashboard/reportes'
		// },
		// {
		// 	id: 'configuracion',
		// 	label: 'Configuración',
		// 	icon: Settings,
		// 	badge: null,
		// 	href: '/dashboard/configuracion'
		// }
	];

	// Filtrar items del menú según permisos del usuario
	$: currentUser = $authStore.user;
	$: filteredMenuItems = menuItems.filter((item) => {
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
					style="color: {activeSection === item.id ? '#ffffff' : 'rgba(240,237,230,0.65)'};
						background-color: {activeSection === item.id ? 'rgba(249,115,22,0.18)' : 'transparent'};
						border: 1px solid {activeSection === item.id ? 'rgba(249,115,22,0.35)' : 'transparent'};"
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
				style="color: rgba(240,237,230,0.65);"
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
						<h2 class="truncate font-display text-lg text-white" style="font-weight: 400;">
							Cotransmeq
						</h2>
						<p class="text-xs" style="color: rgba(249,115,22,0.7);">Sistema de Gestión</p>
					</div>
				</div>
				<button
					type="button"
					class="apple-transition flex h-8 w-8 items-center justify-center rounded-lg"
					style="color: rgba(240,237,230,0.65);"
					on:click={closeDrawer}
					aria-label="Cerrar menú"
				>
					<X class="h-5 w-5" size={SIDEBAR_ICON_SIZE} strokeWidth={SIDEBAR_ICON_STROKE} />
				</button>
			</div>

			<!-- Navigation Menu -->
			<nav class="flex-1 space-y-1 overflow-y-auto p-4">
				{#each filteredMenuItems as item (item.id)}
					<button
						class="apple-transition group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-2.5"
						style="color: {activeSection === item.id ? '#ffffff' : 'rgba(240,237,230,0.65)'};
							background-color: {activeSection === item.id ? 'rgba(249,115,22,0.18)' : 'transparent'};
							border: 1px solid {activeSection === item.id ? 'rgba(249,115,22,0.35)' : 'transparent'};"
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
