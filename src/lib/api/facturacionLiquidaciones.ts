import { apiClient } from './apiClient';

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
	estado: 'FACTURADA' | 'LIQUIDADA';
	factura_id: string | null;
	numero_factura: string | null;
}

// ═══ API ═══

export const facturacionLiquidacionesAPI = {
	async crear(data: {
		numero_factura: string;
		liquidacion_ids: string[];
		observaciones?: string;
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

	async anular(id: string, motivo: string): Promise<FacturaLiquidacion> {
		const res = await apiClient.patch<FacturaLiquidacion>(
			`/api/facturacion-liquidaciones/${id}/anular`,
			{ motivo }
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
	 * Quita una liquidación de su factura y la devuelve a LIQUIDADA.
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

	async eliminar(id: string): Promise<{ message: string }> {
		const res = await apiClient.delete<{ message: string }>(
			`/api/facturacion-liquidaciones/${id}`
		);
		return res.data;
	}
};
