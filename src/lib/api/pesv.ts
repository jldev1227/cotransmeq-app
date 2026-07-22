import { apiClient } from './apiClient';
import type {
	PesvDashboardData,
	PesvFilters,
	PesvFilterOptions,
	ExcesoVelocidad,
	Preoperacional,
	RegistroDiarioPesv
} from '$lib/types/pesv';

/**
 * API Cliente para el módulo PESV
 */

// ==================== DASHBOARD ====================

export const obtenerDashboardPesv = async (filters?: PesvFilters) => {
	const searchParams = new URLSearchParams();
	if (filters?.mes) searchParams.set('mes', filters.mes.toString());
	if (filters?.anio) searchParams.set('anio', filters.anio.toString());

	const query = searchParams.toString();
	const url = `/api/pesv/dashboard${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{ success: boolean; data: PesvDashboardData }>(url);
	return response.data;
};

// ==================== FILTER OPTIONS ====================

export const obtenerOpcionesPesv = async () => {
	const response = await apiClient.get<{ success: boolean; data: PesvFilterOptions }>('/api/pesv/options');
	return response.data;
};

// ==================== EXCESOS VELOCIDAD ====================

export const obtenerExcesos = async (filters?: { conductor_id?: string; vehiculo_id?: string; mes?: number; anio?: number }) => {
	const searchParams = new URLSearchParams();
	if (filters?.conductor_id) searchParams.set('conductor_id', filters.conductor_id);
	if (filters?.vehiculo_id) searchParams.set('vehiculo_id', filters.vehiculo_id);
	if (filters?.mes) searchParams.set('mes', filters.mes.toString());
	if (filters?.anio) searchParams.set('anio', filters.anio.toString());

	const query = searchParams.toString();
	const url = `/api/pesv/excesos${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{ success: boolean; data: ExcesoVelocidad[] }>(url);
	return response.data;
};

export const crearOActualizarExceso = async (data: {
	conductor_id: string;
	vehiculo_id: string;
	mes: number;
	anio: number;
	cantidad: number;
	observaciones?: string;
}) => {
	const response = await apiClient.post<{ success: boolean; data: ExcesoVelocidad }>('/api/pesv/excesos', data);
	return response.data;
};

export const eliminarExceso = async (id: string) => {
	const response = await apiClient.delete<{ success: boolean }>(`/api/pesv/excesos/${id}`);
	return response.data;
};

// ==================== PREOPERACIONALES ====================

export const obtenerPreoperacionales = async (filters?: {
	conductor_id?: string;
	vehiculo_id?: string;
	mes?: number;
	anio?: number;
	fecha_desde?: string;
	fecha_hasta?: string;
}) => {
	const searchParams = new URLSearchParams();
	if (filters?.conductor_id) searchParams.set('conductor_id', filters.conductor_id);
	if (filters?.vehiculo_id) searchParams.set('vehiculo_id', filters.vehiculo_id);
	if (filters?.mes) searchParams.set('mes', filters.mes.toString());
	if (filters?.anio) searchParams.set('anio', filters.anio.toString());
	if (filters?.fecha_desde) searchParams.set('fecha_desde', filters.fecha_desde);
	if (filters?.fecha_hasta) searchParams.set('fecha_hasta', filters.fecha_hasta);

	const query = searchParams.toString();
	const url = `/api/pesv/preoperacionales${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{ success: boolean; data: Preoperacional[] }>(url);
	return response.data;
};

export const crearOActualizarPreoperacional = async (data: {
	conductor_id: string;
	vehiculo_id: string;
	fecha: string;
	realizado: boolean;
	observaciones?: string;
}) => {
	const response = await apiClient.post<{ success: boolean; data: Preoperacional }>('/api/pesv/preoperacionales', data);
	return response.data;
};

export const eliminarPreoperacional = async (id: string) => {
	const response = await apiClient.delete<{ success: boolean }>(`/api/pesv/preoperacionales/${id}`);
	return response.data;
};

// ==================== REGISTROS DIARIOS (TABLA PESV) ====================

export const obtenerRegistrosDiarios = async (filters?: {
	mes?: number;
	anio?: number;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id?: string;
}) => {
	const searchParams = new URLSearchParams();
	if (filters?.mes) searchParams.set('mes', filters.mes.toString());
	if (filters?.anio) searchParams.set('anio', filters.anio.toString());
	if (filters?.conductor_id) searchParams.set('conductor_id', filters.conductor_id);
	if (filters?.vehiculo_id) searchParams.set('vehiculo_id', filters.vehiculo_id);
	if (filters?.cliente_id) searchParams.set('cliente_id', filters.cliente_id);

	const query = searchParams.toString();
	const url = `/api/pesv/registros-diarios${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{ success: boolean; data: RegistroDiarioPesv[] }>(url);
	return response.data;
};

export const actualizarRegistroDiaPesv = async (id: string, data: {
	horas_sueno?: number | null;
	excesos_velocidad_dia?: number;
	preoperacional_realizado?: boolean;
	siniestros?: number;
	siniestros_detalle?: string | null;
}) => {
	const response = await apiClient.patch<{ success: boolean; data: any }>(`/api/pesv/registros-diarios/${id}`, data);
	return response.data;
};
