/**
 * Builder del canvas de HISTORIAL DE LIQUIDACIONES DE SERVICIOS.
 *
 * Una fila = una liquidación. Es deliberado que no baje al servicio
 * individual: `liquidacion_servicio_item.servicio_id` es una columna escalar
 * sin relación Prisma hacia `servicios`, así que un historial a ese nivel
 * exigiría `$queryRaw` o dos consultas encadenadas. A nivel de liquidación
 * todo está modelado y la factura viaja embebida en el propio listado.
 *
 * La hoja es de SOLO LECTURA: las liquidaciones se editan en su formulario.
 * Aquí solo se consulta y se opera con facturas desde el carril lateral, y por
 * eso el builder no emite bindings de celda ni zona libre de anotaciones —
 * toda la maquinaria colaborativa de los canvas de terceros sobra.
 */

import {
	BooleanNumber,
	BorderStyleTypes,
	HorizontalAlign,
	LocaleType,
	type IWorkbookData,
	type ICellData,
	type IStyleData,
	type IBorderData,
	type IBorderStyleData
} from '@univerjs/core';
import type { LiquidacionServicio, EstadoLiquidacionServicio } from '$lib/api/liquidaciones-servicios';

// ─── Paleta (la misma de los canvas de terceros) ──────────────────────

const GREEN = '#0F4025';
const TEXT_DARK = '#0F172A';
const MUTED = '#475569';
const TOTALES_BG = '#E2E8F0';
const RED = '#B91C1C';
const GRIS_BLOQUEADO = '#94A3B8';

/// Color del texto de la columna ESTADO. Se deriva de
/// `ESTADO_LIQUIDACION_LABELS`, pero aquí hace falta el hex y allí hay nombres
/// de clase de Tailwind, que Univer no entiende.
const COLOR_ESTADO: Record<EstadoLiquidacionServicio, string> = {
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
	NUM: 0,
	CONSECUTIVO: 1,
	CLIENTE: 2,
	NIT: 3,
	PERIODO: 4,
	ESTADO: 5,
	FACTURA: 6,
	FECHA_FACTURACION: 7,
	TERCERO: 8,
	OSI: 9,
	OPERADORA: 10,
	ITEMS: 11,
	PLACAS: 12,
	SUBTOTAL: 13,
	IVA: 14,
	TOTAL: 15,
	LIQUIDADOR: 16,
	FECHA_LIQUIDACION: 17
} as const;

export const TOTAL_COLS = 18;

const COLUMN_HEADERS: string[] = [
	'#',
	'CONSECUTIVO',
	'CLIENTE',
	'NIT',
	'PERIODO',
	'ESTADO',
	'N° FACTURA',
	'FECHA FACTURACIÓN',
	'3° LIQ.',
	'OSI',
	'OPERADORA',
	'ITEMS',
	'PLACAS',
	'SUBTOTAL',
	'IVA',
	'TOTAL',
	'LIQUIDADOR',
	'FECHA LIQUIDACIÓN'
];

const COLUMN_WIDTHS = [
	44, 130, 260, 110, 96, 104, 116, 140, 74, 90, 120, 62, 200, 116, 100, 122, 180, 140
];

/// Columnas que llevan `=SUM()` en el pie.
const COLS_SUMADAS = [COL.ITEMS, COL.SUBTOTAL, COL.IVA, COL.TOTAL];

const MESES = [
	'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
	'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
];

// ─── Tipos ────────────────────────────────────────────────────────────

/**
 * Lo que el canvas necesita saber de cada fila para poder actuar sobre ella
 * sin volver a leer la celda. La hoja pinta texto; las acciones del carril
 * trabajan con esto.
 */
export interface FilaHistorial {
	fila: number;
	id: string;
	consecutivo: string;
	estado: EstadoLiquidacionServicio;
	total: number;
	factura_id: string | null;
	numero_factura: string | null;
}

export interface HistorialWorkbook {
	workbook: IWorkbookData;
	unitId: string;
	sheetId: string;
	/// Índice de fila (0-based, en coordenadas de Univer) → datos de la fila.
	filas: Map<number, FilaHistorial>;
	/// Índice inverso, para repintar una liquidación concreta tras una acción.
	filaPorLiquidacion: Map<string, number>;
	/// Fila de encabezado y rango de datos, para el repintado puntual.
	anclas: { header: number; primeraFila: number; ultimaFila: number; totales: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────

const thinBorder = (): IBorderStyleData => ({
	s: BorderStyleTypes.THIN,
	cl: { rgb: '#CBD5E1' }
});
const allBorders = (): IBorderData => ({
	t: thinBorder(),
	r: thinBorder(),
	b: thinBorder(),
	l: thinBorder()
});

/// La factura viva de una liquidación, si el backend la mandó embebida.
export function facturaDe(l: LiquidacionServicio) {
	const item = (l as any).factura_items?.[0];
	return item?.factura ?? null;
}

function fechaCorta(iso?: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	/// `en-CA` da `YYYY-MM-DD`, que ordena bien como texto y no obliga a
	/// convertir la columna a fecha nativa de Univer.
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// ─── Builder ──────────────────────────────────────────────────────────

export function buildHistorialServiciosWorkbook(
	liquidaciones: LiquidacionServicio[]
): HistorialWorkbook {
	const unitId = 'historial-liquidaciones-servicios';
	const sheetId = 'hoja-historial';

	// ── Estilos ──
	const headerStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN },
		ht: HorizontalAlign.CENTER,
		bd: allBorders()
	};
	const base: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: allBorders() };
	const zebra: IStyleData = { ...base, bg: { rgb: '#F8FAFC' } };
	const money = (z: boolean): IStyleData =>
		({ ...(z ? zebra : base), n: { pattern: '"$"#,##0' } }) as any;
	const centrado = (z: boolean): IStyleData => ({
		...(z ? zebra : base),
		ht: HorizontalAlign.CENTER
	});
	const apagado = (z: boolean): IStyleData => ({ ...(z ? zebra : base), cl: { rgb: MUTED } });
	const totalesStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders()
	};
	const totalesMoney: IStyleData = { ...totalesStyle, n: { pattern: '"$"#,##0' } } as any;

	const cellData: Record<number, Record<number, ICellData>> = {};
	const set = (r: number, c: number, cell: ICellData) => {
		(cellData[r] ??= {})[c] = cell;
	};

	// ── Encabezado ──
	const HEADER_ROW = 0;
	COLUMN_HEADERS.forEach((h, c) => set(HEADER_ROW, c, { v: h, s: headerStyle }));

	// ── Filas ──
	const filas = new Map<number, FilaHistorial>();
	const filaPorLiquidacion = new Map<string, number>();
	const PRIMERA_FILA = HEADER_ROW + 1;

	liquidaciones.forEach((l, i) => {
		const r = PRIMERA_FILA + i;
		const z = i % 2 === 1;
		const factura = facturaDe(l);
		const placas = (l as any).placas as string[] | undefined;

		set(r, COL.NUM, { v: i + 1, s: centrado(z) });
		set(r, COL.CONSECUTIVO, { v: l.consecutivo, s: { ...(z ? zebra : base), bl: 1 } });
		set(r, COL.CLIENTE, { v: l.cliente?.nombre ?? '', s: z ? zebra : base });
		set(r, COL.NIT, { v: l.cliente?.nit ?? '', s: apagado(z) });
		set(r, COL.PERIODO, {
			v: l.mes ? `${MESES[l.mes - 1]} ${l.anio}` : '',
			s: centrado(z)
		});
		set(r, COL.ESTADO, {
			v: l.estado,
			s: { ...centrado(z), bl: 1, cl: { rgb: COLOR_ESTADO[l.estado] ?? TEXT_DARK } }
		});
		set(r, COL.FACTURA, {
			/// Texto a propósito: hay números de factura con ceros a la izquierda
			/// y con letras, y dejarlos como número los deformaría.
			v: factura?.numero_factura ?? '',
			s: { ...centrado(z), bl: factura ? 1 : 0 }
		});
		set(r, COL.FECHA_FACTURACION, { v: fechaCorta(l.fecha_facturacion), s: centrado(z) });
		set(r, COL.TERCERO, { v: l.tercero_liquidado ? 'SÍ' : 'NO', s: centrado(z) });
		set(r, COL.OSI, { v: l.osi ?? '', s: apagado(z) });
		set(r, COL.OPERADORA, { v: l.operadora ?? '', s: apagado(z) });
		set(r, COL.ITEMS, { v: l.total_items ?? l.items?.length ?? 0, s: centrado(z) });
		set(r, COL.PLACAS, { v: (placas ?? []).join(', '), s: apagado(z) });
		set(r, COL.SUBTOTAL, { v: Number(l.subtotal) || 0, s: money(z) });
		set(r, COL.IVA, { v: Number(l.valor_iva) || 0, s: money(z) });
		set(r, COL.TOTAL, { v: Number(l.total) || 0, s: { ...money(z), bl: 1 } });
		set(r, COL.LIQUIDADOR, {
			v: l.liquidado_por?.nombre ?? l.creado_por?.nombre ?? '',
			s: apagado(z)
		});
		set(r, COL.FECHA_LIQUIDACION, { v: fechaCorta(l.fecha_liquidacion), s: centrado(z) });

		const info: FilaHistorial = {
			fila: r,
			id: l.id,
			consecutivo: l.consecutivo,
			estado: l.estado,
			total: Number(l.total) || 0,
			factura_id: factura?.id ?? null,
			numero_factura: factura?.numero_factura ?? null
		};
		filas.set(r, info);
		filaPorLiquidacion.set(l.id, r);
	});

	const ULTIMA_FILA = PRIMERA_FILA + Math.max(liquidaciones.length, 1) - 1;
	const TOTALES_ROW = PRIMERA_FILA + liquidaciones.length;

	// ── Pie de totales ──
	for (let c = 0; c < TOTAL_COLS; c++) {
		set(TOTALES_ROW, c, { v: '', s: totalesStyle });
	}
	set(TOTALES_ROW, COL.CONSECUTIVO, { v: `${liquidaciones.length} liquidaciones`, s: totalesStyle });
	if (liquidaciones.length > 0) {
		for (const c of COLS_SUMADAS) {
			const letra = colLetra(c);
			set(TOTALES_ROW, c, {
				f: `=SUM(${letra}${PRIMERA_FILA + 1}:${letra}${ULTIMA_FILA + 1})`,
				s: c === COL.ITEMS ? totalesStyle : totalesMoney
			});
		}
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

	const sheet = {
		id: sheetId,
		name: 'Historial',
		tabColor: GREEN,
		hidden: BooleanNumber.FALSE,
		/// Encabezado congelado: con ~500 filas, perderlo al tercer scroll deja
		/// al usuario contando columnas.
		freeze: { startRow: 1, startColumn: 2, ySplit: 1, xSplit: 2 },
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

	const workbook: IWorkbookData = {
		id: unitId,
		name: 'Historial de liquidaciones de servicios',
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder: [sheetId],
		sheets: { [sheetId]: sheet as any }
	};

	return {
		workbook,
		unitId,
		sheetId,
		filas,
		filaPorLiquidacion,
		anclas: {
			header: HEADER_ROW,
			primeraFila: PRIMERA_FILA,
			ultimaFila: ULTIMA_FILA,
			totales: TOTALES_ROW
		}
	};
}

/// Índice de columna → letra de Excel, para las fórmulas del pie.
function colLetra(c: number): string {
	let n = c;
	let s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

/**
 * Estilo de la celda N° FACTURA, expuesto para que la page repinte esa columna
 * tras asociar o desasociar sin reconstruir el libro entero.
 */
export function estiloCeldaFactura(fila: number, conFactura: boolean): IStyleData {
	const z = (fila - 1) % 2 === 1;
	return {
		fs: 10,
		cl: { rgb: TEXT_DARK },
		bd: allBorders(),
		ht: HorizontalAlign.CENTER,
		bl: conFactura ? 1 : 0,
		...(z ? { bg: { rgb: '#F8FAFC' } } : {})
	};
}

/** Estilo de la celda ESTADO, con el color que le toca al estado dado. */
export function estiloCeldaEstado(fila: number, estado: EstadoLiquidacionServicio): IStyleData {
	const z = (fila - 1) % 2 === 1;
	return {
		fs: 10,
		cl: { rgb: COLOR_ESTADO[estado] ?? TEXT_DARK },
		bd: allBorders(),
		ht: HorizontalAlign.CENTER,
		bl: 1,
		...(z ? { bg: { rgb: '#F8FAFC' } } : {})
	};
}
