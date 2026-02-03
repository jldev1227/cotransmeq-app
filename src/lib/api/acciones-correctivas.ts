import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

export type TipoHallazgo =
	| 'No conformidad mayor'
	| 'No conformidad menor'
	| 'Observación'
	| 'Oportunidad de mejora'
	| 'Hallazgo positivo'
	| 'Otro';
export type ValoracionRiesgo = 'ALTO' | 'MEDIO' | 'BAJO';
export type TipoAccion = 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA';
export type EstadoSeguimiento = 'Cumplida' | 'En Proceso' | 'Vencida';
export type EvaluacionCierre = 'EFICAZ' | 'NO EFICAZ';

export interface CausaAccion {
	id?: string;
	orden: number;
	analisis_causa: string;
	descripcion_plan_accion?: string;
	fecha_limite_implementacion?: string;
	responsable_ejecucion?: string;
	fecha_seguimiento?: string;
	estado_seguimiento?: EstadoSeguimiento;
	descripcion_observaciones?: string;
}

export interface AccionCorrectivaPreventiva {
	id: string;
	accion_numero: string; // e.g., "A22_1"

	// Identificación del hallazgo
	lugar_sede?: string;
	proceso_origen_hallazgo?: string;
	componente_elemento_referencia?: string;
	fuente_genero_hallazgo?: string;
	marco_legal_normativo?: string;
	fecha_identificacion_hallazgo?: string; // ISO date
	descripcion_hallazgo?: string;
	tipo_hallazgo_detectado?: TipoHallazgo;
	variable_categoria_analisis?: string;

	// Corrección inmediata
	correccion_solucion_inmediata?: string;
	fecha_implementacion?: string; // ISO date
	valoracion_riesgo?: ValoracionRiesgo;
	requiere_actualizar_matriz?: boolean;

	// Análisis y plan de acción
	tipo_accion_ejecutar?: TipoAccion;
	causas?: CausaAccion[]; // Array de causas con seguimiento independiente

	// Evaluación de eficacia
	fecha_evaluacion_eficacia?: string; // ISO date
	criterio_evaluacion_eficacia?: string;
	analisis_evidencias_cierre?: string;
	evaluacion_cierre_eficaz?: EvaluacionCierre;
	soporte_cierre_eficaz?: string;
	fecha_cierre_definitivo?: string; // ISO date
	responsable_cierre?: string;

	// Metadata
	created_at: string;
	updated_at: string;
	creado_por_id: string;
	creado_por?: {
		id: string;
		nombre: string;
		correo: string;
	};
}

export interface CreateAccionInput {
	accion_numero: string;
	lugar_sede?: string;
	proceso_origen_hallazgo?: string;
	componente_elemento_referencia?: string;
	fuente_genero_hallazgo?: string;
	marco_legal_normativo?: string;
	fecha_identificacion_hallazgo?: string;
	descripcion_hallazgo?: string;
	tipo_hallazgo_detectado?: TipoHallazgo;
	variable_categoria_analisis?: string;
	correccion_solucion_inmediata?: string;
	fecha_implementacion?: string;
	valoracion_riesgo?: ValoracionRiesgo;
	requiere_actualizar_matriz?: boolean;
	tipo_accion_ejecutar?: TipoAccion;
	causas?: CausaAccion[]; // Array de causas con seguimiento
	fecha_evaluacion_eficacia?: string;
	criterio_evaluacion_eficacia?: string;
	analisis_evidencias_cierre?: string;
	evaluacion_cierre_eficaz?: EvaluacionCierre;
	soporte_cierre_eficaz?: string;
	fecha_cierre_definitivo?: string;
	responsable_cierre?: string;
}

export type UpdateAccionInput = Partial<CreateAccionInput>;

export interface ListarAccionesFiltros {
	tipo?: TipoAccion;
	estado?: EstadoAccion;
	riesgo?: ValoracionRiesgo;
	fecha_desde?: string;
	fecha_hasta?: string;
	busqueda?: string;
	page?: number;
	limit?: number;
}

export interface ListarAccionesResponse {
	acciones: AccionCorrectivaPreventiva[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface EstadisticasAcciones {
	total: number;
	por_tipo: {
		CORRECTIVA: number;
		PREVENTIVA: number;
		MEJORA: number;
	};
	por_estado: {
		Cumplidas: number;
		'En Proceso': number;
		Vencidas: number;
	};
	por_riesgo: {
		ALTO: number;
		MEDIO: number;
		BAJO: number;
	};
	proximas_vencer: number;
}

class AccionesCorrectivasAPI {
	private baseUrl = `${API_URL}/api/acciones-correctivas`;

	private async getAuthHeaders() {
		const token = browser ? localStorage.getItem('transmeralda_token') : null;
		return {
			'Content-Type': 'application/json',
			...(token && { Authorization: `Bearer ${token}` })
		};
	}

	// ============================================
	// CRUD OPERATIONS
	// ============================================

	async crear(data: CreateAccionInput): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al crear la acción');
		}

		const result = await response.json();
		return result.data;
	}

	async listar(filtros: ListarAccionesFiltros = {}): Promise<ListarAccionesResponse> {
		const params = new URLSearchParams();

		if (filtros.tipo) params.append('tipo', filtros.tipo);
		if (filtros.estado) params.append('estado', filtros.estado);
		if (filtros.riesgo) params.append('riesgo', filtros.riesgo);
		if (filtros.fecha_desde) params.append('fecha_desde', filtros.fecha_desde);
		if (filtros.fecha_hasta) params.append('fecha_hasta', filtros.fecha_hasta);
		if (filtros.busqueda) params.append('busqueda', filtros.busqueda);
		if (filtros.page) params.append('page', filtros.page.toString());
		if (filtros.limit) params.append('limit', filtros.limit.toString());

		const url = params.toString() ? `${this.baseUrl}?${params}` : this.baseUrl;

		const response = await fetch(url, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener las acciones');
		}

		const result = await response.json();
		return result.data;
	}

	async obtenerPorId(id: string): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener la acción');
		}

		const result = await response.json();
		return result.data;
	}

	// Alias para obtenerPorId
	async obtener(id: string): Promise<AccionCorrectivaPreventiva> {
		return this.obtenerPorId(id);
	}

	async obtenerPorNumero(accion_numero: string): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/numero/${accion_numero}`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener la acción');
		}

		const result = await response.json();
		return result.data;
	}

	async actualizar(id: string, data: UpdateAccionInput): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			method: 'PUT',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al actualizar la acción');
		}

		const result = await response.json();
		return result.data;
	}

	async eliminar(id: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			method: 'DELETE',
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al eliminar la acción');
		}
	}

	// ============================================
	// ESTADÍSTICAS
	// ============================================

	async obtenerEstadisticas(): Promise<EstadisticasAcciones> {
		const response = await fetch(`${this.baseUrl}/estadisticas`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener las estadísticas');
		}

		const result = await response.json();
		return result.data;
	}

	// ============================================
	// EXPORTAR PDF
	// ============================================

	async exportarPDF(id: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/${id}/exportar-pdf`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al exportar el PDF');
		}

		return await response.blob();
	}

	async descargarPDF(id: string, accion_numero: string): Promise<void> {
		try {
			const blob = await this.exportarPDF(id);
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Accion_${accion_numero.replace('/', '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			document.body.removeChild(a);
		} catch {
			throw new Error('Error al descargar el PDF');
		}
	}
}

export const accionesCorrectivasAPI = new AccionesCorrectivasAPI();
