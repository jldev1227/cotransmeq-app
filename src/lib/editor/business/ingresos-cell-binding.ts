/**
 * Registro de bindings celda → dominio del canvas de INGRESOS DE TRANSMERALDA.
 *
 * Mismo contrato que `ocasional-cell-binding`: la clave es
 * `unitId:sheetId:r:c` y el valor lleva un id de dominio ESTABLE, no un índice
 * posicional, para que la celda siga resolviendo al registro correcto tras un
 * refetch o un reordenamiento.
 *
 * Va aparte del de ocasional y no reutiliza aquel porque los tipos de entidad
 * son otros: aquí una fila NO es un item de la liquidación sino la capa de
 * decisiones ENCIMA de un item (`liquidacion_tercero_id` es su identidad).
 * Compartir el registro obligaría a ensanchar su unión de tipos y a que los
 * dos canvas se enteraran de los conceptos del otro.
 */

export type IngresosEntityType = 'fila' | 'concepto';

export interface IngresosBinding {
	entityType: IngresosEntityType;
	/// `liquidacion_tercero_id` para las filas; el id del concepto para el pie.
	entityId: string;
	field: string;
	/// Hoja lógica del binding. Importa porque la MISMA fila aparece en las dos
	/// hojas del mes y el campo editable no es el mismo en cada una.
	hoja?: 'INGRESOS' | 'ADICIONALES';
	/// Sección a la que pertenece, para agrupar y depurar.
	section?: string;
}

const store = new Map<string, IngresosBinding>();

function cellKey(unitId: string, sheetId: string, r: number, c: number): string {
	return `${unitId}:${sheetId}:${r}:${c}`;
}

export function setIngresosBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number,
	binding: IngresosBinding
): void {
	store.set(cellKey(unitId, sheetId, r, c), binding);
}

export function getIngresosBinding(
	unitId: string,
	sheetId: string,
	r: number,
	c: number
): IngresosBinding | undefined {
	return store.get(cellKey(unitId, sheetId, r, c));
}

/**
 * Limpia bindings. Sin argumentos borra todo; con `unitId` borra ese workbook.
 *
 * Se llama en cada teardown: sin esto, los bindings de un año quedarían
 * apuntando a filas que ya no existen y una edición escribiría en el registro
 * equivocado.
 */
export function clearIngresosBindings(unitId?: string, sheetId?: string): void {
	if (!unitId) {
		store.clear();
		return;
	}
	const prefix = sheetId ? `${unitId}:${sheetId}:` : `${unitId}:`;
	for (const k of Array.from(store.keys())) {
		if (k.startsWith(prefix)) store.delete(k);
	}
}
