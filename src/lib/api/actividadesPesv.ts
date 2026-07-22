import { apiClient } from './apiClient';
import type {
	ActividadPesv,
	ActividadPesvFormData,
	ActividadesListResponse,
	ActividadPesvEstadisticas
} from '$lib/types/actividadesPesv';

/**
 * API Cliente para el módulo Actividades PESV
 */

// ==================== CRUD ====================

export const listarActividadesPesv = async (params?: {
	page?: number;
	limit?: number;
	anio?: number;
	estado?: string;
	prioridad?: string;
	frecuencia?: string;
	responsable_ejecucion_id?: string;
	search?: string;
}): Promise<ActividadesListResponse> => {
	const searchParams = new URLSearchParams();
	if (params?.page) searchParams.set('page', params.page.toString());
	if (params?.limit) searchParams.set('limit', params.limit.toString());
	if (params?.anio) searchParams.set('anio', params.anio.toString());
	if (params?.estado) searchParams.set('estado', params.estado);
	if (params?.prioridad) searchParams.set('prioridad', params.prioridad);
	if (params?.frecuencia) searchParams.set('frecuencia', params.frecuencia);
	if (params?.responsable_ejecucion_id) searchParams.set('responsable_ejecucion_id', params.responsable_ejecucion_id);
	if (params?.search) searchParams.set('search', params.search);

	const query = searchParams.toString();
	const url = `/api/pesv/actividades${query ? `?${query}` : ''}`;
	const response = await apiClient.get<ActividadesListResponse>(url);
	return response.data;
};

export const obtenerActividadPesv = async (id: string): Promise<ActividadPesv> => {
	const response = await apiClient.get<{ success: boolean; data: ActividadPesv }>(`/api/pesv/actividades/${id}`);
	return response.data.data;
};

export const crearActividadPesv = async (data: ActividadPesvFormData): Promise<ActividadPesv> => {
	const response = await apiClient.post<{ success: boolean; data: ActividadPesv }>('/api/pesv/actividades', data);
	return response.data.data;
};

export const actualizarActividadPesv = async (id: string, data: Partial<ActividadPesvFormData>): Promise<ActividadPesv> => {
	const response = await apiClient.put<{ success: boolean; data: ActividadPesv }>(`/api/pesv/actividades/${id}`, data);
	return response.data.data;
};

export const eliminarActividadPesv = async (id: string): Promise<void> => {
	await apiClient.delete(`/api/pesv/actividades/${id}`);
};

// ==================== UTILS ====================

export const obtenerEstadisticasPesv = async (anio?: number): Promise<ActividadPesvEstadisticas> => {
	const url = anio ? `/api/pesv/actividades/estadisticas?anio=${anio}` : '/api/pesv/actividades/estadisticas';
	const response = await apiClient.get<{ success: boolean; data: ActividadPesvEstadisticas }>(url);
	return response.data.data;
};

export const obtenerSiguienteNumero = async (anio?: number): Promise<number> => {
	const url = anio ? `/api/pesv/actividades/siguiente-numero?anio=${anio}` : '/api/pesv/actividades/siguiente-numero';
	const response = await apiClient.get<{ success: boolean; data: { numero: number } }>(url);
	return response.data.data.numero;
};
