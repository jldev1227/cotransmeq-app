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
	coloresDeRecargos,
	COLOR_RECARGO_NEUTRO,
	nominaSheetId,
	ORDEN_RECARGOS,
	recargoDeFila,
	type PeriodoNominaDTO
} from '../builders/nomina.builder';
import { contraste } from '../builders/colores-canvas';
import { TEXT_DARK } from '../builders/historial-comun';
import { colorDeHoja } from '../builders/nomina-estado';
import { activarHoja } from './activar-hoja';
import { clearNominaBindings } from '../business/nomina-cell-binding';
import { repintando } from './cell-permission-nomina';
import { suprimirEco } from './apply-remote-patch';
import { numeroDeCelda } from '../business/numero-de-celda';
import { colgarCheckboxSiNo } from './checkbox-si-no';

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
	/**
	 * Repinta la franja de recargos de UN día tras editarla.
	 *
	 * `fila` es cualquiera de las siete del bloque —la que se acaba de tocar—;
	 * `columna` es el día. Devuelve `false` si esa fila no es de recargos, para
	 * que el llamador no tenga que saberlo.
	 */
	repintarRecargosDelDia: (sheetId: string, fila: number, columna: number) => boolean;
}

export function createNominaEngine(opts: NominaEngineOptions): NominaEngineContext {
	// Los bindings de este libro se rehacen enteros: si quedaran los de un
	// montaje anterior, apuntarían a filas que ya no existen y una edición
	// remota escribiría en la celda equivocada.
	const unitIdPrevio = `nomina-${opts.periodo.anio}-${opts.periodo.mes}`;
	clearNominaBindings(unitIdPrevio);

	const { workbook, unitId, sheetIdPorConductor, conductorPorSheetId, checkboxPorSheetId } =
		buildNominaWorkbook(
		opts.periodo
	);

	const engineOpts: EngineOptions = {
		container: opts.container,
		workbookData: workbook,
		/// Para los interruptores del ajuste de recargos: sin el preset no
		/// existe `newDataValidation` y las casillas se quedan como texto
		/// SÍ/NO. Es opt-in porque el plugin añade su propia UI.
		dataValidation: true,
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

	/// Colores de las siete franjas, por hoja. Se calculan una vez al montar:
	/// son del tipo de recargo y de la tarifa del conductor, y ninguno de los
	/// dos cambia mientras el libro está abierto.
	const coloresPorHoja: Record<string, Record<string, string>> = {};
	for (const hoja of opts.periodo.hojas) {
		coloresPorHoja[sheetIdPorConductor[hoja.conductorId]] = coloresDeRecargos(hoja);
	}

	/**
	 * Repinta la franja de recargos de un día.
	 *
	 * POR QUÉ EXISTE: el color de estas siete celdas lo decide el BUILDER, y lo
	 * decide una sola vez —cuando el día llegó del servidor con horas—. Teclear
	 * una hora después dejaba el número suelto sobre blanco mientras los días de
	 * al lado enseñaban su bloque de color: la misma rejilla diciendo que un día
	 * tuvo recargos y el de al lado no, cuando los dos los tienen.
	 *
	 * Se pinta la COLUMNA ENTERA y no la celda tocada porque el color no es de
	 * la cifra, es del día: o el día tuvo recargos —y entonces sus siete franjas
	 * se leen como un bloque, cada una del color de su tipo— o no tuvo ninguno y
	 * queda limpio. Misma regla que `tieneAlguno` en el builder; si aquí y allí
	 * divergieran, el día cambiaría de aspecto al recargar la página.
	 *
	 * Las dos guardas son obligatorias:
	 *   · `repintando()` — el permiso de celda intercepta `set-style` igual que
	 *     una escritura, y en una hoja bloqueada lo rechazaría.
	 *   · `suprimirEco()` — por si algún día el adapter escucha también los
	 *     comandos de estilo: sin ella, pintar se leería como editar.
	 */
	const repintarRecargosDelDia = (sheetId: string, fila: number, columna: number): boolean => {
		if (!recargoDeFila(fila)) return false;
		const colores = coloresPorHoja[sheetId];
		if (!colores) return false;

		try {
			const wb = ctx.fUniver.getUniverSheet(unitId);
			const hoja = wb?.getSheetBySheetId?.(sheetId);
			if (!hoja?.getRange) return false;

			const primera = fila - ORDEN_RECARGOS.indexOf(recargoDeFila(fila)!);
			/// `numeroDeCelda` y no `Number(v)`: estas celdas llevan `numFmt`, así
			/// que `getCellData().v` puede traer el texto ya formateado y
			/// `Number('4,5')` sería `NaN` — un día con horas se leería como vacío.
			const tieneAlguno = ORDEN_RECARGOS.some((_, i) => {
				const v = hoja.getRange(primera + i, columna)?.getCellData?.()?.v;
				return (numeroDeCelda(v) ?? 0) > 0;
			});

			repintando(() =>
				suprimirEco(() => {
					ORDEN_RECARGOS.forEach((codigo, i) => {
						const celda = hoja.getRange(primera + i, columna);
						if (!celda) return;
						const color = colores[codigo] ?? COLOR_RECARGO_NEUTRO;
						/// Sin recargos se vuelve al blanco de la rejilla, no a «sin
						/// fondo»: Univer FUSIONA el estilo nuevo con el que ya tiene
						/// la celda, así que omitirlo dejaría el color anterior puesto.
						celda.setBackgroundColor(tieneAlguno ? color : '#FFFFFF');
						celda.setFontColor(tieneAlguno ? contraste(color) : TEXT_DARK);
					});
				})
			);
			return true;
		} catch {
			/// El color es ayuda visual: si la API de rangos cambia entre
			/// versiones, la cifra sigue en su celda y el libro se repinta entero
			/// en la siguiente lectura del periodo.
			return false;
		}
	};

	/**
	 * Los tres interruptores del ajuste de recargos, como casillas.
	 *
	 * La celda guarda `SÍ` / `NO` y el checkbox solo cambia cómo se PINTA: el
	 * clic despacha `SetRangeValuesCommand` con el valor contrario, que es el
	 * mismo comando que ya interceptan el permiso de celda y el adaptador de
	 * cambios. Por eso marcar con el ratón persiste por el camino de siempre.
	 * Ver `checkbox-si-no.ts`.
	 *
	 * Si el preset de validación no estuviera cargado, la celda se queda como
	 * texto SÍ/NO, que se sigue pudiendo escribir: un checkbox que falta es un
	 * incordio, no motivo para dejar el canvas sin montar.
	 */
	for (const [sheetId, rangos] of Object.entries(checkboxPorSheetId)) {
		for (const rango of rangos) {
			colgarCheckboxSiNo(ctx.fUniver, sheetId, [rango.columna], {
				desde: rango.desde,
				hasta: rango.hasta
			});
		}
	}

	if (opts.conductorActivo) activarConductor(opts.conductorActivo);

	return {
		...ctx,
		unitId,
		sheetIdPorConductor,
		conductorPorSheetId,
		activarConductor,
		resolveConductor: (sheetId: string) => conductorPorSheetId[sheetId] ?? null,
		estadoPorHoja: () => ({ ...estados }),
		aplicarEstado,
		repintarRecargosDelDia
	};
}

export { disposeEngine, nominaSheetId };
