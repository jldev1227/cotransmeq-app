/**
 * Adapter de edición del canvas de **cierres finales** (libro de un PERIODO,
 * una hoja por placa-propietario).
 *
 * Se parece al de adicionales, pero con una diferencia que lo cambia todo:
 *
 *   En adicionales, editar `cantidad` recalcula `valor_admin` y
 *   `valor_liquidar` DE ESA MISMA FILA, y esas columnas son fórmulas vivas
 *   de Univer. El adapter puede reproducir la aritmética en cliente porque
 *   es trivial y local.
 *
 *   Aquí, editar los `dias` de un SALARIO cascadea a las prestaciones y la
 *   seguridad social de ese conductor, a DOTACION, a EXAMEN_MEDICO, a
 *   GASTOS_DIVERSOS y a los totales del cierre. Reproducir eso en cliente
 *   sería una TERCERA copia de la aritmética (ya hay dos: el editor tabular
 *   y `reglas-conceptos.ts` del servidor).
 *
 * Por eso este adapter **no calcula nada**. Solo detecta qué campo cambió,
 * con qué versión base, y lo emite. El servidor devuelve todas las filas
 * afectadas y los totales, y la página los pinta. El coste es la latencia
 * de ida y vuelta en las celdas derivadas; el beneficio es que no puede
 * haber divergencia entre lo que muestra el canvas y lo que se guarda.
 */

import type {
	IDisposable,
	ICommandInfo,
	IRange,
	ICommandService,
	ICellData
} from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { getCierreBinding, type CierreBinding } from '../../business/cierres-finales-cell-binding';
import { anclaDe, type Ancla } from '../../business/zona-libre';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
/**
 * Cambio de hoja activa. Es una OPERACIÓN, no un comando.
 *
 * El id `sheet.command.set-worksheet-active` que había aquí no existe en
 * Univer y nunca casaba, así que `onHojaActiva` jamás se disparaba: el
 * canvas seguía creyendo activa la hoja anterior. El buscador del header
 * mostraba una placa y "Sincronizar con nómina" trabajaba sobre otra.
 *
 * Univer expone dos ids parecidos y solo uno sirve:
 *
 *   `sheet.command.set-worksheet-activate` — el comando de la sheet bar. Sus
 *      params son los que le pasó quien lo invocó, y `subUnitId` puede venir
 *      vacío (significa "la hoja actual"), así que no se puede resolver.
 *   `sheet.operation.set-worksheet-active` — la operación a la que el comando
 *      delega, y también el camino del facade (`FWorkbook.setActiveSheet`,
 *      que es lo que usa `activarHoja`). SIEMPRE lleva `{unitId, subUnitId}`
 *      ya resueltos.
 *
 * Por eso se escucha la operación: cubre el clic en la pestaña, el combo del
 * header y la activación programática con un solo id.
 */
const SET_WORKSHEET_ACTIVE = 'sheet.operation.set-worksheet-active';
const SET_TAB_COLOR = 'sheet.command.set-tab-color';
/**
 * Borrar con Supr NO pasa por `set-range-values`: Univer emite su propio
 * comando. Sin escucharlo, la nota desaparecía de la pantalla pero no se
 * borraba en el servidor — al recargar volvía a estar.
 */
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

/**
 * Comandos que romperían el layout del libro.
 *
 * Igual que en adicionales, esto es SOLO observabilidad: `onCommandExecuted`
 * corre después de ejecutar. El bloqueo real lo hace
 * `cell-permission-cierres` con `interceptBeforeCommand`.
 *
 * `set-worksheet-active` no está en la lista: con N placas, cambiar de hoja
 * es la navegación principal.
 */
const COMANDOS_ESTRUCTURALES = new Set<string>([
	'sheet.command.insert-row',
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-row-by-range',
	'sheet.command.remove-row',
	'sheet.command.delete-row',
	'sheet.command.insert-col',
	'sheet.command.insert-col-before',
	'sheet.command.insert-col-after',
	'sheet.command.insert-col-by-range',
	'sheet.command.remove-col',
	'sheet.command.insert-column',
	'sheet.command.delete-column',
	'sheet.command.remove-sheet',
	'sheet.command.move-sheet',
	'sheet.command.apply-merge',
	'sheet.command.cancel-merge'
]);

/**
 * Comandos que, si se cuelan, dejan la hoja describiendo algo que no es.
 *
 * `cell-permission-cierres` los rechaza, pero MEDIDO: no llega a todos.
 * `insert-row-by-range` devuelve `true` y la fila entra igual —el contenido
 * baja una posición, `=SUM()` se estira y las combinaciones NO acompañan—,
 * porque ejecuta la mutación por una vía que `interceptBeforeCommand` no ve.
 *
 * De ahí esta segunda red: si el comando llegó a ejecutarse, se reconstruye la
 * hoja desde el modelo. El daño es solo de pantalla (nada de eso se persiste),
 * así que remontar lo deshace por completo. Es reparar en vez de prevenir, y
 * es lo único que no depende de acertar la lista de ids de Univer.
 */
const REQUIEREN_REPARACION = new Set<string>([
	'sheet.command.insert-row',
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-row-by-range',
	'sheet.command.remove-row',
	'sheet.command.delete-row',
	'sheet.command.insert-col',
	'sheet.command.insert-col-before',
	'sheet.command.insert-col-after',
	'sheet.command.insert-col-by-range',
	'sheet.command.remove-col'
]);

/**
 * `unitId` / `subUnitId` del comando, con el mismo fallback que Univer.
 *
 * EL CHECKBOX DE «APLICA IMP.» NO LOS MANDA. `sheets-data-validation-ui`
 * despacha `SetRangeValuesCommand` con `{ range, value }` y nada más, y el
 * propio comando los resuelve contra la hoja ACTIVA
 * (`getSheetCommandTarget`). Aquí se comparaba `params.unitId !== ctx.unitId`
 * con `undefined` a la izquierda, así que TODOS los clics del checkbox se
 * descartaban en silencio: la celda se desmarcaba en pantalla, el modelo no
 * se enteraba, no había nada que guardar —el indicador seguía en «Todo
 * guardado»— y al recargar volvía a estar marcada. Los impuestos no se
 * recalculaban nunca porque el patch no llegaba a salir.
 *
 * Es EL MISMO fallo que ya se corrigió en `cell-change-ingresos.ts` para el
 * checkbox de INCLUIR; este adapter se quedó con la comparación estricta.
 */
function objetivoDeComando(
	ctx: CierresAdapterContext,
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

/** Un cambio listo para viajar como patch. */
export interface CambioCelda {
	cierreId: string;
	entityType: string;
	entityId: string;
	field: string;
	value: string | number | boolean | null;
	baseVersion: number;
}

export interface CierresAdapterContext {
	unitId: string;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `subUnitId` → id de cierre, o `null` si la hoja no es de este libro. */
	resolveCierre: (sheetId: string) => string | null;
	/**
	 * Versión actual de una entidad, para el compare-and-swap.
	 *
	 * La resuelve la página desde su modelo. Si devuelve `null` el cambio se
	 * descarta: emitir sin `base_version` sería volver al last-write-wins.
	 */
	versionDe: (cierreId: string, entityType: string, entityId: string) => number | null;
	/** Cambios detectados en una edición. */
	onCambios?: (cambios: CambioCelda[]) => void;
	/**
	 * El usuario escribió en la ZONA LIBRE: una anotación, no un campo de la
	 * base de datos. No lleva `base_version` de entidad ni cascadea a totales.
	 *
	 * `valor: null` significa que vació la celda, es decir borró la nota.
	 */
	onAnotacion?: (a: { sheetKey: string; ancla: Ancla; valor: string | null }) => void;
	/**
	 * `true` mientras se pinta una edición que llegó de otro usuario. Sin
	 * esta guarda, el `setValue` del patch remoto dispara
	 * `set-range-values`, el adapter lo tomaría por edición local y lo
	 * reemitiría: bucle de eco entre los clientes conectados.
	 */
	isApplyingRemote?: () => boolean;
	/**
	 * Se ejecutó un comando que altera la GEOMETRÍA de la hoja pese al
	 * bloqueo de permisos. El llamador debe reconstruirla desde el modelo y
	 * avisar al usuario: nada de eso se ha guardado, pero lo que se ve ya no
	 * corresponde con los bindings.
	 */
	onEstructural?: (comandoId: string) => void;
	/** El usuario cambió de hoja (para sincronizar la URL y la presencia). */
	onHojaActiva?: (cierreId: string) => void;
	/**
	 * El usuario pintó una pestaña desde la barra de hojas de Univer.
	 *
	 * Univer ya aplicó el color localmente; esto sirve para persistirlo y
	 * difundirlo. Sin persistir se perdería en la siguiente recarga, porque
	 * el libro se reconstruye desde las tablas y no desde el DOM.
	 */
	onColorHoja?: (cierreId: string, color: string | null) => void;
}

export function attachCierresCellChangeAdapter(ctx: CierresAdapterContext): () => void {
	const disposables: IDisposable[] = [];

	const onCmd = (info: Readonly<ICommandInfo>) => {
		if (COMANDOS_ESTRUCTURALES.has(info.id)) {
			console.warn('[cierres-adapter] comando estructural detectado:', info.id);
			// Si además rompe la geometría, hay que rehacer la hoja: los
			// bindings van por fila ABSOLUTA y a partir de la fila insertada
			// cada celda apuntaría a la entidad de otra.
			if (REQUIEREN_REPARACION.has(info.id)) ctx.onEstructural?.(info.id);
			return;
		}
		if (info.id === SET_TAB_COLOR && ctx.onColorHoja) {
			// Repintado programático (cambio de estado, color de otro usuario,
			// alta de hoja): ya está aplicado y NO hay que persistirlo. Sin
			// esta guarda, cada repintado disparaba un PATCH que el servidor
			// difundía, que provocaba otro repintado… hasta agotar el pool de
			// conexiones. Es la misma guarda que usa `set-range-values`, que
			// aquí faltaba.
			if (ctx.isApplyingRemote?.()) return;

			const params = info.params as
				| { unitId?: string; subUnitId?: string; color?: string }
				| undefined;
			if (params?.unitId && params.unitId !== ctx.unitId) return;
			const cierreId = params?.subUnitId ? ctx.resolveCierre(params.subUnitId) : null;
			// Univer manda `color: undefined` cuando el usuario elige "sin
			// color": eso se traduce a `null`, que en el servidor significa
			// "vuelve al color automático del estado".
			if (cierreId) ctx.onColorHoja(cierreId, params?.color || null);
			return;
		}

		if (info.id === SET_WORKSHEET_ACTIVE && ctx.onHojaActiva) {
			// Misma guarda que el color: insertar una hoja la deja ACTIVA, y el
			// buffer de altas activa y restaura por cada una del lote. Sin esto,
			// una ráfaga de 25 borradores generados por otro usuario dispararía
			// 50 cambios de hoja activa —cada uno con su reescritura de la URL y
			// su aviso de presencia— para acabar donde ya estaba.
			if (ctx.isApplyingRemote?.()) return;

			const params = info.params as { unitId?: string; subUnitId?: string } | undefined;
			if (params?.unitId && params.unitId !== ctx.unitId) return;
			const cierreId = params?.subUnitId ? ctx.resolveCierre(params.subUnitId) : null;
			if (cierreId) ctx.onHojaActiva(cierreId);
		}
	};
	disposables.push(ctx.commandService.onCommandExecuted(onCmd));

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
	 * Borrado de contenido (Supr / «Borrar contenido» del menú).
	 *
	 * El comando trae `ranges` solo a veces; cuando no, actúa sobre la
	 * selección viva, así que hay que leerla del propio libro. Cada celda de la
	 * CAPA que caiga dentro se emite con valor `null`, que es como se borra.
	 * Las celdas con binding no se tocan aquí: vaciar un importe es un cambio
	 * de dato y va por su camino de siempre.
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
		// La `sheet_key` es el id del CIERRE y no el de la hoja de Univer: ese se
		// regenera en cada montaje y la nota quedaría huérfana al recargar.
		const cierreId = ctx.resolveCierre(subUnitId);
		if (!cierreId) return;

		const rangos: IRange[] =
			params.ranges && params.ranges.length
				? params.ranges
				: [hoja?.getActiveRange?.()?.getRange?.()].filter(Boolean);
		if (!rangos.length) return;

		for (const rango of rangos) {
			for (let r = rango.startRow; r <= rango.endRow; r++) {
				for (let c = rango.startColumn; c <= rango.endColumn; c++) {
					if (getCierreBinding(ctx.unitId, subUnitId, r, c)) continue;
					const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
					if (!ancla) continue;
					ctx.onAnotacion?.({ sheetKey: cierreId, ancla, valor: null });
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

function procesarRango(
	ctx: CierresAdapterContext,
	subUnitId: string | undefined,
	range: IRange | undefined,
	valorCrudo: any
) {
	if (!range || !subUnitId) return;

	// El cierre sale del `subUnitId` del comando, nunca de la hoja activa:
	// un pegado o un deshacer pueden dirigirse a una hoja que no está en
	// pantalla, y resolverlo por hoja activa escribiría en la placa
	// equivocada.
	const cierreId = ctx.resolveCierre(subUnitId);
	if (!cierreId) return;

	const wb = ctx.getWorkbook();
	if (!wb) return;
	const sheet = (wb as any).getSheetBySheetId?.(subUnitId) ?? null;

	const cambios: CambioCelda[] = [];

	for (let r = range.startRow; r <= range.endRow; r++) {
		for (let c = range.startColumn; c <= range.endColumn; c++) {
			const binding: CierreBinding | undefined = getCierreBinding(
				ctx.unitId,
				subUnitId,
				r,
				c
			);
			// ── AQUÍ SE DECIDE EL DESTINO DE LA CELDA ──────────────────────
			// Con binding, el valor va a su campo en la base de datos y entra
			// en los recálculos del cierre. Sin binding solo puede ser zona
			// libre (el permission ya rechazó todo lo demás): es una
			// ANOTACIÓN, va a `canvas_anotacion` y no toca ni un total.
			if (!binding) {
				const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
				if (!ancla) continue;
				const crudo = leerValor(sheet, r, c, range, valorCrudo);
				ctx.onAnotacion?.({
					// La `sheet_key` es el id del CIERRE (ya resuelto arriba) y no
					// el de la hoja de Univer: ese se regenera en cada montaje y
					// la nota quedaría huérfana al recargar.
					sheetKey: cierreId,
					ancla,
					// Vaciar la celda borra la nota, así que aquí `null` es un
					// valor válido y no un «no hubo cambio».
					valor: crudo == null ? null : String(crudo)
				});
				continue;
			}
			// Las celdas derivadas las escribe el servidor; una edición sobre
			// ellas ya la rechazó `cell-permission-cierres`, pero si llegara
			// aquí no debe emitirse.
			if (binding.derived) continue;

			const valor = leerValor(sheet, r, c, range, valorCrudo);
			if (valor == null) continue;

			const baseVersion = ctx.versionDe(binding.cierreId, binding.entityType, binding.entityId);
			if (baseVersion == null) {
				console.warn(
					`[cierres-adapter] sin versión para ${binding.entityType}:${binding.entityId}; ` +
						'se descarta el cambio en vez de emitirlo sin compare-and-swap'
				);
				continue;
			}

			cambios.push({
				cierreId: binding.cierreId,
				entityType: binding.entityType,
				entityId: binding.entityId,
				field: binding.field,
				value: valor,
				baseVersion
			});
		}
	}

	if (cambios.length) ctx.onCambios?.(cambios);
}

/** Valor nuevo de una celda, leyendo de la hoja y con el payload de respaldo. */
function leerValor(
	sheet: any,
	r: number,
	c: number,
	range: IRange,
	valorCrudo: any
): string | number | boolean | null {
	if (sheet?.getRange) {
		const cellData: ICellData | null = sheet.getRange(r, c).getCellData();
		if (cellData?.v != null) return cellData.v as any;
	}
	if (valorCrudo == null) return null;
	if (Array.isArray(valorCrudo) && Array.isArray(valorCrudo[0])) {
		return (valorCrudo as ICellData[][])[r - range.startRow]?.[c - range.startColumn]?.v ?? null;
	}
	if (Array.isArray(valorCrudo)) {
		return (valorCrudo as ICellData[])[r - range.startRow]?.v ?? null;
	}
	if (typeof valorCrudo === 'object') return (valorCrudo as ICellData).v ?? null;
	return valorCrudo;
}
