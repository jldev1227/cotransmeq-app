import { apiClient } from './apiClient';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/// Fila plana de un adicional enriquecida con metadata del cierre al que
/// pertenece. Mismo shape que el backend (`AdicionalListado`). El `id`
/// es sintético (`${cierre_id}::${idx}`) y se usa como clave estable
/// en el cell-binding registry del canvas Univer.
export interface AdicionalListado {
	/// UUID REAL de la fila en `liquidacion_tercero_final_adicional`.
	/// Antes era un id sintético `${cierre_id}::${idx}` porque los
	/// adicionales vivían en un array JSONB sin PK; eso hacía que insertar o
	/// borrar una fila desplazara la identidad de todas las siguientes.
	id: string;
	cierre_id: string;
	cierre_consecutivo: string | null;
	placa: string;
	tercero_id: string | null;
	tercero_nombre: string | null;
	estado: string;
	cliente: string;
	recorrido: string;
	fechas: string;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	valor_liquidar: number;
	aplica_impuestos: boolean;
	/// Posición de presentación dentro del cierre. NO es identidad.
	orden: number;
	/// Concurrencia optimista: vuelve al servidor en cada PATCH.
	version: number;
}

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

export const liquidacionesTercerosAdicionalesAPI = {
	/// GET /api/liquidaciones-terceros-adicionales?mes=&anio=
	/// Devuelve TODOS los adicionales (no vacíos) de los cierres finales
	/// del periodo indicado.
	async obtenerPorPeriodo(mes: number, anio: number): Promise<AdicionalListado[]> {
		const response = await apiClient.get('/api/liquidaciones-terceros-adicionales', {
			params: { mes, anio }
		});
		const data = response.data;
		return Array.isArray(data?.items) ? (data.items as AdicionalListado[]) : [];
	},

	/// GET /api/liquidaciones-terceros-adicionales/anual?anio=
	/// Los 12 meses en UNA sola petición. El backend devuelve siempre las 12
	/// claves, aunque el mes esté vacío.
	async obtenerAnual(anio: number): Promise<Record<number, AdicionalListado[]>> {
		const response = await apiClient.get(
			'/api/liquidaciones-terceros-adicionales/anual',
			{ params: { anio } }
		);
		const meses = response.data?.meses ?? {};
		// Normalizamos por si el backend omitiera alguna clave: el canvas
		// asume que los 12 meses existen.
		const out: Record<number, AdicionalListado[]> = {};
		for (let m = 1; m <= 12; m++) {
			out[m] = Array.isArray(meses[m]) ? meses[m] : [];
		}
		return out;
	},

	/// POST /api/liquidaciones-terceros-adicionales — crea una fila.
	async crear(params: {
		cierre_id: string;
		[k: string]: any;
	}): Promise<AdicionalListado> {
		const response = await apiClient.post('/api/liquidaciones-terceros-adicionales', params);
		return response.data;
	},

	/// PATCH /api/liquidaciones-terceros-adicionales/:id
	///
	/// Actualiza UN campo con concurrencia optimista. Si otro usuario escribió
	/// antes, responde 409 con `server_row` (el valor actual del servidor)
	/// para que el cliente pueda repintar la celda en vez de perder el dato.
	async actualizarCampo(params: {
		id: string;
		field: string;
		value: string | number | boolean | null;
		base_version: number;
	}): Promise<AdicionalListado> {
		const { id, ...body } = params;
		const response = await apiClient.patch(
			`/api/liquidaciones-terceros-adicionales/${id}`,
			body
		);
		return response.data;
	},

	/// DELETE /api/liquidaciones-terceros-adicionales/:id (soft)
	async eliminar(id: string): Promise<{ ok: boolean }> {
		const response = await apiClient.delete(`/api/liquidaciones-terceros-adicionales/${id}`);
		return response.data;
	},

	/// PUT /api/liquidaciones-terceros-adicionales
	/// Persiste un batch de adicionales de UN periodo. El backend los agrupa
	/// por `cierre_id`, sanitiza cada fila y recalcula `valor_liquidar` +
	/// `total_pagar` del cierre afectado.
	async guardar(params: {
		mes: number;
		anio: number;
		items: AdicionalListado[];
	}): Promise<{ ok: boolean; actualizados: number; cierres: number }> {
		const response = await apiClient.put('/api/liquidaciones-terceros-adicionales', params);
		return response.data;
	}
};