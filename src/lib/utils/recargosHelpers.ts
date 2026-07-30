// src/lib/utils/recargosHelpers.ts

/**
 * Constantes para cálculo de recargos.
 *
 * Los porcentajes Y los umbrales de jornada (jornada_normal / jornada_festiva)
 * ya NO están hardcoded aquí. Se leen desde la base de datos
 * (configuraciones_salarios con vigencias) y se pasan como parte de
 * `ConfigRecargosVigente` a `calcularRecargos()` para soportar múltiples
 * configs por fecha.
 *
 * Los defaults acá quedan solo como fallback de retrocompatibilidad
 * (cálculos en vivo sin config resuelta).
 */
export const HORAS_LIMITE = {
	JORNADA_NORMAL: 10.33, // 10 horas 20 minutos - extras empiezan después de esto (días normales)
	JORNADA_FESTIVA: 7.33, // 7 horas 20 minutos - RD fijo en domingos/festivos, extras después de esto
	INICIO_NOCTURNO: 19, // 19:00 (7 PM)
	FIN_NOCTURNO: 6 // 06:00 (6 AM)
} as const;

/**
 * Umbrales de jornada aplicables a un día concreto. Se resuelve desde
 * la config salarial vigente (configuraciones_salarios.jornada_normal_horas
 * y .jornada_festiva_horas).
 *
 * Si la config no tiene valores (null/0) o el caller no la provee,
 * se usan los defaults de `HORAS_LIMITE` para mantener el comportamiento
 * histórico.
 */
export interface UmbralesJornada {
	jornadaNormal: number;
	jornadaFestiva: number;
	inicioNocturno: number;
	finNocturno: number;
}

export const UMBRALES_DEFECTO: UmbralesJornada = {
	jornadaNormal: HORAS_LIMITE.JORNADA_NORMAL,
	jornadaFestiva: HORAS_LIMITE.JORNADA_FESTIVA,
	inicioNocturno: HORAS_LIMITE.INICIO_NOCTURNO,
	finNocturno: HORAS_LIMITE.FIN_NOCTURNO
};

/**
 * Resuelve umbrales de jornada a partir de la config cruda que llega
 * del backend. Devuelve siempre un objeto válido (usa defaults si falta
 * algún campo o si es null/0).
 */
export function umbralesDesdeConfig(raw: {
	jornada_normal_horas?: number | string | null;
	jornada_festiva_horas?: number | string | null;
} | null | undefined): UmbralesJornada {
	if (!raw) return UMBRALES_DEFECTO;
	const toNum = (v: any, fb: number) => {
		if (v == null) return fb;
		const n = Number(v);
		return isNaN(n) || n <= 0 ? fb : n;
	};
	return {
		jornadaNormal: toNum(raw.jornada_normal_horas, UMBRALES_DEFECTO.jornadaNormal),
		jornadaFestiva: toNum(raw.jornada_festiva_horas, UMBRALES_DEFECTO.jornadaFestiva),
		inicioNocturno: UMBRALES_DEFECTO.inicioNocturno,
		finNocturno: UMBRALES_DEFECTO.finNocturno
	};
}

/**
 * Porcentajes de un tipo de recargo vigentes en una fecha concreta.
 * Se obtiene desde la BD (endpoint /api/recargos/tipos-recargo/vigentes)
 * o desde un snapshot guardado en detalles_recargos_dias.
 */
export interface PorcentajesRecargo {
	HED: number;
	HEN: number;
	HEFD: number;
	HEFN: number;
	RN: number;
	RD: number;
	RNDF: number;
}

/**
 * Configuración completa de recargos vigente en una fecha.
 * Encapsula los %, el valor hora (calculado desde salario/horas_mes)
 * Y los umbrales de jornada aplicables a ese día.
 *
 * Los umbrales se propagan para que las funciones de cálculo en vivo
 * (preview del modal, desglose) respeten la misma lógica que el backend.
 */
export interface ConfigRecargosVigente {
	porcentajes: PorcentajesRecargo;
	valorHora: number;
	salarioBasico: number;
	horasMensualesBase: number;
	configuracionSalarioId: string | null;
	etiqueta: string;
	/** Umbral de horas ordinarias para días normales (default 10.33) */
	jornadaNormal: number;
	/** Umbral de horas ordinarias para domingos/festivos (default 7.33) */
	jornadaFestiva: number;
}

/**
 * Obtener cantidad de días en un mes
 */
export function getDaysInMonth(mes: number, año: number): number {
	return new Date(año, mes, 0).getDate();
}

/**
 * Verificar si un día es domingo
 */
export function esDomingo(dia: number, mes: number, año: number): boolean {
	const fecha = new Date(año, mes - 1, dia);
	return fecha.getDay() === 0;
}

/**
 * Verificar si un día es festivo
 */
export function esDiaFestivo(dia: number, diasFestivos: number[] = []): boolean {
	return diasFestivos.includes(dia);
}

/**
 * Verificar si un día es domingo O festivo
 */
export function esDomingoOFestivo(
	dia: number,
	mes: number,
	año: number,
	diasFestivos: number[] = []
): boolean {
	return esDomingo(dia, mes, año) || esDiaFestivo(dia, diasFestivos);
}

/**
 * Redondear número a decimales especificados
 */
export function redondear(numero: number, decimales = 2): number {
	const factor = Math.pow(10, decimales);
	return Math.round(numero * factor) / factor;
}

/**
 * Formatear horas decimales a HH:MM
 */
export function formatearHoraDecimal(hora: number): string {
	const horas = Math.floor(hora);
	const minutosDecimal = hora - horas;
	const minutos = Math.round(minutosDecimal * 60);

	return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
}

/**
 * Convertir HH:MM a decimal
 */
export function convertirHoraADecimal(hora: string): number {
	const [horas, minutos] = hora.split(':').map(Number);
	return horas + minutos / 60;
}

/**
 * Formatear valor monetario COP
 */
export function formatearCOP(valor: number): string {
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(Math.round(valor));
}

/**
 * Obtener label legible de estado
 */
export function getEstadoLabel(estado: string): string {
	const labels: Record<string, string> = {
		pendiente: 'Pendiente',
		liquidada: 'Liquidada',
		facturada: 'Facturada',
		encontrada: 'Encontrada',
		no_esta: 'No está',
		noesta: 'No está',
		'no-esta': 'No está'
	};

	return labels[estado?.toLowerCase()] || estado || 'Desconocido';
}

/**
 * Obtener color de badge según estado
 */
export function getEstadoColor(estado: string): string {
	const colors: Record<string, string> = {
		pendiente: 'bg-amber-500',
		liquidada: 'bg-purple-500',
		facturada: 'bg-emerald-500',
		encontrada: 'bg-cyan-500',
		no_esta: 'bg-red-500',
		noesta: 'bg-red-500',
		'no-esta': 'bg-red-500'
	};

	return colors[estado?.toLowerCase()] || 'bg-gray-500';
}

/**
 * Obtener color de fondo para fila según estado
 */
export function getEstadoBgColor(estado: string): string {
	const colors: Record<string, string> = {
		pendiente: 'bg-white',
		liquidada: 'bg-purple-50',
		facturada: 'bg-emerald-50',
		encontrada: 'bg-cyan-50',
		no_esta: 'bg-red-50',
		noesta: 'bg-red-50',
		'no-esta': 'bg-red-50'
	};

	return colors[estado?.toLowerCase()] || 'bg-white';
}

/**
 * Formatear número de planilla con prefijo TM-
 */
export function formatearNumeroPlanilla(numero: string | number | null): string {
	if (!numero) return '';

	const numStr = numero.toString();

	// Si ya tiene prefijo TM-, retornar como está
	if (numStr.startsWith('TM-')) return numStr;

	// Si es solo números, agregar prefijo
	if (/^\d+$/.test(numStr)) {
		return `TM-${numStr}`;
	}

	return numStr;
}

/**
 * Convertir número a formato con coma decimal (para Excel)
 */
export function formatNumberWithComma(value: string | number): string {
	if (value === '' || value === '-' || value === null || value === undefined) {
		return value?.toString() || '';
	}

	const numValue = typeof value === 'string' ? parseFloat(value) : value;

	if (isNaN(numValue)) {
		return value.toString();
	}

	return numValue.toString().replace('.', ',');
}

/**
 * Obtener nombre del mes
 */
export function getNombreMes(mes: number): string {
	const meses = [
		'Enero',
		'Febrero',
		'Marzo',
		'Abril',
		'Mayo',
		'Junio',
		'Julio',
		'Agosto',
		'Septiembre',
		'Octubre',
		'Noviembre',
		'Diciembre'
	];

	return meses[mes - 1] || '';
}

/**
 * Obtener nombre corto del mes
 */
export function getNombreMesCorto(mes: number): string {
	const meses = [
		'Ene',
		'Feb',
		'Mar',
		'Abr',
		'May',
		'Jun',
		'Jul',
		'Ago',
		'Sep',
		'Oct',
		'Nov',
		'Dic'
	];

	return meses[mes - 1] || '';
}

/**
 * Convertir valor a número seguro
 */
export function toNumber(value: any): number {
	const num = parseFloat(value);
	return isNaN(num) ? 0 : num;
}

export function getDia(fechaISO: Date) {
	const fecha = new Date(fechaISO);
	return fecha.getUTCDate(); // usa UTC porque tu fecha viene en Z
}

/**
 * Calcular total de horas trabajadas
 */
export function calcularHorasTrabajadas(horaInicio: number, horaFin: number): number {
	let totalHoras = horaFin - horaInicio;

	// Si cruzó medianoche (hora fin < hora inicio)
	if (totalHoras < 0) {
		totalHoras += 24;
	}

	return redondear(totalHoras);
}


/**
 * Resultado monetario de aplicar los % vigentes a un día.
 * Se calcula a partir de los snapshots guardados en detalles_recargos_dias,
 * o en vivo con la config vigente si se pasa por parámetro.
 */
export interface ValoresMonetariosDia {
	hed: number;
	hen: number;
	hefd: number;
	hefn: number;
	rn: number;
	rd: number;
	rndf: number;
	total: number;
	/** Etiqueta de la config usada (para mostrar en UI) */
	configEtiqueta: string | null;
	/** ID de la config usada */
	configuracionSalarioId: string | null;
	/** % efectivos aplicados (snapshot) */
	porcentajesAplicados: PorcentajesRecargo;
	/** Valor hora efectivo usado */
	valorHoraEfectivo: number;
}


/**
 * Calcula el valor monetario de los recargos de un día usando una config vigente.
 *
 * Reglas (idénticas al backend):
 *   - Horas extras: valorHora × (1 + %/100)
 *   - Recargos: valorHora × %/100
 *   - Se redondea por tipo con Math.round (estilo Excel)
 */
export function calcularValoresMonetarios(
	recargos: {
		HED: number;
		HEN: number;
		HEFD: number;
		HEFN: number;
		RN: number;
		RD: number;
		RNDF: number;
	},
	config: ConfigRecargosVigente,
	excluirRNDF: boolean = false
): ValoresMonetariosDia {
	const { porcentajes, valorHora, etiqueta, configuracionSalarioId } = config;

	const tasa = (codigo: keyof PorcentajesRecargo, esHoraExtra: boolean) =>
		esHoraExtra ? valorHora * (1 + porcentajes[codigo] / 100) : valorHora * (porcentajes[codigo] / 100);

	const hed = Math.round(recargos.HED * tasa('HED', true));
	const hen = Math.round(recargos.HEN * tasa('HEN', true));
	const hefd = Math.round(recargos.HEFD * tasa('HEFD', true));
	const hefn = Math.round(recargos.HEFN * tasa('HEFN', true));
	const rn = Math.round(recargos.RN * tasa('RN', false));
	const rd = Math.round(recargos.RD * tasa('RD', false));
	const rndf = excluirRNDF ? 0 : Math.round(recargos.RNDF * tasa('RNDF', false));

	const total = hed + hen + hefd + hefn + rn + rd + rndf;

	return {
		hed,
		hen,
		hefd,
		hefn,
		rn,
		rd,
		rndf,
		total,
		configEtiqueta: etiqueta,
		configuracionSalarioId,
		porcentajesAplicados: porcentajes,
		valorHoraEfectivo: valorHora
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO CON CONTINUIDAD DE TURNO — orquestador modular
// ═══════════════════════════════════════════════════════════════════════════

export {
	calcularRecargosConContinuacion,
	type DiaLaboralRecargo,
	type RecargosDiaResultado,
	type ResolverConfigParaFecha,
	type JornadaCalculada,
	type Segmento,
	type Tramo,
	type Franja,
	type TipoSegmento,
	type CodigoRecargo,
	type RecargosResultado,
	type TurnoContexto,
	crearJornada,
	dividirSegmentos,
	partirTodosLosSegmentos,
	clasificarTramo,
	sumarResultados,
	postProceso,
	resolverTurnoContinuo,
	resolverSkipFlags,
	esHoraSkip,
	esNocturna as esNocturnaRecargo,
	franjaDeHora
} from './recargos/index';
