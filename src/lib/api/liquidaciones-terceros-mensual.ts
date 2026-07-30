import { apiClient } from './apiClient';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AdicionalMensual {
	id: string;
	cliente?: string;
	placa: string;
	tercero_id?: string | null;
	tercero_nombre?: string | null;
	vehiculo_id?: string | null;
	recorrido?: string | null;
	fechas?: string | null;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	valor_liquidar: number;
	aplica_impuestos: boolean;
	orden?: number;
	cierre_final_origen_id?: string | null;
	cierre_final_destino_id?: string | null;
}

export type ConceptoMensualTipo = 'GASTO_OPERATIVO' | 'IMPUESTO' | 'ANTICIPO';

export interface ConceptoMensual {
	id: string;
	tipo: ConceptoMensualTipo;
	concepto: string;
	conductor_id?: string | null;
	placa_aplicada?: string | null;
	dias?: number | null;
	valor_unitario?: number;
	porcentaje?: number | null;
	valor_total: number;
	base_calculo?: number | null;
	calculado: boolean;
	observaciones?: string | null;
	orden?: number;
}

export interface CierreOrigen {
	id: string;
	consecutivo: string;
	placa: string;
	estado: string;
	total_pagar: number;
}

export interface LiquidacionMensual {
	id: string;
	consecutivo: string;
	mes: number;
	anio: number;
	estado: string;
	observaciones?: string | null;
	total_adicionales?: number;
	total_gastos_operativos?: number;
	total_impuestos?: number;
	total_anticipos?: number;
	total_descuentos?: number;
	total_pagar?: number;
	adicionales?: AdicionalMensual[];
	conceptos?: ConceptoMensual[];
	cierres_origen?: CierreOrigen[];
	creado_por?: { id: string; nombre: string; correo: string } | null;
	actualizado_por?: { id: string; nombre: string; correo: string } | null;
	created_at?: string;
	updated_at?: string;
}

export interface GenerarBorradorResult {
	ok: boolean;
	accion: 'created' | 'existente';
	id: string;
	consecutivo?: string;
	message: string;
	adicionales_extraidos?: number;
	cierres_origen_count?: number;
}

export interface PreviewDataMensual {
	cabecera: LiquidacionMensual;
	adicionales: AdicionalMensual[];
	conceptos: ConceptoMensual[];
	cierres_origen: CierreOrigen[];
	por_placa: Array<{
		placa: string;
		count: number;
		valor: number;
	}>;
	totales: {
		total_adicionales: number;
		total_gastos_operativos: number;
		total_impuestos: number;
		total_anticipos: number;
		total_descuentos: number;
		total_pagar: number;
	};
}

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

export const liquidacionesTercerosMensualAPI = {
	// ── Listar / Buscar ──

	async listar(params?: { mes?: number; anio?: number }): Promise<{
		items: Array<LiquidacionMensual & { _count?: { adicionales: number; conceptos: number; snapshots: number } }>;
		total: number;
	}> {
		const response = await apiClient.get('/api/liquidaciones-terceros-mensual', { params });
		return response.data;
	},

	async obtenerPorId(id: string): Promise<LiquidacionMensual | null> {
		const response = await apiClient.get(`/api/liquidaciones-terceros-mensual/${id}`);
		return response.data;
	},

	async obtenerPorPeriodo(mes: number, anio: number): Promise<LiquidacionMensual | null> {
		const response = await apiClient.get('/api/liquidaciones-terceros-mensual/por-periodo', {
			params: { mes, anio }
		});
		return response.data;
	},

	async obtenerPreviewData(id: string): Promise<PreviewDataMensual | null> {
		try {
			const response = await apiClient.get(`/api/liquidaciones-terceros-mensual/${id}/preview-data`);
			return response.data;
		} catch (e: any) {
			if (e?.response?.status === 404) return null;
			throw e;
		}
	},

	// ── Generar / Guardar borrador ──

	async generarBorrador(params: { mes: number; anio: number }): Promise<GenerarBorradorResult> {
		const response = await apiClient.post('/api/liquidaciones-terceros-mensual/generar-borrador', params);
		return response.data;
	},

	async guardarBorrador(params: {
		id?: string;
		mes: number;
		anio: number;
		observaciones?: string | null;
		adicionales: AdicionalMensual[];
		conceptos: ConceptoMensual[];
		force_new?: boolean;
	}): Promise<LiquidacionMensual> {
		const response = await apiClient.post('/api/liquidaciones-terceros-mensual/guardar-borrador', params);
		return response.data;
	},

	async recalcularTotales(id: string): Promise<Partial<LiquidacionMensual>> {
		const response = await apiClient.post(`/api/liquidaciones-terceros-mensual/${id}/recalcular-totales`);
		return response.data;
	},

	// ── Estado ──

	async cambiarEstado(
		id: string,
		estado: string,
		motivo_anulacion?: string
	): Promise<LiquidacionMensual> {
		const response = await apiClient.patch(`/api/liquidaciones-terceros-mensual/${id}/estado`, {
			estado,
			motivo_anulacion
		});
		return response.data;
	},

	// ── Soft delete ──

	async softDelete(id: string): Promise<{
		ok: boolean;
		id: string;
		deleted_at: string;
		adicionales_eliminados: number;
		conceptos_eliminados: number;
	}> {
		const response = await apiClient.delete(`/api/liquidaciones-terceros-mensual/${id}`);
		return response.data;
	},

	// ── Snapshots (placeholder, mismo patrón que el resto) ──

	async listarSnapshots(id: string): Promise<Array<{
		id: string;
		version: number;
		rama: string;
		origen: string;
		revertido_de_id: string | null;
		usuario: { id: string; nombre: string; correo: string } | null;
		created_at: string;
		diff: any;
		meta: any;
	}>> {
		const response = await apiClient.get(`/api/liquidaciones-terceros-mensual/${id}/snapshots`);
		return response.data;
	}
};
