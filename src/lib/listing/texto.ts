/**
 * Normalización de texto para búsquedas en cliente.
 *
 * Estaba duplicada al menos en `routes/dashboard/servicios/+page.svelte` y en
 * `stores/acciones-correctivas.ts`, con implementaciones parecidas pero no
 * idénticas: buscar «Villanueva» encontraba resultados en una página y no en
 * otra según cómo estuviera escrito el acento en la base.
 */

/**
 * Deja el texto comparable: sin acentos, sin mayúsculas y sin espacios de
 * sobra.
 *
 * La descomposición NFD separa la letra de su tilde, y el rango
 * `̀-ͯ` son justamente esas marcas diacríticas. Así «Yopal» y
 * «YOPÁL» se comparan igual, que es lo que espera quien teclea con prisa en
 * un buscador.
 */
export function normalizarTexto(valor: unknown): string {
	if (valor === null || valor === undefined) return ''
	return String(valor)
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim()
}

/**
 * ¿Alguno de los campos contiene el término buscado?
 *
 * Se parte el término en palabras y se exigen TODAS, en cualquier campo y en
 * cualquier orden: buscar «juan yopal» encuentra al conductor Juan cuya sede
 * es Yopal, que es lo que la gente espera al escribir dos datos seguidos.
 */
export function coincide(termino: string, campos: unknown[]): boolean {
	const palabras = normalizarTexto(termino).split(/\s+/).filter(Boolean)
	if (palabras.length === 0) return true

	const heno = campos.map(normalizarTexto).join(' ')
	return palabras.every((p) => heno.includes(p))
}
