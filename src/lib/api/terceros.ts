import { apiClient } from './apiClient';

export interface Tercero {
	id: string;
	nombre_completo: string;
	identificacion: string | null;
	telefono: string | null;
	correo: string | null;
	direccion: string | null;
	tipo_persona: 'PERSONA' | 'EMPRESA';
	regimen: string | null;
	notas: string | null;
	activo: boolean;
	created_at: string;
	updated_at: string;
}

export interface TerceroPagination {
	page: number;
	limit: number;
	total: number;
	pages: number;
	hasNext: boolean;
	hasPrev: boolean;
}

export interface TerceroCounts {
	total: number;
	personas: number;
	empresas: number;
}

export const tercerosAPI = {
	async listar(params?: {
		page?: number;
		limit?: number;
		tipo_persona?: string;
		search?: string;
		sortBy?: string;
		sortOrder?: string;
	}): Promise<{ data: Tercero[]; pagination: TerceroPagination; counts: TerceroCounts }> {
		const response = await apiClient.get('/api/terceros', { params });
		return response.data;
	},

	async obtenerPorId(id: string): Promise<Tercero> {
		const response = await apiClient.get(`/api/terceros/${id}`);
		return response.data.data;
	},

	async crear(data: Partial<Tercero>): Promise<Tercero> {
		const response = await apiClient.post('/api/terceros', data);
		return response.data.data;
	},

	async actualizar(id: string, data: Partial<Tercero>): Promise<Tercero> {
		const response = await apiClient.put(`/api/terceros/${id}`, data);
		return response.data.data;
	},

	async eliminar(id: string): Promise<void> {
		await apiClient.delete(`/api/terceros/${id}`);
	},

	async importarDesdeVehiculos(): Promise<{ importados: number; duplicados: number; total: number }> {
		const response = await apiClient.post('/api/terceros/importar-vehiculos');
		return response.data.data;
	},

	async buscar(q: string): Promise<{ id: string; nombre_completo: string; identificacion: string | null; tipo_persona: 'PERSONA' | 'EMPRESA' }[]> {
		const response = await apiClient.get('/api/terceros/buscar', { params: { q } });
		return response.data.data;
	},
};
