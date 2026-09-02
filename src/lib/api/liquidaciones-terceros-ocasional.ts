import { apiClient } from './apiClient';

/**
 * Item de `liquidacion_tercero` que podría entrar en un ocasional: sigue
 * suelto —ni en un cierre de placa ni en otro ocasional— y su placa no tenía
 * cierre final el mes en que se prestó el servicio.
 */
export interface ItemDisponibleOcasional {
	id: string;
	placa: string;
	recorrido: string;
	fechas: string;
	/// Periodo DEL ITEM. Puede no ser el mes que se está liquidando: de eso va
	/// este modal.
	mes: number | null;
	anio: number | null;
	tercero_id: string | null;
	tercero_nombre: string | null;
	tercero_documento: string | null;
	cliente_nombre: string;
	liquidacion_consecutivo: string;
	numero_planilla: string;
	numero_factura: string;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	total_facturado: number;
	valor_liquidar: number;
}

export interface ItemsDisponiblesOcasionalResp {
	cabecera: {
		id: string | null;
		consecutivo: string | null;
		estado: string | null;
		mes: number;
		anio: number;
		editable: boolean;
	};
	disponibles: ItemDisponibleOcasional[];
	/// Descartados porque su placa ya se liquidó por cierre final ese mes.
	descartados_por_cierre: number;
	/// Descartados porque ya están en otro ocasional vivo.
	descartados_por_ocasional: number;
	total: number;
}


// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AdicionalOcasional {
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
	porcentaje_admin?: number;
	valor_admin?: number;
	valor_liquidar?: number;
	aplica_impuestos?: boolean;
	orden?: number;
	cierre_final_origen_id?: string | null;
	cierre_final_destino_id?: string | null;
}

export interface ItemOcasional {
	id: string;
	liquidacion_tercero_id?: string | null;
	cierre_final_id?: string | null;
	liquidacion_servicio_id?: string | null;
	cliente_nombre: string;
	consecutivo: string;
	placa: string;
	tercero_id?: string | null;
	tercero_nombre: string;
	tercero_documento?: string | null;
	recorrido: string;
	fechas: string;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin?: number;
	valor_admin?: number;
	total_facturado?: number;
	valor_liquidar?: number;
	numero_planilla?: string | null;
	ingreso_extra_global?: number;
	ingresos_extra_aval?: number;
	ingreso_empresa?: number;
	numero_factura?: string | null;
	aplica_impuestos?: boolean;
	excluido?: boolean;
	orden?: number;
	/// Recargos cobrados al cliente en la liquidación de servicio asociada
	/// al item (provisto por el backend en `item.liquidacion_servicio.valor_recargos`).
	valor_recargos?: number;
	/// Snapshot mínimo del `liquidacion_servicio` adjunto al item.
	liquidacion_servicio?: { id: string; valor_recargos?: number } | null;
}

export interface ConceptoOcasional {
	id?: string;
	/// `COSTO_LABORAL` se usa para descuentos de nómina (salarios,
	/// prestaciones, seguridad social) por conductor; los otros tres tipos
	/// siguen la lógica existente de gastos/impuestos/anticipos.
	tipo: 'COSTO_LABORAL' | 'GASTO_OPERATIVO' | 'IMPUESTO' | 'ANTICIPO';
	concepto: string;
	conductor_id?: string | null;
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	} | null;
	placa_aplicada?: string | null;
	dias?: number | null;
	valor_unitario?: number;
	porcentaje?: number | null;
	valor_total?: number;
	base_calculo?: number | null;
	calculado?: boolean;
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

export interface LiquidacionOcasional {
	id: string;
	consecutivo: string;
	mes: number;
	anio: number;
	estado: string;
	motivo_anulacion?: string | null;
	observaciones?: string | null;
	total_adicionales: number;
	total_gastos_operativos: number;
	total_impuestos: number;
	total_anticipos: number;
	total_descuentos: number;
	total_pagar: number;
	total_facturado_items?: number;
	total_admin_items?: number;
	total_liquidar_items?: number;
	creado_por?: { id: string; nombre: string; correo: string } | null;
	actualizado_por?: { id: string; nombre: string; correo: string } | null;
	created_at: string;
	updated_at: string;
	adicionales?: AdicionalOcasional[];
	conceptos?: ConceptoOcasional[];
	items?: ItemOcasional[];
	cierres_origen?: CierreOrigen[];
	_count?: {
		adicionales: number;
		conceptos: number;
		items: number;
		snapshots: number;
	};
}

export interface PreviewDataOcasional {
	cabecera: {
		id: string;
		consecutivo: string;
		mes: number;
		anio: number;
		estado: string;
		observaciones?: string | null;
		creado_por: { id: string; nombre: string; correo: string } | null;
		actualizado_por: { id: string; nombre: string; correo: string } | null;
		created_at: string;
		updated_at: string;
		cierres_origen: CierreOrigen[];
	};
	items: ItemOcasional[];
	adicionales: AdicionalOcasional[];
	conceptos: ConceptoOcasional[];
	por_placa: Array<{
		placa: string;
		adicionales_count: number;
		items_count: number;
		valor_liquidar: number;
		tercero_nombre?: string | null;
	}>;
	totales: {
		total_facturado_items: number;
		total_admin_items: number;
		total_liquidar_items: number;
		total_adicionales: number;
		total_gastos_operativos: number;
		total_impuestos: number;
		total_anticipos: number;
		total_descuentos: number;
		total_pagar: number;
	};
}

export interface TerceroCandidato {
	tercero_id: string;
	tercero_nombre: string;
	tercero_documento: string | null;
	placas: string[];
	cierres_count: number;
	cierres_bloqueados: number;
}

export interface PrevisualizarResult {
	cierres_candidatos: Array<{
		id: string;
		consecutivo: string;
		placa: string;
		estado: string;
		tercero_id: string | null;
		tercero: { id: string; nombre_completo: string; identificacion: string | null } | null;
		_count?: { items: number };
	}>;
	cierres_bloqueados: Array<{ id: string; placa: string; estado: string }>;
	total_items_estimados: number;
	total_cierres: number;
}

export interface OcasionalSnapshot {
	id: string;
	version: number;
	rama: string;
	origen: 'manual' | 'auto' | 'revert';
	revertido_de_id: string | null;
	usuario: { id: string; nombre: string; correo: string } | null;
	created_at: string;
	diff: any;
	meta: any;
}

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

export const liquidacionesTercerosOcasionalAPI = {
	// ── Listado y detalle ──

	async listar(params?: { mes?: number; anio?: number }): Promise<{
		items: LiquidacionOcasional[];
		total: number;
	}> {
		const response = await apiClient.get('/api/liquidaciones-terceros-ocasional', { params });
		return response.data;
	},

	async obtenerPorId(id: string): Promise<LiquidacionOcasional | null> {
		try {
			const response = await apiClient.get(`/api/liquidaciones-terceros-ocasional/${id}`);
			return response.data;
		} catch (err: any) {
			if (err?.response?.status === 404) return null;
			throw err;
		}
	},

	async obtenerPorPeriodo(mes: number, anio: number): Promise<LiquidacionOcasional | null> {
		const response = await apiClient.get('/api/liquidaciones-terceros-ocasional/por-periodo', {
			params: { mes, anio },
		});
		return response.data;
	},

	/// GET /api/liquidaciones-terceros-ocasional/anual?anio=
	/// Los 12 meses en UNA sola petición. El backend devuelve siempre 12
	/// entradas; los meses sin borrador llegan con `cabecera: null` y el
	/// builder los renderiza como hoja placeholder.
	/**
	 * Incorpora al borrador los items que se volvieron elegibles después de
	 * generarlo: servicios liquidados más tarde en el mes, o placas que dejaron
	 * de tener cierre final.
	 *
	 * Es ADITIVO: no toca ni borra lo ya guardado, solo añade lo que falta.
	 */
	// ── Items sueltos de otros periodos ──
	// Lo que `refrescar` no ve: `refrescar` solo mira el mes del borrador, y
	// esto lista los items de CUALQUIER mes que sigan sin liquidar —ni en un
	// cierre de placa ni en otro ocasional—.

	async itemsDisponibles(mes: number, anio: number): Promise<ItemsDisponiblesOcasionalResp> {
		const { data } = await apiClient.get(
			`/api/liquidaciones-terceros-ocasional/items-disponibles`,
			{ params: { mes, anio } }
		);
		return data;
	},

	// ── Añadir al ocasional los items elegidos ──

	async agregarItems(
		mes: number,
		anio: number,
		liquidacionTerceroIds: string[]
	): Promise<{ ok: boolean; agregados: number; placas: string[]; message: string }> {
		const { data } = await apiClient.post(
			`/api/liquidaciones-terceros-ocasional/items-agregar`,
			{ mes, anio, liquidacion_tercero_ids: liquidacionTerceroIds }
		);
		return data;
	},

	async refrescar(
		mes: number,
		anio: number
	): Promise<{
		ok: boolean;
		accion: string;
		agregados?: number;
		placas?: string[];
		message: string;
	}> {
		const { data } = await apiClient.post(
			'/api/liquidaciones-terceros-ocasional/refrescar',
			{ mes, anio }
		);
		return data;
	},

	async obtenerAnual(anio: number): Promise<
		Array<{
			mes: number;
			cabecera: LiquidacionOcasional | null;
			items: ItemOcasional[];
			adicionales: AdicionalOcasional[];
			conceptos: ConceptoOcasional[];
		}>
	> {
		const response = await apiClient.get('/api/liquidaciones-terceros-ocasional/anual', {
			params: { anio },
		});
		const meses = Array.isArray(response.data?.meses) ? response.data.meses : [];
		// Normalizamos por si faltara algún mes: el canvas asume las 12 hojas.
		const porMes = new Map<number, any>(meses.map((m: any) => [m.mes, m]));
		return Array.from({ length: 12 }, (_, i) => {
			const mes = i + 1;
			const m = porMes.get(mes);
			return {
				mes,
				cabecera: m?.cabecera ?? null,
				items: m?.items ?? [],
				adicionales: m?.adicionales ?? [],
				conceptos: m?.conceptos ?? [],
			};
		});
	},

	async obtenerPreviewData(id: string): Promise<PreviewDataOcasional | null> {
		try {
			const response = await apiClient.get(
				`/api/liquidaciones-terceros-ocasional/${id}/preview-data`,
			);
			return response.data;
		} catch (err: any) {
			if (err?.response?.status === 404) return null;
			throw err;
		}
	},

	// ── Modal selector (sin crear cabecera) ──

	async previsualizar(params: {
		mes: number;
		anio: number;
		terceros_filtro?: string[];
	}): Promise<PrevisualizarResult> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros-ocasional/previsualizar',
			params,
		);
		return response.data;
	},

	async buscarTercerosCandidatos(params: {
		mes: number;
		anio: number;
		busqueda?: string;
		filtro_tipo?: 'documento' | 'placa' | 'nombre';
	}): Promise<{ items: TerceroCandidato[] }> {
		const response = await apiClient.get(
			'/api/liquidaciones-terceros-ocasional/terceros-candidatos',
			{ params },
		);
		return response.data;
	},

	// ── Generar borrador ──

	async generarBorrador(params: {
		mes: number;
		anio: number;
		terceros_filtro?: string[];
	}): Promise<{
		ok: boolean;
		accion: 'created' | 'existente' | 'no_data';
		id: string;
		consecutivo?: string;
		message: string;
		items_extraidos?: number;
		adicionales_extraidos?: number;
		cierres_origen_count?: number;
		cierres_origen?: Array<{ id: string; consecutivo: string; placa: string }>;
		consecutivos?: string[];
		facturas?: string[];
	}> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros-ocasional/generar-borrador',
			params,
		);
		return response.data;
	},

	// ── Guardar borrador (idempotente) ──

	async guardarBorrador(params: {
		id?: string;
		mes: number;
		anio: number;
		observaciones?: string | null;
		adicionales: AdicionalOcasional[];
		conceptos: ConceptoOcasional[];
		items: ItemOcasional[];
		force_new?: boolean;
	}): Promise<{
		ok: boolean;
		id: string;
		accion: 'created' | 'updated';
		message: string;
	}> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros-ocasional/guardar-borrador',
			params,
		);
		return response.data;
	},

	// ── Autosave draft ──

	async guardarDraft(params: {
		liquidacion_ocasional_id: string;
		payload: any;
	}): Promise<{ ok: boolean; id: string; version: number }> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros-ocasional/draft',
			params,
		);
		return response.data;
	},

	async obtenerDraft(id: string): Promise<{
		id: string;
		payload: any;
		version: number;
		updated_at: string;
	} | null> {
		try {
			const response = await apiClient.get(
				`/api/liquidaciones-terceros-ocasional/${id}/draft`,
			);
			return response.data;
		} catch (err: any) {
			if (err?.response?.status === 404) return null;
			throw err;
		}
	},

	async eliminarDraft(id: string): Promise<{ ok: boolean }> {
		const response = await apiClient.delete(
			`/api/liquidaciones-terceros-ocasional/${id}/draft`,
		);
		return response.data;
	},

	// ── Recalcular totales ──

	async recalcularTotales(id: string) {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros-ocasional/${id}/recalcular-totales`,
		);
		return response.data;
	},

	// ── Cerrar y distribuir (409 con placas faltantes) ──

	async cerrarYDistribuir(id: string): Promise<{
		ok: boolean;
		id: string;
		estado: string;
		cierres_asociados: number;
		message: string;
	}> {
		try {
			const response = await apiClient.post(
				`/api/liquidaciones-terceros-ocasional/${id}/cerrar-distribuir`,
			);
			return response.data;
		} catch (err: any) {
			if (err?.response?.status === 409) {
				const e = new Error(err.response.data.error || 'Placas faltantes') as any;
				e.code = err.response.data.code;
				e.placas_faltantes = err.response.data.placas_faltantes;
				e.statusCode = 409;
				throw e;
			}
			throw err;
		}
	},

	// ── Cambiar estado ──

	async cambiarEstado(id: string, estado: string, motivo?: string) {
		const response = await apiClient.patch(
			`/api/liquidaciones-terceros-ocasional/${id}/estado`,
			{ estado, motivo_anulacion: motivo },
		);
		return response.data;
	},

	// ── Soft delete ──

	async softDelete(id: string) {
		const response = await apiClient.delete(`/api/liquidaciones-terceros-ocasional/${id}`);
		return response.data;
	},

	// ── Snapshots (capture / listar / obtener / diff / revertir) ──

	async listarSnapshots(id: string): Promise<OcasionalSnapshot[]> {
		const response = await apiClient.get(
			`/api/liquidaciones-terceros-ocasional/${id}/snapshots`,
		);
		return response.data;
	},

	async capturarManual(id: string): Promise<OcasionalSnapshot> {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros-ocasional/${id}/snapshots`,
		);
		return response.data;
	},

	async obtenerSnapshot(
		id: string,
		snapshotId: string
	): Promise<OcasionalSnapshot & { payload: any }> {
		const response = await apiClient.get(
			`/api/liquidaciones-terceros-ocasional/${id}/snapshots/${snapshotId}`,
		);
		return response.data;
	},

	async compararSnapshots(
		id: string,
		snapshotId: string,
		otroSnapshotId: string
	): Promise<{
		fields: Array<{ path: string; anterior: any; nuevo: any }>;
	}> {
		const response = await apiClient.get(
			`/api/liquidaciones-terceros-ocasional/${id}/snapshots/${snapshotId}/diff`,
			{ params: { con: otroSnapshotId } },
		);
		return response.data;
	},

	async revertirASnapshot(
		id: string,
		snapshotId: string
	): Promise<OcasionalSnapshot & { payload: any }> {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros-ocasional/${id}/snapshots/${snapshotId}/revertir`,
		);
		return response.data;
	},
};
