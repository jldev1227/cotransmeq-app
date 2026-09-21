/**
 * Lectura de lo que el usuario TECLEA en una celda del canvas de recorridos.
 *
 * Univer interpreta lo que se escribe: «2026-09-03» se convierte en un serial
 * de fecha (un número de días desde 1899) con formato de fecha, y «07:30» en
 * una fracción del día. La celda lo muestra bien, pero el valor que llega al
 * adapter es el número, y el backend espera el texto. Aquí se deshace esa
 * conversión y se normaliza lo que se puede antes de enviar: es la misma
 * regla que aplica el servidor, adelantada para poder avisar al instante.
 *
 * Puro: sin Univer ni DOM, para poder probarlo.
 */

/** Serial de Excel/Univer (días desde 1899-12-30) → `YYYY-MM-DD`. */
function isoDesdeSerial(serial: number): string {
	const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
	return new Date(ms).toISOString().slice(0, 10);
}

function existe(a: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const f = new Date(Date.UTC(a, m - 1, d));
	return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * Fecha de una celda → `YYYY-MM-DD`, o `null` si no se entiende.
 *
 * Acepta el ISO tal cual, `DD/MM/YYYY` y `DD-MM-YYYY` (el orden colombiano),
 * y el serial numérico en que Univer convierte una fecha reconocida.
 */
export function fechaDesdeCelda(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v === 'number') {
		if (!Number.isFinite(v) || v < 20_000 || v > 80_000) return null;
		return isoDesdeSerial(v);
	}
	const t = String(v).trim();
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
	if (m) {
		const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return existe(a, mes, d)
			? `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
			: null;
	}
	m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
	if (m) {
		const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return existe(a, mes, d)
			? `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
			: null;
	}
	return null;
}

/**
 * Hora de una celda → `HH:MM` o lo que hubiera, para que el servidor lo
 * valide y explique. Deshace la fracción de día en que Univer convierte
 * «07:30»; el texto se deja pasar tal cual.
 */
export function horaDesdeCelda(v: unknown): unknown {
	if (typeof v === 'number' && v >= 0 && v < 1) {
		const minutos = Math.round(v * 24 * 60);
		return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
	}
	if (typeof v === 'string') {
		const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
		if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
	}
	return v;
}

/** «6 horas», «6,5», «6h» → número; lo demás se deja para que el servidor avise. */
export function horasDesdeCelda(v: unknown): unknown {
	if (typeof v === 'number') return v;
	if (typeof v !== 'string') return v;
	const m = /^\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|hora|horas)?\.?\s*$/i.exec(v);
	return m ? Number(m[1].replace(',', '.')) : v;
}

/** Placa en mayúsculas y sin espacios, como la guarda la flota. `''` si vacía. */
export function placaDesdeCelda(v: unknown): string {
	return String(v ?? '')
		.toUpperCase()
		.replace(/\s+/g, '')
		.trim();
}

/**
 * Qué le falta a una fila insertada para poder guardarse. Vacío = completa.
 *
 * Espejo de `clasificarFilaNueva` en el servidor: fecha y, o bien el trío
 * placa/inicio/fin (recorrido, día LABORADO), o bien un tipo de día que no sea
 * LABORADO (MANTENIMIENTO además con placa). Devuelve lo que falta en palabras
 * para decírselo al usuario: una fila con «+» que no se guarda y no dice por
 * qué es una fila que se queda así.
 */
export function faltantesDeBorrador(v: Record<string, unknown>): string[] {
	const faltan: string[] = [];
	if (!v.fecha) faltan.push('la fecha');
	const tipo = String(v.tipo_dia ?? '')
		.trim()
		.toUpperCase();
	const tieneTramo = !!(v.vehiculo_placa || v.hora_inicio || v.hora_fin);

	if (tipo === 'MANTENIMIENTO') {
		if (!v.vehiculo_placa) faltan.push('la placa del vehículo en mantenimiento');
		return faltan;
	}
	if (tieneTramo || tipo === 'LABORADO') {
		// Es (o quiere ser) un recorrido: placa y horario completos.
		if (!v.vehiculo_placa) faltan.push('la placa');
		if (!v.hora_inicio) faltan.push('la hora inicial');
		if (!v.hora_fin) faltan.push('la hora final');
		return faltan;
	}
	if (!tipo) faltan.push('el tipo de día (DISPONIBLE, DESCANSO o MANTENIMIENTO), o placa y horario si es un recorrido');
	return faltan;
}

/** `YYYY-MM-DD` desplazado `dias` días (puede ser negativo), sin zona horaria. */
export function sumarDias(iso: string, dias: number): string {
	const [a, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Serie de fechas para el TIRADOR de relleno, como la haría Excel.
 *
 * Univer trata «2026-09-01» como texto con un número al final y, al arrastrar
 * hacia arriba, produce «2026-09-00» y sigue restando; hacia abajo pasa del 31.
 * Aquí la serie es de días de verdad: continúa con el paso que llevan las
 * fechas del origen (una sola fecha → un día) y cruza el cambio de mes.
 *
 * @param origen fechas del rango arrastrado, de arriba abajo (las no válidas se ignoran).
 * @param n      cuántas celdas hay que rellenar.
 * @param hacia  `abajo` continúa tras la última; `arriba` retrocede antes de la primera.
 * @returns las `n` fechas en orden de FILA (de arriba abajo), o `null` si el
 *   origen no tiene ninguna fecha.
 */
export function serieDeFechas(
	origen: Array<string | null>,
	n: number,
	hacia: 'abajo' | 'arriba'
): string[] | null {
	const validas = origen.filter((f): f is string => !!f);
	if (!validas.length || n <= 0) return null;
	const paso =
		validas.length >= 2
			? Math.round(
					(Date.parse(`${validas[validas.length - 1]}T00:00:00Z`) -
						Date.parse(`${validas[validas.length - 2]}T00:00:00Z`)) /
						86_400_000
				) || 1
			: 1;
	if (hacia === 'abajo') {
		const base = validas[validas.length - 1];
		return Array.from({ length: n }, (_, i) => sumarDias(base, paso * (i + 1)));
	}
	const base = validas[0];
	// De arriba abajo: la más lejana primero.
	return Array.from({ length: n }, (_, i) => sumarDias(base, -paso * (n - i)));
}
