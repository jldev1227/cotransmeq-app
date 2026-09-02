/**
 * Permisos del canvas de historial de liquidaciones de servicios.
 *
 * Aquí no hay whitelist de campos como en cierres: las TRES hojas
 * —Liquidaciones, Facturas y Terceros— son de solo lectura. Una liquidación se
 * edita en su formulario, donde hay validación, recálculo de IVA y control de
 * estado; dejar teclear sobre la celda daría la impresión de que el cambio se
 * guarda cuando no hay a dónde guardarlo.
 *
 * Lo que sí escribe en la hoja es la propia página, al repintar la columna
 * N° FACTURA y ESTADO después de una acción del carril, y el resaltado de
 * filas. Esas escrituras pasan por `repintando()`, que abre la puerta durante
 * el tiempo justo.
 *
 * ── CÓMO SE CORTA, Y POR QUÉ NO BASTA EL INTERCEPTOR ───────────────────────
 *
 * Se corta por `beforeCommandExecuted` del `ICommandService`, lanzando
 * `CustomCommandExecutionError`: es el mecanismo que Univer entiende como
 * «este comando no se ejecuta» (lo captura en `executeCommand` y devuelve
 * `false`, sin propagar el error ni ensuciar la consola).
 *
 * Antes esto colgaba SOLO de `SheetInterceptorService.interceptBeforeCommand`,
 * y por ahí no pasaban ni `sheet.command.set-range-values` ni
 * `sheet.operation.set-cell-edit-visible`: ese servicio solo lo consultan unos
 * pocos comandos de estructura —mover rango, insertar/borrar filas—. El check
 * existía y para la escritura de celdas no se ejecutaba nunca, así que la hoja
 * se decía de solo lectura y se dejaba editar. Es el mismo hallazgo que ya
 * documenta `cell-permission-ingresos.ts`.
 *
 * El interceptor se mantiene registrado porque sí cubre esos comandos de
 * estructura, que es donde de verdad sirve.
 *
 * ── POR QUÉ NO SE USA `setEditable(false)` ────────────────────────────────
 *
 * Sería el cierre obvio —y de hecho `createLiquidacionEngine` lo ofrece con
 * `readOnly: true`— pero baja `WorkbookEditablePermission`, y en
 * `@univerjs/sheets` 0.25.1 esa misma bandera es la que decide si pasa
 * `SetRangeValuesCommand`. Bloquearía las escrituras del propio canvas: el
 * número de factura tras facturar, las liquidaciones que llegan por socket y
 * el resaltado de filas.
 *
 * Cortar aquí sí distingue quién escribe, porque existe `repintando()`. El
 * permiso del workbook no distingue a nadie.
 */

import {
	CustomCommandExecutionError,
	ICommandService,
	type ICommandInfo,
	type Univer
} from '@univerjs/core';
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
	/// PLURAL. En Univer 0.25.1 la mutación es `remove-rows`; el singular que
	/// había aquí no existe, así que borrar filas por esa vía nunca se bloqueó.
	'sheet.mutation.remove-rows',
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

/**
 * Comandos que además hay que cortar en `beforeCommandExecuted`.
 *
 * Es un superconjunto de los de estructura: aquí entran las rutas de escritura
 * de celda de verdad —`set-range-values`, los borrados con Supr y el pegado—,
 * que son las que el interceptor no ve.
 *
 * Todos los ids están verificados contra `@univerjs/sheets` y
 * `@univerjs/sheets-ui` 0.25.1: un id inventado no bloquea nada y da una falsa
 * sensación de cobertura.
 */
const COMANDOS_CORTADOS = new Set([
	...COMANDOS_DE_ESCRITURA,
	/// Formato. Cambiarlo en una celda derivada es igual de fantasma que
	/// cambiar su valor: se ve, no se guarda y desaparece al recargar.
	'sheet.command.set-style',
	/// Las SEIS variantes de pegado de sheets-ui. Bloquear solo `paste` dejaba
	/// abiertas «pegar solo valores» y «pegar solo formato» del menú
	/// contextual, que escriben igual. Ids verificados contra
	/// `@univerjs/sheets-ui` 0.25.1.
	'sheet.command.paste',
	'sheet.command.paste-value',
	'sheet.command.paste-format',
	'sheet.command.paste-col-width',
	'sheet.command.paste-besides-border',
	'sheet.command.optional-paste'
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
	const previo = repintandoAhora;
	repintandoAhora = true;
	try {
		return fn();
	} finally {
		/// Se restaura el valor ANTERIOR y no `false`: `repintando` se anida
		/// (`actualizarLiquidacion` llama a `pintarCelda`, que vuelve a envolver),
		/// y poner `false` a secas cerraría la puerta a media escritura del
		/// llamador externo.
		repintandoAhora = previo;
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

const AVISO = {
	titulo: 'El historial es de solo lectura',
	detalle:
		'Una liquidación se edita desde su formulario, donde se recalculan ' +
		'el IVA y los totales. Para trabajar con facturas usa el carril de ' +
		'la derecha.'
} as const;

export function installHistorialCellPermission(
	univer: Univer,
	opts: HistorialPermissionOptions = {}
): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);

	/**
	 * Guarda EFECTIVA. Es la que de verdad para la escritura.
	 *
	 * El aviso solo se lanza al ABRIR el editor de celda. Si se lanzara también
	 * en `set-range-values`, un pegado de 40 filas dispararía 40 toasts; y si se
	 * lanzara al cerrar el editor, saldría dos veces por cada intento.
	 */
	const guarda = (info: Readonly<ICommandInfo>) => {
		if (repintandoAhora) return;
		const id = info.id;

		if (id === SET_CELL_EDIT_VISIBLE) {
			const params = (info.params ?? {}) as Record<string, any>;
			/// Dejar pasar el cierre (`visible !== true`) evita que un editor
			/// abierto por otra vía se quede colgado sin poder cerrarse.
			if (params?.visible !== true) return;
			opts.onBloqueado?.(AVISO);
			throw new CustomCommandExecutionError('[historial] hoja de solo lectura');
		}

		if (COMANDOS_CORTADOS.has(id)) {
			throw new CustomCommandExecutionError('[historial] hoja de solo lectura');
		}
	};
	const disposableGuarda = commandService.beforeCommandExecuted(guarda);

	/// Sigue registrado por los comandos de ESTRUCTURA, que son los únicos que
	/// consultan este servicio.
	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			if (repintandoAhora) return true;
			return !COMANDOS_DE_ESCRITURA.has(info.id);
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
