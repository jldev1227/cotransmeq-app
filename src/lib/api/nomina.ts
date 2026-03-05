import { apiClient } from './apiClient';
import type {
	Liquidacion,
	Conductor,
	Vehiculo,
	ConfiguracionLiquidacion,
	Empresa,
	CreateLiquidacionPayload,
	UpdateLiquidacionPayload,
	FirmaDesprendible,
	FirmaConUrl
} from '$lib/types/nomina';

/**
 * API Cliente para el módulo de Nómina - Cotransmeq
 */

// ==================== LIQUIDACIONES ====================

export interface LiquidacionesParams {
	page?: number;
	limit?: number;
	search?: string;
	estado?: string;
	sortBy?: string;
	sortOrder?: string;
	nomina_month?: string;
}

/**
 * Obtener todas las liquidaciones con paginación y filtros
 */
export const obtenerLiquidaciones = async (params?: LiquidacionesParams) => {
	const searchParams = new URLSearchParams();
	if (params?.page) searchParams.set('page', params.page.toString());
	if (params?.limit) searchParams.set('limit', params.limit.toString());
	if (params?.search) searchParams.set('search', params.search);
	if (params?.estado) searchParams.set('estado', params.estado);
	if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
	if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
	if (params?.nomina_month) searchParams.set('nomina_month', params.nomina_month);

	const query = searchParams.toString();
	const url = `/api/liquidaciones${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{
		data: Liquidacion[];
		pagination: {
			total: number;
			page: number;
			limit: number;
			totalPages: number;
			hasNext: boolean;
			hasPrev: boolean;
		};
		stats: {
			totalRegistros: number;
			totalPendientes: number;
			montoTotal: number;
		};
	}>(url);
	return response.data;
};

/**
 * Obtener una liquidación por ID
 */
export const obtenerLiquidacionPorId = async (id: string) => {
	const response = await apiClient.get<{ data: Liquidacion }>(`/api/liquidaciones/${id}`);
	return response.data;
};

/**
 * Crear nueva liquidación
 */
export const crearLiquidacion = async (payload: CreateLiquidacionPayload) => {
	const response = await apiClient.post<{ success: boolean; data: Liquidacion }>(
		'/api/liquidaciones',
		payload
	);
	return response.data;
};

/**
 * Editar liquidación existente
 */
export const editarLiquidacion = async (id: string, payload: UpdateLiquidacionPayload) => {
	const response = await apiClient.put<{ success: boolean; data: Liquidacion }>(
		`/api/liquidaciones/${id}`,
		payload
	);
	return response.data;
};

/**
 * Eliminar liquidación
 */
export const eliminarLiquidacion = async (id: string) => {
	const response = await apiClient.delete<{ success: boolean; message: string }>(
		`/api/liquidaciones/${id}`
	);
	return response.data;
};

// ==================== CONDUCTORES ====================

/**
 * Obtener todos los conductores
 */
export const obtenerConductores = async () => {
	const response = await apiClient.get<{ data: Conductor[] }>('/api/conductores?limit=9999');
	return response.data;
};

// ==================== VEHÍCULOS ====================

/**
 * Obtener todos los vehículos
 */
export const obtenerVehiculos = async () => {
	const response = await apiClient.get<{ data: Vehiculo[] }>('/api/vehiculos');
	return response.data;
};

// ==================== EMPRESAS ====================

/**
 * Obtener todas las empresas
 */
export const obtenerEmpresas = async () => {
	const response = await apiClient.get<{ data: Empresa[] }>('/api/empresas');
	return response.data;
};

// ==================== CONFIGURACIÓN ====================

/**
 * Obtener configuración de liquidación
 */
export const obtenerConfiguracion = async () => {
	const response = await apiClient.get<{ data: ConfiguracionLiquidacion }>(
		'/api/configuraciones-liquidacion'
	);
	return response.data;
};

/**
 * Actualizar configuración de liquidación
 */
export const actualizarConfiguracion = async (
	id: string,
	payload: Partial<ConfiguracionLiquidacion>
) => {
	const response = await apiClient.put<{ success: boolean; data: ConfiguracionLiquidacion }>(
		`/api/configuraciones-liquidacion/${id}`,
		payload
	);
	return response.data;
};

// ==================== DESPRENDIBLES ====================

/**
 * Obtener firmas de desprendible por liquidación ID
 */
export const obtenerFirmasPorLiquidacion = async (liquidacionId: string) => {
	const response = await apiClient.get<{ data: FirmaConUrl[] }>(
		`/api/firmas/liquidacion/${liquidacionId}`
	);
	return response.data;
};

/**
 * Generar PDFs y enviar correos
 */
export const generarDesprendibles = async (liquidacionIds: string[]) => {
	const response = await apiClient.post<{
		success: boolean;
		jobId: string;
		message: string;
	}>('/api/desprendibles/generate', { liquidacionIds });
	return response.data;
};

/**
 * Verificar estado de generación de desprendibles
 */
export const verificarEstadoDesprendibles = async (jobId: string) => {
	const response = await apiClient.get<{
		status: string;
		progress: number;
		completed?: number;
		failed?: number;
	}>(`/api/desprendibles/status/${jobId}`);
	return response.data;
};

export default {
	obtenerLiquidaciones,
	obtenerLiquidacionPorId,
	crearLiquidacion,
	editarLiquidacion,
	eliminarLiquidacion,
	obtenerConductores,
	obtenerVehiculos,
	obtenerEmpresas,
	obtenerConfiguracion,
	actualizarConfiguracion,
	generarDesprendibles,
	verificarEstadoDesprendibles,
	obtenerFirmasPorLiquidacion
};
