/**
 * Tipos TypeScript para el módulo de Nómina - Cotransmeq
 */

// ==================== ENTIDADES BASE ====================

export interface Conductor {
	id: string;
	nombre: string;
	apellido?: string;
	cedula: string;
	telefono?: string;
	email?: string;
	direccion?: string;
	fecha_ingreso?: string;
	estado?: string;
	salario_base?: number;
	cargo?: string;
	created_at?: string;
	updated_at?: string;
}

export interface Vehiculo {
	id: string;
	placa: string;
	modelo?: string;
	marca?: string;
	año?: number;
	tipo?: string;
	estado?: string;
	conductor_id?: string;
	conductor?: Conductor;
	created_at?: string;
	updated_at?: string;
}

export interface Empresa {
	id: string;
	nombre: string;
	nit?: string;
	direccion?: string;
	telefono?: string;
	email?: string;
	created_at?: string;
	updated_at?: string;
}

// ==================== COMPONENTES DE LIQUIDACIÓN ====================

export interface Bonificacion {
	id?: string;
	name: string;
	values: any[];
	value: number;
	vehiculo_id: string;
	liquidacion_id?: string;
	vehiculo?: { id: string; placa: string; marca?: string; modelo?: string };
}

export interface Pernote {
	id?: string;
	empresa_id: string;
	cantidad: number;
	valor: number;
	fechas: string[];
	vehiculo_id: string;
	liquidacion_id?: string;
	empresa?: Empresa;
	clientes?: { id: string; nombre: string };
	vehiculo?: { id: string; placa: string; marca?: string; modelo?: string };
}

export interface Recargo {
	id?: string;
	empresa_id: string;
	valor: number;
	pag_cliente: boolean;
	vehiculo_id: string;
	mes: string;
	liquidacion_id?: string;
	empresa?: Empresa;
	clientes?: { id: string; nombre: string };
	vehiculo?: { id: string; placa: string; marca?: string; modelo?: string };
}

export interface Mantenimiento {
	id?: string;
	values: { mes: string; quantity: number }[];
	value: number;
	vehiculo_id?: string;
	vehiculoId?: string;
	liquidacion_id?: string;
}

export interface Anticipo {
	id?: string;
	valor: number;
	fecha: string;
	concepto?: string;
	conductor_id?: string;
	liquidacion_id?: string;
	observaciones?: string;
}

export interface ConceptoAdicional {
	concepto: string;
	valor: number;
	tipo: 'devengado' | 'deduccion';
}

// ==================== FIRMAS ====================

export interface FirmaDesprendible {
	id: string;
	liquidacion_id: string;
	conductor_id: string;
	firma_url: string;
	firma_s3_key: string;
	ip_address?: string;
	user_agent?: string;
	fecha_firma: string;
	hash_firma?: string;
	estado: string;
	observaciones?: string;
	created_at?: string;
	updated_at?: string;
}

export interface FirmaConUrl extends FirmaDesprendible {
	presignedUrl?: string;
}

// ==================== USUARIO (auditoría) ====================

export interface UsuarioResumen {
	id: string;
	nombre: string;
	apellido?: string;
	email?: string;
}

// ==================== LIQUIDACIÓN ====================

export interface Liquidacion {
	id: string;
	conductor_id: string;
	periodo_inicio: string;
	periodo_fin: string;

	// Estado
	estado?: string;
	fecha_liquidacion?: string;

	// Salarios
	salario_devengado: number;
	salario_base: number;
	salario_villanueva: number;
	salario_anual: number;

	// Días laborados
	dias_laborados: number;
	dias_laborados_villanueva: number;
	dias_laborados_anual: number;

	// Devengados
	total_bonificaciones: number;
	total_pernotes: number;
	total_recargos: number;
	auxilio_transporte: number;

	// Deducciones
	total_mantenimientos: number;
	total_anticipos: number;
	salud: number;
	pension: number;

	// Prestaciones
	cesantias?: number;
	interes_cesantias?: number;
	prima?: number;
	prima_pendiente?: number;

	// Ajustes
	ajuste_valor?: number;
	ajuste_por_dia?: number;

	// Períodos especiales
	periodo_vacaciones_inicio?: string;
	periodo_vacaciones_fin?: string;
	periodo_incapacidad_inicio?: string;
	periodo_incapacidad_fin?: string;

	// Flags
	tiene_vacaciones: boolean;
	tiene_incapacidad: boolean;
	tiene_cesantias: boolean;
	tiene_prima: boolean;
	tiene_ajuste: boolean;
	ajuste_por_dia_flag: boolean;
	ajuste_parex: boolean;
	no_descontar_salud: boolean;
	no_descontar_pension: boolean;
	descontar_transporte: boolean;
	es_cotransmeq?: boolean;

	// Conceptos adicionales
	conceptos_adicionales?: ConceptoAdicional[];
	total_conceptos_adicionales_devengados: number;
	total_conceptos_adicionales_deducciones: number;

	// Totales
	total_devengado: number;
	total_deducido: number;
	neto_pagado: number;
	sueldo_total?: number;

	// Relaciones
	conductor?: Conductor;
	vehiculos?: Vehiculo[];
	bonificaciones?: Bonificacion[];
	pernotes?: Pernote[];
	recargos?: Recargo[];
	mantenimientos?: Mantenimiento[];
	anticipos?: Anticipo[];
	firmas_desprendibles?: FirmaDesprendible[];

	// Auditoría
	creado_por_id?: string;
	actualizado_por_id?: string;
	liquidado_por_id?: string;
	creado_por?: UsuarioResumen;
	actualizado_por?: UsuarioResumen;
	liquidado_por?: UsuarioResumen;
	observaciones?: string;

	// Metadata
	created_at?: string;
	updated_at?: string;

	// Vacaciones/Incapacidad
	total_vacaciones?: number;
	valor_incapacidad?: number;
	periodo_start_vacaciones?: string;
	periodo_end_vacaciones?: string;
	periodo_start_incapacidad?: string;
	periodo_end_incapacidad?: string;
	ajuste_salarial?: number;
}

// ==================== CONFIGURACIÓN ====================

export interface ConfiguracionLiquidacion {
	id: string;
	salario_minimo: number;
	auxilio_transporte: number;
	porcentaje_salud: number;
	porcentaje_pension: number;
	porcentaje_cesantias: number;
	porcentaje_interes_cesantias: number;
	porcentaje_prima: number;
	valor_mantenimiento: number;
	valor_pernote: number;
	dias_anio: number;
	created_at?: string;
	updated_at?: string;
}

// ==================== DTOs ====================

export interface VehiculoDetalle {
	vehiculo: {
		value: string;
		label: string;
	};
	bonos: Bonificacion[];
	mantenimientos: Mantenimiento[];
	pernotes: Pernote[];
	recargos: Recargo[];
}

export interface CreateLiquidacionPayload {
	conductor_id: string;
	periodo_inicio: string;
	periodo_fin: string;
	salario_base: number;
	salario_villanueva: number;
	salario_anual: number;
	dias_laborados: number;
	dias_laborados_villanueva: number;
	dias_laborados_anual: number;
	tiene_vacaciones: boolean;
	tiene_incapacidad: boolean;
	tiene_cesantias: boolean;
	tiene_prima: boolean;
	tiene_ajuste: boolean;
	ajuste_por_dia_flag: boolean;
	ajuste_parex: boolean;
	no_descontar_salud: boolean;
	no_descontar_pension: boolean;
	descontar_transporte: boolean;
	periodo_vacaciones_inicio?: string;
	periodo_vacaciones_fin?: string;
	periodo_incapacidad_inicio?: string;
	periodo_incapacidad_fin?: string;
	ajuste_valor?: number;
	ajuste_por_dia?: number;
	cesantias?: number;
	interes_cesantias?: number;
	prima?: number;
	prima_pendiente?: number;
	conceptos_adicionales?: ConceptoAdicional[];
	vehiculos: string[];
	detalles_vehiculos: VehiculoDetalle[];
	anticipos: Anticipo[];
}

export type UpdateLiquidacionPayload = Partial<CreateLiquidacionPayload> & {
	id?: string;
};

// ==================== OPCIONES DE SELECT ====================

export interface SelectOption {
	value: string;
	label: string;
}

// ==================== RESPUESTAS DE API ====================

export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	message?: string;
	error?: string;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}
