import { apiClient } from './apiClient';
import type { AccessLevel } from '$lib/config/permissions';

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
	/**
	 * Lista blanca de módulos por usuario (`users.permisos_rutas`). `null` deja
	 * mandar a las reglas por área; con claves las sustituye por completo.
	 */
	permisos_rutas?: Record<string, AccessLevel> | null;
	ultimo_acceso?: string;
	created_at?: string;
	updated_at?: string;
}

/** Payload del alta manual: aquí la contraseña la pone quien crea, no el invitado. */
export interface CrearUsuarioPayload {
	nombre: string;
	correo: string;
	password: string;
	telefono?: string;
	cargo?: string;
	role: string;
	area: string[];
	permisos_rutas: Record<string, AccessLevel> | null;
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

	/**
	 * Alta manual de un usuario, con contraseña puesta por el administrador.
	 * Convive con `/api/invitaciones`: allí la clave la elige el propio invitado.
	 */
	async crear(data: CrearUsuarioPayload): Promise<Usuario> {
		const response = await apiClient.post('/api/usuarios', data);
		return response.data;
	},

	async actualizar(
		id: string,
		data: Partial<
			Pick<
				Usuario,
				'nombre' | 'correo' | 'telefono' | 'role' | 'cargo' | 'area' | 'activo' | 'permisos_rutas'
			>
		>
	): Promise<Usuario> {
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
