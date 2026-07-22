import { esDiaFestivoColombiano } from '$lib/utils/festivosColombia';
import type { TipoHallazgo } from '$lib/api/acciones-correctivas';

/** Valores canónicos para nuevos registros */
export const TIPOS_HALLAZGO: { value: TipoHallazgo; label: string }[] = [
	{ value: 'NC Mayor', label: 'NC Mayor' },
	{ value: 'NC Menor', label: 'NC Menor' },
	{ value: 'Observación', label: 'Observación' },
	{ value: 'Oportunidad de Mejora', label: 'Oportunidad de Mejora' },
	{ value: 'Servicio no conforme', label: 'Servicio no conforme' },
	{ value: 'Otro', label: 'Otro' }
];

export const FUENTES_HALLAZGO = [
	'Auditoría Interna',
	'Auditoría Externa',
	'Inspección HSEQ',
	'Inspección Gerencial',
	'Revisión por la Dirección',
	'Queja o Reclamo Cliente',
	'Investigación de Incidente/Accidente',
	'Análisis de Indicadores',
	'Sugerencia del Personal',
	'Evaluación de Proveedores',
	'Cambio Normativo',
	'Otro'
] as const;

export const MATRICES_ACTUALIZAR = [
	{ key: 'Matriz Riesgos', label: 'Matriz Riesgos' },
	{ key: 'Peligros', label: 'Peligros' },
	{ key: 'Impactos', label: 'Impactos' },
	{ key: 'Otros', label: 'Otros' }
] as const;

const LEGACY_TIPO_HALLAZGO: Record<string, TipoHallazgo> = {
	'NC. MAYOR': 'NC Mayor',
	'NC MAYOR': 'NC Mayor',
	'No conformidad mayor': 'NC Mayor',
	'NC. MENOR': 'NC Menor',
	'NC MENOR': 'NC Menor',
	'No conformidad menor': 'NC Menor',
	'OBSERVACIÓN': 'Observación',
	Observacion: 'Observación',
	'POSIBILIDAD DE MEJORA': 'Oportunidad de Mejora',
	'Oportunidad de mejora': 'Oportunidad de Mejora'
};

export function normalizarTipoHallazgo(valor: string | undefined | null): TipoHallazgo | '' {
	if (!valor?.trim()) return '';
	const trimmed = valor.trim();
	const legacy = LEGACY_TIPO_HALLAZGO[trimmed] ?? LEGACY_TIPO_HALLAZGO[trimmed.toUpperCase()];
	if (legacy) return legacy;
	if (TIPOS_HALLAZGO.some((t) => t.value === trimmed)) return trimmed as TipoHallazgo;
	return trimmed as TipoHallazgo;
}

export function etiquetaTipoHallazgo(valor: string | undefined | null): string {
	return normalizarTipoHallazgo(valor) || valor?.trim() || '—';
}

export function parseMatricesSeleccionadas(matriz?: string | null): string[] {
	if (!matriz?.trim()) return [];
	return matriz
		.split(/[,;|]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function serializarMatricesSeleccionadas(seleccion: string[]): string | undefined {
	const unicas = [...new Set(seleccion.map((s) => s.trim()).filter(Boolean))];
	return unicas.length > 0 ? unicas.join(', ') : undefined;
}

const MATRIZ_KEYS = MATRICES_ACTUALIZAR.map((m) => m.key);

/** Inicializa checkboxes desde texto libre o valores guardados */
export const ESTADOS_SEGUIMIENTO_PLANEADO = [
	{ value: 'En Proceso', label: 'En proceso' },
	{ value: 'Vencida', label: 'Vencida / Replanteada' },
	{ value: 'Replanteada', label: 'Replanteada' },
	{ value: 'Cerrada', label: 'Cerrada (cumplida)' }
] as const;

export const RESULTADOS_CICLO_EFICACIA = [
	{ value: 'AVANCE_SATISFACTORIO', label: 'Avance satisfactorio' },
	{ value: 'SIN_AVANCES', label: 'Sin avances significativos' },
	{ value: 'IMPEDIMENTO_IDENTIFICADO', label: 'Impedimento identificado' }
] as const;

export const PLAZOS_POR_RIESGO = {
	ALTO: {
		correccion: 15,
		plan_aprobado: 30,
		implementacion: 90,
		ciclo_1: 30,
		ciclo_2: 60,
		ciclo_3: 90,
		eficacia_1: 90,
		eficacia_2: 150
	},
	MEDIO: {
		correccion: 30,
		plan_aprobado: 60,
		implementacion: 120,
		ciclo_1: 40,
		ciclo_2: 80,
		ciclo_3: 120,
		eficacia_1: 120
	},
	BAJO: {
		correccion: 45,
		plan_aprobado: 90,
		implementacion: 180,
		ciclo_1: 60,
		ciclo_2: 120,
		ciclo_3: 180,
		eficacia_1: 180
	}
} as const;

export function addDays(baseDate: string, days: number): string {
	if (!baseDate) return '';
	const [y, m, d_num] = baseDate.split('-').map(Number);
	const d = new Date(y, m - 1, d_num);
	d.setDate(d.getDate() + days);
	
	const y_res = d.getFullYear();
	const m_res = String(d.getMonth() + 1).padStart(2, '0');
	const d_res = String(d.getDate()).padStart(2, '0');
	return `${y_res}-${m_res}-${d_res}`;
}

/**
 * Agrega días hábiles (excluye sábados, domingos y festivos colombianos)
 */
export function addBusinessDays(baseDate: string, days: number): string {
	if (!baseDate) return '';
	
	const [y, m, d_num] = baseDate.split('-').map(Number);
	const date = new Date(y, m - 1, d_num);
	
	let added = 0;
	while (added < days) {
		date.setDate(date.getDate() + 1);
		const dayOfWeek = date.getDay();
		
		// 0 = Domingo, 6 = Sábado
		const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
		const isHoliday = esDiaFestivoColombiano(date.getDate(), date.getMonth() + 1, date.getFullYear());
		
		if (!isWeekend && !isHoliday) {
			added++;
		}
	}
	
	const y_res = date.getFullYear();
	const m_res = String(date.getMonth() + 1).padStart(2, '0');
	const d_res = String(date.getDate()).padStart(2, '0');
	return `${y_res}-${m_res}-${d_res}`;
}

export function formatFechaDisplay(isoDate: string): string {
	if (!isoDate) return '—';
	const [y, m, d] = isoDate.split('-');
	return `${d}/${m}/${y}`;
}

export function calcularPlazosRiesgo(fechaRegistro: string, riesgo: 'ALTO' | 'MEDIO' | 'BAJO' | '') {
	if (!fechaRegistro || !riesgo) return null;
	const plazos = PLAZOS_POR_RIESGO[riesgo];
	if (!plazos) return null;

	return {
		// Solo la corrección usa días hábiles
		fecha_correccion: addBusinessDays(fechaRegistro, plazos.correccion),
		
		// Plan, Implementación y Ciclos usan días calendario
		fecha_plan_aprobado: addDays(fechaRegistro, plazos.plan_aprobado),
		fecha_implementacion: addDays(fechaRegistro, plazos.implementacion),
		ciclo_1: addDays(fechaRegistro, plazos.ciclo_1),
		ciclo_2: addDays(fechaRegistro, plazos.ciclo_2),
		ciclo_3: addDays(fechaRegistro, plazos.ciclo_3),
		eficacia_1: addDays(fechaRegistro, plazos.eficacia_1),
		...(riesgo === 'ALTO' && { eficacia_2: addDays(fechaRegistro, (plazos as any).eficacia_2) })
	};
}

export const ESTADOS_EVIDENCIA = [
	{ value: 'DISPONIBLE', label: 'Disponible' },
	{ value: 'PENDIENTE', label: 'Pendiente' }
] as const;

export const EVALUACIONES_CIERRE = [
	{ value: 'EFICAZ', label: 'Eficaz' },
	{ value: 'NO EFICAZ', label: 'No eficaz' },
	{ value: 'PARCIAL', label: 'Parcial' }
] as const;

export type RegistroSeguimientoForm = {
	fecha_seguimiento: string;
	descripcion_observaciones: string;
	estado_accion: string;
	responsable_seguimiento?: string;
	cargo_responsable_seguimiento?: string;
	adjunto_url?: string;
	replanteo?: {
		nueva_fecha_limite: string;
		responsable: string;
		justificacion: string;
		cambios: string;
	};
};

export function crearRegistroSeguimientoVacio(): RegistroSeguimientoForm {
	return {
		fecha_seguimiento: '',
		descripcion_observaciones: '',
		estado_accion: 'En Proceso',
		responsable_seguimiento: '',
		cargo_responsable_seguimiento: '',
		replanteo: {
			nueva_fecha_limite: '',
			responsable: '',
			justificacion: '',
			cambios: ''
		}
	};
}

/** Consejo Colombiano: hasta 7 niveles de “por qué”; se permiten más si aplica */
export const CAUSAS_POR_DEFECTO = 1;
export const MAX_CAUSAS = 15;
export const MIN_CICLOS_EFICACIA = 1;
export const MIN_EVIDENCIAS = 1;
export const INTERVALO_SEGUIMIENTO_DIAS = 15;

export function crearCausasIniciales(cantidad = CAUSAS_POR_DEFECTO) {
	return Array.from({ length: cantidad }, (_, i) => ({
		orden: i + 1,
		analisis_causa: '',
		es_causa_raiz: false,
		descripcion_plan_accion: '',
		fecha_limite_implementacion: '',
		responsable_ejecucion: '',
		seguimientos: [crearRegistroSeguimientoVacio()]
	}));
}

export function crearCiclosEficaciaIniciales(minimo = MIN_CICLOS_EFICACIA) {
	return Array.from({ length: minimo }, (_, i) => ({
		numero_ciclo: i + 1,
		fecha_seguimiento: '',
		descripcion: '',
		resultado_ciclo: '' as '' | 'AVANCE_SATISFACTORIO' | 'SIN_AVANCES' | 'IMPEDIMENTO_IDENTIFICADO',
		responsable: '',
		cargo: '',
		criterios_cumplidos: [] as string[]
	}));
}

/** Una línea por criterio (numeración o viñetas opcional) */
export function parseListaCriterios(texto: string | undefined | null): string[] {
	if (!texto?.trim()) return [];
	return texto
		.split(/\n+/)
		.map((l) => l.replace(/^\s*[\d\-•*.)]+\s*/, '').trim())
		.filter(Boolean);
}

export function etiquetaResultadoCiclo(valor: string | undefined | null): string {
	if (!valor) return '—';
	return RESULTADOS_CICLO_EFICACIA.find((r) => r.value === valor)?.label ?? valor;
}

export function etiquetaEstadoSeguimiento(valor: string | undefined | null): string {
	if (!valor) return '—';
	return ESTADOS_SEGUIMIENTO_PLANEADO.find((e) => e.value === valor)?.label ?? valor;
}

type FechaSeguimientoFuente = {
	fecha_implementacion?: string;
	fecha_seguimiento?: string;
	seguimientos_correccion?: { fecha_seguimiento?: string }[];
	ciclos_eficacia?: { fecha_seguimiento?: string }[];
	causas?: {
		fecha_seguimiento?: string;
		seguimientos?: { fecha_seguimiento?: string }[];
	}[];
};

function extraerFechaIso(fecha?: string): string | null {
	if (!fecha) return null;
	return fecha.split('T')[0];
}

export function ultimaFechaSeguimientoAccion(accion: FechaSeguimientoFuente): string | null {
	const fechas: string[] = [];
	const push = (f?: string) => {
		const iso = extraerFechaIso(f);
		if (iso) fechas.push(iso);
	};

	push(accion.fecha_implementacion);
	push(accion.fecha_seguimiento);
	accion.seguimientos_correccion?.forEach((s) => push(s.fecha_seguimiento));
	accion.ciclos_eficacia?.forEach((c) => push(c.fecha_seguimiento));
	accion.causas?.forEach((causa) => {
		push(causa.fecha_seguimiento);
		causa.seguimientos?.forEach((s) => push(s.fecha_seguimiento));
	});

	if (!fechas.length) return null;
	return fechas.sort().at(-1) ?? null;
}

export function calcularProximoSeguimiento(
	accion: FechaSeguimientoFuente & { evaluacion_cierre_eficaz?: string; fecha_cierre_definitivo?: string }
): string | null {
	if (accion.evaluacion_cierre_eficaz === 'EFICAZ' && accion.fecha_cierre_definitivo) {
		return null;
	}
	const ultima = ultimaFechaSeguimientoAccion(accion);
	if (!ultima) return null;
	const [y, m, d] = ultima.split('-').map(Number);
	const siguiente = new Date(y, m - 1, d);
	siguiente.setDate(siguiente.getDate() + INTERVALO_SEGUIMIENTO_DIAS);
	return siguiente.toISOString().split('T')[0];
}

export function accionTieneCierreDefinitivo(accion: {
	evaluacion_cierre_eficaz?: string;
	fecha_cierre_definitivo?: string;
}): boolean {
	return accion.evaluacion_cierre_eficaz === 'EFICAZ' && Boolean(accion.fecha_cierre_definitivo);
}

export function crearEvidenciaVacia(orden: number) {
	return {
		orden,
		tipo_evidencia: '',
		descripcion: '',
		fecha: '',
		estado_ubicacion: '' as '' | 'DISPONIBLE' | 'PENDIENTE'
	};
}

export function inicializarMatricesDesdeRegistro(
	matriz?: string | null,
	requiere?: boolean | null
): { seleccion: string[]; otrosDetalle: string } {
	const partes = parseMatricesSeleccionadas(matriz);
	const seleccion = partes.filter(
		(p) => (MATRIZ_KEYS as readonly string[]).includes(p) && p !== 'Otros'
	);
	const otrosPartes = partes.filter((p) => !MATRIZ_KEYS.includes(p) || p.startsWith('Otros:'));
	let otrosDetalle = otrosPartes
		.map((p) => (p.startsWith('Otros:') ? p.replace(/^Otros:\s*/, '') : p))
		.filter(Boolean)
		.join(', ');

	if (!seleccion.length && !otrosDetalle && matriz?.trim() && requiere) {
		otrosDetalle = matriz.trim();
	}

	if (otrosDetalle && !seleccion.includes('Otros')) {
		seleccion.push('Otros');
	}

	return { seleccion, otrosDetalle };
}
