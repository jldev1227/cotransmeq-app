/**
 * Identidad del libro de RECORRIDOS.
 *
 * El libro es un PERIODO y cada hoja es un CONDUCTOR. Cambiar de mes cambia el
 * `unitId`, así que remonta el libro entero; cambiar de hoja no remonta nada.
 *
 * `ordenAlfabetico` es espejo del orden que aplica el servidor
 * (`recorridos-canvas.service.ts`): si divergen, insertar una hoja en caliente
 * la colocaría en una posición distinta a la que tendría al recargar.
 */

/**
 * Identidad del libro: el CORTE, no el mes.
 *
 * Cambiar cualquiera de las dos fechas cambia el `unitId` y por tanto remonta
 * el libro. Tiene que ser así: el corte decide qué filas hay en cada hoja, y
 * reaprovechar el libro dejaría celdas de un rango pintadas sobre otro.
 */
export function recorridosUnitId(desde: string, hasta: string): string {
	return `workbook-recorridos-${desde}_${hasta}`;
}

export function conductorSheetId(conductorId: string): string {
	return `conductor-${conductorId}`;
}

export function conductorIdDeSheetId(sheetId: string): string | null {
	return sheetId.startsWith('conductor-') ? sheetId.slice('conductor-'.length) : null;
}

/** Clave de orden de una hoja. Apellido y luego nombre, como el servidor. */
export function ordenAlfabetico(c: { apellido: string; nombre: string }): string {
	return `${c.apellido} ${c.nombre}`.trim();
}

/**
 * Posición en la que insertar una hoja nueva para mantener el orden.
 *
 * Se compara con `localeCompare('es')` —igual que el servidor— porque el orden
 * de los apellidos con tilde o con Ñ no coincide con el de los códigos.
 */
export function posicionDeInsercion(
	existentes: Array<{ apellido: string; nombre: string }>,
	nuevo: { apellido: string; nombre: string }
): number {
	const clave = ordenAlfabetico(nuevo);
	for (let i = 0; i < existentes.length; i++) {
		if (ordenAlfabetico(existentes[i]).localeCompare(clave, 'es') > 0) return i;
	}
	return existentes.length;
}
