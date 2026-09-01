/**
 * Lee como número lo que una celda de Univer devuelve.
 *
 * EL PROBLEMA QUE RESUELVE: `getCellData().v` NO siempre trae el número crudo.
 * En cuanto la celda tiene patrón de formato —y todas las de dinero lo
 * tienen— lo que llega es el texto ya formateado: escribir 8303 en la columna
 * VALOR devuelve la cadena `"$8,303"`.
 *
 * Los adaptadores hacían `Number(raw) || 0` con eso. `Number("$8,303")` es
 * `NaN`, el `|| 0` lo convertía en **cero**, y el cero era lo que viajaba al
 * autoguardado. En pantalla el valor se veía —Univer sí lo tenía— pero la base
 * recibía 0 y al recargar la celda volvía a vaciarse. Eran los «valores
 * fantasma»: se guardaba, sí, pero se guardaba un cero.
 *
 * Se aceptan el símbolo de moneda, el de porcentaje, los espacios (incluido el
 * fino que usan algunos locales) y los separadores de miles. Lo que no encaje
 * devuelve `null` y NO cero: quien llama decide, porque «no es un número» y
 * «es cero» son cosas distintas y confundirlas fue justamente el fallo.
 */
export function numeroDeCelda(valor: unknown): number | null {
	if (valor == null) return null;
	if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
	if (typeof valor === 'boolean') return null;

	// `\s` no cubre el espacio fino ni el duro, que es justo lo que meten
	// algunos patrones de miles.
	const limpio = String(valor)
		.replace(/[$%\s  ]/g, '')
		.trim();
	if (limpio === '') return null;

	// Miles con coma y decimales con punto (1,088,233.5) → se quitan las comas.
	// Coma única como decimal (1088233,5) → pasa a punto.
	const normalizado = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(limpio)
		? limpio.replace(/,/g, '')
		: limpio.replace(',', '.');
	if (!/^-?\d*\.?\d+$/.test(normalizado)) return null;

	const n = Number(normalizado);
	return Number.isFinite(n) ? n : null;
}
