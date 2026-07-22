import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
	baseURL: API_URL,
	headers: { 'Content-Type': 'application/json' }
});

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

export async function getEvaluaciones(params: GetEvaluacionesParams = {}): Promise<EvaluacionesResponse> {
	const { page = 1, limit = 10, search, sortBy = 'created_at', sortOrder = 'desc' } = params;
	
	const response = await api.get('/api/evaluaciones', {
		params: { page, limit, search, sortBy, sortOrder }
	});
	
	return response.data;
}

export async function getEvaluacionById(id: string): Promise<{ success: boolean; data: Evaluacion }> {
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

export async function updateEvaluacion(id: string, data: {
	titulo: string;
	descripcion?: string | null;
	requiere_firma?: boolean;
	preguntas: any[];
}): Promise<{ success: boolean; data: Evaluacion }> {
	const response = await api.put(`/api/evaluaciones/${id}`, data);
	return response.data;
}

export async function deleteEvaluacion(id: string): Promise<{ success: boolean }> {
	const response = await api.delete(`/api/evaluaciones/${id}`);
	return response.data;
}
