/**
 * Permisos a nivel de celda del canvas de **INGRESOS DE COTRANSMEQ**:
 * default-deny, con dos excepciones.
 *
 * La TABLA sigue siendo derivada —sus filas son items de `liquidacion_tercero`
 * y sus importes los calcula el servidor—, así que dejar escribir encima sería
 * un cambio fantasma: se vería en pantalla, no se guardaría y desaparecería al
 * recargar, además de romper las fórmulas del pie sin dejar rastro.
 *
 * Lo que SÍ se puede escribir:
 *
 *  1. Las celdas con BINDING, que son la capa de decisiones encima de esa
 *     tabla: la columna INCLUIR, la cantidad, el V/UNIDAD de la hoja de
 *     adicionales y los conceptos del pie. Todas persisten en
 *     `liquidacion_ingreso_transmeralda*`.
 *  2. La ZONA LIBRE bajo el bloque estructurado, que va a `canvas_anotacion` y
 *     no toca ninguna cifra.
 *
 * Todo lo demás se corta en el comando, que es donde convergen todas las rutas
 * de escritura (`readOnly` del engine solo tapa el doble clic).
 *
 * ── CÓMO SE CORTA ──────────────────────────────────────────────────────
 * Por `beforeCommandExecuted` del `ICommandService`, lanzando
 * `CustomCommandExecutionError`: es el mecanismo que Univer entiende como
 * «este comando no se ejecuta» (lo captura en `executeCommand` y devuelve
 * `false`, sin propagar el error ni ensuciar la consola).
 *
 * NO vale `SheetInterceptorService.interceptBeforeCommand`, que es lo que se
 * usaba: solo lo consultan unos pocos comandos de estructura —mover rango,
 * insertar/borrar filas—, y `sheet.command.set-range-values` no está entre
 * ellos. El check existía y no se ejecutaba nunca. Se mantiene registrado
 * porque sí cubre esos comandos de estructura.
 */

import { CustomCommandExecutionError, ICommandService, IUniverInstanceService,
	UniverInstanceType, type ICommandInfo, type Univer,
	type IRange
} from '@univerjs/core';
import { SheetInterceptorService, SheetsSelectionsService } from '@univerjs/sheets';
// @ts-ignore
import { IEditorBridgeService } from '@univerjs/sheets-ui';
import { esCeldaDeCapa } from '../business/zona-libre';
import { getIngresosBinding } from '../business/ingresos-cell-binding';

/**
 * Campos que se pueden editar en la hoja.
 *
 * Whitelist y no blacklist: un binding nuevo nace bloqueado hasta que alguien
 * lo añade aquí a conciencia. `fila:*` es la capa de decisiones sobre un
 * servicio; `concepto:*`, el pie de cada hoja.
 */
const EDITABLE_FIELDS: Set<string> = new Set([
	// Capa de decisiones sobre un ingreso.
	'fila:incluir_adicional',
	'fila:cantidad',
	'fila:valor_unitario_adicional',
	// Conceptos del pie.
	'concepto:valor_total',
	'concepto:porcentaje',
	// Etiqueta de las filas libres de PRÉSTAMOS Y PAGO HORAS EXTRAS.
	'concepto:concepto'
]);

function esEditable(entityType: string, field: string): boolean {
	return EDITABLE_FIELDS.has(`${entityType}:${field}`);
}

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';
/// Borrar con Supr no pasa por `set-range-values`: sin controlarlo aquí, se
/// podía vaciar una etiqueta o un SUBTOTAL y desaparecía de la pantalla hasta
/// recargar.
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

export function installIngresosCellPermission(univer: Univer): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);
	const instancias = injector.get(IUniverInstanceService);
	const selecciones = injector.get(SheetsSelectionsService);
	// @ts-ignore — mismo acceso que el resto de `cell-permission-*`.
	const editorBridge = injector.get(IEditorBridgeService as any) as {
		getEditLocation(): null | { unitId: string; sheetId: string; row: number; column: number };
	};

	/// Una celda es escribible si tiene un binding de campo editable o si es de
	/// la zona libre. Todo lo demás —las columnas derivadas, las etiquetas, los
	/// totalizadores— queda fuera.
	const escribible = (unitId: string, sheetId: string, r: number, c: number) => {
		const b = getIngresosBinding(unitId, sheetId, r, c);
		if (b) return esEditable(b.entityType, b.field);
		return esCeldaDeCapa(unitId, sheetId, r, c);
	};

	const rangoEscribible = (unitId: string, sheetId: string, rg: IRange) => {
		for (let r = rg.startRow; r <= rg.endRow; r++) {
			for (let c = rg.startColumn; c <= rg.endColumn; c++) {
				if (!escribible(unitId, sheetId, r, c)) return false;
			}
		}
		return true;
	};

	/**
	 * Guarda EFECTIVA sobre las rutas de escritura.
	 *
	 * `set-range-values` y los borrados llegan sin `unitId`/`subUnitId` cuando
	 * los dispara el checkbox de INCLUIR o un Supr sobre la selección viva: el
	 * propio comando los resuelve luego contra la hoja activa, así que aquí se
	 * hace lo mismo. Denegar por «faltan los ids» bloquearía justo esas dos.
	 */
	const guarda = (info: Readonly<ICommandInfo>) => {
		const id = info.id;
		if (id !== SET_RANGE_VALUES && id !== CLEAR_CONTENT && id !== CLEAR_ALL) return;
		const params = (info.params ?? {}) as Record<string, any>;

		const libro: any = params.unitId
			? instancias.getUnit(params.unitId, UniverInstanceType.UNIVER_SHEET)
			: instancias.getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET);
		// Otro libro (o ninguno): no es asunto de este permission.
		if (!libro) return;
		const unitId: string = libro.getUnitId();
		const sheetId: string | undefined =
			params.subUnitId ?? libro.getActiveSheet?.()?.getSheetId?.();
		if (!sheetId) return;

		const rangos: IRange[] = params.range
			? [params.range as IRange]
			: Array.isArray(params.ranges) && params.ranges.length
				? (params.ranges as IRange[])
				: (selecciones.getCurrentSelections() ?? []).map((s: any) => s.range);
		if (!rangos.length) return;

		for (const rg of rangos) {
			if (!rangoEscribible(unitId, sheetId, rg)) {
				// Derivada: escribir aquí se vería en pantalla, no se guardaría y
				// además rompería la fórmula del pie que la referencia.
				throw new CustomCommandExecutionError(
					'[ingresos-canvas] celda derivada: no se puede editar'
				);
			}
		}
	};
	const disposableGuarda = commandService.beforeCommandExecuted(guarda);

	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			const id = info.id;
			const params = (info.params ?? {}) as Record<string, any>;

			if (id === SET_RANGE_VALUES) {
				if (!params?.unitId || !params?.subUnitId || !params.range) return false;
				const { startRow, endRow, startColumn, endColumn } = params.range as IRange;
				for (let r = startRow; r <= endRow; r++) {
					for (let c = startColumn; c <= endColumn; c++) {
						if (!escribible(params.unitId, params.subUnitId, r, c)) return false;
					}
				}
				return true;
			}
			// Borrado: solo si TODAS las celdas del rango son escribibles. Con la
			// selección viva (sin `ranges`) no se puede comprobar aquí, así que se
			// deja pasar y el adaptador filtra celda a celda antes de emitir.
			if (id === CLEAR_CONTENT || id === CLEAR_ALL) {
				const rangos = (params?.ranges ?? []) as IRange[];
				if (!params?.unitId || !params?.subUnitId || rangos.length === 0) return true;
				for (const rg of rangos) {
					for (let r = rg.startRow; r <= rg.endRow; r++) {
						for (let c = rg.startColumn; c <= rg.endColumn; c++) {
							if (!escribible(params.unitId, params.subUnitId, r, c)) return false;
						}
					}
				}
				return true;
			}
			if (id === SET_CELL_EDIT_VISIBLE) {
				// Solo bloqueamos la APERTURA del editor. Dejar pasar el
				// cierre (`visible !== true`) evita que un editor abierto por
				// otra vía se quede colgado sin poder cerrarse.
				if (params?.visible !== true) return true;
				const loc = editorBridge.getEditLocation();
				// Sin ubicación no se puede decidir: este intercept corre ANTES de
				// que la operación fije dónde se va a editar, así que `null` aquí es
				// lo normal, no un intento sospechoso. Denegar bloqueaba el doble
				// clic en TODAS las celdas, incluidas las editables. Se deja pasar y
				// manda `set-range-values`, que es donde de verdad se escribe.
				if (!loc) return true;
				return escribible(loc.unitId, loc.sheetId, loc.row, loc.column);
			}
			return true;
		}
	});

	return () => {
		for (const d of [disposableGuarda, disposable]) {
			try {
				d.dispose();
			} catch {
				/* noop */
			}
		}
	};
}
