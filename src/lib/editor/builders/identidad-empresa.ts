/**
 * Identidad de la empresa en los canvas.
 *
 * ÚNICO archivo que diverge a propósito entre `transmeralda` y `cotransmeq`.
 * Todo lo demás del canvas —builders, engines, adapters, preview— es byte a
 * byte idéntico en los dos repos, y así se verifica con `diff`. Si la marca
 * estuviera dentro de los builders, esos archivos dejarían de ser comparables
 * y la siguiente corrección habría que aplicarla a mano dos veces.
 *
 * La razón social es la misma en ambos (así la pinta ya `DocumentoHoja.svelte`
 * en los dos repos); lo que cambia es la marca corta del logotipo y los COLORES.
 *
 * ── POR QUÉ HAY TANTOS TONOS ──────────────────────────────────────────────
 *
 * Empezó con tres, para el canvas de recorridos. Los demás canvas llevaban
 * los verdes escritos dentro del builder, así que en Cotransmeq se pintaban
 * con la identidad de la otra empresa: naranja en la aplicación y verde
 * Transmeralda en cuanto se abría una hoja. Traerlos aquí arregla el color Y
 * conserva la regla del `diff`.
 *
 * Cada tono es un PAPEL, no un color: `fuerte` es «la banda de título», no
 * «verde oscuro». Por eso hay dos niveles de banda y dos de fondo tenue —los
 * builders ya los distinguían— y por eso `textoMarca` está separado de
 * `acento` aunque en Transmeralda sean el mismo verde: uno se lee sobre
 * blanco y el otro lleva texto encima.
 *
 * El texto que va SOBRE una banda no se declara aquí: lo decide
 * `contraste()` por luminancia, que acierta con el verde oscuro y con el
 * naranja claro sin tener que mantener dos listas en paralelo.
 *
 * ── LO QUE NO ES MARCA ────────────────────────────────────────────────────
 *
 * El gris de una celda bloqueada, la zebra, el azul de DISPONIBLE, el ámbar
 * de los festivos y los colores de cada tipo de recargo son lenguaje de la
 * hoja y no cambian de una empresa a otra. Tampoco los SEMÁFOROS: el verde de
 * APROBADA o PAGADA significa «bien» frente al rojo de ANULADA, y volverlo
 * naranja perdería ese contraste. Nada de eso vive aquí.
 *
 * ── DE DÓNDE SALEN ESTOS NARANJAS ────────────────────────────────────────
 *
 * Son los de `app.css`, donde este repo remapea la paleta `emerald` de
 * Tailwind a naranja: 400 para la banda de título, 300 para las cabeceras de
 * columna y las bandas de sección, 100 y 50 para los fondos, 800 para la
 * marca escrita. Así la hoja y la aplicación hablan el mismo idioma.
 *
 * Los dos niveles se conservan —título más fuerte que cabecera— porque es la
 * jerarquía que ya tenía la hoja en verde: sin ella, un bloque entero se lee
 * como una sola banda y no se ve dónde empieza la tabla.
 *
 * Son tonos CLAROS, al revés que los verdes de Transmeralda, y por eso el
 * texto de las bandas sale negro: lo decide `contraste()` por luminancia, sin
 * que haya que declararlo en ningún sitio.
 */
export const IDENTIDAD = {
	/** Logotipo escrito, en la esquina superior izquierda de cada hoja. */
	marca: 'COTRANSMEQ',
	razonSocial: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.',
	colores: {
		/** Banda de título de una hoja o de un bloque. El tono más oscuro. */
		fuerte: '#FB923C',
		/** Cabecera de columnas, un punto por debajo del título. */
		cabecera: '#FDBA74',
		/** Banda de sección y subcabeceras. */
		acento: '#FDBA74',
		/** Banda de concepto, el nivel más claro de los tres. */
		acentoMedio: '#FDBA74',
		/** Fondo de una fila destacada o de una casilla marcada. */
		suave: '#FFEDD5',
		/** Fondo de bloque, apenas teñido. */
		tinte: '#FFF7ED',
		/** El mismo tinte, un punto más frío. Casilla marcada. */
		acentoTenue: '#FFF7ED',
		/** Fondo de una fila incluida en el cálculo. */
		incluida: '#FED7AA',
		/** La marca usada COMO TEXTO sobre fondo claro: importes, totales. */
		textoMarca: '#9A3412',
		/** Igual, cuando hace falta más peso. */
		textoMarcaFuerte: '#9A3412'
	}
} as const;
