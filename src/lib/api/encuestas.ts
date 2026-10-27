import { apiClient } from './apiClient';
import { API_BASE, fetchConSesion } from './fetchConSesion';

export type TipoPregunta =
	| 'TEXTO_CORTO' | 'TEXTO_LARGO' | 'OPCION_UNICA' | 'OPCION_MULTIPLE'
	| 'SI_NO' | 'ESCALA' | 'NPS' | 'NUMERO' | 'FECHA' | 'CORREO';
export type ModoIdentidad = 'NO' | 'OPCIONAL' | 'OBLIGATORIO';
export type PoliticaOrigen = 'PERMITIR' | 'MARCAR' | 'BLOQUEAR_HUELLA';

export interface PreguntaEncuesta {
	id: string;
	titulo: string;
	descripcion: string;
	tipo: TipoPregunta;
	requerida: boolean;
	opciones: Array<{ id: string; texto: string }>;
	minimo?: number;
	maximo?: number;
}
export interface EncuestaInput {
	titulo: string;
	descripcion: string | null;
	mensaje_final: string | null;
	nombre_modo: ModoIdentidad;
	correo_modo: ModoIdentidad;
	registrar_origen: boolean;
	politica_origen: PoliticaOrigen;
	fecha_cierre: string | null;
	preguntas: PreguntaEncuesta[];
}
export interface Encuesta extends EncuestaInput {
	id: string;
	token: string;
	estado: 'BORRADOR' | 'PUBLICADA' | 'CERRADA';
	created_at: string;
	publicado_at: string | null;
	_count?: { respuestas: number };
}
export interface EncuestaPublica extends Pick<EncuestaInput, 'titulo' | 'descripcion' | 'mensaje_final' | 'nombre_modo' | 'correo_modo' | 'registrar_origen' | 'preguntas'> {
	token: string;
	estado: Encuesta['estado'];
	abierta: boolean;
}
export interface AnalisisPregunta {
	id: string;
	titulo: string;
	tipo: TipoPregunta;
	respondidas: number;
	opciones: Array<{ id: string; texto: string; total: number; porcentaje: number }>;
	promedio: number | null;
	nps: number | null;
	textos: string[];
}
export interface ResultadoEncuesta {
	encuesta: Encuesta;
	total: number;
	coincidencias_ip: number;
	coincidencias_dispositivo: number;
	por_dia: Array<{ fecha: string; total: number }>;
	analisis: AnalisisPregunta[];
	respuestas: Array<{
		id: string;
		nombre: string | null;
		correo: string | null;
		respuestas: Record<string, string | string[] | number | boolean>;
		coincide_ip: boolean;
		coincide_dispositivo: boolean;
		created_at: string;
	}>;
	pagina: number;
	paginas: number;
}

function mensajeError(data: any, respaldo: string): string {
	return data?.message || data?.error || respaldo;
}

export const encuestasAPI = {
	async listar(): Promise<Encuesta[]> {
		const { data } = await apiClient.get('/api/encuestas');
		return data.encuestas;
	},
	async obtener(id: string): Promise<Encuesta> {
		const { data } = await apiClient.get(`/api/encuestas/${id}`);
		return data.encuesta;
	},
	async crear(input: EncuestaInput): Promise<Encuesta> {
		const { data } = await apiClient.post('/api/encuestas', input);
		return data.encuesta;
	},
	async actualizar(id: string, input: EncuestaInput): Promise<Encuesta> {
		const { data } = await apiClient.put(`/api/encuestas/${id}`, input);
		return data.encuesta;
	},
	async accion(id: string, accion: 'publicar' | 'cerrar' | 'duplicar'): Promise<Encuesta> {
		const { data } = await apiClient.post(`/api/encuestas/${id}/${accion}`);
		return data.encuesta;
	},
	async archivar(id: string): Promise<void> {
		await apiClient.delete(`/api/encuestas/${id}`);
	},
	async resultados(id: string, pagina = 1): Promise<ResultadoEncuesta> {
		const { data } = await apiClient.get(`/api/encuestas/${id}/resultados`, { params: { pagina } });
		return data;
	},
	async descargar(id: string, formato: 'xlsx' | 'pdf'): Promise<void> {
		const res = await fetchConSesion(`/api/encuestas/${id}/exportar.${formato}`);
		if (!res.ok) throw new Error(mensajeError(await res.json().catch(() => null), 'No se pudo descargar el reporte'));
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const enlace = document.createElement('a');
		enlace.href = url;
		enlace.download = `encuesta-${id}.${formato}`;
		enlace.click();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	},
	enlace(token: string): string {
		return `${typeof window === 'undefined' ? '' : window.location.origin}/public/encuestas/${token}`;
	},
	async publica(token: string): Promise<EncuestaPublica> {
		const res = await fetch(`${API_BASE}/api/public/encuestas/${encodeURIComponent(token)}`);
		const data = await res.json();
		if (!res.ok) throw new Error(mensajeError(data, 'No se pudo abrir la encuesta'));
		return data.encuesta;
	},
	async responder(
		token: string,
		payload: { nombre?: string; correo?: string; dispositivo?: string; respuestas: Record<string, unknown> }
	): Promise<{ id: string; mensaje: string }> {
		const res = await fetch(`${API_BASE}/api/public/encuestas/${encodeURIComponent(token)}/respuestas`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(mensajeError(data, 'No se pudo guardar tu respuesta'));
		return data;
	}
};
