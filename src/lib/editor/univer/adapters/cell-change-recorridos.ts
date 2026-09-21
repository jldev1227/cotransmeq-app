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
 *
 * ── POR QUÉ SE ESCUCHA LA MUTACIÓN Y NO EL COMANDO ───────────────────────
 *
 * Teclear, marcar una casilla y borrar con Supr despachan el COMANDO
 * `set-range-values`; pegar (Ctrl+V), el tirador de relleno y deshacer NO:
 * escriben la MUTACIÓN `sheet.mutation.set-range-values` por dentro. Con el
 * comando como fuente, copiar el tipo de día de una fila y pegarlo en otra se
 * veía en pantalla y no llegaba ni al borrador ni al servidor. La mutación es
 * el único punto por el que pasa TODA escritura, así que es la fuente. Los
 * repintados del propio canvas también son mutaciones, y se distinguen con
 * `isApplyingRemote()`; el relleno se trata aparte porque sus valores se
 * corrigen antes de leerlos.
 */

import type { ICommandInfo, ICommandService, IRange } from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import {
	getRecorridoBinding,
	type TipoFilaRecorrido
} from '../../business/recorridos-cell-binding';

const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values';
const SET_WORKSHEET_ACTIVE = 'sheet.operation.set-worksheet-active';
const AUTO_FILL = 'sheet.command.auto-fill';
const REFILL = 'sheet.command.refill';

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
	 * descarta: emitir sin `base_version` sería volver al last-write-wins. Para
	 * una fila `nueva` —un borrador local— devuelve `0`: no hay CAS que hacer
	 * porque no viaja como patch, se acumula hasta guardarla.
	 */
	versionDe: (entityId: string) => number | null;
	onCambios: (cambios: CambioRecorrido[]) => void;
	onHojaActiva?: (conductorId: string) => void;
	isApplyingRemote?: () => boolean;
	/**
	 * Antes de leer lo que escribió el TIRADOR: ocasión de corregir la serie
	 * en la hoja (las fechas, que Univer rellena como texto con número). Va
	 * aquí y no en un listener aparte porque el orden entre listeners del
	 * mismo comando no está garantizado, y se leía la serie sin corregir.
	 */
	antesDeRelleno?: (sheetId: string, origen: IRange | undefined, destino: IRange) => void;
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

function procesarCeldas(
	ctx: RecorridosAdapterContext,
	sheetId: string,
	celdas: Array<{ r: number; c: number }>
) {
	const conductorId = ctx.resolveConductor(sheetId);
	if (!conductorId) return;

	const sheet = (ctx.getWorkbook() as any)?.getSheetBySheetId?.(sheetId);
	const cambios: CambioRecorrido[] = [];

	for (const { r, c } of celdas) {
		const binding = getRecorridoBinding(ctx.unitId, sheetId, r, c);
		// Sin binding la celda no es de dominio: o es calculada (el engine la
		// repinta) o el interceptor de permisos ya la habrá rechazado.
		if (!binding) continue;
		if (binding.derived) continue;

		const baseVersion = ctx.versionDe(binding.entityId);
		if (baseVersion == null) continue;

		cambios.push({
			tipoFila: binding.tipoFila,
			entityId: binding.entityId,
			field: binding.field,
			value: leerValor(sheet, r, c, undefined, undefined),
			baseVersion,
			conductorId: binding.conductorId,
			registroDiaId: binding.registroDiaId
		});
	}

	if (cambios.length) ctx.onCambios(cambios);
}

function procesarRango(
	ctx: RecorridosAdapterContext,
	sheetId: string,
	rango: IRange | undefined,
	valorCrudo: unknown
) {
	if (!rango) return;
	void valorCrudo;
	const celdas: Array<{ r: number; c: number }> = [];
	for (let r = rango.startRow; r <= rango.endRow; r++) {
		for (let c = rango.startColumn; c <= rango.endColumn; c++) celdas.push({ r, c });
	}
	procesarCeldas(ctx, sheetId, celdas);
}

/**
 * Celdas que el autorrelleno ESCRIBIÓ: el destino sin el origen. El destino
 * de Univer incluye al origen, y puede crecer hacia abajo, arriba, derecha o
 * izquierda; se devuelven las franjas nuevas.
 */
export function rellenado(origen: IRange | undefined, destino: IRange): IRange[] {
	if (!origen) return [destino];
	const franjas: IRange[] = [];
	if (destino.endRow > origen.endRow) {
		franjas.push({ ...destino, startRow: origen.endRow + 1 });
	}
	if (destino.startRow < origen.startRow) {
		franjas.push({ ...destino, endRow: origen.startRow - 1 });
	}
	if (destino.endColumn > origen.endColumn) {
		franjas.push({ ...destino, startColumn: origen.endColumn + 1, startRow: origen.startRow, endRow: origen.endRow });
	}
	if (destino.startColumn < origen.startColumn) {
		franjas.push({ ...destino, endColumn: origen.startColumn - 1, startRow: origen.startRow, endRow: origen.endRow });
	}
	return franjas;
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

	/// Mientras el tirador rellena, sus mutaciones se ignoran: los valores se
	/// corrigen y se leen al terminar el comando (ver `onAutoFill`).
	let dentroDeRelleno = 0;
	/// Opcional: los dobles de prueba no lo implementan.
	const antes = (ctx.commandService as { beforeCommandExecuted?: ICommandService['beforeCommandExecuted'] })
		.beforeCommandExecuted;
	if (antes) {
		disposables.push(
			antes.call(ctx.commandService, (info) => {
				if (info.id === AUTO_FILL || info.id === REFILL) dentroDeRelleno++;
			})
		);
	}

	/**
	 * Toda escritura de celdas, venga de donde venga: teclear, casilla, Supr,
	 * pegar, deshacer. Se procesan solo las celdas que traen VALOR (`v` o `f`):
	 * una mutación de solo estilo —la copia de formato al insertar una fila,
	 * «pegar solo formato»— no es un cambio de dato.
	 */
	const onMutacion = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_RANGE_VALUES_MUTATION) return;
		if (ctx.isApplyingRemote?.()) return;
		if (dentroDeRelleno > 0) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			cellValue?: Record<string, Record<string, any>>;
		};
		if (!params.cellValue) return;
		const objetivo = objetivoDeComando(ctx, params.unitId, params.subUnitId);
		if (!objetivo) return;

		const celdas: Array<{ r: number; c: number }> = [];
		for (const [rStr, fila] of Object.entries(params.cellValue)) {
			for (const [cStr, celda] of Object.entries(fila ?? {})) {
				if (!celda || typeof celda !== 'object') continue;
				if (!('v' in celda) && !('f' in celda) && !('p' in celda)) continue;
				celdas.push({ r: Number(rStr), c: Number(cStr) });
			}
		}
		if (celdas.length) procesarCeldas(ctx, objetivo.subUnitId, celdas);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onMutacion));

	/**
	 * TIRADOR de relleno (arrastrar la esquina de la selección hacia abajo).
	 *
	 * Univer no despacha `set-range-values` al rellenar: escribe las celdas por
	 * mutación directa dentro de `auto-fill`. Sin escucharlo, arrastrar una
	 * fecha sobre siete filas insertadas las pintaba en pantalla y no llegaba
	 * ni al borrador ni al servidor: ni día de la semana ni guardado.
	 *
	 * Se procesa el DESTINO menos el ORIGEN: el origen no cambió.
	 */
	const onAutoFill = (info: Readonly<ICommandInfo>) => {
		if (info.id !== AUTO_FILL && info.id !== REFILL) return;
		dentroDeRelleno = Math.max(0, dentroDeRelleno - 1);
		if (ctx.isApplyingRemote?.()) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			sourceRange?: IRange;
			targetRange?: IRange;
		};
		if (!params.targetRange) return;
		const objetivo = objetivoDeComando(ctx, params.unitId, params.subUnitId);
		if (!objetivo) return;
		ctx.antesDeRelleno?.(objetivo.subUnitId, params.sourceRange, params.targetRange);
		for (const rango of rellenado(params.sourceRange, params.targetRange)) {
			procesarRango(ctx, objetivo.subUnitId, rango, undefined);
		}
	};
	disposables.push(ctx.commandService.onCommandExecuted(onAutoFill));

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
