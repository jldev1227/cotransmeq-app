/**
 * Exportación a XLSX del historial de liquidaciones de servicios.
 *
 * Espejo del canvas: UNA FILA POR ÍTEM, con los datos de cabecera de la
 * liquidación repetidos en cada fila de su bloque. La redundancia es
 * deliberada — es lo que permite filtrar/ordenar en Excel por cualquier
 * columna sin celdas vacías "de agrupado".
 *
 * Los importes se escriben como NÚMERO con `numFmt`. Una celda con «$ 1.234»
 * es texto: no suma, no ordena y no filtra, que es exactamente para lo que se
 * abre este fichero.
 *
 * El pie suma con FÓRMULA solo las columnas de ÍTEM. Las de liquidación
 * (subtotal/IVA/total) van como número calculado en JS contando cada
 * liquidación una vez: un `SUM()` sobre la columna repetida multiplicaría
 * cada total por su número de ítems.
 *
 * `exceljs` entra por `import()` dinámico: pesa ~1MB y no hace falta hasta que
 * alguien pulsa el botón.
 */

import type {
	LiquidacionServicio,
	ItemLiquidacionServicio
} from '$lib/api/liquidaciones-servicios';
import { facturaDe } from './servicios-historial.builder';
import { fechaCorta, fechaDeCalendario, MESES_CORTOS as MESES } from './historial-comun';

const VERDE = 'FF0F4025';
const BLANCO = 'FFFFFFFF';
const REJILLA = 'FFDDE3EB';
const FOOT_BG = 'FFE2E8F0';

interface ColumnaXLSX {
	header: string;
	width: number;
	valor: (l: LiquidacionServicio, item: ItemLiquidacionServicio | null, idx: number) => string | number;
	moneda?: boolean;
	/// `SUM()` en el pie. Solo columnas de ÍTEM (ver cabecera del fichero).
	sumar?: boolean;
	/// Total de LIQUIDACIÓN repetido por fila → el pie va calculado en JS.
	sumarUnico?: boolean;
}

/// Mismo criterio que el builder del canvas: las fechas del ítem son
/// `@db.Date` y no se convierten de zona (ver `fechaDeCalendario`).
function rangoFechas(item: ItemLiquidacionServicio | null): string {
	if (!item) return '';
	const ini = fechaDeCalendario(item.fecha_inicial);
	const fin = fechaDeCalendario(item.fecha_final);
	if (!ini && !fin) return '';
	if (ini === fin || !fin) return ini;
	return `${ini} → ${fin}`;
}

const COLUMNAS: ColumnaXLSX[] = [
	{ header: 'ITEM', width: 8, valor: (_l, _i, idx) => idx },
	{ header: 'CONSECUTIVO', width: 16, valor: (l) => l.consecutivo },
	{ header: 'CLIENTE', width: 32, valor: (l) => l.cliente?.nombre ?? '' },
	{ header: 'NIT', width: 15, valor: (l) => l.cliente?.nit ?? '' },
	{ header: 'PERIODO', width: 12, valor: (l) => (l.mes ? `${MESES[l.mes - 1]} ${l.anio}` : '') },
	{ header: 'ESTADO', width: 13, valor: (l) => l.estado },
	{ header: 'N° FACTURA', width: 14, valor: (l) => facturaDe(l)?.numero_factura ?? '' },
	{ header: 'FECHA FACTURACIÓN', width: 18, valor: (l) => fechaCorta(l.fecha_facturacion) },
	{ header: 'PLACA', width: 11, valor: (_l, i) => i?.placa ?? '' },
	{ header: 'FECHAS SERVICIO', width: 24, valor: (_l, i) => rangoFechas(i) },
	{ header: 'RECORRIDO', width: 34, valor: (_l, i) => i?.recorrido ?? '' },
	{ header: 'TIPO SERVICIO', width: 16, valor: (_l, i) => i?.tipo_servicio ?? '' },
	{ header: 'N° PLANILLA', width: 13, valor: (_l, i) => i?.numero_planilla ?? '' },
	{ header: 'CANT.', width: 8, valor: (_l, i) => (i ? Number(i.cantidad) || 0 : 0), sumar: true },
	{
		header: 'VR. UNITARIO',
		width: 14,
		valor: (_l, i) => (i ? Number(i.valor_unitario) || 0 : 0),
		moneda: true
	},
	{
		header: 'VR. ITEM',
		width: 14,
		valor: (_l, i) => (i ? Number(i.valor_final) || 0 : 0),
		moneda: true,
		sumar: true
	},
	{
		header: 'RECARGOS ITEM',
		width: 14,
		valor: (_l, i) => (i ? Number(i.valor_recargos_total) || 0 : 0),
		moneda: true,
		sumar: true
	},
	{
		header: 'PERNOCTES ITEM',
		width: 14,
		valor: (_l, i) => (i ? Number(i.valor_pernoctes_total) || 0 : 0),
		moneda: true,
		sumar: true
	},
	{
		header: 'SUBTOTAL LIQ.',
		width: 15,
		valor: (l) => Number(l.subtotal) || 0,
		moneda: true,
		sumarUnico: true
	},
	{ header: 'IVA LIQ.', width: 13, valor: (l) => Number(l.valor_iva) || 0, moneda: true, sumarUnico: true },
	{ header: 'TOTAL LIQ.', width: 16, valor: (l) => Number(l.total) || 0, moneda: true, sumarUnico: true },
	{ header: '3° LIQ.', width: 9, valor: (l) => (l.tercero_liquidado ? 'SÍ' : 'NO') },
	{ header: 'OSI', width: 12, valor: (l) => l.osi ?? '' },
	{ header: 'OPERADORA', width: 16, valor: (l) => l.operadora ?? '' },
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
	libro.creator = 'Cotransmeq';
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

	let totalItems = 0;
	const sumasUnicas = new Map<number, number>();
	for (const l of liquidaciones) {
		const items: (ItemLiquidacionServicio | null)[] =
			l.items && l.items.length > 0 ? l.items : [null];
		COLUMNAS.forEach((c, ci) => {
			if (c.sumarUnico) {
				sumasUnicas.set(ci, (sumasUnicas.get(ci) ?? 0) + (Number(c.valor(l, null, 0)) || 0));
			}
		});
		items.forEach((item, idx) => {
			totalItems++;
			const fila = hoja.addRow(COLUMNAS.map((c) => c.valor(l, item, idx + 1)));
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
		});
	}

	// ── Pie de totales ──
	const primera = 2;
	const ultima = totalItems + 1;
	if (totalItems > 0) {
		const pie = hoja.addRow(
			COLUMNAS.map((c, i) => {
				if (i === 0) return `${liquidaciones.length} liq. · ${totalItems} ítems`;
				if (c.sumar) {
					const letra = hoja.getColumn(i + 1).letter;
					return { formula: `SUM(${letra}${primera}:${letra}${ultima})` } as any;
				}
				if (c.sumarUnico) return sumasUnicas.get(i) ?? 0;
				return '';
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
