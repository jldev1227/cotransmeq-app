import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

export type TipoHallazgo =
	| 'NC Mayor'
	| 'NC Menor'
	| 'Observación'
	| 'Oportunidad de Mejora'
	| 'Servicio no conforme'
	| 'Otro'
	| 'No conformidad mayor'
	| 'No conformidad menor'
	| 'Oportunidad de mejora'
	| 'NC. MAYOR'
	| 'NC. MENOR'
	| 'OBSERVACIÓN'
	| 'POSIBILIDAD DE MEJORA'
	| 'Hallazgo positivo';
export type ValoracionRiesgo = 'ALTO' | 'MEDIO' | 'BAJO';
export type TipoAccion = 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA';
export type EstadoSeguimiento = 'Cumplida' | 'En Proceso' | 'Vencida';
export type EstadoAccion = 'Cumplidas' | 'En Proceso' | 'Vencidas';

// Step 4 - Aprobación
export type HallazgoTipo = 'NC_MAYOR' | 'NC_MENOR' | 'OBSERVACION' | 'MEJORA';
export type EstadoAprobacion = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

export interface AprobacionAccion {
  id: string;
  accion_id: string;
  orden?: number;
  rol: string;
  aprobador_id?: string;
  aprobador?: { id: string; nombre: string; correo: string; cargo: string } | null;
  estado: EstadoAprobacion;
  fecha?: string;
  comentario?: string;
  created_at: string;
  updated_at?: string;
}

// Step 5 - Estado Global
export type ActionStatusGlobal = 'EN_PROCESO' | 'VENCIDA' | 'CUMPLIDA' | 'REPLANTEADA';
export type EvaluacionCierre = 'EFICAZ' | 'NO EFICAZ' | 'PARCIAL';
export type ResultadoCicloEficacia = 'AVANCE_SATISFACTORIO' | 'SIN_AVANCES';
export type EstadoEvidencia = 'DISPONIBLE' | 'PENDIENTE';

export interface SeguimientoRegistro {
	fecha_seguimiento: string;
	descripcion_observaciones?: string;
	estado_accion: string;
	responsable_seguimiento?: string;
	cargo_responsable_seguimiento?: string;
	adjunto_url?: string;
}

export interface SeguimientoCorreccion extends SeguimientoRegistro {
	id?: string;
	created_at?: string;
}

export interface CicloEficacia {
	id?: string;
	numero_ciclo: number;
	fecha_seguimiento: string;
	descripcion?: string;
	resultado_ciclo?: ResultadoCicloEficacia | 'IMPEDIMENTO_IDENTIFICADO';
	responsable?: string;
	cargo?: string;
	criterios_cumplidos?: string[];
	impedimento?: string;
	nueva_fecha?: string;
	adjunto_url?: string;
}

export interface EvaluacionEficacia {
	fecha_evaluacion: string;
	evaluador: string;
	analisis_evaluacion: string;
}

export interface Replanteo {
	nueva_fecha_limite: string;
	responsable: string;
	justificacion: string;
	cambios: string;
}

export interface EvidenciaEficacia {
	id?: string;
	orden: number;
	tipo_evidencia?: string;
	descripcion?: string;
	fecha?: string;
	estado_ubicacion?: EstadoEvidencia;
	adjunto_url?: string;
}

export interface SeguimientoCausa {
	id: string;
	causa_id: string;
	fecha_seguimiento: string;
	estado_accion: EstadoAccion;
	descripcion_observaciones?: string;
	evaluacion_eficaz?: EvaluacionCierre;
	registrado_por_id?: string;
	registrado_por?: {
		id: string;
		nombre: string;
		correo: string;
	};
	adjunto_url?: string;
	created_at: string;
}

export interface CausaAccion {
	id?: string;
	orden: number;
	analisis_causa: string;
	es_causa_raiz?: boolean;
	descripcion_plan_accion?: string;
	seguimientos?: SeguimientoCausa[];
	fecha_limite_implementacion?: string;
	responsable_ejecucion?: string;
	fecha_seguimiento?: string;
	estado_seguimiento?: EstadoSeguimiento;
	descripcion_observaciones?: string;
	// Evaluación de eficacia y cierre individual por causa
	fecha_evaluacion_eficacia?: string;
	criterio_evaluacion_eficacia?: string;
	analisis_evidencias_cierre?: string;
	evaluacion_cierre_eficaz?: EvaluacionCierre;
	soporte_cierre_eficaz?: string;
	fecha_cierre?: string;
	responsable_cierre?: string;
	created_at?: string;
	updated_at?: string;
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
	aplica_correccion_inmediata?: boolean;
	justificacion_no_correccion?: string;
	responsable_correccion?: string;
	correccion_solucion_inmediata?: string;
	fecha_implementacion?: string; // ISO date
	valoracion_riesgo?: ValoracionRiesgo;
	requiere_actualizar_matriz?: boolean;
	matriz_a_actualizar?: string;
	replanteo_correccion?: Replanteo;

	// Análisis y plan de acción
	tipo_accion_ejecutar?: TipoAccion;
	fecha_limite_cierre_accion?: string; // ISO date
	responsable_ejecucion?: string;
	fecha_seguimiento?: string; // ISO date
	estado_accion?: string; // "Cumplida (CERRADA)", "Vencida (REPLANTEADA)", "En Proceso (ABIERTA)", etc.
	observaciones?: string;
	causas?: CausaAccion[];
	seguimientos_correccion?: SeguimientoCorreccion[];

	// Evaluación de eficacia
	fecha_limite_evaluacion_eficacia?: string;
	ciclos_eficacia?: CicloEficacia[];
	evaluaciones_eficacia?: EvaluacionEficacia[];
	evidencias_eficacia?: EvidenciaEficacia[];
	fecha_evaluacion_eficacia?: string;
	criterio_evaluacion_eficacia?: string;
	analisis_evidencias_cierre?: string;
	evaluacion_cierre_eficaz?: EvaluacionCierre;
	soporte_cierre_eficaz?: string;
	fecha_cierre_definitivo?: string;
	responsable_cierre?: string;
	cargo_responsable_cierre?: string;
	observaciones_cierre?: string;

	// Reapertura
	aplica_reapertura?: boolean;
	fecha_reapertura?: string;
	razon_reapertura?: string;
	accion_origen_reapertura?: string;

	// Step 4 - Aprobación
	hallazgo_tipo?: string;
	estado_aprobacion?: string;
	aprobaciones?: AprobacionAccion[];

	// Step 5 - Estado global
	estado_global?: ActionStatusGlobal;
	fecha_actualizacion_estado?: string;
	registrado_por_id?: string;
	registrado_por?: {
		id: string;
		nombre: string;
		correo: string;
		cargo: string;
	};

	// Metadata
	created_at: string;
	updated_at: string;
	creado_por_id: string;
	deleted_at?: string;
	creado_por?: {
		id: string;
		nombre: string;
		correo: string;
	};
	usuarios?: {
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
	aplica_correccion_inmediata?: boolean;
	justificacion_no_correccion?: string;
	responsable_correccion?: string;
	correccion_solucion_inmediata?: string;
	fecha_implementacion?: string;
	valoracion_riesgo?: ValoracionRiesgo;
	requiere_actualizar_matriz?: boolean;
	matriz_a_actualizar?: string;
	replanteo_correccion?: Replanteo;
	tipo_accion_ejecutar?: TipoAccion;
	causas?: CausaAccion[];
	seguimientos_correccion?: SeguimientoRegistro[];
	fecha_limite_evaluacion_eficacia?: string;
	ciclos_eficacia?: CicloEficacia[];
	evaluaciones_eficacia?: EvaluacionEficacia[];
	evidencias_eficacia?: EvidenciaEficacia[];
	fecha_evaluacion_eficacia?: string;
	criterio_evaluacion_eficacia?: string;
	analisis_evidencias_cierre?: string;
	evaluacion_cierre_eficaz?: EvaluacionCierre;
	soporte_cierre_eficaz?: string;
	fecha_cierre_definitivo?: string;
	responsable_cierre?: string;
	cargo_responsable_cierre?: string;
	observaciones_cierre?: string;
	aplica_reapertura?: boolean;
	fecha_reapertura?: string;
	razon_reapertura?: string;
	accion_origen_reapertura?: string;
}

export type UpdateAccionInput = Partial<CreateAccionInput>;

export interface ListarAccionesFiltros {
	tipo?: TipoAccion;
	estado?: EstadoAccion;
	estado_global?: ActionStatusGlobal;
	riesgo?: ValoracionRiesgo;
	fecha_desde?: string;
	fecha_hasta?: string;
	busqueda?: string;
	page?: number;
	limit?: number;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	ultimos_90_dias?: boolean;
	incluir_eliminados?: boolean;
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
	por_tipo: Record<string, number>;
	por_estado: Record<string, number>;
	por_riesgo: Record<string, number>;
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
		if (filtros.estado_global) params.append('estado_global', filtros.estado_global);
		if (filtros.riesgo) params.append('riesgo', filtros.riesgo);
		if (filtros.fecha_desde) params.append('fecha_desde', filtros.fecha_desde);
		if (filtros.fecha_hasta) params.append('fecha_hasta', filtros.fecha_hasta);
		if (filtros.busqueda) params.append('busqueda', filtros.busqueda);
		if (filtros.page) params.append('page', filtros.page.toString());
		if (filtros.limit) params.append('limit', filtros.limit.toString());
		if (filtros.sortBy) params.append('sortBy', filtros.sortBy);
		if (filtros.sortOrder) params.append('sortOrder', filtros.sortOrder);
		if (filtros.ultimos_90_dias) params.append('ultimos_90_dias', 'true');
		if (filtros.incluir_eliminados) params.append('incluir_eliminados', 'true');

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


	async duplicar(id: string): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/${id}/duplicar`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: '{}'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al duplicar la acción');
		}

		const result = await response.json();
		return result.data;
	}

	async uploadAdjunto(file: File): Promise<{ key: string; url: string; filename: string }> {
		const formData = new FormData();
		formData.append('file', file);

		const token = browser ? localStorage.getItem('transmeralda_token') : null;
		const response = await fetch(`${this.baseUrl}/upload`, {
			method: 'POST',
			headers: {
				...(token && { Authorization: `Bearer ${token}` })
			},
			body: formData
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al subir el archivo');
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
			const error = await response.json();
			throw new Error(error.message || 'Error al eliminar la acción');
		}
	}

	async restaurar(id: string): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/${id}/restaurar`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: '{}'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al restaurar la acción');
		}

		const result = await response.json();
		return result.data;
	}

	async eliminarPermanente(id: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/${id}/permanente`, {
			method: 'DELETE',
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al eliminar permanentemente');
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

	// ============================================
	// GESTIÓN DE CAUSAS
	// ============================================

	async crearCausa(
		accionId: string,
		data: {
			orden: number;
			analisis_causa: string;
			descripcion_plan_accion?: string;
			responsable_ejecucion?: string;
			fecha_limite_implementacion?: string;
			estado_seguimiento?: EstadoSeguimiento;
		}
	): Promise<CausaAccion> {
		const response = await fetch(`${this.baseUrl}/${accionId}/causas`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al crear la causa');
		}

		const result = await response.json();
		return result.data;
	}

	async actualizarCausa(
		accionId: string,
		causaId: string,
		data: {
			analisis_causa?: string;
			descripcion_plan_accion?: string;
			responsable_ejecucion?: string;
			fecha_limite_implementacion?: string;
			estado_seguimiento?: EstadoSeguimiento;
			descripcion_observaciones?: string;
			fecha_seguimiento?: string;
			fecha_evaluacion_eficacia?: string;
			criterio_evaluacion_eficacia?: string;
			analisis_evidencias_cierre?: string;
			evaluacion_cierre_eficaz?: EvaluacionCierre;
			soporte_cierre_eficaz?: string;
			fecha_cierre?: string;
			responsable_cierre?: string;
			sugerencia_ia?: any;
		}
	): Promise<CausaAccion> {
		const response = await fetch(`${this.baseUrl}/${accionId}/causas/${causaId}`, {
			method: 'PUT',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al actualizar la causa');
		}

		const result = await response.json();
		return result.data;
	}

	// ============================================
	// SUGERENCIAS IA
	// ============================================

	async solicitarSugerenciaIA(data: {
		analisis_causa: string;
		orden_causa: number;
		descripcion_hallazgo: string;
		tipo_accion: TipoAccion;
		valoracion_riesgo: ValoracionRiesgo;
		lugar_sede?: string;
		proceso_origen?: string;
	}): Promise<any> {
		const response = await fetch(`${this.baseUrl}/sugerencias-ia`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al solicitar sugerencias IA');
		}

		const result = await response.json();
		return result.data;
	}

	// ============================================
	// TRAZABILIDAD (SEGUIMIENTOS POR CAUSA)
	// ============================================

	async listarSeguimientosCausa(accionId: string, causaId: string): Promise<SeguimientoCausa[]> {
		const response = await fetch(`${this.baseUrl}/${accionId}/causas/${causaId}/seguimientos`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			const error = await response.json().catch(() => null);
			throw new Error(error?.message || 'Error al obtener seguimientos');
		}

		const result = await response.json();
		return result.data;
	}

	async crearSeguimientoCausa(
		accionId: string,
		causaId: string,
		data: {
			fecha_seguimiento: string;
			estado_accion: EstadoAccion;
			descripcion_observaciones?: string;
			evaluacion_eficaz?: EvaluacionCierre;
		}
	): Promise<SeguimientoCausa> {
		const response = await fetch(`${this.baseUrl}/${accionId}/causas/${causaId}/seguimientos`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al crear seguimiento');
		}

		const result = await response.json();
		return result.data;
	}

	// ============================================
	// STEP 4 - APROBACIÓN DEL PLAN DE ACCIÓN
	// ============================================
	// STEP 4 - APROBACIÓN DEL PLAN DE ACCIÓN
	// ============================================
	//
	// Modelo: una sola aprobación por acción. No existe "inicializar".
	// El usuario autenticado aprueba/rechaza directamente; el backend
	// valida que su cargo coincida con el rol esperado.
	//

	async obtenerAprobaciones(accionId: string): Promise<{
		hallazgoTipo: { hallazgo_tipo: string; estado_aprobacion: string } | null;
		rolEsperado: string | null;
		approval: AprobacionAccion | null;
	}> {
		const response = await fetch(`${this.baseUrl}/${accionId}/aprobaciones`, {
			headers: await this.getAuthHeaders()
		});
		if (!response.ok) {
			throw new Error('Error al obtener aprobaciones');
		}
		const result = await response.json();
		return result.data;
	}

	async aprobar(
		accionId: string,
		comentario?: string
	): Promise<AprobacionAccion> {
		const response = await fetch(`${this.baseUrl}/${accionId}/aprobaciones/aprobar`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({ comentario })
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al aprobar');
		}
		const result = await response.json();
		return result.data;
	}

	async rechazar(
		accionId: string,
		comentario: string
	): Promise<AprobacionAccion> {
		const response = await fetch(`${this.baseUrl}/${accionId}/aprobaciones/rechazar`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({ comentario })
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al rechazar');
		}
		const result = await response.json();
		return result.data;
	}

	async resetAprobacion(accionId: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/${accionId}/aprobaciones/reset`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({})
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al resetear aprobación');
		}
	}

	// ============================================
	// STEP 5 - ESTADO DE LA ACCIÓN
	// ============================================

	async calcularEstadoGlobal(accionId: string): Promise<{
		estado_anterior: string;
		estado_nuevo: string;
	}> {
		const response = await fetch(`${this.baseUrl}/${accionId}/calcular-estado`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({})
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al calcular estado global');
		}
		const result = await response.json();
		return result.data;
	}

	async actualizarEstadoGlobal(
		accionId: string,
		data: {
			estado_global: ActionStatusGlobal;
			registrado_por_id?: string;
			observaciones?: string;
		}
	): Promise<AccionCorrectivaPreventiva> {
		const response = await fetch(`${this.baseUrl}/${accionId}/estado-global`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al actualizar estado global');
		}
		const result = await response.json();
		return result.data;
	}
}

export const accionesCorrectivasAPI = new AccionesCorrectivasAPI();
