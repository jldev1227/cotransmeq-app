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

	async firmantes(): Promise<Firmante[]> {
		const response = await apiClient.get('/api/usuarios/firmantes');
		return response.data;
	}
};
