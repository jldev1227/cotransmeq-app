/**
 * Adapter ocasional: eventos de Univer → mutaciones en el modelo ocasional.
 *
 * Trabaja sobre el libro ANUAL de 12 hojas. El MES se resuelve siempre a
 * partir del `subUnitId` del comando, nunca de la hoja activa: un paste o
 * un undo pueden dirigirse a una hoja que no está en pantalla, y resolver
 * por hoja activa escribiría en el mes equivocado.
 *
 * DIFERENCIAS vs `cell-change-to-service.ts` (cierre final):
 *  1. Los bindings usan IDs de dominio estables (`itemId`, `conceptoId`,
 *     `adicionalId`) en lugar de índices posicionales (`conceptoIdx`).
 *  2. NO escucha `sheet.command.set-style` (estilo no debe disparar
 *     autosave ni remount).
 *
 * El adapter notifica al consumer con `setState(mes, next)` — un solo
 * callback por edición para evitar rerenders múltiples. La persistencia la
 * decide el consumer, con un ciclo de autoguardado POR MES.
 */

import type {
	IDisposable,
	ICommandInfo,
	IRange,
	ICommandService,
	ICellData
} from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { getOcasionalBinding } from '../../business/ocasional-cell-binding';
import { anclaDe, type Ancla } from '../../business/zona-libre';
import { recomputeTaxes, ensureImpuestos } from '../../business/ocasional-taxes';
import { alcanceOcasional } from '../../business/id-sintetico';
import { numeroDeCelda } from '../../business/numero-de-celda';
import type {
	ItemOcasional,
	AdicionalOcasional,
	ConceptoOcasional
} from '$lib/api/liquidaciones-terceros-ocasional';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
/**
 * Borrar con Supr NO pasa por `set-range-values`: Univer emite su propio
 * comando. Sin escucharlo, el contenido desaparecía de la pantalla pero no se
 * guardaba nada — al recargar volvía a estar.
 */
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';
const REMOVE_ROW = 'sheet.command.remove-row';
const SET_WORKSHEET_ACTIVE = 'sheet.command.set-worksheet-active';

/**
 * Comandos estructurales que romperían el layout fijo del libro.
 *
 * NOTA: esto es solo observabilidad — el handler es `onCommandExecuted`,
 * que corre DESPUÉS de ejecutar. El bloqueo real lo hace
 * `cell-permission-ocasional` vía `interceptBeforeCommand`.
 *
 * `set-worksheet-active` y `set-sheet-hidden` NO están aquí: con 12 hojas,
 * cambiar de mes es navegación legítima.
 */
const BLOCKED_COMMANDS = new Set<string>([
	'sheet.command.insert-row',
	// Los ids son los REALES de Univer 0.25.1. Los que había antes
	// (`delete-row`, `delete-column`) no existen, así que este Set no llegaba a
	// avisar de nada. `remove-row` NO está en la lista: eliminar filas de items
	// es una acción legítima y la maneja `onRemoveRow`.
	'sheet.command.insert-col',
	'sheet.command.remove-col',
	'sheet.command.add-sheet',
	'sheet.command.remove-sheet',
	'sheet.command.move-sheet',
	'sheet.command.apply-merge',
	'sheet.command.cancel-merge'
]);

export interface OcasionalAdapterState {
	items: ItemOcasional[];
	adicionales: AdicionalOcasional[];
	conceptos: ConceptoOcasional[];
}

export interface OcasionalAdapterContext {
	unitId: string;
	/// Año del libro. Con el mes forma el alcance de los ids sintéticos.
	anio: number;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `subUnitId` → mes (1..12), o `null` si la hoja no es de este libro. */
	resolveMes: (sheetId: string) => number | null;

	/** Estado del MES indicado. */
	getState: (mes: number) => OcasionalAdapterState;
	/** Reemplaza el estado del MES indicado. */
	setState?: (mes: number, next: OcasionalAdapterState) => void;
	/**
	 * `true` mientras se pinta una edición llegada de otro usuario. Sin esta
	 * guarda, el `setValue` del patch remoto dispara `set-range-values`,
	 * este adapter lo tomaría por edición local y lo reemitiría — bucle de
	 * eco infinito entre los clientes conectados.
	 */
	isApplyingRemote?: () => boolean;
	/** Notifica que el usuario cambió de mes (para sincronizar `?mes=`). */
	onActiveSheetChange?: (mes: number) => void;
	/**
	 * El usuario escribió en la ZONA LIBRE: una anotación, no un campo de la
	 * base de datos. La page la manda por socket para que la vea el resto.
	 *
	 * `valor: null` significa que vació la celda, es decir borró la nota.
	 */
	onAnotacion?: (a: {
		mes: number;
		sheetKey: string;
		ancla: Ancla;
		valor: string | null;
	}) => void;
	/**
	 * El usuario eliminó filas de la tabla de items. Llega con los ids ya
	 * resueltos; la page los quita del modelo, fuerza el guardado y remonta la
	 * hoja (la geometría cambió y las fórmulas del pie se desplazan).
	 */
	onFilasEliminadas?: (mes: number, itemIds: string[]) => void;
	/**
	 * Hoja → `sheet_key` de la anotación. En los libros anuales es '' (el mes
	 * ya identifica la hoja); en cierres finales es el id del cierre.
	 */
	sheetKeyDe?: (sheetId: string) => string;
}

export function attachOcasionalCellChangeAdapter(
	ctx: OcasionalAdapterContext
): () => void {
	const disposables: IDisposable[] = [];

	// ─── 1) Observar comandos estructurales y cambios de hoja ────
	const onCmdExecuted = (info: Readonly<ICommandInfo>) => {
		if (BLOCKED_COMMANDS.has(info.id)) {
			console.warn('[ocasional-adapter] comando estructural detectado:', info.id);
			return;
		}
		if (info.id === SET_WORKSHEET_ACTIVE && ctx.onActiveSheetChange) {
			const params = info.params as { unitId?: string; subUnitId?: string } | undefined;
			if (params?.unitId && params.unitId !== ctx.unitId) return;
			const mes = params?.subUnitId ? ctx.resolveMes(params.subUnitId) : null;
			if (mes) ctx.onActiveSheetChange(mes);
		}
	};
	disposables.push(ctx.commandService.onCommandExecuted(onCmdExecuted));

	// ─── 2) Interceptar ediciones de celdas ─────────────────────
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
		if (params.unitId !== ctx.unitId) return;
		handleRangeChange(ctx, params.subUnitId, params.range, params.value);
	};
	disposables.push(ctx.commandService.onCommandExecuted(onValueChange));

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
		const params = (info.params ?? {}) as { unitId?: string; subUnitId?: string; ranges?: IRange[] };
		if (params.unitId && params.unitId !== ctx.unitId) return;

		const wb = ctx.getWorkbook() as any;
		const hoja = params.subUnitId
			? wb?.getSheetBySheetId?.(params.subUnitId)
			: wb?.getActiveSheet?.();
		const subUnitId = params.subUnitId ?? hoja?.getSheetId?.();
		if (!subUnitId) return;
		const mes = ctx.resolveMes(subUnitId);
		if (!mes) return;

		const rangos: IRange[] =
			params.ranges && params.ranges.length
				? params.ranges
				: [hoja?.getActiveRange?.()?.getRange?.()].filter(Boolean);
		if (!rangos.length) return;

		for (const rango of rangos) {
			for (let r = rango.startRow; r <= rango.endRow; r++) {
				for (let c = rango.startColumn; c <= rango.endColumn; c++) {
					if (getOcasionalBinding(ctx.unitId, subUnitId, r, c)) continue;
					const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
					if (!ancla) continue;
					ctx.onAnotacion?.({
						mes,
						sheetKey: ctx.sheetKeyDe?.(subUnitId) ?? '',
						ancla,
						valor: null
					});
				}
			}
		}
	};
	disposables.push(ctx.commandService.onCommandExecuted(onClear));

	/**
	 * Eliminar filas de la tabla de items.
	 *
	 * Va en `beforeCommandExecuted` y no en `onCommandExecuted` por una razón
	 * concreta: el mapa fila→item lo registra el builder al pintar la hoja y no
	 * se mueve cuando Univer quita una fila. Después del comando, los índices
	 * del rango ya no significan lo mismo que el mapa y se resolvería el item
	 * equivocado. Antes, ambos hablan del mismo layout.
	 *
	 * No se puede vetar desde aquí, ni hace falta: el borrado es lo que el
	 * usuario pidió. Basta con enterarse a tiempo de QUÉ se está borrando.
	 */
	const onRemoveRow = (info: Readonly<ICommandInfo>) => {
		if (info.id !== REMOVE_ROW) return;
		if (ctx.isApplyingRemote?.()) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			range?: IRange;
			ranges?: IRange[];
		};
		if (params.unitId && params.unitId !== ctx.unitId) return;

		const wb = ctx.getWorkbook() as any;
		const hoja = params.subUnitId
			? wb?.getSheetBySheetId?.(params.subUnitId)
			: wb?.getActiveSheet?.();
		const subUnitId = params.subUnitId ?? hoja?.getSheetId?.();
		if (!subUnitId) return;
		const mes = ctx.resolveMes(subUnitId);
		if (!mes) return;

		// Univer acepta el rango por parámetro o, si no viene, borra la
		// selección viva (ver `RemoveRowCommand` en @univerjs/sheets).
		const rangos: IRange[] = params.ranges?.length
			? params.ranges
			: params.range
				? [params.range]
				: [hoja?.getActiveRange?.()?.getRange?.()].filter(Boolean);
		if (!rangos.length) return;

		const ids = new Set<string>();
		for (const rango of rangos) {
			for (let r = rango.startRow; r <= rango.endRow; r++) {
				// Columna 0: cualquiera de la fila sirve, el ancla de item es de
				// fila entera. La 0 es la única que no desaparece si mañana se
				// quitan columnas de la tabla.
				const ancla = anclaDe(ctx.unitId, subUnitId, r, 0);
				if (ancla?.tipo === 'item' && ancla.ref) ids.add(ancla.ref);
			}
		}
		if (ids.size === 0) return;

		const estado = ctx.getState(mes);
		const items = estado.items.filter((i) => !ids.has(String(i.id)));
		if (items.length === estado.items.length) return;

		// Los impuestos se calculan sobre los items: al irse uno, la base
		// imponible cambia y hay que rehacerla antes de guardar.
		const alcance = alcanceOcasional(ctx.anio, mes);
		let conceptos = ensureImpuestos(estado.conceptos, alcance);
		conceptos = recomputeTaxes(items, conceptos);

		ctx.setState?.(mes, { items, adicionales: estado.adicionales, conceptos });
		ctx.onFilasEliminadas?.(mes, [...ids]);
	};
	disposables.push(ctx.commandService.beforeCommandExecuted(onRemoveRow));

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
	ctx: OcasionalAdapterContext,
	subUnitId: string | undefined,
	range: IRange | undefined,
	_value: any
) {
	if (!range || !subUnitId) return;

	const mes = ctx.resolveMes(subUnitId);
	if (!mes) return;

	const fWorkbook = ctx.getWorkbook();
	if (!fWorkbook) return;

	// Localizar la hoja del comando por id. Sin fallback a `getActiveSheet()`:
	// con 12 hojas ese fallback leería valores del mes equivocado.
	const sheet = (fWorkbook as any).getSheetBySheetId?.(subUnitId) ?? null;

	const initialState = ctx.getState(mes);
	let { items, adicionales, conceptos } = initialState;
	let changed = false;

	for (let r = range.startRow; r <= range.endRow; r++) {
		for (let c = range.startColumn; c <= range.endColumn; c++) {
			const binding = getOcasionalBinding(ctx.unitId, subUnitId, r, c);

			// ── AQUÍ SE DECIDE EL DESTINO DE LA CELDA ──────────────────────
			// Con binding, el valor va a su campo en la base de datos y entra
			// en los recálculos. Sin binding solo puede ser zona libre (el
			// permission ya rechazó todo lo demás): es una ANOTACIÓN, se
			// guarda en `canvas_anotacion` y no toca ni un total.
			const ancla = binding ? null : anclaDe(ctx.unitId, subUnitId, r, c);
			const esAnotacion = !!ancla;
			if (!binding && !esAnotacion) continue;

			let newVal: any = null;
			if (sheet?.getRange) {
				const cellData: ICellData | null = sheet.getRange(r, c).getCellData();
				newVal = cellData?.v;
			}
			if (newVal == null && _value != null) {
				if (Array.isArray(_value) && Array.isArray(_value[0])) {
					newVal = (_value as ICellData[][])[r - range.startRow]?.[c - range.startColumn]?.v;
				} else if (Array.isArray(_value)) {
					newVal = (_value as ICellData[])[r - range.startRow]?.v;
				} else if (typeof _value === 'object') {
					newVal = (_value as ICellData).v;
				} else {
					newVal = _value;
				}
			}
			// Una anotación vaciada se borra, así que aquí `null` es un valor
			// válido y no un «no hubo cambio» como en las celdas con binding.
			if (ancla) {
				ctx.onAnotacion?.({
					mes,
					sheetKey: ctx.sheetKeyDe?.(subUnitId) ?? '',
					ancla,
					valor: newVal == null ? null : String(newVal)
				});
				continue;
			}

			if (newVal == null) continue;
			if (!binding) continue;

			if (binding.entityType === 'item') {
				items = applyItemField(items, binding.entityId, binding.field, newVal);
				changed = true;
			} else if (binding.entityType === 'adicional') {
				adicionales = applyAdicionalField(
					adicionales,
					binding.entityId,
					binding.field,
					newVal
				);
				changed = true;
			} else if (binding.entityType === 'concepto') {
				conceptos = applyConceptoField(
					conceptos,
					binding.entityId,
					binding.field,
					newVal
				);
				changed = true;
			}
		}
	}

	if (!changed) return;

	// Impuestos recalculados SOLO con los items de este mes: la base
	// imponible de marzo no puede contaminar la de abril.
	conceptos = ensureImpuestos(conceptos, alcanceOcasional(ctx.anio, mes));
	conceptos = recomputeTaxes(items, conceptos);

	console.debug('[ocasional-adapter] recompute tras edición', {
		mes,
		range,
		impuestos: conceptos
			.filter((c) => c.tipo === 'IMPUESTO')
			.map((c) => ({
				concepto: c.concepto,
				porcentaje: c.porcentaje,
				base_calculo: c.base_calculo,
				valor_total: c.valor_total
			}))
	});

	if (ctx.setState) {
		ctx.setState(mes, { items, adicionales, conceptos });
	}

	// El autosave por socket (`realtimeCollab.enqueueOcasional*Changes`) se
	// eliminó aquí a propósito. Dos motivos:
	//
	//  1. Nunca funcionó: el gateway ramifica en
	//     `table === 'liquidacion-tercero-mensual'` mientras el cliente emite
	//     `'liquidacion-tercero-ocasional'`, así que esa rama es inalcanzable
	//     y los `row:save` solo llenaban una cola hasta el timeout de 5 s.
	//  2. `realtimeCollab` es un singleton de UNA sola room, sin noción de
	//     mes. Con 12 hojas, editar marzo y luego abril dentro de la ventana
	//     de 800 ms del debounce guardaría los datos de abril bajo la
	//     cabecera de marzo.
	//
	// La persistencia la lleva el consumer, con un ciclo de autoguardado por
	// mes contra la cabecera de ese mes (`@@unique([mes, anio])` en BD).
}

/**
 * Lee una celda de acción (APLICA IMP. / EXCLUIDO) como booleano.
 *
 * El builder las pinta como `SÍ`/`NO` —igual que el canvas de cierres— porque
 * Univer renderiza un booleano crudo como "true"/"false" y porque el pie usa
 * `SUMIF(...,"NO",...)`. Aquí se acepta además el formato viejo (`true`/`1`)
 * para no romper ediciones en vuelo, y se normaliza el acento y las mayúsculas
 * porque el usuario escribe la celda a mano.
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

function applyItemField(
	items: ItemOcasional[],
	id: string,
	field: string,
	raw: any
): ItemOcasional[] {
	const idx = items.findIndex((i) => i.id === id);
	if (idx < 0) return items;
	const cur = items[idx];
	let next: ItemOcasional = { ...cur };
	switch (field) {
		case 'aplica_impuestos':
			next.aplica_impuestos = leerBooleano(raw);
			break;
		case 'valor_unitario':
			next.valor_unitario = numeroDeCelda(raw) ?? 0;
			break;
		case 'cantidad':
			next.cantidad = numeroDeCelda(raw) ?? 1;
			break;
		default:
			return items; // campo no editable
	}
	const out = [...items];
	out[idx] = next;
	return out;
}

function applyAdicionalField(
	adicionales: AdicionalOcasional[],
	id: string,
	field: string,
	raw: any
): AdicionalOcasional[] {
	const idx = adicionales.findIndex((a) => a.id === id);
	if (idx < 0) return adicionales;
	const cur = adicionales[idx];
	let next: AdicionalOcasional = { ...cur };
	switch (field) {
		case 'valor_unitario':
			next.valor_unitario = numeroDeCelda(raw) ?? 0;
			break;
		case 'cantidad':
			next.cantidad = numeroDeCelda(raw) ?? 1;
			break;
		case 'aplica_impuestos':
			next.aplica_impuestos = leerBooleano(raw);
			break;
		default:
			return adicionales;
	}
	const out = [...adicionales];
	out[idx] = next;
	return out;
}

function applyConceptoField(
	conceptos: ConceptoOcasional[],
	id: string,
	field: string,
	raw: any
): ConceptoOcasional[] {
	const idx = conceptos.findIndex((c) => c.id === id);
	if (idx < 0) return conceptos;
	const cur = conceptos[idx];
	let next: ConceptoOcasional = { ...cur };
	switch (field) {
		case 'dias':
			next.dias = numeroDeCelda(raw) ?? 0;
			next.valor_total = (next.dias ?? 0) * (Number(next.valor_unitario) || 0);
			break;
		case 'valor_unitario':
			next.valor_unitario = numeroDeCelda(raw) ?? 0;
			next.valor_total = (Number(next.dias) || 0) * (Number(next.valor_unitario) || 0);
			break;
		case 'porcentaje':
			next.porcentaje = numeroDeCelda(raw) ?? 0;
			if (next.base_calculo) {
				next.valor_total = (Number(next.base_calculo) || 0) * (Number(next.porcentaje) || 0) / 100;
			}
			break;
		case 'valor_total':
			next.valor_total = numeroDeCelda(raw) ?? 0;
			break;
		/**
		 * Renombrar una fila de gasto añadida a mano.
		 *
		 * Se corta a 100 caracteres porque la columna es `VarChar(100)`: pasarse
		 * hacía fallar el guardado ENTERO de la hoja, no solo esa celda.
		 *
		 * Vaciar el nombre NO borra la fila: el backend descarta los conceptos
		 * sin `concepto` y su barrido de sobrantes la eliminaría de la base sin
		 * que nadie lo pidiera. Para quitarla está el botón de la lista de
		 * gastos, que avisa.
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
