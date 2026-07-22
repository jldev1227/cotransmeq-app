import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

export type TipoEvento =
	| 'capacitacion'
	| 'asesoria'
	| 'charla'
	| 'induccion'
	| 'reunion'
	| 'divulgacion'
	| 'otro';

export interface FormularioAsistencia {
	id: string;
	tematica: string;
	objetivo?: string; // Antes era "descripcion"
	fecha: string;
	hora_inicio?: string; // HH:mm
	hora_finalizacion?: string; // HH:mm
	duracion_minutos?: number;
	tipo_evento: TipoEvento;
	tipo_evento_otro?: string;
	lugar_sede?: string;
	nombre_instructor?: string;
	observaciones?: string;
	token: string;
	activo: boolean;
	created_at: string;
	updated_at: string;
	creado_por?: {
		id: string;
		nombre: string;
		correo: string;
	};
	_count?: {
		respuestas: number;
	};
	respuestas?: RespuestaAsistencia[];
}

export interface RespuestaAsistencia {
	id: string;
	formulario_id: string;
	nombre_completo: string;
	numero_documento: string;
	cargo: string;
	numero_telefono: string;
	pertenece_comite?: boolean;
	nombre_comite?: string;
	firma: string;
	ip_address: string;
	user_agent: string;
	device_fingerprint: string;
	created_at: string;
}

export interface CreateFormularioInput {
	tematica: string;
	objetivo?: string;
	fecha: string; // ISO date
	hora_inicio?: string;
	hora_finalizacion?: string;
	tipo_evento: TipoEvento;
	tipo_evento_otro?: string;
	lugar_sede?: string;
	nombre_instructor?: string;
	observaciones?: string;
}

export interface UpdateFormularioInput {
	tematica?: string;
	objetivo?: string;
	fecha?: string;
	hora_inicio?: string;
	hora_finalizacion?: string;
	tipo_evento?: TipoEvento;
	tipo_evento_otro?: string;
	lugar_sede?: string;
	nombre_instructor?: string;
	activo?: boolean;
}

export interface CreateRespuestaInput {
	nombre_completo: string;
	numero_documento: string;
	cargo: string;
	numero_telefono: string;
	pertenece_comite?: boolean;
	nombre_comite?: string;
	firma: string; // Base64
	device_fingerprint: string;
}

export interface GetFormulariosParams {
	page?: number;
	limit?: number;
	search?: string;
	filterActivo?: 'all' | 'activo' | 'inactivo';
	sortBy?: 'fecha' | 'tematica' | 'respuestas';
	sortOrder?: 'asc' | 'desc';
}

export interface FormularioAsistenciaResponse {
	success: boolean;
	data: FormularioAsistencia[];
	meta: {
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	};
}

class AsistenciasAPI {
	private baseUrl = `${API_URL}/api/asistencias`;
	private publicUrl = `${API_URL}/api/public/asistencias`;

	private async getAuthHeaders() {
		const token = browser ? localStorage.getItem('transmeralda_token') : null;
		return {
			'Content-Type': 'application/json',
			...(token && { Authorization: `Bearer ${token}` })
		};
	}

	// ============================================
	// RUTAS PROTEGIDAS (Admin)
	// ============================================

	async crearFormulario(data: CreateFormularioInput): Promise<FormularioAsistencia> {
		const response = await fetch(`${this.baseUrl}/formularios`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al crear el formulario');
		}

		const result = await response.json();
		return result.data;
	}

	async obtenerFormularios(params: GetFormulariosParams = {}): Promise<FormularioAsistenciaResponse> {
		const {
			page = 1,
			limit = 10,
			search,
			filterActivo = 'all',
			sortBy = 'fecha',
			sortOrder = 'desc'
		} = params;

		const queryParams = new URLSearchParams({
			page: String(page),
			limit: String(limit),
			...(search && { search }),
			filterActivo,
			sortBy,
			sortOrder
		});

		const response = await fetch(`${this.baseUrl}/formularios?${queryParams}`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener los formularios');
		}

		return await response.json();
	}

	// Obtener solo los IDs de los formularios filtrados (para selección masiva)
	async obtenerTodosLosIds(params?: { filterActivo?: 'all' | 'activo' | 'inactivo'; search?: string }): Promise<string[]> {
		const queryParams = new URLSearchParams();
		if (params?.filterActivo) queryParams.set('filterActivo', params.filterActivo);
		if (params?.search) queryParams.set('search', params.search);

		const qs = queryParams.toString();
		const url = `${this.baseUrl}/formularios/ids${qs ? `?${qs}` : ''}`;

		const response = await fetch(url, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener los IDs');
		}

		const result = await response.json();
		return result.data || [];
	}

	async obtenerFormularioPorId(id: string): Promise<FormularioAsistencia> {
		const response = await fetch(`${this.baseUrl}/formularios/${id}`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener el formulario');
		}

		const result = await response.json();
		return result.data;
	}

	// Alias para mantener consistencia
	obtenerFormulario(id: string): Promise<FormularioAsistencia> {
		return this.obtenerFormularioPorId(id);
	}

	async actualizarFormulario(
		id: string,
		data: UpdateFormularioInput
	): Promise<FormularioAsistencia> {
		const response = await fetch(`${this.baseUrl}/formularios/${id}`, {
			method: 'PUT',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al actualizar el formulario');
		}

		const result = await response.json();
		return result.data;
	}

	async eliminarFormulario(id: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/formularios/${id}`, {
			method: 'DELETE',
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al eliminar el formulario');
		}
	}

	async obtenerRespuestas(formularioId: string): Promise<RespuestaAsistencia[]> {
		const response = await fetch(`${this.baseUrl}/formularios/${formularioId}/respuestas`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener las respuestas');
		}

		const result = await response.json();
		return result.data;
	}

	// ============================================
	// RUTAS PÚBLICAS (Sin auth)
	// ============================================

	async obtenerFormularioPorToken(token: string): Promise<FormularioAsistencia> {
		const response = await fetch(`${this.publicUrl}/${token}`, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Formulario no encontrado');
		}

		const result = await response.json();
		return result.data;
	}

	async verificarRespuesta(
		token: string,
		deviceFingerprint: string
	): Promise<{ yaRespondio: boolean; respuesta?: RespuestaAsistencia }> {
		const response = await fetch(
			`${this.publicUrl}/${token}/verificar?device_fingerprint=${encodeURIComponent(deviceFingerprint)}`,
			{
				headers: { 'Content-Type': 'application/json' }
			}
		);

		if (!response.ok) {
			throw new Error('Error al verificar la respuesta');
		}

		const result = await response.json();
		return result.data;
	}

	async enviarRespuesta(token: string, data: CreateRespuestaInput): Promise<RespuestaAsistencia> {
		const response = await fetch(`${this.publicUrl}/${token}/responder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al enviar la respuesta');
		}

		const result = await response.json();
		return result.data;
	}

	// Exportar respuestas a Excel
	async exportarRespuestas(formularioId: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/formularios/${formularioId}/exportar`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al exportar las respuestas');
		}

		return await response.blob();
	}

	// Exportar respuestas a PDF
	async exportarPDF(formularioId: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/formularios/${formularioId}/exportar-pdf`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al exportar el PDF');
		}

		return await response.blob();
	}

	// Exportar TODAS las asistencias a un ZIP
	async exportarTodasPDFs(params?: { filterActivo?: 'all' | 'activo' | 'inactivo'; search?: string; jobId?: string }): Promise<Blob> {
		const queryParams = new URLSearchParams();
		if (params?.filterActivo) queryParams.set('filterActivo', params.filterActivo);
		if (params?.search) queryParams.set('search', params.search);
		if (params?.jobId) queryParams.set('jobId', params.jobId);

		const qs = queryParams.toString();
		const url = `${this.baseUrl}/formularios/exportar-todas-pdf${qs ? `?${qs}` : ''}`;

		const response = await fetch(url, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: 'Error al exportar las asistencias' }));
			throw new Error(error.message || 'Error al exportar las asistencias');
		}

		return await response.blob();
	}

	// Exportar formularios SELECCIONADOS a un ZIP
	async exportarSeleccionadosPDFs(ids: string[], jobId?: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/formularios/exportar-seleccionados-pdf`, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({ ids, jobId })
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: 'Error al exportar los formularios seleccionados' }));
			throw new Error(error.message || 'Error al exportar los formularios seleccionados');
		}

		return await response.blob();
	}

	async eliminarRespuestas(ids: string[]): Promise<{ deleted: number }> {
		const response = await fetch(`${this.baseUrl}/respuestas`, {
			method: 'DELETE',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify({ ids })
		});
		const data = await response.json();
		if (!response.ok) throw new Error(data.message || 'Error al eliminar respuestas');
		return data;
	}

	// Helper para generar URL pública
	generarUrlPublica(token: string): string {
		const baseUrl = window.location.origin;
		return `${baseUrl}/asistencia/${token}`;
	}
}

export const asistenciasAPI = new AsistenciasAPI();
