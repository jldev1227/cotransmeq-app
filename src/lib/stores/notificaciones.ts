import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { notificacionesApi, type Notificacion } from '$lib/api/notificaciones';

export type NotificationType =
	| 'LIQUIDACION_ANULADA'
	| 'LIQUIDACION_PENDIENTE'
	| 'LIQUIDACION_CREADA'
	| 'LIQUIDACION_ACTUALIZADA'
	| 'LIQUIDACION_RECORDATORIO'
	| 'ACTIVIDAD_PESV_ASIGNADA'
	| 'ACTIVIDAD_PESV_ACTUALIZADA'
	| 'ACTIVIDAD_PESV_VENCIDA'
	| 'GENERAL';

interface NotificacionesState {
	items: Notificacion[];
	noLeidas: number;
	loading: boolean;
	loaded: boolean;
}

function createNotificacionesStore() {
	const { subscribe, set, update } = writable<NotificacionesState>({
		items: [],
		noLeidas: 0,
		loading: false,
		loaded: false,
	});

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	return {
		subscribe,

		/** Cargar notificaciones del servidor */
		async cargar() {
			if (!browser) return;
			update(s => ({ ...s, loading: true }));
			try {
				const res = await notificacionesApi.listar(1, 30);
				update(s => ({
					...s,
					items: res.notificaciones,
					noLeidas: res.noLeidas,
					loading: false,
					loaded: true,
				}));
			} catch (e) {
				console.error('Error cargando notificaciones:', e);
				update(s => ({ ...s, loading: false }));
			}
		},

		/** Solo actualizar el contador de no leídas */
		async actualizarContador() {
			if (!browser) return;
			try {
				const count = await notificacionesApi.contarNoLeidas();
				update(s => ({ ...s, noLeidas: count }));
			} catch (e) {
				console.error('Error actualizando contador:', e);
			}
		},

		/** Agregar una notificación recibida por socket */
		agregarNotificacion(notif: Notificacion) {
			update(s => ({
				...s,
				items: [notif, ...s.items].slice(0, 50), // Máximo 50 en memoria
				noLeidas: s.noLeidas + 1,
			}));
		},

		/** Marcar una como leída */
		async marcarLeida(id: string) {
			try {
				await notificacionesApi.marcarLeida(id);
				update(s => ({
					...s,
					items: s.items.map(n => n.id === id ? { ...n, leida: true } : n),
					noLeidas: Math.max(0, s.noLeidas - 1),
				}));
			} catch (e) {
				console.error('Error marcando leída:', e);
			}
		},

		/** Marcar todas como leídas */
		async marcarTodasLeidas() {
			try {
				await notificacionesApi.marcarTodasLeidas();
				update(s => ({
					...s,
					items: s.items.map(n => ({ ...n, leida: true })),
					noLeidas: 0,
				}));
			} catch (e) {
				console.error('Error marcando todas:', e);
			}
		},

		/** Iniciar polling cada 60s */
		iniciarPolling() {
			if (pollInterval) return;
			pollInterval = setInterval(() => {
				this.actualizarContador();
			}, 60000);
		},

		/** Detener polling */
		detenerPolling() {
			if (pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		},

		/** Reset */
		reset() {
			this.detenerPolling();
			set({ items: [], noLeidas: 0, loading: false, loaded: false });
		},
	};
}

export const notificacionesStore = createNotificacionesStore();
