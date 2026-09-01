/**
 * Ocasional builder — genera el workbook Univer de las liquidaciones
 * ocasionales de terceros.
 *
 * LAYOUT: libro ANUAL de 12 hojas, una por mes, con `sheetBar: true`. El
 * eje del workbook es el AÑO (`unitId = workbook-ocasional-anual-YYYY`);
 * el mes es solo la hoja activa, así que cambiar de mes NO remonta el
 * engine. Cada hoja apila las secciones de un mes y mantiene su propio
 * `cellData`/`colData` (ver el aviso sobre `columnData` en
 * `buildOcasionalSheet`).
 *
 * En BD, `liquidacion_tercero_ocasional` es `@@unique([mes, anio])`, así
 * que **una hoja = una cabecera**. De ahí que el autoguardado pueda ser
 * independiente por hoja. Los meses sin cabecera rinden hoja placeholder.
 *
 * Secciones de cada hoja (en orden):
 *   1. ITEMS          — 20 cols, header + filas + TOTALES (SUM)
 *   2. ADICIONALES    — header A:L + filas + TOTALES (SUM)
 *   3. GASTOS         — header A:E + filas + TOTAL (SUM)
 *   4. IMPUESTOS      — header A:E + filas + TOTAL (SUM)
 *   5. ANTICIPOS      — header A:E + filas + TOTAL (SUM)
 *   6. POR PLACA      — header A:F + filas + TOTALES (SUM)
 *   7. TOTAL DESCUENTOS (rojo) + TOTAL A PAGAR (verde)
 *
 * Cada celda editable queda registrada en el `ocasional-cell-binding`
 * registry con `{ entityType, entityId, field }` estable.
 */

import {
	BooleanNumber,
	BorderStyleTypes,
	CellValueType,
	HorizontalAlign,
	LocaleType,
	WrapStrategy,
	type IWorkbookData,
	type ICellData,
	type IStyleData,
	type IBorderData,
	type IBorderStyleData
} from '@univerjs/core';
import {
	numeroDeCapa,
	registrarHojaEditable,
	aplicarCapa,
	type CeldaDeCapa
} from '../business/zona-libre';
import { rellenarBordesVacios } from './relleno-bordes';
import type {
	LiquidacionOcasional,
	ItemOcasional,
	AdicionalOcasional,
	ConceptoOcasional
} from '$lib/api/liquidaciones-terceros-ocasional';
import { setOcasionalBinding } from '../business/ocasional-cell-binding';
import { recomputeTaxes, ensureImpuestos } from '../business/ocasional-taxes';
import { alcanceOcasional } from '../business/id-sintetico';
import { GASTOS_VEHICULO } from '../business/costos-laborales';

const GREEN = '#0F4025';
const GREEN_DARK = '#166534';
const RED = '#B91C1C';
const AMBER = '#B45309';
const BLUE = '#1D4ED8';
const TEXT_DARK = '#0F172A';
const SUBTLE_BG = '#F1F5F9';
const TOTALES_BG = '#E2E8F0';
const MUTED = '#475569';

// 20 y no 21: la columna EXCLUIDO se retiró cuando eliminar filas pasó a
// borrar de verdad (borrado lógico en la base). Marcar «excluido» y borrar la
// fila eran dos formas de decir lo mismo, y tener las dos invitaba a que los
// totales de la hoja y los de la cabecera contaran cosas distintas.
export const OCASIONAL_TOTAL_COLUMNS = 20;

/// Filas anotables que se abren bajo el bloque estructurado de cada hoja.
export const FILAS_ANOTABLES = 40;

/// Administración que Cotransmeq retiene sobre lo que entra por el servicio
/// (ingresos de Cotransmeq + recargos).
/// Es solo el valor POR DEFECTO: la celda ADMON % de la hoja es editable.
export const PCT_ADMON_SERVICIO = 10;

/**
 * Nombre con el que se persiste el % de ADMON en la capa de hoja.
 *
 * No es un campo de la base —no hay columna donde guardarlo— pero tampoco es
 * una nota suelta: es el parámetro del que cuelga la utilidad de los terceros
 * y, por tanto, el TOTAL A PAGAR. Anclado por clave y no por fila, sobrevive a
 * que la tabla de items o el bloque de descuentos cambien de tamaño.
 */
export const CLAVE_PCT_ADMON = 'pct_admon_servicio';

const MESES = [
	'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
	'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

/** Id de hoja para un mes (1..12). Estable: el deep-link `?mes=` lo usa. */
export function ocasionalSheetId(mes: number): string {
	return `sheet-${mes}`;
}

/**
 * Id de workbook para un año.
 *
 * OJO: antes el unitId era por liquidación (`workbook-ocasional-${id}`).
 * Ahora el eje es el AÑO, porque una hoja = una cabecera y el libro cubre
 * los 12 meses. El id de cabecera de cada mes se devuelve aparte en
 * `cabeceraIdPorMes`.
 */
export function ocasionalUnitId(anio: number): string {
	return `workbook-ocasional-anual-${anio}`;
}

export interface OcasionalSheetInput {
	unitId: string;
	sheetId: string;
	sheetName: string;
	/// Periodo de la hoja. Identifica la liquidación (`@@unique([mes, anio])`)
	/// y con ella el espacio de nombres de los conceptos sintéticos.
	anio: number;
	mes: number;
	items: ItemOcasional[];
	adicionales: AdicionalOcasional[];
	conceptos: ConceptoOcasional[];
	/// Notas libres de esta hoja (zona bajo el bloque estructurado).
	anotaciones?: CeldaDeCapa[];
}

/**
 * Construye UNA hoja (un mes) del libro anual.
 *
 * Todo el estado de la hoja —`cellData`, `mergeData`, `rowData` y sobre
 * todo `colData`— se crea DENTRO de esta función, nunca en el llamador.
 * Univer muta `columnData` in-place al redimensionar columnas: si las 12
 * hojas compartieran el objeto, ajustar una columna en MARZO la ajustaría
 * también en los otros once meses.
 *
 * `ensureImpuestos`/`recomputeTaxes` corren POR MES: la base imponible de
 * un mes no puede contaminar la de otro.
 */
export function buildOcasionalSheet(input: OcasionalSheetInput): any {
	const { unitId, sheetId, sheetName, items, adicionales } = input;
	let conceptos = input.conceptos;
	const alcance = alcanceOcasional(input.anio, input.mes);

	conceptos = ensureImpuestos(conceptos, alcance);
	conceptos = recomputeTaxes(items, conceptos);
	// Sin filtro de excluidos: esa columna ya no existe en esta hoja. Lo que
	// no cuenta, se borra, y borrar quita la fila de la tabla y de la base.
	const itemsActivos = items;
	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: any[] = [];
	const rowData: Record<number, { h?: number }> = {};
	const colData: Record<number, { w?: number }> = {};
	COLUMN_WIDTHS_ITEMS.forEach((w, i) => (colData[i] = { w }));

	// ─── Estilos reutilizables ────────────────────────────
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
	const cellZebra: IStyleData = { ...cellBase, bg: { rgb: '#F8FAFC' } };
	const money = (zebra = false): IStyleData =>
		({
			...(zebra ? cellZebra : cellBase),
			// Sin decimales (COP no usa centavos en estos documentos).
			// NOTA: evitamos el patrón `#,##0.##` (dígitos decimales
			// opcionales) porque la librería `numfmt` que usa Univer tiene
			// un bug conocido: cuando el valor no tiene parte decimal,
			// renderiza un "." colgante sin dígitos después (ej. "$15,000."
			// en vez de "$15,000"). Ver `numfmt.format('#,##0.##', 15000)`.
			n: { pattern: '"$"#,##0' }
		} as any);
	const admonStyle = (zebra = false): IStyleData =>
		({
			...(zebra ? cellZebra : cellBase),
			cl: { rgb: '#B91C1C' },
			n: { pattern: '"$"#,##0' }
		} as any);
	// Celdas de acción (SÍ/NO) de APLICA IMP. Mismo semáforo que el
	// canvas de cierres: verde = entra, rojo = queda fuera.
	const accionSi: IStyleData = {
		...cellBase,
		bl: 1,
		ht: HorizontalAlign.CENTER,
		cl: { rgb: GREEN_DARK },
		bg: { rgb: '#ECFDF5' }
	} as any;
	const accionNo: IStyleData = {
		...cellBase,
		bl: 1,
		ht: HorizontalAlign.CENTER,
		cl: { rgb: RED },
		bg: { rgb: '#FEF2F2' }
	} as any;
	const tfoot: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: allBorders(),
		// Ver nota en `money()` sobre por qué no usamos `.##` (bug de numfmt
		// con el "." colgante en valores sin parte decimal).
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
	const setPercent =
		(cd: Record<number, Record<number, ICellData>>) =>
		(r: number, c: number, percentValue: number, style: IStyleData) => {
			const v = Number(percentValue) || 0;
			if (!cd[r]) cd[r] = {};
			cd[r][c] = {
				v,
				t: CellValueType.NUMBER,
				s: { ...style, n: { pattern: '0.00"%"' } },
				custom: { locked: true }
			};
		};
	const setNumber =
		(cd: Record<number, Record<number, ICellData>>) =>
		(
			r: number,
			c: number,
			numValue: number,
			style: IStyleData,
			extra?: Record<string, any>
		) => {
			const v = Number(numValue) || 0;
			if (!cd[r]) cd[r] = {};
			cd[r][c] = {
				v,
				t: CellValueType.NUMBER,
				s: style,
				...(extra ? { ...extra } : {})
			};
		};

	let r = 0;
	/// Fila (1-based, para fórmulas) del totalizador de cada sección de
	/// descuentos: VALOR TOTAL CONDUCTOR, TOTAL GASTOS, TOTAL IMPUESTOS,
	/// TOTAL ANTICIPOS. TOTAL DESCUENTOS es la suma VIVA de todas ellas, así que
	/// necesita saber dónde acabaron.
	const filasTotalizadoras: number[] = [];
	/// Fila (1-based) de TOTALES de la tabla de items. El resumen del servicio
	/// que va justo debajo referencia sus columnas en vez de re-sumar.
	let filaTotalesItems = 0;
	/// Fila (1-based) y valor de la UTILIDAD DE LOS TERCEROS: es la base del
	/// TOTAL A PAGAR en ocasionales, en lugar del total facturado.
	let filaUtilidadServicio = 0;
	let cacheUtilidadServicio = 0;
	/// Fila 0-based de la celda del % de ADMON, para declararla por clave.
	let filaClavePctAdmon = -1;
	/// Recargos totalizados de la tabla de items (una vez por liquidación).
	let cacheRecargosItems = 0;
	/// Fila → id del item. Es lo que permite anclar a un item lo escrito a su lado.
	const itemPorFila = new Map<number, string>();

	// ─── HOJA ÚNICA — ITEMS ────────────────────────────
	{
		// Header row
		HEADERS_ITEMS.forEach((lbl, i) => {
			const hStyle: IStyleData =
				i === 8 ? { ...headerStyle, ht: HorizontalAlign.RIGHT } : headerStyle;
			set(cellData)(r, i, lbl, hStyle);
		});
		rowData[r] = { h: 28 };
		r++;

		const firstItemRow = r;

		// ── Orden por # LIQ ───────────────────────────────────────────────
		// Los items llegan ordenados por placa. Se reagrupan por consecutivo
		// para que las filas de una misma liquidación queden juntas, que es lo
		// que hace legible la columna RECARGOS de abajo.
		const itemsOrdenados = [...items].sort((a, b) => {
			const porLiq = String(a.consecutivo || '').localeCompare(String(b.consecutivo || ''));
			if (porLiq !== 0) return porLiq;
			const porPlaca = String(a.placa || '').localeCompare(String(b.placa || ''));
			if (porPlaca !== 0) return porPlaca;
			return (Number(a.orden) || 0) - (Number(b.orden) || 0);
		});

		/**
		 * RECARGOS es de la LIQUIDACIÓN, no del item.
		 *
		 * Pintarlo en cada fila lo repetía tantas veces como items tuviera esa
		 * liquidación, y como el pie hace SUMIF sobre la columna, el total
		 * salía multiplicado por ese mismo número. Se pinta UNA vez, en la
		 * primera fila de cada consecutivo; el resto quedan vacías.
		 */
		const recargoDe = (it: ItemOcasional) =>
			Number(it.valor_recargos ?? it.liquidacion_servicio?.valor_recargos ?? 0) || 0;

		const claveLiqDe = (it: ItemOcasional, idx: number) =>
			String(it.consecutivo || `sin-liq-${idx}`);

		// La fila que LLEVA el recargo de cada liquidación es la primera de ese
		// consecutivo. Las demás quedan vacías para no multiplicar el total.
		const filaDelRecargo = new Map<string, string>();
		itemsOrdenados.forEach((it, idx) => {
			const clave = claveLiqDe(it, idx);
			if (!filaDelRecargo.has(clave)) filaDelRecargo.set(clave, it.id);
		});

		itemsOrdenados.forEach((it, idx) => {
			// Fila REAL del item. Antes esto se hacía en el bucle de arriba, que
			// no mueve `r`: los 35 items acababan apuntando todos a la misma
			// fila, así que ni las notas ancladas a un item ni el borrado de
			// filas podían resolver a qué item pertenecía cada una.
			itemPorFila.set(r, it.id);
			const zebra = idx % 2 === 1;
			const base = zebra ? cellZebra : cellBase;
			const m = money(zebra);
			const ad = admonStyle(zebra);
			const ingresoTransmeralda =
				Number(it.ingreso_extra_global || 0) - Number(it.ingresos_extra_aval || 0);

			set(cellData)(r, 0, idx + 1, base);
			set(cellData)(r, 1, it.cliente_nombre || '', base);
			set(cellData)(r, 2, it.consecutivo || '', base);
			set(cellData)(r, 3, (it.placa || '').toUpperCase(), base);
			set(cellData)(r, 4, it.tercero_nombre || '', base);
			set(cellData)(r, 5, it.recorrido || '', base);
			set(cellData)(r, 6, it.fechas || '', base);
			set(cellData)(r, 7, Number(it.valor_unitario) || 0, m);
			set(cellData)(r, 8, Number(it.cantidad) || 1, base);
			set(cellData)(
				r,
				9,
				`${Number(it.porcentaje_admin ?? 0).toFixed(2)}%`,
				base
			);
			set(cellData)(r, 10, Number(it.valor_admin) || 0, ad);
			set(cellData)(r, 11, Number(it.total_facturado) || 0, m);
			set(cellData)(r, 12, Number(it.valor_liquidar) || 0, m);
			set(cellData)(r, 13, it.numero_planilla || '', base);
			set(cellData)(r, 14, Number(it.ingreso_extra_global) || 0, m);
			set(cellData)(r, 15, Number(it.ingresos_extra_aval) || 0, m);
			set(cellData)(r, 16, ingresoTransmeralda, m);
			// Solo en la fila que lleva el recargo de su # LIQ (ver nota arriba).
			if (filaDelRecargo.get(claveLiqDe(it, idx)) === it.id) {
				set(cellData)(r, 17, recargoDe(it), m);
			} else {
				set(cellData)(r, 17, '', base);
			}
			set(cellData)(r, 18, it.numero_factura || '', base);
			// La 19 es editable: aplica_impuestos (toggle).
			// Se escribe SÍ/NO y no un booleano: Univer pintaba "true"/"false"
			// literal, y además el pie de la tabla usa SUMIF contra el texto
			// "NO" — con booleanos ese criterio nunca casa.
			const aplicaImp = it.aplica_impuestos !== false;
			set(cellData)(r, 19, aplicaImp ? 'SÍ' : 'NO', aplicaImp ? accionSi : accionNo);
			setOcasionalBinding(unitId, sheetId,r, 19, {
				entityType: 'item',
				entityId: it.id,
				field: 'aplica_impuestos',
				section: 'items'
			});
			r++;
		});
		const lastItemRow = r - 1;

		// Fila TOTALES con SUM formulas
		const totalsRow = r;
		filaTotalesItems = totalsRow + 1;
		set(cellData)(totalsRow, 0, 'TOTALES', tfoot);
		mergeData.push({
			startRow: totalsRow,
			endRow: totalsRow,
			startColumn: 0,
			endColumn: 9,
			rangeType: 0
		});
		for (let c = 1; c <= 9; c++) {
			if (!cellData[totalsRow]) cellData[totalsRow] = {};
			cellData[totalsRow][c] = { s: tfoot };
		}
		// Los cacheados se calculan sobre los items ACTIVOS, para que coincidan
		// con lo que evalúa la fórmula viva de abajo.
		const activos = items;
		const sumCols: Array<[number, number]> = [
			[10, activos.reduce((s, i) => s + Number(i.valor_admin || 0), 0)],
			[11, activos.reduce((s, i) => s + Number(i.total_facturado || 0), 0)],
			[12, activos.reduce((s, i) => s + Number(i.valor_liquidar || 0), 0)],
			[14, activos.reduce((s, i) => s + Number(i.ingreso_extra_global || 0), 0)],
			[15, activos.reduce((s, i) => s + Number(i.ingresos_extra_aval || 0), 0)],
			[
				16,
				activos.reduce(
					(s, i) =>
						s +
						(Number(i.ingreso_extra_global || 0) - Number(i.ingresos_extra_aval || 0)),
					0
				)
			],
			[
				17,
				// Un recargo por LIQUIDACIÓN, no por item: si no, el total sale
				// multiplicado por el número de filas de cada liquidación. Es
				// el mismo criterio con el que se pintan las celdas arriba, y
				// tiene que coincidir con lo que evalúa el SUMIF.
				// Exactamente las filas que llevan recargo pintado, para que el
				// cacheado coincida con lo que evalúa el SUMIF.
				(cacheRecargosItems = itemsOrdenados.reduce(
					(acc, i, k) =>
						filaDelRecargo.get(claveLiqDe(i, k)) === i.id ? acc + recargoDe(i) : acc,
					0
				))
			]
		];
		// `SUM` a secas: en la hoja ya solo hay items que cuentan. Lo que antes
		// se marcaba como EXCLUIDO ahora se borra, y borrar quita la fila.
		const hayItems = lastItemRow >= firstItemRow;
		for (const [col, value] of sumCols) {
			const letter = colLetter(col);
			const rango = `${letter}${firstItemRow + 1}:${letter}${lastItemRow + 1}`;
			// Sin items el rango sería inverso (`A5:A4`) y Univer devolvería
			// #REF!, así que la hoja vacía se cablea a 0.
			const formula = hayItems ? `=SUM(${rango})` : '=0';
			setFormula(cellData)(totalsRow, col, formula, hayItems ? value : 0, tfoot);
		}
		// Columnas no sumables con bg (RECARGOS ahora tiene SUM; # PLANILLA,
		// # FACTURA y APLICA IMP. no)
		[13, 18, 19].forEach((c) => {
			if (!cellData[totalsRow]) cellData[totalsRow] = {};
			cellData[totalsRow][c] = { s: tfoot };
		});
		rowData[totalsRow] = { h: 24 };
	}

	r++;

	// ─── RESUMEN DEL SERVICIO ───────────────────────────────────────────────────
	// Solo en OCASIONALES. Sale de la tabla de items de arriba y define lo que de
	// verdad se le paga al tercero. El orden de las filas ES el orden del
	// cálculo:
	//
	//   INGRESOS DE COTRANSMEQ + TOTAL RECARGOS   ← base de la administración
	//   − ADMON % (editable, 10 % por defecto)
	//   = VALOR SERVICIO DE TRANSPORTE · UTILIDAD DE LOS TERCEROS
	//
	// Es esa utilidad —no el total facturado— la base del TOTAL A PAGAR, porque
	// el facturado incluye lo que no le corresponde al tercero.
	{
		const etiquetaStyle: IStyleData = {
			fs: 10,
			bl: 1,
			cl: { rgb: TEXT_DARK },
			bg: { rgb: SUBTLE_BG },
			bd: allBorders(),
			ht: HorizontalAlign.LEFT
		};
		const valorStyle: IStyleData = {
			fs: 10,
			bl: 1,
			cl: { rgb: TEXT_DARK },
			bg: { rgb: SUBTLE_BG },
			bd: allBorders(),
			n: { pattern: '"$"#,##0' },
			ht: HorizontalAlign.RIGHT
		} as any;

		const fila = (etiqueta: string, formula: string, cacheado: number, estilo?: IStyleData) => {
			set(cellData)(r, 0, etiqueta, etiquetaStyle);
			mergeData.push({ startRow: r, endRow: r, startColumn: 0, endColumn: 2, rangeType: 0 });
			for (let c = 1; c <= 3; c++) {
				if (!cellData[r]) cellData[r] = {};
				if (!cellData[r][c]) cellData[r][c] = { s: etiquetaStyle };
			}
			setFormula(cellData)(r, 4, formula, cacheado, (estilo ?? valorStyle) as any);
			rowData[r] = { h: 22 };
			const filaActual = r;
			r++;
			return filaActual + 1; // 1-based, para referenciarla en fórmulas
		};

		// El porcentaje vigente es el que dejó el equipo en la hoja; el 10 % es
		// solo el valor de partida cuando nadie lo ha tocado todavía.
		const guardado = input.anotaciones?.find(
			(a) => a.ancla_tipo === 'clave' && a.ancla_ref === CLAVE_PCT_ADMON
		);
		const pctAdmon = numeroDeCapa(String(guardado?.valor ?? '')) ?? PCT_ADMON_SERVICIO;

		const L = `L${filaTotalesItems}`;
		const Q = `Q${filaTotalesItems}`;

		const activos = items;
		const cacheFacturado = activos.reduce((a, i) => a + (Number(i.total_facturado) || 0), 0);
		const cacheIngresos = activos.reduce(
			(a, i) =>
				a +
				((Number(i.ingreso_extra_global) || 0) - (Number(i.ingresos_extra_aval) || 0)),
			0
		);

		/// El ADMON se pinta en rojo: es lo ÚNICO que resta en este bloque, y
		/// leerlo con el mismo color que las demás filas hacía que pareciera
		/// sumar como ellas.
		const etiquetaAdmonStyle: IStyleData = { ...etiquetaStyle, cl: { rgb: RED } };
		const valorAdmonStyle: IStyleData = { ...valorStyle, cl: { rgb: RED } } as any;

		fila('TOTAL FACTURADO', `=${L}`, cacheFacturado);
		const filaIngresos = fila('INGRESOS DE COTRANSMEQ', `=${Q}`, cacheIngresos);
		// Los RECARGOS van ANTES del ADMON porque forman parte de su base: la
		// administración se cobra sobre todo lo que entra por el servicio
		// (ingresos + recargos), no solo sobre los ingresos.
		const filaRecargos = fila('TOTAL RECARGOS', `=R${filaTotalesItems}`, cacheRecargosItems);

		// ADMON %: celda EDITABLE. Se deja en su propia columna para poder
		// cambiar el porcentaje sin tocar ninguna fórmula.
		set(cellData)(r, 0, 'ADMON %', etiquetaAdmonStyle);
		mergeData.push({ startRow: r, endRow: r, startColumn: 0, endColumn: 1, rangeType: 0 });
		if (!cellData[r]) cellData[r] = {};
		cellData[r][1] = { s: etiquetaAdmonStyle };
		filaClavePctAdmon = r;
		setPercent(cellData)(r, 2, pctAdmon, {
			...etiquetaAdmonStyle,
			ht: HorizontalAlign.RIGHT
		});
		cellData[r][3] = { s: etiquetaAdmonStyle };
		const filaPctAdmon = r + 1;
		const baseAdmon = cacheIngresos + cacheRecargosItems;
		const cacheAdmon = baseAdmon * (pctAdmon / 100);
		setFormula(cellData)(
			r,
			4,
			`=(E${filaIngresos}+E${filaRecargos})*C${filaPctAdmon}/100`,
			cacheAdmon,
			valorAdmonStyle
		);
		rowData[r] = { h: 22 };
		const filaAdmon = r + 1;
		r++;

		filaUtilidadServicio = fila(
			'VALOR SERVICIO DE TRANSPORTE · UTILIDAD DE LOS TERCEROS',
			`=E${filaIngresos}+E${filaRecargos}-E${filaAdmon}`,
			baseAdmon - cacheAdmon,
			{
				fs: 11,
				bl: 1,
				cl: { rgb: GREEN_DARK },
				bg: { rgb: '#DCFCE7' },
				bd: allBorders(),
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any
		);
		cacheUtilidadServicio = baseAdmon - cacheAdmon;
	}

	r++;

	// ─── SECCIÓN DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO ──────────────────────
	// Réplica exacta del layout del canvas de cierres finales (mismos estilos,
	// mismos helpers, misma jerarquía: SALARIOS → PRESTACIONES → SEGURIDAD_SOCIAL
	// → VALOR TOTAL CONDUCTOR). Esta sección es READ-ONLY en el ocasional
	// (no hay cell-bindings editables, así que cell-permission-ocasional las
	// bloquea todas por default-deny).
	{
		// Estilos réplica 1:1 del cierres-finales canvas.
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
		const nominaTfStyle: IStyleData = {
			fs: 10,
			bl: 1,
			cl: { rgb: TEXT_DARK },
			bg: { rgb: TOTALES_BG },
			bd: allBorders(),
			n: { pattern: '"$"#,##0' }
		} as any;
		const nominaCatStyle: IStyleData = {
			fs: 9,
			it: 1,
			bl: 1,
			cl: { rgb: GREEN },
			bg: { rgb: SUBTLE_BG },
			bd: allBorders()
		};

		r++;

		// 1 fila en blanco entre TOTALES y la sección de nómina (ya incrementamos `r` arriba)
		const nrow = r; // apunta al blank row → primera fila escribible

		// Bandera de sección "DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO" (A:E merge)
		set(cellData)(nrow, 0, 'DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO', nominaHeaderBand);
		mergeData.push({
			startRow: nrow,
			endRow: nrow,
			startColumn: 0,
			endColumn: 4,
			rangeType: 0
		});
		for (let cc = 1; cc <= 4; cc++) {
			if (!cellData[nrow]) cellData[nrow] = {};
			cellData[nrow][cc] = { s: nominaHeaderBand };
		}
		rowData[nrow] = { h: 22 };
		
		r++;

		const conceptosNominaHoja = conceptos.filter((c) => c.tipo === 'COSTO_LABORAL');
		let grupos = getConductorGruposOcasional(conceptosNominaHoja);
		// Si NO hay conceptos COSTO_LABORAL en la BD, creamos un grupo default
		// "General / Consolidado" para garantizar que las 13 filas estándar
		// (5 salarios + 4 prestaciones + 4 seguridad social) se rendericen
		// con valor 0. Esto mantiene la estructura visual consistente.
		if (grupos.length === 0) {
			grupos = [
				{
					conceptos: [],
					salarios: [],
					prestaciones: [],
					seguridadSocial: [],
					totalConductor: 0
				}
			];
		}

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

		// Helper para escribir una fila de concepto con A:B merge = nombre,
		// C = dias/%, D = valor, E = TOTAL (formula viva `=C{r}*D{r}`).
		// En el ocasional NO hay celdas editables — todo locked. La fórmula
		// sigue siendo útil para que Univer recalcule automáticamente si los
		// valores base cambian en una regeneración futura del workbook.
		const writeConceptoRow = (
			rr: number,
			nombre: string,
			diasOPct: string | number,
			valor: number,
			total: number,
			style: IStyleData,
			boldTotal = false,
			conceptoId?: string,
			colCField?: 'dias' | 'porcentaje',
			/// Fórmula para la columna VALOR. Solo la usan las filas de
			/// porcentaje, cuya base depende de otras filas de la hoja.
			baseFormula?: string
		) => {
			setN(rr, 0, nombre, style);
			mergeData.push({ startRow: rr, endRow: rr, startColumn: 0, endColumn: 1, rangeType: 0 });
			if (!cellData[rr]) cellData[rr] = {};
			cellData[rr][1] = { s: style };
			if (colCField === 'porcentaje') {
				setPercent(cellData)(rr, 2, Number(diasOPct) || 0, { ...style, ht: HorizontalAlign.RIGHT });
			} else {
				setN(rr, 2, diasOPct, { ...style, ht: HorizontalAlign.RIGHT });
			}
			// D = VALOR sobre el que se calcula. En las filas de días es el valor
			// unitario; en las de porcentaje es la BASE (salario + auxilio +
			// recargos, o salario + recargos según el concepto), que llega como
			// fórmula viva para que se recalcule al tocar los días.
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
			// TOTAL = C × D en las filas de DÍAS, pero C/100 × D en las de
			// PORCENTAJE: ahí C guarda 8.33, y el «%» que se ve es solo un patrón
			// de formato, no un porcentaje real. Sin el /100 el total salía
			// multiplicado por cien (8.33 × 3.633.333 = 30.265.664).
			const formulaTotal =
				colCField === 'porcentaje'
					? `=C${rr + 1}/100*D${rr + 1}`
					: `=C${rr + 1}*D${rr + 1}`;
			setFormula(cellData)(rr, 4, formulaTotal, Number(total) || 0, totalStyle);

			if (conceptoId && colCField) {
				setOcasionalBinding(unitId, sheetId,rr, 2, {
					entityType: 'concepto',
					entityId: conceptoId,
					field: colCField,
					section: 'costolaboral'
				});
			}
			if (conceptoId && colCField === 'dias') {
				setOcasionalBinding(unitId, sheetId,rr, 3, {
					entityType: 'concepto',
					entityId: conceptoId,
					field: 'valor_unitario',
					section: 'costolaboral'
				});
			}
		};

		grupos.forEach((g) => {
				const ccDoc = g.conceptos[0]?.conductor?.numero_identificacion;

				// Cabecera del conductor (A:C merge = "NOMBRE · CC <doc>")
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

				// ─── SALARIOS: SIEMPRE renderizar las 5 filas estándar ─────────
				// Si hay dato para el concepto en `g.salarios`, se usan sus
				// valores; si no, se renderiza con 0. Garantiza estructura
				// visual consistente aunque no haya datos de nómina aún.
				const STANDARD_SALARIOS = [
					'SALARIO',
					'AUXILIO_TRANSPORTE',
					'BONIFICACION',
					'OTROS_AUXILIOS',
					'RECARGOS'
				];
				/// Fila de cada concepto de salario: las bases se construyen
				/// refiriéndose a ellas, no re-sumando valores sueltos, para que
				/// todo se recalcule al editar días o valor unitario.
				const filaSalario: Record<string, number> = {};
				STANDARD_SALARIOS.forEach((stdName) => {
					filaSalario[stdName] = r;
					const c = g.salarios.find((x) => x.concepto === stdName);
					const dias = c ? Number(c.dias || 0) : 0;
					const vu = c ? Number(c.valor_unitario || 0) : 0;
					writeConceptoRow(
						r,
						stdName.replace(/_/g, ' '),
						dias,
						vu,
						dias * vu,
						nominaCellBase,
						false,
						c?.id,
						'dias'
					);
					r++;
				});

				// ─── PRESTACIONES SOCIALES: SIEMPRE renderizar categoría + hijos ─
				const STANDARD_PREST = [
					'CESANTIAS',
					'INTERESES_CESANTIAS',
					'PRIMA',
					'VACACIONES'
				];
				// La fila de la CATEGORÍA se reserva antes de pintar los hijos.
				// Antes ambos empezaban en `r`, así que la categoría se escribía
				// encima del primer hijo: CESANTIAS desaparecía de la tabla y el
				// SUM del pie quedaba desplazado una fila.
				// ── Bases de cálculo ──
				// PRESTACIONES: salario + auxilio de transporte + recargos.
				// SEGURIDAD SOCIAL (y VACACIONES): salario + recargos, sin auxilio.
				// Van como fórmula y no como número: al cambiar los días de
				// salario, todo lo que cuelga de la base se recalcula solo.
				const eDe = (nombre: string) => `E${filaSalario[nombre] + 1}`;
				const BASE_PREST = `=${eDe('SALARIO')}+${eDe('AUXILIO_TRANSPORTE')}+${eDe('RECARGOS')}`;
				const BASE_SS = `=${eDe('SALARIO')}+${eDe('RECARGOS')}`;
				const valorBasePrest =
					(Number(g.salarios.find((x) => x.concepto === 'SALARIO')?.valor_total) || 0) +
					(Number(
						g.salarios.find((x) => x.concepto === 'AUXILIO_TRANSPORTE')?.valor_total
					) || 0) +
					(Number(g.salarios.find((x) => x.concepto === 'RECARGOS')?.valor_total) || 0);
				const valorBaseSS =
					(Number(g.salarios.find((x) => x.concepto === 'SALARIO')?.valor_total) || 0) +
					(Number(g.salarios.find((x) => x.concepto === 'RECARGOS')?.valor_total) || 0);

				const prestCatRow = r;
				r++;
				const firstPrestChildRow = r;
				STANDARD_PREST.forEach((stdName) => {
					const c = g.prestaciones.find((x) => x.concepto === stdName);
					const pct = c ? Number(c.porcentaje || 0) : 0;
					const total = c ? Number(c.valor_total || 0) : 0;
					// VACACIONES es la excepción: se calcula sin el auxilio de
					// transporte, igual que la seguridad social.
					const esVacaciones = stdName === 'VACACIONES';
					writeConceptoRow(
						r,
						stdName.replace(/_/g, ' '),
						pct,
						esVacaciones ? valorBaseSS : valorBasePrest,
						total,
						{ ...nominaCellBase, it: 1 },
						false,
						c?.id,
						'porcentaje',
						esVacaciones ? BASE_SS : BASE_PREST
					);
					r++;
				});
				const lastPrestChildRow = r - 1;
				const totalPrest = STANDARD_PREST.reduce(
					(s, n) =>
						s + (Number(g.prestaciones.find((x) => x.concepto === n)?.valor_total) || 0),
					0
				);
				const pctPrest = STANDARD_PREST.reduce(
					(s, n) =>
						s + (Number(g.prestaciones.find((x) => x.concepto === n)?.porcentaje) || 0),
					0
				);
				writeConceptoRow(
					prestCatRow,
					'PRESTACIONES SOCIALES',
					pctPrest,
					valorBasePrest,
					totalPrest,
					nominaCatStyle,
					true,
					undefined,
					'porcentaje',
					BASE_PREST
				);
				// El % de la categoría es la SUMA de los de sus conceptos, no un
				// número suelto: si se ajusta el ARP, el 21.83 se mueve solo.
				setFormula(cellData)(
					prestCatRow,
					2,
					`=SUM(C${firstPrestChildRow + 1}:C${lastPrestChildRow + 1})`,
					pctPrest,
					{ ...nominaCatStyle, bl: 1, n: { pattern: '0.00"%"' }, ht: HorizontalAlign.RIGHT } as any
				);
				// Y el total, la suma de los totales de los hijos. No se usa
				// C/100*D aquí: cada hijo puede tener una base distinta
				// (VACACIONES va sin auxilio), así que sumarlos es lo correcto.
				setFormula(
					cellData
				)(
					prestCatRow,
					4,
					`=SUM(E${firstPrestChildRow + 1}:E${lastPrestChildRow + 1})`,
					totalPrest,
					{
						...nominaCatStyle,
						bl: 1,
						n: { pattern: '"$"#,##0' },
						ht: HorizontalAlign.RIGHT
					} as any
				);

				// ─── SEGURIDAD SOCIAL: SIEMPRE renderizar categoría + hijos ────
				const STANDARD_SS = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];
				// Misma reserva de fila que en PRESTACIONES: sin ella la categoría
				// pisaba a SALUD.
				const ssCatRow = r;
				r++;
				const firstSSChildRow = r;
				STANDARD_SS.forEach((stdName) => {
					const c = g.seguridadSocial.find((x) => x.concepto === stdName);
					const pct = c ? Number(c.porcentaje || 0) : 0;
					const total = c ? Number(c.valor_total || 0) : 0;
					writeConceptoRow(
						r,
						stdName.replace(/_/g, ' '),
						pct,
						valorBaseSS,
						total,
						{ ...nominaCellBase, it: 1 },
						false,
						c?.id,
						'porcentaje',
						BASE_SS
					);
					r++;
				});
				const lastSSChildRow = r - 1;
				const totalSS = STANDARD_SS.reduce(
					(s, n) =>
						s +
						(Number(g.seguridadSocial.find((x) => x.concepto === n)?.valor_total) || 0),
					0
				);
				const pctSS = STANDARD_SS.reduce(
					(s, n) =>
						s +
						(Number(g.seguridadSocial.find((x) => x.concepto === n)?.porcentaje) || 0),
					0
				);
				writeConceptoRow(
					ssCatRow,
					'SEGURIDAD SOCIAL',
					pctSS,
					valorBaseSS,
					totalSS,
					nominaCatStyle,
					true,
					undefined,
					'porcentaje',
					BASE_SS
				);
				// Igual que en prestaciones: el % de la categoría es la suma viva
				// de los de sus conceptos.
				setFormula(cellData)(
					ssCatRow,
					2,
					`=SUM(C${firstSSChildRow + 1}:C${lastSSChildRow + 1})`,
					pctSS,
					{ ...nominaCatStyle, bl: 1, n: { pattern: '0.00"%"' }, ht: HorizontalAlign.RIGHT } as any
				);
				setFormula(cellData)(
					ssCatRow,
					4,
					`=SUM(E${firstSSChildRow + 1}:E${lastSSChildRow + 1})`,
					totalSS,
					{
						...nominaCatStyle,
						bl: 1,
						n: { pattern: '"$"#,##0' },
						ht: HorizontalAlign.RIGHT
					} as any
				);

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
					v: `VALOR TOTAL CONDUCTOR`,
					t: CellValueType.STRING,
					s: nominaTfStyle
				};
				for (let cc = 1; cc <= 3; cc++) cellData[r][cc] = { s: nominaTfStyle };
				// Fórmula viva y no el número que venga del servidor: salarios +
				// prestaciones + seguridad social. Antes era un valor fijo, así
				// que al editar cualquier fila el total se quedaba desfasado —o
				// en $0 si el servidor nunca lo había calculado.
				const primeraFilaSalario = filaSalario[STANDARD_SALARIOS[0]] + 1;
				const ultimaFilaSalario =
					filaSalario[STANDARD_SALARIOS[STANDARD_SALARIOS.length - 1]] + 1;
				filasTotalizadoras.push(r + 1);
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


	// ─── Helper común para secciones estrechas (gastos / impuestos / anticipos) ───
	// Layout: A:B merge = nombre, C = columna secundaria label, D = columna vacía/label, E = valor.
	// Si se pasa `rowMetas`, se registran bindings editables para filas de datos.
	type SectionRowMeta = {
		conceptoId?: string;
		/// Nombre del concepto EDITABLE en la propia hoja (la celda combinada
		/// A:B). Solo lo llevan las filas que añade el equipo a mano: el nombre
		/// de las filas fijas es su identidad, y renombrarlas las convertiría en
		/// otra cosa distinta al recargar.
		colAField?: 'concepto';
		colCField?: 'dias' | 'porcentaje';
		colDField?: 'valor_unitario';
	};
	const writeSmallSection = (
		band: string,
		bandColor: string,
		headers: string[],
		rows: Array<[string, string | number, string | number, string | number]>,
		totalFormula: (firstRow: number, lastRow: number) => string,
		totalCached: number,
		totalLabel: string,
		rowMetas?: Array<SectionRowMeta | undefined>,
		sectionTag?: string,
		colEFormula?: (r: number) => string,
		colCIsPercent: boolean = false
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
		set(cellData)(r, 0, headers[0], sectionLabel(SUBTLE_BG, bandColor));
		mergeData.push({
			startRow: r,
			endRow: r,
			startColumn: 0,
			endColumn: 1,
			rangeType: 0
		});
		if (!cellData[r]) cellData[r] = {};
		cellData[r][1] = { s: sectionLabel(SUBTLE_BG, bandColor) };
		set(cellData)(r, 2, headers[2], {
			...sectionLabel(SUBTLE_BG, bandColor),
			ht: HorizontalAlign.RIGHT
		});
		set(cellData)(r, 3, headers[3], {
			...sectionLabel(SUBTLE_BG, bandColor),
			ht: HorizontalAlign.RIGHT
		});
		set(cellData)(r, 4, headers[4], {
			...sectionLabel(SUBTLE_BG, bandColor),
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
			const meta = rowMetas?.[idx];
			// Las filas añadidas a mano llevan el nombre en azul: es la pista de
			// que ESA etiqueta se puede reescribir en la hoja, a diferencia de las
			// fijas, cuyo nombre las identifica.
			//
			// Y con ajuste de texto: sus descripciones son frases enteras («compra
			// de llantas austone 195/55r16 sp401 veh LZQ-974») y la celda combinada
			// A:B mide ~270 px, así que sin envolver el texto se leía la mitad.
			const labelStyle = meta?.colAField
				? ({ ...base, cl: { rgb: BLUE }, tb: WrapStrategy.WRAP } as IStyleData)
				: base;
			set(cellData)(r, 0, label, labelStyle);
			mergeData.push({
				startRow: r,
				endRow: r,
				startColumn: 0,
				endColumn: 1,
				rangeType: 0
			});
			if (!cellData[r]) cellData[r] = {};
			cellData[r][1] = { s: labelStyle };
			if (colCIsPercent) {
				setPercent(cellData)(r, 2, Number(c), { ...base, ht: HorizontalAlign.RIGHT });
			} else {
				set(cellData)(r, 2, c, { ...base, ht: HorizontalAlign.RIGHT });
			}
			setNumber(cellData)(r, 3, Number(d), { ...base, ht: HorizontalAlign.RIGHT, n: { pattern: '"$"#,##0' } } as any);
			if (colEFormula) {
				setFormula(cellData)(r, 4, colEFormula(r + 1), Number(e) || 0, {
					...base,
					ht: HorizontalAlign.RIGHT,
					n: { pattern: '"$"#,##0' }
				} as any);
			} else {
				set(cellData)(r, 4, e, {
					...base,
					ht: HorizontalAlign.RIGHT,
					n: { pattern: '"$"#,##0' }
				} as any);
			}
			if (meta?.colAField) {
				// El ajuste de texto no crece la fila solo: hay que darle el alto.
				// ~34 caracteres entran en los ~270 px de la celda combinada A:B a
				// 10 px de tamaño de letra. Quedarse corto recorta la primera
				// línea, así que se redondea hacia arriba.
				const lineas = Math.max(1, Math.ceil(String(label).length / 34));
				rowData[r] = { h: Math.max(22, lineas * 15 + 8) };
			}
			if (meta?.conceptoId && meta?.colAField) {
				setOcasionalBinding(unitId, sheetId, r, 0, {
					entityType: 'concepto',
					entityId: meta.conceptoId,
					field: meta.colAField,
					section: sectionTag || 'gastos'
				});
			}
			if (meta?.conceptoId && meta?.colCField) {
				setOcasionalBinding(unitId, sheetId,r, 2, {
					entityType: 'concepto',
					entityId: meta.conceptoId,
					field: meta.colCField,
					section: sectionTag || 'gastos'
				});
			}
			if (meta?.conceptoId && meta?.colDField) {
				setOcasionalBinding(unitId, sheetId,r, 3, {
					entityType: 'concepto',
					entityId: meta.conceptoId,
					field: meta.colDField,
					section: sectionTag || 'gastos'
				});
			}
			r++;
		});
		const lastDataRow = r - 1;

		// TOTAL footer
		const tr = r;
		// Este totalizador entra en TOTAL DESCUENTOS (ver `filasTotalizadoras`).
		filasTotalizadoras.push(tr + 1);
		set(cellData)(tr, 0, totalLabel, {
			fs: 10,
			bl: 1,
			cl: { rgb: TEXT_DARK },
			bg: { rgb: TOTALES_BG },
			bd: allBorders()
		});
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = {
				s: {
					fs: 10,
					bl: 1,
					cl: { rgb: TEXT_DARK },
					bg: { rgb: TOTALES_BG },
					bd: allBorders()
				}
			};
		}
		const formula =
			rows.length > 0 ? totalFormula(firstDataRow + 1, lastDataRow + 1) : '=0';
		setFormula(cellData)(tr, 4, formula, Number(totalCached) || 0, {
			...tfoot,
			bl: 1,
			cl: { rgb: bandColor },
			bg: { rgb: SUBTLE_BG },
			n: { pattern: '"$"#,##0' },
			ht: HorizontalAlign.RIGHT
		} as any);
		rowData[tr] = { h: 24 };
	};

	// ─── SECCIÓN 3: GASTOS DE VEHÍCULO ──────────────────────────────────────
	// Las cinco filas fijas SIEMPRE, y debajo las que el equipo haya añadido
	// desde «Gasto de vehículo»: cualquier `GASTO_OPERATIVO` cuyo nombre no sea
	// uno de los cinco.
	//
	// POR QUÉ: un gasto puntual —una compra de llantas, su IVA, un anticipo de
	// taller— no cabía en ninguna de las cinco filas fijas, y la hoja no pintaba
	// nada más, así que no había dónde escribirlo. Insertar una fila a mano
	// tampoco servía: la que aparece cae fuera de las celdas combinadas del
	// bloque, no tiene binding y el adaptador la descarta en silencio.
	{
		const STANDARD_GASTOS = GASTOS_VEHICULO;
		const gastosData = conceptos.filter((c) => c.tipo === 'GASTO_OPERATIVO');
		const esFijo = new Set(STANDARD_GASTOS);
		/// Los añadidos a mano, en el orden en que se crearon (`orden`), con el
		/// nombre como desempate para que no bailen entre recargas.
		const extras = gastosData
			.filter((c) => !esFijo.has(c.concepto))
			.sort(
				(a, b) =>
					(Number(a.orden) || 0) - (Number(b.orden) || 0) ||
					String(a.concepto).localeCompare(String(b.concepto))
			);

		const filas = [
			...STANDARD_GASTOS.map((stdName) => ({
				label: stdName.replace(/_/g, ' '),
				concepto: gastosData.find((x) => x.concepto === stdName),
				editable: false
			})),
			// El nombre va tal cual se escribió: es texto libre, no una constante
			// con guiones bajos.
			...extras.map((c) => ({ label: c.concepto, concepto: c, editable: true }))
		];

		const rows = filas.map(({ label, concepto: c }) => {
			const cant = c ? Number(c.dias ?? 1) : 0;
			const vu = c ? Number(c.valor_unitario ?? 0) : 0;
			return [label, cant, vu, c ? Number(c.valor_total || 0) : cant * vu] as [
				string,
				string | number,
				string | number,
				string | number
			];
		});
		const metas = filas.map(({ concepto: c, editable }) =>
			c?.id
				? {
						conceptoId: c.id,
						...(editable ? { colAField: 'concepto' as const } : {}),
						colCField: 'dias' as const,
						colDField: 'valor_unitario' as const
					}
				: undefined
		);
		const total = rows.reduce((s, row) => s + Number(row[3] || 0), 0);
		writeSmallSection(
			'GASTOS DE VEHÍCULO',
			AMBER,
			['CONCEPTO', '', 'CANTIDAD', 'VALOR', 'TOTAL'],
			rows,
			(f, l) => `=SUM(E${f}:E${l})`,
			total,
			'TOTAL GASTOS',
			metas,
			'gastos',
			(rr) => `=C${rr}*D${rr}`
		);
	}

	r++;
	r++;


	// ─── SECCIÓN 4: IMPUESTOS — SIEMPRE renderizar las 4 filas estándar ──────
	{
		const STANDARD_IMPUESTOS: Array<{ nombre: string; pctDefault: number }> = [
			{ nombre: 'RETENCION_ICA', pctDefault: 1.0 },
			{ nombre: 'AVISOS_TABLEROS', pctDefault: 15.0 },
			{ nombre: 'SOBRETASA_BOMBERIL', pctDefault: 21.0 },
			{ nombre: 'RETENCION_FUENTE', pctDefault: 3.5 }
		];
		const impData = conceptos.filter((c) => c.tipo === 'IMPUESTO');
		const rows = STANDARD_IMPUESTOS.map(({ nombre, pctDefault }) => {
			const c = impData.find((x) => x.concepto === nombre);
			const pct = c ? Number(c.porcentaje ?? pctDefault) : pctDefault;
			const base = c ? Number(c.base_calculo || 0) : 0;
			const total = c ? Number(c.valor_total || 0) : 0;
			return [
				nombre.replace(/_/g, ' '),
				pct,
				base,
				total
			] as [string, number, number, number];
		});
		const impMetas = STANDARD_IMPUESTOS.map(({ nombre }) => {
			const c = impData.find((x) => x.concepto === nombre);
			return c?.id
				? { conceptoId: c.id, colCField: 'porcentaje' as const }
				: undefined;
		});
		const total = rows.reduce((s, row) => s + Number(row[3] || 0), 0);
		writeSmallSection(
			'IMPUESTOS Y RETENCIONES',
			RED,
			['CONCEPTO', '', 'PORCENTAJE', 'BASE IMPONIBLE', 'VALOR'],
			rows,
			(f, l) => `=SUM(E${f}:E${l})`,
			total,
			'TOTAL IMPUESTOS',
			impMetas,
			'impuestos',
			(rr) => `=C${rr}*D${rr}/100`,
			true
		);
	}

	r++;

	// ─── TOTAL DESCUENTOS + TOTAL A PAGAR ────────────────────────────
	const totalGastosOperativos = conceptos
		.filter((c) => c.tipo === 'GASTO_OPERATIVO')
		.reduce((s, c) => s + Number(c.valor_total || 0), 0);
	const totalImpuestos = conceptos
		.filter((c) => c.tipo === 'IMPUESTO')
		.reduce((s, c) => s + Number(c.valor_total || 0), 0);
	const totalAnticipos = conceptos
		.filter((c) => c.tipo === 'ANTICIPO')
		.reduce((s, c) => s + Number(c.valor_total || 0), 0);
	const totalLiquidarItems = items.reduce(
		(s, it) => s + (Number(it.valor_liquidar) || 0),
		0
	);
	const totalAdicionalesCab = (adicionales ?? []).reduce(
		(s, a) => s + (Number((a as any).valor_liquidar) || 0),
		0
	);
	// El bloque de nómina (COSTO_LABORAL) también es un descuento: faltaba, así
	// que TOTAL DESCUENTOS acababa mostrando solo los impuestos.
	const totalCostosLaborales = conceptos
		.filter((c) => c.tipo === 'COSTO_LABORAL')
		.reduce((s2, c) => s2 + Number(c.valor_total || 0), 0);
	const totalDescuentos =
		totalCostosLaborales + totalGastosOperativos + totalImpuestos + totalAnticipos;
	// Misma fórmula que el backend: items + adicionales − descuentos. Faltaba el
	// término de adicionales, así que el canvas mostraba menos de lo que se paga.
	// Cacheado coherente con la fórmula: parte de la utilidad del servicio.
	const totalPagar = cacheUtilidadServicio - totalDescuentos;

	/// Fila de TOTAL DESCUENTOS, para que TOTAL A PAGAR la referencie en vez de
	/// recalcular el mismo número por su cuenta.
	let filaTotalDescuentos = 0;

	// TOTAL DESCUENTOS (rojo) — A:D label, E valor
	{
		const tr = r;
		set(cellData)(tr, 0, 'TOTAL DESCUENTOS', {
			fs: 12,
			bl: 1,
			cl: { rgb: RED },
			bg: { rgb: '#FEE2E2' },
			bd: allBorders(),
			ht: HorizontalAlign.LEFT
		});
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = {
				s: {
					fs: 12,
					bl: 1,
					cl: { rgb: RED },
					bg: { rgb: '#FEE2E2' },
					bd: allBorders()
				}
			};
		}
		// Suma VIVA de los totalizadores de cada sección: nómina + gastos de
		// vehículo + impuestos (+ anticipos donde exista). Antes era un número
		// calculado aparte que se quedaba corto y contradecía lo que se ve
		// justo encima en la propia hoja.
		setFormula(cellData)(
			tr,
			4,
			filasTotalizadoras.length
				? '=' + filasTotalizadoras.map((f) => `E${f}`).join('+')
				: '=0',
			totalDescuentos,
			{
				fs: 14,
				bl: 1,
				cl: { rgb: '#FFFFFF' },
				bg: { rgb: RED },
				bd: allBorders(),
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any
		);
		filaTotalDescuentos = tr + 1;
		rowData[tr] = { h: 28 };
		r++;
	}

	// TOTAL A PAGAR (verde)
	{
		const tr = r;
		set(cellData)(tr, 0, 'TOTAL A PAGAR', {
			fs: 12,
			bl: 1,
			cl: { rgb: GREEN_DARK },
			bg: { rgb: '#DCFCE7' },
			bd: allBorders(),
			ht: HorizontalAlign.LEFT
		});
		mergeData.push({
			startRow: tr,
			endRow: tr,
			startColumn: 0,
			endColumn: 3,
			rangeType: 0
		});
		for (let c = 1; c <= 3; c++) {
			if (!cellData[tr]) cellData[tr] = {};
			cellData[tr][c] = {
				s: {
					fs: 12,
					bl: 1,
					cl: { rgb: GREEN_DARK },
					bg: { rgb: '#DCFCE7' },
					bd: allBorders()
				}
			};
		}
		// items + adicionales − TOTAL DESCUENTOS, referenciando la
		// celda de descuentos y no un número aparte: así las dos cifras de la
		// hoja no pueden discrepar.
		setFormula(cellData)(
			tr,
			4,
			// En OCASIONALES la base es la UTILIDAD DE LOS TERCEROS (ingresos de
			// Cotransmeq + recargos, menos la administración), no el total
			// facturado: el facturado incluye lo que no le corresponde al tercero.
			filaUtilidadServicio
				? `=E${filaUtilidadServicio}-E${filaTotalDescuentos}`
				: `=${totalLiquidarItems + totalAdicionalesCab}-E${filaTotalDescuentos}`,
			totalPagar,
			{
				fs: 14,
				bl: 1,
				cl: { rgb: '#FFFFFF' },
				bg: { rgb: GREEN_DARK },
				bd: allBorders(),
				n: { pattern: '"$"#,##0' },
				ht: HorizontalAlign.RIGHT
			} as any
		);
		rowData[tr] = { h: 28 };
	}

	// El ancla va DEBAJO de TODO el bloque estructurado, igual que en cierres y
	// adicionales. Anclarla al final de la tabla de items metía descuentos,
	// gastos e impuestos DENTRO del área anotable: cualquier celda sin binding
	// de esas secciones (la columna E de TOTAL, las categorías, VALOR TOTAL
	// CONDUCTOR) se trataba como anotación de texto, y `aplicarCapa` —que corre
	// al final— la reescribía como STRING borrando su `f`. La fórmula moría y el
	// total se quedaba congelado en $0 por más días o valores que se escribieran.
	const filaLibreDesde = r + 2;
	const totalRows = filaLibreDesde + FILAS_ANOTABLES;

	// Retícula continua: sin esto la tabla "se acaba" de golpe donde terminan
	// los datos. Ver `relleno-bordes.ts` sobre por qué no se puede por config.
	const celdasEnBlanco = rellenarBordesVacios(
		cellData,
		totalRows,
		OCASIONAL_TOTAL_COLUMNS,
		mergeData
	);

	// Zona libre: debajo del bloque estructurado el equipo puede dejar
	// referencias o valores de apoyo. Se registra para que `cell-permission`
	// las deje editar y el adaptador sepa que eso es una anotación, no un
	// campo de la base de datos.
	// `soloDebajo`: esta hoja declara sus filas de item, así que lo anotable es
	// exactamente eso más lo que hay bajo el ancla. Todo lo de en medio
	// (descuentos, gastos, impuestos) lo calcula el builder y no se toca.
	registrarHojaEditable(unitId, sheetId, {
		finItems: filaLibreDesde,
		itemPorFila,
		soloDebajo: true,
		// La ÚNICA celda editable por encima del ancla: el % de ADMON. Va por
		// clave porque `soloDebajo` descarta todo lo que esté ahí arriba.
		celdasClave:
			filaClavePctAdmon >= 0
				? { [CLAVE_PCT_ADMON]: { fila: filaClavePctAdmon, columna: 2 } }
				: {}
	});
	aplicarCapa(cellData, unitId, sheetId, input.anotaciones);

	const sheet: any = {
		id: sheetId,
		name: sheetName,
		tabColor: GREEN,
		hidden: BooleanNumber.FALSE,
		rowCount: totalRows,
		columnCount: OCASIONAL_TOTAL_COLUMNS,
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

/**
 * Hoja para un mes SIN cabecera (no se ha generado borrador todavía).
 *
 * Se emite igualmente, con un aviso y un CTA. No registra ningún binding,
 * así que el default-deny de `cell-permission-ocasional` la deja read-only
 * sin necesidad de reglas extra.
 */
function buildOcasionalPlaceholderSheet(sheetId: string, sheetName: string): any {
	const cellData: Record<number, Record<number, ICellData>> = {};
	const colData: Record<number, { w?: number }> = {};
	COLUMN_WIDTHS_ITEMS.forEach((w, i) => (colData[i] = { w }));

	cellData[1] = {
		0: {
			v: `SIN BORRADOR PARA ${sheetName}`,
			t: CellValueType.STRING,
			s: { fs: 13, bl: 1, cl: { rgb: MUTED } } as IStyleData
		}
	};
	cellData[3] = {
		0: {
			v: 'Usa «Generar borrador» en la barra superior para crear la liquidación de este mes.',
			t: CellValueType.STRING,
			s: { fs: 10, cl: { rgb: MUTED } } as IStyleData
		}
	};

	return {
		id: sheetId,
		name: sheetName,
		tabColor: MUTED,
		hidden: BooleanNumber.FALSE,
		rowCount: 30,
		columnCount: OCASIONAL_TOTAL_COLUMNS,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 100,
		defaultRowHeight: 22,
		mergeData: [
			{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 8, rangeType: 0 },
			{ startRow: 3, endRow: 3, startColumn: 0, endColumn: 8, rangeType: 0 }
		],
		cellData,
		rowData: { 1: { h: 30 } },
		columnData: colData,
		rowHeader: { width: 50 },
		columnHeader: { height: 24 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};
}

export interface OcasionalMesInput {
	mes: number;
	/** `null` si ese mes aún no tiene borrador generado. */
	cabecera: LiquidacionOcasional | null;
	items: ItemOcasional[];
	adicionales: AdicionalOcasional[];
	conceptos: ConceptoOcasional[];
}

export interface OcasionalAnualInput {
	anio: number;
	meses: OcasionalMesInput[];
	/// Notas libres por mes: `{ [mes]: { [sheet_key]: CeldaDeCapa[] } }`.
	/// Libro anual ⇒ `sheet_key = ''` (el mes ya identifica la hoja).
	anotaciones?: Record<number, Record<string, CeldaDeCapa[]>>;
}

/**
 * Construye el libro ANUAL: 12 hojas, una por mes.
 *
 * Las 12 hojas se emiten SIEMPRE. Los meses sin cabecera rinden hoja
 * placeholder: omitirlas rompería el deep-link `?mes=` y haría que la
 * barra de hojas cambiara de posición según qué meses existan.
 *
 * `cabeceraIdPorMes` es lo que permite que el autoguardado sea por hoja:
 * cada mes persiste contra SU cabecera (`@@unique([mes, anio])` en BD).
 */
export function buildOcasionalAnualWorkbook(input: OcasionalAnualInput): {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorMes: Record<number, string>;
	cabeceraIdPorMes: Record<number, string | null>;
} {
	const { anio, meses } = input;
	const unitId = ocasionalUnitId(anio);

	const porMes = new Map<number, OcasionalMesInput>();
	for (const m of meses) porMes.set(m.mes, m);

	const sheetOrder: string[] = [];
	const sheets: Record<string, any> = {};
	const sheetIdPorMes: Record<number, string> = {};
	const cabeceraIdPorMes: Record<number, string | null> = {};

	for (let mes = 1; mes <= 12; mes++) {
		const sheetId = ocasionalSheetId(mes);
		const sheetName = MESES[mes - 1];
		sheetIdPorMes[mes] = sheetId;
		sheetOrder.push(sheetId);

		const datos = porMes.get(mes);
		cabeceraIdPorMes[mes] = datos?.cabecera?.id ?? null;

		sheets[sheetId] = datos?.cabecera
			? buildOcasionalSheet({
					unitId,
					sheetId,
					sheetName,
					anio,
					mes,
					items: datos.items ?? [],
					adicionales: datos.adicionales ?? [],
					conceptos: datos.conceptos ?? [],
					anotaciones: input.anotaciones?.[mes]?.[''] ?? []
				})
			: buildOcasionalPlaceholderSheet(sheetId, sheetName);
	}

	const workbook: IWorkbookData = {
		id: unitId,
		name: `Liquidaciones ocasionales ${anio}`,
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder,
		sheets
	};

	return { workbook, unitId, sheetIdPorMes, cabeceraIdPorMes };
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

/**
 * Agrupa los conceptos `COSTO_LABORAL` por conductor y los clasifica en
 * SALARIOS / PRESTACIONES / SEGURIDAD_SOCIAL. Réplica 1:1 de la función
 * homónima en el canvas de cierres finales para garantizar el mismo
 * orden de presentación y la misma estructura visual.
 */
function getConductorGruposOcasional(conceptos: ConceptoOcasional[]) {
	// Espejo de `SALARIOS` en `conductor-grupos.service.ts`. Aquí es solo
	// CLASIFICACIÓN: las filas que se pintan siempre son las de
	// `STANDARD_SALARIOS` del builder. Un BONIFICACION_TURNO_DOBLE que llegue en
	// los datos entra en el grupo y no se pierde del total.
	const SALARIOS = [
		'SALARIO',
		'AUXILIO_TRANSPORTE',
		'BONIFICACION',
		'BONIFICACION_TURNO_DOBLE',
		'OTROS_AUXILIOS',
		'RECARGOS'
	];
	const PREST_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
	const PREST_SIN_AUX = ['VACACIONES'];
	const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

	type Grupo = {
		conceptos: ConceptoOcasional[];
		salarios: ConceptoOcasional[];
		prestaciones: ConceptoOcasional[];
		seguridadSocial: ConceptoOcasional[];
		totalConductor: number;
	};

	const map = new Map<string, Grupo>();
	for (const c of conceptos || []) {
		const k = c.conductor_id || 'sin-conductor';
	
		if (!map.has(k))
			map.set(k, {
				conceptos: [],
				salarios: [],
				prestaciones: [],
				seguridadSocial: [],
				totalConductor: 0
			});
		const g = map.get(k)!;
		g.conceptos.push(c);
		g.totalConductor += Number(c.valor_total) || 0;
		if (SALARIOS.includes(c.concepto)) g.salarios.push(c);
		else if (PREST_CON_AUX.includes(c.concepto) || PREST_SIN_AUX.includes(c.concepto))
			g.prestaciones.push(c);
		else if (SEGURIDAD.includes(c.concepto)) g.seguridadSocial.push(c);
	}
	return Array.from(map.values());
}

const HEADERS_ITEMS = [
	'#',
	'CLIENTE',
	'# LIQ',
	'PLACA',
	'NOMBRE 3°',
	'RECORRIDO',
	'FECHAS',
	'V/UNIDAD',
	'CANT',
	'ADMON %',
	'ADMON $',
	'TOTAL',
	'V/LIQUIDAR',
	'# PLANILLA',
	'ING. EXTRA GLOBAL',
	'ING. EXTRAS AVAL',
	'ING. COTRANSMEQ',
	'RECARGOS',
	'# FACTURA',
	'APLICA IMP.'
];

const COLUMN_WIDTHS_ITEMS = [
	28,
	240,
	100,
	130,
	230,
	250,
	140,
	95,
	65,
	80,
	95,
	105,
	105,
	140,
	150,
	150,
	150,
	120,
	90,
	95
];

const HEADERS_ADICIONALES = [
	'#',
	'CLIENTE',
	'PLACA',
	'NOMBRE 3°',
	'RECORRIDO',
	'FECHAS',
	'V/UNIDAD',
	'CANT',
	'ADMON %',
	'ADMON $',
	'V/LIQUIDAR',
	'APLICA IMP.'
];

const HEADERS_POR_PLACA = ['#', 'PLACA', 'NOMBRE 3°', 'ITEMS', 'ADMIN $', 'V/LIQUIDAR $'];