/**
 * Engine Univer del canvas **INGRESOS DE COTRANSMEQ**. Wrapper minimal sobre
 * `createLiquidacionEngine` que pasa el libro del MES que arma
 * `buildIngresosMesWorkbook`.
 *
 * Layout: DOS hojas —«INGRESOS» y «ADICIONALES»— con `sheetBar: true`, para
 * alternar entre ellas desde la propia barra de Univer. El MES se cambia
 * arriba, en el selector del header, y reconstruye el libro.
 * `statisticBar` y `zoomSlider` se mantienen para una UX tipo Excel.
 *
 * `readOnly: false`: la tabla sigue siendo derivada, pero encima de ella hay
 * una capa editable —la columna INCLUIR, la cantidad, el V/UNIDAD de la hoja
 * de adicionales y los conceptos del pie—. Lo que se puede tocar lo decide
 * `cell-permission-ingresos.ts`, que es default-deny y solo abre las celdas
 * con binding y la zona libre.
 *
 * `sincronizarIncluir` es lo que evita remontar al marcar una casilla. El
 * builder deja la hoja de adicionales con TODOS los servicios del mes y las
 * filas no marcadas escondidas, así que marcar una casilla no cambia la
 * geometría de nada: las fórmulas del pie cuelgan de la propia casilla y se
 * recalculan solas, y aquí solo queda enseñar u ocultar su fila en la hoja de
 * adicionales y repintar la de ingresos —la casilla y el fondo de la fila,
 * verde si baja a adicionales y azul si el cliente es prioritario—. Los
 * colores los decide `fondoFilaIngresos`, del builder, para que una fila
 * recién marcada y esa misma fila tras recargar se vean igual. El porqué
 * completo está en el encabezado del builder.
 */

import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext,
	type EngineOptions
} from './engine';
export type { EngineContext };
import type {
	EstadoIngresoMes,
	IngresoTerceroRow
} from '$lib/api/liquidaciones-terceros-ingresos';
import {
	adicionalesSheetId,
	buildIngresosMesWorkbook,
	COL_INCLUIR,
	COLORES_INCLUIR,
	COLS_RESALTADO,
	fondoFilaIngresos,
	ingresosSheetId,
	PRIMERA_FILA_ITEMS,
	type GeometriaIncluirMes
} from '../builders/ingresos-terceros.builder';
import { activarHoja } from './activar-hoja';
import { CHECKBOX_NO, CHECKBOX_SI, colgarCheckboxSiNo, hayValidacionDeDatos } from './checkbox-si-no';
import { ICommandService, type IRange } from '@univerjs/core';
import { SetRowHiddenMutation, SetRowVisibleMutation } from '@univerjs/sheets';

export interface IngresosEngineOptions {
	container: HTMLElement;
	anio: number;
	/** Filas derivadas por mes, claves 1..12. Meses ausentes → hoja con aviso. */
	filasPorMes: Record<number, IngresoTerceroRow[]>;
	/** Capa editable por mes: cabecera, overrides y conceptos del pie. */
	estadoPorMes: Record<number, EstadoIngresoMes>;
	/** Mes (1..12) del que se emiten las dos hojas. Default: 1. */
	mesActivo?: number;
	/** Cuál de las dos hojas del mes queda activa al montar. Default: INGRESOS. */
	hojaActiva?: 'INGRESOS' | 'ADICIONALES';
	/// Notas libres, tal y como las devuelve `canvasAnotacionesAPI`.
	anotaciones?: Record<number, Record<string, any[]>>;
}

export interface IngresosEngineContext extends EngineContext {
	unitId: string;
	sheetIdPorMes: Record<number, string>;
	adicionalesSheetIdPorMes: Record<number, string>;
	/** Cambia la hoja activa SIN remontar el engine. */
	activarMes: (mes: number, hoja?: 'INGRESOS' | 'ADICIONALES') => void;
	/** Resuelve el mes a partir de un `sheetId` de Univer (de cualquier hoja). */
	resolveMes: (sheetId: string) => number | null;
	/** Resuelve a qué de las dos hojas del mes pertenece un `sheetId`. */
	resolveHoja: (sheetId: string) => 'INGRESOS' | 'ADICIONALES' | null;
	/**
	 * Pone las dos hojas al día con el INCLUIR de un mes SIN remontar el libro.
	 *
	 * Devuelve `false` si no ha podido —el mes no es el del libro, la hoja ya no
	 * está, hay demasiadas filas que tocar—, y entonces quien llama remonta.
	 */
	sincronizarIncluir: (mes: number, incluido: (itemId: string) => boolean) => boolean;
}

/**
 * A partir de cuántas filas cambiadas deja de compensar el repintado en
 * caliente y se remonta.
 *
 * Cada fila cambiada son media docena de comandos de estilo —la casilla y los
 * tramos de color de la fila— y el precio crece en línea recta; el remontaje
 * es caro pero de precio fijo. Marcar de una vez media tabla —pegando una
 * columna, o vaciándola con Supr— es justo el caso en el que sale más barato
 * reconstruir. El caso normal es una casilla.
 */
const MAX_FILAS_EN_CALIENTE = 40;

/**
 * Repinta el fondo de UNA fila de la tabla de ingresos.
 *
 * El color de cada celda lo decide `fondoFilaIngresos`, la misma función con
 * la que el builder pintó la hoja: aquí solo se aplica. Así una fila recién
 * marcada y esa misma fila tras recargar el mes se ven igual.
 *
 * Se pinta por TRAMOS de color y no celda a celda. Marcar tiñe las nueve
 * columnas del mismo verde —un solo comando—, pero desmarcar las devuelve a
 * tres colores distintos (el azul del nombre si el cliente es prioritario, el
 * azul claro de CANT, la cebra del resto), y nueve comandos de estilo por
 * fila se notan en cuanto se marca un rango.
 */
function repintarFila(
	hoja: any,
	fila: number,
	estado: { prioritaria: boolean; incluida: boolean; zebra: boolean }
): void {
	const { desde, hasta } = COLS_RESALTADO;

	let inicioTramo = desde;
	let colorTramo = fondoFilaIngresos({ ...estado, columna: desde });

	const volcar = (fin: number) => {
		hoja.getRange(fila, inicioTramo, 1, fin - inicioTramo + 1).setBackgroundColor(colorTramo);
	};

	for (let c = desde + 1; c <= hasta; c++) {
		const color = fondoFilaIngresos({ ...estado, columna: c });
		if (color === colorTramo) continue;
		volcar(c - 1);
		inicioTramo = c;
		colorTramo = color;
	}
	volcar(hasta);
}

export function createIngresosEngine(
	opts: IngresosEngineOptions
): IngresosEngineContext {
	const mesDelLibro = opts.mesActivo ?? 1;
	const {
		workbook,
		unitId,
		sheetIdPorMes,
		adicionalesSheetIdPorMes,
		rangoIncluirPorMes,
		geometriaIncluirPorMes
	} = buildIngresosMesWorkbook({
		anotaciones: opts.anotaciones,
		anio: opts.anio,
		mes: mesDelLibro,
		filasPorMes: opts.filasPorMes,
		estadoPorMes: opts.estadoPorMes
	});

	const engineOpts: EngineOptions = {
		container: opts.container,
		workbookData: workbook,
		// La hoja tiene celdas editables; el default-deny lo pone el
		// cell-permission, que es quien sabe cuáles.
		readOnly: false,
		// La columna INCLUIR se marca con un checkbox, no escribiendo. Ver
		// `colgarCheckboxIncluir` más abajo.
		dataValidation: true,
		footer: {
			// Con 24 hojas la sheet bar es la navegación principal.
			sheetBar: true,
			statisticBar: true,
			zoomSlider: true,
			menus: false
		}
	};

	const ctx = createLiquidacionEngine(engineOpts);
	colgarCheckboxIncluir(ctx, sheetIdPorMes, rangoIncluirPorMes);

	// Índices inversos sheetId → mes y sheetId → hoja, para reflejar en la URL
	// lo que el usuario elige desde la sheet bar de Univer. Las dos hojas del
	// libro resuelven al mismo mes: cambiar entre ellas no cambia el periodo.
	const mesPorSheetId = new Map<string, number>();
	const hojaPorSheetId = new Map<string, 'INGRESOS' | 'ADICIONALES'>();
	for (const [mes, sheetId] of Object.entries(sheetIdPorMes)) {
		mesPorSheetId.set(sheetId, Number(mes));
		hojaPorSheetId.set(sheetId, 'INGRESOS');
	}
	for (const [mes, sheetId] of Object.entries(adicionalesSheetIdPorMes)) {
		mesPorSheetId.set(sheetId, Number(mes));
		hojaPorSheetId.set(sheetId, 'ADICIONALES');
	}

	const activarMes = (mes: number, hoja: 'INGRESOS' | 'ADICIONALES' = 'INGRESOS') => {
		const sheetId =
			hoja === 'ADICIONALES' ? adicionalesSheetIdPorMes[mes] : sheetIdPorMes[mes];
		if (!sheetId) return;
		activarHoja(ctx, sheetId);
	};

	// La primera hoja del libro es la de INGRESOS, así que solo hay que activar
	// nada si se pidió abrir en la de adicionales (`?hoja=adic`): sin esto la
	// URL decía una cosa y la pantalla mostraba otra.
	const hojaActiva = opts.hojaActiva ?? 'INGRESOS';
	if (hojaActiva !== 'INGRESOS') activarMes(mesDelLibro, hojaActiva);

	/**
	 * Estado de INCLUIR que hay PINTADO ahora mismo en el libro.
	 *
	 * Arranca con el que sirvió para construirlo y se va moviendo con cada
	 * sincronización. Sin él habría que repintar las casillas de todos los
	 * servicios del mes en cada clic, que en un mes cargado son cientos de
	 * comandos de estilo para cambiar uno.
	 */
	const pintado: Record<number, Record<string, boolean>> = {};
	for (const [mes, g] of Object.entries(geometriaIncluirPorMes)) {
		pintado[Number(mes)] = { ...g.incluidoPorItem };
	}

	const commandService = (ctx.univer as any).__getInjector().get(ICommandService);

	const sincronizarIncluir = (
		mes: number,
		incluido: (itemId: string) => boolean
	): boolean => {
		const geo: GeometriaIncluirMes | undefined = geometriaIncluirPorMes[mes];
		const sheetIngresos = sheetIdPorMes[mes];
		const sheetAdicionales = adicionalesSheetIdPorMes[mes];
		// Otro mes: su libro ni siquiera está montado, no hay nada que pintar
		// aquí. Quien llama decide (normalmente, no hacer nada).
		if (!geo || !sheetIngresos || !sheetAdicionales) return false;

		const wb = ctx.fUniver.getActiveWorkbook() as any;
		const hojaIngresos = wb?.getSheetBySheetId?.(sheetIngresos);
		if (!hojaIngresos?.getRange) return false;

		const ocultar: IRange[] = [];
		const mostrar: IRange[] = [];
		const cambiadas: Array<{ itemId: string; fila: number; incluir: boolean }> = [];
		let hayMarcados = false;

		const rangoFila = (fila: number): IRange => ({
			startRow: fila,
			endRow: fila,
			startColumn: 0,
			endColumn: Math.max(0, geo.columnasAdicionales - 1)
		});

		for (const [itemId, fila] of Object.entries(geo.filaPorItem)) {
			const quiere = incluido(itemId);
			if (quiere) hayMarcados = true;
			if ((pintado[mes]?.[itemId] ?? false) === quiere) continue;
			cambiadas.push({ itemId, fila, incluir: quiere });
			(quiere ? mostrar : ocultar).push(rangoFila(fila));
		}

		// Demasiado que tocar: sale más barato reconstruir el libro entero.
		if (cambiadas.length > MAX_FILAS_EN_CALIENTE) return false;

		// El aviso «ningún servicio marcado» se resuelve entero cada vez: es una
		// fila y comparar su estado anterior no ahorra nada.
		if (geo.filaAvisoAdicionales != null) {
			(hayMarcados ? ocultar : mostrar).push(rangoFila(geo.filaAvisoAdicionales));
		}

		try {
			// Mutaciones y no comandos: esconder una fila no es una edición del
			// usuario, es el reflejo de la casilla que acaba de marcar. Como
			// comando entraría en la pila de deshacer, y el primer Ctrl+Z
			// devolvería la fila a la vista dejando la casilla marcada.
			if (ocultar.length) {
				commandService.syncExecuteCommand(SetRowHiddenMutation.id, {
					unitId,
					subUnitId: sheetAdicionales,
					ranges: ocultar
				});
			}
			if (mostrar.length) {
				commandService.syncExecuteCommand(SetRowVisibleMutation.id, {
					unitId,
					subUnitId: sheetAdicionales,
					ranges: mostrar
				});
			}

			for (const c of cambiadas) {
				const celda = hojaIngresos.getRange(c.fila, COL_INCLUIR);
				const colores = c.incluir ? COLORES_INCLUIR.si : COLORES_INCLUIR.no;
				// La casilla ya lleva el valor bueno cuando el clic fue local —lo
				// escribió Univer— y no cuando el cambio llegó de otro usuario. Se
				// escribe solo si hace falta: reescribir el mismo valor dispara otro
				// `set-range-values` y con él una vuelta entera de adaptador y
				// autoguardado por nada.
				const esperado = c.incluir ? CHECKBOX_SI : CHECKBOX_NO;
				if (String(celda.getValue() ?? '') !== esperado) celda.setValue(esperado);
				celda.setBackgroundColor(colores.fondo);
				celda.setFontColor(colores.texto);

				repintarFila(hojaIngresos, c.fila, {
					prioritaria: geo.prioritarioPorItem[c.itemId] === true,
					incluida: c.incluir,
					// La cebra va por posición dentro de la tabla, no por fila
					// absoluta: la cabecera ocupa la de arriba.
					zebra: (c.fila - PRIMERA_FILA_ITEMS) % 2 === 1
				});
			}
		} catch (e) {
			console.warn('[ingresos-engine] no se pudo sincronizar INCLUIR', e);
			return false;
		}

		// Solo al final: si algo falló a mitad, el registro sigue describiendo lo
		// último que se pintó de verdad y el remontaje lo deja todo en su sitio.
		const registro = (pintado[mes] ??= {});
		for (const itemId of Object.keys(geo.filaPorItem)) {
			registro[itemId] = incluido(itemId);
		}
		return true;
	};

	return {
		...ctx,
		unitId,
		sheetIdPorMes,
		adicionalesSheetIdPorMes,
		activarMes,
		sincronizarIncluir,
		resolveMes: (sheetId: string) => mesPorSheetId.get(sheetId) ?? null,
		resolveHoja: (sheetId: string) => hojaPorSheetId.get(sheetId) ?? null
	};
}

/**
 * Cuelga el checkbox de la columna INCLUIR en la hoja de ingresos del libro.
 *
 * La mecánica y el porqué viven en `checkbox-si-no.ts`, compartido con el
 * canvas de cierres.
 *
 * Se aplica después de montar y no en el snapshot del workbook porque las
 * reglas de validación viven en su propio recurso, fuera de `sheets`.
 */
function colgarCheckboxIncluir(
	ctx: EngineContext,
	sheetIdPorMes: Record<number, string>,
	rangoIncluirPorMes: Record<number, { desde: number; hasta: number }>
): void {
	if (!hayValidacionDeDatos(ctx.fUniver)) {
		console.warn('[ingresos-engine] sin validación de datos: INCLUIR queda como texto');
		return;
	}
	for (const [mes, rango] of Object.entries(rangoIncluirPorMes)) {
		const sheetId = sheetIdPorMes[Number(mes)];
		if (!sheetId) continue;
		colgarCheckboxSiNo(ctx.fUniver, sheetId, [COL_INCLUIR], rango);
	}
}

export { disposeEngine, ingresosSheetId, adicionalesSheetId };
