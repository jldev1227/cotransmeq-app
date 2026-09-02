/**
 * Plugin: informa de qué FILAS están seleccionadas en la hoja activa.
 *
 * Existe porque hasta ahora ningún canvas del proyecto necesitaba "selecciona
 * varias filas y actúa sobre ellas": el patrón vigente era abrir un modal con
 * su propia lista de checkboxes. En el historial de liquidaciones eso sería
 * pedirle al usuario que vuelva a buscar en una lista lo que ya tiene delante
 * y ordenado en la hoja.
 *
 * ── Por qué NO se usan los eventos de selección del facade ──
 *
 * Medido contra @univerjs/preset-sheets-core 0.25.1, ninguno sirve:
 *
 *  · `Event.SelectionChanged` **no lo emite nadie**. La clave existe en el enum
 *    y `addEvent` la acepta sin quejarse, así que parece cableada. Es lo que le
 *    pasa a `stats.plugin.ts`, escrito contra ese evento y sin consumidores —
 *    nunca llegó a funcionar y nadie lo notó.
 *  · `Event.SelectionMoveEnd` sí se emite, pero su payload llega con
 *    `selections: []`. El objeto trae `{ workbook, worksheet, selections }` y
 *    ese tercer campo viene vacío incluso con un rango vivo en pantalla.
 *
 * Así que el evento no puede ser la fuente del dato. Lo que sí es fiable es
 * preguntarle a la hoja: `FWorksheet.getSelection()` devuelve el rango activo
 * y la lista de rangos. Este plugin escucha la INTERACCIÓN en el contenedor
 * (ratón y teclado) y, tras cada una, lee la hoja.
 *
 * La lectura va en un `requestAnimationFrame` porque en el `pointerup` la
 * selección todavía no se ha actualizado: leer ahí devuelve el rango anterior.
 */

import type { IRange } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';

export interface SelectionPluginOptions {
	fUniver: FUniver;
	/// Contenedor del canvas: es donde se escuchan ratón y teclado.
	container: HTMLElement;
	/// Filas (0-based, coordenadas de Univer) cubiertas por la selección, en orden.
	onChange: (filas: number[]) => void;
	/**
	 * Tope de filas que se traducen. Seleccionar la columna entera manda un
	 * rango de un millón de filas y recorrerlo congela la pestaña; por encima
	 * del tope se informa de selección vacía, que es lo mismo que "no hay nada
	 * accionable aquí".
	 */
	maxFilas?: number;
}

/// Los rangos llegan envueltos de formas distintas según el método del facade:
/// `FRange` (con `getRange()`), `{ range }` o un `IRange` pelado.
function comoRango(x: any): IRange | null {
	if (!x) return null;
	const r = typeof x.getRange === 'function' ? x.getRange() : (x.range ?? x);
	return typeof r?.startRow === 'number' ? (r as IRange) : null;
}

function rangosDeLaHoja(fUniver: FUniver): IRange[] {
	const ws: any = (fUniver as any).getActiveWorkbook?.()?.getActiveSheet?.();
	if (!ws) return [];

	// Tres vías, de la más completa a la más básica. No es paranoia gratuita:
	// `getActiveRangeList` cubre la multiselección con Ctrl pero no está en
	// todas las versiones, y `FWorksheet.getActiveRange` existe en paralelo a
	// `getSelection().getActiveRange()` sin que la documentación aclare cuál
	// gana. Se prueban en orden y se usa la primera que devuelva algo.
	const sel: any = ws.getSelection?.();

	const lista: any = sel?.getActiveRangeList?.();
	const crudos: any[] = Array.isArray(lista)
		? lista
		: typeof lista?.getRanges === 'function'
			? lista.getRanges()
			: [];
	const deLista = crudos.map(comoRango).filter(Boolean) as IRange[];
	if (deLista.length > 0) return deLista;

	const deSeleccion = comoRango(sel?.getActiveRange?.());
	if (deSeleccion) return [deSeleccion];

	const deHoja = comoRango(ws.getActiveRange?.());
	return deHoja ? [deHoja] : [];
}

export function attachSelectionPlugin(opts: SelectionPluginOptions): () => void {
	const maxFilas = opts.maxFilas ?? 5000;
	let ultimaClave = '';
	let programado = false;

	function leer() {
		programado = false;
		const vistas = new Set<number>();
		let desbordado = false;

		for (const rg of rangosDeLaHoja(opts.fUniver)) {
			const desde = rg.startRow ?? 0;
			const hasta = rg.endRow ?? desde;
			if (hasta - desde + 1 > maxFilas) {
				desbordado = true;
				break;
			}
			for (let r = desde; r <= hasta; r++) vistas.add(r);
		}

		const filas = desbordado ? [] : [...vistas].sort((a, b) => a - b);
		// Sin esta comparación, mover el ratón dentro del mismo rango
		// reasignaría el array y recalcularía el estado del carril por nada.
		const clave = filas.join(',');
		if (clave === ultimaClave) return;
		ultimaClave = clave;
		opts.onChange(filas);
	}

	function programarLectura() {
		if (programado) return;
		programado = true;
		// La selección se actualiza DESPUÉS del pointerup: leer en el mismo tick
		// devuelve el rango anterior. Se lee en el siguiente frame y otra vez en
		// la siguiente macrotarea, porque Univer a veces confirma el rango en un
		// `setTimeout` propio y el frame llega demasiado pronto. La segunda
		// lectura es gratis cuando no cambia nada: `leer` compara contra
		// `ultimaClave` y no notifica si el resultado es el mismo.
		requestAnimationFrame(() => {
			leer();
			programado = true;
			setTimeout(leer, 0);
		});
	}

	opts.container.addEventListener('pointerup', programarLectura);
	opts.container.addEventListener('keyup', programarLectura);

	return () => {
		opts.container.removeEventListener('pointerup', programarLectura);
		opts.container.removeEventListener('keyup', programarLectura);
	};
}
