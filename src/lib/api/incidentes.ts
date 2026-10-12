import { apiClient } from './apiClient';

/**
 * Accidentes, incidentes y casi-accidentes con su investigación. Espejo de
 * `backend/src/modules/incidentes`: los tipos de aquí son la forma de lo que
 * devuelve el servidor, y las reglas (transiciones, plazo, qué falta para
 * cerrar) se deciden allá; el front solo las muestra.
 */

export type TipoIncidente = 'ACCIDENTE_TRANSITO' | 'INCIDENTE' | 'CASI_ACCIDENTE';
export type EstadoIncidente = 'REPORTADO' | 'EN_INVESTIGACION' | 'CERRADO';
export type Severidad = 'SOLO_DANOS' | 'LESION_LEVE' | 'LESION_GRAVE' | 'FATALIDAD';
export type Trayecto = 'LABORAL' | 'IN_ITINERE' | 'MISION' | 'PARTICULAR';
export type AccionEstado = 'iniciar_investigacion' | 'cerrar' | 'reabrir';

/// Colores de identidad del tipo (orden fijo de la paleta categórica: azul,
/// naranja, aguamarina). Hex literales y no `emerald-*`: cotransmeq remapea esa
/// escala a naranja y el casi-accidente se confundiría con el incidente.
export const TIPO_LABELS: Record<TipoIncidente, { label: string; corto: string; color: string }> = {
	ACCIDENTE_TRANSITO: { label: 'Accidente de tránsito', corto: 'Accidente', color: '#2a78d6' },
	INCIDENTE: { label: 'Incidente', corto: 'Incidente', color: '#eb6834' },
	CASI_ACCIDENTE: { label: 'Casi-accidente', corto: 'Casi-accidente', color: '#1baf7a' }
};

/// Semáforo del estado: hex literales por la misma razón.
export const ESTADO_LABELS: Record<EstadoIncidente, { label: string; color: string }> = {
	REPORTADO: { label: 'Reportado', color: '#f59e0b' },
	EN_INVESTIGACION: { label: 'En investigación', color: '#8b5cf6' },
	CERRADO: { label: 'Cerrado', color: '#16a34a' }
};

export const SEVERIDAD_LABELS: Record<Severidad, string> = {
	SOLO_DANOS: 'Solo daños materiales',
	LESION_LEVE: 'Lesionados (leve)',
	LESION_GRAVE: 'Lesionados (grave)',
	FATALIDAD: 'Fatalidad'
};

export const TRAYECTO_LABELS: Record<Trayecto, string> = {
	LABORAL: 'Laboral (en servicio)',
	MISION: 'En misión',
	IN_ITINERE: 'In itinere (casa–trabajo)',
	PARTICULAR: 'Particular'
};

/** Clase de evento (columna heredada del PESV). Opcional. */
export const CLASES_EVENTO = [
	{ valor: 'CHOQUE', etiqueta: 'Choque' },
	{ valor: 'VOLCAMIENTO', etiqueta: 'Volcamiento' },
	{ valor: 'ATROPELLO', etiqueta: 'Atropello' },
	{ valor: 'SALIDA_VIA', etiqueta: 'Salida de la vía' },
	{ valor: 'CAIDA_OCUPANTE', etiqueta: 'Caída de ocupante' },
	{ valor: 'INCENDIO', etiqueta: 'Incendio' },
	{ valor: 'OTRO', etiqueta: 'Otro' }
] as const;

export const AUTORIDADES = [
	'Policía de Tránsito y Transporte',
	'Agente de tránsito municipal',
	'Policía Nacional',
	'Ninguna'
] as const;

export interface Plazo {
	limite: string;
	dias_restantes: number | null;
	vencido: boolean;
}

export interface Tercero {
	nombre: string;
	documento?: string | null;
	placa?: string | null;
	telefono?: string | null;
	aseguradora?: string | null;
	lesionado?: boolean;
}

export interface IncidenteResumen {
	id: string;
	codigo: string;
	consecutivo: number;
	tipo: TipoIncidente;
	estado: EstadoIncidente;
	fecha: string;
	hora: string | null;
	lugar: string | null;
	severidad: Severidad | null;
	heridos: number;
	fallecidos: number;
	numero_informe: string | null;
	vehiculo: { id: string; placa: string; marca: string | null; linea: string | null } | null;
	conductor: { id: string; nombre: string; documento: string | null } | null;
	municipio: { id: string; nombre: string; departamento: string } | null;
	evidencias: number;
	acciones: number;
	plazo: Plazo;
	created_at: string;
}

export interface MiembroEquipo {
	nombre: string;
	cargo?: string | null;
}

export interface AccionVinculada {
	id: string;
	numero: string;
	descripcion: string | null;
	tipo: string | null;
	estado: string;
	aprobacion: string | null;
	creada_desde_incidente: boolean;
	vinculada_at: string;
}

export interface EvidenciaIncidente {
	id: string;
	nombre: string;
	mimetype: string;
	tamano: number;
	descripcion: string | null;
	subido_por: string | null;
	created_at: string;
}

export interface IncidenteDetalle extends IncidenteResumen {
	trayecto: Trayecto;
	tipo_evento: string | null;
	descripcion: string | null;
	terceros: Tercero[];
	autoridad: string | null;
	costo_directo: number | null;
	costo_indirecto: number | null;
	servicio: {
		id: string;
		ruta: string;
		fecha: string;
		estado: string;
		cliente: string | null;
	} | null;
	cliente: { id: string; nombre: string | null } | null;
	registrado_por: { id: string; nombre: string } | null;
	investigacion: {
		realizada: boolean;
		iniciada_at: string | null;
		fecha_investigacion: string | null;
		equipo_investigador: MiembroEquipo[];
		actos_inseguros: string | null;
		condiciones_inseguras: string | null;
		factores_personales: string | null;
		factores_trabajo: string | null;
		analisis_porques: string[];
		causas_identificadas: string | null;
		lecciones_aprendidas: string | null;
	};
	cierre: {
		fecha_cierre: string | null;
		responsable_cierre: string | null;
		observaciones_cierre: string | null;
		cerrado_por: { id: string; nombre: string } | null;
	};
	acciones_vinculadas: AccionVinculada[];
	updated_at: string;
}

/// El detalle trae las evidencias como lista; el resumen, como conteo.
export type IncidenteDetalleApi = Omit<IncidenteDetalle, 'evidencias'> & {
	evidencias: EvidenciaIncidente[];
};

export interface ResumenIncidentes {
	total: number;
	REPORTADO: number;
	EN_INVESTIGACION: number;
	CERRADO: number;
	vencidos: number;
}

export interface ListadoIncidentes {
	items: IncidenteResumen[];
	pagination: { page: number; limit: number; total: number; pages: number };
	resumen: ResumenIncidentes;
}

export interface PuntoMensual {
	mes: string;
	ACCIDENTE_TRANSITO: number;
	INCIDENTE: number;
	CASI_ACCIDENTE: number;
	total: number;
}

export interface IndicadoresIncidentes {
	hoy: string;
	desde: string;
	meses: number;
	serie: PuntoMensual[];
	dias_sin_accidentes: number | null;
	ultimo_accidente: string | null;
	registro_desde: string | null;
	totales: {
		eventos: number;
		accidentes: number;
		incidentes: number;
		casi_accidentes: number;
		lesionados: number;
		fallecidos: number;
		costo_estimado: number;
	};
	por_gravedad: Record<Severidad | 'SIN_LESION', number>;
	investigacion: {
		abiertas: number;
		vencidas: number;
		cerradas: number;
		cerradas_a_tiempo: number;
	};
	por_100k_km: number | null;
	motivo_sin_km: string;
}

export interface ReporteIncidente {
	tipo: TipoIncidente;
	fecha: string;
	hora: string | null;
	lugar: string;
	municipio_id: string | null;
	trayecto: Trayecto;
	tipo_evento: string | null;
	vehiculo_id: string | null;
	conductor_id: string | null;
	servicio_id: string | null;
	descripcion: string;
	severidad: Severidad | null;
	heridos: number;
	fallecidos: number;
	terceros: Tercero[];
	autoridad: string | null;
	numero_informe: string | null;
	costo_directo: number | null;
	costo_indirecto: number | null;
}

export interface DatosInvestigacion {
	fecha_investigacion: string | null;
	equipo_investigador: MiembroEquipo[];
	actos_inseguros: string | null;
	condiciones_inseguras: string | null;
	factores_personales: string | null;
	factores_trabajo: string | null;
	analisis_porques: string[];
	causas_identificadas: string | null;
	lecciones_aprendidas: string | null;
}

export interface NuevaAccion {
	descripcion_hallazgo: string;
	tipo_accion_ejecutar: 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA';
	accion_numero?: string | null;
	tipo_hallazgo_detectado?: string | null;
	valoracion_riesgo?: 'ALTO' | 'MEDIO' | 'BAJO' | null;
	plan_accion?: string | null;
	responsable_ejecucion?: string | null;
	fecha_limite_implementacion?: string | null;
}

export interface OpcionesReporte {
	vehiculos: { id: string; placa: string; marca: string | null; linea: string | null }[];
	conductores: { id: string; nombre: string; documento: string | null }[];
}

export interface ServicioCandidato {
	id: string;
	ruta: string;
	fecha: string;
	estado: string;
	cliente: string | null;
	placa: string | null;
}

export interface AccionBuscada {
	id: string;
	numero: string;
	descripcion: string | null;
	estado: string;
	fuente: string | null;
}

const datos = <T>(r: { data: { data: T } }) => r.data.data;

export const incidentesAPI = {
	listar: async (params: Record<string, unknown>) =>
		(await apiClient.get('/api/incidentes', { params })).data as ListadoIncidentes,

	indicadores: async (meses = 12) =>
		datos<IndicadoresIncidentes>(
			await apiClient.get('/api/incidentes/indicadores', { params: { meses } })
		),

	opciones: async () => datos<OpcionesReporte>(await apiClient.get('/api/incidentes/opciones')),

	serviciosCandidatos: async (p: {
		fecha: string;
		vehiculo_id?: string | null;
		conductor_id?: string | null;
	}) =>
		datos<ServicioCandidato[]>(
			await apiClient.get('/api/incidentes/servicios-candidatos', {
				params: {
					fecha: p.fecha,
					...(p.vehiculo_id ? { vehiculo_id: p.vehiculo_id } : {}),
					...(p.conductor_id ? { conductor_id: p.conductor_id } : {})
				}
			})
		),

	detalle: async (id: string) =>
		datos<IncidenteDetalleApi>(await apiClient.get(`/api/incidentes/${id}`)),

	crear: async (r: ReporteIncidente) =>
		datos<IncidenteDetalleApi>(await apiClient.post('/api/incidentes', r)),

	editar: async (id: string, r: ReporteIncidente) =>
		datos<IncidenteDetalleApi>(await apiClient.put(`/api/incidentes/${id}`, r)),

	guardarInvestigacion: async (id: string, inv: DatosInvestigacion) =>
		datos<IncidenteDetalleApi>(await apiClient.put(`/api/incidentes/${id}/investigacion`, inv)),

	cambiarEstado: async (
		id: string,
		accion: AccionEstado,
		cierre: {
			fecha_cierre?: string;
			responsable_cierre?: string;
			observaciones_cierre?: string;
		} = {}
	) =>
		datos<IncidenteDetalleApi>(
			await apiClient.post(`/api/incidentes/${id}/estado`, { accion, ...cierre })
		),

	eliminar: (id: string) => apiClient.delete(`/api/incidentes/${id}`),

	subirEvidencia: async (id: string, archivo: File, descripcion?: string) => {
		// El campo va ANTES del archivo: el backend lee el multipart en orden.
		const fd = new FormData();
		if (descripcion?.trim()) fd.append('descripcion', descripcion.trim());
		fd.append('archivo', archivo);
		return (await apiClient.post(`/api/incidentes/${id}/evidencias`, fd, { timeout: 120_000 }))
			.data;
	},

	urlEvidencia: async (id: string, evId: string) =>
		datos<{ url: string }>(await apiClient.get(`/api/incidentes/${id}/evidencias/${evId}/url`)).url,

	eliminarEvidencia: (id: string, evId: string) =>
		apiClient.delete(`/api/incidentes/${id}/evidencias/${evId}`),

	crearAccion: async (id: string, a: NuevaAccion) =>
		datos<IncidenteDetalleApi>(await apiClient.post(`/api/incidentes/${id}/acciones`, a)),

	buscarAcciones: async (id: string, q: string) =>
		datos<AccionBuscada[]>(
			await apiClient.get(`/api/incidentes/${id}/acciones/buscar`, { params: { q } })
		),

	vincularAccion: async (id: string, accion_id: string) =>
		datos<IncidenteDetalleApi>(
			await apiClient.post(`/api/incidentes/${id}/acciones/vincular`, { accion_id })
		),

	desvincularAccion: async (id: string, accionId: string) =>
		datos<IncidenteDetalleApi>(await apiClient.delete(`/api/incidentes/${id}/acciones/${accionId}`))
};

/** Mensaje legible de un error de la API (el backend manda `message` y, si aplica, `details`). */
export function mensajeError(err: unknown, porDefecto: string): string {
	const r = (err as { response?: { data?: { message?: string } } })?.response?.data;
	return r?.message || porDefecto;
}

/** `YYYY-MM-DD` → «10 oct 2026». Una fecha sin hora se formatea en UTC: en Bogotá retrocedería un día. */
export function fechaCorta(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-CO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

const cop = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});
export const moneda = (v: number | null | undefined) =>
	v === null || v === undefined ? '—' : cop.format(v);

/** Hoy en Colombia (`YYYY-MM-DD`), para el valor por defecto de las fechas. */
export function hoyColombia(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
