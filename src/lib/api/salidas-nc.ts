import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

// ── Enums ──
export type ClasificacionNC = 'CRITICA' | 'MAYOR' | 'MENOR';
export type TipoDeteccion =
	| 'DURANTE_SERVICIO'
	| 'POST_SERVICIO'
	| 'AUDITORIA_INTERVENTORIA'
	| 'REPORTE_CLIENTE'
	| 'OTRO';
export type TipoSalidaNC =
	| 'GPS_SISTEMA_TECNOLOGICO'
	| 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO'
	| 'VEHICULO_DIFERENTE_SIN_APROBACION'
	| 'FALLA_MECANICA_ELECTRICA'
	| 'DOCUMENTACION_VENCIDA_INCOMPLETA'
	| 'CONDUCTOR_NO_APTO_INFRACCION_VIAL'
	| 'QUEJA_CLIENTE'
	| 'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE'
	| 'PERSONAL_NO_AUTORIZADO_TRANSPORTADO'
	| 'OTRO';
export type EstadoSNC = 'ABIERTA' | 'EN_TRATAMIENTO' | 'CERRADA';
export type TratamientoSNC = 'CORRECCION' | 'CONTENCION' | 'SUSPENSION' | 'CONCESION';
export type MedioAutorizacion = 'ESCRITO' | 'CORREO' | 'ACTA';
export type MetodoVerificacion =
	| 'REVISION_DOCUMENTAL'
	| 'VERIFICACION_OPERATIVA_CAMPO'
	| 'CONFIRMACION_GPS_PLATAFORMA'
	| 'CONFIRMACION_CLIENTE_INTERVENTOR'
	| 'OTRO';

// ── Labels legibles ──
export const CLASIFICACION_LABELS: Record<ClasificacionNC, { label: string; description: string; color: string }> = {
	CRITICA: {
		label: 'Crítica',
		description: 'Afecta la seguridad de personas – se abre una AC inmediata',
		color: 'red'
	},
	MAYOR: {
		label: 'Mayor',
		description: 'Afecta la conformidad del servicio al cliente – se abre una AC',
		color: 'orange'
	},
	MENOR: {
		label: 'Menor',
		description: 'Desviación controlable',
		color: 'yellow'
	}
};

export const TIPO_DETECCION_LABELS: Record<TipoDeteccion, string> = {
	DURANTE_SERVICIO: 'Durante el servicio',
	POST_SERVICIO: 'Post servicio',
	AUDITORIA_INTERVENTORIA: 'Auditoría / Interventoría',
	REPORTE_CLIENTE: 'Reporte del cliente',
	OTRO: 'Otro'
};

export const TIPO_SALIDA_NC_LABELS: Record<TipoSalidaNC, string> = {
	GPS_SISTEMA_TECNOLOGICO: 'GPS / Sistema tecnológico',
	INCUMPLIMIENTO_RUTA_HORARIO_DESTINO: 'Incumplimiento ruta/horario/destino',
	VEHICULO_DIFERENTE_SIN_APROBACION: 'Vehículo diferente sin aprobación',
	FALLA_MECANICA_ELECTRICA: 'Falla mecánica/eléctrica',
	DOCUMENTACION_VENCIDA_INCOMPLETA: 'Documentación vencida/incompleta',
	CONDUCTOR_NO_APTO_INFRACCION_VIAL: 'Conductor no apto / infracción vial',
	QUEJA_CLIENTE: 'Queja del cliente',
	HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE: 'Hallazgo auditoría/interventoría/cliente',
	PERSONAL_NO_AUTORIZADO_TRANSPORTADO: 'Personal no autorizado transportado',
	OTRO: 'Otro (detallar)'
};

export const ESTADO_SNC_LABELS: Record<EstadoSNC, { label: string; color: string }> = {
	ABIERTA: { label: 'Abierta', color: 'red' },
	EN_TRATAMIENTO: { label: 'En tratamiento', color: 'yellow' },
	CERRADA: { label: 'Cerrada', color: 'green' }
};

export const TRATAMIENTO_SNC_LABELS: Record<TratamientoSNC, { label: string; description: string }> = {
	CORRECCION: {
		label: 'Corrección',
		description: 'Acción inmediata para eliminar la NC'
	},
	CONTENCION: {
		label: 'Contención',
		description: 'Control de efectos mientras se define disposición final'
	},
	SUSPENSION: {
		label: 'Suspensión',
		description: 'Detener la prestación del servicio'
	},
	CONCESION: {
		label: 'Concesión',
		description: 'Autorización formal del cliente'
	}
};

export const MEDIO_AUTORIZACION_LABELS: Record<MedioAutorizacion, string> = {
	ESCRITO: 'Escrito',
	CORREO: 'Correo electrónico',
	ACTA: 'Acta'
};

export const METODO_VERIFICACION_LABELS: Record<MetodoVerificacion, string> = {
	REVISION_DOCUMENTAL: 'Revisión documental',
	VERIFICACION_OPERATIVA_CAMPO: 'Verificación operativa en campo',
	CONFIRMACION_GPS_PLATAFORMA: 'Confirmación GPS / plataforma',
	CONFIRMACION_CLIENTE_INTERVENTOR: 'Confirmación del cliente / interventor',
	OTRO: 'Otro (especificar)'
};

// ── Interfaces ──
export interface SalidaNoConforme {
	id: string;
	numero_snc: number;

	// Sección 1
	fecha_deteccion: string;
	fecha_evento: string;
	detectado_por: string;
	area_proceso: string;
	tipo_deteccion: TipoDeteccion;
	tipo_deteccion_otro?: string;
	vehiculo_placa?: string;
	ruta_trayecto?: string;
	turno_horario?: string;
	conductor_nombre?: string;
	conductor_cedula?: string;
	cliente_contrato?: string;
	servicio_afectado?: string;

	// Sección 2
	descripcion_nc: string;
	clasificacion_nc: ClasificacionNC;
	tipo_salida_nc: TipoSalidaNC;
	tipo_salida_nc_otro?: string;

	// Sección 3: Tratamiento aplicado
	tratamiento_seleccionado?: TratamientoSNC;
	descripcion_accion_tomada?: string;
	responsable_accion?: string;
	fecha_implementacion?: string;
	autoridad_disposicion?: string;

	// Sección 4: Concesión formal del cliente
	concesion_solicitada?: boolean;
	condiciones_concesion?: string;
	concesion_cliente_nombre?: string;
	concesion_cliente_fecha?: string;
	concesion_medio?: MedioAutorizacion;

	// Sección 5: Verificación de conformidad
	metodo_verificacion?: MetodoVerificacion;
	metodo_verificacion_otro?: string;
	resultado_verificacion?: string;
	cumple_requisitos?: boolean;
	responsable_verificacion?: string;
	fecha_verificacion?: string;
	firma_verificacion?: string;

	// Estado
	estado: EstadoSNC;
	observaciones?: string;

	// Relaciones
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id?: string;
	conductor?: { id: string; nombre: string; apellido: string; numero_identificacion: string };
	vehiculo?: { id: string; placa: string; marca: string; modelo: string };
	cliente?: { id: string; nombre: string; nit: string };
	creado_por?: { id: string; nombre: string; correo: string };

	created_at: string;
	updated_at: string;
}

export interface CreateSalidaNCInput {
	fecha_deteccion: string;
	fecha_evento: string;
	detectado_por: string;
	area_proceso: string;
	tipo_deteccion: TipoDeteccion;
	tipo_deteccion_otro?: string;
	vehiculo_placa?: string;
	ruta_trayecto?: string;
	turno_horario?: string;
	conductor_nombre?: string;
	conductor_cedula?: string;
	cliente_contrato?: string;
	servicio_afectado?: string;
	descripcion_nc: string;
	clasificacion_nc: ClasificacionNC;
	tipo_salida_nc: TipoSalidaNC;
	tipo_salida_nc_otro?: string;
	tratamiento_seleccionado?: TratamientoSNC;
	descripcion_accion_tomada?: string;
	responsable_accion?: string;
	fecha_implementacion?: string;
	autoridad_disposicion?: string;
	concesion_solicitada?: boolean;
	condiciones_concesion?: string;
	concesion_cliente_nombre?: string;
	concesion_cliente_fecha?: string;
	concesion_medio?: MedioAutorizacion;
	metodo_verificacion?: MetodoVerificacion;
	metodo_verificacion_otro?: string;
	resultado_verificacion?: string;
	cumple_requisitos?: boolean;
	responsable_verificacion?: string;
	fecha_verificacion?: string;
	firma_verificacion?: string;
	conductor_id?: string;
	vehiculo_id?: string;
	cliente_id?: string;
	observaciones?: string;
}

export interface FiltrosSalidasNC {
	page?: number;
	limit?: number;
	clasificacion_nc?: ClasificacionNC | '';
	tipo_deteccion?: TipoDeteccion | '';
	tipo_salida_nc?: TipoSalidaNC | '';
	estado?: EstadoSNC | '';
	fecha_desde?: string;
	fecha_hasta?: string;
	busqueda?: string;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
}

export interface EstadisticasSNC {
	total: number;
	porClasificacion: { clasificacion: ClasificacionNC; count: number }[];
	porEstado: { estado: EstadoSNC; count: number }[];
	porTipoDeteccion: { tipo: TipoDeteccion; count: number }[];
}

// ── Helper para obtener headers con auth ──
function getAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (browser) {
		const token = localStorage.getItem('transmeralda_token');
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

// ── API Client ──
export const salidasNCAPI = {
	async listar(
		filtros: FiltrosSalidasNC = {}
	): Promise<{ salidas: SalidaNoConforme[]; total: number; totalPages: number }> {
		const params = new URLSearchParams();
		Object.entries(filtros).forEach(([key, val]) => {
			if (val !== undefined && val !== '') params.set(key, String(val));
		});

		const res = await fetch(`${API_URL}/api/salidas-nc?${params.toString()}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al listar salidas NC');
		return json.data;
	},

	async obtenerPorId(id: string): Promise<SalidaNoConforme> {
		const res = await fetch(`${API_URL}/api/salidas-nc/${id}`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al obtener salida NC');
		return json.data;
	},

	async crear(data: CreateSalidaNCInput): Promise<SalidaNoConforme> {
		const res = await fetch(`${API_URL}/api/salidas-nc`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al crear salida NC');
		return json.data;
	},

	async actualizar(id: string, data: Partial<CreateSalidaNCInput>): Promise<SalidaNoConforme> {
		const res = await fetch(`${API_URL}/api/salidas-nc/${id}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(data)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al actualizar salida NC');
		return json.data;
	},

	async eliminar(id: string): Promise<void> {
		const res = await fetch(`${API_URL}/api/salidas-nc/${id}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al eliminar salida NC');
	},

	async estadisticas(): Promise<EstadisticasSNC> {
		const res = await fetch(`${API_URL}/api/salidas-nc/estadisticas`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al obtener estadísticas');
		return json.data;
	},

	async siguienteNumero(): Promise<number> {
		const res = await fetch(`${API_URL}/api/salidas-nc/siguiente-numero`, {
			headers: getAuthHeaders()
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.message || 'Error al obtener siguiente número');
		return json.data.numero;
	},

	async descargarPDF(id: string, numeroSnc: number): Promise<void> {
		const res = await fetch(`${API_URL}/api/salidas-nc/${id}/pdf`, {
			headers: getAuthHeaders()
		});
		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			throw new Error(json.message || 'Error al generar PDF');
		}
		const blob = await res.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `SNC-${String(numeroSnc).padStart(4, '0')}.pdf`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	}
};
