/**
 * Engine del canvas de historial de liquidaciones de servicios.
 *
 * Envoltorio sobre `createLiquidacionEngine` con TRES hojas (Liquidaciones,
 * Facturas, Terceros) y mutación EN VIVO de la geometría: cuando otra sesión
 * crea/edita/elimina una liquidación o una factura, este engine inserta o
 * quita las filas del bloque afectado sin reconstruir el libro — remontar
 * costaría rehacer miles de filas y, lo que de verdad molesta, devolvería el
 * scroll al principio.
 *
 * Todas las escrituras pasan por `repintando()`: la hoja es de solo lectura
 * para el usuario (ver `cell-permission-servicios-historial.ts`) y esa
 * ventana es la única puerta por la que entran las del propio canvas.
 *
 * Los TOTALES del pie se reescriben tras cada cambio de geometría: las
 * fórmulas `=SUM(...)` NO se auto-expanden cuando la inserción ocurre en el
 * borde del rango (misma semántica que Excel), así que confiar en el ajuste
 * automático dejaría fuera justo las filas recién insertadas.
 */

import type { IStyleData, ICellData } from '@univerjs/core';
import {
	createLiquidacionEngine,
	disposeEngine,
	type EngineContext
} from './engine';
import { repintando } from './cell-permission-servicios-historial';
import {
	buildHistorialServiciosWorkbook,
	bloqueLiquidacion,
	COL,
	TOTAL_COLS,
	COLS_SUMADAS_ITEM,
	type DatosHistorial,
	type HistorialWorkbook
} from '../builders/servicios-historial.builder';
import { desplazarFilas, desplazarFilasSimples } from './historial-indices';
import {
	crearResaltador,
	MS_DESTELLO,
	RESALTADO_ENTRADA,
	RESALTADO_SELECCION,
	type FilaPintable
} from './historial-resaltado';
import { totalesVisibles } from '../canvas/totales-visibles';
import { resumirCriterio } from '../canvas/resumen-filtro';
import {
	filaFacturaCeldas,
	FCOL,
	FACTURAS_TOTAL_COLS,
	type FilaFactura
} from '../builders/servicios-historial-facturas.builder';
import { TCOL, TERCEROS_TOTAL_COLS } from '../builders/servicios-historial-terceros.builder';
import { colLetra, MUTED, TEXT_DARK, TOTALES_BG, allBorders } from '../builders/historial-comun';
import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';
import type { FacturaLiquidacion } from '$lib/api/facturacionLiquidaciones';

export { disposeEngine };

export type HojaHistorial = 'liquidaciones' | 'facturas' | 'terceros';

/** Un filtro puesto en una columna, ya redactado para enseñarlo. */
export interface FiltroActivo {
	/// Índice de columna en Univer, para poder quitarlo.
	col: number;
	/// Etiqueta tal como está escrita en la cabecera de la hoja.
	columna: string;
	/// Qué deja ver, en corto: «ACME, Beta +3», «> 1000», «solo vacías».
	resumen: string;
}

export interface HistorialEngineContext extends EngineContext {
	/// Ids REALES de las hojas tras `createWorkbook` (puede renombrarlos).
	sheetIds: Record<HojaHistorial, string>;
	/// Índices producidos por el builder. MUTABLES: las operaciones en vivo
	/// los mantienen al día.
	modelo: HistorialWorkbook;
	/// Escribe una celda concreta de una hoja (valor + estilo).
	pintarCelda: (
		hoja: HojaHistorial,
		fila: number,
		columna: number,
		valor: string | number,
		estilo: IStyleData
	) => void;
	activar: (hoja: HojaHistorial) => boolean;
	hojaActiva: () => HojaHistorial | null;
	/**
	 * Filas que el autofiltro tiene ocultas en esa hoja.
	 *
	 * La página las necesita para que una acción del carril no actúe sobre lo
	 * que no está en pantalla: con un filtro puesto, «seleccionar todo y
	 * eliminar» incluiría las filas escondidas, que es exactamente lo que nadie
	 * espera al filtrar.
	 */
	filasFiltradas: (hoja: HojaHistorial) => ReadonlySet<number>;
	/**
	 * Los filtros puestos ahora mismo en esa hoja, en orden de columna.
	 *
	 * La toolbar los lista porque un filtro en una columna que quedó fuera de
	 * la pantalla es invisible, y entonces se leen doce filas creyendo que son
	 * todas las que hay.
	 */
	filtrosActivos: (hoja: HojaHistorial) => FiltroActivo[];
	/** Quita el filtro de UNA columna. */
	quitarFiltro: (hoja: HojaHistorial, col: number) => void;
	/** Quita todos los filtros de la hoja. */
	limpiarFiltros: (hoja: HojaHistorial) => void;
	/** Alta en vivo: inserta el bloque de filas de la liquidación ARRIBA. */
	insertarLiquidacion: (l: LiquidacionServicio) => boolean;
	/** Baja en vivo: quita el bloque de filas de la liquidación. */
	eliminarLiquidacion: (liquidacionId: string) => boolean;
	/**
	 * Edición en vivo: reemplaza el bloque (los ítems pueden haber cambiado
	 * de número, así que repintar celdas no basta). Conserva la posición.
	 */
	actualizarLiquidacion: (l: LiquidacionServicio) => boolean;
	insertarFactura: (f: FacturaLiquidacion) => boolean;
	/** Repinta la fila de una factura (estado, total, consecutivos…). */
	actualizarFactura: (f: FacturaLiquidacion) => boolean;
	eliminarFactura: (facturaId: string) => boolean;
	/**
	 * Resalta el bloque completo de estas liquidaciones y despinta el resto.
	 *
	 * Se le pasan IDS y no filas a propósito: quien llama tiene la selección en
	 * coordenadas de fila, pero lo que quiere resaltar es «la liquidación a la
	 * que pertenece esa fila», y la traducción vive aquí, junto al índice.
	 */
	resaltarLiquidaciones: (ids: readonly string[]) => void;
	/**
	 * Destella una liquidación que acaba de llegar o cambiar por socket, y
	 * devuelve su color al cabo de unos segundos.
	 */
	destellarLiquidacion: (id: string) => void;
	/** Destella la fila de una factura recién llegada. */
	destellarFactura: (facturaId: string) => void;
	/** Lleva la vista a la primera fila de una liquidación y la destella. */
	irALiquidacion: (id: string) => boolean;
	/** Lleva la vista a la fila de una factura y la destella. */
	irAFactura: (facturaId: string) => boolean;
}

const NOMBRE_POR_HOJA: Record<HojaHistorial, string> = {
	liquidaciones: 'Liquidaciones',
	facturas: 'Facturas',
	terceros: 'Terceros'
};

export function createHistorialEngine(opts: {
	container: HTMLElement;
	datos: DatosHistorial;
	/**
	 * Aviso de que el usuario tocó el autofiltro.
	 *
	 * El engine repinta los pies por su cuenta, pero la página también depende
	 * de qué filas están ocultas —para no operar sobre lo que no se ve— y su
	 * `ctx` es `$state.raw`: mutar el conjunto por dentro no despierta a nadie.
	 * Este callback es el que le permite invalidar sus derivados.
	 */
	onFiltroCambiado?: () => void;
}): HistorialEngineContext {
	const modelo = buildHistorialServiciosWorkbook(opts.datos);

	const ctx = createLiquidacionEngine({
		container: opts.container,
		workbookData: modelo.workbook,
		/**
		 * NO se usa `readOnly: true` aquí, y no es un olvido.
		 *
		 * `readOnly` hace `setEditable(false)`, que baja
		 * `WorkbookEditablePermission`. En `@univerjs/sheets` 0.25.1 esa misma
		 * bandera es la que consulta `_getPermissionCheck` para dejar pasar
		 * `SetRangeValuesCommand` (`case SetRangeValuesCommand.id` →
		 * `_permissionCheckBySetRangeValue({ workbookTypes: [WorkbookEditablePermission] … })`).
		 * Es decir: bloquearía también las escrituras del PROPIO canvas —el
		 * número de factura tras facturar, las liquidaciones que entran por
		 * socket y el resaltado de filas—, que son la mitad de lo que hace esta
		 * pantalla.
		 *
		 * La hoja se cierra a mano en `installHistorialCellPermission`, que
		 * corta en `beforeCommandExecuted` y tiene la ventana `repintando()`
		 * para dejar pasar lo que escribe el engine. Ahí sí se distingue quién
		 * escribe; con el permiso del workbook, no.
		 */
		// Footer tipo Excel: sheet bar para navegar entre las tres hojas y
		// barra de estadísticas (seleccionas un bloque de VR. ITEM y ves la
		// suma sin sacar calculadora).
		footer: { sheetBar: true, statisticBar: true, zoomSlider: true, menus: false },
		// Autofiltro tipo Excel en las cabeceras de las tres hojas. El rango lo
		// pone `crearFiltros()` más abajo; el preset solo aporta el desplegable.
		filtros: true
	});

	// ── Resolución de ids reales ──
	//
	// `createWorkbook` no garantiza respetar los ids que pide el builder. Se
	// resuelven UNA vez por NOMBRE de hoja, que sí se conserva.
	const wb = () => ctx.fUniver.getActiveWorkbook();
	const sheetIds: Record<HojaHistorial, string> = {
		liquidaciones: modelo.sheetId,
		facturas: modelo.facturas.sheetId,
		terceros: modelo.terceros.sheetId
	};
	for (const hoja of Object.keys(NOMBRE_POR_HOJA) as HojaHistorial[]) {
		const ws = (wb() as any)?.getSheetByName?.(NOMBRE_POR_HOJA[hoja]);
		const id = ws?.getSheetId?.();
		if (id) sheetIds[hoja] = id;
	}

	const hojaDe = (hoja: HojaHistorial) =>
		(wb() as any)?.getSheetBySheetId?.(sheetIds[hoja]) ?? null;

	const pintarCelda = (
		hoja: HojaHistorial,
		fila: number,
		columna: number,
		valor: string | number,
		estilo: IStyleData
	) => {
		const ws = hojaDe(hoja);
		if (!ws) return;
		repintando(() => {
			ws.getRange(fila, columna, 1, 1).setValue({ v: valor, s: estilo } as any);
		});
	};

	const activar = (hoja: HojaHistorial): boolean => {
		try {
			const ws = hojaDe(hoja);
			if (!ws) return false;
			(wb() as any).setActiveSheet(ws);
			return true;
		} catch {
			return false;
		}
	};

	const hojaActiva = (): HojaHistorial | null => {
		try {
			const id = (wb() as any)?.getActiveSheet?.()?.getSheetId?.();
			for (const hoja of Object.keys(sheetIds) as HojaHistorial[]) {
				if (sheetIds[hoja] === id) return hoja;
			}
		} catch {
			/* noop */
		}
		return null;
	};

	// ── Escritura de bloques ──

	/// Escribe una matriz de celdas. `setValues` acepta ICellData[][] (probado
	/// contra 0.25.1); si en alguna versión regresara, cae al bucle celda a
	/// celda, que es lento pero nunca deja la fila a medias.
	function escribirMatriz(ws: any, fila: number, celdas: ICellData[][]) {
		const rango = ws.getRange(fila, 0, celdas.length, celdas[0]?.length ?? TOTAL_COLS);
		try {
			rango.setValues(celdas);
		} catch {
			celdas.forEach((filaCeldas, i) => {
				filaCeldas.forEach((celda, c) => {
					if (celda) ws.getRange(fila + i, c, 1, 1).setValue(celda);
				});
			});
		}
	}

	// ── Totales de la hoja de liquidaciones ──

	// ─── Autofiltro ────────────────────────────────────────────────────
	//
	// El desplegable de Excel en cada celda de cabecera. Lo aporta el preset
	// (`filtros: true`), pero el RANGO hay que declararlo: sin él no hay botón.
	//
	// El rango llega hasta la última fila de datos y NO incluye el pie: dentro
	// del filtro, «totales» sería un valor más del desplegable y el pie
	// desaparecería al filtrar por cualquier otra cosa.

	/// Filas que el filtro tiene ocultas, por hoja. Se cachea porque el pie se
	/// repinta también por otros motivos —un alta en vivo— y entonces hay que
	/// seguir respetando el filtro que ya estuviera puesto.
	const filtradas: Record<HojaHistorial, Set<number>> = {
		liquidaciones: new Set(),
		facturas: new Set(),
		terceros: new Set()
	};

	function leerFiltradas(hoja: HojaHistorial): Set<number> {
		try {
			const f = hojaDe(hoja)?.getFilter?.();
			return new Set<number>(f?.getFilteredOutRows?.() ?? []);
		} catch {
			return new Set<number>();
		}
	}

	/// Nº de columnas de cada hoja. Lo usan el barrido de criterios del
	/// autofiltro —que no expone «qué columnas tienen criterio» y hay que
	/// preguntar una a una— y `irAFila`, para seleccionar la fila entera.
	const COLUMNAS_POR_HOJA: Record<HojaHistorial, number> = {
		liquidaciones: TOTAL_COLS,
		facturas: FACTURAS_TOTAL_COLS,
		terceros: TERCEROS_TOTAL_COLS
	};

	function filtrosActivos(hoja: HojaHistorial): FiltroActivo[] {
		const ws = hojaDe(hoja);
		const filtro = ws?.getFilter?.();
		if (!filtro) return [];
		const out: FiltroActivo[] = [];
		for (let c = 0; c < COLUMNAS_POR_HOJA[hoja]; c++) {
			let resumen: string | null = null;
			try {
				resumen = resumirCriterio(filtro.getColumnFilterCriteria?.(c));
			} catch {
				continue;
			}
			if (!resumen) continue;
			/// La etiqueta se lee de la CABECERA de la hoja y no de una constante
			/// del builder: así el chip dice exactamente lo mismo que la columna
			/// que el usuario está mirando, y no hay dos listas que mantener.
			let columna = `Columna ${c + 1}`;
			try {
				const v = ws.getRange(0, c, 1, 1).getValue?.();
				const texto = typeof v === 'object' && v !== null ? (v as any).v : v;
				if (texto != null && String(texto).trim()) columna = String(texto).trim();
			} catch {
				// Con la etiqueta genérica el chip sigue sirviendo.
			}
			out.push({ col: c, columna, resumen });
		}
		return out;
	}

	function quitarFiltro(hoja: HojaHistorial, col: number) {
		try {
			hojaDe(hoja)?.getFilter?.()?.removeColumnFilterCriteria?.(col);
		} catch (e) {
			console.warn('[historial] no se pudo quitar el filtro de la columna', col, e);
		}
	}

	function limpiarFiltros(hoja: HojaHistorial) {
		try {
			hojaDe(hoja)?.getFilter?.()?.removeFilterCriteria?.();
		} catch (e) {
			console.warn('[historial] no se pudieron limpiar los filtros de', hoja, e);
		}
	}

	function crearFiltros() {
		const rangos: Array<[HojaHistorial, number, number]> = [
			// [hoja, última fila de datos, nº de columnas]
			['liquidaciones', modelo.anclas.ultimaFila, TOTAL_COLS],
			['facturas', modelo.facturas.anclas.totales - 1, FACTURAS_TOTAL_COLS],
			['terceros', modelo.terceros.totalFilas, TERCEROS_TOTAL_COLS]
		];
		for (const [hoja, ultima, columnas] of rangos) {
			try {
				const ws = hojaDe(hoja);
				/// Una hoja sin datos deja el rango en la sola cabecera, que Univer
				/// acepta pero deja un desplegable que no filtra nada. Mejor sin él.
				if (!ws || ultima < 1) continue;
				repintando(() => {
					ws.getRange(0, 0, ultima + 1, columnas).createFilter();
				});
			} catch (e) {
				// Que el histórico se vea sin filtros es peor que no verse.
				console.warn('[historial] no se pudo crear el filtro de', hoja, e);
			}
		}
	}

	const ESTILO_TOTALES: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders()
	};
	const ESTILO_TOTALES_MONEY: IStyleData = {
		...ESTILO_TOTALES,
		n: { pattern: '"$"#,##0' }
	} as any;

	/**
	 * Repinta el pie de la hoja de liquidaciones.
	 *
	 * Las columnas de ÍTEM van con `SUBTOTAL(109,…)`, que el motor de fórmulas
	 * calcula ignorando lo que el filtro oculta. Las de LIQUIDACIÓN no pueden
	 * ser fórmula —su importe se repite en cada fila del bloque y un `SUM`
	 * contaría la misma liquidación una vez por ítem—, así que se calculan aquí
	 * a partir de `modelo.filas`, que es lo que de verdad hay en la hoja.
	 *
	 * Se deriva de `modelo.filas` y no del acumulador `modelo.sumas` a propósito:
	 * el acumulador no sabe nada del filtro, y tener dos fuentes para el mismo
	 * número es como acaban divergiendo.
	 */
	function repintarTotalesLiquidaciones() {
		const ws = hojaDe('liquidaciones');
		if (!ws) return;
		const { anclas } = modelo;
		const r = anclas.totales;
		const ocultas = filtradas.liquidaciones;
		const t = totalesVisibles(modelo.filas.values(), ocultas);
		repintando(() => {
			ws.getRange(r, COL.CONSECUTIVO, 1, 1).setValue({
				/// Con filtro se dice de cuántas: un «3 liquidaciones» a secas
				/// debajo de una hoja filtrada se lee como que solo hay tres.
				v: ocultas.size
					? `${t.liquidaciones} de ${modelo.totalLiquidaciones} liquidaciones · ${t.items} ítems`
					: `${t.liquidaciones} liquidaciones · ${t.items} ítems`,
				s: ESTILO_TOTALES
			} as any);
			for (const c of COLS_SUMADAS_ITEM) {
				const letra = colLetra(c);
				ws.getRange(r, c, 1, 1).setValue({
					f: `=SUBTOTAL(109,${letra}${anclas.primeraFila + 1}:${letra}${anclas.ultimaFila + 1})`,
					s: c === COL.CANTIDAD ? ESTILO_TOTALES : ESTILO_TOTALES_MONEY
				} as any);
			}
			ws.getRange(r, COL.SUBTOTAL, 1, 1).setValue({ v: t.subtotal, s: ESTILO_TOTALES_MONEY } as any);
			ws.getRange(r, COL.IVA, 1, 1).setValue({ v: t.iva, s: ESTILO_TOTALES_MONEY } as any);
			ws.getRange(r, COL.TOTAL, 1, 1).setValue({ v: t.total, s: ESTILO_TOTALES_MONEY } as any);
		});
	}

	/// Desplaza todos los índices de fila >= `desde` en `delta` filas.
	/// La aritmética vive en `historial-indices.ts`, que sí se puede probar
	/// sin instanciar Univer (ver `tests/servicios-historial-indices`).
	function desplazarIndices(desde: number, delta: number) {
		desplazarFilas(modelo, desde, delta);
	}

	/// Inserta el bloque de `l` en la fila indicada. NO toca los totales.
	function insertarBloqueEn(l: LiquidacionServicio, filaInsert: number, zebra: boolean): boolean {
		const ws = hojaDe('liquidaciones');
		if (!ws) return false;
		const bloque = bloqueLiquidacion(l, { filaInicial: filaInsert, zebra });
		const n = bloque.celdas.length;

		repintando(() => {
			ws.insertRowsBefore(filaInsert, n);
		});
		desplazarIndices(filaInsert, n);
		repintando(() => {
			escribirMatriz(ws, filaInsert, bloque.celdas);
		});

		const filasDeEsta: number[] = [];
		for (const info of bloque.infos) {
			modelo.filas.set(info.fila, info);
			filasDeEsta.push(info.fila);
		}
		modelo.filasPorLiquidacion.set(l.id, filasDeEsta);

		modelo.totalLiquidaciones += 1;
		modelo.totalItems += n;
		modelo.sumas.subtotal += Number(l.subtotal) || 0;
		modelo.sumas.iva += Number(l.valor_iva) || 0;
		modelo.sumas.total += Number(l.total) || 0;
		return true;
	}

	/// Quita el bloque de la liquidación. NO toca los totales.
	function quitarBloque(liquidacionId: string): { fila: number; zebra: boolean } | null {
		const ws = hojaDe('liquidaciones');
		const filas = modelo.filasPorLiquidacion.get(liquidacionId);
		if (!ws || !filas || filas.length === 0) return null;

		const primera = Math.min(...filas);
		const n = filas.length;
		const zebra = modelo.filas.get(primera)?.zebra ?? false;
		const info = modelo.filas.get(primera);

		repintando(() => {
			ws.deleteRows(primera, n);
		});

		for (const f of filas) modelo.filas.delete(f);
		modelo.filasPorLiquidacion.delete(liquidacionId);
		desplazarIndices(primera + n, -n);

		modelo.totalLiquidaciones -= 1;
		modelo.totalItems -= n;
		if (info) {
			modelo.sumas.subtotal -= info.subtotal;
			modelo.sumas.iva -= info.iva;
			modelo.sumas.total -= info.total;
		}
		return { fila: primera, zebra };
	}

	const insertarLiquidacion = (l: LiquidacionServicio): boolean => {
		try {
			if (modelo.filasPorLiquidacion.has(l.id)) return actualizarLiquidacion(l);
			// Arriba del todo: el listado ordena por `created_at desc`, así que
			// una liquidación nueva pertenece a la primera fila.
			const filaInsert = modelo.anclas.primeraFila;
			const zebraPrimera = modelo.filas.get(filaInsert)?.zebra ?? true;
			const ok = insertarBloqueEn(l, filaInsert, !zebraPrimera);
			if (ok) repintarTotalesLiquidaciones();
			return ok;
		} catch (e) {
			console.error('[historial] insertarLiquidacion falló', e);
			return false;
		}
	};

	const eliminarLiquidacion = (liquidacionId: string): boolean => {
		try {
			const quitado = quitarBloque(liquidacionId);
			if (quitado) repintarTotalesLiquidaciones();
			return !!quitado;
		} catch (e) {
			console.error('[historial] eliminarLiquidacion falló', e);
			return false;
		}
	};

	const actualizarLiquidacion = (l: LiquidacionServicio): boolean => {
		try {
			if (!modelo.filasPorLiquidacion.has(l.id)) return insertarLiquidacion(l);
			const quitado = quitarBloque(l.id);
			if (!quitado) return false;
			const ok = insertarBloqueEn(l, quitado.fila, quitado.zebra);
			repintarTotalesLiquidaciones();
			return ok;
		} catch (e) {
			console.error('[historial] actualizarLiquidacion falló', e);
			return false;
		}
	};

	// ── Facturas ──

	function repintarTotalesFacturas() {
		const ws = hojaDe('facturas');
		if (!ws) return;
		const m = modelo.facturas;
		const r = m.anclas.totales;
		const ocultas = filtradas.facturas;
		/// La suma es solo de ACTIVAS, así que no puede ser `SUBTOTAL`: hay que
		/// filtrar por estado además de por lo que oculte el autofiltro.
		let visibles = 0;
		let sumaVisiblesActivas = 0;
		for (const f of m.filas.values()) {
			if (ocultas.has(f.fila)) continue;
			visibles += 1;
			if (f.estado === 'ACTIVA') sumaVisiblesActivas += f.valor_total || 0;
		}
		repintando(() => {
			ws.getRange(r, FCOL.NUMERO, 1, 1).setValue({
				v: ocultas.size ? `${visibles} de ${m.filas.size} facturas` : `${visibles} facturas`,
				s: ESTILO_TOTALES
			} as any);
			const letra = colLetra(FCOL.LIQUIDACIONES);
			ws.getRange(r, FCOL.LIQUIDACIONES, 1, 1).setValue({
				f: `=SUBTOTAL(109,${letra}${m.anclas.primeraFila + 1}:${letra}${r})`,
				s: ESTILO_TOTALES
			} as any);
			ws.getRange(r, FCOL.VALOR_TOTAL, 1, 1).setValue({
				v: sumaVisiblesActivas,
				s: ESTILO_TOTALES_MONEY
			} as any);
			ws.getRange(r, FCOL.FACTURADO_POR, 1, 1).setValue({
				v: 'Σ solo ACTIVAS',
				s: { ...ESTILO_TOTALES, fs: 9, cl: { rgb: MUTED } } as any
			} as any);
		});
	}

	function desplazarIndicesFacturas(desde: number, delta: number) {
		const m = modelo.facturas;
		m.filas = desplazarFilasSimples(m.filas, m.filaPorFactura, m.anclas, desde, delta);
	}

	const insertarFactura = (f: FacturaLiquidacion): boolean => {
		try {
			const m = modelo.facturas;
			if (m.filaPorFactura.has(f.id)) return actualizarFactura(f);
			const ws = hojaDe('facturas');
			if (!ws) return false;
			const fila = m.anclas.primeraFila;
			const zebra = !(m.filas.get(fila)?.zebra ?? true);

			repintando(() => {
				ws.insertRowsBefore(fila, 1);
			});
			desplazarIndicesFacturas(fila, 1);
			repintando(() => {
				escribirMatriz(ws, fila, [filaFacturaCeldas(f, zebra, m.filas.size + 1)]);
			});
			m.filas.set(fila, {
				fila,
				id: f.id,
				numero_factura: f.numero_factura,
				estado: f.estado,
				valor_total: Number(f.valor_total) || 0,
				zebra
			});
			m.filaPorFactura.set(f.id, fila);
			if (f.estado === 'ACTIVA') m.sumaActivas += Number(f.valor_total) || 0;
			repintarTotalesFacturas();
			return true;
		} catch (e) {
			console.error('[historial] insertarFactura falló', e);
			return false;
		}
	};

	const actualizarFactura = (f: FacturaLiquidacion): boolean => {
		try {
			const m = modelo.facturas;
			const fila = m.filaPorFactura.get(f.id);
			if (fila == null) return insertarFactura(f);
			const ws = hojaDe('facturas');
			if (!ws) return false;
			const info = m.filas.get(fila);
			const zebra = info?.zebra ?? false;

			// Ajuste del pie por delta: sale la contribución vieja, entra la nueva.
			if (info?.estado === 'ACTIVA') m.sumaActivas -= info.valor_total;
			if (f.estado === 'ACTIVA') m.sumaActivas += Number(f.valor_total) || 0;

			repintando(() => {
				escribirMatriz(ws, fila, [
					filaFacturaCeldas(f, zebra, fila - m.anclas.primeraFila + 1)
				]);
			});
			if (info) {
				info.estado = f.estado;
				info.valor_total = Number(f.valor_total) || 0;
				info.numero_factura = f.numero_factura;
			}
			repintarTotalesFacturas();
			return true;
		} catch (e) {
			console.error('[historial] actualizarFactura falló', e);
			return false;
		}
	};

	const eliminarFactura = (facturaId: string): boolean => {
		try {
			const m = modelo.facturas;
			const fila = m.filaPorFactura.get(facturaId);
			if (fila == null) return false;
			const ws = hojaDe('facturas');
			if (!ws) return false;
			const info = m.filas.get(fila);

			repintando(() => {
				ws.deleteRows(fila, 1);
			});
			m.filas.delete(fila);
			m.filaPorFactura.delete(facturaId);
			desplazarIndicesFacturas(fila + 1, -1);
			if (info?.estado === 'ACTIVA') m.sumaActivas -= info.valor_total;
			repintarTotalesFacturas();
			return true;
		} catch (e) {
			console.error('[historial] eliminarFactura falló', e);
			return false;
		}
	};

	/**
	 * Repinta el rótulo de conteo de la hoja de terceros.
	 *
	 * Sus columnas de dinero ya son `SUBTOTAL(109,…)` y siguen al filtro solas;
	 * lo único que se queda atrás es el «N ítems».
	 */
	function repintarConteoTerceros() {
		const ws = hojaDe('terceros');
		const total = modelo.terceros.totalFilas;
		if (!ws || total === 0) return;
		const ocultas = filtradas.terceros;
		let visibles = 0;
		for (let f = 1; f <= total; f++) if (!ocultas.has(f)) visibles += 1;
		repintando(() => {
			ws.getRange(total + 1, TCOL.CONSECUTIVO, 1, 1).setValue({
				v: ocultas.size ? `${visibles} de ${total} ítems` : `${visibles} ítems`,
				s: ESTILO_TOTALES
			} as any);
		});
	}

	// ─── Enganche del autofiltro ───────────────────────────────────────
	//
	// Se relee de la hoja en vez de deducirlo del evento: el evento dice qué
	// criterio cambió, no qué filas quedaron fuera, y componer eso a mano
	// significaría reimplementar el filtro.
	//
	// No hace falta desuscribir: estos listeners viven en la instancia de
	// Univer, y `disposeEngine` se la lleva entera.
	function alCambiarElFiltro() {
		filtradas.liquidaciones = leerFiltradas('liquidaciones');
		filtradas.facturas = leerFiltradas('facturas');
		filtradas.terceros = leerFiltradas('terceros');
		repintarTotalesLiquidaciones();
		repintarTotalesFacturas();
		repintarConteoTerceros();
		opts.onFiltroCambiado?.();
	}

	crearFiltros();
	try {
		const ev = ctx.fUniver.Event;
		ctx.fUniver.addEvent(ev.SheetRangeFiltered, alCambiarElFiltro);
		ctx.fUniver.addEvent(ev.SheetRangeFilterCleared, alCambiarElFiltro);
	} catch (e) {
		// Sin los eventos el filtro sigue funcionando; lo que se queda atrás es
		// el pie, así que conviene que se note en consola y no en una factura.
		console.warn('[historial] no se pudo escuchar el cambio de filtro', e);
	}

	// ── Resaltado ──────────────────────────────────────────────────────
	//
	// Dos resaltadores por hoja y no uno: la selección y el destello de socket
	// se pisarían. Con capas separadas, un bloque que llega por socket mientras
	// está seleccionado recupera el ámbar de la selección al apagarse el
	// destello, en vez de quedarse blanco.

	/// La columna de ESTADO conserva su fondo: codifica el estado y es
	/// justamente lo que se está mirando al seleccionar.
	const OPTS_LIQ = {
		totalColumnas: TOTAL_COLS,
		columnasExcluidas: new Set<number>([COL.ESTADO])
	};
	const OPTS_FAC = {
		totalColumnas: FACTURAS_TOTAL_COLS,
		columnasExcluidas: new Set<number>([FCOL.ESTADO])
	};

	const selLiq = crearResaltador(OPTS_LIQ);
	const flashLiq = crearResaltador(OPTS_LIQ);
	const flashFac = crearResaltador(OPTS_FAC);

	/// Un temporizador por entidad: dos llegadas seguidas de la misma fila
	/// reinician el destello en vez de dejar el primero apagándolo a mitad.
	const temporizadores = new Map<string, ReturnType<typeof setTimeout>>();

	function filasDeLiquidaciones(ids: readonly string[]): FilaPintable[] {
		const out: FilaPintable[] = [];
		for (const id of ids) {
			for (const fila of modelo.filasPorLiquidacion.get(id) ?? []) {
				const info = modelo.filas.get(fila);
				if (info) out.push({ fila, zebra: info.zebra });
			}
		}
		return out;
	}

	/**
	 * El resaltado ESCRIBE en la hoja (`setBackgroundColor`), así que va dentro
	 * de `repintando()` como cualquier otro repintado del engine.
	 *
	 * No era necesario mientras el guard de solo lectura colgaba solo del
	 * `SheetInterceptorService`, que no llega a ver estos comandos. Al pasarlo a
	 * `beforeCommandExecuted` —que sí los ve— el resaltado empezaría a
	 * bloquearse a sí mismo: la selección dejaría de pintar el bloque y el
	 * destello de llegada no aparecería.
	 */
	const resaltarLiquidaciones = (ids: readonly string[]): void => {
		try {
			repintando(() =>
				selLiq.aplicar(hojaDe('liquidaciones'), filasDeLiquidaciones(ids), RESALTADO_SELECCION)
			);
		} catch (e) {
			console.error('[historial] resaltarLiquidaciones falló', e);
		}
	};

	/// El destello se apaga con `aplicar([])` y no con `limpiar()`: si entre
	/// tanto llegó OTRA fila, `limpiar` borraría también la suya.
	function destellar(
		clave: string,
		resaltador: ReturnType<typeof crearResaltador>,
		ws: any,
		filas: FilaPintable[]
	) {
		if (!ws || filas.length === 0) return;
		const previo = temporizadores.get(clave);
		if (previo) clearTimeout(previo);
		repintando(() => resaltador.aplicar(ws, filas, RESALTADO_ENTRADA));
		temporizadores.set(
			clave,
			setTimeout(() => {
				temporizadores.delete(clave);
				try {
					repintando(() => resaltador.aplicar(ws, [], RESALTADO_ENTRADA));
				} catch {
					/// La hoja pudo destruirse mientras corría el temporizador.
				}
			}, MS_DESTELLO)
		);
	}

	const destellarLiquidacion = (id: string): void => {
		destellar(`liq:${id}`, flashLiq, hojaDe('liquidaciones'), filasDeLiquidaciones([id]));
	};

	const destellarFactura = (facturaId: string): void => {
		const fila = modelo.facturas.filaPorFactura.get(facturaId);
		if (fila === undefined) return;
		const info = modelo.facturas.filas.get(fila);
		destellar(`fac:${facturaId}`, flashFac, hojaDe('facturas'), [
			{ fila, zebra: info?.zebra ?? false }
		]);
	};

	/**
	 * Lleva la vista a una fila, la SELECCIONA ENTERA y la destella.
	 *
	 * El destello no es decoración: tras un salto entre hojas la fila destino
	 * está en medio de otras cien iguales, y sin él hay que buscar a ojo el
	 * consecutivo que se acaba de pulsar.
	 *
	 * Se selecciona la fila COMPLETA y no la celda de llegada. Con una sola
	 * celda seleccionada la vista saltaba al sitio correcto pero no señalaba
	 * nada: el recuadro de una celda en medio de una cuadrícula no se distingue,
	 * y el usuario se quedaba sin saber cuál de las filas visibles era la suya.
	 * La selección de fila la dibuja el propio Univer sobre toda la anchura, así
	 * que sobrevive a cualquier repintado posterior —cosa que el destello, que
	 * es un fondo que escribimos nosotros, no garantiza—.
	 *
	 * La celda de llegada sigue mandando en el SCROLL: se pasa como ancla para
	 * que el viewport se centre en la columna útil (el consecutivo, el número de
	 * factura) y no en la columna 0.
	 */
	function irAFila(hoja: HojaHistorial, fila: number, columna: number): boolean {
		try {
			activar(hoja);
			const ws = hojaDe(hoja);
			if (!ws) return false;

			const anchoHoja = COLUMNAS_POR_HOJA[hoja];

			/// Primero la celda ancla, para que el scroll aterrice en la columna
			/// que el usuario venía siguiendo; después la fila entera, que es lo
			/// que se ve. El orden importa: al revés, el scroll se iría al inicio
			/// de la fila.
			const ancla = ws.getRange(fila, columna, 1, 1);
			const filaEntera = ws.getRange(fila, 0, 1, anchoHoja);
			if (typeof (ws as any).setActiveRange === 'function') {
				(ws as any).setActiveRange(ancla);
				(ws as any).setActiveRange(filaEntera);
			} else {
				(ancla as any).activate?.();
				(filaEntera as any).activate?.();
			}
			return true;
		} catch (e) {
			console.error('[historial] irAFila falló', e);
			return false;
		}
	}

	const irALiquidacion = (id: string): boolean => {
		const filas = modelo.filasPorLiquidacion.get(id);
		if (!filas?.length) return false;
		const ok = irAFila('liquidaciones', filas[0], COL.CONSECUTIVO);
		if (ok) destellarLiquidacion(id);
		return ok;
	};

	const irAFactura = (facturaId: string): boolean => {
		const fila = modelo.facturas.filaPorFactura.get(facturaId);
		if (fila === undefined) return false;
		const ok = irAFila('facturas', fila, FCOL.NUMERO);
		if (ok) destellarFactura(facturaId);
		return ok;
	};

	return {
		...ctx,
		sheetIds,
		modelo,
		/// Filas que el autofiltro tiene ocultas en esa hoja. La página las usa
		/// para que una acción del carril no toque lo que no está en pantalla.
		filasFiltradas: (hoja: HojaHistorial) => filtradas[hoja],
		filtrosActivos,
		quitarFiltro,
		limpiarFiltros,
		pintarCelda,
		activar,
		hojaActiva,
		insertarLiquidacion,
		eliminarLiquidacion,
		actualizarLiquidacion,
		insertarFactura,
		actualizarFactura,
		eliminarFactura,
		resaltarLiquidaciones,
		destellarLiquidacion,
		destellarFactura,
		irALiquidacion,
		irAFactura
	};
}
