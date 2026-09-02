/**
 * Permisos de celda del canvas de **nómina**.
 *
 * DEFAULT-DENY POR BINDING. En esta hoja la mayoría de lo que se ve es
 * DERIVADO: los días, las horas por tipo, el desglose por empresa, las siete
 * filas de recargo y el reparto entre desprendible y disponibilidad salen de
 * las planillas. Solo se deja escribir donde el builder registró binding
 * (`nomina-cell-binding`), que es el desprendible y poco más. Una celda sin
 * binding no es editable, y no hay que acordarse de añadirla a ninguna lista
 * negra cuando la hoja crezca.
 *
 * Además hay un segundo corte por ESTADO: una liquidación APROBADA, PAGADA o
 * ANULADA no se toca aunque la celda tenga binding. Reescribir un
 * desprendible que alguien ya aprobó —o firmó— no es una edición, es otra
 * cosa. Para eso está la reversión de estado.
 *
 * ── CÓMO SE CORTA, Y POR QUÉ NO BASTA EL INTERCEPTOR ───────────────────────
 *
 * Igual que en los canvas de terceros: `SheetInterceptorService` NO ve
 * `sheet.command.set-range-values` ni `sheet.operation.set-cell-edit-visible`
 * —solo lo consultan unos pocos comandos de estructura—, así que el corte de
 * verdad va por `beforeCommandExecuted` lanzando
 * `CustomCommandExecutionError`, que es lo que Univer entiende como «este
 * comando no se ejecuta». El interceptor se deja registrado porque sí cubre
 * los comandos de estructura, que es donde sirve.
 *
 * ── POR QUÉ NO `readOnly: true` ───────────────────────────────────────────
 *
 * `createLiquidacionEngine` lo ofrece, pero baja `WorkbookEditablePermission`,
 * que en `@univerjs/sheets` 0.25.1 es la MISMA bandera que decide si pasa
 * `SetRangeValuesCommand`. Bloquearía también las escrituras del propio
 * canvas: los totales que vuelven del servidor tras un patch y los cambios
 * que llegan de otros usuarios. Cortar aquí sí distingue quién escribe,
 * porque existe `repintando()`.
 */

import {
	CustomCommandExecutionError,
	ICommandService,
	type ICommandInfo,
	type Univer
} from '@univerjs/core';
import { SheetInterceptorService } from '@univerjs/sheets';
import { esCeldaEditable } from '../business/nomina-cell-binding';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';

/**
 * Comandos de ESTRUCTURA. Cambian la geometría de la hoja, que aquí la fija
 * el builder: insertar una fila descolocaría todas las fórmulas del
 * desprendible y los bindings apuntarían a celdas equivocadas.
 *
 * Se bloquean comandos Y mutaciones. La mutación cubre además el deshacer,
 * que es la otra vía por la que una hoja congelada deja de estarlo.
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
	'sheet.command.remove-sheet',
	'sheet.mutation.remove-sheet',
	'sheet.command.move-range',
	'sheet.command.delete-range-move-left',
	'sheet.command.delete-range-move-up',
	'sheet.command.insert-range-move-right',
	'sheet.command.insert-range-move-down'
]);

/**
 * Escrituras que hay que evaluar celda a celda: si TODAS las celdas del rango
 * tienen binding y la hoja no está bloqueada, pasan; si no, se cortan.
 *
 * Las seis variantes de pegado de `sheets-ui` están todas: bloquear solo
 * `paste` deja abiertas «pegar solo valores» y «pegar solo formato» del menú
 * contextual, que escriben igual.
 */
const COMANDOS_DE_ESCRITURA = new Set([
	SET_RANGE_VALUES,
	'sheet.command.clear-selection-content',
	'sheet.command.clear-selection-all',
	'sheet.command.clear-selection-format',
	/// El formato también: cambiarlo en una celda derivada es tan fantasma
	/// como cambiar su valor —se ve, no se guarda, desaparece al recargar.
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

export interface NominaPermissionOptions {
	/** Unit del libro, para consultar el binding. */
	unitId: string;
	/** Estado de cada hoja: `sheetId → estado`. Se relee en cada guarda. */
	estadoPorHoja: () => Record<string, string>;
	/** Estados en los que la hoja entera es de solo lectura. */
	estadosBloqueados: string[];
	/** Aviso ya redactado. Por callback, para no depender de la capa de UI. */
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}

const AVISO_DERIVADA = {
	titulo: 'Esta celda no se edita aquí',
	detalle:
		'Los días, las horas y los recargos vienen de las planillas del ' +
		'conductor. Para corregirlos, edita la planilla en Recargos; el ' +
		'canvas se actualiza solo.'
} as const;

const avisoBloqueada = (estado: string) => ({
	titulo: `La liquidación está en ${estado}`,
	detalle:
		'Un desprendible aprobado o pagado no se reescribe. Si hay que ' +
		'corregirlo, devuélvelo a LIQUIDADA desde el carril de estado.'
});

export function installNominaCellPermission(
	univer: Univer,
	opts: NominaPermissionOptions
): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);

	/** Estado de la hoja a la que apunta un comando, o `null` si no se sabe. */
	const estadoDeHoja = (sheetId: string | undefined): string | null => {
		if (!sheetId) return null;
		return opts.estadoPorHoja()[sheetId] ?? null;
	};

	/**
	 * ¿Puede escribirse en este rango?
	 *
	 * Exige que TODAS las celdas tengan binding. Un pegado que cae medio
	 * dentro y medio fuera se rechaza entero: aplicarlo a medias dejaría al
	 * usuario con la mitad de lo que pegó y sin saber qué mitad.
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
						if (!esCeldaEditable(opts.unitId, sheetId, Number(rStr), Number(cStr))) return false;
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
			// Un rango enorme (seleccionar la columna entera y pulsar Supr) no
			// se recorre celda a celda: se deniega directamente.
			if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > 2000) return false;
			for (let row = startRow; row <= endRow; row++) {
				for (let col = startColumn; col <= endColumn; col++) {
					if (!esCeldaEditable(opts.unitId, sheetId, row, col)) return false;
				}
			}
		}
		return true;
	};

	/**
	 * Guarda efectiva.
	 *
	 * El aviso solo se lanza al ABRIR el editor de celda. Si se lanzara
	 * también en `set-range-values`, un pegado de 40 filas dispararía 40
	 * toasts; y si se lanzara al cerrar el editor, saldría dos veces por
	 * intento.
	 */
	const guarda = (info: Readonly<ICommandInfo>) => {
		if (repintandoAhora) return;
		const id = info.id;
		const params = (info.params ?? {}) as Record<string, any>;
		const sheetId: string | undefined = params.subUnitId ?? params.sheetId;

		if (id === SET_CELL_EDIT_VISIBLE) {
			/// Dejar pasar el cierre evita que un editor abierto por otra vía
			/// se quede colgado sin poder cerrarse.
			if (params?.visible !== true) return;

			const estado = estadoDeHoja(sheetId);
			if (estado && opts.estadosBloqueados.includes(estado)) {
				opts.onBloqueado?.(avisoBloqueada(estado));
				throw new CustomCommandExecutionError('[nomina] hoja bloqueada por estado');
			}
			// La celda que se va a abrir es la de la selección actual; el
			// comando no la trae, así que el filtro fino lo hace
			// `set-range-values` al confirmar. Aquí solo se corta por estado.
			return;
		}

		if (COMANDOS_DE_ESTRUCTURA.has(id)) {
			throw new CustomCommandExecutionError('[nomina] la geometría de la hoja la fija el builder');
		}

		if (COMANDOS_DE_ESCRITURA.has(id)) {
			if (!sheetId) throw new CustomCommandExecutionError('[nomina] escritura sin hoja');

			const estado = estadoDeHoja(sheetId);
			if (estado && opts.estadosBloqueados.includes(estado)) {
				opts.onBloqueado?.(avisoBloqueada(estado));
				throw new CustomCommandExecutionError('[nomina] hoja bloqueada por estado');
			}

			if (!rangoEditable(sheetId, params)) {
				opts.onBloqueado?.(AVISO_DERIVADA);
				throw new CustomCommandExecutionError('[nomina] celda derivada');
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
