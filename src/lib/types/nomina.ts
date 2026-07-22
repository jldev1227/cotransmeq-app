/**
 * Tipos TypeScript para el módulo de Nómina
 */

// ==================== ENTIDADES BASE ====================

export interface Conductor {
	apellido: string;
	id: string;
	nombre: string;
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

export interface FirmaPrima {
	id: string;
	prima_id: string;
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

export interface FirmaPrimaConUrl extends FirmaPrima {
	presignedUrl?: string;
	origen?: 'prima' | 'nomina';
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
	tiene_ajuste: boolean;
	ajuste_por_dia_flag: boolean;
	ajuste_parex: boolean;
	ajuste_recargos_config?: {
		mode: 'empresas' | 'total';
		empresa_ids: string[];
		porcentaje: number;
		detalle?: {
			empresa_id: string;
			empresa_nombre: string;
			total_recargos: number;
			ajuste: number;
		}[];
	} | null;
	no_descontar_salud: boolean;
	no_descontar_pension: boolean;
	descontar_transporte: boolean;

	// Conceptos adicionales
	conceptos_adicionales?: ConceptoAdicional[];
	total_conceptos_adicionales_devengados: number;
	total_conceptos_adicionales_deducciones: number;

	// Totales
	total_devengado: number;
	total_deducido: number;
	neto_pagado: number;
	sueldo_total?: number;

	// Valor ajuste parex (legado)
	ajuste_parex_valor?: number;

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

	// Vacaciones/Incapacidad (aliases del backend)
	total_vacaciones?: number;
	valor_incapacidad?: number;
	periodo_start_vacaciones?: string;
	periodo_end_vacaciones?: string;
	periodo_start_incapacidad?: string;
	periodo_end_incapacidad?: string;
	ajuste_salarial?: number;
	disponibilidad?: number;

	// Flag adicional
	es_cotransmeq?: boolean;

	// Visibilidad portal conductor
	desprendible_visible?: boolean;

	// Visibilidad de tabla recargos conductor
	mostrar_recargos?: boolean;
}

// ==================== CONFIGURACIÓN ====================

export interface ConfiguracionLiquidacion {
	id: string;
	nombre: string;
	valor: number;
	tipo: string;
	activo: boolean;
	anio: number;
	created_at?: string;
	updated_at?: string;
}

// ==================== DTOs PARA CREAR/ACTUALIZAR ====================

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

	// Salarios
	salario_base: number;
	salario_villanueva: number;
	salario_anual: number;

	// Días laborados
	dias_laborados: number;
	dias_laborados_villanueva: number;
	dias_laborados_anual: number;

	// Flags
	tiene_vacaciones: boolean;
	tiene_incapacidad: boolean;
	tiene_cesantias: boolean;
	tiene_ajuste: boolean;
	ajuste_por_dia_flag: boolean;
	ajuste_parex: boolean;
	ajuste_recargos_config?: {
		mode: 'empresas' | 'total';
		empresa_ids: string[];
		porcentaje: number;
		detalle?: {
			empresa_id: string;
			empresa_nombre: string;
			total_recargos: number;
			ajuste: number;
		}[];
	} | null;
	no_descontar_salud: boolean;
	no_descontar_pension: boolean;
	descontar_transporte: boolean;

	// Períodos especiales
	periodo_vacaciones_inicio?: string;
	periodo_vacaciones_fin?: string;
	periodo_incapacidad_inicio?: string;
	periodo_incapacidad_fin?: string;

	// Ajustes
	ajuste_valor?: number;
	ajuste_por_dia?: number;
	ajuste_parex_valor?: number;

	// Prestaciones
	cesantias?: number;
	interes_cesantias?: number;

	// Conceptos adicionales
	conceptos_adicionales?: ConceptoAdicional[];

	// Detalles de vehículos
	vehiculos: string[];
	detalles_vehiculos: VehiculoDetalle[];

	// Anticipos
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

// ============================================================
// PRIMAS (entidad independiente)
// ============================================================

export type PrimaEstado = 'Pendiente' | 'Pagado';

export interface Prima {
	id: string;
	conductor_id: string;
	conductor?: {
		id?: string;
		nombre?: string;
		apellido?: string;
		cedula?: string;
		numero_identificacion?: string;
		email?: string;
	};
	mes: number; // 1-12
	anio: number; // YYYY
	prima: number;
	prima_pendiente?: number | null;

	// Campos manuales del desprendible de prima
	tiempo_trabajado_dias?: number | null;
	sueldo_basico?: number | null;
	auxilio_transporte?: number | null;
	sueldo_variable?: number | null;
	total_base_liquidacion?: number | null;

	estado: PrimaEstado;
	observaciones?: string | null;
	creado_por?: { id?: string; nombre?: string; apellido?: string };
	actualizado_por?: { id?: string; nombre?: string; apellido?: string };
	created_at?: string;
	updated_at?: string;
	deleted_at?: string | null;
	firmas_primas?: FirmaPrima[];
	firmado?: boolean;
}

export interface CreatePrimaPayload {
	conductor_id: string;
	mes: number;
	anio: number;
	prima: number;
	prima_pendiente?: number | null;

	// Campos manuales del desprendible de prima
	tiempo_trabajado_dias?: number | null;
	sueldo_basico?: number | null;
	auxilio_transporte?: number | null;
	sueldo_variable?: number | null;
	total_base_liquidacion?: number | null;

	estado?: PrimaEstado;
	observaciones?: string | null;
}

export type UpdatePrimaPayload = Partial<CreatePrimaPayload>;

export interface PrimasParams {
	page?: number;
	limit?: number;
	search?: string;
	mes?: number;
	anio?: number;
	estado?: PrimaEstado;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
}

export interface PrimasStats {
	total: number;
	totalPendientes: number;
	totalPagados: number;
	montoTotal: number;
}
