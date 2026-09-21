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
 *  · `#`, `DÍA` y `VALOR A PAGAR`, que se calculan. `DÍA` sale de la fecha:
 *    al escribirla, el engine lo rellena.
 *  · `TIPO DE DÍA` en las filas de recorrido: el tipo es del día, no del
 *    tramo, y editarlo en uno afectaría a los demás sin que se vea.
 *
 * ── FILAS: INSERTAR Y ELIMINAR ────────────────────────────────────────────
 *
 * Los comandos de FILA de Univer (menú contextual del número de fila, o
 * Ctrl+Z no) están permitidos DENTRO de la zona de datos de la hoja —entre la
 * cabecera y el pie de totales— y solo ahí. Insertar es la forma natural de
 * añadir un día o un recorrido que falta, y eliminar es la de retirarlo: es lo
 * que cualquiera que use una hoja de cálculo hace sin que se lo expliquen. El
 * engine se encarga de desplazar los bindings y de dar de alta o de baja en
 * el servidor. Las columnas y las hojas siguen fijas: su geometría la decide
 * el builder.
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
	IUniverInstanceService,
	UniverInstanceType,
	type ICommandInfo,
	type IRange,
	type Univer
} from '@univerjs/core';
import { SheetInterceptorService, SheetsSelectionsService } from '@univerjs/sheets';
import { getRecorridoBinding } from '../business/recorridos-cell-binding';
import { rellenado } from './adapters/cell-change-recorridos';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';

/**
 * Comandos de FILA que se dejan pasar dentro de la zona de datos.
 *
 * Los de arriba son los que abre el usuario (menú contextual, atajos); los de
 * abajo son la maquinaria que ejecutan por dentro y las mutaciones finales.
 * Estos últimos SOLO pasan mientras un comando de arriba está en curso —ver
 * `ventanaDeEstructura`—: sueltos, serían un deshacer o un pegado que
 * cambia filas sin que nadie lo haya pedido.
 */
const COMANDOS_DE_FILA_USUARIO = new Set([
	'sheet.command.insert-row-before',
	'sheet.command.insert-row-after',
	'sheet.command.insert-multi-rows-above',
	'sheet.command.insert-multi-rows-after',
	'sheet.command.remove-row-confirm',
	'sheet.command.remove-row'
]);
const COMANDOS_DE_FILA_INTERNOS = new Set([
	'sheet.command.insert-row',
	'sheet.command.insert-row-by-range',
	'sheet.command.remove-row-by-range',
	'sheet.mutation.insert-row',
	/// PLURAL. En Univer 0.25.1 la mutación es `remove-rows`; el singular no
	/// existe y bloquearlo no haría nada.
	'sheet.mutation.remove-rows'
]);

/**
 * Comandos de ESTRUCTURA que siguen bloqueados siempre. La geometría de las
 * COLUMNAS la fija el builder: su número depende de cuántos bonos estén
 * visibles. Y una hoja ES un conductor.
 *
 * Se bloquean comandos Y mutaciones: la mutación cubre además el deshacer, que
 * es la otra vía por la que una hoja congelada deja de estarlo.
 */
const COMANDOS_DE_ESTRUCTURA = new Set([
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
	/// El TIRADOR de relleno (arrastrar la esquina de la selección) y el cambio
	/// de tipo de relleno de su desplegable. Escriben por mutación directa, sin
	/// pasar por `set-range-values`, así que sin esto un arrastre hasta el pie
	/// de totales lo pisaba sin que nadie lo viera.
	'sheet.command.auto-fill',
	'sheet.command.refill',
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
	/**
	 * Zona de datos de una hoja: filas entre la cabecera y el pie, ambas
	 * inclusive, donde se puede insertar o eliminar. `null` si la hoja no es
	 * de un conductor. La mantiene el engine, que la mueve con cada alta o
	 * baja de filas.
	 */
	zonaDeDatos?: (sheetId: string) => ZonaDeDatos | null;
	/**
	 * Columnas CALCULADAS de la tabla (`#`, día de la semana, valor a pagar).
	 *
	 * Solo las consulta el autorrelleno: arrastrar un bloque de columnas hacia
	 * abajo —fecha, día, tipo, placa, descripción, como se hace en Excel— pasa
	 * por encima de ellas, y rechazarlo entero por eso dejaba al usuario sin
	 * la forma más natural de cargar varias filas. Lo que el arrastre escriba
	 * en ellas lo repinta el engine justo después.
	 */
	columnasDerivadas?: (sheetId: string) => Set<number>;
	/** Aviso ya redactado. Por callback, para no depender de la capa de UI. */
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}

/**
 * Filas entre la cabecera y el pie, ambas inclusive. Con `vacia`, la hoja no
 * tiene datos y `desde`/`hasta` señalan el PIE: solo cabe insertar encima.
 */
export interface ZonaDeDatos {
	desde: number;
	hasta: number;
	vacia?: boolean;
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
		'El número de fila, el día de la semana y el valor a pagar se calculan. ' +
		'Para añadir un día o un recorrido, inserta una fila (clic derecho sobre ' +
		'el número de fila); para quitarlo, elimina la fila.'
} as const;

const AVISO_ESTRUCTURA = {
	titulo: 'Solo dentro de la tabla',
	detalle:
		'Inserta o elimina filas entre la cabecera y el pie de totales. Las ' +
		'columnas y las hojas las fija el formato.'
} as const;

/**
 * Ventana en la que la maquinaria interna de un comando de fila permitido
 * puede pasar. Caduca sola al final de la tarea actual: el comando de Univer
 * es asíncrono —espera a su interceptor antes de mutar—, pero resuelve en
 * microtareas, así que un `setTimeout(0)` llega siempre después de que haya
 * terminado y nunca antes.
 */
let ventanaDeEstructura = 0;

export function installRecorridosCellPermission(
	univer: Univer,
	opts: RecorridosPermissionOptions
): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	const commandService = injector.get(ICommandService);
	const instancias = injector.get(IUniverInstanceService);
	const selecciones = injector.get(SheetsSelectionsService);

	/**
	 * Hoja y rangos que toca un comando, resueltos como los resuelve Univer.
	 *
	 * Los comandos que nacen de un CLIC EN LA CASILLA —pernocte y cada bono—
	 * llegan sin `unitId` ni `subUnitId`: `sheets-data-validation-ui` despacha
	 * `SetRangeValuesCommand` con `{ range, value }` y nada más, y el propio
	 * comando los resuelve después contra la hoja activa. Lo mismo pasa con un
	 * Supr sobre la selección viva, que llega sin `ranges`.
	 *
	 * Denegar por «faltan los ids» es exactamente lo que dejaba las casillas
	 * muertas: el clic se abortaba aquí, en silencio y sin aviso, y la casilla
	 * ni se marcaba ni se desmarcaba. El adapter de cambios ya hacía este mismo
	 * fallback —lo documenta en su cabecera—; esta guarda se había quedado sin
	 * él, y el canvas de ingresos lo avisa en su propio comentario.
	 */
	const objetivoDe = (
		params: Record<string, any>
	): { sheetId: string; rangos: IRange[] } | null => {
		const libro: any = params.unitId
			? instancias.getUnit(params.unitId, UniverInstanceType.UNIVER_SHEET)
			: instancias.getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET);
		/// Otro libro (o ninguno): no es asunto de este permission.
		if (!libro || libro.getUnitId?.() !== opts.unitId) return null;

		const sheetId: string | undefined =
			params.subUnitId ?? params.sheetId ?? libro.getActiveSheet?.()?.getSheetId?.();
		if (!sheetId) return null;

		const rangos: IRange[] = params.range
			? [params.range as IRange]
			: params.targetRange
				? /// Autorrelleno: lo que se escribe es el DESTINO del arrastre SIN el
					/// origen, que no cambia. Con el origen dentro, arrastrar desde una
					/// fila de día —cuya placa no se edita— se rechazaba entero.
					rellenado(params.sourceRange as IRange | undefined, params.targetRange as IRange)
				: Array.isArray(params.ranges) && params.ranges.length
					? (params.ranges as IRange[])
					: (selecciones.getCurrentSelections() ?? [])
							.map((s: any) => s.range)
							.filter(Boolean);

		return { sheetId, rangos };
	};

	const esCeldaEditable = (sheetId: string, r: number, c: number): boolean =>
		!!getRecorridoBinding(opts.unitId, sheetId, r, c);

	/**
	 * ¿Puede ejecutarse este comando de fila?
	 *
	 * Insertar ENCIMA exige que la fila de referencia esté en la zona; insertar
	 * DEBAJO, que lo esté la última de la selección (así se puede añadir una
	 * fila justo antes del pie). Eliminar exige que TODA la selección esté en
	 * la zona: llevarse la cabecera o el pie por seleccionar de más rompería
	 * la hoja.
	 */
	const filaPermitida = (id: string, params: Record<string, any>): boolean => {
		const objetivo = objetivoDe(params);
		if (!objetivo) return false;
		const zona = opts.zonaDeDatos?.(objetivo.sheetId) ?? null;
		if (!zona) return false;
		const rango = objetivo.rangos[0];
		if (!rango) return false;
		const dentro = (r: number) => r >= zona.desde && r <= zona.hasta;
		/// Hoja sin filas: la zona ES el pie. Solo se puede insertar encima de él;
		/// insertar debajo lo dejaría fuera de la tabla y eliminarlo rompería la
		/// hoja.
		if (zona.vacia) {
			return (
				(id === 'sheet.command.insert-row-before' ||
					id === 'sheet.command.insert-multi-rows-above') &&
				rango.startRow === zona.desde
			);
		}
		switch (id) {
			case 'sheet.command.insert-row-before':
			case 'sheet.command.insert-multi-rows-above':
				return dentro(rango.startRow);
			case 'sheet.command.insert-row-after':
			case 'sheet.command.insert-multi-rows-after':
				return dentro(rango.endRow);
			case 'sheet.command.remove-row-confirm':
			case 'sheet.command.remove-row':
				return dentro(rango.startRow) && dentro(rango.endRow);
			default:
				return false;
		}
	};

	const abrirVentana = () => {
		ventanaDeEstructura++;
		setTimeout(() => {
			ventanaDeEstructura = Math.max(0, ventanaDeEstructura - 1);
		}, 0);
	};

	/**
	 * ¿Puede escribirse en este rango?
	 *
	 * Exige que TODAS las celdas tengan binding. Un pegado que cae medio dentro
	 * y medio fuera se rechaza entero: aplicarlo a medias dejaría al usuario con
	 * la mitad de lo que pegó y sin saber qué mitad.
	 */
	const rangoEditable = (
		sheetId: string,
		rangos: IRange[],
		params: Record<string, any>,
		id?: string
	): boolean => {
		/// En el autorrelleno, una celda calculada dentro de la zona de datos
		/// también pasa: se repinta después. Fuera de la zona (cabecera, pie), no.
		const esAutorrelleno = id === 'sheet.command.auto-fill' || id === 'sheet.command.refill';
		const zona = esAutorrelleno ? (opts.zonaDeDatos?.(sheetId) ?? null) : null;
		const derivadas = esAutorrelleno ? (opts.columnasDerivadas?.(sheetId) ?? null) : null;
		const admitida = (row: number, col: number): boolean => {
			if (esCeldaEditable(sheetId, row, col)) return true;
			if (!zona || zona.vacia || !derivadas) return false;
			return row >= zona.desde && row <= zona.hasta && derivadas.has(col);
		};
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
					if (!admitida(row, col)) return false;
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

		if (COMANDOS_DE_FILA_USUARIO.has(id)) {
			if (!opts.editable) {
				opts.onBloqueado?.(AVISO_SOLO_LECTURA);
				throw new CustomCommandExecutionError('[recorridos] solo lectura');
			}
			/// `remove-row` llega dos veces: como comando del usuario y, dentro
			/// de `remove-row-confirm`, como paso interno. La segunda ya va con
			/// la ventana abierta y no hay que volver a validarla.
			if (id === 'sheet.command.remove-row' && ventanaDeEstructura > 0) return;
			if (!filaPermitida(id, params)) {
				opts.onBloqueado?.(AVISO_ESTRUCTURA);
				throw new CustomCommandExecutionError('[recorridos] fila fuera de la zona de datos');
			}
			abrirVentana();
			return;
		}

		if (COMANDOS_DE_FILA_INTERNOS.has(id)) {
			if (ventanaDeEstructura > 0) return;
			throw new CustomCommandExecutionError(
				'[recorridos] las filas solo cambian desde insertar o eliminar fila'
			);
		}

		if (COMANDOS_DE_ESTRUCTURA.has(id)) {
			opts.onBloqueado?.(AVISO_ESTRUCTURA);
			throw new CustomCommandExecutionError(
				'[recorridos] la geometría de la hoja la fija el builder'
			);
		}

		if (COMANDOS_DE_ESCRITURA.has(id)) {
			if (!opts.editable) {
				opts.onBloqueado?.(AVISO_SOLO_LECTURA);
				throw new CustomCommandExecutionError('[recorridos] solo lectura');
			}
			const objetivo = objetivoDe(params);
			/// Sin objetivo el comando no es de este libro: no se bloquea, se
			/// ignora. Lanzar aquí abortaría escrituras de otro canvas montado a
			/// la vez.
			if (!objetivo) return;
			if (!rangoEditable(objetivo.sheetId, objetivo.rangos, params, id)) {
				opts.onBloqueado?.(AVISO_DERIVADA);
				throw new CustomCommandExecutionError('[recorridos] celda derivada');
			}
		}
	};

	const disposableGuarda = commandService.beforeCommandExecuted(guarda);

	/// Sigue registrado por los comandos de ESTRUCTURA, los únicos que
	/// consultan este servicio. Los de fila internos pasan solo con la ventana
	/// abierta por el comando del usuario que los envuelve.
	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			if (repintandoAhora) return true;
			if (COMANDOS_DE_FILA_INTERNOS.has(info.id)) return ventanaDeEstructura > 0;
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
