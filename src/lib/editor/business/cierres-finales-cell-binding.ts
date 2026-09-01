/**
 * Registry de bindings celda → dominio del canvas de CIERRES FINALES.
 *
 * POR QUÉ NO SE REUSA `cell-metadata-store.ts`
 * Aquel identifica los conceptos por `conceptoIdx`: la POSICIÓN en un array
 * plano. Eso funcionaba con un libro de una sola hoja y un solo cierre, pero
 * aquí hay N hojas, cada una con su propio juego de conceptos, y el índice
 * deja de ser único. Peor: cualquier reordenamiento —o que el servidor
 * devuelva las filas en otro orden tras un recálculo— hace que el binding
 * apunte al concepto equivocado y la edición se aplique a otra fila.
 *
 * Aquí la identidad es el UUID de la entidad, que sobrevive a todo eso.
 *
 * Sobrevive también a las mutaciones de Univer: `SetRangeValuesMutation`
 * borra `cell.custom` en cada edición, así que este Map externo es la única
 * fuente de verdad para resolver qué campo del modelo toca actualizar.
 *
 * Clave directa:  `unitId:sheetId:r:c`      → binding
 * Clave inversa:  `unitId:entityId:field`   → `sheetId:r:c`
 *
 * El índice inverso es lo que permite pintar una edición que llega de otro
 * usuario —que viaja como `{ entityId, field, value }`, sin coordenadas—
 * sin reconstruir la hoja.
 */

export type CierreEntityType =
	| 'concepto'
	| 'adicional'
	| 'item'
	| 'cierre'
	| 'propietario';

export interface CierreBinding {
	entityType: CierreEntityType;
	/** UUID real de la entidad. NUNCA un índice posicional. */
	entityId: string;
	field: string;
	/** Cierre al que pertenece la celda. Una hoja = un cierre. */
	cierreId: string;
	/**
	 * Sección lógica, para agrupar y para decidir qué recálculo dispara la
	 * edición.
	 */
	section?:
		| 'items'
		| 'adicionales'
		| 'salarios'
		| 'prest'
		| 'ss'
		| 'gastos'
		| 'anticipos'
		| 'impuestos'
		| 'copropietarios';
	/**
	 * Celda DERIVADA: la calcula el servidor y el canvas solo la pinta.
	 *
	 * No es editable por el usuario, pero sí debe poder escribirse cuando
	 * llega un patch remoto. El interceptor de permisos distingue ambos
	 * casos consultando `isApplyingRemote()`.
	 */
	derived?: boolean;
}

/** Semilla que devuelve el builder para que el llamador registre. */
export interface BindingSeed {
	r: number;
	c: number;
	binding: CierreBinding;
}

const store = new Map<string, CierreBinding>();
const reverse = new Map<string, string>();

export function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

function reverseKey(unitId: string, entityId: string, field: string): string {
	return `${unitId}:${entityId}:${field}`;
}

export function setCierreBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: CierreBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
	reverse.set(reverseKey(unitId, binding.entityId, binding.field), `${sheetId}:${r}:${c}`);
}

/**
 * Registra de golpe las semillas de una hoja.
 *
 * El builder devuelve las semillas en vez de registrarlas él mismo porque
 * el `sheetId` definitivo no se conoce hasta después: al insertar una hoja
 * con `insertSheet()`, Univer no garantiza respetar un id provisto.
 */
export function setCierreBindings(
	unitId: string,
	sheetId: string,
	seeds: BindingSeed[]
): void {
	for (const s of seeds) {
		setCierreBinding(unitId, sheetId, s.r, s.c, s.binding);
	}
}

export function getCierreBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): CierreBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/**
 * Resuelve la celda que renderiza `entityId.field`.
 *
 * `undefined` si ese campo no está mapeado — por ejemplo una columna que se
 * calcula por fórmula de Univer y no debe repintarse desde fuera.
 */
export function getCierreCellFor(
	unitId: string,
	entityId: string,
	field: string
): { sheetId: string; row: number; column: number } | undefined {
	const hit = reverse.get(reverseKey(unitId, entityId, field));
	if (!hit) return undefined;
	// El sheetId es `cierre-<uuid>` y los uuid no llevan `:`, pero partimos
	// por la derecha para no depender de ello.
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
 * Todas las celdas de una entidad, en cualquier campo.
 *
 * Un patch de cierre final devuelve la fila COMPLETA (un cambio en `dias`
 * cascadea a `valor_total`, `base_calculo`…), así que hace falta poder
 * repintar varias celdas de la misma fila de una vez.
 */
export function getCierreCeldasDeEntidad(
	unitId: string,
	entityId: string
): Array<{ field: string; sheetId: string; row: number; column: number }> {
	const prefijo = `${unitId}:${entityId}:`;
	const out: Array<{ field: string; sheetId: string; row: number; column: number }> = [];
	for (const [k, v] of reverse.entries()) {
		if (!k.startsWith(prefijo)) continue;
		const field = k.slice(prefijo.length);
		const lastColon = v.lastIndexOf(':');
		const prevColon = v.lastIndexOf(':', lastColon - 1);
		if (lastColon < 0 || prevColon < 0) continue;
		out.push({
			field,
			sheetId: v.slice(0, prevColon),
			row: Number(v.slice(prevColon + 1, lastColon)),
			column: Number(v.slice(lastColon + 1))
		});
	}
	return out;
}

/**
 * Limpia bindings. Sin argumentos borra todo; con `unitId` ese libro; con
 * `unitId` + `sheetId` SOLO esa hoja — necesario para reconstruir una hoja
 * (tras revertir un snapshot, o al recargar un cierre) sin tirar las demás.
 */
export function clearCierreBindings(unitId?: string, sheetId?: string): void {
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

	// Purgar el índice inverso en el mismo barrido. Si no, tras reconstruir
	// una hoja quedarían entradas apuntando a filas que ya no existen y una
	// edición remota escribiría en la celda equivocada.
	for (const rk of huerfanos) {
		if (rk.startsWith(reversePrefix)) reverse.delete(rk);
	}
}

/** Diagnóstico: cuántos bindings hay vivos. Útil para detectar fugas. */
export function statsCierreBindings(): { directos: number; inversos: number } {
	return { directos: store.size, inversos: reverse.size };
}
