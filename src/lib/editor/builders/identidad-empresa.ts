/**
 * Identidad de la empresa en los canvas.
 *
 * ÚNICO archivo que diverge a propósito entre `transmeralda` y `cotransmeq`.
 * Todo lo demás del canvas de recorridos —builder, engine, adapter, preview—
 * es byte a byte idéntico en los dos repos, y así se verifica con `diff`. Si la
 * marca estuviera dentro del builder, ese archivo dejaría de ser comparable y
 * la siguiente corrección habría que aplicarla a mano dos veces.
 *
 * La razón social es la misma en ambos (así la pinta ya `DocumentoHoja.svelte`
 * en los dos repos); lo que cambia es la marca corta del logotipo.
 */
export const IDENTIDAD = {
	/** Logotipo escrito, en la esquina superior izquierda de cada hoja. */
	marca: 'COTRANSMEQ',
	razonSocial: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.'
} as const;
