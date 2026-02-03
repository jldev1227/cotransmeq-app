// src/lib/utils/festivosColombia.ts

/**
 * Utilidades para cálculo de días festivos en Colombia
 * Incluye festivos fijos y festivos que se trasladan al lunes según la ley colombiana
 */

export interface FestivoColombiano {
	dia: number;
	mes: number;
	año: number;
	nombre: string;
	tipo: 'fijo' | 'religioso' | 'trasladado';
	fechaCompleta: string;
}

// Festivos fijos en Colombia (misma fecha cada año)
export const festivosFijos = [
	{ mes: 1, dia: 1, nombre: 'Año Nuevo' },
	{ mes: 5, dia: 1, nombre: 'Día del Trabajo' },
	{ mes: 7, dia: 20, nombre: 'Día de la Independencia' },
	{ mes: 8, dia: 7, nombre: 'Batalla de Boyacá' },
	{ mes: 12, dia: 8, nombre: 'Inmaculada Concepción' },
	{ mes: 12, dia: 25, nombre: 'Navidad' }
];

/**
 * Calcula la fecha de Semana Santa usando el algoritmo de Meeus/Jones/Butcher
 * @param año - Año para calcular Semana Santa
 * @returns Objeto con fechas de Domingo de Ramos, Jueves Santo, Viernes Santo y Domingo de Pascua
 */
export function calcularSemanaSanta(año: number) {
	const a = año % 19;
	const b = Math.floor(año / 100);
	const c = año % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const n = Math.floor((h + l - 7 * m + 114) / 31);
	const p = (h + l - 7 * m + 114) % 31;

	const domingoRamos = new Date(año, n - 1, p + 1 - 7);
	const juevesSanto = new Date(año, n - 1, p + 1 - 3);
	const viernesSanto = new Date(año, n - 1, p + 1 - 2);
	const domingoPascua = new Date(año, n - 1, p + 1);

	return {
		domingoRamos,
		juevesSanto,
		viernesSanto,
		domingoPascua
	};
}

/**
 * Calcula los festivos que se trasladan al lunes siguiente según la ley colombiana
 * @param año - Año para calcular los festivos
 * @returns Array de objetos con fecha trasladada, nombre y fecha original
 */
export function calcularFestivosLunes(año: number) {
	const festivos = [
		{ mes: 1, dia: 6, nombre: 'Reyes Magos' },
		{ mes: 3, dia: 19, nombre: 'San José' },
		{ mes: 6, dia: 29, nombre: 'San Pedro y San Pablo' },
		{ mes: 8, dia: 15, nombre: 'Asunción de la Virgen' },
		{ mes: 10, dia: 12, nombre: 'Día de la Raza' },
		{ mes: 11, dia: 1, nombre: 'Todos los Santos' },
		{ mes: 11, dia: 11, nombre: 'Independencia de Cartagena' }
	];

	return festivos.map((festivo) => {
		const fecha = new Date(año, festivo.mes - 1, festivo.dia);
		const diaSemana = fecha.getDay();

		// Si no es lunes (1), calcular el próximo lunes
		if (diaSemana !== 1) {
			const diasHastaLunes = diaSemana === 0 ? 1 : 8 - diaSemana;
			fecha.setDate(fecha.getDate() + diasHastaLunes);
		}

		return {
			fecha,
			nombre: festivo.nombre,
			original: new Date(año, festivo.mes - 1, festivo.dia)
		};
	});
}

/**
 * Obtiene todos los festivos del año en Colombia
 * @param año - Año para calcular los festivos
 * @returns Array de objetos FestivoColombiano ordenados por fecha
 */
export function obtenerFestivosCompletos(año: number): FestivoColombiano[] {
	const festivos: Array<{
		fecha: Date;
		nombre: string;
		tipo: 'fijo' | 'religioso' | 'trasladado';
	}> = [];

	// Agregar festivos fijos
	festivosFijos.forEach((festivo) => {
		festivos.push({
			fecha: new Date(año, festivo.mes - 1, festivo.dia),
			nombre: festivo.nombre,
			tipo: 'fijo'
		});
	});

	// Agregar Semana Santa
	const semanaSanta = calcularSemanaSanta(año);
	festivos.push(
		{
			fecha: semanaSanta.juevesSanto,
			nombre: 'Jueves Santo',
			tipo: 'religioso'
		},
		{
			fecha: semanaSanta.viernesSanto,
			nombre: 'Viernes Santo',
			tipo: 'religioso'
		}
	);

	// Agregar festivos que se trasladan al lunes
	const festivosLunes = calcularFestivosLunes(año);
	festivosLunes.forEach((festivo) => {
		festivos.push({
			fecha: festivo.fecha,
			nombre: festivo.nombre,
			tipo: 'trasladado'
		});
	});

	// Ordenar por fecha y formatear
	return festivos
		.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
		.map((festivo) => ({
			dia: festivo.fecha.getDate(),
			mes: festivo.fecha.getMonth() + 1,
			año: festivo.fecha.getFullYear(),
			nombre: festivo.nombre,
			tipo: festivo.tipo,
			fechaCompleta: festivo.fecha.toISOString().split('T')[0]
		}));
}

/**
 * Verifica si un día específico es festivo en Colombia
 * @param dia - Día del mes (1-31)
 * @param mes - Mes (1-12)
 * @param año - Año
 * @returns true si es festivo
 */
export function esDiaFestivoColombiano(dia: number, mes: number, año: number): boolean {
	const festivos = obtenerFestivosCompletos(año);
	return festivos.some((f) => f.dia === dia && f.mes === mes && f.año === año);
}

/**
 * Obtiene los festivos de un mes específico
 * @param mes - Mes (1-12)
 * @param año - Año
 * @returns Array de festivos del mes
 */
export function obtenerFestivosMes(mes: number, año: number): FestivoColombiano[] {
	const festivos = obtenerFestivosCompletos(año);
	return festivos.filter((f) => f.mes === mes && f.año === año);
}
