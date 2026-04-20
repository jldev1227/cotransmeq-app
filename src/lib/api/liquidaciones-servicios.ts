import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

// ═══ Tipos ═══

export type TipoServicioTarifa = 'HORA_24' | 'HORA_12' | 'HORA' | 'KILOMETRO';
export type EstadoLiquidacionServicio = 'BORRADOR' | 'LIQUIDADA' | 'APROBADA' | 'FACTURADA' | 'ANULADA';
export type Operadora = 'PAREX' | 'GEOPARK';

export const TIPO_SERVICIO_LABELS: Record<TipoServicioTarifa, string> = {
	HORA_24: '24 Horas',
	HORA_12: '12 Horas',
	HORA: 'Hora',
	KILOMETRO: 'Kilómetro'
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
	operadora: Operadora;
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
	operadora: Operadora;
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
	subtotal: number;
	porcentaje_iva: number;
	valor_iva: number;
	total: number;
	estado: EstadoLiquidacionServicio;
	tercero_liquidado?: boolean;
	motivo_anulacion?: string;
	observaciones?: string;
	osi?: string;
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
		tercero?: { id: string; nombre_completo: string; identificacion: string; tipo_persona: string } | null;
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
	created_at: string;
	updated_at: string;
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
		operadora: Operadora;
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
	'', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
	'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
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
	async obtenerTarifas(
		operadora?: Operadora,
		anio?: number
	): Promise<TarifaServicio[]> {
		const params = new URLSearchParams();
		if (operadora) params.set('operadora', operadora);
		if (anio) params.set('anio', String(anio));

		const res = await fetch(
			`${API_URL}/api/liquidaciones-servicios/tarifas?${params.toString()}`,
			{ headers: getAuthHeaders() }
		);
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

		const res = await fetch(
			`${API_URL}/api/liquidaciones-servicios/preview?${params.toString()}`,
			{ headers: getAuthHeaders() }
		);
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
		};
	}> {
		const params = new URLSearchParams();
		Object.entries(filtros).forEach(([key, val]) => {
			if (val !== undefined && val !== '') params.set(key, String(val));
		});

		const res = await fetch(
			`${API_URL}/api/liquidaciones-servicios?${params.toString()}`,
			{ headers: getAuthHeaders() }
		);
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

	async cambiarEstado(id: string, estado: EstadoLiquidacionServicio, motivo_anulacion?: string): Promise<LiquidacionServicio> {
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

	// ── Configuración Liquidador de Servicios ──

	async obtenerConfigLiquidador(): Promise<ConfigLiquidadorServicio> {
		const res = await fetch(`${API_URL}/api/liquidaciones-servicios/config-liquidador`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error || 'Error al obtener configuración');
		return json;
	},

	async actualizarConfigLiquidador(data: Partial<Omit<ConfigLiquidadorServicio, 'id'>>): Promise<ConfigLiquidadorServicio> {
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
                const res = await fetch(`${API_URL}/api/liquidaciones-servicios/check-consecutivo/${encodeURIComponent(consecutivo)}${qs}`, {
                        headers: getAuthHeaders()
                });
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
	tercero?: { id: string; nombre_completo: string; identificacion: string; tipo_persona: string } | null;
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
	async listarHistorial(filtros: Record<string, string | number>): Promise<TerceroHistorialResponse> {
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