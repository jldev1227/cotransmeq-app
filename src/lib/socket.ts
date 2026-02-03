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

	constructor() {
		if (browser) {
			// Suscribirse a cambios en el estado de autenticación
			authStore.subscribe((authState) => {
				if (authState.token && authState.user) {
					this.connect();
				} else {
					this.disconnect();
				}
			});
		}
	}

	connect() {
		if (!browser || this.socket?.connected) return;

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
		} catch (error) {
			console.error('Error connecting to socket:', error);
			socketStore.update((state) => ({
				...state,
				error: 'Error de conexión al servidor'
			}));
		}
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
			console.log('Socket conectado:', this.socket?.id);
			this.reconnectAttempts = 0;
			socketStore.update((state) => ({
				...state,
				connected: true,
				error: null
			}));
		});

		this.socket.on('disconnect', (reason) => {
			console.log('Socket desconectado:', reason);
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

		// Eventos de autenticación
		this.socket.on('authenticated', (data) => {
			console.log('Socket autenticado:', data);
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
	}

	// Métodos públicos para emitir eventos
	emit(event: string, data?: any) {
		if (this.socket?.connected) {
			this.socket.emit(event, data);
		} else {
			console.warn('Socket no conectado, no se puede emitir evento:', event);
		}
	}

	// Método para escuchar eventos específicos desde componentes
	on(event: string, callback: (data: any) => void) {
		if (this.socket) {
			this.socket.on(event, callback);
		}
	}

	// Método para dejar de escuchar eventos
	off(event: string, callback?: (data: any) => void) {
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
