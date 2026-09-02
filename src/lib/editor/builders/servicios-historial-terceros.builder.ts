/**
 * Hoja «Terceros» del canvas de historial de liquidaciones de servicios.
 *
 * Es el tab de Terceros del listado clásico convertido en hoja: el historial
 * de ítems de terceros (propietarios) de las liquidaciones, una fila por
 * ítem. Solo lectura, igual que el tab: los terceros se editan dentro de la
 * liquidación que los genera.
 */

import {
	BooleanNumber,
	HorizontalAlign,
	type ICellData,
	type IStyleData,
	type IWorksheetData
} from '@univerjs/core';
import type { TerceroItemHistorial } from '$lib/api/liquidaciones-servicios';
export type { TerceroItemHistorial };

import {
	GREEN,
	TEXT_DARK,
	MUTED,
	TOTALES_BG,
	ZEBRA_BG,
	allBorders,
	colLetra,
	comoEnlace,
	comoTexto,
	MESES_CORTOS as MESES
} from './historial-comun';

export const TERCEROS_SHEET_ID = 'hoja-terceros';

export const TCOL = {
	NUM: 0,
	CONSECUTIVO: 1,
	CLIENTE: 2,
	PLACA: 3,
	PLANILLA: 4,
	TERCERO: 5,
	RECORRIDO: 6,
	FECHAS: 7,
	VALOR_UNITARIO: 8,
	CANTIDAD: 9,
	TOTAL_FACTURADO: 10,
	PCT_ADMIN: 11,
	VALOR_ADMIN: 12,
	VALOR_LIQUIDAR: 13,
	INGRESO_EMPRESA: 14,
	FACTURA: 15,
	PERIODO: 16
} as const;

export const TERCEROS_TOTAL_COLS = 17;

const HEADERS = [
	'#',
	'CONSECUTIVO',
	'CLIENTE',
	'PLACA',
	'N° PLANILLA',
	'TERCERO (PROPIETARIO)',
	'RECORRIDO',
	'FECHAS',
	'V/UNITARIO',
	'CANT.',
	'TOTAL FACT.',
	'% ADMIN',
	'ADMON $',
	'V/LIQUIDAR',
	'ING. COTRANSMEQ',
	'N° FACTURA',
	'PERIODO'
];

const WIDTHS = [44, 128, 210, 86, 100, 210, 240, 130, 108, 60, 118, 70, 108, 118, 130, 112, 88];

export interface TercerosSheetResult {
	sheet: Partial<IWorksheetData>;
	totalFilas: number;
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

export function buildTercerosSheet(items: TerceroItemHistorial[]): TercerosSheetResult {
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
	const totalesMoney: IStyleData = { ...totalesStyle, n: { pattern: '"$"#,##0' } } as any;

	const HEADER_ROW = 0;
	HEADERS.forEach((h, c) => set(HEADER_ROW, c, { v: h, s: headerStyle }));

	const PRIMERA_FILA = HEADER_ROW + 1;

	items.forEach((t, i) => {
		const r = PRIMERA_FILA + i;
		const z = i % 2 === 1;
		const liq = t.liquidacion;
		const facturaViva = liq?.factura_items?.[0]?.factura;

		set(r, TCOL.NUM, { v: i + 1, s: centrado(z) });
		/// Enlaza a Liquidaciones. Sin consecutivo no hay destino.
		const consecutivo = liq?.consecutivo ?? '';
		const estiloConsecutivo = { ...base(z), bl: 1 };
		set(r, TCOL.CONSECUTIVO, {
			v: consecutivo,
			s: consecutivo ? comoEnlace(estiloConsecutivo) : estiloConsecutivo
		});
		set(r, TCOL.CLIENTE, { v: liq?.cliente?.nombre ?? '', s: base(z) });
		set(r, TCOL.PLACA, { v: t.placa ?? '', s: { ...centrado(z), bl: 1 } });
		/// Nº de planilla: identificador, no cantidad.
		set(r, TCOL.PLANILLA, comoTexto({ v: t.item?.numero_planilla ?? '', s: apagado(z) }));
		set(r, TCOL.TERCERO, { v: t.tercero?.nombre_completo ?? '', s: base(z) });
		set(r, TCOL.RECORRIDO, { v: t.recorrido ?? '', s: apagado(z) });
		set(r, TCOL.FECHAS, { v: t.fechas ?? '', s: centrado(z) });
		set(r, TCOL.VALOR_UNITARIO, { v: Number(t.valor_unitario) || 0, s: money(z) });
		set(r, TCOL.CANTIDAD, { v: Number(t.cantidad) || 0, s: centrado(z) });
		set(r, TCOL.TOTAL_FACTURADO, { v: Number(t.total_facturado) || 0, s: money(z) });
		set(r, TCOL.PCT_ADMIN, { v: Number(t.porcentaje_admin) || 0, s: centrado(z) });
		set(r, TCOL.VALOR_ADMIN, { v: Number(t.valor_admin) || 0, s: money(z) });
		set(r, TCOL.VALOR_LIQUIDAR, { v: Number(t.valor_liquidar) || 0, s: { ...money(z), bl: 1 } });
		set(r, TCOL.INGRESO_EMPRESA, { v: Number(t.ingreso_empresa) || 0, s: money(z) });
		set(r, TCOL.FACTURA, {
			v: facturaViva?.numero_factura ?? '',
			s: { ...centrado(z), bl: facturaViva ? 1 : 0 }
		});
		set(r, TCOL.PERIODO, {
			v: liq?.mes ? `${MESES[liq.mes - 1]} ${liq.anio}` : '',
			s: centrado(z)
		});
	});

	const TOTALES_ROW = PRIMERA_FILA + items.length;
	for (let c = 0; c < TERCEROS_TOTAL_COLS; c++) {
		set(TOTALES_ROW, c, { v: '', s: totalesStyle });
	}
	set(TOTALES_ROW, TCOL.CONSECUTIVO, { v: `${items.length} ítems`, s: totalesStyle });
	if (items.length > 0) {
		for (const c of [
			TCOL.TOTAL_FACTURADO,
			TCOL.VALOR_ADMIN,
			TCOL.VALOR_LIQUIDAR,
			TCOL.INGRESO_EMPRESA
		]) {
			const letra = colLetra(c);
			set(TOTALES_ROW, c, {
				f: `=SUBTOTAL(109,${letra}${PRIMERA_FILA + 1}:${letra}${TOTALES_ROW})`,
				s: totalesMoney
			});
		}
	}

	const colData: Record<number, { w: number }> = {};
	WIDTHS.forEach((w, i) => {
		colData[i] = { w };
	});

	const sheet: Partial<IWorksheetData> = {
		id: TERCEROS_SHEET_ID,
		name: 'Terceros',
		tabColor: '#B45309',
		hidden: BooleanNumber.FALSE,
		freeze: { startRow: 1, startColumn: 2, ySplit: 1, xSplit: 2 },
		rowCount: TOTALES_ROW + 1,
		columnCount: TERCEROS_TOTAL_COLS,
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

	return { sheet, totalFilas: items.length };
}
