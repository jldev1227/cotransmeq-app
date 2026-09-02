/**
 * Hoja «Facturas» del canvas de historial de liquidaciones de servicios.
 *
 * Es el tab de Facturas del listado clásico convertido en hoja: una fila por
 * factura, con sus consecutivos asociados y el total. Solo lectura — anular o
 * eliminar una factura siguen siendo acciones del carril/modal, no ediciones
 * de celda.
 */

import {
	BooleanNumber,
	HorizontalAlign,
	type ICellData,
	type IStyleData,
	type IWorksheetData
} from '@univerjs/core';
import type { FacturaLiquidacion } from '$lib/api/facturacionLiquidaciones';

import {
	GREEN,
	TEXT_DARK,
	MUTED,
	TOTALES_BG,
	ZEBRA_BG,
	allBorders,
	fechaCorta,
	colLetra,
	comoEnlace,
	comoTexto
} from './historial-comun';

export const FACTURAS_SHEET_ID = 'hoja-facturas';

export const FCOL = {
	NUM: 0,
	NUMERO: 1,
	FECHA: 2,
	ESTADO: 3,
	LIQUIDACIONES: 4,
	CONSECUTIVOS: 5,
	VALOR_TOTAL: 6,
	FACTURADO_POR: 7,
	ANULADA_POR: 8,
	MOTIVO: 9,
	OBSERVACIONES: 10
} as const;

export const FACTURAS_TOTAL_COLS = 11;

const HEADERS = [
	'#',
	'N° FACTURA',
	'FECHA',
	'ESTADO',
	'LIQ.',
	'CONSECUTIVOS',
	'VALOR TOTAL',
	'FACTURADO POR',
	'ANULADA POR',
	'MOTIVO ANULACIÓN',
	'OBSERVACIONES'
];

const WIDTHS = [44, 130, 104, 96, 56, 320, 130, 170, 170, 240, 240];

const COLOR_ESTADO_FACTURA: Record<string, string> = {
	ACTIVA: '#166534',
	ANULADA: '#B91C1C'
};

export interface FilaFactura {
	fila: number;
	id: string;
	numero_factura: string;
	estado: 'ACTIVA' | 'ANULADA';
	valor_total: number;
	zebra: boolean;
}

export interface FacturasSheetResult {
	sheet: Partial<IWorksheetData>;
	filas: Map<number, FilaFactura>;
	filaPorFactura: Map<string, number>;
	/// MUTABLE: la inserción en vivo desplaza `totales`.
	anclas: { header: number; primeraFila: number; totales: number };
	/// Σ valor_total de las ACTIVAS. Mutable, delta en los altas/bajas en vivo.
	sumaActivas: number;
}

function base(zebra: boolean): IStyleData {
	return {
		fs: 10,
		cl: { rgb: TEXT_DARK },
		bd: allBorders(),
		...(zebra ? { bg: { rgb: ZEBRA_BG } } : {})
	};
}
const centrado = (z: boolean): IStyleData => ({ ...base(z), ht: HorizontalAlign.CENTER });
const money = (z: boolean): IStyleData => ({ ...base(z), n: { pattern: '"$"#,##0' } }) as any;
const apagado = (z: boolean): IStyleData => ({ ...base(z), cl: { rgb: MUTED } });

export function estiloEstadoFactura(zebra: boolean, estado: string): IStyleData {
	return {
		...centrado(zebra),
		bl: 1,
		cl: { rgb: COLOR_ESTADO_FACTURA[estado] ?? TEXT_DARK }
	};
}

/** Celdas de UNA factura, reutilizadas por el build y el repintado en vivo. */
export function filaFacturaCeldas(f: FacturaLiquidacion, zebra: boolean, num: number): ICellData[] {
	const consecutivos = (f.items ?? [])
		.map((i) => i.liquidacion?.consecutivo)
		.filter(Boolean)
		.join(', ');
	const fila = new Array<ICellData>(FACTURAS_TOTAL_COLS);
	fila[FCOL.NUM] = { v: num, s: centrado(zebra) };
	fila[FCOL.NUMERO] = comoTexto({ v: f.numero_factura, s: { ...base(zebra), bl: 1 } });
	fila[FCOL.FECHA] = { v: fechaCorta(f.fecha_facturacion), s: centrado(zebra) };
	fila[FCOL.ESTADO] = { v: f.estado, s: estiloEstadoFactura(zebra, f.estado) };
	fila[FCOL.LIQUIDACIONES] = {
		v: f.total_liquidaciones ?? f.items?.length ?? 0,
		s: centrado(zebra)
	};
	/// Enlaza a Liquidaciones (doble clic salta al primer consecutivo listado).
	fila[FCOL.CONSECUTIVOS] = {
		v: consecutivos,
		s: consecutivos ? comoEnlace(apagado(zebra)) : apagado(zebra)
	};
	fila[FCOL.VALOR_TOTAL] = { v: Number(f.valor_total) || 0, s: { ...money(zebra), bl: 1 } };
	fila[FCOL.FACTURADO_POR] = { v: f.facturado_por?.nombre ?? '', s: apagado(zebra) };
	fila[FCOL.ANULADA_POR] = { v: f.anulado_por?.nombre ?? '', s: apagado(zebra) };
	fila[FCOL.MOTIVO] = { v: f.motivo_anulacion ?? '', s: apagado(zebra) };
	fila[FCOL.OBSERVACIONES] = { v: f.observaciones ?? '', s: apagado(zebra) };
	return fila;
}

export function buildFacturasSheet(facturas: FacturaLiquidacion[]): FacturasSheetResult {
	const cellData: Record<number, Record<number, ICellData>> = {};
	const set = (r: number, c: number, cell: ICellData) => {
		(cellData[r] ??= {})[c] = cell;
	};

	const headerStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN },
		ht: HorizontalAlign.CENTER,
		bd: allBorders()
	};
	const totalesStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders()
	};

	const HEADER_ROW = 0;
	HEADERS.forEach((h, c) => set(HEADER_ROW, c, { v: h, s: headerStyle }));

	const filas = new Map<number, FilaFactura>();
	const filaPorFactura = new Map<string, number>();
	const PRIMERA_FILA = HEADER_ROW + 1;

	let sumaActivas = 0;
	facturas.forEach((f, i) => {
		const r = PRIMERA_FILA + i;
		const zebra = i % 2 === 1;
		filaFacturaCeldas(f, zebra, i + 1).forEach((celda, c) => set(r, c, celda));
		filas.set(r, {
			fila: r,
			id: f.id,
			numero_factura: f.numero_factura,
			estado: f.estado,
			valor_total: Number(f.valor_total) || 0,
			zebra
		});
		filaPorFactura.set(f.id, r);
		if (f.estado === 'ACTIVA') sumaActivas += Number(f.valor_total) || 0;
	});

	const TOTALES_ROW = PRIMERA_FILA + facturas.length;
	for (let c = 0; c < FACTURAS_TOTAL_COLS; c++) {
		set(TOTALES_ROW, c, { v: '', s: totalesStyle });
	}
	set(TOTALES_ROW, FCOL.NUMERO, { v: `${facturas.length} facturas`, s: totalesStyle });
	if (facturas.length > 0) {
		const letra = colLetra(FCOL.LIQUIDACIONES);
		set(TOTALES_ROW, FCOL.LIQUIDACIONES, {
			f: `=SUBTOTAL(109,${letra}${PRIMERA_FILA + 1}:${letra}${TOTALES_ROW})`,
			s: totalesStyle
		});
		// Solo ACTIVAS: sumar las anuladas junto a las vivas daría un "total
		// facturado" que nadie podría conciliar con contabilidad. Va como
		// número calculado, no como fórmula, porque la condición vive en el
		// estado y no en la celda.
		set(TOTALES_ROW, FCOL.VALOR_TOTAL, {
			v: sumaActivas,
			s: { ...totalesStyle, n: { pattern: '"$"#,##0' } } as any
		});
		set(TOTALES_ROW, FCOL.FACTURADO_POR, { v: 'Σ solo ACTIVAS', s: { ...totalesStyle, fs: 9, cl: { rgb: MUTED } } });
	}

	const colData: Record<number, { w: number }> = {};
	WIDTHS.forEach((w, i) => {
		colData[i] = { w };
	});

	const sheet: Partial<IWorksheetData> = {
		id: FACTURAS_SHEET_ID,
		name: 'Facturas',
		tabColor: '#1D4ED8',
		hidden: BooleanNumber.FALSE,
		freeze: { startRow: 1, startColumn: 2, ySplit: 1, xSplit: 2 },
		rowCount: TOTALES_ROW + 1,
		columnCount: FACTURAS_TOTAL_COLS,
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

	return {
		sheet,
		filas,
		filaPorFactura,
		anclas: { header: HEADER_ROW, primeraFila: PRIMERA_FILA, totales: TOTALES_ROW },
		sumaActivas
	};
}
