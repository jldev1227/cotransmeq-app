/**
 * Traduce las ediciones del canvas de nómina a patches de dominio.
 *
 * Escucha `set-range-values`, resuelve qué campo es cada celda por el binding
 * y emite un patch por celda con su `base_version` para que el servidor haga
 * compare-and-swap.
 *
 * DOS COSAS QUE NO SE PUEDEN OLVIDAR:
 *
 *  1. `isApplyingRemote()`. Cuando llega el cambio de otro usuario se escribe
 *     en la hoja, eso dispara `set-range-values`, y si el adapter lo reemitiera
 *     tendríamos un bucle infinito entre los dos navegadores.
 *
 *  2. Leer el número con `numeroDeCelda()` y no con `Number(cell.v)`. Cuando
 *     la celda tiene `numFmt`, `getCellData().v` devuelve el texto YA
 *     formateado: `Number("$8,303")` es `NaN`, y un `|| 0` lo convertiría en
 *     un CERO que viaja a la base de datos.
 *
 *  3. Las coordenadas salen de `params.range`, NO de las claves de
 *     `params.value`. Ver `celdasTocadas`.
 */

import type { FUniver } from '@univerjs/core/facade';
import { isApplyingRemote } from '../apply-remote-patch';
import { getNominaBinding, type NominaBinding } from '../../business/nomina-cell-binding';
import { numeroDeCelda } from '../../business/numero-de-celda';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_WORKSHEET_ACTIVE = 'sheet.operation.set-worksheet-active';

export interface PatchNomina {
	binding: NominaBinding;
	valor: number | string | null;
	/** Coordenadas, para poder revertir la celda si el servidor rechaza. */
	sheetId: string;
	row: number;
	column: number;
}

export interface CellChangeNominaOptions {
	fUniver: FUniver;
	unitId: string;
	/** Se llama una vez por celda editada. */
	onPatch: (patch: PatchNomina) => void;
	/** Valor que el usuario escribió y no se pudo interpretar como número. */
	onValorInvalido?: (aviso: { campo: string; texto: string }) => void;
	/**
	 * El usuario cambió de hoja desde la barra de pestañas de Univer.
	 *
	 * Sin esto la página no se entera: la cabecera seguiría mostrando el
	 * conductor anterior y —esto es lo grave— el carril de estado actuaría
	 * sobre ÉL y no sobre el que se está mirando.
	 */
	onHojaActiva?: (sheetId: string) => void;
}

/**
 * Campos que se guardan como TEXTO. El resto son números y se leen con
 * `numeroDeCelda()`.
 */
const CAMPOS_TEXTO = new Set(['observaciones']);

export function attachCellChangeNomina(opts: CellChangeNominaOptions): () => void {
	const { fUniver, unitId, onPatch } = opts;

	const disposable = fUniver.onCommandExecuted((command) => {
		if (command.id === SET_WORKSHEET_ACTIVE) {
			const p = (command.params ?? {}) as Record<string, any>;
			if (p.unitId && p.unitId !== unitId) return;
			const destino: string | undefined = p.subUnitId ?? p.sheetId;
			if (destino) opts.onHojaActiva?.(destino);
			return;
		}
		if (command.id !== SET_RANGE_VALUES) return;
		// El eco de una escritura remota no se reemite.
		if (isApplyingRemote()) return;

		const params = (command.params ?? {}) as Record<string, any>;
		if (params.unitId && params.unitId !== unitId) return;
		const sheetId: string | undefined = params.subUnitId ?? params.sheetId;
		if (!sheetId) return;

		for (const { row, column } of celdasTocadas(params)) {
			const binding = getNominaBinding(unitId, sheetId, row, column);
			// Sin binding no hay campo que actualizar. No debería llegar
			// aquí —el permiso de celda lo corta antes—, pero el adapter no
			// depende de eso: si mañana se afloja el permiso, esto sigue
			// sin inventarse un destino.
			if (!binding) continue;

			// Se lee de la HOJA y no de `params.value`: lo que llega en el
			// comando puede ser el texto tecleado sin normalizar, mientras
			// que la celda ya tiene aplicado el formato.
			const crudo = leerCrudo(fUniver, unitId, sheetId, row, column);

			let valor: number | string | null;
			if (CAMPOS_TEXTO.has(binding.field)) {
				valor = crudo === null || crudo === undefined ? '' : String(crudo);
			} else {
				// `numeroDeCelda` devuelve `null` —y no cero— cuando lo que
				// hay no es un número: con `numFmt`, `getCellData().v` trae
				// el texto ya formateado y `Number("$8,303")` es `NaN`. Un
				// `|| 0` mandaría un CERO a la base de datos.
				const n = numeroDeCelda(crudo);
				if (n === null) {
					const vacia = crudo === null || crudo === undefined || String(crudo).trim() === '';
					if (!vacia) {
						opts.onValorInvalido?.({ campo: binding.field, texto: String(crudo) });
						continue;
					}
					valor = 0;
				} else {
					valor = n;
				}
			}

			onPatch({ binding, valor, sheetId, row, column });
		}
	});

	return () => {
		try {
			disposable?.dispose?.();
		} catch {
			/* noop */
		}
	};
}

/**
 * Qué celdas tocó un `set-range-values`.
 *
 * LAS COORDENADAS ESTÁN EN `range`, NO EN `value`. `SetRangeValuesCommand`
 * admite dos formas para `value`: una MATRIZ indexada por fila y columna, y
 * una ÚNICA `ICellData` que se aplica a todo el rango. El editor de celda usa
 * la segunda —al confirmar con Enter manda
 * `{ range: {startRow:12,…,startColumn:42,…}, value: { v: 4, p: null, f: null } }`—
 * y la primera no aparece en la edición normal.
 *
 * Este adapter recorría `Object.entries(params.value)` dando por hecho la
 * matriz. Con la forma de una sola celda eso recorría las claves de la propia
 * `ICellData`: `Number('v')` es `NaN`, ninguna coordenada casaba con un
 * binding y NO SE EMITÍA NINGÚN PATCH. El efecto era el peor posible —la celda
 * aceptaba el número, se pintaba, no salía ningún aviso y al recargar volvía
 * el valor viejo— porque el permiso de celda sí mira `params.range` y dejaba
 * pasar la escritura. Los canvas de terceros nunca lo sufrieron: recorren el
 * rango desde el principio.
 *
 * Se recorre el rango y el valor se lee de la hoja (`leerCrudo`), así que la
 * forma de `value` deja de importar. Se mantiene el camino de la matriz para
 * las escrituras que sí la usan (un pegado con celdas distintas).
 */
function* celdasTocadas(
	params: Record<string, any>
): Generator<{ row: number; column: number }> {
	const rangos: any[] = params.range
		? [params.range]
		: Array.isArray(params.ranges)
			? params.ranges
			: [];

	if (rangos.length) {
		for (const r of rangos) {
			const { startRow, endRow, startColumn, endColumn } = r ?? {};
			/// Un rango descomunal —seleccionar la columna entera— no se recorre
			/// celda a celda. No hay ninguna zona editable de ese tamaño, así que
			/// serían un millón de vueltas para no encontrar ni un binding. El
			/// permiso de celda ya lo corta antes; esto es por si se afloja.
			if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > 2000) continue;
			if (
				!Number.isFinite(startRow) ||
				!Number.isFinite(endRow) ||
				!Number.isFinite(startColumn) ||
				!Number.isFinite(endColumn)
			) {
				continue;
			}
			for (let row = startRow; row <= endRow; row++) {
				for (let column = startColumn; column <= endColumn; column++) {
					yield { row, column };
				}
			}
		}
		return;
	}

	// Sin rango: la forma de matriz, indexada por fila y columna.
	const value = params.value;
	if (!value || typeof value !== 'object') return;
	for (const [rStr, fila] of Object.entries(value as Record<string, any>)) {
		const row = Number(rStr);
		if (!Number.isInteger(row)) continue;
		for (const cStr of Object.keys(fila ?? {})) {
			const column = Number(cStr);
			if (!Number.isInteger(column)) continue;
			yield { row, column };
		}
	}
}

/** El `v` crudo de la celda, tal cual lo devuelve Univer. */
function leerCrudo(
	fUniver: FUniver,
	unitId: string,
	sheetId: string,
	row: number,
	column: number
): unknown {
	try {
		const wb = fUniver.getUniverSheet(unitId);
		const hoja = wb?.getSheetBySheetId?.(sheetId);
		return hoja?.getRange?.(row, column)?.getCellData?.()?.v ?? null;
	} catch {
		return null;
	}
}
