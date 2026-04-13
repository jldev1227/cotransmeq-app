import { apiClient } from './apiClient';

// ═══ Tipos ═══

export type TipoServicioTarifa = 'HORA_24' | 'HORA_12' | 'HORA' | 'KILOMETRO';
export type EstadoLiquidacionServicio = 'BORRADOR' | 'LIQUIDADA' | 'APROBADA' | 'FACTURADA' | 'ANULADA';
export type Operadora = string;

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
	APROBADA: { label: 'Aprobada', color: 'orange' },
	FACTURADA: { label: 'Facturada', color: 'emerald' },
	ANULADA: { label: 'Anulada', color: 'red' }
};

// ═══ Interfaces ═══

export interface TarifaServicio {
	id: string;
	cliente_id: string;
	operadora: string | null;
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
	cliente_id: string;
	operadora?: string;
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
	tercero_id?: string | null;
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
	created_at: string;
}

export interface PreviewLiquidacion {
	cliente: { id: string; nombre: string; nit: string };
	tarifa: {
		id: string;
		operadora: string;
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

// ═══ API Client (axios) ═══

export const liquidacionesServiciosAPI = {
	// ── Tarifas ──
	async obtenerTarifas(operadora?: string, anio?: number): Promise<TarifaServicio[]> {
		const params: any = {};
		if (operadora) params.operadora = operadora;
		if (anio) params.anio = anio;
		const res = await apiClient.get('/api/liquidaciones-servicios/tarifas', { params });
		return res.data;
	},

	async crearTarifa(data: TarifaInput): Promise<TarifaServicio> {
		const res = await apiClient.post('/api/liquidaciones-servicios/tarifas', data);
		return res.data;
	},

	async actualizarTarifa(id: string, data: Partial<TarifaInput>): Promise<TarifaServicio> {
		const res = await apiClient.put(`/api/liquidaciones-servicios/tarifas/${id}`, data);
		return res.data;
	},

	async eliminarTarifa(id: string): Promise<void> {
		await apiClient.delete(`/api/liquidaciones-servicios/tarifas/${id}`);
	},

	// ── Preview ──
	async preview(
		cliente_id: string,
		mes: number,
		anio: number,
		servicioIds?: string[],
		tarifa_id?: string
	): Promise<PreviewLiquidacion> {
		const res = await apiClient.post('/api/liquidaciones-servicios/preview', {
			cliente_id,
			mes,
			anio,
			servicio_ids: servicioIds,
			tarifa_id,
		});
		return res.data;
	},

	// ── Servicios disponibles ──
	async serviciosDisponibles(
		cliente_id: string,
		mes: number,
		anio: number
	): Promise<ServicioDisponible[]> {
		const res = await apiClient.get('/api/liquidaciones-servicios/servicios-disponibles', {
			params: { cliente_id, mes, anio }
		});
		return res.data;
	},

	// ── CRUD Liquidaciones ──
	async listar(filtros: Record<string, any> = {}): Promise<{
		liquidaciones: LiquidacionServicio[];
		total: number;
		totalPages: number;
		page: number;
	}> {
		const params: any = {};
		Object.entries(filtros).forEach(([key, val]) => {
			if (val !== undefined && val !== '') params[key] = val;
		});
		const res = await apiClient.get('/api/liquidaciones-servicios', { params });
		return res.data;
	},

	async crear(data: CrearLiquidacionInput): Promise<LiquidacionServicio> {
		const res = await apiClient.post('/api/liquidaciones-servicios', data);
		return res.data;
	},

	async obtenerPorId(id: string): Promise<LiquidacionServicio> {
		const res = await apiClient.get(`/api/liquidaciones-servicios/${id}`);
		return res.data;
	},

	async actualizar(id: string, data: CrearLiquidacionInput): Promise<LiquidacionServicio> {
		const res = await apiClient.put(`/api/liquidaciones-servicios/${id}`, data);
		return res.data;
	},

	async eliminar(id: string): Promise<void> {
		await apiClient.delete(`/api/liquidaciones-servicios/${id}`);
	},

	async cambiarEstado(id: string, estado: EstadoLiquidacionServicio, motivo_anulacion?: string): Promise<LiquidacionServicio> {
		const body: any = { estado };
		if (motivo_anulacion) body.motivo_anulacion = motivo_anulacion;
		const res = await apiClient.patch(`/api/liquidaciones-servicios/${id}/estado`, body);
		return res.data;
	},

	async estadisticas(): Promise<{
		total: number;
		por_estado: { estado: EstadoLiquidacionServicio; cantidad: number }[];
		monto_total: number;
	}> {
		const res = await apiClient.get('/api/liquidaciones-servicios/estadisticas');
		return res.data;
	},

	async obtenerTiposRecargo(): Promise<TipoRecargo[]> {
		const res = await apiClient.get('/api/liquidaciones-servicios/tipos-recargo');
		return res.data;
	},

	async obtenerHistorial(liquidacionId: string): Promise<HistorialEstado[]> {
		const res = await apiClient.get(`/api/liquidaciones-servicios/${liquidacionId}/historial`);
		return res.data;
	},

	// ── Configuración Liquidador de Servicios ──

	async obtenerConfigLiquidador(): Promise<ConfigLiquidadorServicio> {
		const res = await apiClient.get('/api/liquidaciones-servicios/config-liquidador');
		return res.data;
	},

	async actualizarConfigLiquidador(data: Partial<Omit<ConfigLiquidadorServicio, 'id'>>): Promise<ConfigLiquidadorServicio> {
		const res = await apiClient.put('/api/liquidaciones-servicios/config-liquidador', data);
		return res.data;
	}
};
