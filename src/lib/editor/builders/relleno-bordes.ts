import { BorderStyleTypes, type IBorderData, type ICellData, type IStyleData } from '@univerjs/core';
import type { IRange } from '@univerjs/core';

/**
 * Extiende la retícula de bordes a las celdas VACÍAS de la hoja.
 *
 * POR QUÉ A MANO Y NO POR CONFIGURACIÓN: Univer 0.25.1 no lo permite. Se probó
 * `defaultStyle` a nivel de hoja —el modelo sí lo compone en
 * `getComposedCellStyle`— y también `showGridlines: TRUE` con `gridlinesColor`;
 * ninguno pinta nada, porque el pintor de bordes solo recorre las celdas que
 * EXISTEN en `cellData`. La única vía es materializar las celdas vacías con
 * estilo, que es lo que hace esto.
 *
 * El coste es asumible: las hojas del módulo son de decenas de filas por ~20
 * columnas, no de miles.
 *
 * Se respetan las celdas combinadas: solo se pinta su ancla. Rellenar las
 * celdas cubiertas dibujaría líneas POR DENTRO del bloque combinado, que es
 * justo lo que la combinación pretende quitar.
 */
const BORDE = { s: BorderStyleTypes.THIN, cl: { rgb: '#CBD5E1' } };

const BORDES_VACIO: IBorderData = { t: BORDE, r: BORDE, b: BORDE, l: BORDE };

/// Una sola instancia compartida: son celdas de solo estilo, nadie las muta.
///
/// Se exporta porque la CAPA DE HOJA usa exactamente este estilo. Si una celda
/// escrita a mano llevara uno propio (fondo, cursiva…), al borrar su contenido
/// Univer se lleva el estilo entero por delante y esa celda se queda sin
/// bordes: un agujero en la retícula.
export const ESTILO_CELDA_VACIA: IStyleData = { bd: BORDES_VACIO };

/**
 * Devuelve además las celdas que estaban EN BLANCO, como claves `fila:columna`.
 *
 * Es la definición precisa de «celda libre» que necesita la capa de
 * anotaciones: una celda sin contenido propio del builder. Con ella, escribir
 * una nota nunca puede pisar una etiqueta ni un valor derivado, y no hace falta
 * adivinar por posición.
 */
export function rellenarBordesVacios(
	cellData: Record<number, Record<number, ICellData>>,
	rowCount: number,
	columnCount: number,
	mergeData: IRange[] = []
): Set<string> {
	/// Celdas cubiertas por una combinación, excluida su ancla.
	const cubiertas = new Set<string>();
	for (const m of mergeData) {
		for (let r = m.startRow; r <= m.endRow; r++) {
			for (let c = m.startColumn; c <= m.endColumn; c++) {
				if (r === m.startRow && c === m.startColumn) continue;
				cubiertas.add(`${r}:${c}`);
			}
		}
	}

	const enBlanco = new Set<string>();
	for (let r = 0; r < rowCount; r++) {
		const fila = cellData[r] ?? (cellData[r] = {});
		for (let c = 0; c < columnCount; c++) {
			if (fila[c] !== undefined) continue;
			if (cubiertas.has(`${r}:${c}`)) continue;
			fila[c] = { s: ESTILO_CELDA_VACIA };
			enBlanco.add(`${r}:${c}`);
		}
	}
	return enBlanco;
}
