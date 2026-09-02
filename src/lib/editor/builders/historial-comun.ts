/**
 * Paleta y helpers compartidos por las TRES hojas del canvas de historial de
 * liquidaciones de servicios (Liquidaciones, Facturas, Terceros).
 *
 * Módulo aparte a propósito: la hoja principal importa a sus hermanas para
 * ensamblar el workbook, y si las hermanas importaran la paleta de la
 * principal habría un ciclo — inofensivo hoy (solo se usa dentro de
 * funciones), pero es la clase de bomba que estalla al primer refactor que
 * mueva un uso al nivel de módulo.
 */

import {
	BorderStyleTypes,
	CellValueType,
	HorizontalAlign,
	type IBorderData,
	type IBorderStyleData,
	type ICellData,
	type IStyleData
} from '@univerjs/core';

// ─── Paleta (la misma de los canvas de terceros) ──────────────────────

export const GREEN = '#0F4025';
export const TEXT_DARK = '#0F172A';
export const MUTED = '#475569';
export const TOTALES_BG = '#E2E8F0';
export const ZEBRA_BG = '#F8FAFC';
export const RED = '#B91C1C';
export const GRIS_BLOQUEADO = '#94A3B8';
export const AZUL_ACCION = '#1D4ED8';

// ─── Helpers ──────────────────────────────────────────────────────────

const thinBorder = (): IBorderStyleData => ({
	s: BorderStyleTypes.THIN,
	cl: { rgb: '#CBD5E1' }
});

/**
 * Fija una celda como TEXTO alineado a la izquierda.
 *
 * El problema: un valor que PARECE número —un NIT «900517828», un consecutivo
 * de factura «4750»— se guarda como string, pero Univer vuelve a inferir su
 * tipo cada vez que algo reescribe la celda. Y algo la reescribe
 * constantemente: el resaltado de filas pinta el fondo con
 * `setBackgroundColor`, y en ese viaje de ida y vuelta el string `"4750"`
 * regresa como el número `4750` con `t: NUMBER`. A partir de ahí se alinea a la
 * derecha como cualquier cifra, que es lo que se veía al hacer clic en una
 * fila. Medido en Univer 0.25.1.
 *
 * Se fija `ht: LEFT` explícito Y `t: STRING`, y ninguna de las dos sobra:
 *
 *  - `ht` es lo que de verdad sostiene lo que se ve. La alineación por defecto
 *    depende del tipo inferido; con `ht` puesto, deja de depender.
 *  - `t: STRING` declara la intención en el dato, para el autofiltro y la
 *    exportación. Por sí solo NO basta: probado en el canvas, la celda se
 *    volvía a inferir como número en el primer repintado igual que sin `t`.
 *
 * NO se usa `FORCE_STRING`, que sí resiste la reinferencia: hace que Univer
 * marque la celda con su aviso «Número almacenado como texto» —el triángulo
 * verde de Excel— y la hoja se llena de advertencias en cada NIT y cada número
 * de factura. El aviso es correcto para una hoja que alguien teclea; aquí el
 * dato es un identificador y no hay nada que corregir.
 */
export function comoTexto(celda: ICellData): ICellData {
	return {
		...celda,
		t: CellValueType.STRING,
		s: { ...(celda.s as IStyleData), ht: HorizontalAlign.LEFT }
	};
}

/**
 * Marca una celda como ENLACE a otra hoja: azul y subrayada.
 *
 * Estas celdas —N° FACTURA, CONSECUTIVOS, CONSECUTIVO— navegan al doble clic
 * desde `enlaces.plugin.ts`, pero se pintaban como texto normal: no había nada
 * que dijera que se podía saltar desde ahí, así que la función existía y no la
 * encontraba nadie. Azul + subrayado es la convención que ya no hay que
 * explicar.
 *
 * Solo se aplica cuando la celda TIENE destino. Una liquidación sin facturar
 * pintada como enlace prometería un salto que acaba en «esa fila no tiene a
 * dónde ir».
 */
export function comoEnlace(estilo: IStyleData): IStyleData {
	return { ...estilo, cl: { rgb: AZUL_ACCION }, ul: { s: 1 } };
}

export const allBorders = (): IBorderData => ({
	t: thinBorder(),
	r: thinBorder(),
	b: thinBorder(),
	l: thinBorder()
});

/**
 * Fecha de un INSTANTE (`@db.Timestamptz`), en hora de Colombia.
 *
 * `fecha_facturacion`, `fecha_liquidacion` y `created_at` son momentos en el
 * tiempo: se guardan en UTC y hay que mostrarlos en la zona del usuario, o
 * una factura emitida a las 20:00 de Bogotá aparecería como del día
 * siguiente.
 *
 * `en-CA` da `YYYY-MM-DD`, que ordena bien como texto y no obliga a convertir
 * la columna a fecha nativa de Univer.
 */
export function fechaCorta(iso?: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/**
 * Fecha de CALENDARIO (`@db.Date`), sin conversión de zona.
 *
 * `fecha_inicial` y `fecha_final` de un ítem son días del calendario, no
 * instantes: «el servicio del 10 de marzo» es el 10 de marzo se mire desde
 * donde se mire. Postgres las devuelve como medianoche UTC, así que pasarlas
 * por `America/Bogota` (UTC-5) las corre AL DÍA ANTERIOR — que es justo el
 * bug que tenía la versión anterior de esta hoja: todos los servicios se
 * mostraban un día antes de la fecha real.
 *
 * Por eso se leen los componentes UTC en crudo, sin `toLocaleDateString`.
 */
export function fechaDeCalendario(iso?: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const a = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dia = String(d.getUTCDate()).padStart(2, '0');
	return `${a}-${m}-${dia}`;
}

/// Índice de columna → letra de Excel, para las fórmulas del pie.
export function colLetra(c: number): string {
	let n = c;
	let s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

export const MESES_CORTOS = [
	'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
	'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
];
