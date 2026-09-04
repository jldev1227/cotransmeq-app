import { io, type Socket } from 'socket.io-client';
import { browser } from '$app/environment';
import { authStore } from '$lib/stores/auth';
import { writable } from 'svelte/store';

// Estado del socket
export const socketStore = writable<{
	connected: boolean;
	error: string | null;
}>({
	connected: false,
	error: null
});

class SocketManager {
	private socket: Socket | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	// Listeners externos registrados vía socketUtils.on() — se re-registran al (re)crear el socket
	private externalListeners: Map<string, Set<(data: any) => void>> = new Map();

	constructor() {
		if (browser) {
			// Suscribirse a cambios en el estado de autenticación
			authStore.subscribe((authState) => {
				if (authState.token && authState.user) {
					this.connect();
					// Re-emitir join-dashboard cada vez que el user cambia o se reconecta
					if (this.socket?.connected) {
						console.log('[socket] emit join-dashboard', authState.user.id);
						this.socket.emit('join-dashboard', authState.user.id);
					}
				} else {
					this.disconnect();
				}
			});
		}
	}

	connect() {
		if (!browser) return;
		// Si ya hay un socket conectado, no crear otro
		if (this.socket?.connected) return;
		// Si existe un socket pero no está conectado, destruirlo
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}

		try {
			this.socket = io(import.meta.env.VITE_API_URL, {
				autoConnect: true,
				reconnection: true,
				reconnectionAttempts: this.maxReconnectAttempts,
				reconnectionDelay: 1000,
				auth: {
					token: authStore.getToken()
				}
			});

			this.setupEventListeners();
			// Re-registrar listeners externos que se hayan registrado antes de que el socket existiera
			this.reregisterExternalListeners();
		} catch (error) {
			console.error('Error connecting to socket:', error);
			socketStore.update((state) => ({
				...state,
				error: 'Error de conexión al servidor'
			}));
		}
	}

	private reregisterExternalListeners() {
		if (!this.socket) return;
		for (const [event, callbacks] of this.externalListeners.entries()) {
			for (const cb of callbacks) {
				this.socket.on(event, cb);
			}
		}
		console.log(
			`[socket] re-registrados ${this.externalListeners.size} eventos con ` +
			`${[...this.externalListeners.values()].reduce((s, set) => s + set.size, 0)} listeners ` +
			`(socket.connected=${this.socket.connected}, id=${this.socket.id})`
		);
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
			socketStore.update((state) => ({
				...state,
				connected: false
			}));
		}
	}

	private setupEventListeners() {
		if (!this.socket) return;

		// Eventos de conexión
		this.socket.on('connect', () => {
			this.reconnectAttempts = 0;
			socketStore.update((state) => ({
				...state,
				connected: true,
				error: null
			}));
			// Unirse al room personal del usuario para recibir eventos dirigidos
			const userId = authStore.getUser()?.id;
			if (userId) {
				console.log('[socket] connected, emit join-dashboard', userId);
				this.socket?.emit('join-dashboard', userId);
			} else {
				console.warn('[socket] connected but no userId available for join-dashboard');
			}
		});

		this.socket.on('disconnect', (reason) => {
			socketStore.update((state) => ({
				...state,
				connected: false
			}));
		});

		this.socket.on('connect_error', (error) => {
			console.error('Error de conexión socket:', error);
			this.reconnectAttempts++;

			if (this.reconnectAttempts >= this.maxReconnectAttempts) {
				socketStore.update((state) => ({
					...state,
					error: 'No se pudo conectar al servidor'
				}));
			}
		});

		/// Aquí había un listener de `unauthorized` que llamaba a
		/// `authStore.logout()`. El backend NO emite ese evento nunca: cuando
		/// rechaza un handshake lo hace con un error del middleware, que llega
		/// como `connect_error` — el de arriba. Así que era código muerto, y de
		/// los peligrosos: cualquier evento de dominio que llegara a llamarse
		/// `unauthorized` habría cerrado la sesión de todo el mundo.
		///
		/// Cuando `SOCKET_AUTH_MODE` pase a `enforce`, el rechazo por token
		/// inválido llegará por `connect_error` con el mensaje
		/// «unauthorized: token inválido». Ahí habrá que decidir si eso debe
		/// cerrar la sesión; hoy solo cuenta como intento fallido de conexión.

		// Eventos globales de la aplicación
		this.setupApplicationEvents();
	}

	private setupApplicationEvents() {
		/// Vacío a propósito.
		///
		/// Aquí había doce listeners permanentes que solo hacían `console.log`.
		/// Seis de ellos —`servicio-actualizado`, `servicio-creado`,
		/// `vehiculo-ubicacion`, `vehiculo-estado`, `conductor-estado` y
		/// `notificacion`— escuchaban eventos que el backend NUNCA ha emitido:
		/// los nombres reales son otros. Los otros seis duplicaban lo que ya
		/// hacen los stores y las páginas, y como nunca se daban de baja
		/// registraban cada evento del sistema en la consola de todos.
		///
		/// Quien necesite reaccionar a un evento lo hace desde su store o su
		/// página, con su propio alta y baja. El contrato de eventos
		/// (`tests/contrato-eventos`) impide que vuelvan a aparecer listeners
		/// de eventos inexistentes sin que nadie se entere.
	}

	// Métodos públicos para emitir eventos
	emit(event: string, data?: any) {
		if (this.socket?.connected) {
			this.socket.emit(event, data);
		} else {
			console.warn('[socket] no conectado, no se puede emitir:', event);
		}
	}

	/**
	 * Escucha un evento y **devuelve la función para dejar de escucharlo**.
	 *
	 * Usar esa función es la forma fiable de darse de baja:
	 *
	 * ```ts
	 * $effect(() => socketUtils.on('servicio:creado', alCrear))
	 * ```
	 *
	 * Antes el callback se envolvía en otro que hacía `console.log` y era el
	 * ENVUELTO el que se registraba y se guardaba, mientras `off(evento, cb)`
	 * intentaba borrar el original. Ni el `Set.delete` ni el `socket.off`
	 * encontraban nada, así que **ningún `off` daba de baja nada**: las quince
	 * páginas que llamaban a `off` en su `onDestroy` parecían correctas y
	 * acumulaban un listener más en cada visita. Tras N visitas a una página,
	 * su handler corría N veces por evento.
	 *
	 * Se registra el callback tal cual. El log por evento se retiró: escribía
	 * en consola CADA evento del sistema, y para diagnosticar ya está
	 * `stores/socketEventLog.ts`.
	 */
	on(event: string, callback: (data: any) => void): () => void {
		if (!this.externalListeners.has(event)) {
			this.externalListeners.set(event, new Set());
		}
		// Se guarda para poder re-registrarlo si el socket se (re)crea.
		this.externalListeners.get(event)!.add(callback);
		this.socket?.on(event, callback);

		return () => this.off(event, callback);
	}

	/**
	 * Deja de escuchar.
	 *
	 * Sin `callback` quita TODOS los listeners de ese evento, incluidos los de
	 * otros módulos que comparten este socket. Eso ya causó un fallo real:
	 * salir de `/dashboard/conductores` mataba el listener de
	 * `dias-laborados:registro-actualizado` que necesitaba
	 * `TablaDiasLaborados.svelte`, y la tabla dejaba de actualizarse sin que
	 * nada avisara. Por eso ahora deja rastro en consola: pásale el callback,
	 * o mejor usa la función que devuelve `on()`.
	 */
	off(event: string, callback?: (data: any) => void) {
		if (callback) {
			this.externalListeners.get(event)?.delete(callback);
			this.socket?.off(event, callback);
			return;
		}

		console.warn(
			`[socket] off('${event}') sin handler: se dan de baja TODOS los ` +
				`listeners de ese evento, incluidos los de otros módulos. ` +
				`Pasa el callback o usa la función que devuelve on().`
		);
		this.externalListeners.delete(event);
		this.socket?.off(event);
	}

	// Método para obtener el estado de conexión
	isConnected(): boolean {
		return this.socket?.connected || false;
	}

	/**
	 * Id de la conexión actual, o `null` si no hay ninguna.
	 *
	 * Hace falta para las operaciones cuyo progreso el backend manda a un
	 * socket concreto en vez de a un room —la generación del ZIP de
	 * desprendibles es el caso—: el cliente tiene que decir a qué conexión
	 * quiere que le hablen. Cambia en cada reconexión, así que se pide en el
	 * momento de lanzar la operación y no se guarda.
	 */
	getSocketId(): string | null {
		return this.socket?.id ?? null;
	}
}

// Crear instancia global del socket manager
export const socketManager = new SocketManager();

// Funciones de conveniencia para usar en componentes
export const socketUtils = {
	emit: (event: string, data?: any) => socketManager.emit(event, data),
	/** Devuelve la función de baja; úsala en vez de `off`. */
	on: (event: string, callback: (data: any) => void): (() => void) =>
		socketManager.on(event, callback),
	off: (event: string, callback?: (data: any) => void) => socketManager.off(event, callback),
	isConnected: () => socketManager.isConnected(),
	getSocketId: () => socketManager.getSocketId()
};
