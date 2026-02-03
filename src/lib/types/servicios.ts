// ==================== TIPOS BASE ====================

// Estados de servicio
export type EstadoServicio =
	| 'solicitado'
	| 'en_curso'
	| 'planificado'
	| 'realizado'
	| 'cancelado'
	| 'liquidado'
	| 'planilla_asignada';

// Propósitos de servicio
export type PropositoServicio = 'personal' | 'personal y herramienta';

// Tipos de identificación
export type TipoIdentificacion = 'CC' | 'CE' | 'TI' | 'PA' | 'RC' | 'NIT';

// ==================== INTERFACES PRINCIPALES ====================

// Municipio
export interface Municipio {
	id: string;
	codigo_departamento: number;
	nombre_departamento: string;
	codigo_municipio: number;
	nombre_municipio: string;
	tipo: string;
	longitud: number;
	latitud: number;
	created_at?: string;
	updated_at?: string;
}

// Conductor
export interface Conductor {
	id: string;
	nombre: string;
	apellido: string;
	numero_identificacion?: string;
	tipo_identificacion: TipoIdentificacion;
	telefono?: string;
	email?: string;
	fecha_nacimiento?: string;
	foto_url?: string;
	foto_signed_url?: string;
	estado?: 'activo' | 'inactivo' | 'suspendido';
	documentos?: Documento[];
	created_at?: string;
	updated_at?: string;
}

// Vehículo
export interface Vehiculo {
	id: string;
	placa: string;
	clase_vehiculo: string;
	marca: string;
	linea: string;
	color: string;
	modelo: string;
	tipo?: string;
	estado?: 'activo' | 'inactivo' | 'mantenimiento';
	kilometraje?: number;
	ultima_revision?: string;
	documentos?: Documento[];
	created_at?: string;
	updated_at?: string;
}

// Cliente/Empresa
export interface Cliente {
	id: string;
	nombre: string;
	nit?: string;
	representante?: string;
	paga_recargos: boolean;
	requiere_osi: boolean;
	cedula?: string;
	telefono?: string;
	direccion?: string;
	email?: string;
	estado?: 'activo' | 'inactivo';
	created_at?: string;
	updated_at?: string;
}

// Documento
export interface Documento {
	id: string;
	categoria: string;
	nombre_archivo: string;
	s3_key: string;
	tamano_archivo?: number;
	tipo_mime?: string;
	fecha_vencimiento?: string;
	created_at?: string;
	updated_at?: string;
}

// Usuario
export interface Usuario {
	id: string;
	nombre: string;
	correo: string;
	telefono?: string;
	rol?: string;
	estado?: 'activo' | 'inactivo';
	created_at?: string;
	updated_at?: string;
}

// Cancelación
export interface Cancelacion {
	id: string;
	fecha_cancelacion: string;
	motivo_cancelacion: string;
	observaciones: string;
	created_at: string;
	updated_at: string;
	usuario_cancelacion: Usuario;
}

// Servicio base
export interface Servicio {
	id: string;
	origen_id: string;
	destino_id: string;
	origen_especifico?: string;
	destino_especifico?: string;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id: string;
	estado: EstadoServicio;
	proposito_servicio: PropositoServicio;
	fecha_solicitud: string;
	fecha_realizacion?: string;
	fecha_finalizacion?: string;
	origen_latitud?: number;
	origen_longitud?: number;
	destino_latitud?: number;
	destino_longitud?: number;
	valor: number;
	numero_planilla?: string;
	observaciones?: string;
	share_token?: string; // Token para compartir enlace público
	share_token_expires_at?: string; // Fecha de expiración del token
	created_at?: string;
	updated_at?: string;
	createdAt?: string;
	updatedAt?: string;
}

// Servicio con relaciones cargadas
export interface ServicioConRelaciones extends Servicio {
	origen: Municipio;
	destino: Municipio;
	conductor?: Conductor;
	vehiculo?: Vehiculo;
	cliente: Cliente;
	es_creador?: boolean;
	creador_id?: string;
	cancelacion?: Cancelacion;
}

// ==================== DTOs ====================

// DTO para crear servicio
export interface CreateServicioDTO {
	origen_id: string;
	destino_id: string;
	origen_especifico?: string;
	destino_especifico?: string;
	origen_latitud?: number;
	origen_longitud?: number;
	destino_latitud?: number;
	destino_longitud?: number;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id: string;
	proposito_servicio: PropositoServicio;
	fecha_solicitud: string;
	estado?: EstadoServicio;
	fecha_realizacion?: string;
	valor: number;
	observaciones?: string;
}

// DTO para actualizar servicio
export interface UpdateServicioDTO {
	origen_id?: string;
	destino_id?: string;
	origen_especifico?: string;
	destino_especifico?: string;
	origen_latitud?: number;
	origen_longitud?: number;
	destino_latitud?: number;
	destino_longitud?: number;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id?: string;
	estado?: EstadoServicio;
	proposito_servicio?: PropositoServicio;
	fecha_solicitud?: string;
	fecha_realizacion?: string;
	fecha_finalizacion?: string;
	valor?: number;
	numero_planilla?: string;
	observaciones?: string;
}

// ==================== RESPUESTAS DE API ====================

export interface ApiResponse<T = any> {
	success: boolean;
	message?: string;
	data?: T;
	total?: number;
	meta?: PaginationMeta;
	stats?: ServiciosStats;
	errors?: ApiError[];
}

export interface ApiError {
	field?: string;
	message: string;
	code?: string;
	value?: any;
}

export interface PaginationMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
	count: number;
}

export interface ServiciosStats {
	total: number;
	en_curso: number;
	realizado: number;
	solicitado: number;
	planificado: number;
	cancelado: number;
}

// ==================== PARÁMETROS DE BÚSQUEDA ====================

export interface BuscarServiciosParams {
	estado?: EstadoServicio | EstadoServicio[];
	proposito_servicio?: PropositoServicio;
	fecha_solicitud_desde?: string;
	fecha_solicitud_hasta?: string;
	fecha_realizacion_desde?: string;
	fecha_realizacion_hasta?: string;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id?: string;
	origen_id?: string;
	destino_id?: string;
	valor_min?: number;
	valor_max?: number;
	numero_planilla?: string;
	page?: number;
	limit?: number;
}

// ==================== TRACKING Y POSICIÓN ====================

export interface Position {
	c: number;
	f: number;
	lc: number;
	s: number;
	sc: number;
	t: number;
	x: number; // Longitud
	y: number; // Latitud
	z: number; // Altitud
}

export interface VehicleTracking {
	id: number;
	name: string;
	flags: number;
	position: Position;
	lastUpdate: Date;
	item: any;
}

// ==================== CONSTANTES ====================

export const ESTADOS_SERVICIO: EstadoServicio[] = [
	'solicitado',
	'en_curso',
	'planificado',
	'realizado',
	'cancelado',
	'liquidado',
	'planilla_asignada'
];

export const PROPOSITOS_SERVICIO: PropositoServicio[] = ['personal', 'personal y herramienta'];

export const TIPOS_IDENTIFICACION: TipoIdentificacion[] = ['CC', 'CE', 'TI', 'PA', 'RC', 'NIT'];

// ==================== UTILIDADES ====================

// Helper para obtener texto legible del estado
export function getEstadoText(estado: EstadoServicio): string {
	const textos: Record<EstadoServicio, string> = {
		solicitado: 'Solicitado',
		en_curso: 'En Curso',
		planificado: 'Planificado',
		realizado: 'Realizado',
		cancelado: 'Cancelado',
		liquidado: 'Liquidado',
		planilla_asignada: 'Planilla Asignada'
	};
	return textos[estado] || estado;
}

// Helper para obtener color del estado
export function getEstadoColor(estado: EstadoServicio): string {
	const colores: Record<EstadoServicio, string> = {
		solicitado: '#3B82F6', // blue-500
		en_curso: '#F59E0B', // amber-500
		planificado: '#8B5CF6', // violet-500
		realizado: '#10B981', // orange-500
		cancelado: '#EF4444', // red-500
		liquidado: '#06B6D4', // cyan-500
		planilla_asignada: '#6366F1' // indigo-500
	};
	return colores[estado] || '#6B7280';
}

// Helper para formatear moneda
export function formatCurrency(valor: number): string {
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(valor);
}

// Helper para formatear fecha
export function formatDate(fecha: string | Date): string {
	const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
	return new Intl.DateTimeFormat('es-CO', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	}).format(date);
}

// Helper para formatear fecha y hora
export function formatDateTime(fecha: string | Date): string {
	const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
	return new Intl.DateTimeFormat('es-CO', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(date);
}
