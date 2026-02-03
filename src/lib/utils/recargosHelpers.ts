// src/lib/utils/recargosHelpers.ts

/**
 * Constantes para cálculo de recargos
 */
export const HORAS_LIMITE = {
	JORNADA_NORMAL: 10, // 10 horas (no 8!)
	INICIO_NOCTURNO: 21, // 21:00 (9 PM)
	FIN_NOCTURNO: 6 // 06:00 (6 AM)
} as const;

export const PORCENTAJES_RECARGO = {
	HE_DIURNA: 25,
	HE_NOCTURNA: 75,
	HE_FESTIVA_DIURNA: 100,
	HE_FESTIVA_NOCTURNA: 150,
	RECARGO_NOCTURNO: 35,
	RECARGO_DOMINICAL: 75
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
		facturada: 'bg-orange-500',
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
		facturada: 'bg-orange-50',
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
 * Calcular Hora Extra Diurna (HED)
 * Fórmula: Si es domingo o festivo → 0
 *          Si NO: Si trabajó > 10 horas → total_horas - 10 - HEN
 */
export function calcularHED(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	// Si es domingo o festivo, no hay HED
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
		return 0;
	}

	// Si trabajó más de 10 horas
	if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
		return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
	}

	return 0;
}

/**
 * Calcular Hora Extra Nocturna (HEN)
 * Fórmula: Si es domingo o festivo → 0
 *          Si NO: Si trabajó > 10 horas Y terminó después de las 21:00 → hora_fin - 21
 */
export function calcularHEN(
	dia: number,
	mes: number,
	año: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	// Si es domingo o festivo, no hay HEN
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
		return 0;
	}

	// Si trabajó más de 10 horas Y terminó después de las 21:00
	if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFin > HORAS_LIMITE.INICIO_NOCTURNO) {
		return redondear(horaFin - HORAS_LIMITE.INICIO_NOCTURNO);
	}

	return 0;
}

/**
 * Calcular Hora Extra Festiva Diurna (HEFD)
 * Fórmula: Si es domingo o festivo:
 *            Si trabajó > 10 horas → total_horas - 10 - HEFN
 *          Si NO → 0
 */
export function calcularHEFD(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	// Solo si es domingo o festivo
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
		if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
			return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
		}
	}

	return 0;
}

/**
 * Calcular Hora Extra Festiva Nocturna (HEFN)
 * Fórmula: Si es domingo o festivo:
 *            Si trabajó > 10 horas Y terminó después de las 21:00 → hora_fin - 21
 *          Si NO → 0
 */
export function calcularHEFN(
	dia: number,
	mes: number,
	año: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	// Solo si es domingo o festivo
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
		if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFin > HORAS_LIMITE.INICIO_NOCTURNO) {
			return redondear(horaFin - HORAS_LIMITE.INICIO_NOCTURNO);
		}
	}

	return 0;
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
 * Fórmula: Si es domingo o festivo:
 *            Si trabajó ≤ 10 horas → total_horas
 *            Si trabajó > 10 horas → 10
 *          Si NO → 0
 */
export function calcularRecargoDominical(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[] = []
): number {
	// Solo si es domingo o festivo
	if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
		return redondear(
			totalHoras <= HORAS_LIMITE.JORNADA_NORMAL ? totalHoras : HORAS_LIMITE.JORNADA_NORMAL
		);
	}

	return 0;
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

	// Calcular total de horas
	const totalHoras = calcularHorasTrabajadas(horaInicio, horaFin);

	// Calcular todos los tipos
	const horaExtraNocturna = calcularHEN(dia, mes, año, horaFin, totalHoras, diasFestivos);
	const horaExtraDiurna = Math.max(
		0,
		calcularHED(dia, mes, año, totalHoras, diasFestivos) - horaExtraNocturna
	);
	const horaExtraFestivaNocturna = calcularHEFN(dia, mes, año, horaFin, totalHoras, diasFestivos);
	const horaExtraFestivaDiurna = Math.max(
		0,
		calcularHEFD(dia, mes, año, totalHoras, diasFestivos) - horaExtraFestivaNocturna
	);

	return {
		totalHoras,
		horaExtraDiurna,
		horaExtraNocturna,
		horaExtraFestivaDiurna,
		horaExtraFestivaNocturna,
		recargoNocturno: calcularRecargoNocturno(horaInicio, horaFin),
		recargoDominical: calcularRecargoDominical(dia, mes, año, totalHoras, diasFestivos),
		esDomingo: esDomingo(dia, mes, año),
		esFestivo: esDiaFestivo(dia, diasFestivos),
		esDomingoOFestivo: esDomingoOFestivo(dia, mes, año, diasFestivos)
	};
}
