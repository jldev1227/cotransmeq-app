/**
 * Permisos a nivel de celda del canvas de CIERRES FINALES.
 *
 * Default-deny: toda celda sin binding editable queda bloqueada. Igual que
 * en adicionales y ocasional.
 *
 * DIFERENCIA IMPORTANTE con los otros dos: aquí el servidor pinta celdas
 * DERIVADAS que no son fórmulas —`valor_total` de un concepto,
 * `base_calculo`, los valores de impuesto—. En adicionales eso no hacía
 * falta porque las derivadas eran fórmulas vivas y el motor de Univer las
 * recalculaba solo.
 *
 * Como esas celdas no tienen binding editable, el default-deny las
 * rechazaría y el patch remoto no se pintaría nunca. Por eso el interceptor
 * consulta `isApplyingRemote()` y abre la puerta mientras se está aplicando
 * un cambio que ya viene validado del servidor.
 */

import {
	CustomCommandExecutionError,
	ICommandService,
	IUniverInstanceService,
	UniverInstanceType,
	type ICommandInfo,
	type IRange,
	type Univer
} from '@univerjs/core';
import { SheetInterceptorService } from '@univerjs/sheets';
// @ts-ignore
import { IEditorBridgeService } from '@univerjs/sheets-ui';
import { getCierreBinding } from '../business/cierres-finales-cell-binding';
import { esCeldaBloqueada, esCeldaDeCapa } from '../business/zona-libre';
import { isApplyingRemote } from './apply-remote-patch';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';
/// Borrar con Supr no pasa por `set-range-values`: sin controlarlo aquí, se
/// podía vaciar una etiqueta o un valor derivado y desaparecía de la pantalla
/// hasta recargar.
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';
const REMOVE_ROW = 'sheet.command.remove-row';

/**
 * Eliminación de hoja: bloqueada siempre.
 *
 * Dos motivos distintos, y los dos importan:
 *
 *  · Una hoja ES un cierre. Arrastrar la pestaña a la papelera no lo
 *    elimina del servidor, así que el usuario creería haber borrado algo
 *    que sigue ahí y reaparece al recargar.
 *  · Cuando el modal de borradores inserta hojas, esas inserciones entran
 *    en el undo stack de Univer. Un Ctrl+Z de quien estuviera editando
 *    otra placa borraría de su vista una hoja que acaba de crear OTRO
 *    usuario.
 *
 * Se bloquean el comando y la mutación: el comando cubre el menú de la
 * pestaña, la mutación cubre el deshacer. Denegar la mutación hace que ese
 * undo concreto no haga nada, que es preferible a perder la hoja.
 */
const REMOVE_SHEET = new Set(['sheet.command.remove-sheet', 'sheet.mutation.remove-sheet']);

/**
 * Insertar y borrar FILAS o COLUMNAS: bloqueado, con explicación.
 *
 * Univer sabe hacerlo, pero la fila que inserta está vacía en todo lo que
 * importa aquí: sin combinación A:B, sin patrón de moneda, sin bordes, sin
 * fórmula y —lo decisivo— sin `id` en la base. El canvas se apoya en un
 * registro de bindings `(fila, columna) → entidad` que se construye al montar
 * la hoja; una fila que Univer mete por su cuenta no está en él, así que lo
 * que se teclee ahí no tiene dónde guardarse: el servidor lo rechazaba con
 * `offset_fila debe ser un entero >= 0` y el usuario NO SE ENTERABA, porque el
 * indicador seguía en «Todo guardado». Al recargar, la fila y su importe
 * habían desaparecido.
 *
 * Peor aún: insertar desplaza el contenido pero no el registro de bindings, así
 * que a partir de esa fila cada celda quedaba apuntando a la entidad de otra.
 *
 * Antes esto solo se avisaba por consola desde el adapter, y encima solo para
 * `insert-row` — el menú contextual usa `insert-row-before`/`-after`, que ni
 * eso. Ahora se bloquea de verdad y se dice dónde está el botón que sí
 * funciona.
 */
//
// QUITAR filas ya NO está aquí. Eliminar una fila de item es una acción
// legítima —el equivalente del borrado del canvas de ocasionales—: el adapter
// la traduce a un soft-delete del item y la página rehace la hoja. Solo se
// prohíbe INSERTAR, que no tiene entidad a la que colgarse y desplaza los
// bindings de todo lo que queda debajo.
const ESTRUCTURA_FILAS = new Set([
	'sheet.command.insert-row',
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-row-by-range',
	// La MUTACIÓN, además del comando. Medido: `insert-row-by-range` se
	// saltaba el chequeo a nivel de comando —devolvía `true` y la fila entraba
	// igual, desplazando el contenido sin llevarse las combinaciones—, así que
	// bloquear solo los comandos dejaba abierta justo la vía del menú
	// contextual. Es el mismo doble cierre que ya usaba `remove-sheet`, y de
	// paso cubre el deshacer.
	'sheet.mutation.insert-row'
]);

const ESTRUCTURA_COLUMNAS = new Set([
	'sheet.command.insert-col',
	'sheet.command.insert-col-before',
	'sheet.command.insert-col-after',
	'sheet.command.insert-col-by-range',
	'sheet.command.remove-col',
	'sheet.command.remove-col-confirm',
	'sheet.mutation.insert-col',
	'sheet.mutation.remove-col'
]);

/**
 * Campos que el usuario puede editar. Espejo de `CAMPOS_EDITABLES` del
 * backend: si divergen, el canvas dejaría teclear algo que el servidor
 * rechaza, o al revés.
 */
const EDITABLE_FIELDS: Set<string> = new Set([
	// Conceptos laborales
	'concepto:dias',
	'concepto:valor_unitario',
	'concepto:porcentaje',
	// Anticipos (la FECHA vive en `observaciones`)
	'concepto:concepto',
	'concepto:observaciones',
	// Adicionales
	'adicional:valor_unitario',
	'adicional:cantidad',
	// Acción sobre los items del pivote. Celda SÍ/NO: qué entra en la base
	// imponible. `item:excluido` ya no está: quitar un item del cierre se
	// hace desde el modal del carril, no desde una celda — la columna
	// EXCLUIR se retiró porque la fila marcada desaparecía y no había forma
	// de devolverla.
	'item:aplica_impuestos',
	// Porcentaje de administración del item. OJO: no se guarda en el pivote
	// sino en `liquidacion_tercero`, la fila de la liquidación de servicio,
	// así que el cambio se ve también fuera de este cierre. ADMON $ y
	// V/LIQUIDAR se derivan de él en el servidor y quedan fuera de la lista:
	// van marcadas como `derived` y el default-deny las bloquea.
	'item:porcentaje_admin'
]);

function esEditable(entityType: string, field: string, derived?: boolean): boolean {
	if (derived) return false;
	return EDITABLE_FIELDS.has(`${entityType}:${field}`);
}

export interface CierresPermissionOptions {
	/** Libro de cierres dueño del interceptor; el pegado a veces omite unitId. */
	unitId: string;
	/**
	 * Se llama cuando se bloquea una operación que el usuario intentó a
	 * propósito, con un mensaje ya redactado para enseñárselo.
	 *
	 * Va por callback y no con un `toast` importado aquí para que este módulo
	 * siga siendo lógica de permisos y no dependa de la capa de UI.
	 */
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}

export function installCierresCellPermission(
	univer: Univer,
	opts: CierresPermissionOptions
): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);
	const instancias = injector.get(IUniverInstanceService);
	// @ts-ignore
	const editorBridge = injector.get(IEditorBridgeService as any) as {
		getEditLocation(): null | { unitId: string; sheetId: string; row: number; column: number };
	};

	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			const id = info.id;
			const params = (info.params ?? {}) as Record<string, any>;

			if (ESTRUCTURA_FILAS.has(id)) {
				opts.onBloqueado?.({
					titulo: 'No se pueden insertar filas en la hoja',
					detalle:
						'Una fila insertada aquí no tiene identidad en la base, así que lo ' +
						'que escribas en ella no se guarda. Usa los botones del carril de la ' +
						'derecha: la fila nace con su combinación, su formato y su fórmula, y ' +
						'entra en el total de su sección.'
				});
				return false;
			}

			if (ESTRUCTURA_COLUMNAS.has(id)) {
				opts.onBloqueado?.({
					titulo: 'Las columnas de la hoja son fijas',
					detalle:
						'La estructura reproduce el formato del documento y las fórmulas ' +
						'apuntan a columnas concretas. Añadir o quitar una las rompería.'
				});
				return false;
			}

			if (REMOVE_SHEET.has(id)) {
				console.warn(
					'[cierres] eliminación de hoja bloqueada. Una hoja es un cierre: ' +
						'se elimina desde su propio flujo, no arrastrando la pestaña.'
				);
				return false;
			}

			if (id === REMOVE_ROW) {
				const libro: any = params.unitId
					? instancias.getUnit(params.unitId, UniverInstanceType.UNIVER_SHEET)
					: instancias.getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET);
				if (!libro) return true;
				const unitId = libro.getUnitId?.();
				if (params.unitId && unitId !== params.unitId) return true;
				const sheetId = params.subUnitId ?? libro.getActiveSheet?.()?.getSheetId?.();
				if (!unitId || !sheetId) return true;
				const hoja = libro.getSheetBySheetId?.(sheetId);
				const rangoActivo = hoja?.getActiveRange?.()?.getRange?.();
				const rangos: IRange[] = params.ranges?.length
					? params.ranges
					: params.range
						? [params.range]
						: rangoActivo
							? [rangoActivo]
							: [];
				for (const rango of rangos) {
					for (let r = rango.startRow; r <= rango.endRow; r++) {
						const field = getCierreBinding(unitId, sheetId, r, 0)?.field;
						if (!field?.startsWith('eliminado_solo_lectura')) continue;
						opts.onBloqueado?.({
							titulo: 'Los items eliminados son solo consulta',
							detalle:
								'Esta fila se conserva en rojo como referencia y no se puede modificar desde el canvas.'
						});
						return false;
					}
				}
				return true;
			}

			// Sin logs por check: esto corre en cada intento de edición y en
			// cada `set-range-values`. Con N hojas inundaría la consola.
			if (id === SET_CELL_EDIT_VISIBLE) {
				if (params?.visible !== true) return true;
				const loc = editorBridge.getEditLocation();
				if (!loc) return true;
				if (esCeldaBloqueada(loc.unitId, loc.sheetId, loc.row, loc.column)) {
					opts.onBloqueado?.({
						titulo: 'No se puede reemplazar este cálculo',
						detalle:
							'Esta celda contiene una fórmula del cierre. Edita SALARIO u otro campo ' +
							'editable para que las prestaciones y sus totales se recalculen.'
					});
					return false;
				}
				const b = getCierreBinding(loc.unitId, loc.sheetId, loc.row, loc.column);
				// Sin binding solo se permite la ZONA LIBRE: las filas bajo el
				// bloque estructurado, anotables por el equipo.
				if (!b) return esCeldaDeCapa(loc.unitId, loc.sheetId, loc.row, loc.column);
				return esEditable(b.entityType, b.field, b.derived);
			}

			// Borrado: se permite solo si TODAS las celdas del rango son de la capa
			// o campos editables. Con la selección viva (sin `ranges`) no se puede
			// comprobar aquí, así que se deja pasar y el adaptador filtra celda a
			// celda antes de emitir.
			if (id === CLEAR_CONTENT || id === CLEAR_ALL) {
				const rangos = (params?.ranges ?? []) as IRange[];
				if (!params?.unitId || !params?.subUnitId || rangos.length === 0) return true;
				for (const rg of rangos) {
					for (let r = rg.startRow; r <= rg.endRow; r++) {
						for (let c = rg.startColumn; c <= rg.endColumn; c++) {
							const b = getCierreBinding(params.unitId, params.subUnitId, r, c);
							if (b) {
								if (!esEditable(b.entityType, b.field, b.derived)) return false;
								continue;
							}
							if (!esCeldaDeCapa(params.unitId, params.subUnitId, r, c)) return false;
						}
					}
				}
				return true;
			}

			if (id !== SET_RANGE_VALUES) return true;

			// Patch remoto: el valor ya lo validó y calculó el servidor. Aquí
			// hay que dejarlo pasar aunque la celda sea derivada, o el cambio
			// de otro usuario nunca se vería.
			if (isApplyingRemote()) return true;

			if (!params?.unitId || !params?.subUnitId || !params.range) return true;

			const { startRow, endRow, startColumn, endColumn } = params.range as IRange;
			for (let r = startRow; r <= endRow; r++) {
				for (let c = startColumn; c <= endColumn; c++) {
					const b = getCierreBinding(params.unitId, params.subUnitId, r, c);
					if (!b) {
						if (!esCeldaDeCapa(params.unitId, params.subUnitId, r, c)) return false;
						continue;
					}
					if (!esEditable(b.entityType, b.field, b.derived)) return false;
				}
			}
			return true;
		}
	});

	/**
	 * El pegado y el deshacer escriben directamente la mutación, por debajo de
	 * `set-range-values`; validar solo el comando deja que una fórmula o una
	 * celda derivada se vea cambiada hasta recargar, aunque nunca pueda guardarse.
	 * Aquí se revisan las coordenadas reales de la mutación antes de aplicarla.
	 */
	const disposableMutacion = commandService.beforeCommandExecuted((info) => {
		if (info.id !== SET_RANGE_VALUES_MUTATION || isApplyingRemote()) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			cellValue?: Record<string, Record<string, { v?: unknown; f?: unknown } | null>>;
		};
		if (params.unitId && params.unitId !== opts.unitId) return;
		if (!params.cellValue) return;

		// El pegado puede emitir la mutación sin unitId/subUnitId. Como este
		// interceptor pertenece a esta instancia de Univer, se resuelven contra
		// su libro y hoja activos; salir aquí permitiría cambiar una fórmula en
		// pantalla, aunque nunca se guarde en el servidor.
		const unitId = opts.unitId;
		const libro = instancias.getUnit(unitId, UniverInstanceType.UNIVER_SHEET) as any;
		if (!libro || libro.getUnitId?.() !== unitId) return;
		const sheetId = params.subUnitId ?? libro.getActiveSheet?.()?.getSheetId?.();
		if (!sheetId) return;
		const celdas = Object.entries(params.cellValue).flatMap(([rStr, fila]) =>
			Object.entries(fila ?? {}).map(([cStr, celda]) => ({
				r: Number(rStr),
				c: Number(cStr),
				celda
			}))
		);

		for (const { r, c, celda } of celdas) {
			if (!celda) continue;
			const tieneFormula = typeof celda.f === 'string' && celda.f.trim() !== '';
			const traeValor = 'v' in celda && celda.v !== undefined;
			// Ignorar cambios de estilo y celdas vacías de la matriz del clipboard.
			if (!tieneFormula && !traeValor) continue;
			const formulaDelBuilder = esCeldaBloqueada(unitId, sheetId, r, c);
			// El motor de fórmulas emite mutaciones de valor sin `trigger` al
			// calcular fórmulas existentes. Se dejan pasar; la edición humana de
			// esas celdas se detiene en el evento de pegado o al entrar a editar.
			if (formulaDelBuilder && !(params as any).trigger && !tieneFormula) continue;

			const binding = getCierreBinding(unitId, sheetId, r, c);
			const permitida = binding
				? esEditable(binding.entityType, binding.field, binding.derived)
				: esCeldaDeCapa(unitId, sheetId, r, c);
			if (permitida && !tieneFormula) continue;

			const aviso = tieneFormula
				? {
						titulo: 'No se pueden pegar fórmulas en esta hoja',
						detalle:
							'El canvas guarda valores en el servidor y calcula los campos derivados. ' +
							'Pega el valor como texto o número sobre una celda editable.'
					}
				: formulaDelBuilder
					? {
							titulo: 'No se puede reemplazar este cálculo',
							detalle:
								'Esta celda contiene una fórmula del cierre. Edita SALARIO u otro campo ' +
								'editable para que las prestaciones y sus totales se recalculen.'
						}
					: {
							titulo: 'No se puede pegar sobre este cálculo',
							detalle:
								'VALOR y TOTAL de prestaciones se calculan a partir del salario y el ' +
								'porcentaje. Pega sobre una celda editable para que el cambio se guarde.'
						};
			opts.onBloqueado?.(aviso);
			throw new CustomCommandExecutionError('[cierres] pegado en celda no editable');
		}
	});

	return () => {
		try {
			disposable.dispose();
			disposableMutacion.dispose();
		} catch {
			/* noop */
		}
	};
}
