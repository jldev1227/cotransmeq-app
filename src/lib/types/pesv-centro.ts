/**
 * Contrato del centro de cumplimiento PESV.
 *
 * Espejo de `backend-nest/src/modules/pesv/**`. No hay generación automática:
 * el backend es Fastify sin OpenAPI tipado, así que esto se mantiene a mano y
 * `tests/pesv-contrato.test.ts` comprueba que los estados y códigos que la UI
 * conoce siguen siendo los que el backend declara.
 *
 * Nada de `any` en este archivo. Un `any` aquí significa que un campo puede
 * llegar como quiera y la pantalla lo pintará igual — que es como se cuelan los
 * `undefined` en una tarjeta de auditoría.
 */

// ─────────────────────────────────────────────────────────────────────────
//  Vocabulario compartido
// ─────────────────────────────────────────────────────────────────────────

export type EstadoIndicador = 'OK' | 'ALERTA' | 'CRITICO' | 'SIN_DATOS';
export type UnidadIndicador = 'PERCENT' | 'RATE' | 'COUNT' | 'CURRENCY';
export type SentidoMeta = 'MAYOR_ES_MEJOR' | 'MENOR_ES_MEJOR';
export type FrecuenciaIndicador = 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL';

export type EstadoRequisito =
	'PENDIENTE' | 'EN_PROGRESO' | 'EN_REVISION' | 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';

export type FasePesv = 'PLANIFICACION' | 'IMPLEMENTACION' | 'SEGUIMIENTO' | 'MEJORA';

export type EstadoRevision = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
export type EstadoVigencia = 'SIN_FECHA' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO';

export type EstadoCobertura =
	| 'CUBIERTO'
	| 'SIN_CONTRATO'
	| 'SIN_FUEC'
	| 'VENCIDO'
	| 'VEHICULO_NO_COINCIDE'
	| 'CONDUCTOR_NO_COINCIDE'
	| 'DOCUMENTOS_NO_VIGENTES'
	| 'FUEC_ANULADO';

export type AmbitoDocumento = 'CONDUCTOR' | 'VEHICULO' | 'TERCERO' | 'CONTRATO' | 'EMPRESA';

export type SeveridadAlerta = 'CRITICA' | 'ALTA' | 'MEDIA' | 'INFORMATIVA';

export const CODIGOS_INDICADOR = [
	'TSV',
	'CSV',
	'RSVI',
	'GRV',
	'CMP',
	'CPLAN',
	'EJLC',
	'GVE',
	'ELVL',
	'IDP',
	'CPMVH',
	'CPFSV',
	'CPF',
	'NCAC'
] as const;

export type CodigoIndicador = (typeof CODIGOS_INDICADOR)[number];

// ─────────────────────────────────────────────────────────────────────────
//  Cobertura de datos
// ─────────────────────────────────────────────────────────────────────────

export interface Exclusion {
	motivo: string;
	cantidad: number;
	ejemplos: string[];
}

export interface CoberturaDatos {
	esperados: number;
	validos: number;
	excluidos: number;
	motivos: Exclusion[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Indicadores
// ─────────────────────────────────────────────────────────────────────────

export interface FuenteIndicador {
	dominio: string;
	registros: number;
	recordIds: string[];
	actionUrl?: string;
}

export interface IncidenciaIndicador {
	code: string;
	message: string;
	count: number;
	actionUrl?: string;
}

export interface PeriodoIndicador {
	granularidad: 'ANUAL' | 'TRIMESTRAL' | 'MENSUAL';
	anio: number;
	trimestre?: number;
	mes?: number;
	desde: string;
	hasta: string;
	etiqueta: string;
}

export interface ResultadoIndicador {
	code: CodigoIndicador;
	nombre: string;
	descripcion: string;
	frecuencia: FrecuenciaIndicador;
	periodo: PeriodoIndicador;
	status: EstadoIndicador;
	/** `null` significa «no se pudo calcular». NUNCA se pinta como 0. */
	value: number | null;
	unit: UnidadIndicador;
	numerator: number | null;
	denominator: number | null;
	formula: string;
	target: number | null;
	sentido: SentidoMeta;
	tendencia: {
		valorAnterior: number | null;
		delta: number | null;
		direccion: 'SUBE' | 'BAJA' | 'IGUAL' | 'SIN_COMPARACION';
		favorable: boolean | null;
	};
	dataCoverage: CoberturaDatos;
	sources: FuenteIndicador[];
	issues: IncidenciaIndicador[];
	razonSinDatos: string | null;
	calculadoAt: string;
	desglose?: Array<{ etiqueta: string; valor: number | null; unidad?: UnidadIndicador }>;
}

export interface FichaIndicador {
	code: CodigoIndicador;
	nombre: string;
	descripcion: string;
	formula: string;
	unit: UnidadIndicador;
	frecuencia: FrecuenciaIndicador;
	sentido: SentidoMeta;
	pasos: number[];
	fuentes: string[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Catálogo y matriz
// ─────────────────────────────────────────────────────────────────────────

export interface SoportePaso {
	clave: string;
	etiqueta: string;
	obligatorio: boolean;
	dominios?: string[];
}

export interface PasoCatalogo {
	numero: number;
	fase: FasePesv;
	nombre: string;
	descripcion: string;
	areaSugerida: string;
	soportes: SoportePaso[];
	indicadores?: string[];
}

export interface CatalogoPesv {
	pasos: PasoCatalogo[];
	fases: Record<FasePesv, string>;
	indicadores: FichaIndicador[];
	nivel: string;
}

export interface SoporteEvaluado {
	clave: string;
	etiqueta: string;
	obligatorio: boolean;
	dominios: string[];
	aprobadas: number;
	pendientes: number;
	rechazadas: number;
	vencidas: number;
	satisfecho: boolean;
}

export interface FilaMatriz {
	requirementId: string;
	stepNumber: number;
	fase: FasePesv;
	faseEtiqueta: string;
	nombre: string;
	descripcion: string;
	estado: EstadoRequisito;
	areaResponsable: string | null;
	responsable: { id: string; nombre: string } | null;
	fechaLimite: string | null;
	diasParaVencer: number | null;
	vencido: boolean;
	justificacion: string | null;
	notas: string | null;
	indicadores: string[];
	soportes: SoporteEvaluado[];
	evidencias: {
		total: number;
		aprobadas: number;
		pendientes: number;
		rechazadas: number;
		vencidas: number;
	};
	puedeCumplir: boolean;
	bloqueos: string[];
}

export interface ResumenMatriz {
	totalPasos: number;
	porEstado: Record<EstadoRequisito, number>;
	aplicables: number;
	/** `null` cuando no hay pasos aplicables. No se muestra 0 %. */
	avance: number | null;
	porFase: Array<{
		fase: FasePesv;
		etiqueta: string;
		total: number;
		cumple: number;
		avance: number | null;
	}>;
	vencidos: number;
	bloqueados: number;
}

export interface RespuestaCumplimiento {
	ciclo: CicloPesv;
	filas: FilaMatriz[];
	resumen: ResumenMatriz;
	fechaCorte: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  Ciclo
// ─────────────────────────────────────────────────────────────────────────

export interface CicloPesv {
	id: string;
	anio: number;
	nivel: string;
	estado: 'BORRADOR' | 'ACTIVO' | 'CERRADO';
	version: number;
	lider_id: string | null;
	lider_nombre: string | null;
	lider_cargo: string | null;
	vigencia_desde: string | null;
	vigencia_hasta: string | null;
	dias_por_vencer: number;
	observaciones: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Evidencias
// ─────────────────────────────────────────────────────────────────────────

export interface EvidenciaBandeja {
	id: string;
	titulo: string;
	descripcion: string | null;
	soporteClave: string | null;
	origen: 'ARCHIVO' | 'REGISTRO';
	stepNumber: number;
	pasoNombre: string;
	areaResponsable: string | null;
	estadoRevision: EstadoRevision;
	sourceDomain: string | null;
	sourceId: string | null;
	snapshot: Record<string, unknown>;
	nombreArchivo: string | null;
	vigenciaHasta: string | null;
	diasParaVencer: number | null;
	vencida: boolean;
	cargadoPor: { id: string; nombre: string } | null;
	revisadoPor: { id: string; nombre: string } | null;
	revisadoAt: string | null;
	observacionRevision: string | null;
	createdAt: string;
	/** Resuelto por el servidor: nadie aprueba lo que él mismo aportó. */
	esPropia: boolean;
}

export interface RevisionEvidencia {
	id: string;
	decision: EstadoRevision;
	observacion: string | null;
	revisor_nombre: string | null;
	created_at: string;
}

export interface DetallePaso extends FilaMatriz {
	evidenciasDetalle: Array<{
		id: string;
		titulo: string;
		descripcion: string | null;
		origen: 'ARCHIVO' | 'REGISTRO';
		estado_revision: EstadoRevision;
		nombre_archivo: string | null;
		source_domain: string | null;
		source_id: string | null;
		source_snapshot_json: Record<string, unknown>;
		vigencia_hasta: string | null;
		observacion_revision: string | null;
		created_at: string;
		cargado_por: { id: string; nombre: string } | null;
		revisado_por: { id: string; nombre: string } | null;
		revisiones: RevisionEvidencia[];
	}>;
}

// ─────────────────────────────────────────────────────────────────────────
//  Documentos
// ─────────────────────────────────────────────────────────────────────────

export interface AlertaDocumental {
	id: string;
	ambito: AmbitoDocumento;
	tipo: string | null;
	tipoEtiqueta: string;
	numero: string | null;
	emisor: string | null;
	nombreArchivo: string;
	titular: { tipo: string; id: string | null; etiqueta: string };
	fechaExpedicion: string | null;
	fechaVencimiento: string | null;
	estadoVigencia: EstadoVigencia;
	diasRestantes: number | null;
	estadoRevision: EstadoRevision;
	acredita: boolean;
	obligatorio: boolean;
	enlace: string;
}

export interface ResumenDocumentos {
	total: number;
	vencidos: number;
	porVencer: number;
	vigentes: number;
	sinFecha: number;
	pendientesRevision: number;
	rechazados: number;
	obligatoriosSinAcreditar: number;
}

export interface TipoDocumento {
	tipo: string;
	etiqueta: string;
	ambito: AmbitoDocumento;
	diasPorVencer: number;
	obligatorio: boolean;
	orden: number;
}

export interface RespuestaDocumentos {
	filas: AlertaDocumental[];
	resumen: ResumenDocumentos;
	tipos: TipoDocumento[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Contratos y FUEC
// ─────────────────────────────────────────────────────────────────────────

export interface CoberturaServicio {
	servicioId: string;
	fecha: string | null;
	numeroPlanilla: string | null;
	clienteNombre: string | null;
	vehiculoPlaca: string | null;
	conductorNombre: string | null;
	estado: EstadoCobertura;
	motivo: string;
	contrato: { id: string; numero: string; contratanteNombre: string } | null;
	fuec: { id: string; numeroCompleto: string; estado: string; vigenciaHasta: string | null } | null;
	documentosFaltantes: string[];
	enlaceExtractos: string;
	enlaceServicio: string;
}

export interface ResumenCobertura {
	total: number;
	cubiertos: number;
	sinCobertura: number;
	porEstado: Record<EstadoCobertura, number>;
	porcentaje: number | null;
}

export interface RespuestaCobertura {
	periodo: PeriodoIndicador;
	filas: CoberturaServicio[];
	resumen: ResumenCobertura;
}

// ─────────────────────────────────────────────────────────────────────────
//  Operación segura
// ─────────────────────────────────────────────────────────────────────────

export interface SiniestroPesv {
	id: string;
	fecha: string;
	hora: string | null;
	severidad: 'FATALIDAD' | 'LESION_GRAVE' | 'LESION_LEVE' | 'SOLO_DANOS';
	trayecto: 'LABORAL' | 'IN_ITINERE' | 'MISION' | 'PARTICULAR';
	tipo_evento: string | null;
	lugar: string | null;
	descripcion: string | null;
	heridos: number | null;
	fallecidos: number | null;
	costo_directo: string | number | null;
	costo_indirecto: string | number | null;
	investigacion_realizada: boolean;
	causas_identificadas: string | null;
	conductor: { id: string; nombre: string; apellido: string } | null;
	vehiculo: { id: string; placa: string } | null;
	cliente: { id: string; nombre: string | null } | null;
	accion_correctiva: { id: string; accion_numero: string; estado_global: string } | null;
}

export interface EventoVelocidad {
	id: string;
	ocurrido_at: string;
	business_date: string;
	velocidad_kmh: string | number | null;
	limite_kmh: string | number | null;
	via: string | null;
	fuente: string;
	vehiculo: { id: string; placa: string } | null;
	conductor: { id: string; nombre: string; apellido: string } | null;
	servicio: { id: string; numero_planilla: string | null } | null;
}

/**
 * Serie histórica de excesos.
 *
 * Se tipa aparte y con `origen: 'LEGACY'` para que ninguna pantalla la mezcle
 * con los eventos: son totales mensuales cargados a mano, no hechos observados.
 */
export interface SerieHistoricaVelocidad {
	origen: 'LEGACY';
	advertencia: string;
	anio: number;
	serie: Array<{ mes: number; total: number }>;
}

export interface FilaInspeccion {
	vehiculoId: string;
	placa: string;
	fecha: string;
	envioId: string | null;
	conductor: string | null;
	entregadoAt: string | null;
	estado: string;
	enlace: string;
}

export interface CoberturaInspecciones {
	hayAsignacion: boolean;
	asignaciones: Array<{ id: string; nombre: string; formulario: string }>;
	advertencia: string | null;
	enlaceConfiguracion: string;
	filas: FilaInspeccion[];
	historicoManual?: { origen: 'LEGACY'; registros: number; advertencia: string };
}

export interface AlertaMantenimiento {
	planId?: string;
	eventoId?: string;
	vehiculoId: string;
	placa: string;
	nombre?: string;
	descripcion?: string;
	proximaFecha?: string | null;
	fechaProgramada?: string;
	diasRestantes: number | null;
	proximoKm?: number | null;
	kmRestantes?: number | null;
	estado: 'VENCIDO' | 'PROXIMO' | 'AL_DIA';
	enlace: string;
}

export interface RespuestaOperacion {
	periodo: PeriodoIndicador;
	siniestros: SiniestroPesv[];
	velocidad: { eventos: EventoVelocidad[]; historico: SerieHistoricaVelocidad };
	inspecciones: CoberturaInspecciones;
	mantenimiento: { planes: AlertaMantenimiento[]; intervenciones: AlertaMantenimiento[] };
	fechaCorte: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  Metas, riesgos, programas y formación
// ─────────────────────────────────────────────────────────────────────────

export interface MetaPesv {
	id: string;
	indicador_codigo: string | null;
	nombre: string;
	descripcion: string | null;
	linea_base: string | number | null;
	valor_meta: string | number | null;
	unidad: string | null;
	sentido: SentidoMeta;
	umbral_alerta: string | number | null;
	fecha_limite: string | null;
	lograda: boolean | null;
	resultado_observacion: string | null;
	responsable: { id: string; nombre: string } | null;
}

export interface RiesgoPesv {
	id: string;
	codigo: string | null;
	proceso: string | null;
	actor_vial: string | null;
	peligro: string;
	exposicion: string | null;
	consecuencia: string | null;
	nivel_inicial: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | null;
	nivel_final: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | null;
	controles: string | null;
	fecha_valoracion: string | null;
	responsable: { id: string; nombre: string } | null;
}

export interface ProgramaPesv {
	id: string;
	tipo: string;
	nombre: string;
	alcance: string | null;
	lineamientos: string | null;
	fecha_inicio: string | null;
	fecha_fin: string | null;
	metodo_medicion: string | null;
	activo: boolean;
	responsable: { id: string; nombre: string } | null;
	_count: { vehiculos: number };
}

export interface FormacionPesv {
	id: string;
	tema: string;
	objetivo: string | null;
	tipo: string;
	trimestre: number | null;
	fecha_planificada: string | null;
	fecha_ejecucion: string | null;
	poblacion_objetivo: number | null;
	ejecutado: boolean;
	asistencia: {
		id: string;
		tematica: string;
		fecha: string;
		_count: { respuestas: number };
	} | null;
	responsable: { id: string; nombre: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Resumen
// ─────────────────────────────────────────────────────────────────────────

export interface AlertaResumen {
	code: string;
	titulo: string;
	detalle: string;
	cantidad: number;
	severidad: SeveridadAlerta;
	enlace: string;
}

export interface ResumenPesv {
	ciclo: {
		id: string;
		anio: number;
		nivel: string;
		estado: string;
		lider: string | null;
		diasPorVencer: number;
	} | null;
	/** Presente solo cuando NO hay ciclo. La pantalla no inventa uno. */
	sinCiclo: { anio: number; mensaje: string; accion: string } | null;
	periodo: PeriodoIndicador;
	fechaCorte: string;
	cumplimiento: ResumenMatriz | null;
	evidencias: {
		pendientesRevision: number;
		rechazadas: number;
		vencidas: number;
		enlace: string;
	};
	indicadores: {
		total: number;
		ok: number;
		alerta: number;
		critico: number;
		sinDatos: number;
		criticos: Array<
			Pick<ResultadoIndicador, 'code' | 'nombre' | 'value' | 'unit' | 'target' | 'status'>
		>;
		cobertura: CoberturaDatos;
	};
	documentos: ResumenDocumentos;
	inspecciones: { indicador: ResultadoIndicador | null };
	mantenimiento: { vencidos: number; proximos: number };
	velocidad: { eventos: number; indicador: ResultadoIndicador | null };
	siniestros: { total: number; conFatalidad: number; sinInvestigar: number };
	contratos: ResumenCobertura;
	actividades: { total: number; vencidas: number; completadas: number; pendientes: number };
	alertas: AlertaResumen[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Permisos
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lo que ESTE usuario puede hacer, según el servidor.
 *
 * La UI la usa para no ofrecer acciones que la API va a rechazar. No sustituye
 * la autorización: el servidor vuelve a comprobarlo en cada petición.
 */
export interface PermisosPesv {
	nivel: 'full' | 'read' | 'limited';
	areas: string[];
	puedeLeer: boolean;
	puedeAportar: boolean;
	puedeGestionar: boolean;
	/** HSEQ o Administración. No se deriva del nivel. */
	puedeRevisar: boolean;
	usuarioId: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  Importación de extractos
// ─────────────────────────────────────────────────────────────────────────

export interface InformeImportacion {
	archivo: string;
	filasLeidas: number;
	importadas: number;
	yaExistian: number;
	aConciliacion: number;
	porMotivo: Record<string, number>;
	muestraNoConciliadas: Array<{ linea: number; motivo: string; texto: string }>;
	ejecutadoAt: string;
	simulacion: boolean;
}

export interface FilaConciliacion {
	id: string;
	source_line: number;
	source_text: string;
	motivo: string;
	detalle_json: Record<string, unknown>;
	resuelto: boolean;
	created_at: string;
}
