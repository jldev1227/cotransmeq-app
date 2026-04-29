// src/lib/utils/recargosHelpers.ts

/**
 * Constantes para cálculo de recargos
 */
export const HORAS_LIMITE = {
	JORNADA_NORMAL: 10.33, // 10 horas 20 minutos - extras empiezan después de esto (días normales)
	JORNADA_FESTIVA: 7.33, // 7 horas 20 minutos - RD fijo en domingos/festivos, extras después de esto
	INICIO_NOCTURNO: 19, // 19:00 (7 PM)
	FIN_NOCTURNO: 6 // 06:00 (6 AM)
} as const;

export const PORCENTAJES_RECARGO = {
	HE_DIURNA: 25,
	HE_NOCTURNA: 75,
	HE_FESTIVA_DIURNA: 105,
	HE_FESTIVA_NOCTURNA: 155,
	RECARGO_NOCTURNO_DOMINICAL_FESTIVO: 115,
	RECARGO_NOCTURNO: 35,
	RECARGO_DOMINICAL: 80
} as const;

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

export function getDia(fechaISO : Date) {
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
 * Calcular horas extras nocturnas para un turno (auxiliar)
 * Calcula qué fracción de las horas extras cae en horario nocturno (≥19:00)
 * usando el punto donde termina la jornada ordinaria como referencia.
 *
 * Ejemplo: turno 4:00-20:00 (16h), jornada=9.33h
 *   horaFinJornada = 4 + 9.33 = 13.33
 *   nocStart = max(19, 13.33) = 19
 *   extrasNocturnas = 20 - 19 = 1h
 *   extrasDiurnas = (16-9.33) - 1 = 5.67h
 */
function calcularExtrasNocturnas(
	horaInicio: number,
	horaFin: number,
	totalHoras: number,
	jornada: number
): number {
	const extras = totalHoras - jornada;
	if (extras <= 0) return 0;

	const horaFinJornada = horaInicio + jornada;
	let extNoc = 0;

	if (horaFin > HORAS_LIMITE.INICIO_NOCTURNO) {
		const nocStart = Math.max(HORAS_LIMITE.INICIO_NOCTURNO, horaFinJornada);
		if (nocStart < horaFin) {
			extNoc = horaFin - nocStart;
		}
	}

	return Math.min(extNoc, extras);
}

/**
 * Calcular Hora Extra Diurna (HED)
 * Fórmula: Si es domingo o festivo → 0
 *          Si NO: extras = total_horas - 9.33, luego restar la porción nocturna
 */
export function calcularHED(
	dia: number,
	mes: number,
	año: number,
	horaInicio: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;
	if (totalHoras <= HORAS_LIMITE.JORNADA_NORMAL) return 0;

	const extras = totalHoras - HORAS_LIMITE.JORNADA_NORMAL;
	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

	return redondear(extras - extNoc);
}

/**
 * Calcular Hora Extra Nocturna (HEN)
 * Fórmula: Si es domingo o festivo → 0
 *          Si NO: la porción de extras que cae en horario nocturno (≥19:00)
 */
export function calcularHEN(
	dia: number,
	mes: number,
	año: number,
	horaInicio: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;
	if (totalHoras <= HORAS_LIMITE.JORNADA_NORMAL) return 0;

	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

	return redondear(extNoc);
}

/**
 * Calcular Hora Extra Festiva Diurna (HEFD)
 * Fórmula: Si es domingo o festivo:
 *            extras = total_horas - 10.33 (misma jornada que día normal), luego restar la porción nocturna
 *          Si NO → 0
 */
export function calcularHEFD(
	dia: number,
	mes: number,
	año: number,
	horaInicio: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	if (!esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;
	if (totalHoras <= HORAS_LIMITE.JORNADA_NORMAL) return 0;

	const extras = totalHoras - HORAS_LIMITE.JORNADA_NORMAL;
	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

	return redondear(extras - extNoc);
}

/**
 * Calcular Hora Extra Festiva Nocturna (HEFN)
 * Fórmula: Si es domingo o festivo:
 *            la porción de extras (después de 10.33h) que cae en horario nocturno (≥19:00)
 *          Si NO → 0
 */
export function calcularHEFN(
	dia: number,
	mes: number,
	año: number,
	horaInicio: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	if (!esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;
	if (totalHoras <= HORAS_LIMITE.JORNADA_NORMAL) return 0;

	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

	return redondear(extNoc);
}

/**
 * Calcular Recargo Nocturno (RN)
 * Fórmula: Recargo por iniciar antes de las 6:00 AM + Recargo por terminar después de las 21:00
 */
export function calcularRecargoNocturno(horaInicio: number, horaFin: number): number {
	let recargoNocturno = 0;

	// Recargo por iniciar antes de las 6:00 AM
	if (horaInicio < HORAS_LIMITE.FIN_NOCTURNO) {
		recargoNocturno += HORAS_LIMITE.FIN_NOCTURNO - horaInicio;
	}

	// Recargo por terminar después de las 21:00
	if (horaFin > HORAS_LIMITE.INICIO_NOCTURNO) {
		if (horaInicio > HORAS_LIMITE.INICIO_NOCTURNO) {
			// Si también inició después de las 21:00, es toda la jornada
			recargoNocturno += horaFin - horaInicio;
		} else {
			// Solo las horas después de las 21:00
			recargoNocturno += horaFin - HORAS_LIMITE.INICIO_NOCTURNO;
		}
	}

	return redondear(recargoNocturno);
}

/**
 * Calcular Recargo Dominical (RD)
 * En domingo o festivo:
 * - Si trabajó >= 7.33h → RD = 7.33 fijas
 * - Si trabajó < 7.33h → RD = horas diurnas reales (las nocturnas van a RNDF)
 */
export function calcularRecargoDominical(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	if (!esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;
	if (totalHoras <= 0) return 0;
	if (totalHoras >= HORAS_LIMITE.JORNADA_FESTIVA) return HORAS_LIMITE.JORNADA_FESTIVA;
	// Si trabajó menos de 7.33h, devolver las horas reales (la parte nocturna se calcula aparte como RNDF)
	return redondear(totalHoras);
}

/**
 * Calcular todos los recargos de un día
 */
export interface RecargosCalculados {
	totalHoras: number;
	horaExtraDiurna: number;
	horaExtraNocturna: number;
	horaExtraFestivaDiurna: number;
	horaExtraFestivaNocturna: number;
	recargoNocturnoDominicalFestivo: number;
	recargoNocturno: number;
	recargoDominical: number;
	esDomingo: boolean;
	esFestivo: boolean;
	esDomingoOFestivo: boolean;
}

export function calcularRecargos(params: {
	dia: number;
	mes: number;
	año: number;
	horaInicio: number;
	horaFin: number;
	diasFestivos: number[];
	excluirRNDF?: boolean;
}): RecargosCalculados {
	const { dia, mes, año, horaInicio, horaFin, diasFestivos = [], excluirRNDF = false } = params;

	// Calcular total de horas
	const totalHoras = calcularHorasTrabajadas(horaInicio, horaFin);

	const es_domingo = esDomingo(dia, mes, año);
	const es_festivo = esDiaFestivo(dia, diasFestivos);
	const es_domingo_o_festivo = es_domingo || es_festivo;

	// Las extras SIEMPRE empiezan después de 10.33h, sin importar tipo de día
	const jornadaOrdinaria = HORAS_LIMITE.JORNADA_NORMAL;

	let hed = 0, hen = 0, hefd = 0, hefn = 0, rndf = 0, rn = 0, rd = 0;

	if (totalHoras <= 0) {
		return {
			totalHoras,
			horaExtraDiurna: 0, horaExtraNocturna: 0,
			horaExtraFestivaDiurna: 0, horaExtraFestivaNocturna: 0,
			recargoNocturnoDominicalFestivo: 0, recargoNocturno: 0, recargoDominical: 0,
			esDomingo: es_domingo, esFestivo: es_festivo, esDomingoOFestivo: es_domingo_o_festivo
		};
	}

	// Ajustar horaFin para turnos que cruzan medianoche
	let horaFinAjustada = horaFin;
	if (horaFinAjustada <= horaInicio) {
		horaFinAjustada += 24;
	}

	function esNocturna(hora: number): boolean {
		const h = hora % 24;
		return h >= HORAS_LIMITE.INICIO_NOCTURNO || h < HORAS_LIMITE.FIN_NOCTURNO;
	}

	// Recorrer el turno en pasos de 0.5h, clasificando cada fracción
	let horaActual = horaInicio;
	let horasAcumuladas = 0;

	while (horaActual < horaFinAjustada) {
		const siguienteHora = Math.min(horaActual + 0.5, horaFinAjustada);
		const fraccion = siguienteHora - horaActual;
		const nocturna = esNocturna(horaActual);
		const esExtra = horasAcumuladas >= jornadaOrdinaria;

		if (es_domingo_o_festivo) {
			if (esExtra) {
				if (nocturna) hefn += fraccion;
				else hefd += fraccion;
			} else {
				const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
				if (fraccion <= horasRestantesJornada) {
					if (nocturna) rndf += fraccion;
					else rd += fraccion;
				} else {
					const parteOrdinaria = horasRestantesJornada;
					const parteExtra = fraccion - parteOrdinaria;
					if (nocturna) { rndf += parteOrdinaria; hefn += parteExtra; }
					else { rd += parteOrdinaria; hefd += parteExtra; }
				}
			}
		} else {
			// Día normal
			if (esExtra) {
				if (nocturna) hen += fraccion;
				else hed += fraccion;
			} else {
				const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
				if (fraccion <= horasRestantesJornada) {
					if (nocturna) rn += fraccion;
					// diurna ordinaria no genera recargo
				} else {
					const parteOrdinaria = horasRestantesJornada;
					const parteExtra = fraccion - parteOrdinaria;
					if (nocturna) { rn += parteOrdinaria; hen += parteExtra; }
					else { hed += parteExtra; }
				}
			}
		}

		horasAcumuladas += fraccion;
		horaActual = siguienteHora;
	}

	// En domingo/festivo:
	// RNDF = TODAS las horas nocturnas del turno (ordinarias + extras)
	// RD = 7.33 - RNDF (las nocturnas se restan del dominical)
	// PAREX no reconoce RNDF, así que no se resta
	if (es_domingo_o_festivo) {
		// Recalcular RNDF como TODAS las horas nocturnas del turno
		let totalNocturnas = 0;
		let h = horaInicio;
		while (h < horaFinAjustada) {
			const sig = Math.min(h + 0.5, horaFinAjustada);
			if (esNocturna(h)) totalNocturnas += sig - h;
			h = sig;
		}
		rndf = totalNocturnas;

		if (totalHoras >= HORAS_LIMITE.JORNADA_FESTIVA) {
			rd = HORAS_LIMITE.JORNADA_FESTIVA;
		}

		if (!excluirRNDF) {
			// Restar RNDF del RD (las horas nocturnas no deben contar como RD)
			rd = Math.max(rd - rndf, 0);
		} else {
			// PAREX: no reconoce RNDF, RD se queda intacto
			rndf = 0;
		}
	}

	return {
		totalHoras,
		horaExtraDiurna: redondear(hed),
		horaExtraNocturna: redondear(hen),
		horaExtraFestivaDiurna: redondear(hefd),
		horaExtraFestivaNocturna: redondear(hefn),
		recargoNocturnoDominicalFestivo: redondear(rndf),
		recargoNocturno: redondear(rn),
		recargoDominical: redondear(rd),
		esDomingo: es_domingo,
		esFestivo: es_festivo,
		esDomingoOFestivo: es_domingo_o_festivo
	};
}
