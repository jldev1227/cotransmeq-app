import { apiClient } from './apiClient';

export type TipoEntidadSimit = 'vehiculo' | 'conductor';
export type EstadoConsultaSimit = 'en_curso' | 'sin_deuda' | 'con_deuda' | 'error';

export interface DetalleComparendoSimit {
	numeroComparendo: string;
	fechaImposicion: string | null;
	horaImposicion: string | null;
	direccion: string | null;
	error: string | null;
}

export interface ConsultaSimit {
	id: string;
	tipo_entidad: TipoEntidadSimit;
	identificador: string;
	proveedor: string | null;
	estado_consulta: EstadoConsultaSimit;
	comparendos: number | null;
	multas: number | null;
	acuerdos_pago: number | null;
	saldo_total: number | string | null;
	detalle: { fuente?: string; resumen?: string; comparendosDetalle?: DetalleComparendoSimit[] } | null;
	error: string | null;
	consultado_at: string;
}

export interface HistorialSimit {
	tipo: TipoEntidadSimit;
	identificador: string;
	proveedorConfigurado: boolean;
	mensajeIntegracion: string;
	programacion: ProgramacionSimit;
	ultimaConsulta: ConsultaSimit | null;
	historial: ConsultaSimit[];
}

export interface ProgramacionSimit {
	cadaHoras: number;
	horaInicio: string;
	horarios: string[];
}

export interface EjecucionSimit {
	id: string;
	estado: 'en_curso' | 'completada' | 'error';
	origen: 'manual' | 'cron';
	iniciadoAt: string;
	finalizadoAt: string | null;
	procesados: number;
	total: number;
	resultado: { consultados: number; omitidos: number; errores: number } | null;
	mensajeError: string | null;
}

export async function historialSimit(tipo: TipoEntidadSimit, entidadId: string): Promise<HistorialSimit> {
	const recurso = tipo === 'vehiculo' ? 'vehiculos' : 'conductores';
	const { data } = await apiClient.get(`/api/simit/${recurso}/${entidadId}`);
	return data.data;
}

export async function iniciarConsultaIndividualSimit(tipo: TipoEntidadSimit, entidadId: string): Promise<{
	consulta_id: string;
	estado_consulta: EstadoConsultaSimit;
	yaEstabaEnCurso: boolean;
}> {
	const recurso = tipo === 'vehiculo' ? 'vehiculos' : 'conductores';
	const { data } = await apiClient.post(`/api/simit/${recurso}/${encodeURIComponent(entidadId)}/consultar`);
	return data.data;
}

export async function guardarProgramacionSimit(programacion: Pick<ProgramacionSimit, 'cadaHoras' | 'horaInicio'>): Promise<ProgramacionSimit> {
	const { data } = await apiClient.put('/api/simit/programacion', programacion);
	return data.data;
}

export async function iniciarConsultaSimitAhora(): Promise<{ ejecucion: EjecucionSimit; yaEstabaEnCurso: boolean }> {
	const { data } = await apiClient.post('/api/simit/ejecutar-ahora');
	return data.data;
}

export async function obtenerEjecucionSimit(id: string): Promise<EjecucionSimit> {
	const { data } = await apiClient.get(`/api/simit/ejecuciones/${id}`);
	return data.data;
}
