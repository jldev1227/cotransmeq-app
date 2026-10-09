/**
 * Periodo del panel de inicio, tal como vive en la URL.
 *
 * Tres modos: `mes` (el que se usa por defecto), `semana` (ISO, lunes a
 * domingo) y `rango` (desde–hasta). Todos se resuelven aquí a un par de
 * fechas `YYYY-MM-DD`, que es lo único que entiende el backend.
 */
export type TipoPeriodo = 'mes' | 'semana' | 'rango';

export interface FiltrosPeriodo {
	tipo: TipoPeriodo;
	/** `YYYY-MM` */
	mes: string;
	/** `YYYY-Www` (ISO) */
	semana: string;
	desde: string;
	hasta: string;
}

export interface Rango {
	desde: string;
	hasta: string;
	/** «Octubre de 2026», «Semana 41 · 5–11 oct 2026», «1 sep – 15 oct 2026». */
	etiqueta: string;
}

const MESES_LARGO = [
	'enero',
	'febrero',
	'marzo',
	'abril',
	'mayo',
	'junio',
	'julio',
	'agosto',
	'septiembre',
	'octubre',
	'noviembre',
	'diciembre'
];
const MESES_CORTO = [
	'ene',
	'feb',
	'mar',
	'abr',
	'may',
	'jun',
	'jul',
	'ago',
	'sep',
	'oct',
	'nov',
	'dic'
];

export const iso = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function hoyLocal(): string {
	return iso(new Date());
}

export function mesActual(): string {
	return hoyLocal().slice(0, 7);
}

/** Semana ISO de una fecha local: `YYYY-Www`. */
export function semanaIso(d: Date): string {
	const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const dia = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - dia);
	const inicioAnio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
	const semana = Math.ceil(((t.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
	return `${t.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export function semanaActual(): string {
	return semanaIso(new Date());
}

/** Lunes de una semana ISO `YYYY-Www`, como fecha local. */
function lunesDe(semana: string): Date | null {
	const m = /^(\d{4})-W(\d{2})$/.exec(semana);
	if (!m) return null;
	const anio = Number(m[1]);
	const num = Number(m[2]);
	const cuatroEnero = new Date(anio, 0, 4);
	const diaSemana = cuatroEnero.getDay() || 7;
	const lunesSemana1 = new Date(anio, 0, 4 - (diaSemana - 1));
	const lunes = new Date(lunesSemana1);
	lunes.setDate(lunesSemana1.getDate() + (num - 1) * 7);
	return lunes;
}

export function finDeMes(yyyyMm: string): string {
	const [a, m] = yyyyMm.split('-').map(Number);
	return `${yyyyMm}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}

function fechaCorta(ymd: string, conAnio = true): string {
	const [a, m, d] = ymd.split('-').map(Number);
	return `${d} ${MESES_CORTO[m - 1]}${conAnio ? ` ${a}` : ''}`;
}

export function rangoDe(f: FiltrosPeriodo): Rango {
	if (f.tipo === 'semana') {
		const lunes = lunesDe(f.semana) ?? lunesDe(semanaActual())!;
		const domingo = new Date(lunes);
		domingo.setDate(lunes.getDate() + 6);
		const num = Number((f.semana || semanaActual()).slice(-2));
		const desde = iso(lunes);
		const hasta = iso(domingo);
		const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
		const dias = mismoMes
			? `${desde.slice(8)}–${fechaCorta(hasta)}`
			: `${fechaCorta(desde, false)} – ${fechaCorta(hasta)}`;
		return { desde, hasta, etiqueta: `Semana ${num} · ${dias}` };
	}
	if (f.tipo === 'rango') {
		const desde = /^\d{4}-\d{2}-\d{2}$/.test(f.desde) ? f.desde : `${mesActual()}-01`;
		let hasta = /^\d{4}-\d{2}-\d{2}$/.test(f.hasta) ? f.hasta : hoyLocal();
		if (hasta < desde) hasta = desde;
		return {
			desde,
			hasta,
			etiqueta: `${fechaCorta(desde, desde.slice(0, 4) !== hasta.slice(0, 4))} – ${fechaCorta(hasta)}`
		};
	}
	const mes = /^\d{4}-\d{2}$/.test(f.mes) ? f.mes : mesActual();
	const [a, m] = mes.split('-').map(Number);
	return {
		desde: `${mes}-01`,
		hasta: finDeMes(mes),
		etiqueta: `${MESES_LARGO[m - 1][0].toUpperCase()}${MESES_LARGO[m - 1].slice(1)} de ${a}`
	};
}

/** Mes anterior o siguiente de un `YYYY-MM`. */
export function moverMes(yyyyMm: string, delta: number): string {
	const [a, m] = yyyyMm.split('-').map(Number);
	const d = new Date(a, m - 1 + delta, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Semana anterior o siguiente de un `YYYY-Www`. */
export function moverSemana(semana: string, delta: number): string {
	const lunes = lunesDe(semana) ?? lunesDe(semanaActual())!;
	lunes.setDate(lunes.getDate() + delta * 7);
	return semanaIso(lunes);
}

/** «1 oct», «15 sep 2025»… para ejes y listas. */
export function diaCorto(ymd: string): string {
	const [, m, d] = ymd.split('-').map(Number);
	return `${d} ${MESES_CORTO[m - 1]}`;
}

export function mesCorto(anio: number, mes: number): string {
	return `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`;
}
