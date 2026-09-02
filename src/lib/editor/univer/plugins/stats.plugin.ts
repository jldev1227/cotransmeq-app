/**
 * Plugin: emite eventos de selección con sum/avg/min/max/count.
 * API confirmada contra @univerjs/sheets-ui 0.25.1:
 *   - `FUniver.Event.SelectionChanged` vía `univerAPI.addEvent()`
 *   - SheetsSelectionsService.selectionChanged$ (Observable) como fallback
 *
 * IMPORTANTE sobre el payload del evento SelectionChanged:
 *   El callback registrado vía `fUniver.addEvent(Event.SelectionChanged, cb)`
 *   recibe un objeto `ISelectionEventParams` con la forma
 *     { workbook, worksheet, selections: IRange[] }
 *   NO un array suelto de selections. Iterar directamente sobre el primer
 *   argumento lanza "selections is not iterable" (ver #bug-stats-iterable).
 */

import type { IDisposable, Nullable, ICellData, IRange } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { parseCOP } from '../../business/format.utils';

export interface StatsPayload {
  count: number;
  nonEmpty: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  allNumeric: boolean;
}

export interface StatsPluginOptions {
  fUniver: FUniver;
  fWorkbook: FWorkbook;
  container: HTMLElement;
  onChange: (s: StatsPayload) => void;
}

interface ISelectionEventParams {
  workbook?: unknown;
  worksheet?: unknown;
  selections?: IRange[];
}

export function attachStatsPlugin(opts: StatsPluginOptions): () => void {
  const disposables: IDisposable[] = [];

  // Camino único: addEvent (API pública recomendada).
  // NO intentamos acceder al SheetsSelectionsService por redi directamente:
  //   - Es un servicio SCOPED a la unidad (workbook), no accesible desde el
  //     injector global del FUniver → QuantityCheckError.
  //   - FUniver.Event.SelectionChanged es el canal soportado oficialmente.
    try {
    const Event = (opts.fUniver as any).Event;
    if (Event?.SelectionChanged) {
      const disp = opts.fUniver.addEvent(Event.SelectionChanged, (event: unknown) => {
        const params = (event ?? {}) as ISelectionEventParams;
        const ranges: IRange[] = Array.isArray(params.selections) ? params.selections : [];
        console.log('[editor][stats] SelectionChanged', { rangesCount: ranges.length });
        const payload = computeStats(opts.fWorkbook, ranges);
        opts.onChange(payload);
      });
      disposables.push(disp);
    } else {
      console.warn('[stats] FUniver.Event.SelectionChanged no disponible');
    }
  } catch (e) {
    console.warn('[editor] addEvent SelectionChanged no disponible', e);
  }

  return () => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  };
}

function computeStats(fWorkbook: FWorkbook, selections: Nullable<IRange[]>): StatsPayload {
  if (!selections || selections.length === 0) return zeroStats();
  const sheet = fWorkbook.getActiveSheet();
  if (!sheet) return zeroStats();

  const values: number[] = [];
  let allNumeric = true;
  let nonEmpty = 0;
  let count = 0;

  for (const sel of selections) {
    if (!sel) continue;
    const startRow = sel.startRow ?? 0;
    const endRow = sel.endRow ?? startRow;
    const startColumn = sel.startColumn ?? 0;
    const endColumn = sel.endColumn ?? startColumn;
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startColumn; c <= endColumn; c++) {
        count++;
        const cell: ICellData | null = sheet.getRange(r, c).getCellData();
        if (!cell || cell.v == null || cell.v === '') continue;
        const n = parseCOP(String(cell.v));
        if (isNaN(n)) {
          allNumeric = false;
        } else {
          values.push(n);
          nonEmpty++;
        }
      }
    }
  }

  const sum = values.reduce((s, v) => s + v, 0);
  return {
    count,
    nonEmpty,
    sum,
    avg: values.length ? sum / values.length : 0,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    allNumeric
  };
}

function zeroStats(): StatsPayload {
  return { count: 0, nonEmpty: 0, sum: 0, avg: 0, min: 0, max: 0, allNumeric: true };
}
