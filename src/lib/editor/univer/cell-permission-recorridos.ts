/**
 * Permisos de celda del canvas de **recorridos**.
 *
 * DEFAULT-DENY POR BINDING. Solo se escribe donde el builder registró binding
 * (`recorridos-cell-binding`). Y el builder no registra NINGUNO cuando el
 * usuario no tiene nivel `full` en el módulo `recorridos`, así que para
 * Contabilidad, Facturación, Talento Humano, HSEQ y Mantenimiento la hoja
 * entera queda de solo lectura sin una segunda regla que mantener en paralelo.
 *
 * Lo que queda derivado incluso para quien sí puede editar:
 *
 *  · `#`, `DÍA` y `VALOR A PAGAR`, que se calculan.
 *  · `FECHA`, que identifica la fila: cambiarla movería el recorrido de día y
 *    descuadraría los conteos de bono por mes. Para eso está el modal de
 *    registro de recorridos.
 *  · `TIPO DE DÍA` en las filas de recorrido: el tipo es del día, no del
 *    tramo, y editarlo en uno afectaría a los demás sin que se vea.
 *
 * ── CÓMO SE CORTA, Y POR QUÉ NO BASTA EL INTERCEPTOR ───────────────────────
 *
 * `SheetInterceptorService` NO ve `sheet.command.set-range-values` ni
 * `sheet.operation.set-cell-edit-visible`, así que el corte de verdad va por
 * `beforeCommandExecuted` lanzando `CustomCommandExecutionError`. El
 * interceptor se deja registrado porque sí cubre los comandos de estructura.
 *
 * ── POR QUÉ NO `readOnly: true` ───────────────────────────────────────────
 *
 * Baja `WorkbookEditablePermission`, que en `@univerjs/sheets` 0.25.1 es la
 * MISMA bandera que decide si pasa `SetRangeValuesCommand`: bloquearía también
 * las escrituras del propio canvas —los repintados tras un patch y los cambios
 * que llegan de otros usuarios—. Cortar aquí sí distingue quién escribe,
 * porque existe `repintando()`.
 */

import {
	CustomCommandExecutionError,
	ICommandService,
	type ICommandInfo,
	type Univer
} from '@univerjs/core';
import { SheetInterceptorService } from '@univerjs/sheets';
import { getRecorridoBinding } from '../business/recorridos-cell-binding';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';

/**
 * Comandos de ESTRUCTURA. La geometría de la hoja la fija el builder: el
 * número de columnas depende de cuántos bonos estén visibles, e insertar una
 * fila dejaría todos los bindings apuntando a la celda equivocada.
 *
 * Se bloquean comandos Y mutaciones: la mutación cubre además el deshacer, que
 * es la otra vía por la que una hoja congelada deja de estarlo.
 */
const COMANDOS_DE_ESTRUCTURA = new Set([
	'sheet.command.insert-row',
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-row-by-range',
	'sheet.command.remove-row',
	'sheet.command.remove-row-confirm',
	'sheet.mutation.insert-row',
	/// PLURAL. En Univer 0.25.1 la mutación es `remove-rows`; el singular no
	/// existe y bloquearlo no haría nada.
	'sheet.mutation.remove-rows',
	'sheet.command.insert-col',
	'sheet.command.insert-col-before',
	'sheet.command.insert-col-after',
	'sheet.command.insert-col-by-range',
	'sheet.command.remove-col',
	'sheet.command.remove-col-confirm',
	'sheet.mutation.insert-col',
	'sheet.mutation.remove-col',
	/// Una hoja ES un conductor: quitarla no borra nada en la base, solo deja
	/// el libro mintiendo sobre quién trabajó ese mes.
	'sheet.command.remove-sheet',
	'sheet.mutation.remove-sheet',
	'sheet.command.move-range',
	'sheet.command.delete-range-move-left',
	'sheet.command.delete-range-move-up',
	'sheet.command.insert-range-move-right',
	'sheet.command.insert-range-move-down'
]);

/**
 * Escrituras que se evalúan celda a celda.
 *
 * Las seis variantes de pegado están todas: bloquear solo `paste` deja
 * abiertas «pegar solo valores» y «pegar solo formato» del menú contextual,
 * que escriben igual.
 */
const COMANDOS_DE_ESCRITURA = new Set([
	SET_RANGE_VALUES,
	'sheet.command.clear-selection-content',
	'sheet.command.clear-selection-all',
	'sheet.command.clear-selection-format',
	/// El formato también: cambiarlo en una celda derivada es tan fantasma como
	/// cambiar su valor — se ve, no se guarda, desaparece al recargar.
	'sheet.command.set-style',
	'sheet.command.paste',
	'sheet.command.paste-value',
	'sheet.command.paste-format',
	'sheet.command.paste-col-width',
	'sheet.command.paste-besides-border',
	'sheet.command.optional-paste'
]);

/// Ventana en la que el propio canvas escribe y sus cambios pasan.
let repintandoAhora = false;

/**
 * Ejecuta `fn` con las escrituras permitidas.
 *
 * Síncrono a propósito: si aceptara una promesa, la ventana quedaría abierta
 * durante todo un `await` y cualquier tecla del usuario en ese hueco entraría
 * como edición válida.
 */
export function repintando<T>(fn: () => T): T {
	const previo = repintandoAhora;
	repintandoAhora = true;
	try {
		return fn();
	} finally {
		/// Se restaura el valor ANTERIOR y no `false`: esto se anida, y poner
		/// `false` a secas cerraría la puerta a media escritura del llamador.
		repintandoAhora = previo;
	}
}

/**
 * ¿Está el canvas repintando ahora mismo?
 *
 * Lo consulta el ADAPTER, no la guarda de permisos: sin esto, cada celda que el
 * canvas pinta al aplicar un patch —propio o de otro usuario— se lee como una
 * edición del usuario, se emite otro patch, el servidor responde, se vuelve a
 * pintar… y no para. Medido en el navegador: 376.033 escrituras en vuelo en
 * unos segundos, con el indicador de guardado disparado.
 */
export function estaRepintando(): boolean {
	return repintandoAhora;
}

export interface RecorridosPermissionOptions {
	unitId: string;
	/** `false` cuando el usuario solo puede consultar. */
	editable: boolean;
	/** Aviso ya redactado. Por callback, para no depender de la capa de UI. */
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}

const AVISO_SOLO_LECTURA = {
	titulo: 'Solo puedes consultar',
	detalle:
		'Modificar recorridos y marcar bonos está reservado a Administración y ' +
		'Operaciones. Puedes filtrar, exportar e imprimir la hoja.'
} as const;

const AVISO_DERIVADA = {
	titulo: 'Esta celda no se edita aquí',
	detalle:
		'La fecha, el número de fila y el valor a pagar se calculan. Para mover ' +
		'un recorrido de día o crear uno nuevo, usa «Registrar recorridos» en la ' +
		'ficha del conductor.'
} as const;

export function installRecorridosCellPermission(
	univer: Univer,
	opts: RecorridosPermissionOptions
): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);

	const esCeldaEditable = (sheetId: string, r: number, c: number): boolean =>
		!!getRecorridoBinding(opts.unitId, sheetId, r, c);

	/**
	 * ¿Puede escribirse en este rango?
	 *
	 * Exige que TODAS las celdas tengan binding. Un pegado que cae medio dentro
	 * y medio fuera se rechaza entero: aplicarlo a medias dejaría al usuario con
	 * la mitad de lo que pegó y sin saber qué mitad.
	 */
	const rangoEditable = (sheetId: string, params: Record<string, any>): boolean => {
		const rangos: any[] = params?.range
			? [params.range]
			: Array.isArray(params?.ranges)
				? params.ranges
				: [];

		if (!rangos.length) {
			// Sin rango explícito (`set-range-values` con `value` indexado por
			// fila/columna): se recorren las claves del objeto.
			const value = params?.value;
			if (value && typeof value === 'object') {
				for (const [rStr, fila] of Object.entries(value as Record<string, any>)) {
					for (const cStr of Object.keys(fila ?? {})) {
						if (!esCeldaEditable(sheetId, Number(rStr), Number(cStr))) return false;
					}
				}
				return true;
			}
			// No se sabe qué toca: se deniega. Es lo prudente en default-deny.
			return false;
		}

		for (const r of rangos) {
			const { startRow, endRow, startColumn, endColumn } = r ?? {};
			if (
				startRow === undefined ||
				endRow === undefined ||
				startColumn === undefined ||
				endColumn === undefined
			) {
				return false;
			}
			// Un rango enorme (seleccionar la columna entera y pulsar Supr) no se
			// recorre celda a celda: se deniega directamente.
			if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > 2000) return false;
			for (let row = startRow; row <= endRow; row++) {
				for (let col = startColumn; col <= endColumn; col++) {
					if (!esCeldaEditable(sheetId, row, col)) return false;
				}
			}
		}
		return true;
	};

	/**
	 * Guarda efectiva.
	 *
	 * El aviso solo se lanza al ABRIR el editor de celda. Si se lanzara también
	 * en `set-range-values`, un pegado de 40 filas dispararía 40 avisos; y si se
	 * lanzara al cerrar el editor, saldría dos veces por intento.
	 */
	const guarda = (info: Readonly<ICommandInfo>) => {
		if (repintandoAhora) return;
		const id = info.id;
		const params = (info.params ?? {}) as Record<string, any>;
		const sheetId: string | undefined = params.subUnitId ?? params.sheetId;

		if (id === SET_CELL_EDIT_VISIBLE) {
			/// Dejar pasar el cierre evita que un editor abierto por otra vía se
			/// quede colgado sin poder cerrarse.
			if (params?.visible !== true) return;
			if (!opts.editable) {
				opts.onBloqueado?.(AVISO_SOLO_LECTURA);
				throw new CustomCommandExecutionError('[recorridos] solo lectura');
			}
			// La celda que se va a abrir es la de la selección actual y el comando
			// no la trae; el filtro fino lo hace `set-range-values` al confirmar.
			return;
		}

		if (COMANDOS_DE_ESTRUCTURA.has(id)) {
			throw new CustomCommandExecutionError(
				'[recorridos] la geometría de la hoja la fija el builder'
			);
		}

		if (COMANDOS_DE_ESCRITURA.has(id)) {
			if (!opts.editable) {
				opts.onBloqueado?.(AVISO_SOLO_LECTURA);
				throw new CustomCommandExecutionError('[recorridos] solo lectura');
			}
			if (!sheetId) throw new CustomCommandExecutionError('[recorridos] escritura sin hoja');
			if (!rangoEditable(sheetId, params)) {
				opts.onBloqueado?.(AVISO_DERIVADA);
				throw new CustomCommandExecutionError('[recorridos] celda derivada');
			}
		}
	};

	const disposableGuarda = commandService.beforeCommandExecuted(guarda);

	/// Sigue registrado por los comandos de ESTRUCTURA, los únicos que
	/// consultan este servicio.
	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			if (repintandoAhora) return true;
			return !COMANDOS_DE_ESTRUCTURA.has(info.id);
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
