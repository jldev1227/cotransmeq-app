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
		console.log(`[socket] re-registrados ${this.externalListeners.size} eventos con ${[...this.externalListeners.values()].reduce((s, set) => s + set.size, 0)} listeners`);
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

		this.socket.on('unauthorized', (error) => {
			console.error('Socket no autorizado:', error);
			authStore.logout();
		});

		// Eventos globales de la aplicación
		this.setupApplicationEvents();
	}

	private setupApplicationEvents() {
		if (!this.socket) return;

		// Eventos de servicios
		this.socket.on('servicio-actualizado', (data) => {
			console.log('Servicio actualizado:', data);
			// Aquí podrías actualizar stores específicos o disparar notificaciones
		});

		this.socket.on('servicio-creado', (data) => {
			console.log('Nuevo servicio creado:', data);
		});

		// Eventos de vehículos
		this.socket.on('vehiculo-ubicacion', (data) => {
			console.log('Ubicación de vehículo actualizada:', data);
		});

		this.socket.on('vehiculo-estado', (data) => {
			console.log('Estado de vehículo actualizado:', data);
		});

		// Eventos de conductores
		this.socket.on('conductor-estado', (data) => {
			console.log('Estado de conductor actualizado:', data);
		});

		// Notificaciones generales
		this.socket.on('notificacion', (data) => {
			console.log('Nueva notificación:', data);
			// Aquí podrías mostrar una notificación toast
		});

		// Liquidaciones de servicios
		this.socket.on('liquidacion-servicio-created', (data) => {
			console.log('Liquidación de servicio creada:', data);
		});

		this.socket.on('liquidacion-servicio-updated', (data) => {
			console.log('Liquidación de servicio actualizada:', data);
		});

		this.socket.on('liquidacion-servicio-deleted', (data) => {
			console.log('Liquidación de servicio eliminada:', data);
		});
	}

	// Métodos públicos para emitir eventos
	emit(event: string, data?: any) {
		if (this.socket?.connected) {
			this.socket.emit(event, data);
		} else {
			console.warn('[socket] no conectado, no se puede emitir:', event);
		}
	}

	// Método para escuchar eventos específicos desde componentes
	on(event: string, callback: (data: any) => void) {
		// Guardar el listener para re-registrarlo si el socket se (re)crea
		if (!this.externalListeners.has(event)) {
			this.externalListeners.set(event, new Set());
		}
		this.externalListeners.get(event)!.add(callback);
		// Si el socket ya existe, registrarlo ahora
		if (this.socket) {
			this.socket.on(event, callback);
		}
	}

	// Método para dejar de escuchar eventos
	off(event: string, callback?: (data: any) => void) {
		if (callback && this.externalListeners.has(event)) {
			this.externalListeners.get(event)!.delete(callback);
		}
		if (this.socket) {
			this.socket.off(event, callback);
		}
	}

	// Método para obtener el estado de conexión
	isConnected(): boolean {
		return this.socket?.connected || false;
	}
}

// Crear instancia global del socket manager
export const socketManager = new SocketManager();

// Funciones de conveniencia para usar en componentes
export const socketUtils = {
	emit: (event: string, data?: any) => socketManager.emit(event, data),
	on: (event: string, callback: (data: any) => void) => socketManager.on(event, callback),
	off: (event: string, callback?: (data: any) => void) => socketManager.off(event, callback),
	isConnected: () => socketManager.isConnected()
};
