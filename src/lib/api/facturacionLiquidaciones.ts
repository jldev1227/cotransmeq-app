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
	}
};
