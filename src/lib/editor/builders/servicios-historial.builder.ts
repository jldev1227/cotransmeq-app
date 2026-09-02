/**
 * Builder del canvas de HISTORIAL DE LIQUIDACIONES DE SERVICIOS.
 *
 * UNA FILA = UN ÍTEM de liquidación. Los datos de la cabecera (consecutivo,
 * cliente, estado, totales…) se REPITEN en cada fila del bloque: es
 * deliberado — Operaciones pidió poder filtrar/ordenar por cualquier campo
 * sin que la mitad de las filas tenga celdas vacías "de agrupado". El precio
 * es redundancia visual, y se paga a propósito.
 *
 * Los ítems llegan embebidos en `listar` con `include_items=true` (cambio en
 * `backend-nest/.../liquidaciones-servicios.service.ts`); si una liquidación
 * llega sin ítems (histórico raro, borrador vacío) se emite igualmente una
 * fila única para que no desaparezca del canvas.
 *
 * La hoja es de SOLO LECTURA: las liquidaciones se editan en su formulario.
 * Las acciones (preview, aprobar, facturar, eliminar) viven en la columna
 * ACCIONES y en el carril lateral, y operan por SELECCIÓN de filas.
 *
 * `bloqueLiquidacion` está exportado porque la página lo reutiliza para
 * insertar en vivo las liquidaciones que llegan por socket sin reconstruir
 * el libro (ver `insertarLiquidacion` en el engine).
 */

import {
	BooleanNumber,
	HorizontalAlign,
	LocaleType,
	type IWorkbookData,
	type ICellData,
	type IStyleData,
	type IWorksheetData
} from '@univerjs/core';
import type {
	LiquidacionServicio,
	ItemLiquidacionServicio,
	EstadoLiquidacionServicio
} from '$lib/api/liquidaciones-servicios';
import {
	buildFacturasSheet,
	type FilaFactura,
	FACTURAS_SHEET_ID
} from './servicios-historial-facturas.builder';
import type { FacturaLiquidacion } from '$lib/api/facturacionLiquidaciones';
import {
	buildTercerosSheet,
	type TerceroItemHistorial,
	TERCEROS_SHEET_ID
} from './servicios-historial-terceros.builder';
import {
	GREEN,
	TEXT_DARK,
	MUTED,
	TOTALES_BG,
	ZEBRA_BG,
	RED,
	GRIS_BLOQUEADO,
	AZUL_ACCION,
	comoEnlace,
	comoTexto,
	allBorders,
	fechaCorta,
	fechaDeCalendario,
	colLetra,
	MESES_CORTOS as MESES
} from './historial-comun';

// Re-export para los consumidores históricos (excel builder, page).
export { allBorders, fechaCorta, fechaDeCalendario, colLetra };

/// Color del texto de la columna ESTADO. Se deriva de
/// `ESTADO_LIQUIDACION_LABELS`, pero aquí hace falta el hex y allí hay nombres
/// de clase de Tailwind, que Univer no entiende.
export const COLOR_ESTADO: Record<EstadoLiquidacionServicio, string> = {
	BORRADOR: GRIS_BLOQUEADO,
	LIQUIDADA: '#1D4ED8',
	APROBADA: '#166534',
	FACTURADA: GREEN,
	ANULADA: RED
};

// ─── Columnas ─────────────────────────────────────────────────────────

/**
 * Índices de columna por nombre. Igual que en el builder de cierres: escribir
 * los números a mano en el `set()` de cada fila, en el mapa de sumas y en la
 * fila de totales es justo lo que hace que insertar una columna rompa tres
 * sitios distintos y solo se note en producción.
 */
export const COL = {
	/// Primera a propósito: el preview se abre desde aquí y la petición fue
	/// explícita — "columna de acciones y dejarla al inicio".
	ACCIONES: 0,
	NUM: 1,
	CONSECUTIVO: 2,
	CLIENTE: 3,
	NIT: 4,
	PERIODO: 5,
	ESTADO: 6,
	FACTURA: 7,
	FECHA_FACTURACION: 8,
	PLACA: 9,
	FECHAS_ITEM: 10,
	RECORRIDO: 11,
	TIPO_SERVICIO: 12,
	PLANILLA: 13,
	CANTIDAD: 14,
	VALOR_UNITARIO: 15,
	VALOR_ITEM: 16,
	RECARGOS_ITEM: 17,
	PERNOCTES_ITEM: 18,
	SUBTOTAL: 19,
	IVA: 20,
	TOTAL: 21,
	TERCERO: 22,
	OSI: 23,
	OPERADORA: 24,
	LIQUIDADOR: 25,
	FECHA_LIQUIDACION: 26
} as const;

export const TOTAL_COLS = 27;

const COLUMN_HEADERS: string[] = [
	'',
	'ITEM',
	'CONSECUTIVO',
	'CLIENTE',
	'NIT',
	'PERIODO',
	'ESTADO',
	'N° FACTURA',
	'FECHA FACTURACIÓN',
	'PLACA',
	'FECHAS SERVICIO',
	'RECORRIDO',
	'TIPO SERVICIO',
	'N° PLANILLA',
	'CANT.',
	'VR. UNITARIO',
	'VR. ITEM',
	'RECARGOS ITEM',
	'PERNOCTES ITEM',
	'SUBTOTAL LIQ.',
	'IVA LIQ.',
	'TOTAL LIQ.',
	'3° LIQ.',
	'OSI',
	'OPERADORA',
	'LIQUIDADOR',
	'FECHA LIQUIDACIÓN'
];

/**
 * Anchos por columna, en el orden de `COL`.
 *
 * El bloque de ÍTEM (12–19: tipo, planilla, cantidad y los cuatro importes) va
 * más holgado que el resto a propósito: sus cabeceras son largas —«PERNOCTES
 * ITEM», «RECARGOS ITEM»— y sus valores son moneda con separador de miles, así
 * que al ancho justo el número se recortaba y había que ensanchar a mano en
 * cada sesión.
 */
const COLUMN_WIDTHS = [
	52, 52, 130, 230, 105, 90, 100, 112, 128, 88, 168, 250,
	//  ── bloque de ítem ──────────────────────────────────────────────────
	//  TIPO  PLAN  CANT  VR.UNIT  VR.ITEM  RECARGOS  PERNOCTES  SUBTOTAL
	    168,  124,   78,     132,     132,      134,       140,      140,
	//  ────────────────────────────────────────────────────────────────────
	98, 120, 66, 88, 112, 170, 132
];

/// Columnas de ÍTEM que llevan `=SUM()` en el pie. Las de liquidación
/// (SUBTOTAL/IVA/TOTAL) NO pueden sumarse con fórmula: están repetidas en
/// cada fila del bloque y la suma contaría cada liquidación N veces.
/// Exportado: el engine reescribe estas fórmulas al insertar/quitar filas
/// en vivo (los rangos no se auto-expanden al insertar en el borde).
export const COLS_SUMADAS_ITEM = [
	COL.CANTIDAD,
	COL.VALOR_ITEM,
	COL.RECARGOS_ITEM,
	COL.PERNOCTES_ITEM
];

// ─── Tipos ────────────────────────────────────────────────────────────

/**
 * Lo que el canvas necesita saber de cada fila para poder actuar sobre ella
 * sin volver a leer la celda. La hoja pinta texto; las acciones del carril
 * trabajan con esto. Como ahora hay N filas por liquidación, las acciones
 * deduplican por `id` antes de llamar al backend.
 */
export interface FilaHistorial {
	fila: number;
	/// Id de la LIQUIDACIÓN (no del ítem): es la unidad sobre la que operan
	/// aprobar / facturar / eliminar.
	id: string;
	item_id: string | null;
	consecutivo: string;
	estado: EstadoLiquidacionServicio;
	/// Totales de la liquidación (repetidos en cada fila de su bloque). El
	/// engine los usa como delta del pie al quitar un bloque en vivo.
	total: number;
	subtotal: number;
	iva: number;
	valor_item: number;
	factura_id: string | null;
	numero_factura: string | null;
	placa: string;
	/// Zebra del BLOQUE (por liquidación, no por fila): el repintado puntual
	/// necesita reconstruir el fondo sin releer el libro.
	zebra: boolean;
	esPrimeraDeSuLiquidacion: boolean;
}

export interface HistorialWorkbook {
	workbook: IWorkbookData;
	unitId: string;
	sheetId: string;
	/// Índice de fila (0-based, en coordenadas de Univer) → datos de la fila.
	filas: Map<number, FilaHistorial>;
	/// Liquidación → TODAS sus filas (una por ítem), en orden.
	filasPorLiquidacion: Map<string, number[]>;
	/// Fila de encabezado y rango de datos, para el repintado puntual.
	/// MUTABLE: la inserción/eliminación en vivo desplaza `ultimaFila` y
	/// `totales` y el pie se repinta con los nuevos rangos.
	anclas: { header: number; primeraFila: number; ultimaFila: number; totales: number };
	totalLiquidaciones: number;
	totalItems: number;
	/// Acumuladores del pie para SUBTOTAL/IVA/TOTAL (cada liquidación contada
	/// UNA vez). Mutables: los altas/bajas en vivo los ajustan por delta.
	sumas: { subtotal: number; iva: number; total: number };
	// Índices de las hojas hermanas.
	facturas: {
		sheetId: string;
		filas: Map<number, FilaFactura>;
		filaPorFactura: Map<string, number>;
		anclas: { header: number; primeraFila: number; totales: number };
		sumaActivas: number;
	};
	terceros: { sheetId: string; totalFilas: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────

/// La factura viva de una liquidación, si el backend la mandó embebida.
export function facturaDe(l: LiquidacionServicio) {
	const item = (l as any).factura_items?.[0];
	return item?.factura ?? null;
}

/// `fechaDeCalendario` y no `fechaCorta`: las fechas del ítem son columnas
/// `@db.Date`, y convertirlas a la zona de Bogotá las corre un día atrás.
function rangoFechas(item: ItemLiquidacionServicio): string {
	const ini = fechaDeCalendario(item.fecha_inicial);
	const fin = fechaDeCalendario(item.fecha_final);
	if (!ini && !fin) return '';
	if (ini === fin || !fin) return ini;
	return `${ini} → ${fin}`;
}

// ─── Estilos de celda ─────────────────────────────────────────────────

function baseStyle(zebra: boolean): IStyleData {
	return {
		fs: 10,
		cl: { rgb: TEXT_DARK },
		bd: allBorders(),
		...(zebra ? { bg: { rgb: ZEBRA_BG } } : {})
	};
}
const money = (z: boolean): IStyleData =>
	({ ...baseStyle(z), n: { pattern: '"$"#,##0' } }) as any;
const centrado = (z: boolean): IStyleData => ({ ...baseStyle(z), ht: HorizontalAlign.CENTER });
const apagado = (z: boolean): IStyleData => ({ ...baseStyle(z), cl: { rgb: MUTED } });

/** Estilo de la celda ESTADO, con el color que le toca al estado dado. */
export function estiloCeldaEstado(zebra: boolean, estado: EstadoLiquidacionServicio): IStyleData {
	return {
		...centrado(zebra),
		bl: 1,
		cl: { rgb: COLOR_ESTADO[estado] ?? TEXT_DARK }
	};
}

/**
 * Estilo de la celda N° FACTURA, expuesto para que la page repinte esa columna
 * tras asociar o desasociar sin reconstruir el libro entero.
 */
export function estiloCeldaFactura(zebra: boolean, conFactura: boolean): IStyleData {
	const estilo = { ...centrado(zebra), bl: conFactura ? 1 : 0 };
	/// Con factura, la celda ENLAZA a la hoja de Facturas (doble clic). Sin
	/// ella no hay a dónde ir, así que se deja como texto normal en vez de
	/// prometer un salto que acaba en «esa fila no tiene a dónde ir».
	return conFactura ? comoEnlace(estilo) : estilo;
}

/** Celda de la columna ACCIONES: el «botón» de preview. */
export function celdaAccion(zebra: boolean): ICellData {
	return {
		v: '👁 VER',
		s: {
			...centrado(zebra),
			fs: 9,
			bl: 1,
			cl: { rgb: AZUL_ACCION }
		}
	};
}

// ─── Bloque de una liquidación ────────────────────────────────────────

export interface BloqueLiquidacion {
	/// Matriz densa de celdas: `celdas[i][c]` = ítem i, columna c.
	celdas: ICellData[][];
	/// Índices de las filas, con `fila` ya absoluto (filaInicial + i).
	infos: FilaHistorial[];
}

/**
 * Pinta el bloque de filas de UNA liquidación (una por ítem).
 *
 * Lo usan el build inicial y la inserción en vivo por socket: si las celdas
 * de un alta remota se generaran con otro código, las filas nuevas no serían
 * indistinguibles de las cargadas — y ese es el contrato visual del canvas.
 */
export function bloqueLiquidacion(
	l: LiquidacionServicio,
	opts: { filaInicial: number; zebra: boolean }
): BloqueLiquidacion {
	const { filaInicial, zebra } = opts;
	const factura = facturaDe(l);
	const items: (ItemLiquidacionServicio | null)[] =
		l.items && l.items.length > 0 ? l.items : [null];

	const celdas: ICellData[][] = [];
	const infos: FilaHistorial[] = [];

	items.forEach((item, i) => {
		const fila = new Array<ICellData>(TOTAL_COLS);
		const z = zebra;

		fila[COL.ACCIONES] = celdaAccion(z);
		fila[COL.NUM] = { v: `${i + 1}/${items.length}`, s: { ...centrado(z), fs: 9, cl: { rgb: MUTED } } };
		fila[COL.CONSECUTIVO] = { v: l.consecutivo, s: { ...baseStyle(z), bl: 1 } };
		fila[COL.CLIENTE] = { v: l.cliente?.nombre ?? '', s: baseStyle(z) };
		fila[COL.NIT] = comoTexto({ v: l.cliente?.nit ?? '', s: apagado(z) });
		fila[COL.PERIODO] = { v: l.mes ? `${MESES[l.mes - 1]} ${l.anio}` : '', s: centrado(z) };
		fila[COL.ESTADO] = { v: l.estado, s: estiloCeldaEstado(z, l.estado) };
		/// Texto a propósito: hay números de factura con ceros a la izquierda y
		/// con letras, y dejarlos como número los deformaría. `comoTexto` es lo
		/// que hace cumplir esa intención: antes solo se guardaba el string y
		/// Univer volvía a inferir el tipo en el primer repintado del fondo.
		fila[COL.FACTURA] = comoTexto({
			v: factura?.numero_factura ?? '',
			s: estiloCeldaFactura(z, !!factura)
		});
		fila[COL.FECHA_FACTURACION] = { v: fechaCorta(l.fecha_facturacion), s: centrado(z) };
		fila[COL.PLACA] = { v: item?.placa ?? '', s: { ...centrado(z), bl: 1 } };
		fila[COL.FECHAS_ITEM] = { v: item ? rangoFechas(item) : '', s: centrado(z) };
		fila[COL.RECORRIDO] = { v: item?.recorrido ?? '', s: baseStyle(z) };
		fila[COL.TIPO_SERVICIO] = { v: item?.tipo_servicio ?? '', s: apagado(z) };
		fila[COL.PLANILLA] = { v: item?.numero_planilla ?? '', s: apagado(z) };
		fila[COL.CANTIDAD] = { v: item ? Number(item.cantidad) || 0 : 0, s: centrado(z) };
		fila[COL.VALOR_UNITARIO] = { v: item ? Number(item.valor_unitario) || 0 : 0, s: money(z) };
		fila[COL.VALOR_ITEM] = {
			v: item ? Number(item.valor_final) || 0 : 0,
			s: { ...money(z), bl: 1 }
		};
		fila[COL.RECARGOS_ITEM] = {
			v: item ? Number(item.valor_recargos_total) || 0 : 0,
			s: money(z)
		};
		fila[COL.PERNOCTES_ITEM] = {
			v: item ? Number(item.valor_pernoctes_total) || 0 : 0,
			s: money(z)
		};
		fila[COL.SUBTOTAL] = { v: Number(l.subtotal) || 0, s: money(z) };
		fila[COL.IVA] = { v: Number(l.valor_iva) || 0, s: money(z) };
		fila[COL.TOTAL] = { v: Number(l.total) || 0, s: { ...money(z), bl: 1 } };
		fila[COL.TERCERO] = { v: l.tercero_liquidado ? 'SÍ' : 'NO', s: centrado(z) };
		fila[COL.OSI] = { v: l.osi ?? '', s: apagado(z) };
		fila[COL.OPERADORA] = { v: l.operadora ?? '', s: apagado(z) };
		fila[COL.LIQUIDADOR] = {
			v: l.liquidado_por?.nombre ?? l.creado_por?.nombre ?? '',
			s: apagado(z)
		};
		fila[COL.FECHA_LIQUIDACION] = { v: fechaCorta(l.fecha_liquidacion), s: centrado(z) };

		celdas.push(fila);
		infos.push({
			fila: filaInicial + i,
			id: l.id,
			item_id: item?.id ?? null,
			consecutivo: l.consecutivo,
			estado: l.estado,
			total: Number(l.total) || 0,
			subtotal: Number(l.subtotal) || 0,
			iva: Number(l.valor_iva) || 0,
			valor_item: item ? Number(item.valor_final) || 0 : 0,
			factura_id: factura?.id ?? null,
			numero_factura: factura?.numero_factura ?? null,
			placa: item?.placa ?? '',
			zebra,
			esPrimeraDeSuLiquidacion: i === 0
		});
	});

	return { celdas, infos };
}

// ─── Builder de la hoja de liquidaciones ──────────────────────────────

const HEADER_STYLE: IStyleData = {
	fs: 10,
	bl: 1,
	cl: { rgb: '#FFFFFF' },
	bg: { rgb: GREEN },
	ht: HorizontalAlign.CENTER,
	bd: allBorders()
};
const TOTALES_STYLE: IStyleData = {
	fs: 10,
	bl: 1,
	cl: { rgb: TEXT_DARK },
	bg: { rgb: TOTALES_BG },
	bd: allBorders()
};
const TOTALES_MONEY: IStyleData = { ...TOTALES_STYLE, n: { pattern: '"$"#,##0' } } as any;

export const HISTORIAL_SHEET_ID = 'hoja-historial';

export interface DatosHistorial {
	liquidaciones: LiquidacionServicio[];
	facturas: FacturaLiquidacion[];
	terceros: TerceroItemHistorial[];
}

export function buildHistorialServiciosWorkbook(datos: DatosHistorial): HistorialWorkbook {
	const { liquidaciones } = datos;
	const unitId = 'historial-liquidaciones-servicios';

	const cellData: Record<number, Record<number, ICellData>> = {};
	const set = (r: number, c: number, cell: ICellData) => {
		(cellData[r] ??= {})[c] = cell;
	};

	// ── Encabezado ──
	const HEADER_ROW = 0;
	COLUMN_HEADERS.forEach((h, c) => set(HEADER_ROW, c, { v: h, s: HEADER_STYLE }));

	// ── Filas (una por ítem, zebra por bloque de liquidación) ──
	const filas = new Map<number, FilaHistorial>();
	const filasPorLiquidacion = new Map<string, number[]>();
	const PRIMERA_FILA = HEADER_ROW + 1;

	let cursor = PRIMERA_FILA;
	let totalItems = 0;
	let sumaSubtotal = 0;
	let sumaIva = 0;
	let sumaTotal = 0;

	liquidaciones.forEach((l, idxLiq) => {
		const zebra = idxLiq % 2 === 1;
		const bloque = bloqueLiquidacion(l, { filaInicial: cursor, zebra });

		bloque.celdas.forEach((filaCeldas, i) => {
			const r = cursor + i;
			filaCeldas.forEach((celda, c) => set(r, c, celda));
		});
		const filasDeEsta: number[] = [];
		for (const info of bloque.infos) {
			filas.set(info.fila, info);
			filasDeEsta.push(info.fila);
		}
		filasPorLiquidacion.set(l.id, filasDeEsta);

		cursor += bloque.celdas.length;
		totalItems += bloque.celdas.length;
		sumaSubtotal += Number(l.subtotal) || 0;
		sumaIva += Number(l.valor_iva) || 0;
		sumaTotal += Number(l.total) || 0;
	});

	const ULTIMA_FILA = Math.max(cursor - 1, PRIMERA_FILA);
	const TOTALES_ROW = cursor;

	// ── Pie de totales ──
	for (let c = 0; c < TOTAL_COLS; c++) {
		set(TOTALES_ROW, c, { v: '', s: TOTALES_STYLE });
	}
	set(TOTALES_ROW, COL.CONSECUTIVO, {
		v: `${liquidaciones.length} liquidaciones · ${totalItems} ítems`,
		s: TOTALES_STYLE
	});
	if (totalItems > 0) {
		// Columnas de ÍTEM: fórmula, y `SUBTOTAL(109,…)` en vez de `SUM` para que
		// el pie siga al autofiltro de la cabecera. `SUM` sumaría también las
		// filas ocultas, así que filtrar por un cliente dejaría en pantalla doce
		// filas y debajo el total de las trescientas cuarenta.
		for (const c of COLS_SUMADAS_ITEM) {
			const letra = colLetra(c);
			set(TOTALES_ROW, c, {
				f: `=SUBTOTAL(109,${letra}${PRIMERA_FILA + 1}:${letra}${ULTIMA_FILA + 1})`,
				s: c === COL.CANTIDAD ? TOTALES_STYLE : TOTALES_MONEY
			});
		}
		// Columnas de LIQUIDACIÓN: número calculado en JS contando cada
		// liquidación UNA vez. Un =SUM aquí sumaría el mismo total N veces
		// (una por ítem del bloque) y el pie mentiría.
		set(TOTALES_ROW, COL.SUBTOTAL, { v: sumaSubtotal, s: TOTALES_MONEY });
		set(TOTALES_ROW, COL.IVA, { v: sumaIva, s: TOTALES_MONEY });
		set(TOTALES_ROW, COL.TOTAL, { v: sumaTotal, s: TOTALES_MONEY });
	}

	// ── Anchos de columna ──
	//
	// El objeto `colData` se construye AQUÍ dentro y no se comparte: Univer
	// muta `columnData` in-place al redimensionar, y un objeto compartido
	// propagaría el arrastre a cualquier otra hoja que lo usara.
	const colData: Record<number, { w: number }> = {};
	COLUMN_WIDTHS.forEach((w, i) => {
		colData[i] = { w };
	});

	const sheet: Partial<IWorksheetData> = {
		id: HISTORIAL_SHEET_ID,
		name: 'Liquidaciones',
		tabColor: GREEN,
		hidden: BooleanNumber.FALSE,
		/// Encabezado y las tres primeras columnas congeladas: con miles de
		/// filas de ítems, perder ACCIONES/CONSECUTIVO al hacer scroll deja al
		/// usuario contando columnas.
		freeze: { startRow: 1, startColumn: 3, ySplit: 1, xSplit: 3 },
		rowCount: TOTALES_ROW + 1,
		columnCount: TOTAL_COLS,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 100,
		defaultRowHeight: 22,
		mergeData: [],
		cellData,
		rowData: {},
		columnData: colData,
		rowHeader: { width: 50 },
		columnHeader: { height: 24 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};

	// ── Hojas hermanas ──
	const facturasSheet = buildFacturasSheet(datos.facturas);
	const tercerosSheet = buildTercerosSheet(datos.terceros);

	const workbook: IWorkbookData = {
		id: unitId,
		name: 'Historial de liquidaciones de servicios',
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder: [HISTORIAL_SHEET_ID, FACTURAS_SHEET_ID, TERCEROS_SHEET_ID],
		sheets: {
			[HISTORIAL_SHEET_ID]: sheet as any,
			[FACTURAS_SHEET_ID]: facturasSheet.sheet as any,
			[TERCEROS_SHEET_ID]: tercerosSheet.sheet as any
		}
	};

	return {
		workbook,
		unitId,
		sheetId: HISTORIAL_SHEET_ID,
		filas,
		filasPorLiquidacion,
		anclas: {
			header: HEADER_ROW,
			primeraFila: PRIMERA_FILA,
			ultimaFila: ULTIMA_FILA,
			totales: TOTALES_ROW
		},
		totalLiquidaciones: liquidaciones.length,
		totalItems,
		sumas: { subtotal: sumaSubtotal, iva: sumaIva, total: sumaTotal },
		facturas: {
			sheetId: FACTURAS_SHEET_ID,
			filas: facturasSheet.filas,
			filaPorFactura: facturasSheet.filaPorFactura,
			anclas: facturasSheet.anclas,
			sumaActivas: facturasSheet.sumaActivas
		},
		terceros: { sheetId: TERCEROS_SHEET_ID, totalFilas: tercerosSheet.totalFilas }
	};
}
