/**
 * Activación de hoja para los canvas de libro anual (12 hojas, una por mes).
 *
 * Cambiar de mes es SOLO cambiar la hoja activa: no se remonta el engine ni
 * se reconstruye el workbook. `disposeEngine` termina el Worker de fórmulas
 * y vacía el contenedor, así que remontar por cada cambio de mes costaría un
 * Worker nuevo y el reparseo de las 12 hojas.
 *
 * API verificada contra `@univerjs/sheets` 0.25.1
 * (`lib/types/facade/f-workbook.d.ts:194,220`):
 *   - `getSheetBySheetId(sheetId): FWorksheet | null`
 *   - `setActiveSheet(sheet: FWorksheet | string): FWorksheet`
 */

import type { EngineContext } from './engine';

/**
 * Activa la hoja `sheetId`. Devuelve `true` si se activó.
 *
 * No lanza: durante un teardown en curso el workbook puede haber
 * desaparecido, y una activación fallida nunca debe tumbar el canvas.
 */
export function activarHoja(ctx: EngineContext, sheetId: string): boolean {
	try {
		const wb = ctx.fUniver.getActiveWorkbook?.();
		if (!wb) return false;
		const sheet = (wb as any).getSheetBySheetId?.(sheetId);
		if (!sheet) {
			console.warn('[editor] activarHoja: hoja no encontrada', sheetId);
			return false;
		}
		(wb as any).setActiveSheet(sheet);
		return true;
	} catch (e) {
		console.warn('[editor] activarHoja falló', sheetId, e);
		return false;
	}
}

/** Id de la hoja activa, o `null` si no hay workbook montado. */
export function hojaActiva(ctx: EngineContext): string | null {
	try {
		const wb = ctx.fUniver.getActiveWorkbook?.();
		return (wb as any)?.getActiveSheet?.()?.getSheetId?.() ?? null;
	} catch {
		return null;
	}
}
