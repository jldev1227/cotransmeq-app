/**
 * Exportación a XLSX del historial de liquidaciones de servicios.
 *
 * No reutiliza `preview/exportar-excel.ts` porque aquel parte de un
 * `DocumentoPreview` —el modelo del papel que se entrega al tercero, con sus
 * bloques y secciones— y esto es una tabla plana de una sola hoja. Adaptar el
 * historial a ese modelo sería inventar un documento que nadie imprime.
 *
 * Los importes se escriben como NÚMERO con `numFmt`. Una celda con «$ 1.234»
 * es texto: no suma, no ordena y no filtra, que es exactamente para lo que se
 * abre este fichero.
 *
 * `exceljs` entra por `import()` dinámico: pesa ~1MB y no hace falta hasta que
 * alguien pulsa el botón.
 */

import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';
import { facturaDe } from './servicios-historial.builder';

const VERDE = 'FF0F4025';
const BLANCO = 'FFFFFFFF';
const REJILLA = 'FFDDE3EB';
const FOOT_BG = 'FFE2E8F0';

const MESES = [
	'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
	'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
];

interface ColumnaXLSX {
	header: string;
	width: number;
	valor: (l: LiquidacionServicio) => string | number;
	moneda?: boolean;
	sumar?: boolean;
}

function fechaCorta(iso?: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

const COLUMNAS: ColumnaXLSX[] = [
	{ header: 'CONSECUTIVO', width: 16, valor: (l) => l.consecutivo },
	{ header: 'CLIENTE', width: 34, valor: (l) => l.cliente?.nombre ?? '' },
	{ header: 'NIT', width: 15, valor: (l) => l.cliente?.nit ?? '' },
	{ header: 'PERIODO', width: 12, valor: (l) => (l.mes ? `${MESES[l.mes - 1]} ${l.anio}` : '') },
	{ header: 'ESTADO', width: 13, valor: (l) => l.estado },
	{ header: 'N° FACTURA', width: 14, valor: (l) => facturaDe(l)?.numero_factura ?? '' },
	{ header: 'FECHA FACTURACIÓN', width: 18, valor: (l) => fechaCorta(l.fecha_facturacion) },
	{ header: '3° LIQ.', width: 9, valor: (l) => (l.tercero_liquidado ? 'SÍ' : 'NO') },
	{ header: 'OSI', width: 12, valor: (l) => l.osi ?? '' },
	{ header: 'OPERADORA', width: 16, valor: (l) => l.operadora ?? '' },
	{ header: 'ITEMS', width: 8, valor: (l) => l.total_items ?? l.items?.length ?? 0, sumar: true },
	{ header: 'PLACAS', width: 26, valor: (l) => (l.placas ?? []).join(', ') },
	{ header: 'SUBTOTAL', width: 15, valor: (l) => Number(l.subtotal) || 0, moneda: true, sumar: true },
	{ header: 'IVA', width: 13, valor: (l) => Number(l.valor_iva) || 0, moneda: true, sumar: true },
	{ header: 'TOTAL', width: 16, valor: (l) => Number(l.total) || 0, moneda: true, sumar: true },
	{
		header: 'LIQUIDADOR',
		width: 24,
		valor: (l) => l.liquidado_por?.nombre ?? l.creado_por?.nombre ?? ''
	},
	{ header: 'FECHA LIQUIDACIÓN', width: 18, valor: (l) => fechaCorta(l.fecha_liquidacion) }
];

export async function exportarHistorialXLSX(
	liquidaciones: LiquidacionServicio[],
	nombreArchivo: string
): Promise<void> {
	const ExcelJS = (await import('exceljs')).default;
	const libro = new ExcelJS.Workbook();
	libro.creator = 'Transmeralda';
	libro.created = new Date();

	const hoja = libro.addWorksheet('Historial', {
		views: [{ state: 'frozen', ySplit: 1 }]
	});

	hoja.columns = COLUMNAS.map((c) => ({ header: c.header, width: c.width }));

	const filaHeader = hoja.getRow(1);
	filaHeader.height = 20;
	filaHeader.eachCell((celda) => {
		celda.font = { bold: true, size: 10, color: { argb: BLANCO } };
		celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
		celda.alignment = { vertical: 'middle', horizontal: 'center' };
	});

	for (const l of liquidaciones) {
		const fila = hoja.addRow(COLUMNAS.map((c) => c.valor(l)));
		fila.eachCell((celda, i) => {
			const col = COLUMNAS[i - 1];
			celda.font = { size: 10 };
			celda.border = {
				top: { style: 'thin', color: { argb: REJILLA } },
				left: { style: 'thin', color: { argb: REJILLA } },
				bottom: { style: 'thin', color: { argb: REJILLA } },
				right: { style: 'thin', color: { argb: REJILLA } }
			};
			if (col?.moneda) celda.numFmt = '"$"#,##0';
		});
	}

	// ── Pie de totales ──
	//
	// Se escribe como FÓRMULA y no como número ya sumado: si alguien filtra u
	// ordena la hoja después, un total congelado mentiría.
	const primera = 2;
	const ultima = liquidaciones.length + 1;
	if (liquidaciones.length > 0) {
		const pie = hoja.addRow(
			COLUMNAS.map((c, i) => {
				if (i === 0) return `${liquidaciones.length} liquidaciones`;
				if (!c.sumar) return '';
				const letra = hoja.getColumn(i + 1).letter;
				return { formula: `SUM(${letra}${primera}:${letra}${ultima})` } as any;
			})
		);
		pie.eachCell((celda, i) => {
			const col = COLUMNAS[i - 1];
			celda.font = { bold: true, size: 10 };
			celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOOT_BG } };
			if (col?.moneda) celda.numFmt = '"$"#,##0';
		});
	}

	hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };

	const buffer = await libro.xlsx.writeBuffer();
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreArchivo;
	a.click();
	URL.revokeObjectURL(url);
}
