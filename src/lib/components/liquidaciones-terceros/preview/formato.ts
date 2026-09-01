/**
 * Formato de las celdas del documento.
 *
 * Una sola implementación por tipo, compartida por el preview y por el
 * HTML que se manda al backend: son la misma hoja, así que no pueden
 * escribir un peso de dos maneras.
 */

import type { CeldaFormateada, TipoColumna, ValorCelda } from './tipos';

export const MESES = [
	'ENERO',
	'FEBRERO',
	'MARZO',
	'ABRIL',
	'MAYO',
	'JUNIO',
	'JULIO',
	'AGOSTO',
	'SEPTIEMBRE',
	'OCTUBRE',
	'NOVIEMBRE',
	'DICIEMBRE'
];

export function nombreMes(mes: number): string {
	return MESES[mes - 1] ?? '';
}

export const COP = (v: number | string | null | undefined): string =>
	new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(Number(v) || 0);

export function fmtPlaca(p: string | null | undefined): string {
	const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	const m = s.match(/^([A-Z]+)(\d+)$/);
	return m ? `${m[1]}-${m[2]}` : s;
}

export function fmtPct(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(Number(v))) return '';
	const n = Number(v);
	// Sin decimales cuando es redondo: «10%» se lee mejor que «10.0%», y la
	// mayoría de los porcentajes del módulo lo son.
	return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + '%';
}

export function fmtNumero(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(Number(v))) return '';
	return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(v));
}

function esFormateada(v: ValorCelda): v is CeldaFormateada {
	return typeof v === 'object' && v !== null && 'texto' in v;
}

/** Texto de una celda según el tipo de su columna. */
export function textoDeCelda(valor: ValorCelda, tipo: TipoColumna): string {
	if (esFormateada(valor)) return valor.texto;
	if (valor == null || valor === '') return '';
	switch (tipo) {
		case 'moneda':
			return COP(valor as number);
		case 'numero':
			return fmtNumero(valor as number);
		case 'porcentaje':
			return fmtPct(valor as number);
		case 'placa':
			return fmtPlaca(String(valor));
		case 'booleano':
			return valor ? 'SÍ' : 'NO';
		default:
			return String(valor);
	}
}

/**
 * Clase CSS de una celda: alineación por tipo más el signo.
 *
 * El signo lo decide el ADAPTADOR (devolviendo `{texto, signo}`) y no el
 * valor: un descuento se pinta en rojo aunque su número sea positivo, y un
 * ingreso negativo también hay que verlo. Deducirlo del signo aritmético
 * daría lo contrario en las dos mitades del documento.
 */
export function claseDeCelda(valor: ValorCelda, tipo: TipoColumna): string {
	const base =
		tipo === 'moneda'
			? 'mc'
			: tipo === 'porcentaje'
				? 'pct'
				: tipo === 'numero' || tipo === 'booleano' || tipo === 'placa'
					? 'num'
					: 'long';
	const signo = esFormateada(valor) ? valor.signo : undefined;
	return signo ? `${base} ${signo}` : base;
}

// Los tres helpers llevan `valor` además del texto: en el papel basta la
// cadena, pero la celda de Excel tiene que salir NUMÉRICA para poder
// sumarse. Ver `CeldaFormateada.valor` en `tipos.ts`.

/** Marca un importe para que se pinte en rojo (descuento, saldo en contra). */
export const enRojo = (v: number): CeldaFormateada => ({
	texto: COP(v),
	signo: 'neg',
	valor: Number(v) || 0
});

/** Marca un importe para que se pinte en verde (saldo a favor). */
export const enVerde = (v: number): CeldaFormateada => ({
	texto: COP(v),
	signo: 'pos',
	valor: Number(v) || 0
});

/**
 * Importe entre paréntesis y en rojo, como los restan las cards del PDF.
 *
 * El `valor` va NEGATIVO aunque el texto no lleve el signo: el paréntesis
 * ES el signo, y en la hoja de cálculo una resta escrita en positivo se
 * sumaría al arrastrar un total.
 */
export const restado = (v: number): CeldaFormateada => ({
	texto: `(${COP(v)})`,
	signo: 'neg',
	valor: -(Number(v) || 0)
});
