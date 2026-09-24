/**
 * Decisiones de color que NO dependen de la empresa.
 *
 * Va aparte de `identidad-empresa.ts` a propósito: allí viven los VALORES que
 * divergen entre `transmeralda` y `cotransmeq` —los tonos de marca— y este
 * archivo es la LÓGICA, que es la misma en los dos y se verifica con `diff`
 * como el resto del canvas.
 */

/** Texto oscuro de la hoja. El «negro» de las celdas normales. */
export const TEXTO_OSCURO = '#0F172A';

/**
 * Texto blanco o negro según lo oscuro que sea el fondo.
 *
 * POR QUÉ NO UN COLOR FIJO. Las bandas de marca son verde oscuro en
 * Transmeralda y naranja claro en Cotransmeq: un `#FFFFFF` clavado deja el
 * rótulo de Cotransmeq ilegible, y un `#0F172A` clavado hace lo propio con el
 * de Transmeralda. Además estas mismas cabeceras se pintan a veces con
 * colores que no son de marca —el ámbar del festivo, el rojo del domingo, el
 * color de cada tipo de recargo— y ahí la respuesta tampoco es la misma.
 * Decidirlo por luminancia acierta en los tres casos sin que nadie tenga que
 * acordarse.
 */
export function contraste(hex: string): string {
	const c = hex.replace('#', '');
	if (c.length !== 6) return TEXTO_OSCURO;
	const r = parseInt(c.slice(0, 2), 16);
	const g = parseInt(c.slice(2, 4), 16);
	const b = parseInt(c.slice(4, 6), 16);
	// Luminancia relativa, redondeada: no hace falta más precisión para
	// decidir entre dos colores.
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.6 ? TEXTO_OSCURO : '#FFFFFF';
}
