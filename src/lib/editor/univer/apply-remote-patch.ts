/**
 * Aplicación de un cambio remoto en la hoja VIVA, sin remontar el engine.
 *
 * El objetivo es que editar en un navegador se vea en el otro sin parpadeo ni
 * pérdida de selección — la diferencia entre "un sheet compartido" y "una
 * página que se recarga sola".
 *
 * TRES TRAMPAS, todas resueltas aquí:
 *
 * 1. ECO. `setValue` emite `sheet.command.set-range-values`, que es
 *    exactamente lo que escucha el cell-change adapter. Sin guarda, el
 *    receptor interpretaría el patch remoto como edición propia y lo
 *    reemitiría: bucle infinito entre los clientes conectados. De ahí el
 *    contador `aplicando` + `isApplyingRemote()`.
 *
 *    Lo mismo vale para cualquier OTRO comando que un adapter observe y que
 *    el cliente dispare por su cuenta — `set-tab-color` en el canvas de
 *    cierres. Para esos está `suprimirEco()`, que comparte contador.
 *
 *    El reset va en `queueMicrotask` y no en el `finally` inmediato porque
 *    Univer puede despachar el comando de forma asíncrona; soltar la guarda
 *    demasiado pronto reabriría el bucle.
 *
 * 2. DEFAULT-DENY. `cell-permission-*` intercepta `set-range-values` y
 *    RECHAZA toda celda sin binding editable. Por eso solo se escriben las
 *    celdas que tienen binding (`valor_unitario`, `cantidad`); si el campo no
 *    está mapeado, se devuelve `false` y el llamador actualiza únicamente el
 *    modelo JS.
 *
 * 3. COLUMNAS DERIVADAS. ADMON, TOTAL y V/LIQUIDAR son fórmulas vivas en el
 *    builder. NO se pintan: el formula engine las recalcula solo y cascadea a
 *    los SUM del footer. El `row` que manda el servidor se usa para el modelo
 *    JS, no para la pantalla — si las pintáramos, además, el interceptor las
 *    rechazaría por no tener binding.
 */

import type { IStyleData } from '@univerjs/core';
import type { EngineContext } from './engine';

/**
 * Contador (no booleano): dos patches remotos casi simultáneos se solapan, y
 * un booleano dejaría la guarda abierta al terminar el primero.
 */
let aplicando = 0;

/** ¿Se está pintando ahora mismo un cambio remoto? Lo consultan los adapters. */
export function isApplyingRemote(): boolean {
	return aplicando > 0;
}

/**
 * Ejecuta `fn` con la guarda de eco levantada.
 *
 * `aplicarCeldaRemota` cubre las escrituras de CELDA, pero hay comandos de
 * Univer que también observan los adapters y que el cliente dispara de forma
 * programática: `set-tab-color` es el caso vivo. Sin esta envoltura, pintar
 * una pestaña desde código se lee como una acción del usuario, se persiste,
 * el servidor lo difunde, el cliente vuelve a pintar… y no para.
 *
 * ⚠️ SOLO PARA FUNCIONES SÍNCRONAS. La guarda se suelta un microtask después
 * de que `fn` retorne; si `fn` hiciera `await`, la parte posterior correría
 * con la guarda ya cerrada y —peor— las ediciones locales que ocurrieran
 * durante ese `await` se descartarían por parecer remotas.
 */
export function suprimirEco<T>(fn: () => T): T {
	aplicando++;
	try {
		return fn();
	} finally {
		queueMicrotask(() => {
			aplicando = Math.max(0, aplicando - 1);
		});
	}
}

export interface RemoteCellTarget {
	sheetId: string;
	row: number;
	column: number;
}

/**
 * Escribe `value` en la celda indicada suprimiendo el eco.
 *
 * Devuelve `true` si se escribió. `false` si el workbook o la hoja no están
 * disponibles (p. ej. durante un teardown), en cuyo caso el llamador debe
 * limitarse a actualizar el modelo JS.
 *
 * ── `estilo`, y por qué hace falta ──
 * Casi todas las celdas que se repintan por aquí llevan un formato fijo (un
 * patrón de moneda, un porcentaje) que no depende del valor, así que basta
 * con escribir el dato. Pero hay celdas cuyo ESTILO ES PARTE DEL DATO: la
 * columna APLICA IMP. es un semáforo, verde si el item entra en la base
 * imponible y rojo si no.
 *
 * Escribiendo solo el valor, esas celdas se quedaban con el color con el que
 * nació la hoja y acababan diciendo «SÍ» sobre fondo rojo. Pasando el estilo
 * se escriben los dos a la vez —un único `set-range-values`, ya cubierto por
 * la guarda de eco— en vez de encadenar una segunda llamada de formato que
 * podría aplicarse a medias.
 */
export function aplicarCeldaRemota(
	ctx: EngineContext,
	target: RemoteCellTarget,
	value: string | number | boolean | null,
	estilo?: IStyleData
): boolean {
	aplicando++;
	try {
		const wb = ctx.fUniver.getActiveWorkbook?.() as any;
		if (!wb) return false;
		const sheet = wb.getSheetBySheetId?.(target.sheetId);
		if (!sheet?.getRange) {
			console.warn('[apply-remote] hoja no encontrada', target.sheetId);
			return false;
		}
		const rango = sheet.getRange(target.row, target.column);
		// `setValue` admite tanto el valor pelado como un `ICellData`. Con
		// estilo se manda la celda entera; sin él se deja el formato que ya
		// tuviera, que es lo que quieren el resto de llamadores.
		rango.setValue(estilo ? ({ v: value, s: estilo } as any) : (value as any));
		return true;
	} catch (e) {
		console.warn('[apply-remote] fallo al pintar', target, e);
		return false;
	} finally {
		// Ver punto 1 del docblock: el comando puede despacharse de forma
		// asíncrona, así que la guarda se suelta un microtask después.
		queueMicrotask(() => {
			aplicando = Math.max(0, aplicando - 1);
		});
	}
}
