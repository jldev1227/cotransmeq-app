// src/lib/types/recargos.ts

export interface TipoRecargo {
	id: string;
	codigo: string;
	nombre: string;
	porcentaje: number;
	es_valor_fijo: boolean;
	valor_fijo?: number;
	activo: boolean;
	descripcion?: string;
	created_at: Date;
	updated_at: Date;
}

export interface DetalleRecargosDia {
	id: string;
	dia_laboral_id: string;
	tipo_recargo_id: string;
	horas: number;
	tipoRecargo?: TipoRecargo;
	created_at: Date;
	updated_at: Date;
}

export interface DiaLaboralPlanilla {
	id: string;
	recargo_planilla_id: string;
	dia: number;
	hora_inicio: number | null;
	hora_fin: number | null;
	total_horas: number;
	es_festivo: boolean;
	observaciones?: string;
	detallesRecargos?: DetalleRecargosDia[];
	created_at: Date;
	updated_at: Date;
}

export interface RecargoPlanilla {
	id: string;
	conductor_id: string;
	vehiculo_id: string;
	empresa_id: string;
	numero_planilla?: string;
	mes: number;
	año: number;
	estado: 'pendiente' | 'liquidada' | 'facturada';
	archivo_planilla_url?: string;
	archivo_planilla_nombre?: string;
	archivo_planilla_tipo?: string;
	total_horas_trabajadas: number;
	total_dias: number;
	total_hed: number;
	total_hen: number;
	total_hefd: number;
	total_hefn: number;
	total_rn: number;
	total_rd: number;
	observaciones?: string;
	creado_por_id?: string;
	actualizado_por_id?: string;
	version: number;
	dias_laborales?: DiaLaboralPlanilla[];
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion?: string;
		telefono?: string;
		foto_url?: string;
	};
	vehiculo?: {
		id: string;
		placa: string;
		marca?: string;
		modelo?: string;
	};
	empresa?: {
		id: string;
		nombre: string;
		nit?: string;
	};
	created_at: Date;
	updated_at: Date;
}

export interface CanvasRecargo {
	id: string;
	conductor_id: string;
	vehiculo_id: string;
	empresa_id: string;
	numero_planilla?: string;
	mes: number;
	año: number;
	estado: string;
	total_horas: number;
	total_dias: number;
	total_hed: number;
	total_hen: number;
	total_hefd: number;
	total_hefn: number;
	total_rn: number;
	total_rd: number;
	dias_laborales?: DiaLaboralPlanilla[];
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion?: string;
	};
	vehiculo?: {
		id: string;
		placa: string;
	};
	empresa?: {
		id: string;
		nombre: string;
	};
}

export interface RecargoPlanillaFiltros {
	conductor_id?: string;
	vehiculo_id?: string;
	empresa_id?: string;
	mes?: number;
	año?: number;
	estado?: string;
	numero_planilla?: string;
	page?: number;
	limit?: number;
}

export interface RecargoPlanillaResponse {
	success: boolean;
	data: RecargoPlanilla[];
	pagination?: {
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	};
	message?: string;
}

export interface HistorialRecargo {
	id: string;
	recargo_planilla_id: string;
	accion: 'creacion' | 'actualizacion' | 'eliminacion';
	version_anterior: number;
	version_nueva: number;
	datos_anteriores?: any;
	datos_nuevos?: any;
	campos_modificados?: string[];
	motivo?: string;
	realizado_por_id?: string;
	usuario?: {
		id: string;
		nombre: string;
		apellido: string;
		email: string;
	};
	ip_usuario?: string;
	user_agent?: string;
	created_at: string;
	fecha_accion: Date;
}

export interface RecargoDetallado {
	id: string;
	conductor_id: string;
	vehiculo_id: string;
	empresa_id: string;
	numero_planilla?: string;
	mes: number;
	año: number;
	estado: 'pendiente' | 'liquidada' | 'facturada';
	archivo_planilla_url?: string;
	archivo_planilla_nombre?: string;
	planilla_s3key?: string;
	total_horas_trabajadas: number;
	total_dias: number;
	total_horas: number;
	total_hed: number;
	total_hen: number;
	total_hefd: number;
	total_hefn: number;
	total_rn: number;
	total_rd: number;
	observaciones?: string;
	version: number;
	dias_laborales: Array<{
		id: string;
		dia: number;
		hora_inicio: string;
		hora_fin: string;
		total_horas: number;
		es_especial: boolean;
		es_domingo: boolean;
		es_festivo: boolean;
		hed: number;
		hen: number;
		hefd: number;
		hefn: number;
		rn: number;
		rd: number;
	}>;
	conductor: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
		telefono?: string;
		foto_url?: string;
	};
	vehiculo: {
		id: string;
		placa: string;
		marca?: string;
		modelo?: string;
	};
	empresa: {
		id: string;
		nombre: string;
		nit: string;
	};
	auditoria: {
		version: number;
		creado_por: {
			id: string;
			nombre: string;
			apellido: string;
			email: string;
		};
		created_at: string;
		actualizado_por?: {
			id: string;
			nombre: string;
			apellido: string;
			email: string;
		};
		updated_at: string;
	};
	historial: HistorialRecargo[];
}

export interface ConfiguracionSalario {
	id: string;
	empresa_id: string;
	valor_hora_trabajador: number;
	activo: boolean;
	fecha_vigencia: Date;
	empresa?: {
		id: string;
		nombre: string;
	};
}

export interface CrearRecargoPlanillaDTO {
	conductor_id: string;
	vehiculo_id: string;
	empresa_id: string;
	numero_planilla?: string;
	mes: number;
	año: number;
	archivo?: File;
	observaciones?: string;
	dias_laborales: Array<{
		dia: number;
		hora_inicio: number | null;
		hora_fin: number | null;
		es_festivo: boolean;
		observaciones?: string;
	}>;
}

export interface ActualizarRecargoPlanillaDTO {
	numero_planilla?: string;
	observaciones?: string;
	estado?: 'pendiente' | 'liquidada' | 'facturada';
	dias_laborales?: Array<{
		id?: string;
		dia: number;
		hora_inicio: number | null;
		hora_fin: number | null;
		es_festivo: boolean;
		observaciones?: string;
	}>;
}
