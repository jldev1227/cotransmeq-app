/**
 * Cell Binding Registry — registro de bindings celda → dominio para el
 * canvas de **Adicionales de cierres finales de terceros**.
 *
 * DIFERENCIAS vs `ocasional-cell-binding`:
 *  - Solo un `entityType: 'adicional'`.
 *  - `entityId` es el ID SINTÉTICO del backend (`${cierre_id}::${idx}`)
 *    porque los adicionales viven en una columna JSONB sin PK. Esto es
 *    estable mientras el backend mantenga el orden del array por `idx`
 *    ASC dentro de cada cierre.
 *  - Sin secciones (todos los adicionales viven en la misma hoja, sin
 *    agrupación por cierre en el binding).
 *
 * Sobrevive a mutaciones de Univer (`SetRangeValuesMutation` borra
 * `cell.custom`), por lo que es la ÚNICA fuente de verdad para resolver
 * qué campo del modelo actualizar tras un `set-range-values`.
 *
 * Clave: `unitId:sheetId:r:c`
 * Valor: `{ entityType, entityId, field }`
 */

export type AdicionalEntityType = 'adicional';

export interface AdicionalBinding {
	entityType: AdicionalEntityType;
	entityId: string;
	field: string;
}

const store = new Map<string, AdicionalBinding>();

/**
 * Índice INVERSO `unitId:entityId:field` → `sheetId:r:c`.
 *
 * Sirve para el camino contrario al de `store`: dado un cambio que llega
 * de otro usuario (que viaja como `{ entityId, field, value }`, sin
 * coordenadas), localizar QUÉ celda hay que repintar. Sin esto no se
 * puede aplicar una edición remota sin reconstruir la hoja entera.
 */
const reverse = new Map<string, string>();

export function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

function reverseKey(unitId: string, entityId: string, field: string): string {
	return `${unitId}:${entityId}:${field}`;
}

export function setAdicionalesBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: AdicionalBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
	reverse.set(reverseKey(unitId, binding.entityId, binding.field), `${sheetId}:${r}:${c}`);
}

export function getAdicionalesBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): AdicionalBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/**
 * Resuelve la celda que renderiza `entityId.field` dentro de `unitId`.
 * Devuelve `undefined` si ese campo no está mapeado (p. ej. una columna
 * derivada, que se recalcula sola por fórmula y no debe repintarse).
 */
export function getAdicionalesCellFor(
	unitId: string,
	entityId: string,
	field: string
): { sheetId: string; row: number; column: number } | undefined {
	const hit = reverse.get(reverseKey(unitId, entityId, field));
	if (!hit) return undefined;
	// `sheetId` puede contener `:`? No con el esquema `sheet-N`, pero
	// partimos por la derecha para no romper si algún día lo contiene.
	const lastColon = hit.lastIndexOf(':');
	const prevColon = hit.lastIndexOf(':', lastColon - 1);
	if (lastColon < 0 || prevColon < 0) return undefined;
	return {
		sheetId: hit.slice(0, prevColon),
		row: Number(hit.slice(prevColon + 1, lastColon)),
		column: Number(hit.slice(lastColon + 1))
	};
}

/**
 * Limpia bindings. Sin argumentos borra todo; con `unitId` borra ese
 * workbook; con `unitId` + `sheetId` borra SOLO esa hoja — necesario para
 * reconstruir un mes sin tirar abajo los otros once.
 */
export function clearAdicionalesBindings(unitId?: string, sheetId?: string): void {
	if (!unitId) {
		store.clear();
		reverse.clear();
		return;
	}
	const prefix = sheetId ? `${unitId}:${sheetId}:` : `${unitId}:`;
	const reversePrefix = `${unitId}:`;
	const huerfanos = new Set<string>();
	for (const k of Array.from(store.keys())) {
		if (!k.startsWith(prefix)) continue;
		const b = store.get(k);
		if (b) huerfanos.add(reverseKey(unitId, b.entityId, b.field));
		store.delete(k);
	}
	// Purgar el índice inverso en el mismo barrido: si no, tras reconstruir
	// una hoja quedarían entradas apuntando a filas que ya no existen y una
	// edición remota escribiría en la celda equivocada.
	for (const rk of huerfanos) {
		if (rk.startsWith(reversePrefix)) reverse.delete(rk);
	}
}