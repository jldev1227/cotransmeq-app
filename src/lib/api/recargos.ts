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
	CrearConfiguracionSalarioDTO,
	ActualizarConfiguracionSalarioDTO,
	EmpresaDisponible,
	CanvasRecargo
} from '$lib/types/recargos';

const BASE_URL = '/api/recargos';

export const recargosApi = {
	/**
	 * Obtener recargos para canvas con filtros.
	 * Acepta un AbortSignal opcional para cancelar la petición cuando el usuario
	 * cambia de mes/año rápidamente (la página debouncea + aborta el request anterior).
	 */
	async obtenerParaCanvas(
		filtros: RecargoPlanillaFiltros,
		options?: { signal?: AbortSignal }
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
		if (filtros.eliminados) params.append('eliminados', filtros.eliminados.toString());

		const response = await apiClient.get<{ data: CanvasRecargo[]; pagination: any }>(
			`${BASE_URL}?${params.toString()}`,
			{ signal: options?.signal }
		);
		return response.data;
	},

	/**
	 * Devuelve el siguiente número de planilla libre (TM-XXXX).
	 * Endpoint ligero: NO trae recargos, solo el campo numero_planilla.
	 * Se usa en ModalFormRecargo para auto-generar el número al abrir
	 * un nuevo recargo. El backend lo calcula leyendo solo numero_planilla
	 * (sin joins), así que retorna en ms aunque haya miles de planillas.
	 */
	async obtenerSiguienteNumeroPlanilla(): Promise<string> {
		const response = await apiClient.get<{
			success: boolean;
			data: { numero_planilla: string };
		}>(`${BASE_URL}/next-numero-planilla`);
		return response.data.data.numero_planilla;
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
	 * Restaurar recargo (soft delete)
	 */
	async restaurar(id: string): Promise<void> {
		await apiClient.patch(`${BASE_URL}/restaurar/${id}`);
	},

	/**
	 * Restaurar múltiples recargos (soft delete)
	 */
	async restaurarMultiple(ids: string[]): Promise<{ eliminados: number }> {
		const response = await apiClient.post<{ data: { eliminados: number } }>(
			`${BASE_URL}/restaurar-multiple`,
			{ ids }
		);
		return response.data.data;
	},

	/**
	 * Cambiar estado de múltiples recargos
	 */
	async cambiarEstadoMultiple(
		ids: string[],
		estado: string
	): Promise<{ actualizados: number; estado: string }> {
		const response = await apiClient.patch<{ data: { actualizados: number; estado: string } }>(
			`${BASE_URL}/cambiar-estado-multiple`,
			{ ids, estado }
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

	// ═══════════════════════════════════════════════════════════
	// CONFIGURACIONES SALARIOS — CRUD
	// ═══════════════════════════════════════════════════════════

	/**
	 * Listar configuraciones de salarios con filtros opcionales
	 */
	async obtenerConfiguracionesSalarios(filtros?: {
		activo?: boolean;
		empresa_id?: string;
	}): Promise<ConfiguracionSalario[]> {
		const params = new URLSearchParams();
		if (filtros?.activo !== undefined) params.append('activo', String(filtros.activo));
		if (filtros?.empresa_id) params.append('empresa_id', filtros.empresa_id);
		const query = params.toString() ? `?${params.toString()}` : '';
		const response = await apiClient.get<{ data: ConfiguracionSalario[] }>(
			`${BASE_URL}/configuraciones-salarios${query}`
		);
		return response.data.data;
	},

	/**
	 * Obtener una configuración de salario por ID
	 */
	async obtenerConfiguracionSalario(id: string): Promise<ConfiguracionSalario> {
		const response = await apiClient.get<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios/${id}`
		);
		return response.data.data;
	},

	/**
	 * Crear nueva configuración de salario
	 */
	async crearConfiguracionSalario(
		data: CrearConfiguracionSalarioDTO
	): Promise<ConfiguracionSalario> {
		const response = await apiClient.post<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios`,
			data
		);
		return response.data.data;
	},

	/**
	 * Actualizar configuración de salario existente
	 */
	async actualizarConfiguracionSalario(
		id: string,
		data: ActualizarConfiguracionSalarioDTO
	): Promise<ConfiguracionSalario> {
		const response = await apiClient.put<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios/${id}`,
			data
		);
		return response.data.data;
	},

	/**
	 * Eliminar configuración de salario (soft delete)
	 */
	async eliminarConfiguracionSalario(id: string): Promise<void> {
		await apiClient.delete(`${BASE_URL}/configuraciones-salarios/${id}`);
	},

	/**
	 * Obtener empresas disponibles para selects
	 */
	async obtenerEmpresasDisponibles(): Promise<EmpresaDisponible[]> {
		const response = await apiClient.get<{ data: EmpresaDisponible[] }>(
			`${BASE_URL}/empresas-disponibles`
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
	},
	/**
	 * Obtener reporte mensual
	 */
	async reportePdf(mes: number, año: number): Promise<void> {
		const params = new URLSearchParams();
		params.append('mes', mes.toString());
		params.append('anio', año.toString());

		const response = await apiClient.get(`${BASE_URL}/reporte?${params}`, {
			responseType: 'blob' // ← le dice a Axios que la respuesta es binario
		});

		// Crear URL temporal y disparar descarga
		const blob = new Blob([response.data], { type: 'application/pdf' });
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');

		link.href = url;
		link.download = `Reporte_Servicios_${mes}_${año}.pdf`;
		link.click();

		// Limpiar memoria
		window.URL.revokeObjectURL(url);
	}
};
