import { apiClient } from './apiClient';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ConfiguracionDescuento {
	id: string;
	categoria: 'PRESTACION_SOCIAL' | 'SEGURIDAD_SOCIAL' | 'IMPUESTO';
	concepto: string;
	nombre: string;
	porcentaje: number;
	base_calculo: string;
	activo: boolean;
	orden: number;
}

export interface ConceptoDescuento {
	id?: string;
	liquidacion_tercero_id?: string;
	tipo: 'COSTO_LABORAL' | 'GASTO_OPERATIVO' | 'IMPUESTO' | 'ANTICIPO';
	concepto: string;
	conductor_id?: string | null;
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	} | null;
	dias?: number | null;
	valor_unitario: number;
	porcentaje?: number | null;
	valor_total: number;
	base_calculo?: number | null;
	calculado: boolean;
	observaciones?: string | null;
	orden: number;
}

export interface AutocompletarNominaResult {
	vehiculo: {
		id: string;
		placa: string;
		propietario_nombre: string | null;
	};
	conductores: Array<{
		conductor_id: string;
		nombre: string;
		identificacion: string;
		dias_laborados: number;
		salario_devengado: number;
		auxilio_transporte: number;
		total_recargos: number;
		total_bonificaciones: number;
	}>;
	conceptos: ConceptoDescuento[];
	conceptos_impuestos: ConceptoDescuento[];
	resumen: {
		base_salarios: number;
		base_auxilio_transporte: number;
		base_recargos: number;
		base_bonificaciones: number;
		total_base: number;
	};
}

export interface GenerarBorradorResult {
	liquidacion_servicio: {
		id: string;
		consecutivo: string;
		mes: number;
		anio: number;
		cliente: any;
		facturas?: string;
	};
	terceros: Array<{
		placa: string;
		error?: string;
		items?: string[];
		liquidacion_tercero: any;
		conceptos: ConceptoDescuento[];
		resumen_nomina: any;
		conductores: any[];
		items_adicionales?: AdicionalTransmeralda[];
	}>;
}

/// Fila virtual adicional (no proviene de un item de liquidacion_servicio).
/// Se persiste en liquidacion_tercero_final.adicionales y se muestra como
/// última fila de la tabla de items en la UI y en el PDF preview.
/// El valor_unitario * cantidad se SUMA al valor_liquidar del cierre y queda
/// como ingreso negativo para Cotransmeq (columna ingreso_empresa).
/// Si `aplica_impuestos: false`, el adicional NO entra en la base de
/// RETENCION_ICA, AVISOS_TABLEROS, SOBRETASA_BOMBERIL ni RETENCION_FUENTE.
export interface AdicionalTransmeralda {
	id?: string;
	cliente?: string;
	placa?: string;
	tercero_nombre?: string;
	recorrido?: string;
	fechas?: string;
	valor_unitario: number;
	cantidad: number;
	valor_liquidar?: number;
	/// Porcentaje de administración (ADMON) aplicado al valor del adicional.
	/// El `valor_admin` se calcula como `valor_unitario * cantidad * porcentaje_admin / 100`.
	porcentaje_admin?: number;
	aplica_impuestos?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

export const liquidacionesTercerosDescuentosAPI = {
	// ── Configuración ──

	async obtenerConfiguracion(): Promise<ConfiguracionDescuento[]> {
		const response = await apiClient.get('/api/configuracion-descuentos-tercero');
		return response.data;
	},

	async actualizarConfiguracion(items: Array<{ concepto: string; porcentaje: number; base_calculo?: string }>) {
		const response = await apiClient.put('/api/configuracion-descuentos-tercero', { items });
		return response.data;
	},

	// ── Conceptos ──

	async obtenerConceptos(liquidacionTerceroId: string): Promise<ConceptoDescuento[]> {
		const response = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionTerceroId}/conceptos`);
		return response.data;
	},

	async guardarConceptos(liquidacionTerceroId: string, conceptos: ConceptoDescuento[]): Promise<ConceptoDescuento[]> {
		const response = await apiClient.put(`/api/liquidaciones-terceros/${liquidacionTerceroId}/conceptos`, { conceptos });
		return response.data;
	},

	// ── Autocompletar desde nómina ──

	async autocompletarNomina(params: { placa: string; mes: number; anio: number }): Promise<AutocompletarNominaResult> {
		const response = await apiClient.get('/api/liquidaciones-terceros/autocompletar-nomina', { params });
		return response.data;
	},

	// ── Generar borrador ──

	async generarBorrador(liquidacionServicioId: string, placa?: string): Promise<GenerarBorradorResult> {
		const response = await apiClient.post('/api/liquidaciones-terceros/generar-borrador', {
			liquidacion_servicio_id: liquidacionServicioId,
			placa: placa || undefined,
		});
		return response.data;
	},

	// Versión asíncrona que acepta múltiples liquidaciones y reporta progreso via socket.
	async generarBorradorAsync(payload: {
		liquidacion_servicio_ids: string[];
		placa?: string;
	}): Promise<{ job_id: string; status: 'queued' | 'locked'; locked_by?: any }> {
		const response = await apiClient.post('/api/liquidaciones-terceros/generar-borrador-async', payload);
		return response.data;
	},

	// Persiste el borrador (cierre + pivote + conceptos) en una sola llamada.
	// `generarBorrador` es read-only; el guardado explícito ocurre aquí.
	async guardarBorrador(params: {
		liquidacion_servicio_id: string;
		placa: string;
		tercero_id: string | null;
		mes: number;
		anio: number;
		item_ids: string[];
		conceptos: ConceptoDescuento[];
		adicionales?: AdicionalTransmeralda[];
		/// Map { conductorId: true | false }. Si el conductor no está, el
		/// backend usa la auto-detección por número de identificación.
		es_propietario_overrides?: Record<string, boolean>;
	}): Promise<{ ok: boolean; id: string; accion: 'created' | 'updated'; cierre: any }> {
		const response = await apiClient.post('/api/liquidaciones-terceros/guardar-borrador', params);
		return response.data;
	},

	// ── Calcular impuestos ──

	async calcularImpuestos(liquidacionTerceroId: string): Promise<ConceptoDescuento[]> {
		const response = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionTerceroId}/calcular-impuestos`);
		return response.data;
	},

	// ── Recalcular totales ──

	async recalcularTotales(liquidacionTerceroId: string) {
		const response = await apiClient.post(`/api/liquidaciones-terceros/${liquidacionTerceroId}/recalcular-totales`);
		return response.data;
	},

	// ── Historial (con descuentos) ──

	async listarHistorial(params?: {
		page?: number;
		limit?: number;
		placa?: string;
		mes?: number;
		anio?: number;
		tercero_id?: string;
		busqueda?: string;
		full?: boolean;
	}): Promise<{
		items: Array<{
			id: string;
			consecutivo: string | null;
			placa: string;
			mes: number | null;
			anio: number | null;
			valor_liquidar: number;
			total_costos_laborales: number;
			total_gastos_operativos: number;
			total_impuestos: number;
			total_descuentos: number;
			total_pagar: number;
			estado: string;
			tercero?: { nombre_completo: string } | null;
			numero_factura?: string;
			created_at?: string;
			creado_por?: { id: string; nombre: string; correo: string } | null;
			snapshot_count?: number;
			liquidacion?: {
				id: string;
				consecutivo: string;
				mes: number;
				anio: number;
				estado: string;
				cliente: { id: string; nombre: string; nit: string } | null;
			};
			items?: Array<any>;
			conceptos?: ConceptoDescuento[];
		}>;
		total: number;
		totalPages: number;
		page: number;
	}> {
		const { full, ...rest } = params || {};
		const response = await apiClient.get('/api/liquidaciones-terceros-descuentos', {
			params: { ...rest, lite: full ? undefined : true }
		});
		return response.data;
	},

	async cambiarEstado(liquidacionTerceroId: string, estado: string, motivo?: string) {
		const response = await apiClient.patch(
			`/api/liquidaciones-terceros/${liquidacionTerceroId}/estado`,
			{ estado, motivo_anulacion: motivo }
		);
		return response.data;
	},

	async obtenerPorId(liquidacionTerceroId: string) {
		const response = await apiClient.get(`/api/liquidaciones-terceros-descuentos/${liquidacionTerceroId}`);
		return response.data;
	},

	async obtenerAdicionales(liquidacionTerceroId: string): Promise<AdicionalTransmeralda[]> {
		const data = await this.obtenerPorId(liquidacionTerceroId);
		return Array.isArray(data?.items_adicionales) ? data.items_adicionales : [];
	},

	// ── Soft delete ──

	async softDelete(liquidacionTerceroId: string): Promise<{
		ok: boolean;
		id: string;
		deleted_at: string;
		items_eliminados: number;
		conceptos_eliminados: number;
	}> {
		const response = await apiClient.delete(`/api/liquidaciones-terceros/${liquidacionTerceroId}`);
		return response.data;
	},

	// ── Reemplazar items del pivote (descartar no deseados) ──

	async reemplazarItems(liquidacionTerceroFinalId: string, itemIds: string[]) {
		const response = await apiClient.put(`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/items`, {
			item_ids: itemIds,
		});
		return response.data;
	},

	// ── Toggle aplica_impuestos en item del pivote ──

	async toggleAplicaImpuestosItem(pivoteId: string, aplica_impuestos: boolean) {
		const response = await apiClient.patch(`/api/liquidaciones-terceros/items/${pivoteId}/aplica-impuestos`, {
			aplica_impuestos,
		});
		return response.data;
	},

	// ── Obtener bonificaciones por placa / periodo (para autocomplete del concepto BONIFICACION) ──

	async obtenerBonificaciones(params: { placa: string; mes: number; anio: number }): Promise<{
		vehiculo: { id: string; placa: string };
		mes: string;
		por_conductor: Array<{
			conductor_id: string;
			conductor_nombre: string;
			conductor_numero_identificacion: string | null;
			bonos: Array<{
				nombre: string;
				cantidad: number;
				valor_unitario: number;
				valor_total: number;
				liquidacion_id: string;
				periodo_end: string;
			}>;
			total: number;
		}>;
		total: number;
	}> {
		const response = await apiClient.get('/api/liquidaciones-terceros/bonificaciones', { params });
		return response.data;
	},

	// ── Obtener anticipos del vehículo por placa / periodo ──

	async obtenerAnticiposVehiculo(params: { placa: string; mes: number; anio: number }): Promise<{
		vehiculo: { id: string; placa: string };
		anticipos: Array<{
			id: string;
			concepto: string;
			fecha: string;
			valor: number;
		}>;
		total: number;
	}> {
		const response = await apiClient.get('/api/liquidaciones-terceros/anticipos-vehiculo', { params });
		return response.data;
	},

	// ── Snapshots ──

	async listarSnapshots(liquidacionId: string, rama?: string): Promise<Array<{
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
		const response = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionId}/snapshots`, {
			params: rama ? { rama } : undefined,
		});
		return response.data;
	},

	async obtenerSnapshot(liquidacionId: string, snapshotId: string): Promise<any> {
		const response = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionId}/snapshots/${snapshotId}`);
		return response.data;
	},

	async compararSnapshots(snapshotIdA: string, snapshotIdB: string): Promise<{
		fields: Array<{ path: string; anterior: any; nuevo: any }>;
	}> {
		const response = await apiClient.get(`/api/liquidaciones-terceros/snapshots/${snapshotIdA}/diff`, {
			params: { con: snapshotIdB },
		});
		return response.data;
	},

	async revertirASnapshot(liquidacionId: string, snapshotId: string): Promise<any> {
		const response = await apiClient.post(`/api/liquidaciones-terceros/${liquidacionId}/snapshots/${snapshotId}/revertir`);
		return response.data;
	},
};
