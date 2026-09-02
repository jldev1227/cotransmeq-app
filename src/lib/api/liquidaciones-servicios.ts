import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

// ═══ Tipos ═══

export type TipoServicioTarifa =
	| 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA'
	| 'TRANSPORTE_DE_PERSONAL_EN_BUSETA'
	| 'TRANSPORTE_DE_PERSONAL_EN_MICROBUS'
	| 'TRANSPORTE_DE_PERSONAL_EN_BUS'
	| 'TRANSPORTE_ADICIONAL_HORA_ADICIONAL'
	| 'TRANSPORTE_ADICIONAL_KM_ADICIONAL'
	| 'TRANSPORTE_ADICIONAL_DISPONIBILIDAD';
export type EstadoLiquidacionServicio =
	| 'BORRADOR'
	| 'LIQUIDADA'
	| 'APROBADA'
	| 'FACTURADA'
	| 'ANULADA';
/**
 * Operadora en el sentido de TARIFAS: selecciona qué tabla de precios aplica.
 *
 * Dominio cerrado y distinto del catálogo de operadoras: aquí `OTRA` no
 * existe, porque no hay tarifas para «ninguna en concreto». Compartir un solo
 * tipo para las dos cosas hacía que el selector de tarifas ofreciera valores
 * que su dominio no admite.
 */
export type OperadoraTarifa = 'PAREX' | 'GEOPARK';

/**
 * Operadora del CATÁLOGO: a quién se le atribuye la liquidación.
 *
 * Antes era texto libre en la base —sin enum, sin default y sin validación en
 * ninguna capa—, así que añadir una obligaba a tocar código en dos repos.
 */
export interface Operadora {
	id: string;
	codigo: string;
	nombre: string;
	activo: boolean;
	orden: number;
}

export const TIPO_SERVICIO_LABELS: Record<TipoServicioTarifa, string> = {
  TRANSPORTE_DE_PERSONAL_EN_CAMIONETA: 'Transporte de personal en camioneta',
  TRANSPORTE_DE_PERSONAL_EN_BUSETA: 'Transporte de personal en buseta',
  TRANSPORTE_DE_PERSONAL_EN_MICROBUS: 'Transporte de personal en microbús',
  TRANSPORTE_DE_PERSONAL_EN_BUS: 'Transporte de personal en bus',
  TRANSPORTE_ADICIONAL_HORA_ADICIONAL: 'Transporte adicional (hora adicional)',
  TRANSPORTE_ADICIONAL_KM_ADICIONAL: 'Transporte adicional (km adicional)',
  TRANSPORTE_ADICIONAL_DISPONIBILIDAD: 'Transporte adicional (disponibilidad)'
};

export const ESTADO_LIQUIDACION_LABELS: Record<
	EstadoLiquidacionServicio,
	{ label: string; color: string }
> = {
	BORRADOR: { label: 'Borrador', color: 'gray' },
	LIQUIDADA: { label: 'Liquidada', color: 'blue' },
	APROBADA: { label: 'Aprobada', color: 'green' },
	FACTURADA: { label: 'Facturada', color: 'emerald' },
	ANULADA: { label: 'Anulada', color: 'red' }
};

// ═══ Interfaces ═══

export interface TarifaServicio {
	id: string;
	operadora: OperadoraTarifa;
	anio: number;
	valor_24h: number;
	valor_12h: number;
	valor_hora: number;
	valor_km: number;
	km_dia: number;
	valor_pernocte: number;
	activo: boolean;
}

export interface TarifaInput {
	operadora: OperadoraTarifa;
	anio: number;
	valor_24h: number;
	valor_12h: number;
	valor_hora: number;
	valor_km: number;
	km_dia?: number;
	valor_pernocte?: number;
}

export interface RecargosDetalle {
	salario_basico: number;
	valor_hora_trabajador: number;
	conductor: { nombre: string; cedula: string } | null;
	conceptos: {
		codigo: string;
		nombre: string;
		porcentaje: number;
		es_hora_extra: boolean;
		totalHoras: number;
		valorUnitario: number;
		valorTotal: number;
	}[];
	subtotal_1: number;
	seguridad_social: { porcentaje: number; valor: number };
	prestaciones_sociales: { porcentaje: number; valor: number };
	subtotal_2: number;
	prueba_antigeno: number;
	administracion: { porcentaje: number; valor: number };
	total: number;
}

export interface ItemLiquidacionServicio {
	id?: string;
	servicio_id?: string;
	recargo_planilla_id?: string;
	placa: string;
	fecha_inicial: string;
	fecha_final: string;
	recorrido: string;
	tipo_servicio: TipoServicioTarifa;
	cantidad: number;
	valor_unitario: number;
	subtotal: number;
	porcentaje_descuento: number;
	valor_final: number;
	numero_planilla?: string;
	recargos_detalle?: RecargosDetalle;
	valor_recargos_total: number;
	cantidad_pernoctes: number;
	valor_pernocte_unitario: number;
	valor_pernoctes_total: number;
	conductor?: { nombre: string; cedula: string } | null;
	orden?: number;
}

export interface LiquidacionServicio {
	id: string;
	consecutivo: string;
	cliente_id: string;
	mes: number;
	anio: number;
	fecha_liquidacion: string;
	valor_servicios: number;
	valor_recargos: number;
	valor_transporte_adicional: number;
	valor_administracion_ta: number;
	valor_pernoctes: number;
	valor_unitario_pernoctes: number;
	cantidad_pernoctes: number;
	subtotal: number;
	porcentaje_iva: number;
	valor_iva: number;
	total: number;
	estado: EstadoLiquidacionServicio;
	tercero_liquidado?: boolean;
	motivo_anulacion?: string;
	observaciones?: string;
	osi?: string;
	operadora?: string;
	recargos_data?: any;
	terceros_items?: {
		id: string;
		tercero_id?: string | null;
		placa: string;
		recorrido: string;
		fechas: string;
		valor_unitario: number;
		cantidad: number;
		total_facturado: number;
		porcentaje_admin: number;
		valor_admin: number;
		valor_liquidar: number;
		ingreso_extra_global: number;
		ingresos_extra_aval: number;
		ingreso_empresa: number;
		src_index: number;
		orden: number;
		tercero?: {
			id: string;
			nombre_completo: string;
			identificacion: string;
			tipo_persona: string;
		} | null;
	}[];
	fecha_aprobacion?: string | null;
	fecha_facturacion?: string | null;
	cliente?: { id: string; nombre: string; nit: string };
	creado_por?: { id: string; nombre: string; correo: string };
	actualizado_por?: { id: string; nombre: string; correo: string };
	liquidado_por?: { id: string; nombre: string; correo: string };
	aprobado_por?: { id: string; nombre: string; correo: string } | null;
	items?: ItemLiquidacionServicio[];
	total_items?: number;
	placas?: string[];
	/**
	 * Factura viva de esta liquidación, embebida por `listar`.
	 *
	 * Opcional porque el tab clásico sigue resolviéndola aparte con
	 * `batchFacturaInfo`. El canvas la necesita embebida: encadenar un
	 * POST /batch-info por cada carga del histórico es un viaje de más.
	 */
	factura_items?: Array<{
		factura: { id: string; numero_factura: string; estado: 'ACTIVA' | 'ANULADA' };
	}>;
	created_at: string;
	updated_at: string;
	/** Nulo mientras la fila existe únicamente por el autoguardado del editor. */
	confirmada_at?: string | null;
}

export interface HistorialEstado {
	id: string;
	liquidacion_id: string;
	estado_anterior: string | null;
	estado_nuevo: string;
	usuario: { id: string; nombre: string; correo: string };
	motivo: string | null;
	accion: string | null;
	snapshot: any | null;
	created_at: string;
}

export interface PreviewLiquidacion {
	cliente: { id: string; nombre: string; nit: string };
	tarifa: {
		id: string;
		operadora: OperadoraTarifa;
		anio: number;
		valor_24h: number;
		valor_12h: number;
		valor_hora: number;
		valor_km: number;
		km_dia: number;
		valor_pernocte: number;
	};
	config_salarial: {
		salario_basico: number;
		valor_hora_trabajador: number;
		seguridad_social: number;
		prestaciones_sociales: number;
		administracion: number;
		prueba_antigeno: number;
	} | null;
	mes: number;
	anio: number;
	items: ItemLiquidacionServicio[];
	totales: {
		valor_servicios: number;
		valor_recargos: number;
		valor_pernoctes: number;
		subtotal: number;
		porcentaje_iva: number;
		valor_iva: number;
		total: number;
	};
}

export interface ServicioDisponible {
	id: string;
	fecha_solicitud: string;
	fecha_realizacion: string;
	fecha_finalizacion: string;
	origen_especifico: string;
	destino_especifico: string;
	valor: number;
	numero_planilla?: string;
	estado: string;
	conductores?: { id: string; nombre: string; apellido: string; numero_identificacion: string };
	vehiculos?: { id: string; placa: string; marca: string; modelo: string };
	municipios_servicio_origen_idTomunicipios?: { nombre_municipio: string };
	municipios_servicio_destino_idTomunicipios?: { nombre_municipio: string };
	recargos_planillas?: { id: string; numero_planilla: string; mes: number; a_o: number }[];
}

export interface TipoRecargo {
	id: string;
	codigo: string;
	nombre: string;
	porcentaje: number;
	es_hora_extra: boolean;
	adicional: boolean;
	categoria: string;
	orden_calculo: number;
}

export interface ConfigLiquidadorServicio {
	id: string;
	salario_basico: number;
	cargo: string;
	valor_hora_override: number;
	conductor_adicional: number;
	pct_seg_social: number;
	pct_prestaciones: number;
	pct_admin: number;
	prueba_covid: number;
}

export interface CrearLiquidacionInput {
	cliente_id: string;
	consecutivo?: string;
	mes: number;
	anio: number;
	items: {
		servicio_id?: string;
		recargo_planilla_id?: string;
		placa: string;
		fecha_inicial: string;
		fecha_final: string;
		recorrido: string;
		tipo_servicio: TipoServicioTarifa;
		cantidad: number;
		valor_unitario: number;
		porcentaje_descuento?: number;
		numero_planilla?: string;
		cantidad_pernoctes?: number;
		valor_pernocte_unitario?: number;
		tercero_id?: string | null;
	}[];
	porcentaje_iva?: number;
	observaciones?: string;
	osi?: string;
	/// El editor ya enviaba `operadora` sin que estuviera declarada aquí: el
	/// payload se asigna a una variable antes de pasarlo, así que TypeScript no
	/// se quejaba. Ahora van las dos — el id manda, el texto es respaldo de la
	/// transición.
	operadora?: string | null;
	operadora_id?: string | null;
	valor_transporte_adicional?: number;
	valor_recargos?: number;
	recargos_data?: any;
	terceros_items?: {
		tercero_id?: string | null;
		placa: string;
		recorrido: string;
		fechas: string;
		valor_unitario: number;
		cantidad: number;
		porcentaje_admin: number;
		ingreso_extra_global?: number;
		ingresos_extra_aval?: number;
		ingreso_empresa?: number;
		src_index?: number;
	}[];
}

// ═══ Helpers ═══

const MESES_LABELS = [
	'',
	'Enero',
	'Febrero',
	'Marzo',
	'Abril',
	'Mayo',
	'Junio',
	'Julio',
	'Agosto',
	'Septiembre',
	'Octubre',
	'Noviembre',
	'Diciembre'
];

export function getMesLabel(mes: number): string {
	return MESES_LABELS[mes] || '';
}

export function formatCOP(valor: number): string {
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(valor);
}

// ═══ Auth ═══

function getAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (browser) {
		const token = localStorage.getItem('transmeralda_token');
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

// ═══ API Client ═══

export const liquidacionesServiciosAPI = {
	// ── Tarifas (operadoras) ──
	async obtenerTarifas(operadora?: OperadoraTarifa, anio?: number): Promise<TarifaServicio[]> {
		const params = new URLSearchParams();
		if (operadora) params.set('operadora', operadora);
		if (anio) params.set('anio', String(anio));

		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/tarifas?${params.toString()}`, {
			headers: getAuthHeaders()
		});
		if (!res.ok) {
			const json = await res.json();
			throw new Error(json.error || 'Error al obtener tarifas');
		}
		return await res.json();
	},

	async crearTarifa(data: TarifaInput): Promise<TarifaServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/tarifas`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al crear tarifa');
		return json;
	},

	async actualizarTarifa(id: string, data: Partial<TarifaInput>): Promise<TarifaServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/tarifas/${id}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al actualizar tarifa');
		return json;
	},

	async eliminarTarifa(id: string): Promise<void> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/tarifas/${id}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});
		if (!res.ok) {
			const json = await res.json();
			throw new Error(json.error || 'Error al eliminar tarifa');
		}
	},

	// ── Preview ──
	async preview(
		cliente_id: string,
		mes: number,
		anio: number,
		servicioIds?: string[],
		tarifa_id?: string
	): Promise<PreviewLiquidacion> {
		const params = new URLSearchParams({
			cliente_id,
			mes: String(mes),
			anio: String(anio)
		});
		if (servicioIds && servicioIds.length > 0) {
			params.set('servicio_ids', servicioIds.join(','));
		}
		if (tarifa_id) {
			params.set('tarifa_id', tarifa_id);
		}

		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/preview?${params.toString()}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al generar preview');
		return json;
	},

	// ── Servicios disponibles ──
	async serviciosDisponibles(
		cliente_id: string,
		mes: number,
		anio: number
	): Promise<ServicioDisponible[]> {
		const params = new URLSearchParams({
			cliente_id,
			mes: String(mes),
			anio: String(anio)
		});

		const res = await fetch(
			`${API_URL}/api/liquidaciones-servicios/servicios-disponibles?${params.toString()}`,
			{ headers: getAuthHeaders() }
		);
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener servicios');
		return json;
	},

	// ── CRUD Liquidaciones ──
	async listar(filtros: Record<string, any> = {}): Promise<{
		liquidaciones: LiquidacionServicio[];
		total: number;
		totalPages: number;
		page: number;
		metadata: {
			globalTotal: number;
			globalCount: number;
			estadoCounts: Record<string, number>;
			clientes: { id: string; nombre: string }[];
			liquidadores: { id: string; nombre: string }[];
			consecutivos: string[];
			periodos: { mes: number; anio: number }[];
			facturas: string[];
			estados: string[];
			placas: string[];
		};
	}> {
		const params = new URLSearchParams();
		Object.entries(filtros).forEach(([key, val]) => {
			if (val !== undefined && val !== '') params.set(key, String(val));
		});

		const res = await fetch(`${API_URL}/api/liquidaciones-servicios?${params.toString()}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al listar liquidaciones');
		return json;
	},

	async crear(data: CrearLiquidacionInput): Promise<LiquidacionServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al crear liquidación');
		return json;
	},

	async obtenerPorId(id: string): Promise<LiquidacionServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${id}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener liquidación');
		return json;
	},

	async actualizar(id: string, data: CrearLiquidacionInput): Promise<LiquidacionServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${id}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al actualizar liquidación');
		return json;
	},

	async eliminar(id: string): Promise<void> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${id}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});
		if (!res.ok) {
			const json = await res.json();
			throw new Error(json.error || 'Error al eliminar liquidación');
		}
	},

	async cambiarEstado(
		id: string,
		estado: EstadoLiquidacionServicio,
		motivo_anulacion?: string
	): Promise<LiquidacionServicio> {
		const body: any = { estado };
		if (motivo_anulacion) body.motivo_anulacion = motivo_anulacion;
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${id}/estado`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify(body)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al cambiar estado');
		return json;
	},

	async estadisticas(): Promise<{
		total: number;
		por_estado: { estado: EstadoLiquidacionServicio; cantidad: number }[];
		monto_total: number;
	}> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/estadisticas`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener estadísticas');
		return json;
	},

	async obtenerTiposRecargo(): Promise<TipoRecargo[]> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/tipos-recargo`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener tipos de recargo');
		return json;
	},

	async obtenerHistorial(liquidacionId: string): Promise<HistorialEstado[]> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${liquidacionId}/historial`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener historial');
		return json;
	},

	async obtenerCSV(liquidacionId: string): Promise<Blob> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/${liquidacionId}/csv`, {
			headers: getAuthHeaders()
		});

		if (!res.ok) {
			const json = await res.json();
			throw new Error(json.error || 'Error al obtener Excel');
		}
		return await res.blob();
	},

	// ── Configuración Liquidador de Servicios ──

	async obtenerConfigLiquidador(): Promise<ConfigLiquidadorServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/config-liquidador`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener configuración');
		return json;
	},

	async actualizarConfigLiquidador(
		data: Partial<Omit<ConfigLiquidadorServicio, 'id'>>
	): Promise<ConfigLiquidadorServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/config-liquidador`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al actualizar configuración');
		return json;
	},

	async checkConsecutivo(consecutivo: string, excludeId?: string): Promise<{ available: boolean }> {
		const qs = excludeId ? `?excludeId=${excludeId}` : '';
		const res = await fetch(
			`${API_URL}/api/liquidaciones-servicios/check-consecutivo/${encodeURIComponent(consecutivo)}${qs}`,
			{
				headers: getAuthHeaders()
			}
		);
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al verificar consecutivo');
		return json;
	}
};

// ═══ API Liquidaciones Terceros (historial) ═══

export interface TerceroItemHistorial {
	id: string;
	tercero_id?: string | null;
	item_id?: string | null;
	placa: string;
	recorrido: string;
	fechas: string;
	valor_unitario: number;
	cantidad: number;
	total_facturado: number;
	porcentaje_admin: number;
	valor_admin: number;
	valor_liquidar: number;
	ingreso_extra_global: number;
	ingresos_extra_aval: number;
	ingreso_empresa: number;
	src_index: number;
	orden: number;
	tercero?: {
		id: string;
		nombre_completo: string;
		identificacion: string;
		tipo_persona: string;
	} | null;
	item?: { id: string; numero_planilla: string | null } | null;
	liquidacion?: {
		id: string;
		consecutivo: string;
		mes: number;
		anio: number;
		estado: string;
		osi?: string;
		tercero_liquidado?: boolean;
		cliente?: { id: string; nombre: string; nit: string };
		factura_items?: Array<{ factura: { id: string; numero_factura: string; estado: string } }>;
	};
}

export interface TerceroHistorialResponse {
	items: TerceroItemHistorial[];
	total: number;
	totalPages: number;
	page: number;
}

export const liquidacionesTercerosAPI = {
	async listarHistorial(
		filtros: Record<string, string | number>
	): Promise<TerceroHistorialResponse> {
		const params = new URLSearchParams();
		for (const [k, v] of Object.entries(filtros)) {
			if (v !== '' && v !== undefined && v !== null) params.set(k, String(v));
		}
		const res = await fetch(`${API_URL}/api/liquidaciones-terceros?${params}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al listar historial terceros');
		return json;
	},

	async migrar(): Promise<any> {
		const res = await fetch(`${API_URL}/api/liquidaciones-terceros/migrar`, {
			method: 'POST',
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al migrar');
		return json;
	}
};

/** Lo que devuelve el autoguardado. Mínimo a propósito: corre cada pocos segundos. */
export interface RespuestaAutoguardado {
	id: string;
	consecutivo: string;
	estado: EstadoLiquidacionServicio;
	version: number;
	updated_at: string;
	creada: boolean;
}

/** Un 409 del autoguardado, ya desmenuzado. */
export interface ConflictoAutoguardado {
	/// `version`: otro guardó encima. `estado`: dejó de ser un borrador.
	/// `borrada`: ya no existe. Cada uno se resuelve distinto, por eso el
	/// backend los distingue en vez de devolver un 409 a secas.
	motivo: 'version' | 'estado' | 'borrada';
	servidor: {
		id: string;
		consecutivo: string;
		estado: EstadoLiquidacionServicio;
		version: number;
		updated_at: string;
		actualizado_por?: { id: string; nombre: string } | null;
	} | null;
}

export class ErrorConflictoAutoguardado extends Error {
	constructor(
		message: string,
		public conflicto: ConflictoAutoguardado
	) {
		super(message);
		this.name = 'ErrorConflictoAutoguardado';
	}
}

/**
 * Autoguardado y borrador previo.
 *
 * Aparte de `liquidacionesServiciosAPI` porque no son operaciones de negocio:
 * no notifican, no cambian de estado y no dejan rastro en el historial. Ver el
 * porqué en `LiquidacionesServiciosController.autoguardar` del backend.
 */
export const autoguardadoAPI = {
	/**
	 * Crea o actualiza la liquidación real en BORRADOR.
	 *
	 * @param cliente_key clave de idempotencia, una por sesión de edición: sin
	 * ella, dos peticiones en vuelo a la vez crean dos liquidaciones.
	 */
	async guardar(
		body: CrearLiquidacionInput & {
			cliente_key?: string | null;
			borrador_id?: string | null;
			base_version?: number | null;
		}
	): Promise<RespuestaAutoguardado> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/autoguardado`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(body)
		});
		const json = await res.json();
		if (res.status === 409) {
			throw new ErrorConflictoAutoguardado(json.error || 'Conflicto', {
				motivo: json.motivo,
				servidor: json.servidor ?? null
			});
		}
		if (!res.ok) throw new Error(json.error || 'Error al autoguardar');
		return json;
	},

	/**
	 * Guarda el borrador previo, el de cuando la fila todavía no puede existir.
	 * `liquidacionId = null` es el borrador «nuevo» del usuario.
	 */
	async guardarDraft(liquidacionId: string | null, payload: unknown): Promise<{ ok: boolean }> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/draft`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ liquidacion_id: liquidacionId, payload })
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al guardar el borrador');
		return json;
	},

	/** `null` si no hay borrador; no tenerlo es lo normal, no un error. */
	async obtenerDraft(
		liquidacionId: string | null
	): Promise<{ payload: any; version: number; updated_at: string } | null> {
		const ruta = liquidacionId
			? `/api/liquidaciones-servicios/${liquidacionId}/draft`
			: '/api/liquidaciones-servicios/draft';
		const res = await fetch(`${API_URL}${ruta}`, { headers: getAuthHeaders() });
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al leer el borrador');
		return json;
	},

	async eliminarDraft(liquidacionId: string | null): Promise<void> {
		const ruta = liquidacionId
			? `/api/liquidaciones-servicios/${liquidacionId}/draft`
			: '/api/liquidaciones-servicios/draft';
		await fetch(`${API_URL}${ruta}`, { method: 'DELETE', headers: getAuthHeaders() });
	},

	/**
	 * Último intento al cerrar la pestaña.
	 *
	 * `keepalive` y no `sendBeacon`: el backend exige `Authorization: Bearer` en
	 * cabecera y beacon no admite cabeceras. `keepalive` sí, y sobrevive a la
	 * descarga del documento — con un límite de 64 KB de cuerpo, que para una
	 * liquidación muy grande puede quedarse corto. Por eso NO es la red de
	 * seguridad principal: lo son el debounce corto y el flush al desmontar.
	 */
	guardarAlSalir(body: unknown): void {
		try {
			void fetch(`${API_URL}/api/liquidaciones-servicios/autoguardado`, {
				method: 'POST',
				headers: getAuthHeaders(),
				body: JSON.stringify(body),
				keepalive: true
			});
		} catch {
			// Cerrando la pestaña: no hay a quién avisar.
		}
	}
};

/**
 * Catálogo de operadoras.
 *
 * Aparte de `liquidacionesServiciosAPI` porque es un catálogo propio, no una
 * operación sobre liquidaciones — y porque su `DELETE` no siempre borra.
 */
export const operadorasAPI = {
	/**
	 * @param incluirInactivas Las retiradas. El `<select>` del editor las
	 * necesita para no perder en silencio la operadora de una liquidación vieja
	 * cuya operadora se retiró después.
	 */
	async listar(incluirInactivas = false): Promise<Operadora[]> {
		const params = incluirInactivas ? '?incluir_inactivas=true' : '';
		const res = await fetch(`${API_URL}/api/operadoras${params}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al listar operadoras');
		return json;
	},

	async crear(data: { codigo: string; nombre: string; orden?: number }): Promise<Operadora> {
		const res = await fetch(`${API_URL}/api/operadoras`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al crear la operadora');
		return json;
	},

	async actualizar(
		id: string,
		data: Partial<Pick<Operadora, 'codigo' | 'nombre' | 'activo' | 'orden'>>
	): Promise<Operadora> {
		const res = await fetch(`${API_URL}/api/operadoras/${id}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al actualizar la operadora');
		return json;
	},

	/**
	 * Borra la operadora, o la retira si ya tiene liquidaciones.
	 *
	 * Devuelve QUÉ hizo para que la interfaz no diga «eliminada» cuando en
	 * realidad la desactivó: vaciar la operadora de las liquidaciones históricas
	 * sería perder a quién se le atribuyó el servicio, así que el backend nunca
	 * lo hace.
	 */
	async eliminar(
		id: string
	): Promise<{ accion: 'eliminada' | 'desactivada'; liquidaciones: number }> {
		const res = await fetch(`${API_URL}/api/operadoras/${id}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al eliminar la operadora');
		return json;
	}
};
