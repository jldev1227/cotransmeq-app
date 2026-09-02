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
 * Tres granularidades:
 *  · `adicionales` y `ocasional` → libro ANUAL, room por AÑO.
 *  · `cierres-finales`           → libro de PERIODO, room por AÑO:MES.
 *  · `nomina`                    → libro de PERIODO (una hoja por conductor),
 *    room por AÑO:MES, por la misma razón que `cierres-finales`.
 *  · `servicios-historial`       → HISTÓRICO completo, room GLOBAL: el
 *    filtro de año del canvas es una vista, no un libro distinto, y dos
 *    usuarios mirando años distintos deben verse entre sí. El `anio` se
 *    sigue enviando en el join (el gateway lo valida), pero no entra en
 *    la clave.
 */

/// `ingresos` entra solo por la capa de ANOTACIONES: su contenido es
/// derivado y de solo lectura, no tiene campos que sincronizar.
export type SheetScope =
	| 'adicionales'
	| 'ocasional'
	| 'cierres-finales'
	| 'ingresos'
	| 'servicios-historial'
	| 'nomina';

/** Scopes cuyo libro es un periodo y por tanto exigen `mes`. */
export function requiereMes(scope: SheetScope): boolean {
	// `nomina` es un libro de PERIODO igual que `cierres-finales`: una hoja
	// por conductor del mes, así que el room lleva mes.
	return scope === 'cierres-finales' || scope === 'nomina';
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
	if (scope === 'servicios-historial') {
		return `sheet:${scope}`;
	}
	return `sheet:${scope}:${anio}`;
}
