<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import SessionTimer from './SessionTimer.svelte';
	import BuscadorModulos from './BuscadorModulos.svelte';
	import { notificacionesStore } from '$lib/stores/notificaciones';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils, socketStore, socketManager } from '$lib/socket';
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

	// ═══ Estado de la conexión en tiempo real ═══
	//
	// Vive aquí y no en un aviso flotante porque en escritorio y tablet el
	// header solo llevaba el nombre de la sección y dejaba media barra vacía,
	// mientras el estado del socket se anunciaba con un toast centrado que
	// tapaba contenido. En el header se ve siempre, sin robar sitio.
	//
	// El toast sigue existiendo en `dashboard/+layout.svelte` para móvil, donde
	// el header va justo de ancho y no cabe este indicador.
	$: socketEstado = $socketStore.estado;
	$: socketIntentos = $socketStore.intentos;
	$: socketProblema = socketEstado === 'reconectando' || socketEstado === 'rechazado';

	/// Colores de semáforo escritos a mano y NO tomados de la paleta.
	///
	/// `--emerald-*` se remapea a naranja en cotransmeq: correcto para la marca,
	/// equivocado para un estado. Verde/ámbar/rojo significan lo mismo en los
	/// dos productos y tienen que verse igual.
	$: socketColor =
		socketEstado === 'conectado'
			? '#15803d'
			: socketEstado === 'reconectando'
				? '#d97706'
				: socketEstado === 'rechazado'
					? '#dc2626'
					: '#94a3b8';

	$: socketTexto =
		socketEstado === 'conectado'
			? 'En vivo'
			: socketEstado === 'conectando'
				? 'Conectando'
				: socketEstado === 'reconectando'
					? 'Reconectando'
					: socketEstado === 'rechazado'
						? 'Sin conexión'
						: '';

	/// El detalle largo va al `title`: el chip se mantiene en una línea y quien
	/// necesite saber qué pasa lo tiene a un hover, sin desplazar el header.
	$: socketDetalle =
		socketEstado === 'conectado'
			? $socketStore.ultimaConexion
				? `Conexión en tiempo real activa desde las ${new Date($socketStore.ultimaConexion).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
				: 'Conexión en tiempo real activa'
			: socketEstado === 'conectando'
				? 'Estableciendo la conexión en tiempo real...'
				: socketEstado === 'reconectando'
					? 'Se perdió la conexión en tiempo real. Se reintenta solo; los cambios de otros usuarios pueden tardar en aparecer.'
					: socketEstado === 'rechazado'
						? ($socketStore.error ??
							'Tu sesión no es válida para la conexión en tiempo real. Vuelve a iniciar sesión.')
						: '';

	let showAllNotifications = false;

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
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
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
		showAllNotifications = false;

		// Navegar según referencia_tipo
		if (notif.referencia_id) {
			if (notif.referencia_tipo === 'actividad_pesv') {
				goto('/dashboard/pesv');
			} else if (notif.referencia_tipo === 'servicio') {
				goto(`/dashboard/servicios/${notif.referencia_id}`);
			} else if (notif.referencia_tipo?.startsWith('nomina_desprendible_firmado')) {
				const [, anio, mes, desde] = notif.referencia_tipo.split(':');
				const params = new URLSearchParams({
					liquidacion: notif.referencia_id,
					preview: '1'
				});
				if (anio && mes && desde) {
					params.set('anio', anio);
					params.set('mes', mes);
					params.set('desde', desde);
				}
				// Recarga completa a propósito: si el usuario ya tenía abierto este
				// mismo canvas, SvelteKit conservaría el componente y su caché podría
				// seguir mostrando el PDF anterior a la firma.
				window.location.assign(`/dashboard/nomina/canvas?${params.toString()}`);
			} else if (notif.tipo.startsWith('LIQUIDACION_')) {
				goto('/dashboard/liquidaciones-servicios');
			}
		}
	}

	async function abrirTodasNotificaciones() {
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

<svelte:window on:keydown={handleKeydown} />

<header
	class="no-print apple-transition fixed top-0 right-0 left-0 z-35 h-16 border-b {isCollapsed
		? 'lg:left-20'
		: 'lg:left-64'}"
	style="background-color: var(--bg-charcoal-deep); border-color: rgba(255,255,255,0.08);"
	in:fly={{ y: -20, duration: 400, delay: 300 }}
>
	<div class="flex h-full items-center justify-between gap-3 px-4 md:px-6 lg:pl-6">
		<!-- Burger (mobile/tablet). Sin nombre de la sección: cada página ya trae
		     su propio título y el sidebar marca dónde se está. -->
		<div class="flex min-w-0 flex-1 items-center lg:hidden" in:fade={{ duration: 600, delay: 400 }}>
			<!-- Burger menu (mobile/tablet only) — profesonal, dentro del flow -->
			<button
				type="button"
				class="apple-transition btn-icon cab-icono lg:hidden"
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

		</div>

		<!-- Centro (solo escritorio): «Ir a…», el buscador de módulos. Antes esta
		     franja quedaba vacía junto al usuario. -->
		<div class="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex" in:fade={{ duration: 600, delay: 450 }}>
			<BuscadorModulos />
			<!-- Conexión en tiempo real, tras el buscador (en móvil lo cubre el toast del layout) -->
			{#if socketEstado !== 'inactivo'}
				<div
					class="ml-3 hidden shrink-0 items-center gap-2 border-l pl-3 lg:flex"
					style="border-color: rgba(255,255,255,0.14);"
					role="status"
					aria-live="polite"
					title={socketDetalle}
				>
					<span class="relative flex h-2 w-2" aria-hidden="true">
						<!-- El latido solo mientras se reintenta de verdad: animarlo
						     en cualquier otro estado miente sobre lo que ocurre. -->
						{#if socketEstado === 'reconectando'}
							<span
								class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
								style="background:{socketColor}"
							></span>
						{/if}
						<span
							class="relative inline-flex h-2 w-2 rounded-full"
							style="background:{socketColor}"
						></span>
					</span>

					<span
						class="whitespace-nowrap text-[12px] font-medium"
						style="color:{socketProblema ? socketColor : 'rgba(255,255,255,0.75)'}"
					>
						{socketTexto}{#if socketEstado === 'reconectando' && socketIntentos > 0}<span
								class="hidden lg:inline"
								style="opacity:0.75"
							>
								· intento {socketIntentos}</span
							>{/if}
					</span>

					<!-- Salida manual: el reintento automático no se para nunca, pero
					     esperar al siguiente hueco del backoff cuando sabes que el
					     servidor ya volvió es innecesario. -->
					{#if socketProblema}
						<button
							type="button"
							class="apple-transition rounded-full px-2 py-0.5 text-[11px] font-semibold hover:opacity-70"
							style="background:{socketColor}1A; color:{socketColor}"
							on:click={() => socketManager.reconectar()}
						>
							Reintentar
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right Section -->
		<div class="flex shrink-0 items-center space-x-2 md:space-x-3" in:fade={{ duration: 600, delay: 500 }}>
			<!-- Session Timer (opcional) -->
			<SessionTimer showTimer={showSessionTimer} />

			<!-- Notifications -->
			<div class="relative notifications-menu">
				<button
					class="apple-transition btn-icon cab-icono relative"
					on:click={abrirTodasNotificaciones}
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

			</div>

			<!-- Usuario: enlace directo al perfil, sin desplegable -->
			<a
				href="/dashboard/perfil"
				class="apple-transition cab-usuario flex items-center space-x-3 rounded-xl p-2"
				title="Mi perfil · {userEmail}"
				aria-label="Mi perfil"
			>
				<div class="cab-avatar flex h-9 w-9 items-center justify-center rounded-full">
					<span class="text-sm font-semibold text-white">{userName.charAt(0).toUpperCase()}</span>
				</div>
				<div class="hidden min-w-0 text-left md:block">
					<p class="truncate text-sm font-semibold" style="color: #fff;">{userName}</p>
					<p class="truncate text-xs" style="color: rgba(255,255,255,0.6);">{userRole}</p>
				</div>
			</a>

			<!-- Cerrar sesión: solo icono, en rojo, al final de la barra -->
			<button
				type="button"
				class="apple-transition btn-icon cab-icono cab-salir"
				on:click={handleLogout}
				title="Cerrar sesión"
				aria-label="Cerrar sesión"
			>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
					/>
				</svg>
			</button>
		</div>
	</div>
</header>

<!-- Full Notifications Modal -->
{#if showAllNotifications}
	<div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" tabindex="-1" on:click|self={() => showAllNotifications = false} on:keydown={e => e.key === 'Escape' && (showAllNotifications = false)} transition:fade={{ duration: 200 }}>
		<div class="confirm-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden" in:fly={{ y: 30, duration: 300 }}>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4" style="border-bottom: 1px solid var(--border-subtle);">
				<h2 class="font-display text-lg" style="color: var(--bg-charcoal);">Notificaciones</h2>
				<div class="flex items-center gap-2">
					{#if noLeidas > 0}
						<button class="rounded-lg px-3 py-1.5 text-sm font-medium" style="color: var(--orange-600);" on:click={marcarTodasLeidas}>
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
							style="border-bottom: 1px solid var(--border-subtle); background-color: {notif.leida ? 'transparent' : 'rgba(234, 88, 12,0.04)'};"
							on:click={() => handleNotifClick(notif)}
						>
							<div class="flex items-start gap-3">
								<span class="mt-0.5 text-lg">{getNotifIcon(notif.tipo)}</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<p class="text-sm font-medium" style="color: var(--text-primary);">{notif.titulo}</p>
										{#if !notif.leida}
											<span class="h-2 w-2 flex-shrink-0 rounded-full" style="background-color: var(--orange-500);"></span>
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

<style>
	/* ── Header en el verde del menú lateral ──
	   La barra comparte superficie con el sidebar para que formen una sola
	   pieza; los controles van translúcidos sobre ella. Los desplegables
	   siguen siendo paneles blancos. */
	.cab-icono {
		background: rgba(255, 255, 255, 0.08) !important;
		border-color: rgba(255, 255, 255, 0.12) !important;
		color: rgba(255, 255, 255, 0.85) !important;
	}
	.cab-icono:hover {
		background: rgba(255, 255, 255, 0.16) !important;
		border-color: rgba(255, 255, 255, 0.28) !important;
		color: #fff !important;
	}
	.cab-usuario {
		color: rgba(255, 255, 255, 0.85);
	}
	.cab-usuario:hover {
		background: rgba(255, 255, 255, 0.08);
	}
	.cab-salir {
		background: rgba(239, 68, 68, 0.16) !important;
		border-color: rgba(239, 68, 68, 0.35) !important;
		color: #fecaca !important;
	}
	.cab-salir:hover {
		background: #dc2626 !important;
		border-color: #dc2626 !important;
		color: #fff !important;
	}
	.cab-avatar {
		background: rgba(255, 255, 255, 0.14);
		border: 1.5px solid rgba(255, 255, 255, 0.25);
	}
</style>
