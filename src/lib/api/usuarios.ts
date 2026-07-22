import { apiClient } from './apiClient';

export interface Usuario {
	id: string;
	nombre: string;
	correo: string;
	telefono?: string;
	role?: string;
	cargo?: string;
	area?: string[];
	activo?: boolean;
	firma_url?: string;
	permisos?: Record<string, boolean>;
	ultimo_acceso?: string;
	created_at?: string;
	updated_at?: string;
}

export interface Firmante {
	id: string;
	nombre: string;
	cargo: string | null;
	firma_url: string | null;
	firma_signed_url: string | null;
}

export const usuariosAPI = {
	async listar(): Promise<Usuario[]> {
		const response = await apiClient.get('/api/usuarios');
		return response.data;
	},

	async obtenerPorId(id: string): Promise<Usuario> {
		const response = await apiClient.get(`/api/usuarios/${id}`);
		return response.data;
	},

	async actualizar(id: string, data: Partial<Pick<Usuario, 'nombre' | 'correo' | 'telefono' | 'role' | 'area' | 'activo'>>): Promise<Usuario> {
		const response = await apiClient.put(`/api/usuarios/${id}`, data);
		return response.data;
	},

	async toggleActivo(id: string, activo: boolean): Promise<Usuario> {
		const response = await apiClient.patch(`/api/usuarios/${id}/activo`, { activo });
		return response.data;
	},

	async actualizarPermisos(id: string, permisos: Record<string, boolean>): Promise<Usuario> {
		const response = await apiClient.patch(`/api/usuarios/${id}/permisos`, { permisos });
		return response.data;
	},

	// ── Permiso individual: bonos de planilla de días laborados ──
	async setBonosPlanilla(userIds: string[], granted: boolean): Promise<{
		success: boolean;
		updated: Usuario[];
		granted: boolean;
	}> {
		const response = await apiClient.post('/api/usuarios/permisos/bonos-planilla', {
			userIds,
			granted
		});
		return response.data;
	},

	async firmantes(): Promise<Firmante[]> {
		const response = await apiClient.get('/api/usuarios/firmantes');
		return response.data;
	}
};

// Helper para chequear si un usuario tiene el permiso individual de bonos.
// El flag se guarda dentro de `permisos['bonos-planilla']`.
export function hasBonosPlanilla(u: Usuario | null | undefined): boolean {
	if (!u) return false;
	return u.permisos?.['bonos-planilla'] === true;
}
