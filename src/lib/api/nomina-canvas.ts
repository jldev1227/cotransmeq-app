import { apiClient } from './apiClient';
import type { PeriodoNominaDTO } from '$lib/editor/builders/nomina.builder';
import type { EstadoNomina } from '$lib/editor/builders/nomina-estado';

export type { PeriodoNominaDTO };

export interface ResumenPeriodo {
	anio: number;
	mes: number;
	corte: number;
	etiqueta: string;
	dias: number;
	conductores: number;
	conPlanilla: number;
	conLiquidacion: number;
	avisos: string[];
}

export interface ResumenSnapshot {
	id: string;
	version: number;
	origen: string;
	rama: string;
	created_at: string;
	usuario: { id: string; nombre: string | null } | null;
	revertido_de_id: string | null;
	hojas: number;
	conductores_con_planilla: number;
}

export interface CambioEstado {
	id: string;
	conductor_id: string | null;
	estado: EstadoNomina;
	estado_anterior: string;
	version: number;
	motivo: string | null;
}

export interface ResultadoRevertir {
	restauradas: number;
	omitidas: { conductorId: string; nombre: string; estado: string }[];
	nuevoSnapshot: { id: string; version: number } | null;
}

export const nominaCanvasAPI = {
	/** El libro entero del periodo. `corte` es el día de inicio (21 por defecto). */
	async periodo(anio: number, mes: number, corte?: number): Promise<PeriodoNominaDTO> {
		const { data } = await apiClient.get('/api/nomina/canvas', {
			params: { anio, mes, ...(corte != null ? { desde: corte } : {}) }
		});
		return data as PeriodoNominaDTO;
	},

	async resumen(anio: number, mes: number, corte?: number): Promise<ResumenPeriodo> {
		const { data } = await apiClient.get('/api/nomina/canvas/resumen', {
			params: { anio, mes, ...(corte != null ? { desde: corte } : {}) }
		});
		return data as ResumenPeriodo;
	},

	// ── Estado ─────────────────────────────────────────────────────────

	async cambiarEstado(params: {
		liquidacionId: string;
		estado: string;
		motivo?: string | null;
		baseVersion?: number | null;
	}): Promise<CambioEstado> {
		const { data } = await apiClient.patch(
			`/api/nomina/liquidaciones/${params.liquidacionId}/estado`,
			{
				estado: params.estado,
				motivo: params.motivo ?? null,
				base_version: params.baseVersion ?? null
			}
		);
		return data as CambioEstado;
	},

	async cambiarEstadoLote(params: { ids: string[]; estado: string; motivo?: string | null }) {
		const { data } = await apiClient.post('/api/nomina/estado-lote', {
			ids: params.ids,
			estado: params.estado,
			motivo: params.motivo ?? null
		});
		return data as {
			total: number;
			cambiados: CambioEstado[];
			fallidos: { id: string; error: string; code?: string }[];
		};
	},

	async historialEstados(liquidacionId: string) {
		const { data } = await apiClient.get(
			`/api/nomina/liquidaciones/${liquidacionId}/historial-estados`
		);
		return data as {
			id: string;
			estado_anterior: string | null;
			estado_nuevo: string;
			motivo: string | null;
			created_at: string;
			usuario: { id: string; nombre: string | null } | null;
		}[];
	},

	// ── Versiones ──────────────────────────────────────────────────────

	async listarSnapshots(anio: number, mes: number): Promise<ResumenSnapshot[]> {
		const { data } = await apiClient.get('/api/nomina/snapshots', { params: { anio, mes } });
		return (data ?? []) as ResumenSnapshot[];
	},

	/** Devuelve `{ sinCambios: true }` cuando el contenido es idéntico al último. */
	async capturarSnapshot(anio: number, mes: number, corte?: number) {
		const { data } = await apiClient.post('/api/nomina/snapshots', { anio, mes, corte });
		return data as { id: string; version: number } | { sinCambios: true };
	},

	async diffSnapshot(id: string, vs?: string) {
		const { data } = await apiClient.get(`/api/nomina/snapshots/${id}/diff`, {
			params: vs ? { vs } : {}
		});
		return data;
	},

	async revertirSnapshot(id: string): Promise<ResultadoRevertir> {
		const { data } = await apiClient.post(`/api/nomina/snapshots/${id}/revertir`);
		return data as ResultadoRevertir;
	}
};

// ── Envío de desprendibles ───────────────────────────────────────────

export interface ResultadoEnvioItem {
	liquidacion_id: string;
	conductor: string;
	email: string;
	estado: 'ENVIADO' | 'ERROR' | 'OMITIDO';
	error?: string;
}

export interface EstadoLote {
	job_id: string;
	status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
	total: number;
	hechos: number;
	progress: number;
	currentStep: string;
	resultados: ResultadoEnvioItem[];
	error: string | null;
}

export const nominaEnviosAPI = {
	/**
	 * Encola el lote. Devuelve enseguida con el `job_id`: el progreso llega
	 * por socket, y `status()` sirve de respaldo si el socket se cae.
	 */
	async encolar(params: {
		anio: number;
		mes: number;
		items: { liquidacion_id: string; cc?: string[] }[];
		asunto: string;
		mensaje?: string | null;
		esPrueba?: boolean;
		destinoPrueba?: string | null;
	}): Promise<{ job_id: string; total: number }> {
		const { data } = await apiClient.post('/api/nomina/envios/lote', {
			anio: params.anio,
			mes: params.mes,
			items: params.items,
			asunto: params.asunto,
			mensaje: params.mensaje ?? null,
			es_prueba: params.esPrueba === true,
			destino_prueba: params.destinoPrueba ?? null
		});
		return data;
	},

	async estado(jobId: string): Promise<EstadoLote> {
		const { data } = await apiClient.get(`/api/nomina/envios/status/${jobId}`);
		return data as EstadoLote;
	},

	async cancelar(jobId: string): Promise<{ cancelado: boolean }> {
		const { data } = await apiClient.delete(`/api/nomina/envios/job/${jobId}`);
		return data;
	},

	/** Quién ya recibió su desprendible en el periodo, y quién falló. */
	async estadoPeriodo(anio: number, mes: number) {
		const { data } = await apiClient.get('/api/nomina/envios/periodo', {
			params: { anio, mes }
		});
		return data as Record<
			string,
			{
				liquidacion_id: string;
				ultimo_enviado: { email_destino: string; enviado_at: string } | null;
				ultimo_error: { email_destino: string; error: string | null; created_at: string } | null;
				enviados: number;
				pruebas: number;
			}
		>;
	}
};

// ═══════════════════════════════════════════════════════════════
// GENERACIÓN DE BORRADORES EN LOTE
// ═══════════════════════════════════════════════════════════════

export interface ConductorPrevio {
	conductor_id: string;
	nombre: string;
	cedula: string | null;
	dias: number;
	placas: string[];
	/** `null` = no hay nada guardado: generar aquí crea, no reemplaza. */
	liquidacion_id: string | null;
	estado: string | null;
	sueldo_estimado: number;
	avisos: string[];
}

export interface PrevioBorradores {
	anio: number;
	mes: number;
	etiqueta: string;
	desde: string | null;
	hasta: string | null;
	conductores: ConductorPrevio[];
}

export interface BorradorNominaItem {
	conductorId: string;
	nombre: string;
	estado: 'creado' | 'reemplazado' | 'omitido' | 'error';
	motivo?: string;
	liquidacionId?: string;
	sueldoTotal?: number;
}

export interface BorradorNominaJob {
	jobId: string;
	status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'locked';
	progress: number;
	currentStep: string;
	processed: number;
	total: number;
	items: BorradorNominaItem[];
	error?: string;
}

export const nominaBorradoresAPI = {
	/** Lo que hay que ver antes de lanzar: quién ya tiene y quién no tiene días. */
	async previo(anio: number, mes: number, corte?: number): Promise<PrevioBorradores> {
		const { data } = await apiClient.get('/api/nomina/borradores/previo', {
			params: { anio, mes, ...(corte != null ? { corte } : {}) }
		});
		return data;
	},

	async generar(payload: {
		anio: number;
		mes: number;
		corte?: number | null;
		conductor_ids: string[];
		sobrescribir?: string[];
	}): Promise<{ job_id: string; status: string; total: number }> {
		const { data } = await apiClient.post('/api/nomina/borradores/generar', payload);
		return data;
	},

	async estado(jobId: string): Promise<BorradorNominaJob> {
		const { data } = await apiClient.get(`/api/nomina/borradores/status/${jobId}`);
		return data;
	},

	async cancelar(jobId: string): Promise<{ cancelado: boolean; nota?: string }> {
		const { data } = await apiClient.delete(`/api/nomina/borradores/job/${jobId}`);
		return data;
	}
};
