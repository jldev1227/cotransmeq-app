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
 * en los dos repos); lo que cambia es la marca corta del logotipo y los COLORES.
 *
 * Los colores viven aquí por la misma razón que la marca. Estaban escritos
 * dentro del builder de recorridos —verdes de Transmeralda, byte a byte
 * iguales en los dos repos—, así que el canvas de Cotransmeq se pintaba con la
 * identidad de la otra empresa. Sacarlos aquí arregla el color Y conserva la
 * regla: el builder sigue siendo comparable con `diff` entre repos.
 *
 * Son los tonos de marca, no una paleta general: el gris de una celda
 * bloqueada, la zebra o el azul de DISPONIBLE son lenguaje de la hoja y no
 * cambian de una empresa a otra.
 */
export const IDENTIDAD = {
	/** Logotipo escrito, en la esquina superior izquierda de cada hoja. */
	marca: 'COTRANSMEQ',
	razonSocial: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.',
	/**
	 * Tonos de marca de los canvas. Ver la cabecera.
	 *
	 * Son los naranjas de `app.css`, donde este repo ya remapea la paleta
	 * `emerald` de Tailwind a naranja: `fuerte` es el 900, `acento` el 700 y
	 * `acentoTenue` el 50. Así la hoja y la aplicación hablan el mismo idioma.
	 */
	colores: {
		/** Banda de título y cabecera de columnas. Texto blanco encima. */
		fuerte: '#7C2D12',
		/** Banda de sección, importes y casilla marcada. */
		acento: '#C2410C',
		/** Fondo de una casilla marcada. */
		acentoTenue: '#FFF7ED'
	}
} as const;
