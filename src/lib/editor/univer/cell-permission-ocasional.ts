/**
 * Permisos a nivel de celda para la liquidación MENSUAL de terceros.
 *
 * DIFERENCIA vs `cell-permission.ts` (cierre final):
 *  - Usa el `ocasional-cell-binding` registry (entityType + entityId +
 *    field) en vez del metadata-store posicional.
 *  - Whitelist de campos editables más pequeña:
 *      • items: aplica_impuestos, valor_unitario, cantidad
 *      • adicionales: valor_unitario, cantidad, aplica_impuestos
 *      • conceptos: dias, valor_unitario, porcentaje, valor_total
 *  - Cualquier celda sin binding queda BLOQUEADA por defecto (default-deny),
 *    SALVO las de la zona libre: las filas bajo el bloque estructurado son
 *    anotables. Lo que se escribe ahí es complemento visual compartido, no
 *    toca ninguna tabla de negocio, y las celdas derivadas (fórmulas, totales,
 *    columnas calculadas) siguen intocables porque quedan por encima.
 */

import {
	IUniverInstanceService,
	type ICommandInfo,
	type IRange,
	type Univer
} from '@univerjs/core';
import { SheetInterceptorService } from '@univerjs/sheets';
// @ts-ignore
import { IEditorBridgeService } from '@univerjs/sheets-ui';
import { getOcasionalBinding } from '../business/ocasional-cell-binding';
import { esCeldaDeCapa } from '../business/zona-libre';

const SET_RANGE_VALUES = 'sheet.command.set-range-values';
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';
/// Borrar con Supr no pasa por `set-range-values`: sin controlarlo aquí, se
/// podía vaciar una etiqueta o un valor derivado y desaparecía de la pantalla
/// hasta recargar.
const CLEAR_CONTENT = 'sheet.command.clear-selection-content';
const CLEAR_ALL = 'sheet.command.clear-selection-all';

const EDITABLE_FIELDS: Set<string> = new Set([
	// items
	'item:aplica_impuestos',
	'item:valor_unitario',
	'item:cantidad',
	// adicionales
	'adicional:valor_unitario',
	'adicional:cantidad',
	'adicional:aplica_impuestos',
	// conceptos
	'concepto:dias',
	'concepto:valor_unitario',
	'concepto:porcentaje',
	'concepto:valor_total',
	// Nombre del concepto. Solo lo tienen bindeado las filas de gasto añadidas
	// a mano: las fijas no registran este campo, así que su etiqueta sigue
	// bloqueada por default-deny.
	'concepto:concepto'
]);

function isEditableBinding(entityType: string, field: string): boolean {
	return EDITABLE_FIELDS.has(`${entityType}:${field}`);
}

export function installOcasionalCellPermission(univer: Univer): () => void {
	const injector = univer.__getInjector();
	const interceptor = injector.get(SheetInterceptorService);
	injector.get(IUniverInstanceService);
	// @ts-ignore
	const editorBridge = injector.get(IEditorBridgeService as any) as {
		getEditLocation(): null | { unitId: string; sheetId: string; row: number; column: number };
	};

	const disposable = interceptor.interceptBeforeCommand({
		priority: 999,
		async performCheck(info: ICommandInfo) {
			const id = info.id;
			const params = (info.params ?? {}) as Record<string, any>;

			// Sin logs por check: este interceptor corre en CADA intento de
			// edición y en cada `set-range-values`. Con 12 hojas y default-deny,
			// loguear aquí inundaba la consola y degradaba el scroll de forma
			// medible. Para depurar, poner un breakpoint en los `return false`.
			if (id === SET_CELL_EDIT_VISIBLE) {
				if (params?.visible !== true) return true;
				const loc = editorBridge.getEditLocation();
				if (!loc) return true;
				const binding = getOcasionalBinding(loc.unitId, loc.sheetId, loc.row, loc.column);
				if (!binding) return esCeldaDeCapa(loc.unitId, loc.sheetId, loc.row, loc.column);
				return isEditableBinding(binding.entityType, binding.field);
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
							const b = getOcasionalBinding(params.unitId, params.subUnitId, r, c);
							if (b) {
								if (!isEditableBinding(b.entityType, b.field)) return false;
								continue;
							}
							if (!esCeldaDeCapa(params.unitId, params.subUnitId, r, c)) return false;
						}
					}
				}
				return true;
			}

			if (id !== SET_RANGE_VALUES) return true;
			if (!params?.unitId || !params?.subUnitId || !params.range) return true;

			const { startRow, endRow, startColumn, endColumn } = params.range as IRange;
			for (let r = startRow; r <= endRow; r++) {
				for (let c = startColumn; c <= endColumn; c++) {
					const binding = getOcasionalBinding(params.unitId, params.subUnitId, r, c);
					if (!binding) {
						if (!esCeldaDeCapa(params.unitId, params.subUnitId, r, c)) return false;
						continue;
					}
					if (!isEditableBinding(binding.entityType, binding.field)) return false;
				}
			}
			return true;
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
