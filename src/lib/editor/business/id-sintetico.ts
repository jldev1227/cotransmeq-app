/**
 * Ids con forma de UUID para las filas que el canvas necesita mostrar antes de
 * que existan en la base.
 *
 * EL PROBLEMA QUE RESUELVE: las filas sintéticas (conceptos de nómina o de
 * impuestos que aún no se han persistido) llevaban ids legibles del tipo
 * `synthetic-laboral-salario`. En cuanto el autoguardado las mandaba, Postgres
 * las rechazaba —esas columnas son `@db.Uuid`— y el guardado entero moría con
 * «Error creating UUID … found `s` at 1», arrastrando también los items.
 *
 * POR QUÉ DETERMINISTA Y NO `randomUUID()`: el id tiene que ser el MISMO en
 * cada render. Con uno aleatorio, cada autoguardado insertaría una fila nueva y
 * el barrido de «lo que no viene en el payload se elimina» borraría la
 * anterior: churn infinito de filas y de versiones. Derivándolo del nombre del
 * concepto, la fila sintética siempre apunta al mismo registro y el upsert hace
 * lo que promete.
 *
 * No es un UUID v5 real (no hay dependencia de hashing aquí), pero cumple lo
 * único que importa: formato válido y estable para una misma entrada.
 *
 * LA CLAVE TIENE QUE INCLUIR EL PERIODO. Derivarla solo del nombre del concepto
 * («laboral:SALARIO») daba el MISMO uuid en los doce meses, y como el id es la
 * clave primaria de la tabla, el upsert de un mes se llevaba la fila de otro:
 * editabas los días en abril y los de marzo cambiaban, mientras abril se
 * quedaba sin conceptos y al recargar volvía a los valores por defecto. Para
 * eso está `alcanceOcasional`.
 */

/// FNV-1a de 32 bits. Determinista y suficiente para un espacio de nombres
/// cerrado como el de los conceptos estándar.
function fnv1a(texto: string, semilla: number): number {
	let h = semilla >>> 0;
	for (let i = 0; i < texto.length; i++) {
		h ^= texto.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/**
 * UUID estable derivado de `clave`.
 *
 * Se fija el nibble de versión a `4` y el de variante a `8` para que cualquier
 * validador estricto lo acepte.
 */
export function uuidDeterminista(clave: string): string {
	const a = hex8(fnv1a(clave, 0x811c9dc5));
	const b = hex8(fnv1a(clave, 0x1000193));
	const c = hex8(fnv1a(clave, 0x9e3779b9));
	const d = hex8(fnv1a(clave, 0x85ebca6b));
	const s = a + b + c + d; // 32 hex
	return [
		s.slice(0, 8),
		s.slice(8, 12),
		'4' + s.slice(13, 16),
		'8' + s.slice(17, 20),
		s.slice(20, 32)
	].join('-');
}

/**
 * Espacio de nombres de las filas sintéticas de UN periodo del canvas de
 * ocasionales. Una cabecera por (mes, año) —`@@unique([mes, anio])`—, así que
 * el par identifica la liquidación sin tener que arrastrar su id.
 */
export function alcanceOcasional(anio: number, mes: number): string {
	return `ocasional:${anio}:${mes}`;
}
