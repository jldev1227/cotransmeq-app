/**
 * Plugin: convierte ciertas CELDAS en enlaces entre hojas.
 *
 * El caso: en Liquidaciones hay una columna «N° FACTURA» y en Facturas una de
 * «CONSECUTIVOS». Son la misma relación vista desde los dos lados, y hasta
 * ahora leerla obligaba a cambiar de pestaña y buscar el número a ojo entre
 * cuatrocientas filas.
 *
 * ── Por qué DOBLE clic y no clic simple ────────────────────────────────────
 *
 * Porque estas celdas siguen siendo celdas: se seleccionan para copiar el
 * número, se incluyen en un rango que se arrastra, se leen. Si el clic simple
 * navegara, no habría forma de copiar un consecutivo sin salir disparado a otra
 * hoja —y copiar es lo que más se hace con esas columnas—.
 *
 * Con doble clic el reparto es el que ya conoce cualquiera que use Excel:
 *
 *   clic          → selecciona la celda (copiable con Cmd+C)
 *   clic + arrast.→ selecciona un rango
 *   doble clic    → sigue el enlace
 *
 * ── Por qué se escucha `dblclick` en el contenedor ─────────────────────────
 *
 * Misma razón que `acciones.plugin.ts` y `selection.plugin.ts`: en
 * preset-sheets-core 0.25.1 los eventos de selección del facade no sirven
 * (`SelectionChanged` no lo emite nadie; `SelectionMoveEnd` llega con
 * `selections: []`). Lo fiable es escuchar la interacción del DOM y luego
 * preguntarle a la hoja qué quedó seleccionado.
 *
 * El doble clic de Univer abre el editor de celda. Se evita marcando esas
 * columnas como no editables desde el `cell-permission` de la hoja, que ya
 * existe; este plugin solo añade la navegación.
 */

import type { IRange } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';

/** Una columna que enlaza, dentro de una hoja concreta. */
export interface ColumnaEnlace {
	/// Id de la hoja donde vive la columna.
	sheetId: () => string;
	/// Índice de columna.
	columna: number;
	/**
	 * Qué hacer con la fila pulsada. Devuelve `true` si navegó.
	 *
	 * Recibe la fila Y el texto de la celda porque las tres hojas no resuelven
	 * igual: Liquidaciones tiene un índice fila → entidad con el `factura_id`
	 * dentro, pero Terceros no tiene índice ninguno y su único identificador es
	 * el consecutivo escrito en la celda. Dar las dos cosas evita que cada
	 * llamador se invente una forma de leer la hoja.
	 */
	alSeguir: (fila: number, texto: string) => boolean;
}

export interface EnlacesPluginOptions {
	fUniver: FUniver;
	container: HTMLElement;
	columnas: ColumnaEnlace[];
	/// Se avisa cuando el doble clic cayó en una celda-enlace pero no había
	/// destino (una liquidación sin factura, por ejemplo).
	onSinDestino?: (fila: number, columna: number) => void;
}

function rangoActivo(fUniver: FUniver): IRange | null {
	const ws: any = (fUniver as any).getActiveWorkbook?.()?.getActiveSheet?.();
	if (!ws) return null;
	const sel: any = ws.getSelection?.();
	const r: any = sel?.getActiveRange?.() ?? ws.getActiveRange?.();
	const rango = typeof r?.getRange === 'function' ? r.getRange() : (r?.range ?? r);
	return typeof rango?.startRow === 'number' ? (rango as IRange) : null;
}

export function attachEnlacesPlugin(opts: EnlacesPluginOptions): () => void {
	function leer() {
		const wsId = (opts.fUniver as any).getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
		if (!wsId) return;

		const r = rangoActivo(opts.fUniver);
		if (!r) return;
		/// Solo UNA celda. Un doble clic dentro de un rango ya arrastrado no es
		/// «sígueme el enlace», es un accidente.
		if (r.startRow !== r.endRow || r.startColumn !== r.endColumn) return;

		const destino = opts.columnas.find(
			(c) => c.columna === r.startColumn && c.sheetId() === wsId
		);
		if (!destino) return;

		let texto = '';
		try {
			const ws: any = (opts.fUniver as any).getActiveWorkbook?.()?.getActiveSheet?.();
			texto = String(ws?.getRange(r.startRow, r.startColumn, 1, 1)?.getValue?.() ?? '').trim();
		} catch {
			/// Sin texto, los enlaces que dependen del índice siguen funcionando.
		}

		if (!destino.alSeguir(r.startRow, texto)) {
			opts.onSinDestino?.(r.startRow, r.startColumn);
		}
	}

	function onDblClick() {
		/// La selección se confirma DESPUÉS del evento: leer en el mismo tick
		/// devuelve el rango anterior. Es el mismo desfase que documenta
		/// `selection.plugin.ts`.
		requestAnimationFrame(() => setTimeout(leer, 0));
	}

	opts.container.addEventListener('dblclick', onDblClick);
	return () => {
		opts.container.removeEventListener('dblclick', onDblClick);
	};
}
