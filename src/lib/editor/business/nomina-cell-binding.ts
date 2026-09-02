/**
 * Registro de bindings celda → dominio del canvas de **nómina**.
 *
 * POR QUÉ UN MAPA EXTERNO Y NO `cell.custom`: `SetRangeValuesMutation` borra
 * `cell.custom` en cada edición, así que este Map es la ÚNICA fuente de
 * verdad para resolver qué campo hay que actualizar tras un
 * `set-range-values`.
 *
 * DEFAULT-DENY. En nómina la mayoría de la hoja es DERIVADA: los días, las
 * horas por tipo, el desglose por empresa y las siete filas de recargo salen
 * de las planillas y no se teclean. Solo se registra binding para lo que de
 * verdad se edita, y `cell-permission-nomina` bloquea todo lo demás. Si la
 * cifra de recargos está mal, lo que se corrige es la planilla.
 *
 * Dos índices:
 *   directo  `unitId:sheetId:r:c`          → qué campo es esta celda
 *   inverso  `unitId:entityId:field`       → qué celda repintar
 *
 * El inverso es lo que permite aplicar un cambio que llega de otro usuario
 * —que viaja sin coordenadas, solo `{ entityId, field, value }`— sin
 * reconstruir la hoja entera.
 */

/**
 * `liquidacion` son los campos de la liquidación del conductor.
 * `periodo` son los ajustes del libro (las constantes de disponibilidad),
 * que no cuelgan de ninguna liquidación concreta.
 */
export type NominaEntityType = 'liquidacion' | 'periodo';

export interface NominaBinding {
	entityType: NominaEntityType;
	/** UUID de `liquidaciones`, o `'periodo'` para los ajustes del libro. */
	entityId: string;
	field: string;
	/** Conductor al que pertenece la hoja, para los avisos y el resaltado. */
	conductorId?: string;
}

const store = new Map<string, NominaBinding>();
const reverse = new Map<string, string>();

export function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

function reverseKey(unitId: string, entityId: string, field: string): string {
	return `${unitId}:${entityId}:${field}`;
}

export function setNominaBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: NominaBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
	reverse.set(reverseKey(unitId, binding.entityId, binding.field), `${sheetId}:${r}:${c}`);
}

export function getNominaBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): NominaBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/** ¿Esta celda es editable? Es el default-deny del permiso de celda. */
export function esCeldaEditable(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): boolean {
	return store.has(cellKey(unitId, sheetId, r, c));
}

/**
 * Dónde se pinta `entityId.field`. `undefined` si ese campo no está mapeado
 * —una columna derivada, por ejemplo—, en cuyo caso no hay que repintar
 * nada: la recalcula el motor.
 */
export function getNominaCellFor(
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
 * Limpia bindings. Sin argumentos borra todo; con `unitId` ese libro; con
 * `unitId` + `sheetId` solo esa hoja — necesario para reconstruir la hoja de
 * un conductor sin tirar abajo las de los demás.
 */
export function clearNominaBindings(unitId?: string, sheetId?: string): void {
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
	// Purgar el inverso en el mismo barrido: si no, tras reconstruir una hoja
	// quedarían entradas apuntando a filas que ya no existen y una edición
	// remota escribiría en la celda equivocada.
	for (const rk of huerfanos) {
		if (rk.startsWith(reversePrefix)) reverse.delete(rk);
	}
}
