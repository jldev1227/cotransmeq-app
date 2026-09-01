/**
 * Clave de room de los canvas colaborativos. ESPEJO EXACTO de
 * `backend-nest/src/sockets/sheet-rooms.ts`.
 *
 * Está duplicado a propósito: son dos builds distintos y no hay paquete
 * compartido. Si las dos implementaciones divergen, el cliente se une a un
 * room y el servidor emite a otro — y el síntoma es "la colaboración no
 * funciona", sin error visible en ninguna parte. Cambiar una obliga a
 * cambiar la otra.
 *
 * Dos granularidades:
 *  · `adicionales` y `ocasional` → libro ANUAL, room por AÑO.
 *  · `cierres-finales`           → libro de PERIODO, room por AÑO:MES.
 */

/// `ingresos` entra solo por la capa de ANOTACIONES: su contenido es
/// derivado y de solo lectura, no tiene campos que sincronizar.
export type SheetScope = 'adicionales' | 'ocasional' | 'cierres-finales' | 'ingresos';

/** Scopes cuyo libro es un periodo y por tanto exigen `mes`. */
export function requiereMes(scope: SheetScope): boolean {
	return scope === 'cierres-finales';
}

export function sheetRoomKey(
	scope: SheetScope,
	anio: number,
	mes?: number | null
): string {
	if (requiereMes(scope)) {
		if (mes == null) {
			throw new Error(`El scope "${scope}" requiere mes para construir el room`);
		}
		return `sheet:${scope}:${anio}:${mes}`;
	}
	return `sheet:${scope}:${anio}`;
}
