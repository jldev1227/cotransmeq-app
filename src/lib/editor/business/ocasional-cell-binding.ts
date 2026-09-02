/**
 * Cell Binding Registry — registro de bindings celda → dominio.
 *
 * Reemplaza al `cell-metadata-store` para el canvas MENSUAL. La
 * diferencia clave: cada binding lleva un ID de dominio ESTABLE
 * (`itemId`, `conceptoId`, `adicionalId`) en vez de un ÍNDICE
 * posicional (`conceptoIdx`). Esto permite que las celdas sigan
 * resolviendo al dominio correcto tras inserciones, refetches o
 * reordenamientos.
 *
 * Sobrevive a mutaciones de Univer (`SetRangeValuesMutation` borra
 * `cell.custom`), por lo que es la ÚNICA fuente de verdad para
 * resolver qué campo del modelo actualizar.
 *
 * Clave: `unitId:sheetId:r:c`
 * Valor: `{ entityType, entityId, field, section }`
 */

export type OcasionalEntityType = 'item' | 'concepto' | 'adicional';

export interface OcasionalBinding {
	entityType: OcasionalEntityType;
	entityId: string;
	field: string;
	/** Sección lógica a la que pertenece (para agrupación y badging). */
	section?: string;
}

const store = new Map<string, OcasionalBinding>();

/**
 * Índice INVERSO `unitId:entityId:field` → `sheetId:r:c`.
 *
 * Camino contrario al de `store`: una edición que llega de otro usuario
 * viaja como `{ entityId, field, value }`, sin coordenadas. Sin este
 * índice no se puede repintar esa celda sin reconstruir la hoja entera.
 */
const reverse = new Map<string, string>();

export function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

function reverseKey(unitId: string, entityId: string, field: string): string {
	return `${unitId}:${entityId}:${field}`;
}

export function setOcasionalBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: OcasionalBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
	reverse.set(reverseKey(unitId, binding.entityId, binding.field), `${sheetId}:${r}:${c}`);
}

export function getOcasionalBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): OcasionalBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/**
 * Resuelve la celda que renderiza `entityId.field` dentro de `unitId`.
 * `undefined` si ese campo no está mapeado (columna derivada por fórmula).
 */
export function getOcasionalCellFor(
	unitId: string,
	entityId: string,
	field: string
): { sheetId: string; row: number; column: number } | undefined {
	const hit = reverse.get(reverseKey(unitId, entityId, field));
	if (!hit) return undefined;
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
export function clearOcasionalBindings(unitId?: string, sheetId?: string): void {
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
	// una hoja quedarían entradas apuntando a filas inexistentes y una
	// edición remota escribiría en la celda equivocada.
	for (const rk of huerfanos) {
		if (rk.startsWith(reversePrefix)) reverse.delete(rk);
	}
}

/**
 * Devuelve todos los bindings de un workbook (para diff/sync entre
 * servidor y cliente en `row:updated`).
 */
export function dumpOcasionalBindings(unitId?: string): Array<{
	key: string;
	binding: OcasionalBinding;
}> {
	const out: Array<{ key: string; binding: OcasionalBinding }> = [];
	const prefix = unitId ? `${unitId}:` : '';
	for (const [key, binding] of store.entries()) {
		if (!prefix || key.startsWith(prefix)) out.push({ key, binding });
	}
	return out;
}
