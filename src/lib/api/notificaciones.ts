import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

export interface Notificacion {
	id: string;
	usuario_id: string;
	tipo: 'LIQUIDACION_ANULADA' | 'LIQUIDACION_PENDIENTE' | 'LIQUIDACION_CREADA' | 'LIQUIDACION_ACTUALIZADA' | 'ACTIVIDAD_PESV_ASIGNADA' | 'ACTIVIDAD_PESV_ACTUALIZADA' | 'ACTIVIDAD_PESV_VENCIDA' | 'GENERAL';
	titulo: string;
	mensaje: string;
	referencia_id?: string;
	referencia_tipo?: string;
	leida: boolean;
	created_at: string;
}

export interface NotificacionesResponse {
	notificaciones: Notificacion[];
	total: number;
	noLeidas: number;
	totalPages: number;
	page: number;
}

function getAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (browser) {
		const token = localStorage.getItem('transmeralda_token');
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

export const notificacionesApi = {
	async listar(page = 1, limit = 20): Promise<NotificacionesResponse> {
		const res = await fetch(
			`${API_URL}/api/notificaciones?page=${page}&limit=${limit}`,
			{ headers: getAuthHeaders() }
		);
		if (!res.ok) throw new Error('Error al cargar notificaciones');
		return res.json();
	},

	async contarNoLeidas(): Promise<number> {
		const res = await fetch(
			`${API_URL}/api/notificaciones/no-leidas`,
			{ headers: getAuthHeaders() }
		);
		if (!res.ok) throw new Error('Error al contar notificaciones');
		const data = await res.json();
		return data.count;
	},

	async marcarLeida(id: string): Promise<void> {
		const res = await fetch(
			`${API_URL}/api/notificaciones/${id}/leida`,
			{ method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({}) }
		);
		if (!res.ok) throw new Error('Error al marcar notificación');
	},

	async marcarTodasLeidas(): Promise<void> {
		const res = await fetch(
			`${API_URL}/api/notificaciones/marcar-todas`,
			{ method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({}) }
		);
		if (!res.ok) throw new Error('Error al marcar notificaciones');
	},
};
