/**
 * Traduce el criterio de una columna filtrada a una frase corta.
 *
 * Lo que Univer guarda es la estructura del autofiltro (lista de valores
 * visibles, condiciones, colores); lo que hay que enseñar en la toolbar es qué
 * está viendo el usuario. Sin esto, un filtro puesto en una columna que quedó
 * fuera de la pantalla es invisible: se leen doce filas creyendo que son todas
 * las que hay.
 *
 * Módulo aparte del engine por lo de siempre en este canvas: el engine habla
 * con Univer y no se instancia en un test de Node; esto es texto y sí se puede
 * probar. Ver `historial-indices.ts` y `totales-visibles.ts`.
 */

/// Réplica mínima de `IFilterColumn` de `@univerjs/sheets-filter`. Se copia en
/// vez de importarse para que el módulo siga siendo probable sin arrastrar el
/// paquete entero al test.
export interface CriterioColumna {
	colId: number;
	filters?: { blank?: true; filters?: string[] };
	colorFilters?: { cellFillColors?: Array<string | null>; cellTextColors?: string[] };
	customFilters?: {
		and?: number;
		customFilters: Array<{ val: string | number; operator?: string }>;
	};
}

/// Cuántos valores se nombran antes de resumir con «+N». Dos entran en un chip
/// sin empujar al resto fuera de la barra.
const VALORES_VISIBLES = 2;

/** Operadores de Univer con su forma corta en español. */
const OPERADORES: Record<string, string> = {
	equal: '=',
	notEqual: '≠',
	greaterThan: '>',
	greaterThanOrEqual: '≥',
	lessThan: '<',
	lessThanOrEqual: '≤'
};

/**
 * Frase corta para el chip. Devuelve `null` si la columna no filtra nada — que
 * es distinto de filtrar por «todo»: Univer deja el criterio puesto y vacío
 * mientras el desplegable está abierto.
 */
export function resumirCriterio(c: CriterioColumna | null | undefined): string | null {
	if (!c) return null;

	// ── Filtro por valores, que es el 99% de los casos ──
	const valores = c.filters?.filters;
	if (valores?.length) {
		const nombrados = valores.slice(0, VALORES_VISIBLES).join(', ');
		const resto = valores.length - VALORES_VISIBLES;
		return resto > 0 ? `${nombrados} +${resto}` : nombrados;
	}
	/// `blank` sin lista significa «solo las vacías»: es un filtro real y muy
	/// fácil de dejarse puesto sin darse cuenta, así que se nombra.
	if (c.filters?.blank) return 'solo vacías';

	// ── Condiciones ──
	const cond = c.customFilters?.customFilters;
	if (cond?.length) {
		const partes = cond.map((f) => `${OPERADORES[f.operator ?? 'equal'] ?? ''} ${f.val}`.trim());
		return partes.join(c.customFilters?.and ? ' y ' : ' o ');
	}

	// ── Colores ──
	const colores =
		(c.colorFilters?.cellFillColors?.length ?? 0) + (c.colorFilters?.cellTextColors?.length ?? 0);
	if (colores > 0) return 'por color';

	return null;
}
