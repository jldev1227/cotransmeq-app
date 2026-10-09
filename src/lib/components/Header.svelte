<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import SessionTimer from './SessionTimer.svelte';
	import AsistenteDisparador from './asistente/AsistenteDisparador.svelte';
	import { notificacionesStore } from '$lib/stores/notificaciones';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils, socketStore, socketManager } from '$lib/socket';
	import { mobileDrawerStore } from '$lib/stores/mobileDrawer';
	import { sidebarStore } from '$lib/stores/sidebar';
	import type { Notificacion } from '$lib/api/notificaciones';
	import ModalNotificaciones from '$lib/components/notificaciones/ModalNotificaciones.svelte';

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


	async function handleNotifClick(notif: Notificacion) {
		/// Marcarla como leída lo hace `ModalNotificaciones` antes de llamar aquí.
		showAllNotifications = false;

		// Navegar según referencia_tipo
		if (notif.referencia_id) {
			if (notif.referencia_tipo === 'servicio') {
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
			} else if (notif.referencia_tipo === 'preoperacional') {
				goto(`/dashboard/formularios/envios/${notif.referencia_id}`);
			} else if (notif.referencia_tipo?.startsWith('dias_laborados:')) {
				/// Recorridos del conductor ese día (`dias_laborados:<fecha>`, la referencia es el conductor).
				const fecha = notif.referencia_tipo.split(':')[1];
				const params = new URLSearchParams({ desde: fecha, hasta: fecha, conductor: notif.referencia_id });
				goto(`/dashboard/conductores/recorridos?${params.toString()}`);
			} else if (notif.referencia_tipo === 'viatico_anticipo') {
				goto(`/dashboard/viaticos?anticipo=${notif.referencia_id}`);
			} else if (notif.referencia_tipo === 'viatico_solicitud') {
				goto(`/dashboard/viaticos?solicitud=${notif.referencia_id}`);
			} else if (notif.referencia_tipo === 'ACCION_CORRECTIVA') {
				goto(`/dashboard/acciones-correctivas/${notif.referencia_id}`);
			} else if (notif.tipo.startsWith('FACTURA_')) {
				goto('/dashboard/liquidaciones-servicios?tab=facturas');
			} else if (notif.tipo.startsWith('LIQUIDACION_')) {
				goto('/dashboard/liquidaciones-servicios');
			}
		}
	}

	function abrirTodasNotificaciones() {
		showAllNotifications = true;
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

		<!-- Centro (solo escritorio): el asistente de IA. Ocupa el sitio del antiguo
		     buscador «Ir a un módulo…»: además de llevarte a una pantalla, consulta
		     datos y explica la app. Mismo atajo (⌘K). -->
		<div class="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex" in:fade={{ duration: 600, delay: 450 }}>
			<AsistenteDisparador />
			<!-- Conexión en tiempo real, tras el asistente (en móvil lo cubre el toast del layout) -->
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

<!-- Historial de notificaciones: el modal vive en su componente. -->
<ModalNotificaciones
	open={showAllNotifications}
	oncerrar={() => (showAllNotifications = false)}
	onabrir={handleNotifClick}
/>

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
