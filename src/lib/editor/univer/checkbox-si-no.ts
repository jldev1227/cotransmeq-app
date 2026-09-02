/**
 * Checkbox de Univer para las columnas de acción SÍ/NO.
 *
 * ── Por qué un checkbox y no texto ──
 * Estas columnas eran celdas donde el usuario escribía `SÍ` o `NO` a mano.
 * Los lectores de ambos lados (`leerBooleano` en el canvas de ingresos,
 * `parseBooleano` en el backend de cierres) aceptan `SI`, `SÍ`, `S`, `X`,
 * `1` y `TRUE` sin distinguir mayúsculas ni acentos, así que el problema
 * no era la normalización: es que pedir que se teclee una decisión binaria
 * invita a escribir cualquier otra cosa —«Si.», «si aplica», un espacio—
 * y a dudar de si quedó marcada.
 *
 * ── Por qué los valores siguen siendo SÍ/NO ──
 * `requireCheckbox('SÍ', 'NO')` cambia solo cómo se PINTA la celda: el
 * valor que guarda sigue siendo la misma cadena de siempre. Así el
 * binding, los adaptadores, los permisos, el backend y el preview no se
 * enteran, y una hoja marcada antes de este cambio se lee igual.
 *
 * ── Cómo viaja el clic ──
 * El render del checkbox despacha `SetRangeValuesCommand` con el valor
 * contrario, que es el MISMO comando que ya interceptan los
 * `cell-permission-*` y los adaptadores de cambio. Por eso marcar con el
 * ratón persiste por el camino de siempre y no hizo falta tocar ninguno.
 */

/** Los dos valores de la regla. Son los que pintan los builders. */
export const CHECKBOX_SI = 'SÍ';
export const CHECKBOX_NO = 'NO';

export interface RangoFilas {
	desde: number;
	hasta: number;
}

/**
 * `true` si el preset de validación de datos está cargado.
 *
 * Sin él no existe `newDataValidation`. No es un error: la celda se queda
 * como texto SÍ/NO, que se sigue pudiendo escribir. Se comprueba para
 * poder avisar una sola vez en vez de fallar hoja por hoja.
 */
export function hayValidacionDeDatos(fUniver: unknown): boolean {
	return typeof (fUniver as any)?.newDataValidation === 'function';
}

/**
 * Cuelga un checkbox SÍ/NO de una o varias columnas de una hoja.
 *
 * @param fUniver  facade del engine (`ctx.fUniver`).
 * @param sheetId  hoja REAL, la que devolvió Univer — no la que se pidió:
 *   `insertSheet` no garantiza respetar el id que se le pasa.
 * @param columnas índices 0-based de las columnas de acción.
 * @param rango    filas 0-based que ocupan los items.
 * @returns `false` si no se pudo aplicar, para que quien llama decida si
 *   avisar. Nunca lanza: un checkbox que falta es un incordio, no motivo
 *   para dejar el canvas sin montar.
 */
export function colgarCheckboxSiNo(
	fUniver: unknown,
	sheetId: string,
	columnas: number[],
	rango: RangoFilas | null
): boolean {
	if (!rango || columnas.length === 0) return false;
	const api = fUniver as any;
	if (!hayValidacionDeDatos(api)) return false;

	const filas = rango.hasta - rango.desde + 1;
	if (filas <= 0) return false;

	try {
		const hoja = api.getActiveWorkbook?.()?.getSheetBySheetId?.(sheetId);
		if (!hoja?.getRange) return false;
		for (const columna of columnas) {
			// Una regla por columna: `setDataValidation` toma el rango de la
			// llamada, y dos columnas no contiguas no se pueden expresar en un
			// solo rango rectangular.
			const regla = api
				.newDataValidation()
				.requireCheckbox(CHECKBOX_SI, CHECKBOX_NO)
				.build();
			hoja.getRange(rango.desde, columna, filas, 1).setDataValidation(regla);
		}
		return true;
	} catch (e) {
		console.warn('[checkbox-si-no] no se pudo colgar el checkbox', { sheetId, e });
		return false;
	}
}
