import { apiClient } from './apiClient';
import type { EstadoLiquidacionServicio } from './liquidaciones-servicios';

// ═══ Tipos ═══

export interface FacturaLiquidacionItem {
	id: string;
	factura_id: string;
	liquidacion_id: string;
	valor_liquidacion: number;
	liquidacion: {
		id: string;
		consecutivo: string;
		total: number;
		mes?: number;
		anio?: number;
		cliente?: { id: string; nombre: string; nit: string };
	} | null;
}

export interface FacturaLiquidacion {
	id: string;
	numero_factura: string;
	fecha_facturacion: string;
	observaciones: string | null;
	valor_total: number;
	estado: 'ACTIVA' | 'ANULADA';
	facturado_por: { id: string; nombre: string; correo: string } | null;
	anulado_por: { id: string; nombre: string; correo: string } | null;
	motivo_anulacion: string | null;
	fecha_anulacion: string | null;
	total_liquidaciones?: number;
	items: FacturaLiquidacionItem[];
	created_at: string;
	updated_at: string;
	/// Condiciones de cobro (cartera). Opcionales: un backend anterior no las manda.
	cliente_id?: string | null;
	fecha_emision?: string | null;
	plazo_dias?: number;
	fecha_vencimiento?: string | null;
	ajuste_valor?: number;
	/** Saldo y estado de cobro. `null` en una factura anulada (no se cobra). */
	cartera?: {
		saldo: number;
		aplicado: number;
		estado: 'pendiente' | 'abonada' | 'pagada' | 'vencida';
		dias_vencida: number;
		abonos: number;
	} | null;
}

export interface FacturaInfoMap {
	[liquidacionId: string]: {
		factura_id: string;
		numero_factura: string;
	};
}

/**
 * Liquidación que cambió de estado al asociarla o desasociarla de una factura.
 * Es lo mínimo para repintar su fila: el resto de la liquidación no cambia.
 */
export interface LiquidacionAfectada {
	id: string;
	consecutivo: string;
	estado: EstadoLiquidacionServicio;
  estado_anterior?: EstadoLiquidacionServicio;
	factura_id: string | null;
	numero_factura: string | null;
}

export type TipoAnulacionFactura = 'SIN_MODIFICAR' | 'MODIFICAR_LIQUIDACIONES' | 'DUPLICIDAD';

// ═══ API ═══

/**
 * Agregados de la lista de facturas sobre TODOS los registros del filtro,
 * calculados por el servidor con el mismo `where` de la consulta paginada.
 * Las stat cards del tab de Facturas los usan en vez de reducir la página.
 */
export interface FacturasMetadata {
	globalCount: number;
	globalTotal: number;
	globalLiquidaciones: number;
	estadoCounts: Record<string, number>;
	estadoTotales: Record<string, number>;
}

export const facturacionLiquidacionesAPI = {
	async crear(data: {
		numero_factura: string;
		liquidacion_ids: string[];
		observaciones?: string;
		/// Sin ellos: valor = suma de las liquidaciones, emisión hoy, 30 días.
		valor_total?: number | null;
		fecha_emision?: string | null;
		plazo_dias?: number | null;
	}): Promise<FacturaLiquidacion> {
		const res = await apiClient.post<FacturaLiquidacion>(
			'/api/facturacion-liquidaciones',
			data
		);
		return res.data;
	},

	async listar(filtros?: {
		page?: number;
		limit?: number;
		busqueda?: string;
		estado?: string;
	}): Promise<{
		facturas: FacturaLiquidacion[];
		total: number;
		totalPages: number;
		page: number;
		/** Opcional: un backend anterior al cambio no lo manda. */
		metadata?: FacturasMetadata;
	}> {
		const res = await apiClient.get('/api/facturacion-liquidaciones', { params: filtros });
		return res.data;
	},

	async obtenerPorId(id: string): Promise<FacturaLiquidacion> {
		const res = await apiClient.get<FacturaLiquidacion>(
			`/api/facturacion-liquidaciones/${id}`
		);
		return res.data;
	},

	/**
	 * El tipo define qué liquidaciones vuelven a LIQUIDADA al anular.
	 */
	async anular(
		id: string,
		motivo: string,
		opciones: {
			tipo?: TipoAnulacionFactura;
			liquidaciones_a_liquidar?: string[];
			liquidacion_duplicada_id?: string;
		} = {}
	): Promise<FacturaLiquidacion & { estados_resultantes: Record<string, string> }> {
		const res = await apiClient.patch<FacturaLiquidacion & { estados_resultantes: Record<string, string> }>(
			`/api/facturacion-liquidaciones/${id}/anular`,
			{ motivo, tipo: 'SIN_MODIFICAR', ...opciones }
		);
		return res.data;
	},

	async batchFacturaInfo(ids: string[]): Promise<FacturaInfoMap> {
		const res = await apiClient.post<FacturaInfoMap>(
			'/api/facturacion-liquidaciones/batch-info',
			{ ids }
		);
		return res.data;
	},

	/**
	 * Asocia liquidaciones a una factura que ya existe.
	 *
	 * Devuelve la factura con su `valor_total` ya recalculado por el servidor,
	 * más la lista de liquidaciones movidas, para que el canvas repinte esas
	 * filas sin volver a pedir el listado entero.
	 */
	async agregarLiquidaciones(
		facturaId: string,
		liquidacion_ids: string[]
	): Promise<{
		factura: FacturaLiquidacion;
		liquidaciones_afectadas: LiquidacionAfectada[];
	}> {
		const res = await apiClient.post(
			`/api/facturacion-liquidaciones/${facturaId}/items`,
			{ liquidacion_ids }
		);
		return res.data;
	},

	/**
	 * Quita una liquidación de su factura y la devuelve a APROBADA.
	 *
	 * `quedo_vacia` avisa de que la factura se quedó sin liquidaciones: no se
	 * borra sola, eso lo decide el usuario con anular + eliminar.
	 */
	async quitarLiquidacion(
		facturaId: string,
		liquidacionId: string
	): Promise<{
		factura: FacturaLiquidacion;
		quedo_vacia: boolean;
		liquidaciones_afectadas: LiquidacionAfectada[];
	}> {
		const res = await apiClient.delete(
			`/api/facturacion-liquidaciones/${facturaId}/items/${liquidacionId}`
		);
		return res.data;
	},

	/**
	 * Corrige valor, emisión, plazo o vencimiento. Misma operación que la de
	 * cartera, por la puerta de facturación.
	 */
	async actualizarCondiciones(
		id: string,
		c: {
			valor_total?: number | null;
			fecha_emision?: string | null;
			plazo_dias?: number | null;
			fecha_vencimiento?: string | null;
		}
	): Promise<FacturaLiquidacion> {
		const res = await apiClient.patch<FacturaLiquidacion>(
			`/api/facturacion-liquidaciones/${id}/condiciones`,
			c
		);
		return res.data;
	},

	/**
	 * Edita la cabecera y condiciones de cobro, y agrega liquidaciones nuevas
	 * en la misma transacción del servidor.
	 */
	async editar(
		id: string,
		data: {
			numero_factura: string;
			observaciones: string | null;
			fecha_emision: string;
			plazo_dias: number;
			liquidacion_ids: string[];
			quitar_liquidacion_ids: string[];
		}
	): Promise<{ factura: FacturaLiquidacion; liquidaciones_afectadas: LiquidacionAfectada[] }> {
		const res = await apiClient.patch(
			`/api/facturacion-liquidaciones/${id}/editar`,
			data
		);
		return res.data;
	},

	async eliminar(id: string): Promise<{ message: string }> {
		const res = await apiClient.delete<{ message: string }>(
			`/api/facturacion-liquidaciones/${id}`
		);
		return res.data;
	}
};
