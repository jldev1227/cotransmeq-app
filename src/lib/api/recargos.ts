// src/lib/api/recargos.ts

import { apiClient } from './apiClient';
import type {
	RecargoPlanilla,
	RecargoPlanillaFiltros,
	RecargoPlanillaResponse,
	CrearRecargoPlanillaDTO,
	ActualizarRecargoPlanillaDTO,
	HistorialRecargo,
	TipoRecargo,
	ConfiguracionSalario,
	CanvasRecargo
} from '$lib/types/recargos';

const BASE_URL = '/api/recargos';

export const recargosApi = {
	/**
	 * Obtener recargos para canvas con filtros
	 */
	async obtenerParaCanvas(
		filtros: RecargoPlanillaFiltros = {}
	): Promise<{ data: CanvasRecargo[]; pagination: any }> {
		const params = new URLSearchParams();

		if (filtros.conductor_id) params.append('conductor_id', filtros.conductor_id);
		if (filtros.vehiculo_id) params.append('vehiculo_id', filtros.vehiculo_id);
		if (filtros.empresa_id) params.append('empresa_id', filtros.empresa_id);
		if (filtros.mes) params.append('mes', filtros.mes.toString());
		if (filtros.año) params.append('ano', filtros.año.toString()); // Usar 'ano' sin ñ
		if (filtros.estado) params.append('estado', filtros.estado);
		if (filtros.numero_planilla) params.append('numero_planilla', filtros.numero_planilla);
		if (filtros.page) params.append('page', filtros.page.toString());
		if (filtros.limit) params.append('limit', filtros.limit.toString());

		const response = await apiClient.get<{ data: CanvasRecargo[]; pagination: any }>(
			`${BASE_URL}?${params.toString()}`
		);
		return response.data;
	},

	/**
	 * Obtener un recargo por ID con todas sus relaciones
	 */
	async obtenerPorId(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.get<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}`);
		return response.data.data;
	},

	/**
	 * Crear nuevo recargo
	 */
	async crear(data: CrearRecargoPlanillaDTO): Promise<RecargoPlanilla> {
		// Enviar como JSON, no como FormData
		const response = await apiClient.post<{ data: RecargoPlanilla }>(BASE_URL, data);
		return response.data.data;
	},

	/**
	 * Actualizar recargo existente
	 */
	async actualizar(id: string, data: ActualizarRecargoPlanillaDTO): Promise<RecargoPlanilla> {
		const response = await apiClient.put<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}`, data);
		return response.data.data;
	},

	/**
	 * Eliminar recargo (soft delete)
	 */
	async eliminar(id: string): Promise<void> {
		await apiClient.delete(`${BASE_URL}/${id}`);
	},

	/**
	 * Eliminar múltiples recargos (soft delete)
	 */
	async eliminarMultiple(ids: string[]): Promise<{ eliminados: number }> {
		const response = await apiClient.post<{ data: { eliminados: number } }>(
			`${BASE_URL}/eliminar-multiple`,
			{ ids }
		);
		return response.data.data;
	},

	/**
	 * Liquidar recargo (cambiar estado a liquidada)
	 */
	async liquidar(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.post<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}/liquidar`);
		return response.data.data;
	},

	/**
	 * Obtener historial de cambios de un recargo
	 */
	async obtenerHistorial(id: string): Promise<HistorialRecargo[]> {
		const response = await apiClient.get<{ data: HistorialRecargo[] }>(
			`${BASE_URL}/${id}/historial`
		);
		return response.data.data;
	},

	/**
	 * Obtener tipos de recargo activos
	 */
	async obtenerTiposRecargo(): Promise<TipoRecargo[]> {
		const response = await apiClient.get<{ data: TipoRecargo[] }>('/tipos-recargo');
		return response.data.data;
	},

	/**
	 * Obtener configuración salarial de una empresa
	 */
	async obtenerConfigSalario(empresaId: string): Promise<ConfiguracionSalario> {
		const response = await apiClient.get<{ data: ConfiguracionSalario }>(
			`/configuracion-salario/empresa/${empresaId}`
		);
		return response.data.data;
	},

	/**
	 * Descargar archivo de planilla
	 */
	async descargarPlanilla(id: string): Promise<Blob> {
		const response = await apiClient.get(`${BASE_URL}/${id}/descargar-planilla`, {
			responseType: 'blob'
		});
		return response.data;
	},

	/**
	 * Duplicar recargo (crear copia)
	 */
	async duplicar(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.post<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}/duplicar`);
		return response.data.data;
	},

	/**
	 * Obtener estadísticas/resumen
	 */
	async obtenerEstadisticas(filtros: {
		mes?: number;
		año?: number;
		empresa_id?: string;
	}): Promise<any> {
		const params = new URLSearchParams();
		if (filtros.mes) params.append('mes', filtros.mes.toString());
		if (filtros.año) params.append('año', filtros.año.toString());
		if (filtros.empresa_id) params.append('empresa_id', filtros.empresa_id);

		const response = await apiClient.get<{ data: any }>(`${BASE_URL}/stats/resumen?${params}`);
		return response.data.data;
	}
};
