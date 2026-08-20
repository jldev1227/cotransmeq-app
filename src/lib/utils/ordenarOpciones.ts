/**
 * Orden alfabético para las listas de catálogo que se pintan en un `<select>`.
 *
 * Un desplegable de placas o de nombres llega del backend en el orden en que
 * salió de la consulta —normalmente por fecha de creación— y eso obliga a
 * recorrer la lista entera para encontrar una entrada. Con orden A-Z se busca por
 * donde se espera.
 *
 * **No sirve para las opciones de un campo del formulario.** Las de un
 * `SINGLE_CHOICE` o `MULTIPLE_CHOICE` vienen de la definición versionada y su
 * orden es información: `BUENO / REGULAR / MALO` es una escala, y alfabetizarla
 * la convierte en `BUENO / MALO / REGULAR`, que ya no significa lo mismo. Esas se
 * pintan siempre por `sort_order`.
 */

/**
 * Comparador con `numeric: true`, que es lo que hace falta de verdad.
 *
 * Sin él, `localeCompare` compara dígito a dígito como texto y ordena `ABC10`
 * antes de `ABC9`. Con placas y con códigos numerados eso se nota enseguida.
 * `sensitivity: 'base'` iguala mayúsculas y acentos, así que `Álvarez` cae junto
 * a `Alvarez` y no al final de la lista.
 */
const COMPARADOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function compararTexto(a: string, b: string): number {
	return COMPARADOR.compare(a ?? '', b ?? '');
}

/**
 * Devuelve una copia ordenada por la etiqueta que se muestra.
 *
 * Copia y no orden en sitio: la lista de origen suele ser un `$state` o la
 * respuesta de la API, y reordenarla por debajo produce efectos a distancia.
 */
export function ordenarPorEtiqueta<T>(items: readonly T[], etiqueta: (item: T) => string): T[] {
	return [...items].sort((a, b) => compararTexto(etiqueta(a), etiqueta(b)));
}
