import { apiClient } from './apiClient';

/** Panel de inicio y registro de actividad (backend `modules/dashboard` y `modules/actividad`). */

export interface SeccionPanel {
	id: string;
	titulo: string;
	descripcion: string;
	/** `false` mientras el backend no construya esa sección todavía. */
	disponible: boolean;
}

export async function seccionesPanel(): Promise<{
	secciones: SeccionPanel[];
	modulos: Record<string, string>;
}> {
	const res = await apiClient.get('/api/dashboard/secciones');
	return res.data.data;
}

export interface PeriodoPanel {
	desde: string;
	hasta: string;
	dias: number;
}

/** Datos de una sección; `null` si el backend aún no la construye. */
export async function seccionPanel<T extends Record<string, unknown>>(
	id: string,
	desde: string,
	hasta: string
): Promise<(T & { periodo: PeriodoPanel }) | null> {
	const res = await apiClient.get(`/api/dashboard/secciones/${id}`, { params: { desde, hasta } });
	return res.data.data ?? null;
}

export interface RegistroActividad {
	id: string;
	usuario_id: string | null;
	usuario_nombre: string;
	usuario_areas: string[];
	modulo: string;
	accion: 'crear' | 'editar' | 'eliminar' | 'restaurar' | 'estado' | 'otro';
	recurso_id: string | null;
	recurso_ref: string | null;
	descripcion: string;
	detalle: Record<string, unknown> | null;
	created_at: string;
}

export interface FiltrosActividad {
	limit?: number;
	pagina?: number;
	area?: string;
	usuario_id?: string;
	modulo?: string;
	accion?: string;
	q?: string;
	desde?: string;
	hasta?: string;
}

export async function listarActividad(filtros: FiltrosActividad = {}): Promise<{
	data: RegistroActividad[];
	meta: { total: number; pagina: number; limit: number; totalPages: number };
}> {
	const params: Record<string, string | number> = {};
	for (const [k, v] of Object.entries(filtros))
		if (v !== undefined && v !== '' && v !== null) params[k] = v;
	const res = await apiClient.get('/api/actividad', { params });
	return { data: res.data.data ?? [], meta: res.data.meta };
}

export async function opcionesActividad(): Promise<{
	usuarios: Array<{ id: string; nombre: string; registros: number }>;
	modulos: Array<{ id: string; registros: number }>;
	/** `null` para el admin (ve todas las áreas). */
	areas: string[] | null;
}> {
	const res = await apiClient.get('/api/actividad/opciones');
	return res.data.data;
}

// ── Talento humano: seguridad social por defecto ─────────────────────────
export interface SeguridadSocialDefecto {
	eps: string | null;
	fondo_pension: string | null;
	arl: string | null;
}

export async function guardarSeguridadSocial(
	valor: SeguridadSocialDefecto
): Promise<SeguridadSocialDefecto> {
	const res = await apiClient.put('/api/dashboard/talento-humano/seguridad-social', valor);
	return res.data.data;
}

/** Completa EPS, fondo y ARL de los vinculados que no los tienen; devuelve cuántos cambió cada uno. */
export async function aplicarSeguridadSocial(): Promise<{
	eps: number;
	fondo_pension: number;
	arl: number;
}> {
	const res = await apiClient.post('/api/dashboard/talento-humano/seguridad-social/aplicar');
	return res.data.data;
}
