/**
 * Engine del canvas de historial de liquidaciones de servicios.
 *
 * Envoltorio delgado sobre `createLiquidacionEngine`, igual que
 * `cierres-finales-engine.ts`. Es mucho más simple que sus hermanos porque la
 * hoja es de solo lectura: no hay bindings de celda, ni sesión de socket, ni
 * cola de escritura. Lo único que aporta sobre la fábrica común es resolver el
 * `sheetId` real —`createWorkbook` no garantiza respetar el id que le pasamos—
 * y exponer helpers para repintar celdas sueltas tras una acción del carril.
 */

import type { IStyleData } from '@univerjs/core';
import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext
} from './engine';
import {
	buildHistorialServiciosWorkbook,
	type HistorialWorkbook
} from '../builders/servicios-historial.builder';
import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';

export { disposeEngine };

export interface HistorialEngineContext extends EngineContext {
	/// Id real de la hoja tras `createWorkbook`.
	sheetId: string;
	/// Índices producidos por el builder.
	modelo: HistorialWorkbook;
	/// Escribe una celda concreta (valor + estilo). Para repintes puntuales.
	pintarCelda: (fila: number, columna: number, valor: string | number, estilo: IStyleData) => void;
}

export function createHistorialEngine(opts: {
	container: HTMLElement;
	liquidaciones: LiquidacionServicio[];
}): HistorialEngineContext {
	const modelo = buildHistorialServiciosWorkbook(opts.liquidaciones);

	const ctx = createLiquidacionEngine({
		container: opts.container,
		workbookData: modelo.workbook,
		// Footer tipo Excel: la barra de estadísticas de selección es útil aquí
		// (seleccionas un bloque de TOTAL y ves la suma sin sacar calculadora).
		// La sheet bar no, porque solo hay una hoja.
		footer: { sheetBar: false, statisticBar: true, zoomSlider: true, menus: false }
	});

	/// `createWorkbook` puede renombrar el id de la hoja. Se resuelve el real
	/// una vez, al montar, en vez de confiar en el que pidió el builder.
	const hoja = ctx.fUniver.getActiveWorkbook()?.getActiveSheet();
	const sheetId = hoja?.getSheetId?.() ?? modelo.sheetId;

	const pintarCelda = (
		fila: number,
		columna: number,
		valor: string | number,
		estilo: IStyleData
	) => {
		const activa = ctx.fUniver.getActiveWorkbook()?.getActiveSheet();
		if (!activa) return;
		const rango = activa.getRange(fila, columna, 1, 1);
		rango.setValue({ v: valor, s: estilo } as any);
	};

	return { ...ctx, sheetId, modelo, pintarCelda };
}
