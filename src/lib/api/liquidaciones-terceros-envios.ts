import { apiClient } from './apiClient';

/**
 * Envíos por correo de liquidaciones finales de terceros.
 *
 * El lote viaja con el HTML de cada hoja (el mismo que pinta el preview):
 * el backend lo pasa por Chromium para producir el PDF adjunto, igual que
 * hace el export ZIP. Los adjuntos extra van en base64 porque comparten
 * petición con ese JSON grande y son pocos MB.
 */

export type EnvioTipo = 'CIERRE' | 'INGRESO' | 'OCASIONAL';

export interface EnvioLoteItem {
	/** Cierre final de la hoja. Solo en lotes de tipo CIERRE. */
	cierre_id: string | null;
	/** Cabecera del periodo (ingresos u ocasional), si existe ya. */
	origen_id?: string | null;
	tercero_id: string | null;
	/** Placa del cierre, o la hoja (INGRESOS/ADICIONALES/OCASIONALES). */
	placa: string;
	tercero_nombre: string;
	/** Título del correo; sin él, el de cierres («Liquidación de su vehículo…»). */
	titulo?: string;
	to: string;
	/** Copias del correo (CC). El destinatario principal sigue siendo `to`. */
	cc?: string[];
	/** Nombre del PDF adjunto, sin extensión. */
	filename: string;
	html: string;
	/**
	 * Líneas extra de la tarjeta de resumen del correo, debajo de Hoja y
	 * Periodo. Viajan ya FORMATEADAS: la cifra que ve el destinatario tiene
	 * que ser exactamente la que cierra la hoja adjunta, y recalcularla en el
	 * servidor sería una segunda aritmética que acabaría discrepando.
	 */
	resumen?: Array<{ etiqueta: string; valor: string }>;
}

export interface EnvioLotePayload {
	/** De qué canvas sale el lote. Sin él, CIERRE (compatibilidad). */
	tipo?: EnvioTipo;
	anio: number;
	mes: number;
	css: string;
	/** Plantilla del asunto; admite {PLACA} {TERCERO} {PERIODO}. */
	asunto: string;
	mensaje: string;
	es_prueba: boolean;
	destino_prueba?: string;
	items: EnvioLoteItem[];
	adjuntos_extra: Array<{ filename: string; contentType: string; base64: string }>;
}

export interface EstadoEnvioCierre {
	cierre_id: string;
	ultimo_enviado: { email_destino: string; enviado_at: string } | null;
	ultimo_error: { email_destino: string; error: string | null; created_at: string } | null;
	enviados: number;
	pruebas: number;
	/**
	 * Último envío real correcto POR DESTINATARIO (correo en minúsculas).
	 *
	 * Una placa multi-propietario manda un correo a cada copropietario: con
	 * solo el agregado por cierre, enviarle a uno pintaba de «enviado» la fila
	 * de todos. Puede faltar si el backend es anterior a este campo.
	 */
	por_destinatario?: Record<string, { enviado_at: string }>;
}

/** Fila de constancia tal cual sale de `liquidacion_tercero_envio`. */
export interface EnvioHistorialFila {
	id: string;
	placa: string;
	email_destino: string;
	asunto: string;
	estado: string;
	error: string | null;
	es_prueba: boolean;
	adjuntos: Array<{ filename: string; size: number; tipo: string }>;
	enviado_por: string | null;
	enviado_at: string | null;
	created_at: string;
}

export const liquidacionesTercerosEnviosAPI = {
	/** Encola el lote. 409 = otro usuario está enviando ese periodo. */
	async encolarLote(
		payload: EnvioLotePayload
	): Promise<
		| { status: 'queued'; job_id: string; total: number }
		| { status: 'locked'; locked_by: any }
	> {
		try {
			const { data } = await apiClient.post('/api/liquidaciones-terceros/envios/lote', payload, {
				// El cuerpo puede llevar decenas de hojas; el coste está en la
				// subida, no en el servidor, que responde en cuanto encola.
				timeout: 300_000
			});
			return data;
		} catch (e: any) {
			if (e?.response?.status === 409 && e.response.data?.status === 'locked') {
				return e.response.data;
			}
			throw e;
		}
	},

	async estadoPeriodo(
		anio: number,
		mes: number
	): Promise<{ estados: Record<string, EstadoEnvioCierre>; proveedor: string | null }> {
		const { data } = await apiClient.get('/api/liquidaciones-terceros/envios/periodo', {
			params: { anio, mes }
		});
		return data;
	},

	/** Constancias de un periodo para ingresos/ocasional (lista completa). */
	async historialPeriodo(
		tipo: EnvioTipo,
		anio: number,
		mes: number
	): Promise<{ historial: EnvioHistorialFila[]; proveedor: string | null }> {
		const { data } = await apiClient.get('/api/liquidaciones-terceros/envios/historial', {
			params: { tipo, anio, mes }
		});
		return data;
	},

	async historialCierre(cierreId: string): Promise<any[]> {
		const { data } = await apiClient.get(`/api/liquidaciones-terceros/envios/cierre/${cierreId}`);
		return data;
	},

	async status(jobId: string): Promise<any> {
		const { data } = await apiClient.get(`/api/liquidaciones-terceros/envios/status/${jobId}`);
		return data;
	},

	async cancelar(jobId: string): Promise<void> {
		await apiClient.delete(`/api/liquidaciones-terceros/envios/job/${jobId}`);
	}
};
