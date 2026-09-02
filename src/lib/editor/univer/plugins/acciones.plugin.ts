/**
 * Plugin: convierte una COLUMNA de la hoja en columna de acciones.
 *
 * Univer no tiene celdas-botón; lo que sí es fiable (misma técnica que
 * `selection.plugin.ts`, y por las mismas razones: los eventos de selección
 * del facade no funcionan en 0.25.1) es escuchar el `pointerup` en el
 * contenedor y preguntarle a la hoja qué quedó seleccionado. Si la selección
 * es UNA sola celda de la columna de acciones, el usuario "pulsó el botón".
 *
 * El guard de fila única importa: arrastrar un rango que atraviese la
 * columna de acciones es una selección normal (para aprobar en lote desde el
 * carril), no un torrente de previews.
 */

import type { IRange } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';

export interface AccionesPluginOptions {
	fUniver: FUniver;
	container: HTMLElement;
	/// Columna que actúa como botón.
	columna: number;
	/// Id de la hoja donde aplica; en las demás hojas el clic es selección normal.
	sheetId: () => string;
	/// Fila (0-based) pulsada. El llamador decide si esa fila es accionable.
	onAccion: (fila: number) => void;
}

function rangoActivo(fUniver: FUniver): IRange | null {
	const ws: any = (fUniver as any).getActiveWorkbook?.()?.getActiveSheet?.();
	if (!ws) return null;
	const sel: any = ws.getSelection?.();
	const r: any = sel?.getActiveRange?.() ?? ws.getActiveRange?.();
	const rango = typeof r?.getRange === 'function' ? r.getRange() : (r?.range ?? r);
	return typeof rango?.startRow === 'number' ? (rango as IRange) : null;
}

export function attachAccionesPlugin(opts: AccionesPluginOptions): () => void {
	let ultimaFila = -1;
	let ultimaVez = 0;

	function leer() {
		const wsId = (opts.fUniver as any)
			.getActiveWorkbook?.()
			?.getActiveSheet?.()
			?.getSheetId?.();
		if (wsId !== opts.sheetId()) return;

		const r = rangoActivo(opts.fUniver);
		if (!r) return;
		// Solo UNA celda, y de la columna de acciones.
		if (r.startRow !== r.endRow || r.startColumn !== r.endColumn) return;
		if (r.startColumn !== opts.columna) return;

		// El mismo clic produce un pointerup y a veces un segundo evento del
		// editor de Univer: sin esta ventana, un doble clic abriría dos
		// previews de la misma fila.
		const ahora = Date.now();
		if (r.startRow === ultimaFila && ahora - ultimaVez < 600) return;
		ultimaFila = r.startRow;
		ultimaVez = ahora;

		opts.onAccion(r.startRow);
	}

	function onPointerUp() {
		// La selección se confirma DESPUÉS del pointerup (ver selection.plugin):
		// leer en el mismo tick devuelve el rango anterior.
		requestAnimationFrame(() => setTimeout(leer, 0));
	}

	opts.container.addEventListener('pointerup', onPointerUp);
	return () => {
		opts.container.removeEventListener('pointerup', onPointerUp);
	};
}
