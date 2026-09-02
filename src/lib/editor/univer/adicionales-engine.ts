/**
 * Engine Univer para el canvas **Adicionales de cierres finales de
 * terceros**. Wrapper minimal sobre `createLiquidacionEngine` que pasa el
 * libro ANUAL generado por `buildAdicionalesAnualWorkbook`.
 *
 * Layout: 12 hojas (una por mes del año) con `sheetBar: true`, para que el
 * usuario navegue entre meses desde la propia barra de Univer. Mantenemos
 * `statisticBar` y `zoomSlider` para una UX tipo Excel.
 */

import type { AdicionalListado } from '$lib/api/liquidaciones-terceros-adicionales';
import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext,
	type EngineOptions
} from './engine';
export type { EngineContext };
import {
	buildAdicionalesAnualWorkbook,
	adicionalesSheetId
} from '../builders/adicionales.builder';
import { activarHoja } from './activar-hoja';

export interface AdicionalesEngineOptions {
	container: HTMLElement;
	anio: number;
	/** Items por mes, claves 1..12. Meses ausentes → hoja vacía. */
	itemsPorMes: Record<number, AdicionalListado[]>;
	/** Mes (1..12) que debe quedar activo al montar. Default: 1. */
	mesActivo?: number;	/// Notas libres, tal y como las devuelve `canvasAnotacionesAPI`.
	anotaciones?: Record<number, Record<string, any[]>>;
	/// Porcentajes de prestaciones/seguridad social, `concepto → %`.
	porcentajesLaborales?: Record<string, number>;
	/// Días por defecto de las filas de salarios, `concepto → días`.
	diasLaborales?: Record<string, number>;
}

export interface AdicionalesEngineContext extends EngineContext {
	unitId: string;
	sheetIdPorMes: Record<number, string>;
	/** Cambia la hoja activa SIN remontar el engine. */
	activarMes: (mes: number) => void;
	/** Resuelve el mes a partir del `subUnitId` de un comando de Univer. */
	resolveMes: (sheetId: string) => number | null;
}

export function createAdicionalesEngine(
	opts: AdicionalesEngineOptions
): AdicionalesEngineContext {
	const { workbook, unitId, sheetIdPorMes } = buildAdicionalesAnualWorkbook({
		anotaciones: opts.anotaciones,
		porcentajesLaborales: opts.porcentajesLaborales,
		diasLaborales: opts.diasLaborales,
		anio: opts.anio,
		itemsPorMes: opts.itemsPorMes
	});

	const engineOpts: EngineOptions = {
		container: opts.container,
		workbookData: workbook,
		footer: {
			// Con 12 hojas la sheet bar es la navegación principal entre meses.
			sheetBar: true,
			statisticBar: true,
			zoomSlider: true,
			menus: false
		}
	};

	const ctx = createLiquidacionEngine(engineOpts);

	// Índice inverso sheetId → mes, para que el adapter resuelva a qué mes
	// pertenece un `set-range-values` sin depender de la hoja activa.
	const mesPorSheetId = new Map<string, number>();
	for (const [mes, sheetId] of Object.entries(sheetIdPorMes)) {
		mesPorSheetId.set(sheetId, Number(mes));
	}

	const activarMes = (mes: number) => {
		const sheetId = sheetIdPorMes[mes];
		if (!sheetId) return;
		activarHoja(ctx, sheetId);
	};

	const mesActivo = opts.mesActivo ?? 1;
	if (mesActivo !== 1) activarMes(mesActivo);

	return {
		...ctx,
		unitId,
		sheetIdPorMes,
		activarMes,
		resolveMes: (sheetId: string) => mesPorSheetId.get(sheetId) ?? null
	};
}

export { disposeEngine, adicionalesSheetId };
