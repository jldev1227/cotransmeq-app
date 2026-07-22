// ==================== Actividades PESV Types ====================

export type ActividadPesvEstado = 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADA' | 'VENCIDA' | 'CANCELADA';
export type ActividadPesvPrioridad = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type ActividadPesvFrecuencia =
	| 'UNICA'
	| 'DIARIA'
	| 'SEMANAL'
	| 'QUINCENAL'
	| 'MENSUAL'
	| 'BIMESTRAL'
	| 'TRIMESTRAL'
	| 'SEMESTRAL'
	| 'ANUAL';

export interface ActividadPesv {
	id: string;
	numero: number;
	unidad_programa: string;
	actividad: string;
	alcance: string | null;
	recursos: string | null;
	responsable_planeacion: string | null;
	metodo_seguimiento: string | null;
	frecuencia: ActividadPesvFrecuencia;
	fecha_limite: string | null;
	responsable_ejecucion_id: string | null;
	responsable_ejecucion: {
		id: string;
		nombre: string;
		correo: string;
		cargo: string | null;
	} | null;
	estado: ActividadPesvEstado;
	prioridad: ActividadPesvPrioridad;
	fecha_ejecucion: string | null;
	observacion: string | null;
	anio: number;
	creado_por: { id: string; nombre: string } | null;
	actualizado_por: { id: string; nombre: string } | null;
	created_at: string;
	updated_at: string;
}

export interface ActividadPesvFormData {
	numero: number;
	unidad_programa: string;
	actividad: string;
	alcance?: string;
	recursos?: string;
	responsable_planeacion?: string;
	metodo_seguimiento?: string;
	frecuencia?: ActividadPesvFrecuencia;
	fecha_limite?: string;
	responsable_ejecucion_id?: string;
	estado?: ActividadPesvEstado;
	prioridad?: ActividadPesvPrioridad;
	fecha_ejecucion?: string;
	observacion?: string;
	anio?: number;
}

export interface ActividadesListResponse {
	success: boolean;
	actividades: ActividadPesv[];
	total: number;
	totalPages: number;
	page: number;
}

export interface ActividadPesvEstadisticas {
	total: number;
	porEstado: Record<string, number>;
	porPrioridad: Record<string, number>;
}
