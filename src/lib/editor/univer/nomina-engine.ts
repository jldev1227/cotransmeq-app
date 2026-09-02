/**
 * Engine Univer del canvas de **nómina**.
 *
 * Wrapper sobre `createLiquidacionEngine` con el libro que produce
 * `buildNominaWorkbook`: una hoja por conductor del periodo, en orden
 * alfabético.
 *
 * `sheetBar: true` porque con 30 conductores la barra de pestañas es la
 * navegación principal, igual que en adicionales con sus doce meses.
 */

import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext,
	type EngineOptions
} from './engine';
export type { EngineContext };
import {
	buildNominaWorkbook,
	nominaSheetId,
	type PeriodoNominaDTO
} from '../builders/nomina.builder';
import { colorDeHoja } from '../builders/nomina-estado';
import { activarHoja } from './activar-hoja';
import { clearNominaBindings } from '../business/nomina-cell-binding';
import { repintando } from './cell-permission-nomina';

export interface NominaEngineOptions {
	container: HTMLElement;
	periodo: PeriodoNominaDTO;
	/** Conductor cuya hoja queda activa al montar. */
	conductorActivo?: string;
}

export interface NominaEngineContext extends EngineContext {
	unitId: string;
	sheetIdPorConductor: Record<string, string>;
	conductorPorSheetId: Record<string, string>;
	/** Cambia de hoja SIN remontar el engine. */
	activarConductor: (conductorId: string) => void;
	/** Resuelve el conductor a partir del `subUnitId` de un comando. */
	resolveConductor: (sheetId: string) => string | null;
	/** Estado por hoja, para el permiso de celda y la barra. */
	estadoPorHoja: () => Record<string, string>;
	/** Cambia el estado de una hoja: repinta la pestaña y actualiza el mapa. */
	aplicarEstado: (conductorId: string, estado: string) => void;
}

export function createNominaEngine(opts: NominaEngineOptions): NominaEngineContext {
	// Los bindings de este libro se rehacen enteros: si quedaran los de un
	// montaje anterior, apuntarían a filas que ya no existen y una edición
	// remota escribiría en la celda equivocada.
	const unitIdPrevio = `nomina-${opts.periodo.anio}-${opts.periodo.mes}`;
	clearNominaBindings(unitIdPrevio);

	const { workbook, unitId, sheetIdPorConductor, conductorPorSheetId } = buildNominaWorkbook(
		opts.periodo
	);

	const engineOpts: EngineOptions = {
		container: opts.container,
		workbookData: workbook,
		footer: {
			// Con una hoja por conductor, la barra de pestañas ES la navegación.
			sheetBar: true,
			statisticBar: true,
			zoomSlider: true,
			menus: false
		}
	};

	const ctx = createLiquidacionEngine(engineOpts);

	const estados: Record<string, string> = {};
	for (const hoja of opts.periodo.hojas) {
		estados[sheetIdPorConductor[hoja.conductorId]] = hoja.estado;
	}

	const activarConductor = (conductorId: string) => {
		const sheetId = sheetIdPorConductor[conductorId];
		if (!sheetId) return;
		activarHoja(ctx, sheetId);
	};

	/**
	 * Repinta el color de la pestaña al cambiar el estado.
	 *
	 * Va bajo `repintando()` sin excepción: sin ella, cada repintado
	 * programático se cuenta como edición del usuario, el adapter lo reemite
	 * y se realimenta el bucle. Es la trampa que documentan los otros canvas.
	 */
	const aplicarEstado = (conductorId: string, estado: string) => {
		const sheetId = sheetIdPorConductor[conductorId];
		if (!sheetId) return;
		estados[sheetId] = estado;
		repintando(() => {
			try {
				const wb = ctx.fUniver.getUniverSheet(unitId);
				const hoja = wb?.getSheetBySheetId?.(sheetId);
				hoja?.setTabColor?.(colorDeHoja(estado));
			} catch {
				// Si la API de pestañas cambia entre versiones, el color es lo
				// de menos: la insignia de la barra sigue diciendo el estado.
			}
		});
	};

	if (opts.conductorActivo) activarConductor(opts.conductorActivo);

	return {
		...ctx,
		unitId,
		sheetIdPorConductor,
		conductorPorSheetId,
		activarConductor,
		resolveConductor: (sheetId: string) => conductorPorSheetId[sheetId] ?? null,
		estadoPorHoja: () => ({ ...estados }),
		aplicarEstado
	};
}

export { disposeEngine, nominaSheetId };
