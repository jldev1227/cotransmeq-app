/**
 * Registry de bindings celda → dominio del canvas de RECORRIDOS.
 *
 * Calcado de `cierres-finales-cell-binding.ts`, con dos diferencias que vienen
 * del dominio:
 *
 *  · La identidad de una fila no es un solo id. Una fila es un RECORRIDO
 *    (`segmento_id`) o un DÍA sin recorridos (`registro_dia_id`), y el patch
 *    necesita saber cuál de los dos para elegir la tabla. Por eso el binding
 *    lleva `tipoFila` además de `entityId`.
 *
 *  · Los bonos no son campos fijos: son columnas dinámicas. Su `field` viaja
 *    como `bono:<config_id>`, que es lo que el backend sabe interpretar.
 *
 * Igual que allí, el Map externo es la única fuente de verdad: Univer borra
 * `cell.custom` en cada `SetRangeValuesMutation`, así que no se puede guardar
 * la identidad dentro de la celda.
 *
 * Clave directa:  `unitId:sheetId:r:c`     → binding
 * Clave inversa:  `unitId:entityId:field`  → `sheetId:r:c`
 */

export type TipoFilaRecorrido = 'segmento' | 'dia';

export interface RecorridoBinding {
	/** Qué tabla toca el patch. */
	tipoFila: TipoFilaRecorrido;
	/** UUID del segmento, o del día cuando la fila no tiene recorridos. */
	entityId: string;
	/** Campo del modelo, o `bono:<config_id>` para una casilla de bono. */
	field: string;
	/** Conductor al que pertenece la hoja. */
	conductorId: string;
	/** Día al que pertenece la fila. Necesario para agrupar y para el resumen. */
	registroDiaId: string;
	/**
	 * Celda DERIVADA: la calcula el servidor y el canvas solo la pinta (el
	 * valor a pagar, por ejemplo). No es editable, pero sí debe poder
	 * escribirse cuando llega un patch remoto; el interceptor de permisos
	 * distingue ambos casos con `isApplyingRemote()`.
	 */
	derived?: boolean;
}

/** Semilla que devuelve el builder para que el llamador registre. */
export interface RecorridoBindingSeed {
	r: number;
	c: number;
	binding: RecorridoBinding;
}

const store = new Map<string, RecorridoBinding>();
const reverse = new Map<string, string>();

export function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

function reverseKey(unitId: string, entityId: string, field: string): string {
	return `${unitId}:${entityId}:${field}`;
}

export function setRecorridoBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: RecorridoBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
	reverse.set(reverseKey(unitId, binding.entityId, binding.field), `${sheetId}:${r}:${c}`);
}

/**
 * Registra de golpe las semillas de una hoja.
 *
 * El builder devuelve semillas en vez de registrarlas él mismo porque el
 * `sheetId` definitivo no se conoce hasta después: al insertar una hoja con
 * `insertSheet()`, Univer no garantiza respetar el id provisto.
 */
export function setRecorridoBindings(
	unitId: string,
	sheetId: string,
	seeds: RecorridoBindingSeed[]
): void {
	for (const s of seeds) setRecorridoBinding(unitId, sheetId, s.r, s.c, s.binding);
}

export function getRecorridoBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): RecorridoBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/** Resuelve la celda que renderiza `entityId.field`. */
export function getRecorridoCellFor(
	unitId: string,
	entityId: string,
	field: string
): { sheetId: string; row: number; column: number } | undefined {
	const hit = reverse.get(reverseKey(unitId, entityId, field));
	if (!hit) return undefined;
	// Se parte por la derecha para no depender de que el sheetId no lleve `:`.
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
 * Todas las celdas de una entidad.
 *
 * Un patch puede derivar más de una celda: escribir el nombre de un cliente
 * hace que el servidor resuelva también su id, y cambiar la placa repinta la
 * columna de vehículo.
 */
export function getRecorridoCeldasDeEntidad(
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
 * `unitId` + `sheetId` solo esa hoja.
 */
export function clearRecorridoBindings(unitId?: string, sheetId?: string): void {
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

	// Purgar el índice inverso en el mismo barrido: si no, tras reconstruir una
	// hoja quedarían entradas apuntando a filas que ya no existen y una edición
	// remota escribiría en la celda equivocada.
	for (const rk of huerfanos) {
		if (rk.startsWith(reversePrefix)) reverse.delete(rk);
	}
}

/** Diagnóstico: cuántos bindings hay vivos. Útil para detectar fugas. */
export function statsRecorridoBindings(): { directos: number; inversos: number } {
	return { directos: store.size, inversos: reverse.size };
}
