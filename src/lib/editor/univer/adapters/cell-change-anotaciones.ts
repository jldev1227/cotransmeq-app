import type { ICommandService, ICommandInfo, IDisposable, IRange, ICellData } from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { anclaDe, type Ancla } from '../../business/zona-libre';

/**
 * Adaptador de ANOTACIONES puro.
 *
 * Para canvas que no tienen adaptador de celdas propio porque su contenido es
 * derivado y de solo lectura —hoy, el de ingresos por cliente—. Ahí no hay
 * ningún campo editable que interceptar, pero sí queremos que el equipo pueda
 * dejar notas en la zona libre.
 *
 * Los canvas que YA tienen adaptador (cierres, ocasional, adicionales) no usan
 * este: resuelven la anotación dentro del suyo, en el mismo recorrido del
 * rango donde deciden el destino de cada celda.
 */

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
/**
 * Borrar con Supr NO pasa por `set-range-values`: Univer emite su propio
 * comando. Sin escucharlo, la nota desaparecía de la pantalla pero no se
 * borraba en el servidor — al recargar volvía a estar.
 */
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

export interface AnotacionesAdapterContext {
	unitId: string;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `subUnitId` → mes (1..12), o `null` si la hoja no es de este libro. */
	resolveMes: (sheetId: string) => number | null;
	/** `true` mientras se pinta una anotación remota (guarda anti-eco). */
	isApplyingRemote?: () => boolean;
	onAnotacion: (a: { mes: number; ancla: Ancla; valor: string | null }) => void;
}

export function attachAnotacionesCellChangeAdapter(
	ctx: AnotacionesAdapterContext
): () => void {
	const disposables: IDisposable[] = [];

	const onValueChange = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_RANGE_VALUES) return;
		// Eco de una anotación remota: ya está pintada, no reemitir.
		if (ctx.isApplyingRemote?.()) return;
		const params = info.params as
			| { unitId?: string; subUnitId?: string; range?: IRange; value?: any }
			| undefined;
		if (!params || params.unitId !== ctx.unitId) return;
		const { subUnitId, range, value } = params;
		if (!subUnitId || !range) return;

		const mes = ctx.resolveMes(subUnitId);
		if (!mes) return;

		const wb = ctx.getWorkbook();
		const sheet = (wb as any)?.getSheetBySheetId?.(subUnitId) ?? null;

		for (let r = range.startRow; r <= range.endRow; r++) {
			for (let c = range.startColumn; c <= range.endColumn; c++) {
				// Fuera de la capa no hay nada que guardar: el permission ya lo
				// rechazó, pero si llegara aquí no debe emitirse.
				const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
				if (!ancla) continue;
				let crudo: any = null;
				if (sheet?.getRange) {
					const cd: ICellData | null = sheet.getRange(r, c).getCellData();
					crudo = cd?.v ?? null;
				}
				if (crudo == null && value != null) {
					if (Array.isArray(value) && Array.isArray(value[0])) {
						crudo = (value as ICellData[][])[r - range.startRow]?.[c - range.startColumn]?.v;
					} else if (Array.isArray(value)) {
						crudo = (value as ICellData[])[r - range.startRow]?.v;
					} else if (typeof value === 'object') {
						crudo = (value as ICellData).v;
					} else {
						crudo = value;
					}
				}
				// Vaciar la celda borra la nota, así que `null` es un valor
				// válido y no un «no hubo cambio».
				ctx.onAnotacion({ mes, ancla, valor: crudo == null ? null : String(crudo) });
			}
		}
	};

	disposables.push(ctx.commandService.onCommandExecuted(onValueChange));

	/**
	 * Borrado de contenido (Supr / «Borrar contenido» del menú).
	 *
	 * El comando trae `ranges` solo a veces; cuando no, actúa sobre la
	 * selección viva, así que hay que leerla del propio libro. Cada celda de la
	 * CAPA que caiga dentro se emite con valor `null`, que es como se borra;
	 * fuera de la capa no hay nada que guardar en esta vista derivada.
	 */
	const onClear = (info: Readonly<ICommandInfo>) => {
		if (info.id !== CLEAR_CONTENT && info.id !== CLEAR_ALL) return;
		if (ctx.isApplyingRemote?.()) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			ranges?: IRange[];
		};
		if (params.unitId && params.unitId !== ctx.unitId) return;

		const wb = ctx.getWorkbook() as any;
		const hoja = params.subUnitId
			? wb?.getSheetBySheetId?.(params.subUnitId)
			: wb?.getActiveSheet?.();
		const subUnitId = params.subUnitId ?? hoja?.getSheetId?.();
		if (!subUnitId) return;
		const mes = ctx.resolveMes(subUnitId);
		if (!mes) return;

		const rangos: IRange[] =
			params.ranges && params.ranges.length
				? params.ranges
				: [hoja?.getActiveRange?.()?.getRange?.()].filter(Boolean);
		if (!rangos.length) return;

		for (const rango of rangos) {
			for (let r = rango.startRow; r <= rango.endRow; r++) {
				for (let c = rango.startColumn; c <= rango.endColumn; c++) {
					const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
					if (!ancla) continue;
					ctx.onAnotacion({ mes, ancla, valor: null });
				}
			}
		}
	};
	disposables.push(ctx.commandService.onCommandExecuted(onClear));

	return () => {
		for (const d of disposables) {
			try {
				d.dispose();
			} catch {
				/* noop */
			}
		}
	};
}
