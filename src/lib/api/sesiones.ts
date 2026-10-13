import { apiClient } from './apiClient';

export interface Sesion {
	id: string;
	usuario_id: string;
	ip: string | null;
	user_agent: string | null;
	remember_me: boolean;
	token_expiry: string;
	last_activity: string;
	is_active: boolean;
	created_at: string;
	closed_at: string | null;
	duracion_minutos: number;
	duracion_texto: string;
	usuario?: {
		id: string;
		nombre: string;
		correo: string;
		role: string;
		area: string | null;
		cargo: string | null;
	};
}

export interface ActividadMovil {
	kind: 'usuario' | 'conductor';
	id: string;
	nombre: string;
	correo: string | null;
	area: string[];
	platform: string | null;
	first_seen_at: string;
	last_seen_at: string;
	sessions_count: number;
	en_linea: boolean;
}

export const sesionesAPI = {
	async actividadMovil(): Promise<ActividadMovil[]> {
		const response = await apiClient.get('/api/sesiones/app-movil');
		return response.data;
	},

	async listar(params?: { activas?: boolean; usuarioId?: string; limit?: number }): Promise<Sesion[]> {
		const query = new URLSearchParams();
		if (params?.activas !== undefined) query.set('activas', String(params.activas));
		if (params?.usuarioId) query.set('usuarioId', params.usuarioId);
		if (params?.limit) query.set('limit', String(params.limit));
		const response = await apiClient.get(`/api/sesiones?${query.toString()}`);
		return response.data;
	},

	async listarActivas(): Promise<Sesion[]> {
		const response = await apiClient.get('/api/sesiones/activas');
		return response.data;
	},

	async cerrar(id: string): Promise<void> {
		await apiClient.delete(`/api/sesiones/${id}`);
	},

	async cerrarTodasUsuario(usuarioId: string): Promise<void> {
		await apiClient.delete(`/api/sesiones/usuario/${usuarioId}`);
	},

	async misSesiones(): Promise<Sesion[]> {
		const response = await apiClient.get('/api/sesiones/mis-sesiones');
		return response.data;
	}
};
