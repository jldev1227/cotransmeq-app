/**
 * Engine del canvas de RECORRIDOS.
 *
 * Envuelve `createLiquidacionEngine` con lo propio del módulo: casillas SÍ/NO
 * en pernocte y en cada columna de bono, permisos de celda por binding, y el
 * repintado de celdas que llegan de otros usuarios.
 *
 * Las columnas de bono son dinámicas, así que un cambio en la configuración de
 * bonos NO se puede aplicar en caliente: cambia el número de columnas de todas
 * las hojas. La página remonta el libro, que es lo honesto y lo barato.
 */

import { LocaleType } from '@univerjs/core';
import { createLiquidacionEngine, disposeEngine, type EngineContext } from './engine';
import { colgarCheckboxSiNo, hayValidacionDeDatos } from './checkbox-si-no';
import { installRecorridosCellPermission, repintando } from './cell-permission-recorridos';
import {
	setRecorridoBindings,
	clearRecorridoBindings,
	getRecorridoCellFor,
	getRecorridoCeldasDeEntidad
} from '../business/recorridos-cell-binding';
import {
	buildLibroRecorridos,
	COL,
	COL_BONO_INICIO,
	comoCasilla,
	estiloCasilla,
	valorFila,
	type BonoColumna,
	type FilaRecorrido,
	type RecorridosPeriodoDTO
} from '../builders/recorridos.builder';
import { conductorIdDeSheetId } from '../builders/recorridos-identidad';
import { activarHoja, hojaActiva } from './activar-hoja';

export interface RecorridosEngineContext extends EngineContext {
	sheetIdPorConductor: Record<string, string>;
	conductorPorSheetId: Map<string, string>;
	bonos: BonoColumna[];
	/** Repinta una fila completa (tras un patch propio o remoto). */
	pintarFila: (entityId: string, fila: FilaRecorrido) => void;
	/** Repinta una sola celda de casilla. */
	pintarCasilla: (entityId: string, field: string, marcado: boolean) => void;
	activar: (conductorId: string) => void;
	hojaActivaId: () => string | null;
}

export function crearRecorridosEngine(opts: {
	container: HTMLElement;
	dto: RecorridosPeriodoDTO;
	editable: boolean;
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
}): RecorridosEngineContext {
	const { container, dto, editable } = opts;

	const libro = buildLibroRecorridos(dto, { editable });

	// Los bindings del libro anterior se purgan antes de montar: si no, tras
	// cambiar de mes quedarían entradas apuntando a filas que ya no existen y un
	// patch remoto escribiría en la celda equivocada.
	clearRecorridoBindings(libro.unitId);

	const ctx = createLiquidacionEngine({
		container,
		workbookData: libro.workbook,
		locale: LocaleType.ES_ES,
		// La casilla SÍ/NO de pernocte y bonos es validación de datos nativa.
		dataValidation: true,
		// Autofiltro: filtrar por placa o por cliente es la operación más común
		// sobre esta hoja.
		filtros: true,
		// Barra de hojas: hay una por conductor y hay que poder saltar entre
		// ellas sin salir del canvas.
		footer: { sheetBar: true, statisticBar: true, zoomSlider: true, menus: true }
	});

	// Los bindings se registran con el sheetId REAL: al montar desde snapshot
	// coincide con el provisto, pero `insertSheet` no lo garantiza, así que se
	// resuelve siempre desde el libro.
	const wb = ctx.fUniver.getActiveWorkbook() as any;
	const conductorPorSheetId = new Map<string, string>();

	for (const [conductorId, sheetId] of Object.entries(libro.sheetIdPorConductor)) {
		const real = wb?.getSheetBySheetId?.(sheetId)?.getSheetId?.() ?? sheetId;
		setRecorridoBindings(libro.unitId, real, libro.bindingsPorHoja[sheetId] ?? []);
		conductorPorSheetId.set(real, conductorId);
	}

	// Casillas. Se cuelgan tras montar porque las reglas de validación NO viajan
	// en el snapshot de la hoja: un libro reconstruido las pierde.
	if (hayValidacionDeDatos(ctx.fUniver)) {
		if (editable) {
			const columnas = [
				COL.PERNOCTE,
				...dto.bonos.map((_, i) => COL_BONO_INICIO + i)
			];
			for (const [sheetId, rango] of Object.entries(libro.rangoPorHoja)) {
				const real = wb?.getSheetBySheetId?.(sheetId)?.getSheetId?.() ?? sheetId;
				colgarCheckboxSiNo(ctx.fUniver, real, columnas, rango);
			}
		}
	} else {
		console.warn('[recorridos-engine] sin validación de datos: pernocte y bonos quedan como texto');
	}

	const desinstalarPermisos = installRecorridosCellPermission(ctx.univer, {
		unitId: libro.unitId,
		editable,
		onBloqueado: opts.onBloqueado
	});

	/** Escribe una celda desde el propio canvas, sin que la guarda la rechace. */
	const escribir = (sheetId: string, r: number, c: number, valor: unknown, estilo?: unknown) => {
		repintando(() => {
			try {
				const hoja = (ctx.fUniver.getActiveWorkbook() as any)?.getSheetBySheetId?.(sheetId);
				hoja?.getRange?.(r, c)?.setValue?.(estilo ? { v: valor, s: estilo } : valor);
			} catch (e) {
				console.warn('[recorridos-engine] no se pudo pintar la celda', { sheetId, r, c, e });
			}
		});
	};

	const engine: RecorridosEngineContext = {
		...ctx,
		sheetIdPorConductor: libro.sheetIdPorConductor,
		conductorPorSheetId,
		bonos: dto.bonos,

		pintarCasilla(entityId, field, marcado) {
			// Se resuelve por el índice inverso del registry, no por posición.
			const celda = getRecorridoCellFor(libro.unitId, entityId, field);
			if (!celda) return;
			escribir(celda.sheetId, celda.row, celda.column, comoCasilla(marcado), estiloCasilla(marcado));
		},

		pintarFila(entityId, fila) {
			const celdas = getRecorridoCeldasDeEntidad(libro.unitId, entityId);
			if (!celdas.length) return;

			for (const c of celdas) {
				if (c.field.startsWith('bono:')) {
					const configId = c.field.slice('bono:'.length);
					const marcado = fila.bonos?.[configId] === true;
					escribir(c.sheetId, c.row, c.column, comoCasilla(marcado), estiloCasilla(marcado));
					continue;
				}
				if (c.field === 'pernocte') {
					escribir(c.sheetId, c.row, c.column, comoCasilla(fila.pernocte), estiloCasilla(fila.pernocte));
					continue;
				}
				const valor = (fila as unknown as Record<string, unknown>)[c.field];
				escribir(c.sheetId, c.row, c.column, valor ?? '');
			}

			// El valor a pagar es derivado: se recalcula aquí y se pinta con el
			// resto, para que la fila quede coherente en una sola pasada.
			const primera = celdas[0];
			const colTotal = COL_BONO_INICIO + dto.bonos.length;
			escribir(primera.sheetId, primera.row, colTotal, valorFila(fila, dto.bonos));
		},

		activar(conductorId) {
			const sheetId = libro.sheetIdPorConductor[conductorId];
			if (sheetId) activarHoja(ctx, sheetId);
		},

		hojaActivaId: () => hojaActiva(ctx),

		dispose() {
			try {
				desinstalarPermisos();
			} catch {
				/* noop */
			}
			clearRecorridoBindings(libro.unitId);
			disposeEngine(ctx.univer, ctx.fUniver, ctx.unitId, container);
		}
	};

	return engine;
}

export { conductorIdDeSheetId };
