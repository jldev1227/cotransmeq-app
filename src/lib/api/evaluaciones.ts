// Rutas de administración: exigen sesión. `apiClient` agrega el token y
// maneja el 401 igual que el resto del dashboard.
import { browser } from '$app/environment';
import { apiClient as api } from './apiClient';

/**
 * Cabecera de sesión para las páginas del dashboard que llaman a estas rutas
 * con `fetch` (descargas de PDF/ZIP, carga y edición). Mismo token que usa
 * `apiClient`.
 */
export function authHeaders(): Record<string, string> {
	const token = browser ? localStorage.getItem('transmeralda_token') : null;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Evaluacion {
	id: string;
	titulo: string;
	descripcion: string | null;
	requiere_firma: boolean;
	created_at: string;
	updated_at: string;
	preguntas: Pregunta[];
}

export interface Pregunta {
	id: string;
	texto: string;
	tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';
	puntaje: number;
	opciones: Opcion[];
}

export interface Opcion {
	id: string;
	texto: string;
	esCorrecta: boolean;
}

export interface EvaluacionesResponse {
	success: boolean;
	data: Evaluacion[];
	meta: {
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	};
}

export interface GetEvaluacionesParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: 'titulo' | 'created_at';
	sortOrder?: 'asc' | 'desc';
}

export async function getEvaluaciones(
	params: GetEvaluacionesParams = {}
): Promise<EvaluacionesResponse> {
	const { page = 1, limit = 10, search, sortBy = 'created_at', sortOrder = 'desc' } = params;

	const response = await api.get('/api/evaluaciones', {
		params: { page, limit, search, sortBy, sortOrder }
	});

	return response.data;
}

export async function getEvaluacionById(
	id: string
): Promise<{ success: boolean; data: Evaluacion }> {
	const response = await api.get(`/api/evaluaciones/${id}`);
	return response.data;
}

export async function createEvaluacion(data: {
	titulo: string;
	descripcion?: string | null;
	requiere_firma?: boolean;
	preguntas: any[];
}): Promise<{ success: boolean; data: Evaluacion }> {
	const response = await api.post('/api/evaluaciones', data);
	return response.data;
}

export async function updateEvaluacion(
	id: string,
	data: {
		titulo: string;
		descripcion?: string | null;
		requiere_firma?: boolean;
		preguntas: any[];
	}
): Promise<{ success: boolean; data: Evaluacion }> {
	const response = await api.put(`/api/evaluaciones/${id}`, data);
	return response.data;
}

/** Respuesta a una pregunta tal como la recibe el backend (misma forma que al responder). */
export interface RespuestaEnvio {
	preguntaId: string;
	valor_texto?: string;
	valor_numero?: number;
	opcionesIds?: string[];
	relacion?: { izq: string; der: string }[];
}

/**
 * Un administrador corrige las respuestas de un resultado; el backend las
 * reemplaza y recalifica con la clave actual. Exige acceso total a evaluaciones.
 */
export async function actualizarRespuestasResultado<T = any>(
	evaluacionId: string,
	resultadoId: string,
	respuestas: RespuestaEnvio[]
): Promise<{ success: boolean; data: T }> {
	const response = await api.put(`/api/evaluaciones/${evaluacionId}/resultados/${resultadoId}`, {
		respuestas
	});
	return response.data;
}

export async function deleteEvaluacion(id: string): Promise<{ success: boolean }> {
	const response = await api.delete(`/api/evaluaciones/${id}`);
	return response.data;
}
