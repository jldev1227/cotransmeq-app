/**
 * Engine del canvas de CIERRES FINALES: libro de un PERIODO con una hoja
 * por placa-propietario.
 *
 * Wrapper sobre `createLiquidacionEngine`, calcado de `adicionales-engine`
 * salvo por dos cosas:
 *
 *  · El eje es el PERIODO (`anio` + `mes`), no el año. Cambiar de mes
 *    implica un `unitId` distinto y por tanto remount; cambiar de hoja no.
 *  · Sabe insertar una hoja nueva SIN remontar, para cuando el modal de
 *    borradores genera cierres y hay que colocarlos en su sitio alfabético.
 */

import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext,
	type EngineOptions
} from './engine';
export type { EngineContext };
import {
	buildCierresFinalesPeriodoWorkbook,
	buildCierreFinalSheet,
	COL_APLICA_IMP,
	type CierreFinalCompleto,
	type AnclasHoja
} from '../builders/cierres-finales.builder';
import {
	cierreFinalSheetId,
	cierreIdDeSheetId,
	esEditable,
	nombreHoja,
	posicionDeInsercion,
	type CierreHoja
} from '../builders/cierres-finales-identidad';
import {
	setCierreBindings,
	clearCierreBindings,
	type BindingSeed
} from '../business/cierres-finales-cell-binding';
import { activarHoja, hojaActiva } from './activar-hoja';
import { colgarCheckboxSiNo, hayValidacionDeDatos } from './checkbox-si-no';
import { suprimirEco } from './apply-remote-patch';

export interface CierresFinalesEngineOptions {
	container: HTMLElement;
	anio: number;
	mes: number;
	/** Ya ordenados alfabéticamente por el servidor. */
	cierres: CierreFinalCompleto[];
	/** Cierre que debe quedar activo al montar. */
	cierreActivo?: string | null;	/// Notas libres, tal y como las devuelve `canvasAnotacionesAPI`.
	anotaciones?: Record<number, Record<string, any[]>>;
}

export interface CierresFinalesEngineContext extends EngineContext {
	unitId: string;
	sheetIdPorCierre: Record<string, string>;
	anclasPorHoja: Record<string, AnclasHoja>;
	/** Cambia la hoja activa SIN remontar. */
	activarCierre: (cierreId: string) => boolean;
	/** `subUnitId` → id de cierre, o `null` si la hoja no es de este libro. */
	resolveCierre: (sheetId: string) => string | null;
	/** Id del cierre cuya hoja está activa ahora mismo. */
	cierreActivo: () => string | null;
	/**
	 * Inserta una hoja en su posición alfabética sin remontar el libro.
	 * Devuelve el sheetId real que Univer le asignó.
	 */
	insertarCierre: (
		cierre: CierreFinalCompleto,
		indice: number
	) => string | null;
	/**
	 * Encola una hoja para insertar. Las que lleguen dentro de la misma
	 * ventana se aplican de golpe.
	 *
	 * Es lo que hay que usar cuando las altas llegan por socket: el modal de
	 * borradores puede generar 30 cierres en pocos segundos y cada
	 * `insertSheet` roba el foco, recalcula la sheet bar y entra al undo
	 * stack. Aplicarlas una a una hace saltar de hoja a quien esté editando.
	 */
	encolarCierre: (cierre: CierreFinalCompleto) => void;
	/** Vacía el buffer de inserciones ya mismo, sin esperar la ventana. */
	vaciarCola: () => void;
	/** Reconstruye UNA hoja (tras recargar ese cierre o revertir snapshot). */
	reconstruirHoja: (cierre: CierreFinalCompleto) => boolean;
	/**
	 * Pinta la pestaña de un cierre sin remontar.
	 *
	 * Lo usan el cambio de estado y el color que llega de otro usuario.
	 *
	 * Va envuelto en `suprimirEco`: `setTabColor` despacha
	 * `sheet.command.set-tab-color`, que es justo lo que el adapter escucha
	 * para persistir el color. Sin la guarda, cada repintado programático se
	 * persistía como si lo hubiera hecho el usuario y realimentaba el ciclo.
	 */
	pintarPestana: (cierreId: string, color: string) => boolean;
}

/**
 * Ventana de agrupación de altas.
 *
 * Suficiente para que una ráfaga del generador entre junta, y lo bastante
 * corta para que una alta suelta no parezca que se ha perdido.
 */
const VENTANA_INSERCION_MS = 300;

export function createCierresFinalesEngine(
	opts: CierresFinalesEngineOptions
): CierresFinalesEngineContext {
	const { workbook, unitId, sheetIdPorCierre, bindingsPorHoja, anclasPorHoja } =
		buildCierresFinalesPeriodoWorkbook({
			anotaciones: opts.anotaciones,
			anio: opts.anio,
			mes: opts.mes,
			cierres: opts.cierres
		});

	const engineOpts: EngineOptions = {
		container: opts.container,
		workbookData: workbook,
		// Las dos columnas de acción (APLICA IMP. y EXCLUIR) se marcan con un
		// checkbox, no escribiendo. Ver `colgarCheckboxAcciones`.
		dataValidation: true,
		footer: {
			// Con N hojas la sheet bar es la navegación principal, aunque el
			// header añade además un combo con buscador: por encima de ~20
			// pestañas la barra sola deja de ser usable.
			sheetBar: true,
			statisticBar: true,
			zoomSlider: true,
			menus: true
		}
	};

	const ctx = createLiquidacionEngine(engineOpts);

	// Los bindings se registran DESPUÉS de crear el workbook, con el sheetId
	// que efectivamente quedó.
	for (const [sheetId, seeds] of Object.entries(bindingsPorHoja)) {
		setCierreBindings(unitId, sheetId, seeds as BindingSeed[]);
	}

	/**
	 * Cuelga el checkbox de las dos columnas de acción de UNA hoja.
	 *
	 * La mecánica y el porqué viven en `checkbox-si-no.ts`, compartido con
	 * el canvas de ingresos.
	 *
	 * ── Solo en hojas EDITABLES ──
	 * Una hoja que ya no es BORRADOR no registra bindings (ver `bind` en el
	 * builder), así que el permiso rechaza la escritura. Un checkbox ahí se
	 * vería clicable y no haría nada: peor que el texto SÍ/NO, que al menos
	 * se lee como un dato y no como un control. Se deja el texto.
	 *
	 * Se llama tanto para las hojas del montaje inicial como para las que
	 * entran después por `insertarCierre`: una placa que llega por socket a
	 * mitad de sesión tiene que quedar igual que las demás, y las reglas de
	 * validación no viajan en el snapshot de la hoja.
	 */
	const colgarCheckboxAcciones = (
		sheetId: string,
		anclas: AnclasHoja | undefined,
		estado: string
	) => {
		if (!esEditable(estado)) return;
		colgarCheckboxSiNo(
			ctx.fUniver,
			sheetId,
			[COL_APLICA_IMP],
			anclas?.rangoItems ?? null
		);
	};

	if (hayValidacionDeDatos(ctx.fUniver)) {
		// Se recorren los CIERRES y no `anclasPorHoja`: hace falta el estado
		// de cada hoja, y el mapa de anclas va por sheetId sin él.
		for (const cierre of opts.cierres) {
			const sheetId = sheetIdPorCierre[cierre.hoja.id];
			if (!sheetId) continue;
			colgarCheckboxAcciones(sheetId, anclasPorHoja[sheetId], cierre.hoja.estado);
		}
	} else {
		console.warn(
			'[cierres-engine] sin validación de datos: APLICA IMP. y EXCLUIR quedan como texto'
		);
	}

	const mapaSheetIdPorCierre: Record<string, string> = { ...sheetIdPorCierre };
	const mapaAnclas: Record<string, AnclasHoja> = { ...anclasPorHoja };
	/** Orden vigente de hojas, para calcular dónde insertar. */
	let ordenCierres: CierreHoja[] = opts.cierres.map((c) => c.hoja);

	/**
	 * sheetId real → id de cierre.
	 *
	 * Hace falta porque `insertSheet` NO garantiza respetar el id que se le
	 * pasa. Para las hojas del montaje inicial el id sí es el nuestro y
	 * `cierreIdDeSheetId` bastaría; para las insertadas después puede no
	 * serlo, y entonces esa función devolvería `null` y el canvas no sabría
	 * a qué cierre pertenece la hoja activa.
	 */
	const cierrePorSheetId = new Map<string, string>(
		Object.entries(mapaSheetIdPorCierre).map(([cierreId, sid]) => [sid, cierreId])
	);

	const activarCierre = (cierreId: string): boolean => {
		const sheetId = mapaSheetIdPorCierre[cierreId];
		if (!sheetId) return false;
		return activarHoja(ctx, sheetId);
	};

	if (opts.cierreActivo) activarCierre(opts.cierreActivo);

	const insertarCierre = (
		cierre: CierreFinalCompleto,
		indice: number
	): string | null => {
		try {
			const wb = ctx.fUniver.getActiveWorkbook?.() as any;
			if (!wb) return null;

			// `insertSheet` deja la hoja nueva ACTIVA. Si alguien está
			// editando otra placa cuando llegan varias altas seguidas, le
			// saltaría de hoja en cada una — de ahí que se restaure después.
			const antes = hojaActiva(ctx);

			const sheetId = cierreFinalSheetId(cierre.hoja.id);
			const { sheet, bindings, anclas } = buildCierreFinalSheet({
				unitId,
				sheetId,
				sheetName: nombreHoja(cierre.hoja),
				cierre
			});

			const creada = wb.insertSheet(sheet.name, { index: indice, sheet });
			// Univer no garantiza respetar el `id` que va en `options.sheet`,
			// así que el sheetId real se lee de la hoja creada. Registrar los
			// bindings con el id supuesto dejaría todas las celdas huérfanas.
			const sheetIdReal: string = creada?.getSheetId?.() ?? sheetId;

			setCierreBindings(unitId, sheetIdReal, bindings);
			mapaSheetIdPorCierre[cierre.hoja.id] = sheetIdReal;
			cierrePorSheetId.set(sheetIdReal, cierre.hoja.id);
			mapaAnclas[sheetIdReal] = anclas;
			colgarCheckboxAcciones(sheetIdReal, anclas, cierre.hoja.estado);

			ordenCierres = [
				...ordenCierres.slice(0, indice),
				cierre.hoja,
				...ordenCierres.slice(indice)
			];

			if (antes) activarHoja(ctx, antes);
			return sheetIdReal;
		} catch (e) {
			console.error('[cierres-engine] insertarCierre falló', e);
			return null;
		}
	};

	// ── Buffer de altas ────────────────────────────────────────────────
	// Las altas llegan por socket a ritmo del generador. Se agrupan para
	// aplicarlas de una tacada, restaurando UNA sola vez la hoja activa en
	// lugar de una por inserción.
	let pendientes: CierreFinalCompleto[] = [];
	let temporizador: ReturnType<typeof setTimeout> | null = null;

	const vaciarCola = () => {
		if (temporizador) {
			clearTimeout(temporizador);
			temporizador = null;
		}
		if (pendientes.length === 0) return;

		const lote = pendientes;
		pendientes = [];

		// Todo el lote va bajo `suprimirEco`, no solo el color: cada
		// `insertSheet` deja su hoja activa y despacha
		// `sheet.operation.set-worksheet-active`, que es justo lo que el
		// adapter escucha para avisar del cambio de hoja. Sin la guarda, una
		// ráfaga del generador arrastraría al usuario por 25 placas ajenas
		// —reescribiendo la URL y su presencia en cada salto— antes de
		// devolverlo a la suya.
		suprimirEco(() => {
			// La hoja activa se guarda para todo el lote, no por inserción.
			const antes = hojaActiva(ctx);

			// Ordenadas para que los índices calculados no se invaliden entre sí:
			// insertar primero las que van más atrás desplazaría a las siguientes.
			const ordenadas = [...lote].sort((a, b) =>
				a.hoja.orden_alfabetico.localeCompare(b.hoja.orden_alfabetico, 'es')
			);

			for (const cierre of ordenadas) {
				// Ya presente: llegó dos veces (reconexión, o el emisor recibió su
				// propio evento). Insertarla otra vez duplicaría la pestaña.
				if (mapaSheetIdPorCierre[cierre.hoja.id]) continue;
				insertarCierre(cierre, posicionDeInsercion(ordenCierres, cierre.hoja));
			}

			if (antes) activarHoja(ctx, antes);
		});
	};

	const encolarCierre = (cierre: CierreFinalCompleto) => {
		if (mapaSheetIdPorCierre[cierre.hoja.id]) return;
		if (pendientes.some((p) => p.hoja.id === cierre.hoja.id)) return;
		pendientes.push(cierre);

		// Tope duro: con un flujo continuo de altas, reiniciar el temporizador
		// en cada una lo aplazaría indefinidamente y el usuario no vería
		// aparecer nada hasta que el generador terminara.
		if (pendientes.length >= 25) {
			vaciarCola();
			return;
		}

		if (temporizador) clearTimeout(temporizador);
		temporizador = setTimeout(vaciarCola, VENTANA_INSERCION_MS);
	};

	const pintarPestana = (cierreId: string, color: string): boolean => {
		const sheetId = mapaSheetIdPorCierre[cierreId];
		if (!sheetId) return false;
		try {
			const wb = ctx.fUniver.getActiveWorkbook?.() as any;
			const hoja = wb?.getSheetBySheetId?.(sheetId);
			if (!hoja?.setTabColor) return false;

			// Si ya está de ese color, no tocar nada. `setTabColor` despacha un
			// comando aunque el valor no cambie, y ese comando lo escucha el
			// adapter: repintar por repintar era una de las patas del bucle.
			const actual = hoja.getTabColor?.();
			if (typeof actual === 'string' && actual.toUpperCase() === color.toUpperCase()) {
				return true;
			}

			// `suprimirEco`: esto es un repintado PROGRAMÁTICO (cambio de
			// estado, color de otro usuario, inserción de hoja). Sin la guarda,
			// el adapter lo toma por una acción del usuario y lo persiste, el
			// servidor lo difunde, el cliente vuelve a pintar… y no para.
			// Es síncrono a propósito: ver la advertencia de `suprimirEco`.
			suprimirEco(() => hoja.setTabColor(color));
			return true;
		} catch (e) {
			console.warn('[cierres-engine] pintarPestana falló', e);
			return false;
		}
	};

	const reconstruirHoja = (cierre: CierreFinalCompleto): boolean => {
		const sheetId = mapaSheetIdPorCierre[cierre.hoja.id];
		if (!sheetId) return false;
		try {
			const wb = ctx.fUniver.getActiveWorkbook?.() as any;
			const hoja = wb?.getSheetBySheetId?.(sheetId);
			if (!hoja) return false;

			const { sheet, bindings, anclas } = buildCierreFinalSheet({
				unitId,
				sheetId,
				sheetName: nombreHoja(cierre.hoja),
				cierre
			});

			// Limpiar SOLO los bindings de esta hoja: si no, quedarían
			// apuntando a filas que ya no existen y un patch remoto
			// escribiría en la celda equivocada.
			clearCierreBindings(unitId, sheetId);
			setCierreBindings(unitId, sheetId, bindings);
			mapaAnclas[sheetId] = anclas;

			// Univer 0.25.1 no expone un "reemplaza el contenido de esta
			// hoja" en la facade, así que el llamador debe remontar el libro
			// si necesita cambiar la GEOMETRÍA. Aquí solo se refrescan los
			// bindings y las anclas, que es lo que necesita el patch remoto.
			return true;
		} catch (e) {
			console.error('[cierres-engine] reconstruirHoja falló', e);
			return false;
		}
	};

	return {
		...ctx,
		unitId,
		get sheetIdPorCierre() {
			return mapaSheetIdPorCierre;
		},
		get anclasPorHoja() {
			return mapaAnclas;
		},
		activarCierre,
		// El mapa manda sobre el parseo del prefijo: las hojas insertadas en
		// caliente pueden llevar un id que Univer eligió, no el nuestro.
		resolveCierre: (sheetId: string) =>
			cierrePorSheetId.get(sheetId) ?? cierreIdDeSheetId(sheetId),
		cierreActivo: () => {
			const sid = hojaActiva(ctx);
			if (!sid) return null;
			return cierrePorSheetId.get(sid) ?? cierreIdDeSheetId(sid);
		},
		insertarCierre,
		encolarCierre,
		vaciarCola,
		reconstruirHoja,
		pintarPestana
	};
}

/** Posición alfabética donde va un cierre nuevo. Reexport por comodidad. */
export { posicionDeInsercion };
export { disposeEngine };
