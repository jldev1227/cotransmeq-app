/**
 * Permisos del canvas de historial de liquidaciones de servicios.
 *
 * Aquí no hay whitelist de campos como en cierres: la hoja entera es de solo
 * lectura. Una liquidación se edita en su formulario, donde hay validación,
 * recálculo de IVA y control de estado; dejar teclear sobre la celda daría la
 * impresión de que el cambio se guarda cuando no hay a dónde guardarlo.
 *
 * Lo que sí escribe en la hoja es la propia página, al repintar la columna
 * N° FACTURA y ESTADO después de una acción del carril. Esas escrituras pasan
 * por `repintando()`, que abre la puerta durante el tiempo justo.
 */

import { type ICommandInfo, type Univer } from '@univerjs/core';
import { SheetInterceptorService } from '@univerjs/sheets';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';

/**
 * Todo lo que modifica la hoja. Se bloquean comandos Y mutaciones: medido en
 * los canvas de terceros, `insert-row-by-range` se saltaba el intercept de
 * comando y la fila entraba igual. Bloquear la mutación además cubre el
 * deshacer, que es la otra vía por la que una hoja congelada deja de estarlo.
 */
const COMANDOS_DE_ESCRITURA = new Set([
	SET_RANGE_VALUES,
	'sheet.command.clear-selection-content',
	'sheet.command.clear-selection-all',
	'sheet.command.clear-selection-format',
	'sheet.command.insert-row',
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-row-by-range',
	'sheet.command.remove-row',
	'sheet.command.remove-row-confirm',
	'sheet.mutation.insert-row',
	'sheet.mutation.remove-row',
	'sheet.command.insert-col',
	'sheet.command.insert-col-before',
	'sheet.command.insert-col-after',
	'sheet.command.insert-col-by-range',
	'sheet.command.remove-col',
	'sheet.command.remove-col-confirm',
	'sheet.mutation.insert-col',
	'sheet.mutation.remove-col',
	'sheet.command.remove-sheet',
	'sheet.mutation.remove-sheet',
	'sheet.command.move-range',
	'sheet.command.delete-range-move-left',
	'sheet.command.delete-range-move-up',
	'sheet.command.insert-range-move-right',
	'sheet.command.insert-range-move-down'
]);

/// Ventana en la que la propia página está repintando y sus escrituras pasan.
let repintandoAhora = false;

/**
 * Ejecuta `fn` con las escrituras permitidas.
 *
 * Es síncrono a propósito: si aceptara una promesa, la ventana quedaría
 * abierta durante todo un `await` y cualquier tecla del usuario en ese hueco
 * entraría como edición válida.
 */
export function repintando<T>(fn: () => T): T {
	repintandoAhora = true;
	try {
		return fn();
	} finally {
		repintandoAhora = false;
	}
}

export interface HistorialPermissionOptions {
	/**
	 * Aviso ya redactado cuando se bloquea algo que el usuario intentó a
	 * propósito. Va por callback para que este módulo no dependa de la capa
	 * de UI.
	 */
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}

export function installHistorialCellPermission(
	univer: Univer,
	opts: HistorialPermissionOptions = {}
): () => void {
	const interceptor = univer.__getInjector().get(SheetInterceptorService);

	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			if (repintandoAhora) return true;

			const id = info.id;

			/// El aviso solo se lanza al ABRIR el editor de celda. Si se lanzara
			/// también en `set-range-values`, un pegado de 40 filas dispararía 40
			/// toasts; y si se lanzara al cerrar el editor, saldría dos veces por
			/// cada intento.
			if (id === SET_CELL_EDIT_VISIBLE) {
				const params = (info.params ?? {}) as Record<string, any>;
				if (params?.visible !== true) return true;
				opts.onBloqueado?.({
					titulo: 'El historial es de solo lectura',
					detalle:
						'Una liquidación se edita desde su formulario, donde se recalculan ' +
						'el IVA y los totales. Para trabajar con facturas usa el carril de ' +
						'la derecha.'
				});
				return false;
			}

			return !COMANDOS_DE_ESCRITURA.has(id);
		}
	});

	return () => {
		try {
			disposable.dispose();
		} catch {
			/* noop */
		}
	};
}
