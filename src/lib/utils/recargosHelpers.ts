// src/lib/utils/recargosHelpers.ts

/**
 * Constantes para cálculo de recargos
 */
export const HORAS_LIMITE = {
	JORNADA_NORMAL: 9.33, // 9 horas 20 minutos - extras empiezan después de esto (días normales)
	JORNADA_FESTIVA: 7.33, // 7 horas 20 minutos - extras empiezan después de esto (domingos/festivos)
	INICIO_NOCTURNO: 19, // 19:00 (7 PM)
	FIN_NOCTURNO: 6 // 06:00 (6 AM)
} as const;

export const PORCENTAJES_RECARGO = {
	HE_DIURNA: 25,
	HE_NOCTURNA: 75,
	HE_FESTIVA_DIURNA: 105,
	HE_FESTIVA_NOCTURNA: 155,
	RECARGO_NOCTURNO: 35,
	RECARGO_DOMINICAL: 80,
	RECARGO_NOCTURNO_DOMINICAL_FESTIVO: 115
} as const;/**
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
		minimumFractionDigits: 0
	}).format(valor);
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
		'no-esta': 'No está',
		borrador: 'Borrador',
		activo: 'Activo',
		completado: 'Completado',
		liquidado: 'Liquidado',
		cancelado: 'Cancelado'
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
		facturada: 'bg-orange-500',
		encontrada: 'bg-cyan-500',
		no_esta: 'bg-red-500',
		noesta: 'bg-red-500',
		'no-esta': 'bg-red-500',
		borrador: 'bg-gray-400',
		activo: 'bg-green-500',
		completado: 'bg-blue-500',
		liquidado: 'bg-indigo-500',
		cancelado: 'bg-red-600'
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
		facturada: 'bg-orange-50',
		encontrada: 'bg-cyan-50',
		no_esta: 'bg-red-50',
		noesta: 'bg-red-50',
		'no-esta': 'bg-red-50',
		borrador: 'bg-gray-50',
		activo: 'bg-green-50',
		completado: 'bg-blue-50',
		liquidado: 'bg-indigo-50',
		cancelado: 'bg-red-50'
	};

	return colors[estado?.toLowerCase()] || 'bg-white';
}

/**
 * Formatear número de planilla con prefijo CM-
 */
export function formatearNumeroPlanilla(numero: string | number | null): string {
	if (!numero) return '';

	const numStr = numero.toString();

	// Si ya tiene prefijo CM-, retornar como está
	if (numStr.startsWith('CM-')) return numStr;

	// Si es solo números, agregar prefijo
	if (/^\d+$/.test(numStr)) {
		return `CM-${numStr}`;
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
 * Calcular Hora Extra Diurna (HED) - mantener para compatibilidad
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
 * Calcular Hora Extra Nocturna (HEN) - mantener para compatibilidad
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
 * Calcular Hora Extra Festiva Diurna (HEFD) - mantener para compatibilidad
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
	if (totalHoras <= HORAS_LIMITE.JORNADA_FESTIVA) return 0;

	const extras = totalHoras - HORAS_LIMITE.JORNADA_FESTIVA;
	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_FESTIVA);

	return redondear(extras - extNoc);
}

/**
 * Calcular Hora Extra Festiva Nocturna (HEFN) - mantener para compatibilidad
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
	if (totalHoras <= HORAS_LIMITE.JORNADA_FESTIVA) return 0;

	const extNoc = calcularExtrasNocturnas(horaInicio, horaFin, totalHoras, HORAS_LIMITE.JORNADA_FESTIVA);

	return redondear(extNoc);
}

/**
 * Calcular Recargo Nocturno (RN) - SOLO horas nocturnas dentro de la jornada ordinaria
 * NO incluye horas nocturnas que son extras (esas van a HEN o HEFN)
 */
export function calcularRecargoNocturno(horaInicio: number, horaFin: number, totalHoras?: number, esDomFest?: boolean): number {
	// Si no se pasan parámetros extra, usar lógica legacy para compatibilidad
	if (totalHoras === undefined) {
		let recargoNocturno = 0;
		if (horaInicio < HORAS_LIMITE.FIN_NOCTURNO) {
			recargoNocturno += HORAS_LIMITE.FIN_NOCTURNO - horaInicio;
		}
		if (horaFin > HORAS_LIMITE.INICIO_NOCTURNO) {
			if (horaInicio > HORAS_LIMITE.INICIO_NOCTURNO) {
				recargoNocturno += horaFin - horaInicio;
			} else {
				recargoNocturno += horaFin - HORAS_LIMITE.INICIO_NOCTURNO;
			}
		}
		return redondear(recargoNocturno);
	}

	// Nueva lógica: solo horas nocturnas dentro de la jornada ordinaria
	const jornadaOrdinaria = esDomFest ? HORAS_LIMITE.JORNADA_FESTIVA : HORAS_LIMITE.JORNADA_NORMAL;
	const horaFinJornada = Math.min(horaInicio + jornadaOrdinaria, horaFin);
	let recargoNocturno = 0;

	if (horaInicio < HORAS_LIMITE.FIN_NOCTURNO) {
		recargoNocturno += Math.min(HORAS_LIMITE.FIN_NOCTURNO, horaFinJornada) - horaInicio;
	}
	if (horaFinJornada > HORAS_LIMITE.INICIO_NOCTURNO) {
		const nocStart = Math.max(HORAS_LIMITE.INICIO_NOCTURNO, horaInicio);
		recargoNocturno += horaFinJornada - nocStart;
	}

	return redondear(Math.max(0, recargoNocturno));
}

/**
 * Calcular Recargo Dominical (RD) - SOLO horas DIURNAS dentro de la jornada ordinaria
 * Las horas nocturnas de la jornada ya van a RNDF
 */
export function calcularRecargoDominical(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[] = [],
	horaInicio?: number,
	horaFin?: number
): number {
	if (!esDomingoOFestivo(dia, mes, año, diasFestivos)) return 0;

	// Si no se pasan hora_inicio/fin, usar lógica legacy
	if (horaInicio === undefined || horaFin === undefined) {
		return redondear(
			totalHoras <= HORAS_LIMITE.JORNADA_FESTIVA ? totalHoras : HORAS_LIMITE.JORNADA_FESTIVA
		);
	}

	// Nueva lógica: RD = jornada ordinaria - horas nocturnas dentro de la jornada
	const jornadaReal = Math.min(totalHoras, HORAS_LIMITE.JORNADA_FESTIVA);
	const horaFinJornada = Math.min(horaInicio + jornadaReal, horaFin);
	
	// Calcular horas nocturnas dentro de la jornada ordinaria
	let nocturnasEnJornada = 0;
	if (horaInicio < HORAS_LIMITE.FIN_NOCTURNO) {
		nocturnasEnJornada += Math.min(HORAS_LIMITE.FIN_NOCTURNO, horaFinJornada) - horaInicio;
	}
	if (horaFinJornada > HORAS_LIMITE.INICIO_NOCTURNO) {
		const nocStart = Math.max(HORAS_LIMITE.INICIO_NOCTURNO, horaInicio);
		nocturnasEnJornada += horaFinJornada - nocStart;
	}

	return redondear(Math.max(0, jornadaReal - nocturnasEnJornada));
}

/**
 * Calcular todos los recargos de un día
 * Lógica unificada:
 * - Jornada ordinaria (primeras 7.33h festivo / 9.33h normal):
 *     Nocturnas → RNDF (dom/fest) o RN (normal)
 *     Diurnas → RD (dom/fest) o sin recargo (normal)
 * - Horas extras (después de la jornada):
 *     Nocturnas → HEFN (dom/fest) o HEN (normal)
 *     Diurnas → HEFD (dom/fest) o HED (normal)
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
}): RecargosCalculados {
	const { dia, mes, año, horaInicio, horaFin, diasFestivos = [] } = params;

	const totalHoras = calcularHorasTrabajadas(horaInicio, horaFin);
	const esDomFest = esDomingoOFestivo(dia, mes, año, diasFestivos);

	// Determinar jornada ordinaria según tipo de día
	const jornadaOrdinaria = esDomFest
		? HORAS_LIMITE.JORNADA_FESTIVA
		: HORAS_LIMITE.JORNADA_NORMAL;

	// Función helper para verificar si una hora es nocturna (19:00-06:00)
	function esNocturna(hora: number): boolean {
		const h = hora % 24;
		return h >= HORAS_LIMITE.INICIO_NOCTURNO || h < HORAS_LIMITE.FIN_NOCTURNO;
	}

	let hed = 0, hen = 0, hefd = 0, hefn = 0, rndf = 0, rn = 0, rd = 0;

	// Recorrer cada fracción de hora y clasificarla
	let horaActual = horaInicio;
	let horasAcumuladas = 0;

	while (horaActual < horaFin) {
		const siguienteHora = Math.min(horaActual + 0.5, horaFin);
		const fraccion = siguienteHora - horaActual;
		const nocturna = esNocturna(horaActual);
		const esExtra = horasAcumuladas >= jornadaOrdinaria;

		if (esDomFest) {
			if (esExtra) {
				if (nocturna) { hefn += fraccion; } else { hefd += fraccion; }
			} else {
				const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
				if (fraccion <= horasRestantesJornada) {
					if (nocturna) { rndf += fraccion; } else { rd += fraccion; }
				} else {
					const parteOrdinaria = horasRestantesJornada;
					const parteExtra = fraccion - parteOrdinaria;
					if (nocturna) {
						rndf += parteOrdinaria;
						hefn += parteExtra;
					} else {
						rd += parteOrdinaria;
						hefd += parteExtra;
					}
				}
			}
		} else {
			if (esExtra) {
				if (nocturna) { hen += fraccion; } else { hed += fraccion; }
			} else {
				const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
				if (fraccion <= horasRestantesJornada) {
					if (nocturna) { rn += fraccion; }
					// Diurna ordinaria en día normal = no genera recargo
				} else {
					const parteOrdinaria = horasRestantesJornada;
					const parteExtra = fraccion - parteOrdinaria;
					if (nocturna) {
						rn += parteOrdinaria;
						hen += parteExtra;
					} else {
						hed += parteExtra;
					}
				}
			}
		}

		horasAcumuladas += fraccion;
		horaActual = siguienteHora;
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
		esDomingo: esDomingo(dia, mes, año),
		esFestivo: esDiaFestivo(dia, diasFestivos),
		esDomingoOFestivo: esDomFest
	};
}
