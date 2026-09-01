/**
 * Adapter para el canvas **Adicionales de cierres finales de terceros**
 * (libro ANUAL de 12 hojas, una por mes).
 *
 * Comportamiento:
 *  - Escucha `sheet.command.set-range-values` y resuelve el MES a partir del
 *    `subUnitId` del comando, nunca de la hoja activa.
 *  - Editable: valor_unitario (col C) y cantidad (col D). El resto está
 *    bloqueado por `cell-permission-adicionales` (default-deny).
 *  - Recalcula `valor_admin` y `valor_liquidar` en cliente tras editar
 *    valor_unitario o cantidad, en espejo exacto de las fórmulas vivas que
 *    escribe `adicionales.builder.ts` para esas columnas.
 *  - Notifica al consumer con `setItems(mes, items)`.
 *  - Avisa del cambio de hoja con `onActiveSheetChange(mes)` para que la
 *    página sincronice `?mes=` en la URL.
 */

import { numeroDeCelda } from '../../business/numero-de-celda';
import type {
	IDisposable,
	ICommandInfo,
	IRange,
	ICommandService,
	ICellData
} from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import {
	getAdicionalesBinding,
	type AdicionalBinding
} from '../../business/adicionales-cell-binding';
import type { AdicionalListado } from '$lib/api/liquidaciones-terceros-adicionales';
import { anclaDe, type Ancla } from '../../business/zona-libre';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_WORKSHEET_ACTIVE = 'sheet.command.set-worksheet-active';
/**
 * Borrar con Supr NO pasa por `set-range-values`: Univer emite su propio
 * comando. Sin escucharlo, la nota desaparecía de la pantalla pero no se
 * borraba en el servidor — al recargar volvía a estar.
 */
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

/**
 * Comandos estructurales que romperían el layout fijo del libro.
 *
 * NOTA: hoy esto es solo observabilidad — el handler es `onCommandExecuted`,
 * que corre DESPUÉS de ejecutar. El bloqueo real lo hace
 * `cell-permission-adicionales` vía `interceptBeforeCommand`. Se mantiene la
 * lista para dejar rastro en consola si algo intenta mutar la estructura.
 *
 * `set-worksheet-active` y `set-sheet-hidden` NO están aquí: con 12 hojas,
 * cambiar de mes es navegación legítima.
 */
const BLOCKED_COMMANDS = new Set<string>([
	'sheet.command.insert-row',
	'sheet.command.delete-row',
	'sheet.command.insert-column',
	'sheet.command.delete-column',
	'sheet.command.add-sheet',
	'sheet.command.remove-sheet',
	'sheet.command.move-sheet',
	'sheet.command.apply-merge',
	'sheet.command.cancel-merge'
]);

export interface AdicionalesAdapterContext {
	unitId: string;
	commandService: ICommandService;
	getWorkbook: () => FWorkbook | null;
	/** `subUnitId` → mes (1..12), o `null` si la hoja no es de este libro. */
	resolveMes: (sheetId: string) => number | null;
	getItems: (mes: number) => AdicionalListado[];
	setItems: (mes: number, next: AdicionalListado[]) => void;
	/**
	 * Cambios individuales de la edición, con la versión que la fila tenía
	 * ANTES de aplicarla.
	 *
	 * `setItems` entrega el array completo, que sirve para el estado local
	 * pero no para persistir: el protocolo colaborativo manda un patch por
	 * celda con `base_version`, y eso exige saber QUÉ campo cambió y desde
	 * qué versión. Sin `base_version` no hay compare-and-swap y volveríamos
	 * al last-write-wins silencioso.
	 */
	onFieldChange?: (
		mes: number,
		cambios: Array<{
			entityId: string;
			field: string;
			value: string | number | boolean | null;
			baseVersion: number;
		}>
	) => void;
	/**
	 * `true` mientras se está pintando una edición que llegó de otro usuario.
	 * Sin esta guarda, el `setValue` del patch remoto dispara
	 * `set-range-values`, este adapter lo interpretaría como edición local y
	 * lo reemitiría — bucle de eco infinito entre los clientes conectados.
	 */
	isApplyingRemote?: () => boolean;
	/** Notifica que el usuario cambió de mes (para sincronizar `?mes=`). */
	onActiveSheetChange?: (mes: number) => void;
	/**
	 * El usuario escribió en la ZONA LIBRE: una anotación, no un campo de la
	 * base de datos.
	 *
	 * `valor: null` significa que vació la celda, es decir borró la nota.
	 */
	onAnotacion?: (a: { mes: number; ancla: Ancla; valor: string | null }) => void;
}

export function attachAdicionalesCellChangeAdapter(
	ctx: AdicionalesAdapterContext
): () => void {
	const disposables: IDisposable[] = [];

	const onCmdExecuted = (info: Readonly<ICommandInfo>) => {
		if (BLOCKED_COMMANDS.has(info.id)) {
			console.warn('[adicionales-adapter] comando estructural detectado:', info.id);
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

	const onValueChange = (info: Readonly<ICommandInfo>) => {
		if (info.id !== SET_RANGE_VALUES) return;
		// Eco de una edición remota: ya está aplicada en el modelo, no
		// reprocesarla ni reemitirla.
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
					if (getAdicionalesBinding(ctx.unitId, subUnitId, r, c)) continue;
					const ancla = anclaDe(ctx.unitId, subUnitId, r, c);
					if (!ancla) continue;
					ctx.onAnotacion?.({ mes, ancla, valor: null });
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

function handleRangeChange(
	ctx: AdicionalesAdapterContext,
	subUnitId: string | undefined,
	range: IRange | undefined,
	_value: any
) {
	if (!range || !subUnitId) return;

	// El MES sale del `subUnitId` del comando, jamás de la hoja activa: un
	// paste o un undo pueden dirigirse a una hoja que no está en pantalla, y
	// resolverlo por hoja activa escribiría en el mes equivocado.
	const mes = ctx.resolveMes(subUnitId);
	if (!mes) return;

	const fWorkbook = ctx.getWorkbook();
	if (!fWorkbook) return;

	// Localizar la hoja del comando por id. Sin fallback a `getActiveSheet()`:
	// con 12 hojas ese fallback leería valores del mes equivocado.
	const sheet = (fWorkbook as any).getSheetBySheetId?.(subUnitId) ?? null;

	let items = ctx.getItems(mes);
	let changed = false;
	const cambios: Array<{
		entityId: string;
		field: string;
		value: string | number | boolean | null;
		baseVersion: number;
	}> = [];

	for (let r = range.startRow; r <= range.endRow; r++) {
		for (let c = range.startColumn; c <= range.endColumn; c++) {
			const binding: AdicionalBinding | undefined = getAdicionalesBinding(
				ctx.unitId,
				subUnitId,
				r,
				c
			);
			// ── AQUÍ SE DECIDE EL DESTINO DE LA CELDA ──────────────────────
			// Con binding, el valor va a su campo en la base de datos. Sin
			// binding solo puede ser zona libre (el permission ya rechazó todo
			// lo demás): es una ANOTACIÓN, va a `canvas_anotacion` y no toca
			// ninguna tabla de negocio.
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
			// Vaciar una anotación la borra, así que aquí `null` es un valor
			// válido y no un «no hubo cambio» como en las celdas con binding.
			if (ancla) {
				ctx.onAnotacion?.({ mes, ancla, valor: newVal == null ? null : String(newVal) });
				continue;
			}

			if (newVal == null) continue;
			if (!binding) continue;

			// La versión BASE es la que la fila tiene antes de aplicar el
			// cambio: es lo que el servidor comparará en el compare-and-swap.
			const previa = items.find((a) => a.id === binding.entityId);
			if (!previa) continue;

			items = applyAdicionalField(items, binding.entityId, binding.field, newVal);
			cambios.push({
				entityId: binding.entityId,
				field: binding.field,
				value: newVal,
				baseVersion: previa.version ?? 1
			});
			changed = true;
		}
	}

	if (!changed) return;
	ctx.setItems(mes, items);
	if (cambios.length) ctx.onFieldChange?.(mes, cambios);
}

function applyAdicionalField(
	items: AdicionalListado[],
	entityId: string,
	field: string,
	raw: any
): AdicionalListado[] {
	const idx = items.findIndex((a) => a.id === entityId);
	if (idx < 0) return items;
	const cur = items[idx];
	const next: AdicionalListado = { ...cur };
	switch (field) {
		case 'valor_unitario': {
			next.valor_unitario = numeroDeCelda(raw) ?? 0;
			recalcDerived(next);
			break;
		}
		case 'cantidad': {
			next.cantidad = numeroDeCelda(raw) ?? 0;
			recalcDerived(next);
			break;
		}
		default:
			return items;
	}
	const out = [...items];
	out[idx] = next;
	return out;
}

/**
 * Recalcula `valor_admin` y `valor_liquidar`.
 *
 * Espejo EXACTO de las fórmulas vivas que escribe `adicionales.builder.ts`
 * para esas dos columnas (`=ROUND(F*pct/100,0)` y `=F-E`). Si estas dos
 * expresiones divergen, la pantalla y lo que se persiste dejan de coincidir.
 */
function recalcDerived(a: AdicionalListado): void {
	const vUnit = Number(a.valor_unitario) || 0;
	const cant = Number(a.cantidad) || 0;
	const pctAdmin = Number(a.porcentaje_admin) || 0;
	const vLiqBruto = vUnit * cant;
	const vAdmin = Math.round((vLiqBruto * pctAdmin) / 100);
	a.valor_admin = vAdmin;
	a.valor_liquidar = vLiqBruto - vAdmin;
}
