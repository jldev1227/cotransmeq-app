/**
 * Engine del canvas de RECORRIDOS.
 *
 * Envuelve `createLiquidacionEngine` con lo propio del módulo: casillas SÍ/NO
 * en pernocte y en cada columna de bono, permisos de celda por binding, el
 * repintado de celdas que llegan de otros usuarios, y las FILAS que el usuario
 * inserta o elimina con los comandos nativos de Univer.
 *
 * Las columnas de bono son dinámicas, así que un cambio en la configuración de
 * bonos NO se puede aplicar en caliente: cambia el número de columnas de todas
 * las hojas. La página remonta el libro, que es lo honesto y lo barato.
 *
 * ── FILAS INSERTADAS Y ELIMINADAS ──────────────────────────────────────────
 *
 * El engine escucha las MUTACIONES de fila (`insert-row`, `remove-rows`), que
 * son lo que Univer ejecuta al final de cualquier camino —menú contextual,
 * atajo, «insertar 3 filas»— y por tanto el único punto donde la geometría de
 * la hoja cambia de verdad. Al insertar, desplaza los bindings de debajo,
 * pinta la fila nueva en blanco como BORRADOR y la registra con un id local;
 * al eliminar, recoge qué entidades había en esas filas y se lo dice a la
 * página, que es quien habla con el servidor. En los dos casos renumera la
 * columna `#`, reescribe la fórmula del pie —Univer no extiende un rango
 * cuando se inserta justo debajo de su última fila— y vacía el historial de
 * deshacer: un Ctrl+Z que devolviera una fila ya retirada en el servidor
 * sería una mentira en pantalla.
 */

import {
	ICommandService,
	IUndoRedoService,
	LocaleType,
	type ICommandInfo,
	type IRange
} from '@univerjs/core';
import { createLiquidacionEngine, disposeEngine, type EngineContext } from './engine';
import { colgarCheckboxSiNo, hayValidacionDeDatos } from './checkbox-si-no';
import {
	installRecorridosCellPermission,
	repintando,
	type ZonaDeDatos
} from './cell-permission-recorridos';
import {
	setRecorridoBindings,
	clearRecorridoBindings,
	clearRecorridoBindingsDeFila,
	getRecorridoBindingsDeFila,
	getRecorridoCellFor,
	getRecorridoCeldasDeEntidad,
	shiftRecorridoBindings,
	type TipoFilaRecorrido
} from '../business/recorridos-cell-binding';
import {
	buildLibroRecorridos,
	bindingsDeFila,
	bindingsFilaNueva,
	celdasFilaVacia,
	COL,
	COL_BONO_INICIO,
	colValorPagar,
	comoCasilla,
	diaSemana,
	estiloCasilla,
	estiloTipo,
	formulaPie,
	totalColumnas,
	valorFila,
	type BonoColumna,
	type FilaRecorrido,
	type RecorridosPeriodoDTO
} from '../builders/recorridos.builder';
import { conductorIdDeSheetId } from '../builders/recorridos-identidad';
import { fechaDesdeCelda, serieDeFechas } from '../business/recorridos-celdas';
import { rellenado } from './adapters/cell-change-recorridos';
import { activarHoja, hojaActiva } from './activar-hoja';

const INSERT_ROW_MUTATION = 'sheet.mutation.insert-row';
const REMOVE_ROWS_MUTATION = 'sheet.mutation.remove-rows';
const AUTO_FILL = 'sheet.command.auto-fill';
const REFILL = 'sheet.command.refill';

/** Prefijo del id local de una fila insertada y aún sin guardar. */
export const PREFIJO_FILA_NUEVA = 'nueva:';

export interface FilaEliminada {
	row: number;
	tipoFila: TipoFilaRecorrido;
	entityId: string;
}

export interface RecorridosEngineContext extends EngineContext {
	sheetIdPorConductor: Record<string, string>;
	conductorPorSheetId: Map<string, string>;
	bonos: BonoColumna[];
	/** Repinta una fila completa (tras un patch propio o remoto). */
	pintarFila: (entityId: string, fila: FilaRecorrido) => void;
	/** Repinta una sola celda de casilla. */
	pintarCasilla: (entityId: string, field: string, marcado: boolean) => void;
	/** Repinta UNA celda de una entidad con un valor dado (para reponer un valor rechazado). */
	pintarCelda: (entityId: string, field: string, valor: unknown) => void;
	/**
	 * Convierte una fila BORRADOR en una fila guardada: cambia sus bindings por
	 * los de la entidad real y la repinta con los estilos normales.
	 */
	vincularFila: (entityId: string, fila: FilaRecorrido) => void;
	/** Fila de una entidad (o borrador) en su hoja, si se conoce. */
	posicionDe: (entityId: string) => { sheetId: string; row: number } | null;
	/**
	 * Reescribe las fechas que acaba de rellenar el tirador como serie de días.
	 * Lo llama el adapter ANTES de leer el relleno (ver `antesDeRelleno`).
	 */
	corregirRelleno: (sheetId: string, origen: IRange | undefined, destino: IRange) => void;
	activar: (conductorId: string) => void;
	hojaActivaId: () => string | null;
}

export function crearRecorridosEngine(opts: {
	container: HTMLElement;
	dto: RecorridosPeriodoDTO;
	editable: boolean;
	onBloqueado?: (aviso: { titulo: string; detalle: string }) => void;
	/** El usuario insertó una fila: ya está pintada y registrada como borrador. */
	onFilaNueva?: (e: { sheetId: string; conductorId: string; row: number; entityId: string }) => void;
	/** El usuario eliminó filas: Univer ya las quitó de la hoja. */
	onFilasEliminadas?: (e: { sheetId: string; conductorId: string; filas: FilaEliminada[] }) => void;
	/**
	 * Un arrastre pasó por encima de filas GUARDADAS: la página las repinta
	 * desde su modelo, que es la única fuente de las celdas calculadas.
	 */
	onRepintarFilas?: (entityIds: string[]) => void;
}): RecorridosEngineContext {
	const { container, dto, editable } = opts;

	const libro = buildLibroRecorridos(dto, { editable });
	const nCols = totalColumnas(dto.bonos);
	const colTotal = colValorPagar(dto.bonos);

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

	const injector = ctx.univer.__getInjector();
	const commandService = injector.get(ICommandService);
	const undoRedo = injector.get(IUndoRedoService);

	// Los bindings se registran con el sheetId REAL: al montar desde snapshot
	// coincide con el provisto, pero `insertSheet` no lo garantiza, así que se
	// resuelve siempre desde el libro.
	const wb = ctx.fUniver.getActiveWorkbook() as any;
	const conductorPorSheetId = new Map<string, string>();

	/**
	 * Zona de datos de cada hoja: `[desde, hasta]`. Con `hasta < desde` la hoja
	 * no tiene filas y el pie está en `desde`. Se mueve con cada alta o baja.
	 */
	const zonas = new Map<string, { desde: number; hasta: number }>();

	for (const [conductorId, sheetId] of Object.entries(libro.sheetIdPorConductor)) {
		const real = wb?.getSheetBySheetId?.(sheetId)?.getSheetId?.() ?? sheetId;
		setRecorridoBindings(libro.unitId, real, libro.bindingsPorHoja[sheetId] ?? []);
		conductorPorSheetId.set(real, conductorId);
		const rango = libro.rangoPorHoja[sheetId];
		const inicio = libro.inicioDatosPorHoja[sheetId];
		zonas.set(real, rango ? { ...rango } : { desde: inicio, hasta: inicio - 1 });
	}

	const zonaDeDatos = (sheetId: string): ZonaDeDatos | null => {
		const z = zonas.get(sheetId);
		if (!z) return null;
		return z.hasta < z.desde ? { desde: z.desde, hasta: z.desde, vacia: true } : z;
	};

	const filaDelPie = (z: { desde: number; hasta: number }) =>
		z.hasta < z.desde ? z.desde : z.hasta + 1;

	const columnasCasilla = [COL.PERNOCTE, ...dto.bonos.map((_, i) => COL_BONO_INICIO + i)];

	// Casillas. Se cuelgan tras montar porque las reglas de validación NO viajan
	// en el snapshot de la hoja: un libro reconstruido las pierde.
	const conCasillas = hayValidacionDeDatos(ctx.fUniver);
	if (conCasillas) {
		if (editable) {
			for (const [sheetId, rango] of Object.entries(libro.rangoPorHoja)) {
				const real = wb?.getSheetBySheetId?.(sheetId)?.getSheetId?.() ?? sheetId;
				colgarCheckboxSiNo(ctx.fUniver, real, columnasCasilla, rango);
			}
		}
	} else {
		console.warn('[recorridos-engine] sin validación de datos: pernocte y bonos quedan como texto');
	}

	const columnasDerivadas = new Set<number>([COL.ITEM, COL.DIA_SEMANA, colTotal]);

	const desinstalarPermisos = installRecorridosCellPermission(ctx.univer, {
		unitId: libro.unitId,
		editable,
		zonaDeDatos,
		columnasDerivadas: () => columnasDerivadas,
		onBloqueado: opts.onBloqueado
	});

	const hojaDe = (sheetId: string) =>
		(ctx.fUniver.getActiveWorkbook() as any)?.getSheetBySheetId?.(sheetId);

	/** Escribe una celda desde el propio canvas, sin que la guarda la rechace. */
	const escribir = (sheetId: string, r: number, c: number, valor: unknown, estilo?: unknown) => {
		repintando(() => {
			try {
				hojaDe(sheetId)
					?.getRange?.(r, c)
					?.setValue?.(estilo ? { v: valor, s: estilo } : valor);
			} catch (e) {
				console.warn('[recorridos-engine] no se pudo pintar la celda', { sheetId, r, c, e });
			}
		});
	};

	/**
	 * Pinta una fila entera de golpe con las celdas dadas (valor + estilo).
	 *
	 * Univer FUSIONA el estilo nuevo con el que ya tenga la celda, y una fila
	 * insertada nace con el estilo copiado de la de arriba —que puede ser la
	 * cabecera marrón con letra blanca en negrita—. Por eso los estilos de
	 * `celdasFilaVacia` llevan resets explícitos (`bl: 0`, `bg: null`…): un
	 * `clearFormat()` previo no sirve, se aplica asíncrono y borraba lo recién
	 * pintado.
	 */
	const escribirFila = (sheetId: string, r: number, celdas: Record<number, unknown>) => {
		repintando(() => {
			try {
				const fila: unknown[] = [];
				for (let c = 0; c < nCols; c++) fila.push(celdas[c] ?? { v: '' });
				hojaDe(sheetId)?.getRange?.(r, 0, 1, nCols)?.setValues?.([fila]);
			} catch (e) {
				console.warn('[recorridos-engine] no se pudo pintar la fila', { sheetId, r, e });
			}
		});
	};

	/**
	 * Columna `#`: consecutivo por posición, y `+` en los borradores para que
	 * se vea cuáles faltan por guardar.
	 */
	const renumerar = (sheetId: string) => {
		const z = zonas.get(sheetId);
		if (!z || z.hasta < z.desde) return;
		for (let r = z.desde; r <= z.hasta; r++) {
			const esBorrador = getRecorridoBindingsDeFila(libro.unitId, sheetId, r).some(
				(b) => b.binding.tipoFila === 'nueva'
			);
			escribir(sheetId, r, COL.ITEM, esBorrador ? '+' : r - z.desde + 1);
		}
	};

	/** La fórmula del pie sigue a la zona de datos. Sin filas, un cero. */
	const reescribirPie = (sheetId: string) => {
		const z = zonas.get(sheetId);
		if (!z) return;
		repintando(() => {
			try {
				const celda = hojaDe(sheetId)?.getRange?.(filaDelPie(z), colTotal);
				if (z.hasta < z.desde) celda?.setValue?.(0);
				else celda?.setFormula?.(formulaPie(colTotal, z.desde, z.hasta));
			} catch (e) {
				console.warn('[recorridos-engine] no se pudo reescribir el pie', { sheetId, e });
			}
		});
	};

	/** Casilla en una fila nueva, si Univer no la extendió al insertar. */
	const asegurarCasillas = (sheetId: string, r: number) => {
		if (!conCasillas || !editable) return;
		const hoja = hojaDe(sheetId);
		for (const c of columnasCasilla) {
			let tiene = false;
			try {
				tiene = !!hoja?.getRange?.(r, c)?.getDataValidation?.();
			} catch {
				tiene = false;
			}
			if (!tiene) colgarCheckboxSiNo(ctx.fUniver, sheetId, [c], { desde: r, hasta: r });
		}
	};

	const cerrarHistorial = () => {
		try {
			undoRedo.clearUndoRedo(libro.unitId);
		} catch {
			/* noop */
		}
	};

	// ── Altas y bajas de filas ───────────────────────────────────────
	const onMutacionDeFila = (info: Readonly<ICommandInfo>) => {
		if (info.id !== INSERT_ROW_MUTATION && info.id !== REMOVE_ROWS_MUTATION) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			range?: { startRow: number; endRow: number };
		};
		if (params.unitId !== libro.unitId || !params.subUnitId || !params.range) return;
		const sheetId = params.subUnitId;
		const conductorId = conductorPorSheetId.get(sheetId);
		const z = zonas.get(sheetId);
		if (!conductorId || !z) return;

		const { startRow, endRow } = params.range;
		const n = endRow - startRow + 1;
		if (n <= 0) return;

		if (info.id === INSERT_ROW_MUTATION) {
			// Solo dentro de la zona (la guarda ya lo exige); por si acaso, lo que
			// caiga por debajo del pie no es de la tabla.
			if (startRow > filaDelPie(z)) return;
			shiftRecorridoBindings(libro.unitId, sheetId, startRow, n);
			z.hasta = (z.hasta < z.desde ? z.desde - 1 : z.hasta) + n;
			const nuevas: Array<{ row: number; entityId: string }> = [];
			for (let r = startRow; r <= endRow; r++) {
				const entityId = `${PREFIJO_FILA_NUEVA}${crypto.randomUUID()}`;
				setRecorridoBindings(
					libro.unitId,
					sheetId,
					bindingsFilaNueva(r, entityId, conductorId, dto.bonos)
				);
				nuevas.push({ row: r, entityId });
			}
			/// El PINTADO va en la siguiente tarea, no aquí: esta mutación es el
			/// primer paso del comando de Univer, y justo después el propio
			/// comando aplica a las filas nuevas el estilo copiado de la fila
			/// vecina. Pintadas aquí, ese estilo las pisaba (con la cabecera
			/// encima, salían marrones con letra blanca). El comando es síncrono
			/// tras su interceptor, así que un `setTimeout(0)` llega después.
			setTimeout(() => {
				for (const f of nuevas) {
					escribirFila(sheetId, f.row, celdasFilaVacia(dto.bonos, { borrador: true }));
					asegurarCasillas(sheetId, f.row);
				}
				renumerar(sheetId);
				reescribirPie(sheetId);
				cerrarHistorial();
				for (const f of nuevas) opts.onFilaNueva?.({ sheetId, conductorId, row: f.row, entityId: f.entityId });
			}, 0);
			return;
		}

		// Eliminación: qué había en esas filas, ANTES de desplazar el registro.
		const filas: FilaEliminada[] = [];
		for (let r = startRow; r <= endRow; r++) {
			const b = getRecorridoBindingsDeFila(libro.unitId, sheetId, r)[0]?.binding;
			if (b) filas.push({ row: r, tipoFila: b.tipoFila, entityId: b.entityId });
		}
		shiftRecorridoBindings(libro.unitId, sheetId, startRow, -n);
		z.hasta -= n;
		renumerar(sheetId);
		reescribirPie(sheetId);
		cerrarHistorial();
		if (filas.length) opts.onFilasEliminadas?.({ sheetId, conductorId, filas });
	};
	const disposableFilas = commandService.onCommandExecuted(onMutacionDeFila);

	/**
	 * Tras un ARRASTRE, las celdas calculadas vuelven a decir la verdad.
	 *
	 * El tirador escribe series en todo el bloque, también en `#` (1, 2, 3…
	 * desplazados), en el día de la semana (copiado) y en el valor a pagar. Se
	 * renumera, se recalcula el día desde la fecha de cada fila y, en las filas
	 * guardadas, se pide a la página que repinte desde el modelo.
	 */
	const onAutorrelleno = (info: Readonly<ICommandInfo>) => {
		if (info.id !== AUTO_FILL && info.id !== REFILL) return;
		const params = (info.params ?? {}) as {
			unitId?: string;
			subUnitId?: string;
			sourceRange?: { startRow: number; endRow: number; startColumn: number; endColumn: number };
			targetRange?: { startRow: number; endRow: number; startColumn: number; endColumn: number };
		};
		if (params.unitId && params.unitId !== libro.unitId) return;
		const wbActivo = ctx.fUniver.getActiveWorkbook() as any;
		if (!params.unitId && wbActivo?.getId?.() !== libro.unitId) return;
		const sheetId = params.subUnitId ?? wbActivo?.getActiveSheet?.()?.getSheetId?.();
		const z = sheetId ? zonas.get(sheetId) : undefined;
		if (!sheetId || !z || !params.targetRange) return;

		const desde = Math.max(params.targetRange.startRow, z.desde);
		const hasta = Math.min(params.targetRange.endRow, z.hasta);
		if (hasta < desde) return;

		/// En la siguiente tarea: el adapter de la página aún está procesando el
		/// mismo comando y puede rechazar una fecha (la repone); el día tiene que
		/// calcularse sobre lo que quede al final.
		setTimeout(() => {
			const hoja = hojaDe(sheetId);
			const guardadas: string[] = [];
			for (let r = desde; r <= hasta; r++) {
				const b = getRecorridoBindingsDeFila(libro.unitId, sheetId, r)[0]?.binding;
				if (b && b.tipoFila !== 'nueva') {
					guardadas.push(b.entityId);
					continue;
				}
				/// `getValue()` y no el crudo: Univer convierte una fecha escrita en
				/// serial con formato `yyyy-mm-dd`, y el crudo es ese número. El
				/// formateado vuelve a ser «2026-09-09», que es lo que se entiende.
				let fecha: string | null = null;
				try {
					fecha = fechaDesdeCelda(hoja?.getRange?.(r, COL.FECHA)?.getValue?.());
				} catch {
					fecha = null;
				}
				escribir(sheetId, r, COL.DIA_SEMANA, fecha ? diaSemana(fecha) : '');
				escribir(sheetId, r, colTotal, 0);
			}
			renumerar(sheetId);
			if (guardadas.length) opts.onRepintarFilas?.(guardadas);
		}, 0);
	};
	const disposableAutorrelleno = commandService.onCommandExecuted(onAutorrelleno);

	/**
	 * La FECHA arrastrada sigue una serie de días, como en Excel.
	 *
	 * Univer ve «2026-09-01» como texto con un número al final: hacia arriba
	 * escribe «2026-09-00» y sigue restando, y hacia abajo pasa del 31. Se
	 * reescriben las fechas rellenadas con la serie correcta —cruzando el mes—
	 * antes de que el adapter las lea (él mismo lo llama). Las que se salen
	 * del corte se dejan en blanco y se avisa una vez: el arrastre llega hasta
	 * donde el corte permite.
	 */
	const corregirSerieDeFechas = (
		sheetId: string,
		origen: IRange | undefined,
		destino: IRange
	) => {
		const z = zonas.get(sheetId);
		if (!origen || !z) return;
		if (destino.startColumn > COL.FECHA || destino.endColumn < COL.FECHA) return;
		// Solo el arrastre VERTICAL: en horizontal la fecha no se copia a otra columna.
		if (destino.startRow === origen.startRow && destino.endRow === origen.endRow) return;
		const hoja = hojaDe(sheetId);
		const leer = (r: number) => {
			try {
				return fechaDesdeCelda(hoja?.getRange?.(r, COL.FECHA)?.getValue?.());
			} catch {
				return null;
			}
		};
		const fechasOrigen: Array<string | null> = [];
		for (let r = origen.startRow; r <= origen.endRow; r++) fechasOrigen.push(leer(r));

		let fueraDelCorte = 0;
		for (const franja of rellenado(origen, destino)) {
			if (franja.startColumn > COL.FECHA || franja.endColumn < COL.FECHA) continue;
			const hacia = franja.startRow > origen.endRow ? 'abajo' : 'arriba';
			const n = franja.endRow - franja.startRow + 1;
			const serie = serieDeFechas(fechasOrigen, n, hacia);
			if (!serie) continue;
			for (let i = 0; i < n; i++) {
				const r = franja.startRow + i;
				if (r < z.desde || r > z.hasta) continue;
				const fecha = serie[i];
				const cabe = fecha >= dto.desde && fecha <= dto.hasta;
				if (!cabe) fueraDelCorte++;
				escribir(sheetId, r, COL.FECHA, cabe ? fecha : '');
			}
		}
		if (fueraDelCorte) {
			opts.onBloqueado?.({
				titulo: 'El arrastre se detuvo en el límite del corte',
				detalle: `${fueraDelCorte} fila(s) quedaron sin fecha porque caían fuera de ${dto.desde} a ${dto.hasta}. Cambia de corte si necesitas esos días.`
			});
		}
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

		pintarCelda(entityId, field, valor) {
			const celda = getRecorridoCellFor(libro.unitId, entityId, field);
			if (!celda) return;
			if (field === 'pernocte' || field.startsWith('bono:')) {
				const marcado = valor === true || valor === 'SÍ' || valor === 'SI';
				escribir(celda.sheetId, celda.row, celda.column, comoCasilla(marcado), estiloCasilla(marcado));
				return;
			}
			escribir(celda.sheetId, celda.row, celda.column, valor ?? '');
			if (field === 'fecha') {
				escribir(celda.sheetId, celda.row, COL.DIA_SEMANA, diaSemana(String(valor ?? '')));
			}
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
				if (c.field === 'tipo_dia') {
					escribir(c.sheetId, c.row, c.column, fila.tipo_dia, estiloTipo(fila.tipo_dia, false));
					continue;
				}
				const valor = (fila as unknown as Record<string, unknown>)[c.field];
				escribir(c.sheetId, c.row, c.column, valor ?? '');
			}

			// Derivadas: el día de la semana sale de la fecha, el tipo de día es
			// del DÍA (en un recorrido no tiene binding, pero sí se pinta) y el
			// valor a pagar de los bonos. Se pintan con el resto para que la fila
			// quede coherente en una sola pasada.
			const primera = celdas[0];
			escribir(primera.sheetId, primera.row, COL.DIA_SEMANA, diaSemana(fila.fecha));
			escribir(primera.sheetId, primera.row, COL.TIPO, fila.tipo_dia, estiloTipo(fila.tipo_dia, false));
			escribir(primera.sheetId, primera.row, colTotal, valorFila(fila, dto.bonos));
		},

		vincularFila(entityId, fila) {
			const celda = getRecorridoCellFor(libro.unitId, entityId, 'fecha');
			if (!celda) return;
			const conductorId = conductorPorSheetId.get(celda.sheetId);
			if (!conductorId) return;
			clearRecorridoBindingsDeFila(libro.unitId, celda.sheetId, celda.row);
			escribirFila(celda.sheetId, celda.row, celdasFilaVacia(dto.bonos));
			setRecorridoBindings(
				libro.unitId,
				celda.sheetId,
				bindingsDeFila(celda.row, fila, conductorId, dto.bonos)
			);
			engine.pintarFila(fila.segmento_id ?? fila.registro_dia_id, fila);
			renumerar(celda.sheetId);
		},

		corregirRelleno(sheetId, origen, destino) {
			corregirSerieDeFechas(sheetId, origen, destino);
		},

		posicionDe(entityId) {
			const celda =
				getRecorridoCellFor(libro.unitId, entityId, 'fecha') ??
				getRecorridoCeldasDeEntidad(libro.unitId, entityId)[0];
			return celda ? { sheetId: celda.sheetId, row: celda.row } : null;
		},

		activar(conductorId) {
			const sheetId = libro.sheetIdPorConductor[conductorId];
			if (sheetId) activarHoja(ctx, sheetId);
		},

		hojaActivaId: () => hojaActiva(ctx),

		dispose() {
			for (const d of [disposableFilas, disposableAutorrelleno]) {
				try {
					d.dispose();
				} catch {
					/* noop */
				}
			}
			try {
				desinstalarPermisos();
			} catch {
				/* noop */
			}
			/// Los bindings NO se purgan aquí: los purga el engine que se monte
			/// después, al nacer. Si este `dispose` corriera tras el montaje del
			/// siguiente para el mismo periodo —pasa con la recarga en caliente
			/// de desarrollo—, le borraría los suyos y la hoja quedaría muda.
			disposeEngine(ctx.univer, ctx.fUniver, ctx.unitId, container);
		}
	};

	return engine;
}

export { conductorIdDeSheetId };
