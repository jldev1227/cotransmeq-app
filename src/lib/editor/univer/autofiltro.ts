/**
 * Autofiltro tipo Excel sobre la tabla de items de una hoja.
 *
 * El desplegable en cada celda de cabecera lo aporta el preset de filtros
 * (`filtros: true` en `createLiquidacionEngine`), pero el RANGO hay que
 * declararlo: sin `createFilter()` sobre la cabecera y los datos no hay botón,
 * que es lo que pasaba en ingresos, adicionales y ocasional. Es el mismo
 * mecanismo que `crearFiltros()` en `servicios-historial-engine.ts`.
 *
 * El rango va de la CABECERA a la última fila de items y NO incluye el pie:
 * dentro del filtro, «TOTALES» sería un valor más del desplegable y el pie
 * desaparecería al filtrar por cualquier otra cosa. Las filas de abajo
 * (totales, descuentos, notas) quedan fuera y no se mueven.
 *
 * Los `SUM` del pie siguen sumando lo oculto: el total de la hoja es el del
 * documento, no el de lo que se ve, y así coincide con lo que guarda el
 * servidor.
 */

import type { EngineContext } from './engine';

export interface RangoAutofiltro {
	sheetId: string;
	/// Fila 0-based de la cabecera. Las tres hojas la tienen en la 0.
	filaCabecera: number;
	/// Última fila 0-based de items. Menor que la cabecera ⇒ hoja sin items.
	ultimaFila: number;
	/// Nº de columnas de la tabla.
	columnas: number;
}

export function crearAutofiltros(
	ctx: EngineContext,
	rangos: RangoAutofiltro[],
	etiqueta: string
): void {
	const wb = ctx.fUniver.getActiveWorkbook() as any;
	if (!wb) return;
	for (const r of rangos) {
		try {
			const ws = wb.getSheetBySheetId?.(r.sheetId);
			/// Una hoja sin items dejaría el rango en la sola cabecera, que Univer
			/// acepta pero deja un desplegable que no filtra nada. Mejor sin él.
			if (!ws || r.ultimaFila <= r.filaCabecera || r.columnas <= 0) continue;
			ws.getRange(
				r.filaCabecera,
				0,
				r.ultimaFila - r.filaCabecera + 1,
				r.columnas
			).createFilter();
		} catch (e) {
			// Que la hoja se vea sin filtro es peor que no verse.
			console.warn(`[${etiqueta}] no se pudo crear el autofiltro de`, r.sheetId, e);
		}
	}
}
