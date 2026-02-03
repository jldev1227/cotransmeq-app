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
	firma: string; // Base64
	device_fingerprint: string;
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

	async obtenerFormularios(): Promise<FormularioAsistencia[]> {
		const response = await fetch(`${this.baseUrl}/formularios`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener los formularios');
		}

		const result = await response.json();
		return result.data;
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

	// Helper para generar URL pública
	generarUrlPublica(token: string): string {
		const baseUrl = window.location.origin;
		return `${baseUrl}/asistencia/${token}`;
	}
}

export const asistenciasAPI = new AsistenciasAPI();
