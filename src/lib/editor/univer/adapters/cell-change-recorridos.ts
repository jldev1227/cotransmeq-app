/**
 * Adapter de ediciones del canvas de RECORRIDOS.
 *
 * Traduce lo que Univer despacha (`SetRangeValuesCommand`, borrados, cambio de
 * hoja) a cambios de dominio con la forma que espera `sheet:patch`.
 *
 * Dos trampas heredadas de los canvas anteriores, ya resueltas aquí:
 *
 *  · La CASILLA no manda `unitId` ni `subUnitId`. `sheets-data-validation-ui`
 *    despacha `SetRangeValuesCommand` con `{ range, value }` y nada más, y el
 *    propio comando los resuelve contra la hoja ACTIVA. Comparar
 *    `params.unitId !== ctx.unitId` con `undefined` a la izquierda descartaba
 *    en silencio TODOS los clics: la celda se desmarcaba en pantalla, el
 *    modelo no se enteraba y al recargar volvía a estar marcada. De ahí
 *    `objetivoDeComando`, con el mismo fallback que usa Univer.
 *
 *  · Para saber en qué hoja está el usuario hay que escuchar la OPERACIÓN
 *    `sheet.operation.set-worksheet-active`, no el comando `…activate`: el
 *    `subUnitId` de este último puede venir vacío.
 */

import type { ICommandInfo, ICommandService, IRange } from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import {
	getRecorridoBinding,
	type TipoFilaRecorrido
} from '../../business/recorridos-cell-binding';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_WORKSHEET_ACTIVE = 'sheet.operation.set-worksheet-active';
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

/** Un cambio listo para viajar como patch. */
export interface CambioRecorrido {
	tipoFila: TipoFilaRecorrido;
	entityId: string;
	field: string;
	value: string | number | boolean | null;
	baseVersion: number;
	conductorId: string;
	registroDiaId: string;
}

export interface RecorridosAdapterContext {
	unitId: string;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `sheetId` → id de conductor, o `null` si la hoja no es de este libro. */
	resolveConductor: (sheetId: string) => string | null;
	/**
	 * Versión actual de una fila, para el compare-and-swap.
	 *
	 * La resuelve la página desde su modelo. Si devuelve `null` el cambio se
	 * descarta: emitir sin `base_version` sería volver al last-write-wins.
	 */
	versionDe: (entityId: string) => number | null;
	onCambios: (cambios: CambioRecorrido[]) => void;
	onHojaActiva?: (conductorId: string) => void;
	isApplyingRemote?: () => boolean;
}

/**
 * `unitId` / `subUnitId` del comando, con el mismo fallback que Univer.
 * Ver la nota de la casilla en la cabecera del archivo.
 */
function objetivoDeComando(
	ctx: RecorridosAdapterContext,
	unitId: string | undefined,
	subUnitId: string | undefined
): { subUnitId: string } | null {
	const wb = ctx.getWorkbook() as any;
	if (unitId && unitId !== ctx.unitId) return null;
	// Sin `unitId` el comando va al libro activo: solo es nuestro si el libro
	// activo es el nuestro.
	if (!unitId && wb?.getId?.() !== ctx.unitId) return null;
	const resuelto = subUnitId ?? wb?.getActiveSheet?.()?.getSheetId?.();
	return resuelto ? { subUnitId: resuelto } : null;
}

/** Lee el valor final de una celda, del modelo o del payload del comando. */
function leerValor(
	sheet: any,
	r: number,
	c: number,
	rango: IRange | undefined,
	valorCrudo: unknown
): string | number | boolean | null {
	try {
		const v = sheet?.getRange?.(r, c)?.getCellData?.()?.v;
		if (v !== undefined) return v as string | number | null;
	} catch {
		/* se cae al payload */
	}
	if (valorCrudo && typeof valorCrudo === 'object' && rango) {
		const fila = (valorCrudo as any)[r];
		const celda = fila?.[c];
		if (celda && typeof celda === 'object' && 'v' in celda) return celda.v ?? null;
	}
	return null;
}

function procesarRango(
	ctx: RecorridosAdapterContext,
	sheetId: string,
	rango: IRange | undefined,
	valorCrudo: unknown
) {
	if (!rango) return;
	const conductorId = ctx.resolveConductor(sheetId);
	if (!conductorId) return;

	const sheet = (ctx.getWorkbook() as any)?.getSheetBySheetId?.(sheetId);
	const cambios: CambioRecorrido[] = [];

	for (let r = rango.startRow; r <= rango.endRow; r++) {
		for (let c = rango.startColumn; c <= rango.endColumn; c++) {
			const binding = getRecorridoBinding(ctx.unitId, sheetId, r, c);
			// Sin binding la celda no es de dominio; el interceptor de permisos ya
			// la habrá rechazado, así que aquí solo hay que ignorarla.
			if (!binding) continue;
			if (binding.derived) continue;

			const baseVersion = ctx.versionDe(binding.entityId);
			if (baseVersion == null) continue;

			cambios.push({
				tipoFila: binding.tipoFila,
				entityId: binding.entityId,
				field: binding.field,
				value: leerValor(sheet, r, c, rango, valorCrudo),
				baseVersion,
				conductorId: binding.conductorId,
				registroDiaId: binding.registroDiaId
			});
		}
	}

	if (cambios.length) ctx.onCambios(cambios);
}

export function installRecorridosCellChangeAdapter(
	ctx: RecorridosAdapterContext
): () => void {
	const disposables: Array<{ dispose: () => void }> = [];

	const onHoja = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_WORKSHEET_ACTIVE) return;
		const params = info.params as { unitId?: string; subUnitId?: string } | undefined;
		if (params?.unitId && params.unitId !== ctx.unitId) return;
		const conductorId = params?.subUnitId ? ctx.resolveConductor(params.subUnitId) : null;
		if (conductorId) ctx.onHojaActiva?.(conductorId);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onHoja));

	const onValor = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_RANGE_VALUES) return;
		if (ctx.isApplyingRemote?.()) return;
		if (!info.params) return;
		const params = info.params as {
			unitId?: string;
			subUnitId?: string;
			range?: IRange;
			value?: any;
		};
		const objetivo = objetivoDeComando(ctx, params.unitId, params.subUnitId);
		if (!objetivo) return;
		// Sin `range` el comando actúa sobre la selección viva —así lo resuelve
		// Univer—, así que hay que leerla del libro para saber qué se tocó.
		const rango =
			params.range ??
			(ctx.getWorkbook() as any)
				?.getSheetBySheetId?.(objetivo.subUnitId)
				?.getActiveRange?.()
				?.getRange?.();
		procesarRango(ctx, objetivo.subUnitId, rango, params.value);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onValor));

	/**
	 * Borrado de contenido (Supr / «Borrar contenido»).
	 *
	 * Vaciar una celda de recorrido es un cambio de dato como cualquier otro
	 * —una hora que se quita, un kilometraje que no se conocía—, así que va por
	 * el mismo camino con valor vacío.
	 */
	const onClear = (info: Readonly<ICommandInfo>) => {
		if (info.id !== CLEAR_CONTENT && info.id !== CLEAR_ALL) return;
		if (ctx.isApplyingRemote?.()) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			ranges?: IRange[];
		};
		const objetivo = objetivoDeComando(ctx, params.unitId, params.subUnitId);
		if (!objetivo) return;

		const rangos =
			params.ranges ??
			[
				(ctx.getWorkbook() as any)
					?.getSheetBySheetId?.(objetivo.subUnitId)
					?.getActiveRange?.()
					?.getRange?.()
			].filter(Boolean);

		for (const rango of rangos as IRange[]) {
			procesarRango(ctx, objetivo.subUnitId, rango, undefined);
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
