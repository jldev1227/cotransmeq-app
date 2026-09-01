/**
 * Builder del workbook Univer para el canvas **Adicionales de cierres
 * finales de terceros**.
 *
 * Estructura 1:1 con `ocasional.builder.ts` excepto la tabla de items,
 * que tiene 7 columnas (EMPRESA, DESCRIPCION, V/UNIDAD, CANT, ADMON,
 * TOTAL, V/LIQUIDAR) en lugar de las 21 del ocasional.
 *
 * LAYOUT: libro ANUAL de 12 hojas, una por mes, con `sheetBar: true`. El
 * eje del workbook es el AÑO (`unitId = workbook-adicionales-anual-YYYY`);
 * el mes es solo la hoja activa, así que cambiar de mes NO remonta el
 * engine. Cada hoja se construye con `buildAdicionalesSheet` y mantiene su
 * propio `cellData`/`colData` (ver el aviso sobre `columnData` allí).
 *
 * Secciones de cada hoja (en orden):
 *   1. ITEMS          — 7 cols, header + filas + TOTALES (SUM)
 *   2. DESCUENTOS     — DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO
 *                       (agrupado por conductor: SALARIOS + PRESTACIONES
 *                       + SEGURIDAD_SOCIAL + VALOR TOTAL CONDUCTOR)
 *   3. GASTOS         — GASTOS DE VEHÍCULO (DOTACION, EXAMEN_MEDICO,
 *                       COMBUSTIBLE, PAPELERIA, GASTOS_DIVERSOS)
 *   4. IMPUESTOS      — IMPUESTOS Y RETENCIONES (RETENCION_ICA,
 *                       AVISOS_TABLEROS, SOBRETASA_BOMBERIL, RETENCION_FUENTE)
 *   5. TOTAL DESCUENTOS (rojo) + TOTAL A PAGAR (verde)
 *
 * Las celdas editables (registradas en `adicionales-cell-binding`):
 *   - `valor_unitario` (columna C)
 *   - `cantidad`       (columna D)
 */

import {
	BooleanNumber,
	BorderStyleTypes,
	CellValueType,
	HorizontalAlign,
	LocaleType,
	type IWorkbookData,
	type ICellData,
	type IStyleData,
	type IBorderData,
	type IBorderStyleData
} from '@univerjs/core';
import {
	registrarHojaEditable,
	aplicarCapa,
	type CeldaDeCapa
} from '../business/zona-libre';
import { rellenarBordesVacios } from './relleno-bordes';
import type { AdicionalListado } from '$lib/api/liquidaciones-terceros-adicionales';
import { setAdicionalesBinding } from '../business/adicionales-cell-binding';

const GREEN = '#0F4025';
const GREEN_DARK = '#166534';
const RED = '#B91C1C';
const AMBER = '#B45309';
const AMBER_SOFT = '#FFEDD5';
const BLUE = '#1D4ED8';
const BLUE_SOFT = '#DBEAFE';
const TEXT_DARK = '#0F172A';
const SUBTLE_BG = '#F1F5F9';
const TOTALES_BG = '#E2E8F0';
const ZEBRA_BG = '#F8FAFC';
const MUTED = '#475569';
const GROUP_BG = '#E0E7FF';

const MESES = [
	'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
	'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

/** Id de hoja para un mes (1..12). Estable: el deep-link `?mes=` lo usa. */
export function adicionalesSheetId(mes: number): string {
	return `sheet-${mes}`;
}

/** Id de workbook para un año. El AÑO es el eje del libro, no el mes. */
export function adicionalesUnitId(anio: number): string {
	return `workbook-adicionales-anual-${anio}`;
}

/// Filas anotables que se abren bajo el bloque estructurado de cada hoja.
export const FILAS_ANOTABLES = 40;

export interface AdicionalesSheetInput {
	unitId: string;
	sheetId: string;
	sheetName: string;
	items: AdicionalListado[];
	/// Notas libres de esta hoja (zona bajo el bloque estructurado).
	anotaciones?: CeldaDeCapa[];
	/**
	 * Porcentajes de prestaciones y seguridad social, `concepto → %`.
	 *
	 * Este canvas no tiene conceptos de nómina propios: pinta las 13 filas
	 * estándar. Sin esto salían todas a 0.0%. Los valores vienen de
	 * `configuracion_descuento_tercero`, la misma tabla que alimenta el canvas
	 * de cierres, para que un cambio de ARP se refleje en los dos.
	 */
	porcentajesLaborales?: Record<string, number>;
	/**
	 * Días por defecto de las filas de SALARIOS, `concepto → días`.
	 *
	 * Este canvas no tiene datos de nómina por conductor, así que sin esto la
	 * columna DÍAS salía entera a 0. Ver `DIAS_POR_DEFECTO` en
	 * `business/costos-laborales.ts`.
	 */
	diasLaborales?: Record<string, number>;
}

/**
 * Construye UNA hoja (un mes) del libro anual.
 *
 * Todo el estado de la hoja —`cellData`, `mergeData`, `rowData` y sobre
 * todo `colData`— se crea DENTRO de esta función, nunca en el llamador.
 * Univer muta `columnData` in-place al redimensionar columnas: si las 12
 * hojas compartieran el mismo objeto, ajustar una columna en MARZO la
 * ajustaría también en los otros once meses.
 *
 * El cursor de filas `r` también es local, así que todas las fórmulas
 * (`=C{r}*D{r}`, `=ROUND(F{r}*pct/100,0)`, `=F{r}-E{r}` y los `SUM` del
 * footer) siguen siendo intra-hoja y no necesitan reescritura.
 */
export function buildAdicionalesSheet(input: AdicionalesSheetInput): any {
	const { unitId, sheetId, sheetName, items, anotaciones } = input;
	const pctLaboral = input.porcentajesLaborales ?? {};
	const diasLaboral = input.diasLaborales ?? {};

	const itemsActivos = items.length ? items : [];
	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: any[] = [];
	const rowData: Record<number, { h?: number }> = {};
	const colData: Record<number, { w?: number }> = {};
	COLUMN_WIDTHS.forEach((w, i) => (colData[i] = { w }));

	// ─── Estilos reutilizables (réplica 1:1 del ocasional builder) ─────────
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
	const headerStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN },
		ht: HorizontalAlign.CENTER,
		bd: allBorders()
	};
	const cellBase: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: allBorders() };
	const cellZebra: IStyleData = { ...cellBase, bg: { rgb: ZEBRA_BG } };
	const money = (zebra = false): IStyleData =>
		({
			...(zebra ? cellZebra : cellBase),
			// Sin decimales (COP no usa centavos en estos documentos).
			// NOTA: evitamos el patrón `#,##0.##` (dígitos decimales
			// opcionales) porque la librería `numfmt` que usa Univer tiene
			// un bug conocido: cuando el valor no tiene parte decimal,
			// renderiza un "." colgante sin dígitos después (ej. "$15,000."
			// en vez de "$15,000").
			n: { pattern: '"$"#,##0' }
		} as any);
	const admonStyle = (zebra = false): IStyleData =>
		({
			...(zebra ? cellZebra : cellBase),
			cl: { rgb: '#B91C1C' },
			n: { pattern: '"$"#,##0' }
		} as any);
	const tfoot: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders(),
		n: { pattern: '"$"#,##0' }
	} as any;
	const bandStyle = (
		bg: string,
		fg = '#FFFFFF'
	): IStyleData => ({
		fs: 11,
		bl: 1,
		cl: { rgb: fg },
		bg: { rgb: bg },
		ht: HorizontalAlign.CENTER,
		bd: allBorders()
	});
	const sectionLabel = (bg: string, fg: string): IStyleData => ({
		fs: 10,
		bl: 1,
		cl: { rgb: fg },
		bg: { rgb: bg },
		ht: HorizontalAlign.LEFT,
		bd: allBorders()
	});

	// Estilos réplica 1:1 de `ocasional.builder.ts` para la sección de
	// DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO.
	const nominaHeaderBand: IStyleData = {
		fs: 11,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN_DARK },
		ht: HorizontalAlign.CENTER,
		bd: allBorders()
	};
	const nominaSubHeader: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: GREEN_DARK },
		bg: { rgb: SUBTLE_BG },
		bd: allBorders(),
		ht: HorizontalAlign.LEFT
	};
	const conductorHeader: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: GREEN },
		bg: { rgb: SUBTLE_BG },
		bd: allBorders()
	};
	const nominaCellBase: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: allBorders() };
	const nominaCatStyle: IStyleData = {
		fs: 9,
		it: 1,
		bl: 1,
		cl: { rgb: GREEN },
		bg: { rgb: SUBTLE_BG },
		bd: allBorders()
	};
	const nominaTfStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders(),
		n: { pattern: '"$"#,##0' }
	} as any;

	// Estilos para GASTOS / IMPUESTOS (réplica del ocasional builder).
	const secTfStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: SUBTLE_BG },
		bd: allBorders(),
		n: { pattern: '"$"#,##0' }
	} as any;
	const redTotalLabel: IStyleData = {
		fs: 12,
		bl: 1,
		cl: { rgb: RED },
		bg: { rgb: '#FEE2E2' },
		bd: allBorders(),
		ht: HorizontalAlign.LEFT
	};
	const redTotalValue: IStyleData = {
		fs: 14,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: RED },
		bd: allBorders(),
		n: { pattern: '"$"#,##0' },
		ht: HorizontalAlign.RIGHT
	} as any;
	const greenTotalLabel: IStyleData = {
		fs: 12,
		bl: 1,
		cl: { rgb: GREEN_DARK },
		bg: { rgb: '#DCFCE7' },
		bd: allBorders(),
		ht: HorizontalAlign.LEFT
	};
	const greenTotalValue: IStyleData = {
		fs: 14,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN_DARK },
		bd: allBorders(),
		n: { pattern: '"$"#,##0' },
		ht: HorizontalAlign.RIGHT
	} as any;

	const set = (cd: Record<number, Record<number, ICellData>>) =>
		(
			r: number,
			col: number,
			v: any,
			s: IStyleData,
			custom?: Record<string, any>
		) => {
			if (!cd[r]) cd[r] = {};
			cd[r][col] = {
				v,
				t: typeof v === 'number' ? CellValueType.NUMBER : CellValueType.STRING,
				...(s ? { s } : {}),
				...(custom ? { custom } : {})
			};
		};
	const setFormula =
		(cd: Record<number, Record<number, ICellData>>) =>
		(r: number, c: number, formula: string, cached: number, style: IStyleData) => {
			if (!cd[r]) cd[r] = {};
			cd[r][c] = {
				v: cached,
				t: CellValueType.NUMBER,
				f: formula,
				s: style,
				custom: { locked: true }
			};
		};
	/// La columna C de las filas de porcentaje tiene que ser NÚMERO, no la
	/// cadena "8.3%": el «%» es solo un patrón de formato. Como texto, la
	/// fórmula del TOTAL no calculaba nada.
	const setPercent =
		(cd: Record<number, Record<number, ICellData>>) =>
		(r: number, c: number, percentValue: number, style: IStyleData) => {
			if (!cd[r]) cd[r] = {};
			cd[r][c] = {
				v: Number(percentValue) || 0,
				t: CellValueType.NUMBER,
				s: { ...style, n: { pattern: '0.00"%"' } },
				// Toda esta sección es read-only en adicionales (default-deny).
				custom: { locked: true }
			};
		};

	let r = 0;

	// ════════════════════════════════════════════════════════════════════════
	// HOJA ÚNICA — ITEMS
	// ════════════════════════════════════════════════════════════════════════
	{
		// Header row
		HEADERS_ITEMS.forEach((lbl, i) => {
			const hStyle: IStyleData =
				i >= 2 ? { ...headerStyle, ht: HorizontalAlign.RIGHT } : headerStyle;
			set(cellData)(r, i, lbl, hStyle);
		});
		rowData[r] = { h: 28 };
		r++;

		const firstItemRow = r;
		let sumAdmin = 0;
		let sumTotal = 0;
		let sumLiquidar = 0;
		itemsActivos.forEach((it, idx) => {
			const zebra = idx % 2 === 1;
			const base = zebra ? cellZebra : cellBase;
			const m = money(zebra);
			const ad = admonStyle(zebra);

			// EMPRESA
			set(cellData)(r, 0, it.tercero_nombre || '', base);
			// DESCRIPCION
			set(cellData)(r, 1, buildDescripcion(it), base);
			// V/UNIDAD — editable
			set(cellData)(r, 2, Number(it.valor_unitario) || 0, m);
			setAdicionalesBinding(unitId, sheetId, r, 2, {
				entityType: 'adicional',
				entityId: it.id,
				field: 'valor_unitario'
			});
			// CANT — editable
			set(cellData)(r, 3, Number(it.cantidad) || 1, { ...base, ht: HorizontalAlign.RIGHT });
			setAdicionalesBinding(unitId, sheetId, r, 3, {
				entityType: 'adicional',
				entityId: it.id,
				field: 'cantidad'
			});
			// TOTAL (col F) — fórmula viva = V/UNIDAD * CANT
			const total = (Number(it.valor_unitario) || 0) * (Number(it.cantidad) || 1);
			setFormula(cellData)(r, 5, `=C${r + 1}*D${r + 1}`, total, m);
			// ADMON (col E) y V/LIQUIDAR (col G) — readonly para el usuario, pero
			// FÓRMULAS VIVAS, no valores estáticos del backend.
			//
			// POR QUÉ: antes se escribían con `set()` (valor plano). El adapter
			// los recalculaba en JS (`recalcDerived` en
			// `adapters/cell-change-adicionales.ts`), pero esos números nuevos
			// solo llegaban a la pantalla cuando la page destruía y reconstruía
			// el engine entero (remount con debounce de 500 ms). Eso anulaba en
			// la práctica el fix del worker de fórmulas (ver
			// README_UNIVER_FORMULA_FIXES.md, Bug 2): parpadeo, pérdida de
			// selección/scroll y un Worker terminado+recreado por edición.
			//
			// Como fórmulas, el formula engine de Univer las recalcula en cuanto
			// el usuario edita V/UNIDAD o CANT, y las SUM del footer cascadean
			// solas — sin remount.
			//
			// Espejan exactamente `recalcDerived()`:
			//   valor_admin    = round(valor_unitario * cantidad * pct / 100)
			//   valor_liquidar = valor_unitario * cantidad - valor_admin
			const pctAdmin = Number(it.porcentaje_admin) || 0;
			const vAdmin = Math.round((total * pctAdmin) / 100);
			setFormula(cellData)(r, 4, `=ROUND(F${r + 1}*${pctAdmin}/100,0)`, vAdmin, ad);
			setFormula(cellData)(r, 6, `=F${r + 1}-E${r + 1}`, total - vAdmin, m);

			// Acumuladores para los `v` cacheados de la fila TOTALES. Se derivan
			// de las MISMAS expresiones que las fórmulas de arriba (no de
			// `it.valor_admin` / `it.valor_liquidar` del backend) para que el
			// primer pintado coincida con lo que el formula engine calculará.
			sumAdmin += vAdmin;
			sumTotal += total;
			sumLiquidar += total - vAdmin;

			r++;
		});
		const lastItemRow = r - 1;

		// Fila TOTALES con SUM formulas
		const totalsRow = r;
		set(cellData)(totalsRow, 0, 'TOTALES', tfoot);
		mergeData.push({
			startRow: totalsRow,
			endRow: totalsRow,
			startColumn: 0,
			endColumn: 1,
			rangeType: 0
		});
		if (!cellData[totalsRow]) cellData[totalsRow] = {};
		cellData[totalsRow][1] = { s: tfoot };
		const sumCols: Array<[number, number]> = [
			[4, sumAdmin],
			[5, sumTotal],
			[6, sumLiquidar]
		];
		for (const [col, value] of sumCols) {
			const letter = colLetter(col);
			setFormula(cellData)(
				totalsRow,
				col,
				`=SUM(${letter}${firstItemRow + 1}:${letter}${lastItemRow + 1})`,
				value,
				tfoot
			);
		}
		// Columnas 2 y 3 (V/UNIDAD, CANT) no suman — solo bg
		[2, 3].forEach((c) => {
			if (!cellData[totalsRow]) cellData[totalsRow] = {};
			cellData[totalsRow][c] = { s: tfoot };
		});
		rowData[totalsRow] = { h: 24 };
	}

	r++;

	// ════════════════════════════════════════════════════════════════════════
	// SECCIÓN NÓMINA: DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO
	// Réplica 1:1 de `ocasional.builder.ts` (líneas 282-586).
	// ════════════════════════════════════════════════════════════════════════
	{
		r++; // blank row entre TOTALES y la sección de nómina

		// Bandera de sección "DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO" (A:E merge)
		set(cellData)(r, 0, 'DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO', nominaHeaderBand);
		mergeData.push({
			startRow: r,
			endRow: r,
			startColumn: 0,
			endColumn: 4,
			rangeType: 0
		});
		for (let cc = 1; cc <= 4; cc++) {
			if (!cellData[r]) cellData[r] = {};
			cellData[r][cc] = { s: nominaHeaderBand };
		}
		rowData[r] = { h: 22 };
		r++;

		// Sin conceptos de nómina en adicionales → renderizar un grupo
		// default "General / Consolidado" con las 13 filas estándar
		// (5 salarios + 4 prestaciones + 4 seguridad social) en 0.
		const grupos = [
			{
				nombre: 'General / Consolidado',
				conceptos: [],
				salarios: [],
				prestaciones: [],
				seguridadSocial: [],
				totalConductor: 0
			}
		];

		const setN = set(cellData);

		// Helper para escribir el sub-header del table (CONCEPTO A:B merge + DIAS/% + VALOR + TOTAL).
		const writeConceptosSubHeader = (rr: number) => {
			setN(rr, 0, 'CONCEPTO', nominaSubHeader);
			mergeData.push({ startRow: rr, endRow: rr, startColumn: 0, endColumn: 1, rangeType: 0 });
			if (!cellData[rr]) cellData[rr] = {};
			cellData[rr][1] = { s: nominaSubHeader };
			setN(rr, 2, 'DIAS / %', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
			setN(rr, 3, 'VALOR', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
			setN(rr, 4, 'TOTAL', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
			rowData[rr] = { h: 22 };
		};

		// Helper para escribir una fila de concepto (A:B merge = nombre,
		// C = dias/%, D = valor, E = TOTAL formula viva `=C{r}*D{r}`).
		const writeConceptoRow = (
			rr: number,
			nombre: string,
			diasOPct: string | number,
			valor: number,
			total: number,
			style: IStyleData,
			boldTotal = false,
			/// 'porcentaje' cambia la fórmula del TOTAL y el formato de la columna C.
			colCField?: 'dias' | 'porcentaje',
			/// Fórmula de la columna VALOR: la BASE, que depende de las filas de salario.
			baseFormula?: string
		) => {
			setN(rr, 0, nombre, style);
			mergeData.push({ startRow: rr, endRow: rr, startColumn: 0, endColumn: 1, rangeType: 0 });
			if (!cellData[rr]) cellData[rr] = {};
			cellData[rr][1] = { s: style };
			if (colCField === 'porcentaje') {
				setPercent(cellData)(rr, 2, Number(diasOPct) || 0, {
					...style,
					ht: HorizontalAlign.RIGHT
				});
			} else {
				setN(rr, 2, diasOPct, { ...style, ht: HorizontalAlign.RIGHT });
			}
			// D = VALOR sobre el que se calcula. En las filas de días es el valor
			// unitario; en las de porcentaje es la BASE, que llega como fórmula
			// viva para que se recalcule al tocar los días de salario.
			if (baseFormula) {
				setFormula(cellData)(rr, 3, baseFormula, Number(valor) || 0, {
					...style,
					n: { pattern: '"$"#,##0' }
				} as any);
			} else {
				setN(rr, 3, valor, { ...style, n: { pattern: '"$"#,##0' } } as any);
			}
			const totalStyle: IStyleData = {
				...(boldTotal ? { ...style, bl: 1 } : style),
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any;
			// C guarda 8.33 y el «%» es solo formato: sin el /100 el total salía
			// multiplicado por cien.
			const formulaTotal =
				colCField === 'porcentaje' ? `=C${rr + 1}/100*D${rr + 1}` : `=C${rr + 1}*D${rr + 1}`;
			setFormula(cellData)(rr, 4, formulaTotal, total, totalStyle);
		};

		grupos.forEach((g) => {
			const ccDoc = (g.conceptos[0] as any)?.conductor?.numero_identificacion;

			// Cabecera del conductor (A:C merge)
			setN(r, 0, `${g.nombre}${ccDoc ? `  ·  CC: ${ccDoc}` : ''}`, conductorHeader);
			mergeData.push({
				startRow: r,
				endRow: r,
				startColumn: 0,
				endColumn: 2,
				rangeType: 0
			});
			for (let cc = 1; cc <= 2; cc++) {
				if (!cellData[r]) cellData[r] = {};
				cellData[r][cc] = { s: conductorHeader };
			}
			rowData[r] = { h: 24 };
			r++;

			// Sub-header
			writeConceptosSubHeader(r);
			r++;

			// SALARIOS: SIEMPRE renderizar las 5 filas estándar
			const STANDARD_SALARIOS = [
				'SALARIO',
				'AUXILIO_TRANSPORTE',
				'BONIFICACION',
				'OTROS_AUXILIOS',
				'RECARGOS'
			];
			/// Fila donde quedó cada concepto de salario. Las bases se construyen
			/// refiriéndose a estas filas, no re-sumando valores sueltos.
			const filaSalario: Record<string, number> = {};
			STANDARD_SALARIOS.forEach((stdName) => {
				filaSalario[stdName] = r;
				const c = (g.salarios as any[]).find((x) => x.concepto === stdName);
				// Sin dato propio manda el valor de referencia compartido.
				const dias = c ? Number(c.dias || 0) : (diasLaboral[stdName] ?? 0);
				const vu = c ? Number(c.valor_unitario || 0) : 0;
				writeConceptoRow(
					r,
					stdName.replace(/_/g, ' '),
					dias,
					vu,
					dias * vu,
					nominaCellBase,
					false
				);
				r++;
			});

			// Las bases se construyen refiriéndose a las filas de salario, no
			// re-sumando valores sueltos: así al editar días/valor todo cascadea.
			// PRESTACIONES: salario + auxilio de transporte + recargos.
			// SEGURIDAD SOCIAL (y VACACIONES): salario + recargos, sin auxilio.
			const eDe = (nombre: string) => `E${filaSalario[nombre] + 1}`;
			const BASE_PREST = `=${eDe('SALARIO')}+${eDe('AUXILIO_TRANSPORTE')}+${eDe('RECARGOS')}`;
			const BASE_SS = `=${eDe('SALARIO')}+${eDe('RECARGOS')}`;

			// PRESTACIONES SOCIALES: SIEMPRE renderizar categoría + hijos
			const STANDARD_PREST = [
				'CESANTIAS',
				'INTERESES_CESANTIAS',
				'PRIMA',
				'VACACIONES'
			];
			// La fila de la CATEGORÍA se reserva antes de pintar los hijos. Antes
			// ambos empezaban en `r`, así que la categoría se escribía encima del
			// primer hijo: CESANTIAS desaparecía y el SUM quedaba desplazado.
			const prestCatRow = r;
			r++;
			const firstPrestChildRow = r;
			STANDARD_PREST.forEach((stdName) => {
				const c = (g.prestaciones as any[]).find((x) => x.concepto === stdName);
				// Sin concepto propio manda la configuración compartida.
				const pct = c ? Number(c.porcentaje || 0) : (pctLaboral[stdName] ?? 0);
				const total = c ? Number(c.valor_total || 0) : 0;
				writeConceptoRow(
					r,
					stdName.replace(/_/g, ' '),
					pct,
					0,
					total,
					{ ...nominaCellBase, it: 1 },
					false,
					'porcentaje',
					// VACACIONES es la excepción: se calcula sin el auxilio de
					// transporte, igual que la seguridad social.
					stdName === 'VACACIONES' ? BASE_SS : BASE_PREST
				);
				r++;
			});
			const lastPrestChildRow = r - 1;
			const totalPrest = STANDARD_PREST.reduce(
				(s, n) =>
					s +
					(Number(
						(g.prestaciones as any[]).find((x) => x.concepto === n)?.valor_total
					) || 0),
				0
			);
			const pctPrest = STANDARD_PREST.reduce(
				(s, n) =>
					s +
					(Number((g.prestaciones as any[]).find((x) => x.concepto === n)?.porcentaje) ||
						pctLaboral[n] ||
						0),
				0
			);
			writeConceptoRow(
				prestCatRow,
				'PRESTACIONES SOCIALES',
				pctPrest,
				0,
				totalPrest,
				nominaCatStyle,
				true,
				'porcentaje',
				BASE_PREST
			);
			// El % de la categoría es la SUMA de los de sus hijos: si cambia el ARP,
			// el agregado se mueve solo.
			setFormula(cellData)(
				prestCatRow,
				2,
				`=SUM(C${firstPrestChildRow + 1}:C${lastPrestChildRow + 1})`,
				pctPrest,
				{
					...nominaCatStyle,
					bl: 1,
					n: { pattern: '0.00"%"' },
					ht: HorizontalAlign.RIGHT
				} as any
			);
			const prestSumFormula = `=SUM(E${firstPrestChildRow + 1}:E${lastPrestChildRow + 1})`;
			setFormula(cellData)(prestCatRow, 4, prestSumFormula, totalPrest, {
				...nominaCatStyle,
				bl: 1,
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any);

			// SEGURIDAD SOCIAL: SIEMPRE renderizar categoría + hijos
			const STANDARD_SS = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];
			// Misma reserva que en PRESTACIONES: sin ella la categoría pisaba a SALUD.
			const ssCatRow = r;
			r++;
			const firstSSChildRow = r;
			STANDARD_SS.forEach((stdName) => {
				const c = (g.seguridadSocial as any[]).find((x) => x.concepto === stdName);
				const pct = c ? Number(c.porcentaje || 0) : (pctLaboral[stdName] ?? 0);
				const total = c ? Number(c.valor_total || 0) : 0;
				writeConceptoRow(
					r,
					stdName.replace(/_/g, ' '),
					pct,
					0,
					total,
					{ ...nominaCellBase, it: 1 },
					false,
					'porcentaje',
					BASE_SS
				);
				r++;
			});
			const lastSSChildRow = r - 1;
			const totalSS = STANDARD_SS.reduce(
				(s, n) =>
					s +
					(Number(
						(g.seguridadSocial as any[]).find((x) => x.concepto === n)?.valor_total
					) || 0),
				0
			);
			const pctSS = STANDARD_SS.reduce(
				(s, n) =>
					s +
					(Number((g.seguridadSocial as any[]).find((x) => x.concepto === n)?.porcentaje) ||
						pctLaboral[n] ||
						0),
				0
			);
			writeConceptoRow(
				ssCatRow,
				'SEGURIDAD SOCIAL',
				pctSS,
				0,
				totalSS,
				nominaCatStyle,
				true,
				'porcentaje',
				BASE_SS
			);
			// Igual que en prestaciones: el % de la categoría es la suma viva de
			// los de sus hijos.
			setFormula(cellData)(
				ssCatRow,
				2,
				`=SUM(C${firstSSChildRow + 1}:C${lastSSChildRow + 1})`,
				pctSS,
				{
					...nominaCatStyle,
					bl: 1,
					n: { pattern: '0.00"%"' },
					ht: HorizontalAlign.RIGHT
				} as any
			);
			const ssSumFormula = `=SUM(E${firstSSChildRow + 1}:E${lastSSChildRow + 1})`;
			setFormula(cellData)(ssCatRow, 4, ssSumFormula, totalSS, {
				...nominaCatStyle,
				bl: 1,
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any);

			// Subtotal VALOR TOTAL CONDUCTOR (A:D label, E total)
			mergeData.push({
				startRow: r,
				endRow: r,
				startColumn: 0,
				endColumn: 3,
				rangeType: 0
			});
			if (!cellData[r]) cellData[r] = {};
			cellData[r][0] = {
				v: `VALOR TOTAL CONDUCTOR · ${g.nombre.toUpperCase()}`,
				t: CellValueType.STRING,
				s: nominaTfStyle
			};
			for (let cc = 1; cc <= 3; cc++) cellData[r][cc] = { s: nominaTfStyle };
			// Fórmula viva y no el número del servidor: salarios + prestaciones +
			// seguridad social. Como literal se quedaba desfasado al editar.
			const primeraFilaSalario = filaSalario[STANDARD_SALARIOS[0]] + 1;
			const ultimaFilaSalario =
				filaSalario[STANDARD_SALARIOS[STANDARD_SALARIOS.length - 1]] + 1;
			setFormula(cellData)(
				r,
				4,
				`=SUM(E${primeraFilaSalario}:E${ultimaFilaSalario})+E${prestCatRow + 1}+E${ssCatRow + 1}`,
				Number(g.totalConductor) || 0,
				{ ...nominaTfStyle, n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT } as any
			);
			rowData[r] = { h: 22 };
			r++;

			// gap row entre conductores
			r++;
		});
	}

	// ─── Helper común para secciones estrechas (gastos / impuestos) ───
	// Réplica 1:1 del ocasional builder. Layout: A:B merge = nombre,
	// C = columna secundaria label, D = columna vacía/label, E = valor.
	const writeSmallSection = (
		band: string,
		bandColor: string,
		bandBg: string,
		headers: string[],
		rows: Array<[string, string | number, string | number, string | number]>,
		totalFormula: (firstRow: number, lastRow: number) => string,
		totalCached: number,
		totalLabel: string,
		totalAccent: string
	) => {
		// Banda
		set(cellData)(r, 0, band, bandStyle(bandColor));
		mergeData.push({
			startRow: r,
			endRow: r,
			startColumn: 0,
			endColumn: 4,
			rangeType: 0
		});
		for (let c = 1; c <= 4; c++) {
			if (!cellData[r]) cellData[r] = {};
			cellData[r][c] = { s: bandStyle(bandColor) };
		}
		rowData[r] = { h: 22 };
		r++;

		// Subheader
		const subHeaderStyle = sectionLabel(bandBg, bandColor);
		set(cellData)(r, 0, headers[0], subHeaderStyle);
		mergeData.push({
			startRow: r,
			endRow: r,
			startColumn: 0,
			endColumn: 1,
			rangeType: 0
		});
		if (!cellData[r]) cellData[r] = {};
		cellData[r][1] = { s: subHeaderStyle };
		set(cellData)(r, 2, headers[2], {
			...subHeaderStyle,
			ht: HorizontalAlign.RIGHT
		});
		set(cellData)(r, 3, headers[3], {
			...subHeaderStyle,
			ht: HorizontalAlign.RIGHT
		});
		set(cellData)(r, 4, headers[4], {
			...subHeaderStyle,
			ht: HorizontalAlign.RIGHT
		});
		rowData[r] = { h: 22 };
		r++;

		const firstDataRow = r;
		rows.forEach((row, idx) => {
			const zebra = idx % 2 === 1;
			const base = zebra ? cellZebra : cellBase;
			const m = money(zebra);
			const [label, c, d, e] = row;
			set(cellData)(r, 0, label, base);
			mergeData.push({
				startRow: r,
				endRow: r,
				startColumn: 0,
				endColumn: 1,
				rangeType: 0
			});
			if (!cellData[r]) cellData[r] = {};
			cellData[r][1] = { s: base };
			set(cellData)(r, 2, c, { ...base, ht: HorizontalAlign.RIGHT });
			set(cellData)(r, 3, d, { ...base, ht: HorizontalAlign.RIGHT });
			set(cellData)(r, 4, e, {
				...base,
				ht: HorizontalAlign.RIGHT,
				n: { pattern: '"$"#,##0' }
			} as any);
			r++;
		});
		const lastDataRow = r - 1;

		// TOTAL footer
		const tr = r;
		set(cellData)(tr, 0, totalLabel, secTfStyle);
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = { s: secTfStyle };
		}
		const formula =
			rows.length > 0 ? totalFormula(firstDataRow + 1, lastDataRow + 1) : '=0';
		setFormula(cellData)(tr, 4, formula, totalCached, {
			...secTfStyle,
			bl: 1,
			cl: { rgb: totalAccent },
			bg: { rgb: bandBg },
			n: { pattern: '"$"#,##0' },
			ht: HorizontalAlign.RIGHT
		} as any);
		rowData[tr] = { h: 24 };
		r++;
	};

	// ════════════════════════════════════════════════════════════════════════
	// SECCIÓN 3: GASTOS — réplica 1:1 del ocasional builder
	// ════════════════════════════════════════════════════════════════════════
	{
		const STANDARD_GASTOS = [
			'DOTACION',
			'EXAMEN_MEDICO',
			'COMBUSTIBLE',
			'PAPELERIA',
			'GASTOS_DIVERSOS'
		];
		// Sin conceptos de gastos en adicionales → todas las filas en 0.
		const rows: Array<[string, string | number, string | number, string | number]> =
			STANDARD_GASTOS.map((stdName) => [
				stdName.replace(/_/g, ' '),
				0,
				0,
				0
			]);
		const total = 0;
		writeSmallSection(
			'GASTOS DE VEHÍCULO',
			AMBER,
			AMBER_SOFT,
			['CONCEPTO', '', 'CANTIDAD', 'VALOR', 'TOTAL'],
			rows,
			(f, l) => `=SUM(E${f}:E${l})`,
			total,
			'TOTAL GASTOS',
			AMBER
		);
	}

	r++;

	// ════════════════════════════════════════════════════════════════════════
	// SECCIÓN 4: IMPUESTOS — réplica 1:1 del ocasional builder
	// ════════════════════════════════════════════════════════════════════════
	{
		const STANDARD_IMPUESTOS: Array<{ nombre: string; pctDefault: number }> = [
			{ nombre: 'RETENCION_ICA', pctDefault: 1.0 },
			{ nombre: 'AVISOS_TABLEROS', pctDefault: 15.0 },
			{ nombre: 'SOBRETASA_BOMBERIL', pctDefault: 21.0 },
			{ nombre: 'RETENCION_FUENTE', pctDefault: 3.5 }
		];
		const rows: Array<[string, string | number, string | number, string | number]> =
			STANDARD_IMPUESTOS.map(({ nombre, pctDefault }) => [
				nombre.replace(/_/g, ' '),
				`${pctDefault.toFixed(2)}%`,
				'',
				0
			]);
		const total = 0;
		writeSmallSection(
			'IMPUESTOS Y RETENCIONES',
			RED,
			'#FEE2E2',
			['CONCEPTO', '', 'PORCENTAJE', '', 'VALOR'],
			rows,
			(f, l) => `=SUM(E${f}:E${l})`,
			total,
			'TOTAL IMPUESTOS',
			RED
		);
	}

	r++;

	// ════════════════════════════════════════════════════════════════════════
	// TOTAL DESCUENTOS + TOTAL A PAGAR — réplica 1:1 del ocasional builder
	// ════════════════════════════════════════════════════════════════════════
	const totalLiquidarItems = itemsActivos.reduce(
		(s, it) => s + (Number(it.valor_liquidar) || 0),
		0
	);
	// Adicionales no trae conceptos hoy, así que el número sale 0. Aun así el
	// total va como FÓRMULA sobre el totalizador de nómina: en cuanto esa
	// sección tenga datos, TOTAL DESCUENTOS los recoge sin tocar nada más.
	const totalDescuentos = 0;
	const totalPagar = totalLiquidarItems - totalDescuentos;

	// TOTAL DESCUENTOS (rojo) — A:D label, E valor
	{
		const tr = r;
		set(cellData)(tr, 0, 'TOTAL DESCUENTOS', redTotalLabel);
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = { s: redTotalLabel };
		}
		set(cellData)(tr, 4, totalDescuentos, redTotalValue);
		rowData[tr] = { h: 28 };
		r++;
	}

	// TOTAL A PAGAR (verde)
	{
		const tr = r;
		set(cellData)(tr, 0, 'TOTAL A PAGAR', greenTotalLabel);
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = { s: greenTotalLabel };
		}
		set(cellData)(tr, 4, totalPagar, greenTotalValue);
		rowData[tr] = { h: 28 };
	}

	const filaLibreDesde = r + 2;
	const totalRows = filaLibreDesde + FILAS_ANOTABLES;
	const totalColumns = COLUMN_COUNT;

	// Retícula continua: sin esto la tabla "se acaba" de golpe donde terminan
	// los datos. Ver `relleno-bordes.ts` sobre por qué no se puede por config.
	rellenarBordesVacios(cellData, totalRows, totalColumns, mergeData);
	// Zona libre: debajo del bloque estructurado el equipo puede dejar
	// referencias o valores de apoyo. Se registra para que `cell-permission`
	// las deje editar y el adaptador sepa que eso es una anotación, no un
	// campo de la base de datos.
	registrarHojaEditable(unitId, sheetId, {
		finItems: filaLibreDesde,
		// La fila 0 es el encabezado de la tabla y no se mueve nunca: se ancla
		// por fila absoluta en vez de por distancia al final del bloque.
		inicioItems: 1
	});
	aplicarCapa(cellData, unitId, sheetId, anotaciones);

	const sheet: any = {
		id: sheetId,
		name: sheetName,
		tabColor: itemsActivos.length ? GREEN : MUTED,
		hidden: BooleanNumber.FALSE,
		rowCount: totalRows,
		columnCount: totalColumns,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 100,
		defaultRowHeight: 22,
		mergeData,
		cellData,
		rowData,
		columnData: colData,
		rowHeader: { width: 50 },
		columnHeader: { height: 24 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};

	return sheet;
}

export interface AdicionalesAnualInput {
	anio: number;
	/** Items por mes, claves 1..12. Los meses ausentes rinden hoja vacía. */
	itemsPorMes: Record<number, AdicionalListado[]>;
	/// Porcentajes de prestaciones/seguridad social, `concepto → %`.
	porcentajesLaborales?: Record<string, number>;
	/// Días por defecto de las filas de salarios, `concepto → días`.
	diasLaborales?: Record<string, number>;
	/// Notas libres por mes: `{ [mes]: { [sheet_key]: AnotacionCelda[] } }`.
	/// Libro anual ⇒ `sheet_key = ''` (el mes ya identifica la hoja).
	anotaciones?: Record<number, Record<string, CeldaDeCapa[]>>;
}

/**
 * Construye el libro ANUAL: 12 hojas, una por mes.
 *
 * Las 12 hojas se emiten SIEMPRE, incluso las de meses sin adicionales.
 * Un mes sin datos rinde header + footer en cero y pestaña gris. Omitirlas
 * rompería el deep-link `?mes=` y haría que la barra de hojas cambiara de
 * posición según el contenido.
 */
export function buildAdicionalesAnualWorkbook(input: AdicionalesAnualInput): {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorMes: Record<number, string>;
} {
	const { anio, itemsPorMes } = input;
	const unitId = adicionalesUnitId(anio);

	const sheetOrder: string[] = [];
	const sheets: Record<string, any> = {};
	const sheetIdPorMes: Record<number, string> = {};

	for (let mes = 1; mes <= 12; mes++) {
		const sheetId = adicionalesSheetId(mes);
		sheetIdPorMes[mes] = sheetId;
		sheetOrder.push(sheetId);
		sheets[sheetId] = buildAdicionalesSheet({
			unitId,
			sheetId,
			sheetName: MESES[mes - 1],
			items: itemsPorMes[mes] ?? [],
			anotaciones: input.anotaciones?.[mes]?.[''] ?? [],
			porcentajesLaborales: input.porcentajesLaborales,
			diasLaborales: input.diasLaborales
		});
	}

	const workbook: IWorkbookData = {
		id: unitId,
		name: `Adicionales ${anio}`,
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder,
		sheets
	};

	return { workbook, unitId, sheetIdPorMes };
}

// ─── Helpers ──────────────────────────────────────────────────

function colLetter(col: number): string {
	let letter = '';
	let n = col;
	while (n >= 0) {
		letter = String.fromCharCode(65 + (n % 26)) + letter;
		n = Math.floor(n / 26) - 1;
	}
	return letter;
}

function buildDescripcion(it: AdicionalListado): string {
	const parts: string[] = [];
	if (it.recorrido) parts.push(it.recorrido);
	if (it.fechas) parts.push(it.fechas);
	if (it.cliente) parts.push(`Cliente: ${it.cliente}`);
	return parts.join('  ·  ') || '';
}

// ─── Constantes ──────────────────────────────────────────────────

const HEADERS_ITEMS = [
	'EMPRESA',
	'DESCRIPCION',
	'V/UNIDAD',
	'CANT',
	'ADMON',
	'TOTAL',
	'V/ LIQUIDAR'
];

const COLUMN_WIDTHS = [
	230, // EMPRESA
	250, // DESCRIPCION
	95, // V/UNIDAD
	65, // CANT
	95, // ADMON
	105, // TOTAL
	105 // V/LIQUIDAR
];

const COLUMN_COUNT = HEADERS_ITEMS.length;
