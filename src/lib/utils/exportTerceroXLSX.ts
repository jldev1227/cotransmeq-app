// Utilidad para exportar una liquidación de tercero a XLSX con estilos.
//
// Reproduce la misma data que se renderiza en PreviewTerceroPDF.svelte, en una
// única hoja "Liquidación" que sigue la estructura visual del PDF:
//   1. Bloque de título (TRANSPORTES Y SERVICIOS ESMERALDA S.A.S. + GAF-FR-11).
//   2. Period bar (MES, AÑO, PLACA, CONSECUTIVO, TERCERO).
//   3. Estado de la liquidación.
//   4. Tabla principal de LIQUIDACION DE TRANSPORTE (items + adicionales + TOTALES).
//   5. DESCUENTOS POR LA PRESTACION DEL SERVICIO (costos laborales por conductor).
//   6. GASTOS DE VEHICULO — COMBUSTIBLE, EXAMENES MEDICOS Y DOTACION.
//   7. ANTICIPOS DEL VEHICULO.
//   8. IMPUESTOS Y RETENCIONES.
//   9. RESUMEN (TOTAL DESCUENTOS / TOTAL A PAGAR).
//  10. Firmas (LIQUIDADO POR / ACEPTADO POR).
//
// Se carga `exceljs` con `import()` dinámico para code-splitting (la librería pesa ~1MB).

import logoUrl from '$lib/assets/transmeralda-logo.png';

const HEADER_BG = 'FF0F4025';
const HEADER_TEXT = 'FFFFFFFF';
const ADICIONAL_BG = 'FFF7FDF9';
const TOTALES_BG = 'FFE2E8F0';
const SUBTLE_BG = 'FFF1F5F9';
const SUBTLE_BG_2 = 'FFF8FAFC';
const BORDER_COLOR = 'FFCBD5E1';
const RED = 'FFB91C1C';
const RED_SOFT = 'FFFEE2E2';
const GREEN = 'FF0F4025';
const GREEN_DARK = 'FF166534';
const GREEN_SOFT = 'FFDCFCE7';
const AMBER = 'FFB45309';
const AMBER_SOFT = 'FFFFEDD5';
const BLUE = 'FF1D4ED8';
const BLUE_SOFT = 'FFDBEAFE';
const MUTED = 'FF64748B';
const TEXT_DARK = 'FF0F172A';

const COP_FMT = '"$"#,##0;[Red]-"$"#,##0';
const PCT_FMT = '0.0"%"';
const INT_FMT = '#,##0';

interface ColSpec {
	key: string;
	label: string;
	width: number;
	align: 'left' | 'right' | 'center';
	money?: boolean;
	pct?: boolean;
	red?: boolean;
	green?: boolean;
	bold?: boolean;
}

const COLS: ColSpec[] = [
	{ key: 'num', label: '#', width: 4, align: 'center' },
	{ key: 'cliente', label: 'CLIENTE', width: 24, align: 'left' },
	{ key: 'liq', label: '# LIQ', width: 9, align: 'center' },
	{ key: 'placa', label: 'PLACA', width: 11, align: 'center' },
	{ key: 'nombre', label: 'NOMBRE 3°', width: 22, align: 'left' },
	{ key: 'recorrido', label: 'RECORRIDO', width: 26, align: 'left' },
	{ key: 'fechas', label: 'FECHAS', width: 15, align: 'center' },
	{ key: 'vunidad', label: 'V/UNIDAD', width: 13, align: 'right', money: true },
	{ key: 'cant', label: 'CANT', width: 6, align: 'center' },
	{ key: 'pct', label: 'ADMON%', width: 8, align: 'center', pct: true },
	{ key: 'admon', label: 'ADMON $', width: 13, align: 'right', money: true, red: true },
	{ key: 'total', label: 'TOTAL', width: 14, align: 'right', money: true, bold: true },
	{
		key: 'vliq',
		label: 'V/LIQUIDAR',
		width: 14,
		align: 'right',
		money: true,
		green: true,
		bold: true
	},
	{ key: 'planilla', label: '# PLANILLA', width: 12, align: 'center' },
	{
		key: 'extglobal',
		label: 'ING. EXTRA GLOBAL',
		width: 15,
		align: 'right',
		money: true
	},
	{
		key: 'extaval',
		label: 'ING. EXTRAS AVAL',
		width: 15,
		align: 'right',
		money: true
	},
	{
		key: 'ingtrans',
		label: 'ING. TRANSMERALDA',
		width: 15,
		align: 'right',
		money: true,
		bold: true
	},
	{ key: 'factura', label: '# FACTURA', width: 10, align: 'center' }
];

const TOTAL_COLS = COLS.length;
const LAST_COL_LETTER = columnLetter(TOTAL_COLS);

function columnLetter(idx: number): string {
	let s = '';
	let n = idx;
	while (n > 0) {
		const r = (n - 1) % 26;
		s = String.fromCharCode(65 + r) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

function border() {
	return {
		top: { style: 'thin', color: { argb: BORDER_COLOR } },
		left: { style: 'thin', color: { argb: BORDER_COLOR } },
		bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
		right: { style: 'thin', color: { argb: BORDER_COLOR } }
	};
}

interface CellStyleOpts {
	size?: number;
	bold?: boolean;
	italic?: boolean;
	color?: string;
	align?: 'left' | 'right' | 'center';
	valign?: 'top' | 'middle' | 'bottom';
	wrap?: boolean;
	indent?: number;
	fill?: string | null;
	noBorder?: boolean;
	numFmt?: string;
}

function buildStyle(opts: CellStyleOpts = {}) {
	const style: any = {
		font: {
			name: 'Calibri',
			size: opts.size ?? 10,
			bold: !!opts.bold,
			italic: !!opts.italic,
			color: { argb: opts.color ?? TEXT_DARK }
		},
		alignment: {
			horizontal: opts.align ?? 'left',
			vertical: opts.valign ?? 'middle',
			wrapText: !!opts.wrap,
			...(opts.indent ? { indent: opts.indent } : {})
		}
	};
	if (opts.fill) {
		style.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: opts.fill }
		};
	}
	if (!opts.noBorder) {
		style.border = border();
	}
	if (opts.numFmt !== undefined) {
		style.numFmt = opts.numFmt;
	}
	return style;
}

function setCell(ws: any, ref: string, value: any, opts: CellStyleOpts = {}) {
	const cell = ws.getCell(ref);
	cell.value = value;
	const style = buildStyle(opts);
	if (style.font) cell.font = style.font;
	if (style.alignment) cell.alignment = style.alignment;
	if (style.fill) cell.fill = style.fill;
	if (style.border) cell.border = style.border;
	if (style.numFmt !== undefined) cell.numFmt = style.numFmt;
	return cell;
}

/**
 * Aplica valor + estilos a un Cell que ya se obtuvo (ej. vía `row.getCell(n)`).
 * Útil cuando ya se tiene la referencia al cell y no se quiere volver a llamar `getCell`.
 */
function setCellValue(cell: any, value: any, opts: CellStyleOpts = {}) {
	if (value !== undefined) cell.value = value;
	const style = buildStyle(opts);
	if (style.font) cell.font = style.font;
	if (style.alignment) cell.alignment = style.alignment;
	if (style.fill) cell.fill = style.fill;
	if (style.border) cell.border = style.border;
	if (style.numFmt !== undefined) cell.numFmt = style.numFmt;
	return cell;
}

function fmtPlaca(p: string): string {
	const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	const m = s.match(/^([A-Z]+)(\d+)$/);
	return m ? `${m[1]}-${m[2]}` : s;
}

function fmtPlanillas(v: any): string {
	if (v == null) return '';
	if (Array.isArray(v)) {
		return v
			.filter(Boolean)
			.map(String)
			.map((x) => x.replace(/^["']+|["']+$/g, ''))
			.filter(Boolean)
			.join(' / ');
	}
	const s = String(v)
		.trim()
		.replace(/^["']+|["']+$/g, '');
	if (!s) return '';
	if (s.includes(',')) {
		return s
			.split(',')
			.map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
			.filter(Boolean)
			.join(' / ');
	}
	if (s.includes('|')) {
		return s
			.split('|')
			.map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
			.filter(Boolean)
			.join(' / ');
	}
	const tokens = s
		.split(/\s+/)
		.map((x) => x.replace(/^["']+|["']+$/g, ''))
		.filter(Boolean);
	return tokens.length >= 2 ? tokens.join(' / ') : s;
}

function fmtFechaCO(v: any): string {
	if (!v) return '';
	const s = String(v).trim();
	if (!s) return '';
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (m) return `${m[3]}/${m[2]}/${m[1]}`;
	const d = new Date(s);
	if (isNaN(d.getTime())) return s;
	const dd = String(d.getUTCDate()).padStart(2, '0');
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const yy = d.getUTCFullYear();
	return `${dd}/${mm}/${yy}`;
}

function getNumeroFactura(liq: any): string {
	const items = liq?.factura_items || [];
	for (const fi of items) {
		if (fi?.factura?.numero_factura) return fi.factura.numero_factura;
	}
	return '';
}

function getTerceroInfo(item: any) {
	const items = item?.items || [];
	for (const it of items) {
		const t = it?.liquidacion_tercero?.tercero;
		if (t && (t.nombre_completo || t.identificacion)) return t;
	}
	return item?.tercero || {};
}

/**
 * Carga el logo principal (PNG) que Vite resuelve desde
 * `src/lib/assets/transmeralda-logo.png` y lo devuelve como base64 sin prefijo
 * `data:image/png;base64,` para embeberlo con ExcelJS.
 *
 * Retorna `null` si falla (SSR, fetch, FileReader, etc.) — el header se renderiza
 * igual con un fallback de texto.
 */
async function getLogoBase64Png(): Promise<string | null> {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		console.warn('[XLSX][LOGO] SSR — retornando null (fallback texto)');
		return null;
	}
	console.log('[XLSX][LOGO] Intentando cargar logo desde:', logoUrl);
	try {
		const res = await fetch(logoUrl);
		console.log('[XLSX][LOGO] fetch() status:', res.status, res.statusText, 'ok:', res.ok);
		if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
		const blob = await res.blob();
		console.log('[XLSX][LOGO] blob.type:', blob.type, '· size:', blob.size, 'bytes');
		const dataUrl: string = await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
		const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
		console.log(
			'[XLSX][LOGO] OK — usando FILE logo.png. base64 length:',
			base64.length,
			'· starts:',
			base64.substring(0, 40)
		);
		return base64;
	} catch (e) {
		console.warn('[XLSX][LOGO] FALLBACK — no se pudo cargar el logo, usando texto:', e);
		return null;
	}
}

export async function exportTerceroXLSX(item: any, MESES: string[]): Promise<void> {
	if (typeof window === 'undefined') return;
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Transmeralda · Liquidación de Terceros';
	wb.created = new Date();
	wb.modified = new Date();

	const totales = computeTotales(item);
	const terceroInfo = getTerceroInfo(item);
	const docLabel = terceroInfo?.tipo_persona === 'EMPRESA' ? 'NIT' : 'CC';

	await buildLiquidacionSheet(wb, item, totales, terceroInfo, docLabel, MESES);

	const filename = `liquidacion_${item?.consecutivo || item?.id || Date.now()}_${fmtPlaca(
		item?.placa || ''
	)}.xlsx`;

	const buffer = await wb.xlsx.writeBuffer();
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function computeTotales(item: any) {
	const items = item?.items || [];
	const adicionales = Array.isArray(item?.items_adicionales) ? item.items_adicionales : [];
	const adicionalesBruto = adicionales.reduce(
		(s: number, a: any) => s + (Number(a?.valor_unitario) || 0) * (Number(a?.cantidad) || 1),
		0
	);
	const adicionalesAdmon = adicionales.reduce((s: number, a: any) => {
		const vLiqGross = (Number(a?.valor_unitario) || 0) * (Number(a?.cantidad) || 1);
		const pct = Number(a?.porcentaje_admin) || 0;
		const vAdmin =
			a?.valor_admin != null ? Number(a.valor_admin) : Math.round((vLiqGross * pct) / 100);
		return s + (Number(vAdmin) || 0);
	}, 0);
	const adicionalesNeto = adicionalesBruto - adicionalesAdmon;
	return {
		totalVUnidad:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.valor_unitario || 0), 0) +
			adicionales.reduce((s: number, a: any) => s + (Number(a?.valor_unitario) || 0), 0),
		totalCantidad:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.cantidad || 0), 0) +
			adicionales.reduce((s: number, a: any) => s + (Number(a?.cantidad) || 0), 0),
		totalAdmon:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.valor_admin || 0), 0) +
			adicionalesAdmon,
		totalFacturado:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.total_facturado || 0), 0) +
			adicionalesBruto,
		totalLiquidar:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.valor_liquidar || 0), 0) +
			adicionalesNeto,
		totalIngresoExtraGlobal: items.reduce(
			(s: number, it: any) => s + (it.liquidacion_tercero?.ingreso_extra_global || 0),
			0
		),
		totalIngresosExtraAval: items.reduce(
			(s: number, it: any) => s + (it.liquidacion_tercero?.ingresos_extra_aval || 0),
			0
		),
		totalIngresoEmpresa:
			items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.ingreso_empresa || 0), 0) -
			adicionalesNeto,
		adicionalesSum: adicionalesNeto,
		adicionalesBruto,
		adicionalesAdmon
	};
}

function buildHeader(ws: any, wb: any, imageId: string | null): void {
	const BORDER_HEAVY = { style: 'medium', color: { argb: 'FF000000' } };
	const BORDER_THIN = { style: 'thin', color: { argb: 'FFCBD5E1' } };
	const LABEL_BG = 'FFE8EEF0';

	// Alturas de filas para el bloque de 3 filas del header.
	ws.getRow(1).height = 18;
	ws.getRow(2).height = 18;
	ws.getRow(3).height = 18;

	// ── Logo: A1:B3 merge ───────────────────────────────
	ws.mergeCells('A1:B3');
	const logoCell = ws.getCell('A1');
	logoCell.alignment = { horizontal: 'center', vertical: 'middle' };
	logoCell.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: 'FFFFFFFF' }
	};
	if (imageId != null) {
		ws.addImage(imageId, {
			tl: { col: 1.04, row: 0.52 },
			ext: { width: 127, height: 52 },
			editAs: 'oneCell'
		});
	} else {
		// Fallback de texto si no se pudo cargar la imagen
		logoCell.value = 'TRANSMERALDA';
		logoCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
		logoCell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: GREEN }
		};
	}

	// ── Título: C1:O1 (company), C2:O2 (doc), C3:O3 (sub) ──
	ws.mergeCells('C1:O1');
	setCell(ws, 'C1', 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.', {
		size: 14,
		bold: true,
		color: GREEN,
		align: 'center',
		valign: 'middle',
		indent: 1,
		noBorder: true
	});

	ws.mergeCells('C2:O2');
	setCell(ws, 'C2', 'LIQUIDACIÓN DE INGRESOS RECIBIDOS PARA TERCEROS', {
		size: 11,
		bold: true,
		color: 'FF0F172A',
		align: 'center',
		valign: 'middle',
		indent: 1,
		noBorder: true
	});

	ws.mergeCells('C3:O3');
	setCell(ws, 'C3', 'GAF-FR-11  ·  Versión 2  ·  10/07/2026', {
		size: 9,
		italic: true,
		color: MUTED,
		align: 'center',
		valign: 'middle',
		indent: 1,
		noBorder: true
	});

	// ── Meta cells: P1:R3 (label | value) ────────────────
	// Layout: P = label (1 col, fondo gris, texto a la derecha)
	//         Q:R = value (2 cols merged, fondo blanco, texto a la izquierda)
	// Antes el label era O:P (2 cols) con P como filler sin texto, lo que
	// generaba una "columna vacía" entre el texto del label y el del value.
	const meta: Array<{ row: number; label: string; value: string }> = [
		{ row: 1, label: 'Codigo:', value: 'GAF-FR-11' },
		{ row: 2, label: 'Versión:', value: '2' },
		{ row: 3, label: 'Fecha:', value: '10/07/2026' }
	];
	for (const m of meta) {
		// Label (P) — 1 col, fondo gris claro, label centrado
		setCell(ws, `P${m.row}`, m.label, {
			size: 9,
			bold: true,
			color: 'FF475569',
			align: 'center',
			valign: 'middle',
			indent: 1,
			fill: LABEL_BG
		});

		// Value (Q:R) — merged, monoespaciado, verde bosque, centrado
		ws.mergeCells(`Q${m.row}:R${m.row}`);
		setCell(ws, `Q${m.row}`, m.value, {
			size: 10,
			bold: true,
			color: GREEN,
			align: 'center',
			valign: 'middle',
			indent: 1
		});
	}

	// ── Bordes del header ───────────────────────────────
	// Outer border (filas 1-3, cols 1-18) + divisores verticales pesados
	// (B|C, O|P) y divisor thin entre label (P) y value (Q).
	// Filas: top en row 1, bottom en row 3, divisores thin en row 2 (entre meta).
	for (let r = 1; r <= 3; r++) {
		for (let c = 1; c <= TOTAL_COLS; c++) {
			const cell = ws.getCell(r, c);
			const border: any = { ...(cell.border || {}) };
			if (r === 1) border.top = BORDER_HEAVY;
			if (r === 3) border.bottom = BORDER_HEAVY;
			if (c === 1) border.left = BORDER_HEAVY;
			if (c === TOTAL_COLS) border.right = BORDER_HEAVY;
			cell.border = border;
		}
	}
	// Vertical pesado: B | C  y  O | P
	for (let r = 1; r <= 3; r++) {
		const bCell = ws.getCell(r, 2);
		bCell.border = { ...bCell.border, right: BORDER_HEAVY };
		const cCell = ws.getCell(r, 3);
		cCell.border = { ...cCell.border, left: BORDER_HEAVY };
		const oCell = ws.getCell(r, 15);
		oCell.border = { ...oCell.border, right: BORDER_HEAVY };
		const pCell = ws.getCell(r, 16);
		pCell.border = { ...pCell.border, left: BORDER_HEAVY };
		// Vertical thin entre label (P) y value (Q)
		pCell.border = { ...pCell.border, right: BORDER_THIN };
		const qCell = ws.getCell(r, 17);
		qCell.border = { ...qCell.border, left: BORDER_THIN };
	}
	// Horizontal thin: separador entre meta rows (P-R)
	for (let c = 16; c <= TOTAL_COLS; c++) {
		const cell = ws.getCell(2, c);
		cell.border = { ...cell.border, bottom: BORDER_THIN };
	}
}

async function buildLiquidacionSheet(
	wb: any,
	item: any,
	totales: any,
	terceroInfo: any,
	docLabel: string,
	MESES: string[]
) {
	const ws = wb.addWorksheet('Liquidación', {
		views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 7 }]
	});

	ws.columns = COLS.map((c) => ({ width: c.width }));

	const mesTxt = item.mes ? MESES[item.mes - 1] : '';
	let row = 1;

	// ── 1. Header (logo + título + meta Codigo/Version/Fecha) ──
	const logoBase64 = await getLogoBase64Png();
	let imageId: string | null = null;
	if (logoBase64) {
		imageId = wb.addImage({ base64: logoBase64, extension: 'png' });
		console.log('[XLSX][LOGO] imageId agregado al workbook:', imageId);
	} else {
		console.warn('[XLSX][LOGO] logoBase64 es null → buildHeader renderizará FALLBACK texto');
	}
	buildHeader(ws, wb, imageId);
	row = 4;

	row++; // gap → fila 5

	// ── 2. Period bar (fila 5) ─────────────────────────────
	const periodPairs: Array<{
		label: string;
		value: string;
		labelCol: string;
		valueStartCol: string;
		valueEndCol: string;
	}> = [
		{
			label: 'MES',
			value: mesTxt,
			labelCol: 'A',
			valueStartCol: 'B',
			valueEndCol: 'C'
		},
		{
			label: 'AÑO',
			value: String(item.anio || ''),
			labelCol: 'D',
			valueStartCol: 'E',
			valueEndCol: 'F'
		},
		{
			label: 'PLACA',
			value: fmtPlaca(item.placa || ''),
			labelCol: 'G',
			valueStartCol: 'H',
			valueEndCol: 'I'
		},
		{
			label: 'CONSECUTIVO',
			value: item.consecutivo || '',
			labelCol: 'J',
			valueStartCol: 'K',
			valueEndCol: 'L'
		},
		{
			label: 'TERCERO',
			value: terceroInfo?.nombre_completo
				? `${terceroInfo.nombre_completo}${
						terceroInfo.identificacion ? `  ·  ${docLabel} ${terceroInfo.identificacion}` : ''
					}`
				: '—',
			labelCol: 'M',
			valueStartCol: 'N',
			valueEndCol: LAST_COL_LETTER
		}
	];
	ws.getRow(row).height = 22;
	for (const p of periodPairs) {
		setCell(ws, `${p.labelCol}${row}`, p.label, {
			size: 9,
			bold: true,
			color: 'FF475569',
			align: 'right',
			fill: SUBTLE_BG
		});
		ws.mergeCells(`${p.valueStartCol}${row}:${p.valueEndCol}${row}`);
		setCell(ws, `${p.valueStartCol}${row}`, p.value, {
			size: 10,
			bold: true,
			align: 'left',
			fill: SUBTLE_BG
		});
	}
	row++;

	// ── 3. Estado (fila 6) ─────────────────────────────────
	ws.mergeCells(`A${row}:${LAST_COL_LETTER}${row}`);
	const estado = (item.estado || 'BORRADOR').toUpperCase();
	setCell(ws, `A${row}`, `ESTADO: ${estado}`, {
		size: 9,
		bold: true,
		color: MUTED,
		align: 'left',
		noBorder: true
	});
	ws.getRow(row).height = 14;
	row++;

	// ── 4. Tabla principal: LIQUIDACION DE TRANSPORTE ──────
	row = writeMainTable(ws, row, item, totales);
	row++;

	// ── 5. DESCUENTOS POR LA PRESTACION DEL SERVICIO ───────
	row = writeDescuentosLaboralesSection(ws, row, item);
	row++;

	// ── 6. GASTOS DE VEHICULO ──────────────────────────────
	row = writeGastosSection(ws, row, item);
	row++;

	// ── 7. ANTICIPOS DEL VEHICULO ─────────────────────────
	row = writeAnticiposSection(ws, row, item);
	row++;

	// ── 8. IMPUESTOS Y RETENCIONES ─────────────────────────
	row = writeImpuestosSection(ws, row, item);
	row++;

	// ── 9. RESUMEN: TOTAL DESCUENTOS / TOTAL A PAGAR ───────
	row = writeResumen(ws, row, item, totales);
}

function writeMainTable(ws: any, startRow: number, item: any, totales: any): number {
	let row = startRow;

	// Título de la sección
	ws.mergeCells(`A${row}:${LAST_COL_LETTER}${row}`);
	setCell(ws, `A${row}`, 'LIQUIDACIÓN DE TRANSPORTE', {
		size: 11,
		bold: true,
		color: HEADER_TEXT,
		align: 'left',
		fill: HEADER_BG
	});
	ws.getRow(row).height = 22;
	row++;

	// Header row
	const headerRow = ws.getRow(row);
	headerRow.height = 32;
	COLS.forEach((c, i) => {
		const cell = headerRow.getCell(i + 1);
		cell.value = c.label;
		cell.font = {
			name: 'Calibri',
			size: 10,
			bold: true,
			color: { argb: HEADER_TEXT }
		};
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
		cell.border = border();
	});
	row++;

	// Data rows
	const items = (item.items || []).filter((it: any) => {
		const lt = it.liquidacion_tercero || {};
		const vAdmin = lt.valor_admin || 0;
		const total = lt.total_facturado || 0;
		const vLiq = lt.valor_liquidar || 0;
		return !(vAdmin === 0 && total === 0 && vLiq === 0);
	});
	const adicionales = Array.isArray(item.items_adicionales) ? item.items_adicionales : [];
	let rowNum = 1;

	for (const it of items) {
		const lt = it.liquidacion_tercero || {};
		const liq = lt.liquidacion || {};
		const terc = lt.tercero || {};
		const numFactura = getNumeroFactura(liq);
		writeMainRow(ws, row, {
			num: rowNum++,
			cliente: liq.cliente?.nombre || '',
			liq: liq.consecutivo || '',
			placa: fmtPlaca(lt.placa || item.placa || ''),
			nombre: terc.nombre_completo || item.tercero?.nombre_completo || '—',
			recorrido: lt.recorrido || lt.placa || item.placa || '',
			fechas: lt.fechas || '',
			vunidad: Number(lt.valor_unitario) || 0,
			cant: Number(lt.cantidad) || 1,
			pct: Number(lt.porcentaje_admin) || 0,
			admon: Number(lt.valor_admin) || 0,
			total: Number(lt.total_facturado) || 0,
			vliq: Number(lt.valor_liquidar) || 0,
			planilla: fmtPlanillas(lt.item?.numero_planilla),
			extglobal: Number(lt.ingreso_extra_global) || 0,
			extaval: Number(lt.ingresos_extra_aval) || 0,
			ingtrans: Number(lt.ingreso_empresa) || 0,
			factura: numFactura
		});
		row++;
	}

	for (const adc of adicionales) {
		const vLiqGross = (Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 1);
		const pctAdc = Number(adc.porcentaje_admin) || 0;
		const vAdminAdc =
			adc.valor_admin != null ? Number(adc.valor_admin) : Math.round((vLiqGross * pctAdc) / 100);
		const vLiqNeto = vLiqGross - vAdminAdc;
		writeMainRow(ws, row, {
			num: 'T',
			cliente: adc.cliente || 'TRANSMERALDA',
			liq: '—',
			placa: fmtPlaca(adc.placa || item.placa || ''),
			nombre: adc.tercero_nombre || item.tercero?.nombre_completo || '—',
			recorrido: adc.recorrido || '—',
			fechas: adc.fechas || '',
			vunidad: Number(adc.valor_unitario) || 0,
			cant: Number(adc.cantidad) || 1,
			pct: pctAdc,
			admon: vAdminAdc,
			total: vLiqGross,
			vliq: vLiqNeto,
			planilla: '—',
			extglobal: 0,
			extaval: 0,
			ingtrans: -vLiqNeto,
			factura: '—',
			esAdicional: true
		});
		row++;
	}

	// Fila TOTALES
	ws.mergeCells(`A${row}:F${row}`);
	const totalesLabel = ws.getCell(`A${row}`);
	totalesLabel.value = 'TOTALES';
	totalesLabel.font = { name: 'Calibri', size: 10, bold: true, color: { argb: TEXT_DARK } };
	totalesLabel.alignment = { horizontal: 'right', vertical: 'middle' };
	totalesLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALES_BG } };
	totalesLabel.border = border();

	for (let i = 6; i < COLS.length; i++) {
		const c = COLS[i];
		const cell = ws.getCell(row, i + 1);
		cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: TEXT_DARK } };
		cell.alignment = { vertical: 'middle' };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALES_BG } };
		cell.border = border();

		if (c.key === 'admon') {
			cell.value = totales.totalAdmon;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
			cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: RED } };
		} else if (c.key === 'total') {
			cell.value = totales.totalFacturado;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
		} else if (c.key === 'vliq') {
			cell.value = totales.totalLiquidar;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
			cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: GREEN_DARK } };
		} else if (c.key === 'extglobal') {
			cell.value = totales.totalIngresoExtraGlobal;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
		} else if (c.key === 'extaval') {
			cell.value = totales.totalIngresosExtraAval;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
		} else if (c.key === 'ingtrans') {
			cell.value = totales.totalIngresoEmpresa;
			cell.numFmt = COP_FMT;
			cell.alignment = { horizontal: 'right', vertical: 'middle' };
		} else {
			cell.value = '';
		}
	}
	ws.getRow(row).height = 22;
	row++;
	return row;
}

function writeMainRow(ws: any, rowIdx: number, data: Record<string, any>) {
	const row = ws.getRow(rowIdx);
	const isAdicional = !!data.esAdicional;
	row.height = 18;
	COLS.forEach((c, i) => {
		const cell = row.getCell(i + 1);
		let v: any = data[c.key];
		if (c.money) v = Number(v) || 0;
		if (c.pct) v = Number(v) || 0;
		cell.value = v;
		cell.font = {
			name: 'Calibri',
			size: 9,
			bold: !!c.bold || isAdicional,
			color: { argb: c.red ? RED : c.green ? GREEN_DARK : TEXT_DARK }
		};
		cell.alignment = {
			horizontal: c.align,
			vertical: 'middle',
			wrapText: false
		};
		cell.border = border();
		if (isAdicional) {
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: ADICIONAL_BG }
			};
		}
		if (c.money) cell.numFmt = COP_FMT;
		if (c.pct) cell.numFmt = PCT_FMT;
	});
}

function writeSectionTitle(
	ws: any,
	row: number,
	title: string,
	color: string,
	height = 22,
	lastCol: string = 'F'
): number {
	// Span A:F por defecto (6 cols: CONCEPTO mergeado A:B + 4 cols de datos).
	// Las 4 secciones (DESCUENTOS, GASTOS, ANTICIPOS, IMPUESTOS) usan este ancho.
	ws.mergeCells(`A${row}:${lastCol}${row}`);
	const cell = setCell(ws, `A${row}`, title, {
		size: 11,
		bold: true,
		color: HEADER_TEXT,
		align: 'left',
		fill: color
	});
	const lastColIdx = lastCol.charCodeAt(0) - 64; // 'E' → 5, 'F' → 6, 'G' → 7
	for (let c = 2; c <= lastColIdx; c++) {
		const bgCell = ws.getCell(row, c);
		bgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
		bgCell.border = border();
	}
	ws.getRow(row).height = height;
	return row + 1;
}

function writeDescuentosLaboralesSection(ws: any, startRow: number, item: any): number {
	const conceptos = item.conceptos || [];
	const laborales = conceptos.filter((c: any) => c.tipo === 'COSTO_LABORAL');
	let row = startRow;

	// Section title span A:F (6 cols: CONCEPTO A:B merged + DIAS/% + VALOR + TOTAL + blank)
	row = writeSectionTitle(ws, row, 'DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO', HEADER_BG);

	// Sub-header: CONCEPTO(A:B merged) | DIAS/%(C) | VALOR(D) | TOTAL(E) | (blank F) — 6 cols
	const subHeaderRow = ws.getRow(row);
	subHeaderRow.height = 24;
	const HEADER_FILL = 'FF166534';
	// CONCEPTO merged A:B
	ws.mergeCells(`A${row}:B${row}`);
	const conceptoHeaderCell = subHeaderRow.getCell(1);
	conceptoHeaderCell.value = 'CONCEPTO';
	conceptoHeaderCell.font = {
		name: 'Calibri',
		size: 10,
		bold: true,
		color: { argb: HEADER_TEXT }
	};
	conceptoHeaderCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
	conceptoHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
	conceptoHeaderCell.border = border();
	const conceptoBHeaderCell = subHeaderRow.getCell(2);
	conceptoBHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
	conceptoBHeaderCell.border = border();
	// Resto: DIAS/%(C), VALOR(D), TOTAL(E), blank(F)
	const restSubHeaders = ['DIAS / %', 'VALOR', 'TOTAL', ''];
	restSubHeaders.forEach((h, i) => {
		const cell = subHeaderRow.getCell(i + 3); // C=3, D=4, E=5, F=6
		cell.value = h;
		cell.font = {
			name: 'Calibri',
			size: 10,
			bold: true,
			color: { argb: HEADER_TEXT }
		};
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
		cell.border = border();
	});
	row++;

	const grupos = groupByConductor(laborales);
	if (grupos.length === 0) {
		ws.mergeCells(`A${row}:F${row}`);
		setCell(ws, `A${row}`, 'Sin costos laborales registrados.', {
			size: 9,
			italic: true,
			color: MUTED,
			align: 'center',
			noBorder: true
		});
		ws.getRow(row).height = 18;
		row++;
		return row;
	}

	for (const grupo of grupos) {
		// Cabecera del conductor (fusionada A:F) — aquí va el nombre + CC
		ws.mergeCells(`A${row}:F${row}`);
		setCell(ws, `A${row}`, `${grupo.nombre}${grupo.id ? `  ·  CC ${grupo.id}` : ''}`, {
			size: 10,
			bold: true,
			color: GREEN,
			align: 'left',
			fill: SUBTLE_BG
		});
		// Celdas B-F: extender el fill
		for (let c = 2; c <= 6; c++) {
			const cell = ws.getCell(row, c);
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE_BG } };
			cell.border = border();
		}
		ws.getRow(row).height = 18;
		row++;

		// Salarios
		for (const c of grupo.salarios) {
			writeLaboralRow(ws, row, c, false);
			row++;
		}

		// PRESTACIONES SOCIALES (category row) — el label va en A:B mergeado
		if (grupo.prestaciones.length > 0) {
			const pctPrest = grupo.prestaciones.reduce((s: number, c: any) => s + (c.porcentaje || 0), 0);
			const totalPrest = grupo.prestaciones.reduce(
				(s: number, c: any) => s + (c.valor_total || 0),
				0
			);
			writeCategoryRow(ws, row, 'PRESTACIONES SOCIALES', pctPrest, totalPrest);
			row++;
			for (const c of grupo.prestaciones) {
				writeLaboralRow(ws, row, c, true);
				row++;
			}
		}

		// SEGURIDAD SOCIAL (category row) — el label va en A:B mergeado
		if (grupo.seguridadSocial.length > 0) {
			const pctSS = grupo.seguridadSocial.reduce((s: number, c: any) => s + (c.porcentaje || 0), 0);
			const totalSS = grupo.seguridadSocial.reduce(
				(s: number, c: any) => s + (c.valor_total || 0),
				0
			);
			writeCategoryRow(ws, row, 'SEGURIDAD SOCIAL', pctSS, totalSS);
			row++;
			for (const c of grupo.seguridadSocial) {
				writeLaboralRow(ws, row, c, true);
				row++;
			}
		}

		// Subtotal del conductor: label A:E merged, value F
		ws.mergeCells(`A${row}:E${row}`);
		setCell(ws, `A${row}`, `VALOR TOTAL CONDUCTOR · ${grupo.nombre.toUpperCase()}`, {
			size: 10,
			bold: true,
			align: 'right',
			fill: SUBTLE_BG
		});
		setCell(ws, `F${row}`, grupo.totalConductor, {
			size: 10,
			bold: true,
			align: 'right',
			fill: SUBTLE_BG,
			numFmt: COP_FMT
		});
		// Celdas intermedias B-E: extender fill+border
		for (let c = 2; c <= 5; c++) {
			const cell = ws.getCell(row, c);
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE_BG } };
			cell.border = border();
		}
		ws.getRow(row).height = 18;
		row++;
		row++; // separador
	}

	return row;
}

function writeLaboralRow(ws: any, row: number, c: any, isSub: boolean) {
	const displayConcepto = (c.concepto || '').replace(/_/g, ' ');
	const dias = c.dias || '';
	const valor = Number(c.valor_unitario) || 0;
	const total = Number(c.valor_total) || 0;

	// Layout 6 cols: CONCEPTO(A:B merged) | DIAS/%(C) | VALOR(D) | TOTAL(E) | (blank F)
	ws.mergeCells(`A${row}:B${row}`);
	const conceptoCell = ws.getCell(`A${row}`);
	conceptoCell.value = displayConcepto;
	conceptoCell.font = {
		name: 'Calibri',
		size: 9,
		bold: false,
		italic: isSub,
		color: { argb: TEXT_DARK }
	};
	conceptoCell.alignment = {
		horizontal: 'left',
		vertical: 'middle',
		...(isSub ? { indent: 1 } : {})
	};
	conceptoCell.border = border();
	// B cell en el merge: mismo border
	ws.getCell(`B${row}`).border = border();

	// Resto: DIAS/%(C), VALOR(D), TOTAL(E), blank(F)
	const restCells = [
		{ v: dias === '' ? '' : dias, align: 'center' as const, bold: false, italic: isSub },
		{ v: valor, align: 'right' as const, bold: false, italic: isSub, money: true },
		{ v: total, align: 'right' as const, bold: !isSub, italic: isSub, money: true },
		{ v: '', align: 'left' as const, bold: false, italic: false }
	];
	restCells.forEach((cd, i) => {
		const cell = ws.getCell(row, i + 3); // C=3, D=4, E=5, F=6
		cell.value = cd.v;
		cell.font = {
			name: 'Calibri',
			size: 9,
			bold: !!cd.bold,
			italic: !!cd.italic,
			color: { argb: TEXT_DARK }
		};
		cell.alignment = { horizontal: cd.align, vertical: 'middle' };
		cell.border = border();
		if (cd.money && typeof cd.v === 'number') cell.numFmt = COP_FMT;
	});
	ws.getRow(row).height = 16;
}

function writeCategoryRow(ws: any, row: number, label: string, pct: number, total: number) {
	// Layout 6 cols: label(A:B merged) | DIAS/%(C) | VALOR(D, empty) | TOTAL(E) | blank(F)
	ws.mergeCells(`A${row}:B${row}`);
	const labelCell = ws.getCell(`A${row}`);
	labelCell.value = label;
	labelCell.font = {
		name: 'Calibri',
		size: 9,
		bold: true,
		italic: true,
		color: { argb: GREEN }
	};
	labelCell.alignment = { horizontal: 'left', vertical: 'middle' };
	labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE_BG_2 } };
	labelCell.border = border();
	// B cell en el merge: mismo fill+border
	const labelBCell = ws.getCell(`B${row}`);
	labelBCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE_BG_2 } };
	labelBCell.border = border();

	// Resto: DIAS/%(C), VALOR(D, empty), TOTAL(E), blank(F)
	const restCells = [
		{ v: pct, align: 'center' as const, bold: true, italic: true, color: GREEN, numFmt: PCT_FMT },
		{ v: '', align: 'right' as const, bold: false },
		{ v: total, align: 'right' as const, bold: true, italic: true, color: GREEN, money: true },
		{ v: '', align: 'left' as const, bold: false }
	];
	restCells.forEach((cd, i) => {
		const cell = ws.getCell(row, i + 3); // C=3, D=4, E=5, F=6
		cell.value = cd.v;
		cell.font = {
			name: 'Calibri',
			size: 9,
			bold: !!cd.bold,
			italic: !!cd.italic,
			color: { argb: cd.color ?? TEXT_DARK }
		};
		cell.alignment = { horizontal: cd.align, vertical: 'middle' };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE_BG_2 } };
		cell.border = border();
		if (cd.money && typeof cd.v === 'number') cell.numFmt = COP_FMT;
		else if (cd.numFmt) cell.numFmt = cd.numFmt;
	});
	ws.getRow(row).height = 16;
}

function writeGastosSection(ws: any, startRow: number, item: any): number {
	const conceptos = item.conceptos || [];
	const gastos = conceptos.filter((c: any) => c.tipo === 'GASTO_OPERATIVO');
	let row = startRow;

	row = writeSectionTitle(
		ws,
		row,
		'GASTOS DE VEHICULO — COMBUSTIBLE, EXAMENES MEDICOS Y DOTACION',
		AMBER
	);

	// Sub-header: CONCEPTO(A:B merged) | CANT(C) | %(D) | VALOR(E) | TOTAL(F) — 6 cols
	const subHeaderRow = ws.getRow(row);
	subHeaderRow.height = 24;
	// CONCEPTO merged A:B
	ws.mergeCells(`A${row}:B${row}`);
	const conceptoHeaderCell = subHeaderRow.getCell(1);
	conceptoHeaderCell.value = 'CONCEPTO';
	conceptoHeaderCell.font = {
		name: 'Calibri',
		size: 10,
		bold: true,
		color: { argb: HEADER_TEXT }
	};
	conceptoHeaderCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
	conceptoHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
	conceptoHeaderCell.border = border();

	const conceptoBHeaderCell = subHeaderRow.getCell(2);
	conceptoBHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
	conceptoBHeaderCell.border = border();

	ws.mergeCells(`C${row}:D${row}`);

	const cantidadHeaderCell = subHeaderRow.getCell(3);
	cantidadHeaderCell.value = 'Cantidad';
	cantidadHeaderCell.font = {
		name: 'Calibri',
		size: 10,
		bold: true,
		color: { argb: HEADER_TEXT }
	};
	cantidadHeaderCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
	cantidadHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
	cantidadHeaderCell.border = border();

	const cantidadDHeaderCell = subHeaderRow.getCell(4);
	cantidadDHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
	cantidadDHeaderCell.border = border();

	// Resto: CANT(C), %(D), VALOR(E), TOTAL(F)
	const restSubHeaders = ['VALOR', 'TOTAL'];
	restSubHeaders.forEach((h, i) => {
		const cell = subHeaderRow.getCell(i + 5); // E=5, F=6
		cell.value = h;
		cell.font = {
			name: 'Calibri',
			size: 10,
			bold: true,
			color: { argb: HEADER_TEXT }
		};
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
		cell.border = border();
	});
	row++;

	if (gastos.length === 0) {
		ws.mergeCells(`A${row}:F${row}`);
		setCell(ws, `A${row}`, 'Sin gastos registrados.', {
			size: 9,
			italic: true,
			color: MUTED,
			align: 'center',
			noBorder: true
		});
		ws.getRow(row).height = 18;
		row++;
		return row;
	}

	for (const c of gastos) {
		writeSimpleConceptoRow(ws, row, c, false);
		row++;
	}

	// TOTAL: label A:E merged, value F
	const totalGastos = gastos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
	row = writeSubtotalRow(ws, row, 'TOTAL GASTOS DE VEHICULO', totalGastos, AMBER, AMBER_SOFT);
	row++;
	return row;
}

function writeAnticiposSection(ws: any, startRow: number, item: any): number {
	const conceptos = item.conceptos || [];
	const anticipos = conceptos.filter((c: any) => c.tipo === 'ANTICIPO');
	let row = startRow;

	row = writeSectionTitle(ws, row, 'ANTICIPOS DEL VEHICULO', BLUE);

	// Sub-header: CONCEPTO(A:B merged) | FECHA(C:D merged) | (spacer E) | VALOR(F) — 6 cols
	const subHeaderRow = ws.getRow(row);
	subHeaderRow.height = 24;
	// CONCEPTO merged A:B
	ws.mergeCells(`A${row}:B${row}`);
	setCellValue(subHeaderRow.getCell(1), 'CONCEPTO', {
		size: 10,
		bold: true,
		color: HEADER_TEXT,
		align: 'center',
		fill: BLUE
	});
	subHeaderRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
	subHeaderRow.getCell(2).border = border();
	// C+D: FECHA (merged)
	ws.mergeCells(`C${row}:D${row}`);
	setCell(ws, `C${row}`, 'FECHA', {
		size: 10,
		bold: true,
		color: HEADER_TEXT,
		align: 'center',
		fill: BLUE
	});
	// E: empty (spacer) — mismo estilo que sub-header
	subHeaderRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
	subHeaderRow.getCell(5).border = border();
	// F: VALOR
	setCellValue(subHeaderRow.getCell(6), 'VALOR', {
		size: 10,
		bold: true,
		color: HEADER_TEXT,
		align: 'center',
		fill: BLUE
	});
	row++;

	if (anticipos.length === 0) {
		ws.mergeCells(`A${row}:F${row}`);
		setCell(ws, `A${row}`, 'Sin anticipos registrados.', {
			size: 9,
			italic: true,
			color: MUTED,
			align: 'center',
			noBorder: true
		});
		ws.getRow(row).height = 18;
		row++;
		return row;
	}

	// Filas de anticipos: CONCEPTO(A:B merged), FECHA(C:D merged), spacer(E), VALOR(F)
	for (const c of anticipos) {
		const fecha = c.observaciones ? fmtFechaCO(c.observaciones) : '';
		const displayConcepto = (c.concepto || '').replace(/_/g, ' ');
		const valor = Number(c.valor_unitario) || 0;

		// CONCEPTO merged A:B
		ws.mergeCells(`A${row}:B${row}`);
		setCell(ws, `A${row}`, displayConcepto, {
			size: 9,
			bold: true,
			align: 'left',
			color: TEXT_DARK
		});
		ws.getCell(`B${row}`).border = border();
		// C+D: FECHA (merged)
		ws.mergeCells(`C${row}:D${row}`);
		setCell(ws, `C${row}`, fecha, {
			size: 9,
			align: 'center',
			color: TEXT_DARK
		});
		// E: empty (spacer)
		const eCell = ws.getCell(`E${row}`);
		eCell.border = border();
		// F: VALOR
		setCell(ws, `F${row}`, valor, {
			size: 9,
			bold: true,
			align: 'right',
			color: TEXT_DARK,
			numFmt: COP_FMT
		});
		ws.getRow(row).height = 16;
		row++;
	}

	// TOTAL: label A:D merged, E=spacer, F=VALOR
	const totalAnticipos = anticipos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
	ws.mergeCells(`A${row}:D${row}`);
	const labelCell = ws.getCell(`A${row}`);
	labelCell.value = 'TOTAL ANTICIPOS DEL VEHICULO';
	labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BLUE } };
	labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
	labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } };
	labelCell.border = border();
	// B, C, D: fondo del merge
	for (let c = 2; c <= 4; c++) {
		const cell = ws.getCell(row, c);
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } };
		cell.border = border();
	}
	// E: spacer
	const eTotal = ws.getCell(`E${row}`);
	eTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } };
	eTotal.border = border();
	// F: VALOR total
	const valCell = ws.getCell(`F${row}`);
	valCell.value = totalAnticipos;
	valCell.numFmt = COP_FMT;
	valCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BLUE } };
	valCell.alignment = { horizontal: 'right', vertical: 'middle' };
	valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } };
	valCell.border = border();
	ws.getRow(row).height = 20;
	row++;
	return row;
}

function writeImpuestosSection(ws: any, startRow: number, item: any): number {
	const conceptos = item.conceptos || [];
	const impuestos = conceptos.filter((c: any) => c.tipo === 'IMPUESTO');
	let row = startRow;

	row = writeSectionTitle(ws, row, 'IMPUESTOS Y RETENCIONES', RED);

	// Sub-header: CONCEPTO(A:B merged) | PORCENTAJE(C) | ''(D) | ''(E) | VALOR(F) — 6 cols
	const subHeaderRow = ws.getRow(row);
	subHeaderRow.height = 24;

	// CONCEPTO merged A:B
	ws.mergeCells(`A${row}:B${row}`);

	const conceptoHeaderCell = subHeaderRow.getCell(1);
	conceptoHeaderCell.value = 'CONCEPTO';
	conceptoHeaderCell.font = {
		name: 'Calibri',
		size: 10,
		bold: true,
		color: { argb: HEADER_TEXT }
	};
	conceptoHeaderCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
	conceptoHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
	conceptoHeaderCell.border = border();

	const conceptoBHeaderCell = subHeaderRow.getCell(2);
	conceptoBHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
	conceptoBHeaderCell.border = border();

	// PORCENTAJE merged C:D
	ws.mergeCells(`C${row}:D${row}`);

	const porcentajeHeaderCell = subHeaderRow.getCell(3);
	porcentajeHeaderCell.value = 'PORCENTAJE';
	porcentajeHeaderCell.font = {
		name: 'Calibri',
		size: 10,
		bold: true,
		color: { argb: HEADER_TEXT }
	};
	porcentajeHeaderCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
	porcentajeHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
	porcentajeHeaderCell.border = border();

	// D es esclava del merge: NO le pongas .value, solo fill/border para que el borde se vea bien
	const porcentajeDHeaderCell = subHeaderRow.getCell(4);
	porcentajeDHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
	porcentajeDHeaderCell.border = border();

	// Resto: ''(D), ''(E), VALOR(F)
	const restSubHeaders = ['', 'VALOR'];
	restSubHeaders.forEach((h, i) => {
		const cell = subHeaderRow.getCell(i + 5); // D=4, E=5, F=6
		cell.value = h;
		cell.font = {
			name: 'Calibri',
			size: 10,
			bold: true,
			color: { argb: HEADER_TEXT }
		};
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
		cell.border = border();
	});
	row++;

	if (impuestos.length === 0) {
		ws.mergeCells(`A${row}:F${row}`);
		setCell(ws, `A${row}`, 'Sin impuestos registrados.', {
			size: 9,
			italic: true,
			color: MUTED,
			align: 'center',
			noBorder: true
		});
		ws.getRow(row).height = 18;
		row++;
		return row;
	}

	for (const c of impuestos) {
		writeImpuestoRow(ws, row, c, false);
		row++;
	}

	const totalImpuestos = impuestos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
	row = writeSubtotalRow(ws, row, 'TOTAL IMPUESTOS Y RETENCIONES', totalImpuestos, RED, RED_SOFT);
	row++;
	return row;
}

function writeSimpleConceptoRow(ws: any, row: number, c: any, isSub: boolean) {
	const displayConcepto = (c.concepto || '').replace(/_/g, ' ');
	const dias = c.dias || '';
	const valor = Number(c.valor_unitario) || 0;
	const total = Number(c.valor_total) || 0;

	// Layout 6 cols: CONCEPTO(A:B merged) | CANT(C) | %(D) | VALOR(E) | TOTAL(F)
	ws.mergeCells(`A${row}:B${row}`);
	const conceptoCell = ws.getCell(`A${row}`);
	conceptoCell.value = displayConcepto;
	conceptoCell.font = {
		name: 'Calibri',
		size: 9,
		bold: !isSub,
		italic: isSub,
		color: { argb: TEXT_DARK }
	};
	conceptoCell.alignment = {
		horizontal: 'left',
		vertical: 'middle',
		...(isSub ? { indent: 1 } : {})
	};
	conceptoCell.border = border();
	ws.getCell(`B${row}`).border = border();

	// PORCENTAJE merged C:D — value solo en la celda master (C)
	ws.mergeCells(`C${row}:D${row}`);
	const pctCell = ws.getCell(`C${row}`);
	pctCell.value = dias;
	pctCell.font = {
		name: 'Calibri',
		size: 9,
		bold: false,
		italic: isSub,
		color: { argb: TEXT_DARK }
	};
	pctCell.alignment = { horizontal: 'center', vertical: 'middle' };
	pctCell.border = border();

	// D es esclava del merge: solo border, sin value
	ws.getCell(`D${row}`).border = border();

	// Resto: CANT(C), %(D), VALOR(E), TOTAL(F)
	const restCells = [
		{ v: valor, align: 'right' as const, bold: false, italic: isSub, money: true },
		{ v: total, align: 'right' as const, bold: !isSub, italic: isSub, money: true }
	];
	restCells.forEach((cd, i) => {
		const cell = ws.getCell(row, i + 5); // C=3, D=4, E=5, F=6
		cell.value = cd.v;
		cell.font = {
			name: 'Calibri',
			size: 9,
			bold: !!cd.bold,
			italic: !!cd.italic,
			color: { argb: TEXT_DARK }
		};
		cell.alignment = { horizontal: cd.align, vertical: 'middle' };
		cell.border = border();
		if (cd.money && typeof cd.v === 'number') cell.numFmt = COP_FMT;
	});
	ws.getRow(row).height = 16;
}

function writeImpuestoRow(ws: any, row: number, c: any, isSub: boolean) {
	const displayConcepto = (c.concepto || '').replace(/_/g, ' ');
	const pct = c.porcentaje != null ? Number(c.porcentaje) : '';
	const total = Number(c.valor_total) || 0;

	// Layout 6 cols: CONCEPTO(A:B merged) | PORCENTAJE(C) | ''(D) | ''(E) | VALOR(F)
	ws.mergeCells(`A${row}:B${row}`);
	const conceptoCell = ws.getCell(`A${row}`);
	conceptoCell.value = displayConcepto;
	conceptoCell.font = {
		name: 'Calibri',
		size: 9,
		bold: !isSub,
		italic: isSub,
		color: { argb: TEXT_DARK }
	};
	conceptoCell.alignment = {
		horizontal: 'left',
		vertical: 'middle',
		...(isSub ? { indent: 1 } : {})
	};
	conceptoCell.border = border();
	ws.getCell(`B${row}`).border = border();

	ws.mergeCells(`C${row}:D${row}`);
	const pctCell = ws.getCell(`C${row}`);
	pctCell.value = pct;
	pctCell.font = {
		name: 'Calibri',
		size: 9,
		bold: false,
		italic: isSub,
		color: { argb: TEXT_DARK }
	};
	pctCell.alignment = { horizontal: 'center', vertical: 'middle' };
	pctCell.border = border();
	if (pct !== '') pctCell.numFmt = PCT_FMT;

	// D es esclava del merge: solo border, sin value
	ws.getCell(`D${row}`).border = border();

	// Resto: ''(E), VALOR(F)
	const restCells = [
		{ v: '', align: 'right' as const, bold: false, italic: false },
		{ v: total, align: 'right' as const, bold: !isSub, italic: isSub, money: true }
	];
	restCells.forEach((cd, i) => {
		const cell = ws.getCell(row, i + 5); // E=5, F=6
		cell.value = cd.v;
		cell.font = {
			name: 'Calibri',
			size: 9,
			bold: !!cd.bold,
			italic: !!cd.italic,
			color: { argb: TEXT_DARK }
		};
		cell.alignment = { horizontal: cd.align, vertical: 'middle' };
		cell.border = border();
		if (cd.money && typeof cd.v === 'number') cell.numFmt = COP_FMT;
		else if (cd.pct && cd.v !== '') cell.numFmt = PCT_FMT;
	});
	ws.getRow(row).height = 16;
}

function writeSubtotalRow(
	ws: any,
	row: number,
	label: string,
	total: number,
	accent: string,
	bgSoft: string
): number {
	// Layout 6 cols: label A:E merged, value F
	ws.mergeCells(`A${row}:E${row}`);
	const labelCell = setCell(ws, `A${row}`, label, {
		size: 10,
		bold: true,
		align: 'right',
		fill: bgSoft
	});
	labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: accent } };
	for (let c = 2; c <= 5; c++) {
		const cell = ws.getCell(row, c);
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgSoft } };
		cell.border = border();
	}
	const valCell = setCell(ws, `F${row}`, total, {
		size: 11,
		bold: true,
		align: 'right',
		fill: bgSoft,
		numFmt: COP_FMT
	});
	valCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: accent } };
	ws.getRow(row).height = 20;
	return row + 1;
}

function writeResumen(ws: any, startRow: number, item: any, totales: any): number {
	let row = startRow;
	const totalPagar = (totales.totalLiquidar || 0) - (Number(item.total_descuentos) || 0);

	// Layout alineado con IMPUESTOS / ANTICIPOS:
	//   Label: A:E (5 cols merged, right-align)
	//   F:    valor (con fill+border y formato monetario)
	// Sin auto-fill de columnas 7+ (evita franjas de celdas vacías).

	// ── TOTAL DESCUENTOS ─────────────────────────────────
	ws.mergeCells(`A${row}:E${row}`);
	setCell(ws, `A${row}`, 'TOTAL DESCUENTOS', {
		size: 12,
		bold: true,
		color: RED,
		align: 'right',
		fill: RED_SOFT
	});
	// B, C, D, E: extender el fondo del merge
	for (let c = 2; c <= 5; c++) {
		const cell = ws.getCell(row, c);
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_SOFT } };
		cell.border = border();
	}
	// F: valor
	setCell(ws, `F${row}`, Number(item.total_descuentos) || 0, {
		size: 13,
		bold: true,
		color: RED,
		align: 'right',
		fill: RED_SOFT,
		numFmt: COP_FMT
	});
	ws.getRow(row).height = 26;
	row++;

	// ── TOTAL A PAGAR ───────────────────────────────────
	ws.mergeCells(`A${row}:E${row}`);
	setCell(ws, `A${row}`, 'TOTAL A PAGAR', {
		size: 12,
		bold: true,
		color: GREEN_DARK,
		align: 'right',
		fill: GREEN_SOFT
	});
	for (let c = 2; c <= 5; c++) {
		const cell = ws.getCell(row, c);
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_SOFT } };
		cell.border = border();
	}
	setCell(ws, `F${row}`, totalPagar, {
		size: 13,
		bold: true,
		color: GREEN_DARK,
		align: 'right',
		fill: GREEN_SOFT,
		numFmt: COP_FMT
	});
	ws.getRow(row).height = 26;
	row++;
	return row;
}

function groupByConductor(conceptos: any[]) {
	const map = new Map<
		string,
		{
			nombre: string;
			id: string;
			salarios: any[];
			prestaciones: any[];
			seguridadSocial: any[];
			totalConductor: number;
		}
	>();
	const SALARIOS = ['SALARIO', 'AUXILIO_TRANSPORTE', 'BONIFICACION', 'OTROS_AUXILIOS', 'RECARGOS'];
	const PRESTACIONES = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA', 'VACACIONES'];
	const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

	for (const c of conceptos) {
		const key = c.conductor_id || 'sin-conductor';
		if (!map.has(key)) {
			map.set(key, {
				nombre: c.conductor
					? `${c.conductor.nombre} ${c.conductor.apellido}`
					: 'General / Consolidado',
				id: c.conductor?.numero_identificacion || '',
				salarios: [],
				prestaciones: [],
				seguridadSocial: [],
				totalConductor: 0
			});
		}
		const g = map.get(key)!;
		g.totalConductor += c.valor_total || 0;
		if (SALARIOS.includes(c.concepto)) g.salarios.push(c);
		else if (PRESTACIONES.includes(c.concepto)) g.prestaciones.push(c);
		else if (SEGURIDAD.includes(c.concepto)) g.seguridadSocial.push(c);
	}
	return Array.from(map.values());
}
