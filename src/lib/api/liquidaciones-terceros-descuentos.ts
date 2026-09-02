import { apiClient } from './apiClient';
import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';

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

/** Fila del catálogo de conductores que alimenta el buscador del modal. */
export interface ConductorSelect {
	id: string;
	nombre: string;
	apellido: string;
	numero_identificacion: string | null;
	estado: string;
}

/**
 * Un item de `liquidacion_tercero` que PODRÍA entrar en el cierre: es de la
 * misma placa y no está comprometido en ningún otro.
 *
 * Trae más de lo que la tabla del modal pinta —`porcentaje_admin`,
 * `valor_admin`, `total_facturado`— porque son las cifras con las que el item
 * va a aterrizar en la hoja, y verlas antes de aceptar evita la sorpresa de
 * añadir algo que sale por un valor distinto del esperado.
 */
export interface ItemDisponible {
	id: string;
	placa: string;
	recorrido: string;
	fechas: string;
	/// Periodo DEL ITEM, que puede no ser el de su liquidación de servicio.
	mes: number | null;
	anio: number | null;
	tercero_id: string | null;
	tercero_nombre: string | null;
	/// El item va con un tercero distinto al del cierre. Legítimo —manda la
	/// placa— pero el modal lo señala.
	otro_tercero: boolean;
	cliente_nombre: string;
	liquidacion_consecutivo: string;
	liquidacion_estado: string | null;
	numero_planilla: string;
	/// Puede traer varias separadas por coma: una liquidación de servicio
	/// admite más de una factura activa.
	numero_factura: string;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	total_facturado: number;
	valor_liquidar: number;
	created_at: string;
}

export interface ItemsDisponiblesResp {
	cierre: {
		id: string;
		placa: string;
		mes: number | null;
		anio: number | null;
		estado: string | null;
		consecutivo: string | null;
		editable: boolean;
	};
	disponibles: ItemDisponible[];
	/// Items de la placa descartados por estar ya en un cierre vivo. Solo el
	/// número: explica por qué la lista es más corta de lo esperado.
	ocupados: number;
	total: number;
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
	/// FK opcional al copropietario (modo multi-propietario). Solo aplica a
	/// filas de tipo IMPUESTO; NULL cuando el cierre es de un solo propietario.
	propietario_id?: string | null;
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
// COPROPIETARIOS (reparto porcentual del valor a pagar)
// ═══════════════════════════════════════════════════════════════

export interface LiquidacionTerceroFinalPropietario {
	id?: string;
	liquidacion_tercero_final_id?: string;
	tercero_id?: string | null;
	nombre: string;
	identificacion?: string | null;
	/// Porcentaje del valor a pagar (0–9999.9999%). NO se valida contra 100%
	/// — el usuario puede excederse (ej. 15 + 50 + 50 = 115%).
	porcentaje: number;
	/// Porcentaje efectivo de la cascada por orden (lo calcula y persiste el
	/// backend; ver `$lib/editor/business/reparto-propietarios.ts`).
	porcentaje_efectivo?: number;
	/// Concepto/nota de pago libre, ej. "ABONAR A CRÉDITO BANCOOMEVA".
	nota?: string | null;
	/// Si se le calculan retenciones sobre su valor a facturar. FALSE para
	/// pagos internos por concepto (abono): no generan egreso real ni tributan.
	aplica_retenciones?: boolean;
	orden?: number;
	created_at?: string;
	updated_at?: string;
	tercero?: {
		id: string;
		nombre_completo: string;
		identificacion?: string | null;
		tipo_persona?: string;
	} | null;
}

export interface CopropietariosCierre {
	es_multi_propietario: boolean;
	propietarios: LiquidacionTerceroFinalPropietario[];
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

	// ── Copropietarios (reparto porcentual del valor a pagar) ──

	async obtenerPropietarios(liquidacionTerceroFinalId: string): Promise<CopropietariosCierre> {
		const response = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/propietarios`);
		return response.data;
	},

	async guardarPropietarios(
		liquidacionTerceroFinalId: string,
		propietarios: LiquidacionTerceroFinalPropietario[]
	): Promise<CopropietariosCierre> {
		const response = await apiClient.put(`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/propietarios`, {
			propietarios,
		});
		return response.data;
	},

	// ── Autocompletar desde nómina ──

	async autocompletarNomina(params: { placa: string; mes: number; anio: number }): Promise<AutocompletarNominaResult> {
		const response = await apiClient.get('/api/liquidaciones-terceros/autocompletar-nomina', { params });
		return response.data;
	},

	// ── Generar borrador ──

	async generarBorrador(
		liquidacionServicioId: string,
		placa?: string,
		terceroId?: string | null
	): Promise<GenerarBorradorResult> {
		const response = await apiClient.post('/api/liquidaciones-terceros/generar-borrador', {
			liquidacion_servicio_id: liquidacionServicioId,
			placa: placa || undefined,
			tercero_id: terceroId || null,
		});
		return response.data;
	},

	// Versión asíncrona que acepta múltiples liquidaciones y reporta progreso via socket.
	/**
	 * Lanza la generación de borradores en la cola.
	 *
	 * Dos modos:
	 *
	 *  · Sin `persistir` (flujo antiguo) el job solo PREVISUALIZA. El
	 *    formulario recibe el resultado, el usuario lo revisa y guarda
	 *    aparte con `guardarBorradorBulkAsync`.
	 *  · Con `persistir: true` el job guarda cada cierre según lo genera y
	 *    anuncia su hoja por socket (`sheet:sheet-added`) al room del
	 *    periodo. Es lo que usa el canvas, donde no hay formulario
	 *    intermedio. Exige `anio` y `mes`.
	 *
	 * Devuelve 409 con `locked_by` si otro usuario está generando **ese
	 * mismo periodo**; periodos distintos no se bloquean entre sí.
	 */
	async generarBorradorAsync(payload: {
		liquidacion_servicio_ids: string[];
		placa?: string;
		persistir?: boolean;
		anio?: number;
		mes?: number;
		/** Subconjunto de placas a persistir. Vacío = todas. */
		placas?: string[];
		/** Crea un cierre nuevo marcando el existente como REEMPLAZADA. */
		force_new?: boolean;
	}): Promise<{ job_id: string; status: 'queued' | 'locked'; locked_by?: any }> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros/generar-borrador-async',
			payload,
			// El 409 de "periodo ocupado" no es un error de programa: trae
			// `locked_by` y la UI lo muestra.
			{ validateStatus: (s: number) => s === 200 || s === 202 || s === 409 }
		);
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
		/// ── BULK MODE ──
		/// Si se envía `bulk_mode: true` + `placas` o `placas_payload`, el
		/// backend crea UNA liquidación independiente por cada placa.
		bulk_mode?: boolean;
		placas?: string[];
		placas_payload?: Array<{
			placa: string;
			item_ids: string[];
			conceptos: ConceptoDescuento[];
			adicionales?: AdicionalTransmeralda[];
			tercero_id?: string | null;
			liquidacion_servicio_id?: string;
		}>;
	}): Promise<
		| { ok: boolean; id: string; accion: 'created' | 'updated'; cierre: any }
		| { ok: boolean; bulk: true; count: number; results: any[]; errors: any[] }
	> {
		const response = await apiClient.post('/api/liquidaciones-terceros/guardar-borrador', params);
		return response.data;
	},

	// Versión async del bulk save: lanza el guardado en background y
	// emite `liquidaciones-terceros-save-bulk:progress` y `:done` al
	// room `user-${userId}`. El cliente persiste el batchId en
	// localStorage para poder reanudar la UI tras recargar.
	async guardarBorradorBulkAsync(payload: {
		placas: Array<{
			placa: string;
			tercero_id: string | null;
			liquidacion_servicio_id: string;
			item_ids: string[];
			conceptos: ConceptoDescuento[];
			adicionales?: AdicionalTransmeralda[];
			es_propietario_overrides?: Record<string, boolean>;
		}>;
		mes: number;
		anio: number;
		force_new?: boolean;
	}): Promise<{ success: boolean; batchId: string; total: number; status: 'queued' }> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros/guardar-borrador-bulk-async',
			payload
		);
		return response.data;
	},

	async obtenerEstadoBulkSave(batchId: string): Promise<{
		id: string;
		status: 'queued' | 'running' | 'completed' | 'failed';
		processed: number;
		total: number;
		placas: string[];
		results: Array<{ placa: string; ok: boolean; id?: string; error?: string; value?: number }>;
		okCount: number;
		errCount: number;
		startedAt?: number;
		finishedAt?: number;
	} | null> {
		try {
			const response = await apiClient.get<{ success: boolean; data: any }>(
				`/api/liquidaciones-terceros/save-bulk/${batchId}`
			);
			return response.data.data;
		} catch (err: any) {
			// 404 (purga 1h o restart) → null para que el cliente limpie LS
			if (err?.response?.status === 404) return null;
			throw err;
		}
	},

	async cancelarBulkSave(batchId: string): Promise<{ cancelled: boolean }> {
		const response = await apiClient.delete(
			`/api/liquidaciones-terceros/save-bulk-job/${batchId}`
		);
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

	/// GET /api/liquidaciones-terceros/periodo?anio=&mes=
	///
	/// Índice de hojas del periodo, ya ordenado alfabéticamente por placa y
	/// propietario. Es lo que el canvas pide al montar para construir las
	/// pestañas y el selector de búsqueda; el detalle llega después, por
	/// lotes, con `detallePeriodo`.
	async listarPeriodo(
		anio: number,
		mes: number,
		options?: { signal?: AbortSignal }
	): Promise<{ anio: number; mes: number; total: number; hojas: CierreHoja[] }> {
		const response = await apiClient.get('/api/liquidaciones-terceros/periodo', {
			params: { anio, mes },
			signal: options?.signal
		});
		return response.data;
	},

	/// Detalle completo de un LOTE de cierres del periodo.
	///
	/// El servidor limita a 40 ids por petición: el sentido de pedir por
	/// lotes es no traerse el mes entero de una vez y dejar el canvas en
	/// blanco mientras llega. Los ids que no pertenezcan al periodo se
	/// ignoran en servidor.
	async detallePeriodo(
		anio: number,
		mes: number,
		ids: string[],
		options?: { signal?: AbortSignal }
	): Promise<any[]> {
		if (ids.length === 0) return [];
		const response = await apiClient.get('/api/liquidaciones-terceros/periodo', {
			params: { anio, mes, ids: ids.join(',') },
			signal: options?.signal
		});
		return Array.isArray(response.data?.cierres) ? response.data.cierres : [];
	},

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
			/// Necesarios para el canvas: una placa puede tener dos cierres en
			/// el mismo mes, uno por propietario.
			tercero_id?: string | null;
			es_multi_propietario?: boolean;
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

	/**
	 * Cambia el estado de un cierre.
	 *
	 * `baseVersion` es opcional para no romper al editor tabular, que no la
	 * tiene. El canvas SÍ la manda: con N usuarios mirando el mismo header,
	 * sin ella dos clics simultáneos se resuelven por orden de llegada.
	 * El servidor responde 409 con `code: 'VERSION_CONFLICT'` y el estado
	 * real cuando se pierde la carrera.
	 */
	async cambiarEstado(
		liquidacionTerceroId: string,
		estado: string,
		motivo?: string,
		baseVersion?: number | null
	) {
		const response = await apiClient.patch(
			`/api/liquidaciones-terceros/${liquidacionTerceroId}/estado`,
			{
				estado,
				motivo_anulacion: motivo,
				...(baseVersion != null ? { base_version: baseVersion } : {})
			}
		);
		return response.data;
	},

	/**
	 * Cambio de estado en LOTE para todo un periodo.
	 *
	 * Responde 207 si alguno falló: `fallidos` trae placa y motivo. No es
	 * atómico a propósito — con 80 cierres, revertir los 79 buenos porque
	 * el último falló no ayuda a nadie.
	 */
	async cambiarEstadoLote(params: {
		anio: number;
		mes: number;
		desde: string;
		hacia: string;
		motivo?: string | null;
	}): Promise<{
		total: number;
		cambiados: Array<{
			id: string;
			estado: string;
			estado_anterior: string;
			version: number;
			placa: string | null;
		}>;
		fallidos: Array<{ id: string; placa: string | null; error: string }>;
	}> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros/estado-lote',
			params,
			// El 207 no es un error: hay que leer `fallidos`.
			{ validateStatus: (s: number) => s === 200 || s === 207 }
		);
		return response.data;
	},

	/**
	 * Fija el color de la pestaña de un cierre en el canvas.
	 *
	 * `null` la devuelve al color automático del estado. El servidor difunde
	 * el cambio por `sheet:hoja-color`, así que el emisor NO tiene que pintar
	 * nada a mano: Univer ya lo hizo localmente y el resto lo recibe.
	 */
	async fijarColorHoja(liquidacionTerceroId: string, color: string | null) {
		const response = await apiClient.patch(
			`/api/liquidaciones-terceros/${liquidacionTerceroId}/color-hoja`,
			{ color }
		);
		return response.data;
	},

	/** Quién cambió el estado y cuándo. Alimenta el panel del header. */
	async historialEstados(liquidacionTerceroId: string): Promise<Array<{
		id: string;
		estado_anterior: string | null;
		estado_nuevo: string;
		motivo: string | null;
		fecha: string;
		usuario: { id: string; nombre: string; correo: string } | null;
	}>> {
		const response = await apiClient.get(
			`/api/liquidaciones-terceros/${liquidacionTerceroId}/historial-estados`
		);
		return response.data;
	},

async obtenerPorId(liquidacionTerceroId: string, opts: { includeDeleted?: boolean } = {}) {
    const response = await apiClient.get(
      `/api/liquidaciones-terceros-descuentos/${liquidacionTerceroId}`,
      { params: opts.includeDeleted ? { includeDeleted: 'true' } : undefined }
    );
    return response.data;
  },

  /**
   * Descarga el PDF nativo de la liquidación, renderizado por el backend
   * con Puppeteer + Chromium. Reemplaza al fallback `window.print()`
   * que clonaba el DOM del preview.
   */
  async descargarPdf(liquidacionTerceroId: string): Promise<Blob> {
    const response = await apiClient.get(
      `/api/liquidaciones-terceros/${liquidacionTerceroId}/pdf`,
      { responseType: 'blob' }
    );
    return response.data as Blob;
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

	// ── Conductores del cierre ──

	/**
	 * Catálogo liviano de conductores para el buscador del modal.
	 *
	 * Solo activos y no ocultos, sin foto ni joins. Se trae entero y se filtra
	 * en cliente: la lista es de cientos, no de miles, y teclear en un
	 * buscador que va al servidor por cada letra se siente peor que un filtro
	 * instantáneo sobre lo ya cargado.
	 */
	async listarConductoresSelect(): Promise<ConductorSelect[]> {
		const response = await apiClient.get('/api/conductores/select-list');
		return response.data?.data ?? [];
	},

	/**
	 * Reemplaza la lista de conductores de un cierre.
	 *
	 * `conductores` es el estado FINAL, no un delta: quien no venga se da de
	 * baja. `es_propietario` marca al dueño del vehículo, al que no se le
	 * imputan DOTACION ni EXAMEN_MEDICO.
	 *
	 * Cambia la geometría de la hoja (aparecen o desaparecen bloques), así
	 * que el servidor difunde `sheet:invalidate` y el canvas debe remontar.
	 */
	async sincronizarConductores(
		liquidacionTerceroFinalId: string,
		conductores: Array<{ conductor_id: string; dias: number; es_propietario: boolean }>
	): Promise<{
		agregados: string[];
		eliminados: string[];
		mes: number;
		anio: number;
		totales: Record<string, number>;
	}> {
		const response = await apiClient.put(
			`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/conductores`,
			{ conductores }
		);
		return response.data;
	},

	// ── Filas sueltas de GASTOS y ANTICIPOS ──

	/**
	 * Añade una fila a GASTOS DE VEHÍCULO o a ANTICIPOS.
	 *
	 * Nace en el servidor y no insertando una fila en la hoja: una fila de
	 * Univer no tiene id, ni binding, ni combinación, ni formato, así que lo
	 * que se teclee en ella no tiene dónde guardarse.
	 *
	 * IMPUESTOS no entra aquí a propósito: `calcularImpuestos` regenera esas
	 * filas por completo cada vez que corre, así que una añadida a mano
	 * duraría hasta el siguiente recálculo. Un quinto impuesto se añade en
	 * `configuracion-descuentos-tercero`.
	 */
	async agregarConceptoFila(
		liquidacionTerceroFinalId: string,
		fila: {
			tipo: 'GASTO_OPERATIVO' | 'ANTICIPO';
			concepto: string;
			dias: number;
			valor_unitario: number;
			/** En ANTICIPOS es la FECHA: no hay columna propia, va en observaciones. */
			observaciones?: string | null;
		}
	): Promise<{ id: string; mes: number; anio: number; totales: Record<string, number> }> {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/conceptos-fila`,
			fila
		);
		return response.data;
	},

	/** Quita una fila de GASTOS o ANTICIPOS (soft-delete). */
	async eliminarConceptoFila(conceptoId: string): Promise<{
		cierreId: string;
		mes: number;
		anio: number;
		totales: Record<string, number>;
	}> {
		const response = await apiClient.delete(
			`/api/liquidaciones-terceros/conceptos-fila/${conceptoId}`
		);
		return response.data;
	},

	// ── Toggle excluir (soft delete) en item del pivote ──
	// Marca/desmarca `deleted_at` en `liquidacion_tercero_final_item`. La fila
	// sigue visible con tachado en la vista de edición para permitir
	// restaurarla. `excluir: true` ⇒ soft-delete, `excluir: false` ⇒ restaurar.

	async toggleExcluirItem(pivoteId: string, excluir: boolean) {
		const response = await apiClient.patch(`/api/liquidaciones-terceros/items/${pivoteId}/excluir`, {
			excluir,
		});
		return response.data;
	},

	// ── Refrescar items del cierre ──
	// Trae `liquidacion_tercero` recién creados para la misma placa/mes/año/
	// tercero que aún no están en el pivote (`liquidacion_tercero_final_item`)
	// del cierre. Devuelve la cantidad agregada y el cierre actualizado.

	async refreshItems(liquidacionTerceroFinalId: string): Promise<{
		ok: boolean;
		agregados: number;
		ya_existentes: number;
		message: string;
		items?: any;
		conceptos?: any;
		valor_liquidar?: number;
		total_pagar?: number;
	}> {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/refresh-items`
		);
		return response.data;
	},

	// ── Items disponibles para añadir a mano ──
	// Items de `liquidacion_tercero` de la MISMA PLACA que no están en ningún
	// cierre vivo, de cualquier mes. Es lo que `refreshItems` no ve: aquel
	// solo mira el periodo y el tercero del cierre.

	async itemsDisponibles(liquidacionTerceroFinalId: string): Promise<ItemsDisponiblesResp> {
		const response = await apiClient.get(
			`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/items-disponibles`
		);
		return response.data;
	},

	// ── Añadir al cierre los items elegidos ──

	async agregarItems(
		liquidacionTerceroFinalId: string,
		liquidacionTerceroIds: string[]
	): Promise<{ ok: boolean; agregados: number; message: string }> {
		const response = await apiClient.post(
			`/api/liquidaciones-terceros/${liquidacionTerceroFinalId}/items-agregar`,
			{ liquidacion_tercero_ids: liquidacionTerceroIds }
		);
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
