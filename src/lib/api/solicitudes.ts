import { apiClient } from './apiClient';

/**
 * Bandeja de solicitudes web: lo que entra por el formulario público de la
 * landing (cotizaciones, servicios, información). Espejo de
 * `backend/src/modules/solicitudes-web`.
 */

export type TipoSolicitud = 'cotizacion' | 'servicio' | 'informacion' | 'otro';
export type EstadoSolicitud = 'nueva' | 'en_verificacion' | 'verificada' | 'atendida' | 'descartada' | 'spam';
export type PrioridadSolicitud = 'alta' | 'media' | 'baja';
export type RiesgoSolicitud = 'bajo' | 'medio' | 'alto';

export interface SenalSolicitud {
	clave: string;
	texto: string;
	peso: number;
}

export interface EventoSolicitud {
	en: string;
	por_id: string | null;
	por: string;
	accion: 'recibida' | 'estado' | 'prioridad' | 'asignacion' | 'nota' | string;
	detalle: string | null;
}

export interface SolicitudResumen {
	id: string;
	radicado: string;
	tipo: TipoSolicitud;
	estado: EstadoSolicitud;
	prioridad: PrioridadSolicitud;
	nombre: string;
	empresa: string | null;
	correo: string;
	telefono: string;
	origen: string | null;
	destino: string | null;
	fecha_servicio: string | null;
	pasajeros: number | null;
	urgente: boolean;
	riesgo_nivel: RiesgoSolicitud;
	riesgo_puntaje: number;
	cliente_id: string | null;
	asignado_a_id: string | null;
	asignado_a: { id: string; nombre: string } | null;
	created_at: string;
	updated_at: string;
}

export interface AntecedenteSolicitud {
	id: string;
	radicado: string;
	tipo: TipoSolicitud;
	estado: EstadoSolicitud;
	nombre: string;
	empresa: string | null;
	created_at: string;
	coincide: string[];
}

export interface SolicitudDetalle extends SolicitudResumen {
	documento: string | null;
	cargo: string | null;
	tipo_vehiculo: string | null;
	modalidad: 'eventual' | 'recurrente' | 'contrato' | 'sin_definir' | null;
	mensaje: string;
	senales: SenalSolicitud[];
	cliente: { id: string; nombre: string | null; nit: string | null } | null;
	origen_sitio: string | null;
	ip_origen: string | null;
	user_agent: string | null;
	referer: string | null;
	tiempo_llenado_ms: number | null;
	historial: EventoSolicitud[];
	atendida_at: string | null;
	antecedentes: AntecedenteSolicitud[];
	candidatos: { id: string; nombre: string }[];
}

export interface ResumenSolicitudes {
	estados: Partial<Record<EstadoSolicitud, number>>;
	pendientes: number;
	pendientes_por_prioridad: Partial<Record<PrioridadSolicitud, number>>;
	pendientes_riesgo_alto: number;
}

export interface ListarSolicitudesParams {
	page?: number;
	limit?: number;
	search?: string;
	tipo?: TipoSolicitud;
	estado?: EstadoSolicitud;
	pendientes?: boolean;
	prioridad?: PrioridadSolicitud;
	riesgo?: RiesgoSolicitud;
	orden?: 'created_at' | 'prioridad' | 'estado' | 'fecha_servicio' | 'riesgo_puntaje';
	direccion?: 'asc' | 'desc';
}

export interface GestionarSolicitudInput {
	estado?: EstadoSolicitud;
	prioridad?: PrioridadSolicitud;
	asignado_a_id?: string | null;
	nota?: string;
}

export const TIPO_LABELS: Record<TipoSolicitud, string> = {
	cotizacion: 'Cotización',
	servicio: 'Servicio',
	informacion: 'Información',
	otro: 'Otro'
};

export const MODALIDAD_LABELS: Record<string, string> = {
	eventual: 'Eventual (un viaje o evento)',
	recurrente: 'Recurrente (rutas o turnos)',
	contrato: 'Contrato (mensual o por proyecto)',
	sin_definir: 'Sin definir'
};

/// Semáforo de la bandeja. Hex a propósito: en cotransmeq la escala emerald
/// se vuelve naranja y un «verificada» verde chocaría con el ámbar.
export const ESTADO_LABELS: Record<EstadoSolicitud, { label: string; dot: string; bg: string; color: string }> = {
	nueva: { label: 'Nueva', dot: '#2563eb', bg: '#eff6ff', color: '#1d4ed8' },
	en_verificacion: { label: 'En verificación', dot: '#d97706', bg: '#fffbeb', color: '#b45309' },
	verificada: { label: 'Verificada', dot: '#0d9488', bg: '#f0fdfa', color: '#0f766e' },
	atendida: { label: 'Atendida', dot: '#16a34a', bg: '#f0fdf4', color: '#15803d' },
	descartada: { label: 'Descartada', dot: '#6b7280', bg: '#f3f4f6', color: '#4b5563' },
	spam: { label: 'Spam', dot: '#dc2626', bg: '#fef2f2', color: '#b91c1c' }
};

export const PRIORIDAD_LABELS: Record<PrioridadSolicitud, { label: string; color: string; bg: string }> = {
	alta: { label: 'Alta', color: '#b91c1c', bg: '#fef2f2' },
	media: { label: 'Media', color: '#b45309', bg: '#fffbeb' },
	baja: { label: 'Baja', color: '#4b5563', bg: '#f3f4f6' }
};

export const RIESGO_LABELS: Record<RiesgoSolicitud, { label: string; color: string; bg: string; dot: string }> = {
	bajo: { label: 'Riesgo bajo', color: '#15803d', bg: '#f0fdf4', dot: '#16a34a' },
	medio: { label: 'Riesgo medio', color: '#b45309', bg: '#fffbeb', dot: '#d97706' },
	alto: { label: 'Riesgo alto', color: '#b91c1c', bg: '#fef2f2', dot: '#dc2626' }
};

export const ESTADOS_PENDIENTES: EstadoSolicitud[] = ['nueva', 'en_verificacion', 'verificada'];

export const solicitudesAPI = {
	async listar(params: ListarSolicitudesParams = {}) {
		const { data } = await apiClient.get<{
			success: boolean;
			items: SolicitudResumen[];
			pagination: { page: number; limit: number; total: number; pages: number };
			resumen: ResumenSolicitudes;
		}>('/api/solicitudes', { params });
		return data;
	},

	async resumen() {
		const { data } = await apiClient.get<{ success: boolean; pendientes: number; nuevas: number; urgentes: number }>(
			'/api/solicitudes/resumen'
		);
		return data;
	},

	async detalle(id: string) {
		const { data } = await apiClient.get<{ success: boolean; solicitud: SolicitudDetalle }>(`/api/solicitudes/${id}`);
		return data.solicitud;
	},

	async gestionar(id: string, cambios: GestionarSolicitudInput) {
		const { data } = await apiClient.patch<{ success: boolean; solicitud: SolicitudDetalle }>(
			`/api/solicitudes/${id}`,
			cambios
		);
		return data.solicitud;
	}
};
