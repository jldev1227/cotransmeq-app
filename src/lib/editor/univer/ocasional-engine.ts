/**
 * Engine ocasional — wrapper sobre `createLiquidacionEngine` que pasa el
 * libro ANUAL generado por `buildOcasionalAnualWorkbook`.
 *
 * Layout: 12 hojas (una por mes del año) con `sheetBar: true`, para que el
 * usuario navegue entre meses desde la propia barra de Univer. Mantenemos
 * `statisticBar` y `zoomSlider` para una UX tipo Excel.
 *
 * Una hoja = una cabecera `liquidacion_tercero_ocasional` (la tabla es
 * `@@unique([mes, anio])`), por eso el engine devuelve `cabeceraIdPorMes`:
 * es lo que permite que cada hoja guarde contra su propio registro.
 */

import type {
	ItemOcasional,
	AdicionalOcasional,
	ConceptoOcasional,
	LiquidacionOcasional
} from '$lib/api/liquidaciones-terceros-ocasional';
import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext,
	type EngineOptions
} from './engine';

export type { EngineContext };
import {
	buildOcasionalAnualWorkbook,
	ocasionalSheetId,
	type OcasionalMesInput
} from '../builders/ocasional.builder';
import { activarHoja } from './activar-hoja';

export type { OcasionalMesInput };

export interface OcasionalEngineOptions {
	container: HTMLElement;
	anio: number;
	meses: OcasionalMesInput[];
	/** Mes (1..12) que debe quedar activo al montar. Default: 1. */
	mesActivo?: number;
	/// Notas libres por mes, tal y como las devuelve `canvasAnotacionesAPI`.
	anotaciones?: Record<number, Record<string, any[]>>;
}

export interface OcasionalEngineContext extends EngineContext {
	unitId: string;
	sheetIdPorMes: Record<number, string>;
	cabeceraIdPorMes: Record<number, string | null>;
	/** Cambia la hoja activa SIN remontar el engine. */
	activarMes: (mes: number) => void;
	/** Resuelve el mes a partir del `subUnitId` de un comando de Univer. */
	resolveMes: (sheetId: string) => number | null;
}

export function createOcasionalEngine(
	opts: OcasionalEngineOptions
): OcasionalEngineContext {
	const { workbook, unitId, sheetIdPorMes, cabeceraIdPorMes } =
		buildOcasionalAnualWorkbook({
			anio: opts.anio,
			meses: opts.meses,
			anotaciones: opts.anotaciones
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
		cabeceraIdPorMes,
		activarMes,
		resolveMes: (sheetId: string) => mesPorSheetId.get(sheetId) ?? null
	};
}

export { disposeEngine, ocasionalSheetId };
export type { LiquidacionOcasional, ItemOcasional, AdicionalOcasional, ConceptoOcasional };
