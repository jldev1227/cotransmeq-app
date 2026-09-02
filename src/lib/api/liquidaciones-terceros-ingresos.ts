import { apiClient } from './apiClient';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Item de tercero que dejó ingreso a Cotransmeq, con su cliente y
 * periodo ya resueltos. Mismo shape que el backend (`IngresoTerceroRow`).
 *
 * El `id` es el UUID real de la fila en `liquidacion_tercero`. La vista es
 * de solo lectura, así que no hay `version` ni concurrencia optimista.
 */
export interface IngresoTerceroRow {
	id: string;
	liquidacion_id: string;
	consecutivo: string | null;
	cliente_id: string;
	/// Columna EMPRESA del canvas.
	cliente_nombre: string;
	cliente_nit: string | null;
	mes: number;
	anio: number;
	tercero_id: string | null;
	tercero_nombre: string | null;
	placa: string;
	recorrido: string;
	fechas: string;
	numero_planilla: string | null;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	total_facturado: number;
	valor_liquidar: number;
	/// `ingreso_extra_global - ingresos_extra_aval`.
	ingreso_empresa: number;
	ingreso_extra_global: number;
	ingresos_extra_aval: number;
	orden: number;
	/**
	 * De dónde sale la fila.
	 *
	 * `SERVICIO` es un item facturado que dejó ingreso a la empresa.
	 * `ADICIONAL` es un adicional de un cierre final: dinero que la empresa
	 * PAGA al tercero, y por eso llega con `ingreso_empresa` NEGATIVO.
	 *
	 * Opcional para que una respuesta de un backend viejo —o un mes en caché—
	 * no rompa el tipo; `esAdicional()` lo trata como `SERVICIO`.
	 */
	origen?: 'SERVICIO' | 'ADICIONAL';
	/// Solo en `ADICIONAL`: consecutivo del cierre del que viene.
	cierre_consecutivo?: string | null;
}

/**
 * Lo que el equipo decide ENCIMA de un ingreso concreto.
 *
 * Solo existe para los ingresos que alguien ha tocado. Un ingreso sin fila se
 * pinta con los porcentajes por defecto de la cabecera, así que `null` en un
 * porcentaje NO es cero: es «hereda el de arriba».
 */
export interface FilaIngresoEstado {
	id?: string;
	/// Item de `liquidacion_tercero` al que se refiere. Es la identidad.
	liquidacion_tercero_id: string;
	/// Columna INCLUIR: `true` ⇒ la fila baja a la hoja de ADICIONALES.
	incluir_adicional: boolean;
	cantidad: number;
	pct_admon_ingresos?: number | null;
	pct_ganancia?: number | null;
	pct_admon_adicional?: number | null;
	/// V/UNIDAD escrito a mano en la hoja de ADICIONALES; manda sobre el %.
	valor_unitario_adicional?: number | null;
	orden?: number;
}

export type HojaIngreso = 'INGRESOS' | 'ADICIONALES';

export interface ConceptoIngreso {
	id?: string;
	/// De qué pie es el concepto. Las dos hojas tienen el mismo bloque.
	hoja: HojaIngreso;
	/// Sin `PRESTAMO`: este documento no liquida préstamos ni horas extras.
	/// El Excel de referencia abre un bloque para ellos y las hojas lo
	/// replicaban con cuatro filas vacías por hoja que siempre sumaban cero.
	tipo: 'COSTO_LABORAL' | 'GASTO_OPERATIVO' | 'ANTICIPO' | 'IMPUESTO';
	concepto: string;
	/// Persona del bloque «PERSONAL PARA LA EJECUCIÓN»; `null` fuera de él.
	persona?: string | null;
	dias?: number | null;
	valor_unitario?: number;
	porcentaje?: number | null;
	valor_total?: number;
	base_calculo?: number | null;
	observaciones?: string | null;
	orden?: number;
}

export interface CabeceraIngreso {
	id: string;
	mes: number;
	anio: number;
	observaciones: string | null;
	pct_admon_ingresos: number;
	pct_ganancia_adicionales: number;
	pct_admon_adicionales: number;
	total_facturado_ingresos: number;
	total_admon_ingresos: number;
	total_liquidar_ingresos: number;
	total_facturado_adicionales: number;
	total_admon_adicionales: number;
	total_liquidar_adicionales: number;
	/// TRANSPORTE POR PAGAR de adicionales: lo que la hoja de ingresos resta.
	total_pagar_adicionales: number;
	total_ingreso_transmeralda: number;
	version: number;
	updated_at: string;
}

export interface EstadoIngresoMes {
	cabecera: CabeceraIngreso | null;
	filas: FilaIngresoEstado[];
	conceptos: ConceptoIngreso[];
}

function estadoVacio(): EstadoIngresoMes {
	return { cabecera: null, filas: [], conceptos: [] };
}

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

export const liquidacionesTercerosIngresosAPI = {
	/// GET /api/liquidaciones-terceros-ingresos/anual?anio=
	/// Los 12 meses en UNA sola petición, con las filas derivadas (`meses`) y
	/// la capa editable (`estados`). El backend devuelve siempre las 12 claves.
	async obtenerAnual(anio: number): Promise<{
		filasPorMes: Record<number, IngresoTerceroRow[]>;
		estadoPorMes: Record<number, EstadoIngresoMes>;
	}> {
		const response = await apiClient.get('/api/liquidaciones-terceros-ingresos/anual', {
			params: { anio }
		});
		const meses = response.data?.meses ?? {};
		const estados = response.data?.estados ?? {};
		// Normalizamos por si el backend omitiera alguna clave: el canvas
		// asume que los 12 meses existen.
		const filasPorMes: Record<number, IngresoTerceroRow[]> = {};
		const estadoPorMes: Record<number, EstadoIngresoMes> = {};
		for (let m = 1; m <= 12; m++) {
			filasPorMes[m] = Array.isArray(meses[m]) ? meses[m] : [];
			const e = estados[m];
			estadoPorMes[m] = e
				? {
						cabecera: e.cabecera ?? null,
						filas: Array.isArray(e.filas) ? e.filas : [],
						conceptos: Array.isArray(e.conceptos) ? e.conceptos : []
					}
				: estadoVacio();
		}
		return { filasPorMes, estadoPorMes };
	},

	/// GET /api/liquidaciones-terceros-ingresos/estado?mes=&anio=
	/// Solo la capa editable de un mes: lo que se relee tras guardar.
	async obtenerEstado(mes: number, anio: number): Promise<EstadoIngresoMes> {
		const { data } = await apiClient.get(
			'/api/liquidaciones-terceros-ingresos/estado',
			{ params: { mes, anio } }
		);
		return {
			cabecera: data?.cabecera ?? null,
			filas: Array.isArray(data?.filas) ? data.filas : [],
			conceptos: Array.isArray(data?.conceptos) ? data.conceptos : []
		};
	},

	/// POST /api/liquidaciones-terceros-ingresos/guardar
	/// Idempotente: crea la cabecera del mes en el primer guardado, así que no
	/// hay paso previo de «generar borrador».
	async guardar(params: {
		mes: number;
		anio: number;
		observaciones?: string | null;
		pct_admon_ingresos?: number;
		pct_ganancia_adicionales?: number;
		pct_admon_adicionales?: number;
		filas: FilaIngresoEstado[];
		conceptos: ConceptoIngreso[];
	}): Promise<{
		ok: boolean;
		id: string;
		accion: 'created' | 'updated';
		totales: Record<string, number>;
	}> {
		const { data } = await apiClient.post(
			'/api/liquidaciones-terceros-ingresos/guardar',
			params
		);
		return data;
	},

	/// GET /api/liquidaciones-terceros-ingresos?mes=&anio=
	/// Un solo mes, para el botón "Recargar mes".
	async obtenerPorPeriodo(mes: number, anio: number): Promise<IngresoTerceroRow[]> {
		const response = await apiClient.get('/api/liquidaciones-terceros-ingresos', {
			params: { mes, anio }
		});
		const data = response.data;
		return Array.isArray(data?.items) ? (data.items as IngresoTerceroRow[]) : [];
	}
};
