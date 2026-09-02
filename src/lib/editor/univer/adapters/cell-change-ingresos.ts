/**
 * Adapter del canvas de INGRESOS DE COTRANSMEQ: eventos de Univer →
 * mutaciones en la capa editable del mes.
 *
 * Trabaja sobre un libro de 24 hojas —dos por mes—, así que el MES y la HOJA
 * se resuelven siempre a partir del `subUnitId` del comando, nunca de la hoja
 * activa: un pegado o un undo pueden dirigirse a una hoja que no está en
 * pantalla, y resolver por hoja activa escribiría en el mes equivocado.
 *
 * Lo que se edita NO son los items de la liquidación —esos son derivados y el
 * permission los bloquea— sino la capa de decisiones encima: la columna
 * INCLUIR, la cantidad, el V/UNIDAD de la hoja de adicionales y los conceptos
 * del pie. El adapter notifica al consumer con un solo `setState` por edición
 * para evitar rerenders múltiples; la persistencia la decide él.
 */

import type {
	ICommandInfo,
	IRange,
	ICommandService,
	ICellData,
	IDisposable
} from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { getIngresosBinding } from '../../business/ingresos-cell-binding';
import { anclaDe, type Ancla } from '../../business/zona-libre';
import { numeroDeCelda } from '../../business/numero-de-celda';
import type {
	ConceptoIngreso,
	FilaIngresoEstado,
	HojaIngreso
} from '$lib/api/liquidaciones-terceros-ingresos';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
/**
 * Borrar con Supr NO pasa por `set-range-values`: Univer emite su propio
 * comando. Sin escucharlo, el contenido desaparecía de la pantalla pero no se
 * guardaba nada — al recargar volvía a estar.
 */
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';
/**
 * Cambio de hoja activa.
 *
 * Es la OPERACIÓN, no el comando. `sheet.command.set-worksheet-active` —lo que
 * había aquí— no existe en Univer: el comando se llama
 * `sheet.command.set-worksheet-activate` y lo único que hace es delegar, tras
 * un `setTimeout`, en esta operación. Escuchando un id inexistente el listener
 * NUNCA se disparaba, así que hacer clic en la pestaña del libro cambiaba la
 * hoja en pantalla pero no avisaba a la página: `hojaActiva` y la URL se
 * quedaban en la anterior y el correo salía con la hoja equivocada.
 *
 * La operación además es el punto por el que pasa TODO cambio de hoja —clic en
 * la pestaña, atajo o `activarMes` programático—, que es justo lo que hay que
 * observar.
 */
const SET_WORKSHEET_ACTIVE = 'sheet.operation.set-worksheet-active';

export interface IngresosAdapterState {
	filas: FilaIngresoEstado[];
	conceptos: ConceptoIngreso[];
}

export interface IngresosAdapterContext {
	unitId: string;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `subUnitId` → mes (1..12), o `null` si la hoja no es de este libro. */
	resolveMes: (sheetId: string) => number | null;
	/** `subUnitId` → cuál de las dos hojas del mes. */
	resolveHoja: (sheetId: string) => HojaIngreso | null;

	getState: (mes: number) => IngresosAdapterState;
	setState?: (mes: number, next: IngresosAdapterState) => void;
	/**
	 * `true` mientras se pinta una edición llegada de otro usuario. Sin esta
	 * guarda, el `setValue` del patch remoto dispara `set-range-values`, este
	 * adapter lo tomaría por edición local y lo reemitiría: eco infinito.
	 */
	isApplyingRemote?: () => boolean;
	/** El usuario cambió de hoja (para sincronizar `?mes=` y `?hoja=`). */
	onActiveSheetChange?: (mes: number, hoja: HojaIngreso) => void;
	/** Escritura en la ZONA LIBRE: una nota, no un campo de la base. */
	onAnotacion?: (a: {
		mes: number;
		sheetKey: string;
		ancla: Ancla;
		valor: string | null;
	}) => void;
	/** Hoja → `sheet_key` de la anotación ('' para ingresos, 'adic' para la otra). */
	sheetKeyDe?: (sheetId: string) => string;
	/**
	 * Una edición cambió el INCLUIR de uno o varios servicios.
	 *
	 * Es la única decisión de esta hoja que se ve en la OTRA: el servicio
	 * marcado aparece en la de adicionales y entra en su liquidación, que a su
	 * vez es lo que la de ingresos resta. Quien escucha tiene que reflejarlo
	 * ahí, y anunciarlo por el socket para quien tenga el mes abierto.
	 *
	 * `cambios` lleva qué servicios se marcaron o desmarcaron, para poder
	 * anunciarlo sin volver a diffear el estado.
	 */
	onIncluirCambiado?: (
		mes: number,
		cambios: Array<{ itemId: string; incluir: boolean }>
	) => void;
}

/**
 * `unitId` / `subUnitId` del comando, con el mismo fallback que Univer.
 *
 * EL CHECKBOX DE «INCLUIR» NO LOS MANDA. `sheets-data-validation-ui` despacha
 * `SetRangeValuesCommand` con `{ range, value }` y nada más, y el propio
 * comando los resuelve contra la hoja ACTIVA (`getSheetCommandTarget`). Aquí se
 * comparaba `params.unitId !== ctx.unitId` con `undefined` a la izquierda, así
 * que TODOS los clics del checkbox se descartaban en silencio: la celda pasaba
 * a «SÍ» en pantalla, el modelo no se enteraba, no había nada que guardar y al
 * recargar volvía a «NO». Ese era el INCLUIR fantasma.
 */
function objetivoDeComando(
	ctx: IngresosAdapterContext,
	unitId: string | undefined,
	subUnitId: string | undefined
): { subUnitId: string } | null {
	const wb = ctx.getWorkbook() as any;
	if (unitId && unitId !== ctx.unitId) return null;
	if (!unitId && wb?.getId?.() !== ctx.unitId) return null;
	const resuelto = subUnitId ?? wb?.getActiveSheet?.()?.getSheetId?.();
	return resuelto ? { subUnitId: resuelto } : null;
}

export function attachIngresosCellChangeAdapter(
	ctx: IngresosAdapterContext
): () => void {
	const disposables: IDisposable[] = [];

	// ─── Cambio de hoja ─────────────────────────────────────────────────
	const onCmdExecuted = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_WORKSHEET_ACTIVE || !ctx.onActiveSheetChange) return;
		const params = info.params as { unitId?: string; subUnitId?: string } | undefined;
		if (params?.unitId && params.unitId !== ctx.unitId) return;
		if (!params?.subUnitId) return;
		const mes = ctx.resolveMes(params.subUnitId);
		const hoja = ctx.resolveHoja(params.subUnitId);
		if (mes && hoja) ctx.onActiveSheetChange(mes, hoja);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onCmdExecuted));

	// ─── Edición de celdas ──────────────────────────────────────────────
	const onValueChange = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_RANGE_VALUES) return;
		// Eco de una edición remota: ya está en el modelo, no reprocesar.
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
		handleRangeChange(ctx, objetivo.subUnitId, rango, params.value);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onValueChange));

	/**
	 * Borrado de contenido (Supr / «Borrar contenido» del menú).
	 *
	 * El comando trae `ranges` solo a veces; cuando no, actúa sobre la
	 * selección viva, así que hay que leerla del propio libro.
	 *
	 * Se procesa por el MISMO camino que una escritura, con el valor a `null`:
	 * las celdas de la capa se borran y las que tienen BINDING vuelven a su
	 * valor de partida (un concepto a 0, la cantidad a 1, el V/UNIDAD al
	 * porcentaje de ganancia). Antes las celdas con binding se saltaban aquí,
	 * así que vaciar con Supr un importe del pie lo borraba de la PANTALLA y no
	 * del modelo: no había nada que guardar y al recargar reaparecía.
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
		const { subUnitId } = objetivo;

		const hoja = (ctx.getWorkbook() as any)?.getSheetBySheetId?.(subUnitId);
		const rangos: IRange[] =
			params.ranges && params.ranges.length
				? params.ranges
				: [hoja?.getActiveRange?.()?.getRange?.()].filter(Boolean);
		if (!rangos.length) return;

		for (const rango of rangos) {
			handleRangeChange(ctx, subUnitId, rango, null, true);
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

function handleRangeChange(
	ctx: IngresosAdapterContext,
	subUnitId: string | undefined,
	range: IRange | undefined,
	valorCrudo: any,
	/**
	 * La edición es un BORRADO (Supr). Cambia una sola cosa: un `null` deja de
	 * significar «no se pudo leer el valor» y pasa a significar «vacíala», así
	 * que las celdas con binding vuelven a su valor de partida en vez de
	 * ignorarse.
	 */
	esBorrado = false
) {
	if (!range || !subUnitId) return;

	const mes = ctx.resolveMes(subUnitId);
	if (!mes) return;

	const fWorkbook = ctx.getWorkbook();
	if (!fWorkbook) return;
	// Se localiza la hoja del comando por id. SIN fallback a `getActiveSheet()`:
	// el id ya viene resuelto y un fallback aquí podría leer la otra hoja.
	const sheet = (fWorkbook as any).getSheetBySheetId?.(subUnitId) ?? null;

	const estado = ctx.getState(mes);
	let filas = estado.filas;
	let conceptos = estado.conceptos;
	let cambiado = false;
	/// Servicios cuyo INCLUIR cambió: hay que llevarlo a la otra hoja.
	const cambiosIncluir: Array<{ itemId: string; incluir: boolean }> = [];

	for (let r = range.startRow; r <= range.endRow; r++) {
		for (let c = range.startColumn; c <= range.endColumn; c++) {
			const binding = getIngresosBinding(ctx.unitId, subUnitId, r, c);

			// ── AQUÍ SE DECIDE EL DESTINO DE LA CELDA ──────────────────────
			// Con binding, el valor va a su campo en la base y entra en los
			// recálculos. Sin binding solo puede ser zona libre (el permission ya
			// rechazó todo lo demás): es una ANOTACIÓN, se guarda en
			// `canvas_anotacion` y no toca ningún total.
			const ancla = binding ? null : anclaDe(ctx.unitId, subUnitId, r, c);
			if (!binding && !ancla) continue;

			let nuevo: any = null;
			// En un borrado la celda ya está vacía y el comando no trae valor: no
			// hay nada que leer, `null` ES el valor nuevo.
			if (!esBorrado && sheet?.getRange) {
				const cellData: ICellData | null = sheet.getRange(r, c).getCellData();
				nuevo = cellData?.v;
			}
			if (!esBorrado && nuevo == null && valorCrudo != null) {
				if (Array.isArray(valorCrudo) && Array.isArray(valorCrudo[0])) {
					nuevo = (valorCrudo as ICellData[][])[r - range.startRow]?.[
						c - range.startColumn
					]?.v;
				} else if (Array.isArray(valorCrudo)) {
					nuevo = (valorCrudo as ICellData[])[r - range.startRow]?.v;
				} else if (typeof valorCrudo === 'object') {
					nuevo = (valorCrudo as ICellData).v;
				} else {
					nuevo = valorCrudo;
				}
			}

			// Una anotación vaciada se borra, así que aquí `null` es un valor
			// válido y no un «no hubo cambio» como en las celdas con binding.
			if (ancla) {
				ctx.onAnotacion?.({
					mes,
					sheetKey: ctx.sheetKeyDe?.(subUnitId) ?? '',
					ancla,
					valor: nuevo == null ? null : String(nuevo)
				});
				continue;
			}
			if (!binding) continue;
			// Vaciar la celda de INCLUIR (Supr) NO es «no hubo cambio»: es
			// desmarcarla. Sin esta salida el valor se queda vacío, Univer deja
			// de pintar el checkbox —solo lo dibuja si la celda vale uno de los
			// dos valores de la regla— y por dentro la fila sigue marcada.
			const esIncluir =
				binding.entityType === 'fila' && binding.field === 'incluir_adicional';
			if (nuevo == null && !esIncluir && !esBorrado) continue;

			if (binding.entityType === 'fila') {
				const antes = filas.find((f) => f.liquidacion_tercero_id === binding.entityId);
				filas = aplicarCampoFila(filas, binding.entityId, binding.field, nuevo);
				cambiado = true;
				if (binding.field === 'incluir_adicional') {
					const despues = filas.find(
						(f) => f.liquidacion_tercero_id === binding.entityId
					);
					// Solo si de verdad cambió: reescribir «SÍ» sobre un «SÍ» no
					// justifica tocar la otra hoja ni anunciar nada.
					if ((antes?.incluir_adicional ?? false) !== despues?.incluir_adicional) {
						cambiosIncluir.push({
							itemId: binding.entityId,
							incluir: despues?.incluir_adicional === true
						});
					}
				}
			} else if (binding.entityType === 'concepto') {
				conceptos = aplicarCampoConcepto(conceptos, binding.entityId, binding.field, nuevo);
				cambiado = true;
			}
		}
	}

	if (!cambiado) return;
	ctx.setState?.(mes, { filas, conceptos });
	if (cambiosIncluir.length) ctx.onIncluirCambiado?.(mes, cambiosIncluir);
}

/**
 * Lee una celda de acción (INCLUIR) como booleano.
 *
 * La celda vale `SÍ`/`NO` —y no un booleano crudo, que Univer renderiza como
 * "true"/"false"—. Desde que la columna lleva un checkbox de validación de
 * datos (ver `colgarCheckboxIncluir`), esos dos son los ÚNICOS valores que
 * escribe el toggle, así que el resto de formas que se aceptan aquí son para
 * lo que ya hubiera en hojas viejas o llegue pegado desde fuera. Se
 * normalizan acento y mayúsculas: `SI` sin tilde vale igual que `SÍ`.
 *
 * Vacío = NO, que es lo que hace que borrar la celda desmarque la fila en vez
 * de dejarla en un estado sin checkbox.
 */
function leerBooleano(raw: any): boolean {
	if (typeof raw === 'boolean') return raw;
	if (typeof raw === 'number') return raw === 1;
	const t = String(raw ?? '')
		.trim()
		.toUpperCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return t === 'SI' || t === 'TRUE' || t === '1' || t === 'X';
}

/**
 * Aplica una edición sobre la capa de decisiones de un servicio.
 *
 * La fila puede no existir todavía: solo se crean para los servicios que
 * alguien toca, así que la primera edición sobre un servicio la MATERIALIZA
 * con los valores por defecto.
 */
function aplicarCampoFila(
	filas: FilaIngresoEstado[],
	itemId: string,
	field: string,
	raw: any
): FilaIngresoEstado[] {
	const idx = filas.findIndex((f) => f.liquidacion_tercero_id === itemId);
	const actual: FilaIngresoEstado =
		idx >= 0
			? { ...filas[idx] }
			: {
					liquidacion_tercero_id: itemId,
					incluir_adicional: false,
					cantidad: 1
				};

	switch (field) {
		case 'incluir_adicional':
			actual.incluir_adicional = leerBooleano(raw);
			break;
		case 'cantidad':
			actual.cantidad = numeroDeCelda(raw) ?? 1;
			break;
		case 'valor_unitario_adicional':
			// `null` explícito, NO cero: vaciar la celda devuelve la fila al
			// porcentaje de ganancia, mientras que un cero la deja valiendo cero.
			actual.valor_unitario_adicional = numeroDeCelda(raw);
			break;
		default:
			return filas;
	}

	const out = [...filas];
	if (idx >= 0) out[idx] = actual;
	else out.push(actual);
	return out;
}

function aplicarCampoConcepto(
	conceptos: ConceptoIngreso[],
	id: string,
	field: string,
	raw: any
): ConceptoIngreso[] {
	const idx = conceptos.findIndex((c) => c.id === id);
	if (idx < 0) return conceptos;
	const next: ConceptoIngreso = { ...conceptos[idx] };

	switch (field) {
		case 'valor_total':
			next.valor_total = numeroDeCelda(raw) ?? 0;
			break;
		case 'porcentaje':
			next.porcentaje = numeroDeCelda(raw) ?? 0;
			break;
		/**
		 * Renombrar una fila libre de PRÉSTAMOS Y PAGO HORAS EXTRAS.
		 *
		 * Se corta a 100 caracteres porque la columna es `VarChar(100)`: pasarse
		 * hacía fallar el guardado ENTERO de la hoja, no solo esa celda. Y no se
		 * permite vaciarla: el backend descarta los conceptos sin nombre y su
		 * barrido de sobrantes borraría la fila sin que nadie lo pidiera.
		 */
		case 'concepto': {
			const texto = String(raw ?? '').trim().slice(0, 100);
			if (!texto) return conceptos;
			next.concepto = texto;
			break;
		}
		default:
			return conceptos;
	}

	const out = [...conceptos];
	out[idx] = next;
	return out;
}
