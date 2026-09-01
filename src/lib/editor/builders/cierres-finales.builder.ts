/**
 * Builder del canvas de CIERRES FINALES: una hoja por placa-propietario de
 * un periodo.
 *
 * Port de `buildTableWorkbook` (que vivía inline en el editor clásico
 * `editar/[id]`, ya eliminado), con cuatro diferencias de fondo:
 *
 *  1. MULTI-HOJA. `cellData`, `mergeData`, `rowData` y sobre todo `colData`
 *     se crean DENTRO de cada hoja. Univer muta `columnData` in-place al
 *     redimensionar: con 80 hojas compartiendo el objeto, ajustar una
 *     columna las ajustaría todas.
 *
 *  2. BINDINGS POR UUID. El original identificaba conceptos por
 *     `conceptoIdx` (posición en un array plano). Con N hojas ese índice
 *     deja de ser único, y cualquier reordenamiento hace que la edición se
 *     aplique a la fila equivocada. Aquí la identidad es `concepto.id`.
 *
 *     Además el builder DEVUELVE las semillas en vez de registrarlas: al
 *     insertar una hoja con `insertSheet()`, Univer no garantiza respetar
 *     un id provisto, así que el registro se hace fuera con el sheetId real.
 *
 *  3. PARIDAD CON EL EDITOR. El canvas original nunca cargaba adicionales,
 *     así que su TOTAL A PAGAR no cuadraba con el del editor tabular. Aquí
 *     se renderizan y entran en el total. También se soporta
 *     multi-propietario, que el original ignoraba por completo.
 *
 *  4. BLOQUEO POR HOJA. El editor clásico redirigía a `?mode=view` cuando el
 *     cierre no era BORRADOR. Aquí, con hojas de varios estados en el mismo
 *     libro, el bloqueo tiene que ser por hoja.
 *
 * AUTORIDAD ARITMÉTICA: las `SUM()` de footers son fórmulas vivas de Univer
 * (no se persisten por fila). Todo lo que SÍ se guarda —`valor_total` de un
 * concepto, bases, valores de impuesto— lo calcula el servidor y aquí solo
 * se pinta. Tener dos implementaciones de la misma aritmética es lo que
 * acabaría haciendo que el canvas muestre un número y el PDF otro.
 *
 * EXCEPCIÓN, el bloque de NÓMINA: la base de prestaciones y seguridad social
 * y sus totales sí son fórmula viva sobre las filas de salario de la propia
 * hoja. No es una segunda aritmética —es la MISMA regla escrita como
 * referencias de celda— y es lo único que hace que cambiar los días de
 * SALARIO se vea al instante en vez de esperar el ida y vuelta. Lo que el
 * servidor devuelva sigue mandando en el modelo; esas celdas simplemente no
 * se repintan (no llevan `bindDerivada`, o `pintarFilas` borraría su `f`).
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
import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import { getConductorGrupos } from '../business/conductor-grupos.service';
import { totalDiasNoPropietarios } from '../business/conceptos.service';
import type { BindingSeed, CierreBinding } from '../business/cierres-finales-cell-binding';
import {
	cierreFinalSheetId,
	cierresFinalesUnitId,
	esEditable,
	nombresUnicos,
	type CierreHoja
} from './cierres-finales-identidad';
import { colorDeHoja } from './cierres-finales-estado';

// ─── Paleta y constantes de layout ────────────────────────────────────

const GREEN = '#0F4025';
const GREEN_DARK = '#166534';
const TEXT_DARK = '#0F172A';
const MUTED = '#475569';
const SUBTLE_BG = '#F1F5F9';
const TOTALES_BG = '#E2E8F0';
const RED = '#B91C1C';
const AMBER = '#B45309';
const AMBER_SOFT = '#FFEDD5';
const BLUE = '#1D4ED8';
const BLUE_SOFT = '#DBEAFE';
const RED_SOFT = '#FEE2E2';
const GRIS_BLOQUEADO = '#94A3B8';
/// Fondo de las filas de ADICIONAL dentro de la tabla de items.
const ADIC_BG = '#ECFDF5';
const ADIC_BADGE_BG = '#DCFCE7';

/**
 * Índices de columna de la tabla de ITEMS, por nombre.
 *
 * Antes estaban escritos a mano en cinco sitios distintos —los `set()` de
 * cada fila, el mapa de sumas, el `merge` de la fila de totales y las
 * fórmulas `=SUM()`—. Mover una columna obligaba a corregir los cinco a la
 * vez, y un descuadre NO da error: pinta el número en la columna de al lado
 * y el documento cuadra por casualidad.
 *
 * Con nombres, mover una columna es reordenar esta lista.
 */
const COL = {
	NUM: 0,
	CLIENTE: 1,
	LIQ: 2,
	TERCERO: 3,
	RECORRIDO: 4,
	FECHAS: 5,
	V_UNIDAD: 6,
	CANT: 7,
	ADMON_PCT: 8,
	ADMON: 9,
	TOTAL: 10,
	V_LIQUIDAR: 11,
	PLANILLA: 12,
	ING_EXTRA_GLOBAL: 13,
	ING_EXTRAS_AVAL: 14,
	ING_COTRANSMEQ: 15,
	FACTURA: 16,
	APLICA_IMP: 17
} as const;

export const TOTAL_COLS = 18;

/**
 * Columnas de ACCIÓN, para que el engine les cuelgue el checkbox de
 * validación de datos. Se exportan los índices y no el mapa entero: fuera
 * del builder nadie tiene por qué saber dónde cae el resto.
 */
export const COL_APLICA_IMP: number = COL.APLICA_IMP;

/// Filas anotables que se abren bajo el bloque estructurado de cada hoja.
export const FILAS_ANOTABLES = 40;

/**
 * No hay columna PLACA: la hoja ENTERA es una placa, y repetirla en cada
 * fila gastaba 110px para decir lo que ya dice la pestaña.
 *
 * Tampoco RECARGOS, que no se usaba en este documento.
 *
 * La última columna es una acción: qué items entran en la base imponible.
 *
 * TAMPOCO HAY «EXCLUIR», y no es un olvido. Era una casilla SÍ/NO que
 * prometía un interruptor reversible, y no lo era: `detallePeriodo` filtra
 * los items con `deleted_at`, así que la fila marcada no se quedaba tachada
 * —como daba por hecho el código de aquí— sino que DESAPARECÍA, llevándose
 * consigo la casilla para deshacerlo. La columna solo podía mostrar «NO»
 * eternamente. Quitar un item vive ahora en el modal del carril, que además
 * lista los quitados y permite devolverlos.
 */
const COLUMN_HEADERS = [
	'#', 'CLIENTE', '# LIQ', 'NOMBRE 3°', 'RECORRIDO', 'FECHAS',
	'V/UNIDAD', 'CANT', 'ADMON %', 'ADMON $', 'TOTAL', 'V/LIQUIDAR',
	'# PLANILLA', 'ING. EXTRA GLOBAL', 'ING. EXTRAS AVAL', 'ING. COTRANSMEQ',
	'# FACTURA', 'APLICA IMP.'
];

const COLUMN_WIDTHS = [
	28, 250, 100, 230, 250, 150, 91, 82, 82, 91, 98, 98, 140, 150, 150,
	150, 81, 92
];

/** Columnas cuyo pie es una fórmula `=SUM()` sobre las filas de items. */
const COLS_SUMADAS = [
	COL.ADMON, COL.TOTAL, COL.V_LIQUIDAR,
	COL.ING_EXTRA_GLOBAL, COL.ING_EXTRAS_AVAL, COL.ING_COTRANSMEQ
];

/** Columnas del pie que solo llevan estilo, sin valor ni fórmula. */
const COLS_PIE_VACIAS = [COL.PLANILLA, COL.FACTURA, COL.APLICA_IMP];

/** Orden canónico de los impuestos. Coincide con el del backend. */
const ORDEN_IMPUESTOS: Record<string, number> = {
	RETENCION_ICA: 1,
	AVISOS_TABLEROS: 2,
	SOBRETASA_BOMBERIL: 3,
	RETENCION_FUENTE: 4
};

// ─── Tipos de entrada ─────────────────────────────────────────────────

/** Item del pivote, ya resuelto. */
export interface ItemCierre {
	pivoteId: string;
	liquidacion_servicio_consecutivo: string;
	cliente_nombre: string;
	placa: string;
	tercero_nombre: string;
	recorrido: string;
	fechas: string;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	total_facturado: number;
	valor_liquidar: number;
	numero_planilla: string;
	ingreso_extra_global: number;
	ingresos_extra_aval: number;
	numero_factura: string;
	/**
	 * Si el item entra en la base imponible de RETENCION ICA, AVISOS y
	 * BOMBERIL.
	 *
	 * ⚠️ RETENCION FUENTE NO lo mira: grava sobre TODOS los items, marcados o
	 * no. No es una incoherencia, es cómo funciona esa retención.
	 */
	aplica_impuestos: boolean;
	/** Soft-deleted del pivote. Se sigue mostrando, tachado y sin sumar. */
	excluido: boolean;
}

/** Fila de `liquidacion_tercero_final_adicional`. */
export interface AdicionalCierre {
	id: string;
	cliente: string;
	placa: string;
	tercero_nombre: string | null;
	recorrido: string | null;
	fechas: string | null;
	valor_unitario: number;
	cantidad: number;
	porcentaje_admin: number;
	valor_admin: number;
	valor_liquidar: number;
	aplica_impuestos: boolean;
	version: number;
}

export interface CopropietarioCierre {
	id: string;
	nombre: string;
	identificacion: string | null;
	porcentaje: number;
}

export interface CierreFinalCompleto {
	hoja: CierreHoja;
	items: ItemCierre[];
	adicionales: AdicionalCierre[];
	conceptos: ConceptoDescuento[];
	copropietarios: CopropietarioCierre[];
	/** Map `0::conductorId` → es propietario. Ver nota en `claveConductor`. */
	propietarios: Record<string, boolean>;
}

export interface CierreFinalSheetInput {
	unitId: string;
	sheetId: string;
	sheetName: string;
	cierre: CierreFinalCompleto;
	/// Notas libres de esta hoja (zona bajo el bloque estructurado).
	anotaciones?: CeldaDeCapa[];
}

/** Filas ancla por sección, para localizar zonas sin volver a construir. */
export interface AnclasHoja {
	headerItems: number;
	totalesItems: number;
	/**
	 * Filas 0-based que ocupa la tabla de la liquidación —items Y adicionales,
	 * que van al final de la misma tabla—, para colgarles el checkbox de la
	 * columna de acción (APLICA IMP.).
	 *
	 * Va explícito y no se deduce de `headerItems + 1 … totalesItems − 1`:
	 * esa resta es la geometría de la hoja escrita por segunda vez, y basta
	 * con que un día se cuele una fila entre la cabecera y el primer item
	 * para que el checkbox aparezca donde no debe.
	 *
	 * `null` en un cierre sin items.
	 */
	rangoItems: { desde: number; hasta: number } | null;
	/// Primera fila de adicional dentro de la tabla de items, o `null` si el
	/// cierre no tiene ninguno. Ya no es una sección aparte.
	adicionales: number | null;
	descuentos: number;
	gastos: number;
	anticipos: number;
	impuestos: number;
	copropietarios: number | null;
	totalDescuentos: number;
	totalPagar: number;
	ultimaFila: number;
}

export interface CierreFinalSheetResult {
	sheet: any;
	bindings: BindingSeed[];
	anclas: AnclasHoja;
}

/**
 * Clave del map de propietarios.
 *
 * `conceptos.service.ts` la construye como `0::${conductorId}` y consulta
 * con ella. El canvas antiguo guardaba `propietarios[conductorId]` a secas,
 * así que la exclusión de propietarios en DOTACION y EXAMEN_MEDICO **nunca
 * llegaba a aplicarse**. Se centraliza aquí para que no vuelva a divergir.
 */
export function claveConductor(conductorId: string | null | undefined): string {
	return `0::${conductorId || 'sin-conductor'}`;
}

function n(v: any): number {
	const x = Number(v);
	return isNaN(x) ? 0 : x;
}

function colLetter(col: number): string {
	let letter = '';
	let k = col;
	while (k >= 0) {
		letter = String.fromCharCode(65 + (k % 26)) + letter;
		k = Math.floor(k / 26) - 1;
	}
	return letter;
}

/**
 * Borde fino gris, el de toda la rejilla. A nivel de módulo porque
 * `estiloAplicaImpuestos` lo necesita fuera del builder.
 */
const bordeFino = (): IBorderStyleData => ({
	s: BorderStyleTypes.THIN,
	cl: { rgb: '#CBD5E1' }
});
const bordesCompletos = (): IBorderData => ({
	t: bordeFino(), r: bordeFino(), b: bordeFino(), l: bordeFino()
});

/**
 * Estilo de la celda APLICA IMP.: el semáforo verde/rojo.
 *
 * EXPORTADO Y A NIVEL DE MÓDULO A PROPÓSITO. El color no es decoración: es
 * lo que se lee de un vistazo para saber qué items entran en la base
 * imponible, y hay DOS sitios que lo pintan:
 *
 *   · este builder, al montar la hoja;
 *   · `pintarItems` en el canvas, cada vez que alguien marca o desmarca el
 *     checkbox (propio o de otro usuario).
 *
 * El segundo solo escribía el VALOR, así que la celda se quedaba con el
 * color con el que nació la hoja: desmarcar la ponía en «NO» sobre fondo
 * VERDE, y al volver a marcarla se quedaba en «SÍ» sobre fondo ROJO hasta
 * recargar. Un semáforo que miente es peor que no tenerlo, porque quien
 * revisa la hoja se fía del color y no del texto.
 *
 * Con el estilo aquí, los dos caminos pintan por fuerza lo mismo.
 */
export function estiloAplicaImpuestos(aplica: boolean): IStyleData {
	return {
		fs: 10,
		bl: 1,
		ht: HorizontalAlign.CENTER,
		bd: bordesCompletos(),
		cl: { rgb: aplica ? GREEN_DARK : RED },
		bg: { rgb: aplica ? '#ECFDF5' : RED_SOFT }
	} as any;
}

// ─── Builder de UNA hoja ──────────────────────────────────────────────

export function buildCierreFinalSheet(
	input: CierreFinalSheetInput
): CierreFinalSheetResult {
	const { unitId, sheetId, sheetName, cierre, anotaciones } = input;
	const { hoja, items, adicionales, conceptos, copropietarios, propietarios } = cierre;

	// Una hoja de un cierre que ya no es BORRADOR se muestra completa pero
	// no se puede tocar.
	const editable = esEditable(hoja.estado);

	// TODO el estado de la hoja es local. Ver el aviso sobre `columnData`
	// en el docblock del módulo.
	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: any[] = [];
	const rowData: Record<number, { h?: number }> = {};
	const colData: Record<number, { w?: number }> = {};
	COLUMN_WIDTHS.forEach((w, i) => (colData[i] = { w }));

	const bindings: BindingSeed[] = [];

	/** Registra una celda editable. En hoja bloqueada no registra nada. */
	const bind = (
		r: number,
		c: number,
		binding: Omit<CierreBinding, 'cierreId'>
	) => {
		if (!editable) return;
		bindings.push({ r, c, binding: { ...binding, cierreId: hoja.id } });
	};

	/** Registra una celda derivada: no editable, pero sí pintable en remoto. */
	const bindDerivada = (
		r: number,
		c: number,
		binding: Omit<CierreBinding, 'cierreId' | 'derived'>
	) => {
		bindings.push({ r, c, binding: { ...binding, cierreId: hoja.id, derived: true } });
	};

	// ─── Estilos ────────────────────────────────────────────────────
	const thinBorder = (): IBorderStyleData => ({
		s: BorderStyleTypes.THIN,
		cl: { rgb: '#CBD5E1' }
	});
	const allBorders = (): IBorderData => ({
		t: thinBorder(), r: thinBorder(), b: thinBorder(), l: thinBorder()
	});

	const headerStyle: IStyleData = {
		fs: 10, bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: GREEN },
		ht: HorizontalAlign.CENTER, bd: allBorders()
	};
	const cellBase: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: allBorders() };
	const cellZebra: IStyleData = { ...cellBase, bg: { rgb: '#F8FAFC' } };
	const money: IStyleData = { ...cellBase, n: { pattern: '"$"#,##0' } } as any;
	const moneyZebra: IStyleData = { ...cellZebra, n: { pattern: '"$"#,##0' } } as any;
	const admon: IStyleData = { ...cellBase, cl: { rgb: RED }, n: { pattern: '"$"#,##0' } } as any;
	const admonZebra: IStyleData = { ...cellZebra, cl: { rgb: RED }, n: { pattern: '"$"#,##0' } } as any;
	// Celdas de acción (SÍ/NO). El color hace de semáforo: verde = entra,
	// rojo = queda fuera. Centradas y en negrita para que se lean como un
	// control y no como un dato más.
	//
	// La definición vive FUERA del builder porque el canvas la necesita para
	// repintar el semáforo al alternar el checkbox. Ver
	// `estiloAplicaImpuestos`.
	const accionSi = estiloAplicaImpuestos(true);
	const accionNo = estiloAplicaImpuestos(false);
	const vliq: IStyleData = { ...cellBase, bl: 1, cl: { rgb: GREEN_DARK }, n: { pattern: '"$"#,##0' } } as any;
	const vliqZebra: IStyleData = { ...cellZebra, bl: 1, cl: { rgb: GREEN_DARK }, n: { pattern: '"$"#,##0' } } as any;
	const totalFact: IStyleData = { ...cellBase, bl: 1, n: { pattern: '"$"#,##0' } } as any;
	const totalFactZebra: IStyleData = { ...cellZebra, bl: 1, n: { pattern: '"$"#,##0' } } as any;
	const cant: IStyleData = { ...cellBase, ht: HorizontalAlign.RIGHT };
	const cantZebra: IStyleData = { ...cellZebra, ht: HorizontalAlign.RIGHT };

	// ── Filas de ADICIONAL ──
	// Comparten tabla con los items para que un solo `=SUM()` los totalice,
	// pero NO son items: viven en otra tabla de la base y con otro contrato de
	// concurrencia. Sin marcarlas, la fila pasaría por una liquidación de
	// servicio más. De ahí el fondo verde claro en toda la fila y el
	// distintivo de la columna CLIENTE. No se usa la zebra: alternar el fondo
	// dentro del bloque de adicionales lo volvería a partir en dos.
	const adicBase: IStyleData = { ...cellBase, bg: { rgb: ADIC_BG } };
	const adicBadge: IStyleData = {
		...adicBase, bl: 1, cl: { rgb: GREEN_DARK }, bg: { rgb: ADIC_BADGE_BG }
	};
	const adicMoney: IStyleData = { ...adicBase, n: { pattern: '"$"#,##0' } } as any;
	const adicCant: IStyleData = { ...adicBase, ht: HorizontalAlign.RIGHT };
	const adicAdmon: IStyleData = {
		...adicBase, cl: { rgb: RED }, n: { pattern: '"$"#,##0' }
	} as any;
	const adicTotal: IStyleData = { ...adicBase, bl: 1, n: { pattern: '"$"#,##0' } } as any;
	const adicVliq: IStyleData = {
		...adicBase, bl: 1, cl: { rgb: GREEN_DARK }, n: { pattern: '"$"#,##0' }
	} as any;
	// Los ingresos de una fila de adicional van en NEGATIVO. En rojo, como
	// ADMON $, porque es lo que la hoja resta y no lo que suma.
	const adicResta: IStyleData = {
		...adicBase, cl: { rgb: RED }, n: { pattern: '"$"#,##0' }
	} as any;
	const adicRestaFuerte: IStyleData = { ...adicResta, bl: 1 } as any;
	const tfoot: IStyleData = {
		fs: 10, bl: 1, cl: { rgb: TEXT_DARK }, bg: { rgb: TOTALES_BG },
		bd: allBorders(), n: { pattern: '"$"#,##0' }
	} as any;

	const tituloHoja: IStyleData = {
		fs: 13, bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: GREEN },
		ht: HorizontalAlign.LEFT, bd: allBorders()
	};
	const avisoBloqueo: IStyleData = {
		fs: 10, bl: 1, it: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: GRIS_BLOQUEADO },
		ht: HorizontalAlign.CENTER, bd: allBorders()
	};

	const banda = (bg: string): IStyleData => ({
		fs: 11, bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: bg },
		ht: HorizontalAlign.CENTER, bd: allBorders()
	});
	const subHeader = (fg: string, bg: string): IStyleData => ({
		fs: 10, bl: 1, cl: { rgb: fg }, bg: { rgb: bg },
		bd: allBorders(), ht: HorizontalAlign.LEFT
	});

	const nominaHeaderBand = banda(GREEN_DARK);
	const gastosBand = banda(AMBER);
	const anticiposBand = banda(BLUE);
	const impuestosBand = banda(RED);
	const coproBand = banda('#7C3AED');

	const nominaSubHeader = subHeader(GREEN_DARK, SUBTLE_BG);
	const gastosSubHeader = subHeader(AMBER, AMBER_SOFT);
	const anticiposSubHeader = subHeader(BLUE, BLUE_SOFT);
	const impuestosSubHeader = subHeader(RED, RED_SOFT);
	const coproSubHeader = subHeader('#7C3AED', '#EDE9FE');

	const conductorHeader: IStyleData = {
		fs: 10, bl: 1, cl: { rgb: GREEN }, bg: { rgb: SUBTLE_BG }, bd: allBorders()
	};
	const nominaCellBase: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: allBorders() };
	const nominaCatStyle: IStyleData = {
		fs: 9, it: 1, bl: 1, cl: { rgb: GREEN }, bg: { rgb: SUBTLE_BG }, bd: allBorders()
	};
	const nominaTfStyle: IStyleData = {
		fs: 10, bl: 1, cl: { rgb: TEXT_DARK }, bg: { rgb: TOTALES_BG },
		bd: allBorders(), n: { pattern: '"$"#,##0' }
	} as any;
	const secTfStyle: IStyleData = {
		fs: 10, bl: 1, cl: { rgb: TEXT_DARK }, bg: { rgb: SUBTLE_BG },
		bd: allBorders(), n: { pattern: '"$"#,##0' }
	} as any;
	const redTotalLabel: IStyleData = {
		fs: 12, bl: 1, cl: { rgb: RED }, bg: { rgb: RED_SOFT },
		bd: allBorders(), ht: HorizontalAlign.LEFT
	};
	const redTotalValue: IStyleData = {
		fs: 14, bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: RED },
		bd: allBorders(), n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT
	} as any;
	const greenTotalLabel: IStyleData = {
		fs: 12, bl: 1, cl: { rgb: GREEN_DARK }, bg: { rgb: '#DCFCE7' },
		bd: allBorders(), ht: HorizontalAlign.LEFT
	};
	const greenTotalValue: IStyleData = {
		fs: 14, bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: GREEN_DARK },
		bd: allBorders(), n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT
	} as any;

	// ─── Escritura ──────────────────────────────────────────────────
	const set = (
		r: number, col: number, v: string | number,
		style?: IStyleData
	) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][col] = {
			v,
			t: typeof v === 'number' ? CellValueType.NUMBER : CellValueType.STRING,
			...(style ? { s: style } : {})
		};
	};

	/**
	 * Celda con fórmula viva. `v` cacheado para que la primera pintura no
	 * muestre 0 mientras el motor evalúa.
	 */
	const setFormula = (
		r: number, col: number, formula: string, cached: number, style: IStyleData
	) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][col] = {
			v: cached, t: CellValueType.NUMBER, f: formula, s: style
		};
	};

	/**
	 * Celda de PORCENTAJE. El valor viaja como NÚMERO (8.33) y el «%» es solo
	 * un patrón de formato.
	 *
	 * Antes se escribía la cadena `"8.3%"`: la fórmula del TOTAL no podía
	 * calcular nada contra un texto, y el adapter —que lee el `v` crudo de la
	 * celda— emitía esa misma cadena al servidor en el campo `porcentaje`.
	 *
	 * A diferencia de `setFormula` no se marca `locked`: en cierres la
	 * columna C de prestaciones y seguridad social SÍ es editable.
	 */
	const setPorcentaje = (r: number, col: number, pct: number, style: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][col] = {
			v: Number(pct) || 0,
			t: CellValueType.NUMBER,
			s: { ...style, n: { pattern: '0.00"%"' } }
		};
	};

	const soloEstilo = (r: number, desde: number, hasta: number, style: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		for (let c = desde; c <= hasta; c++) cellData[r][c] = { s: style };
	};

	const merge = (r: number, desde: number, hasta: number) => {
		mergeData.push({ startRow: r, endRow: r, startColumn: desde, endColumn: hasta, rangeType: 0 });
	};

	let row = 0;
	/// Fila (1-based) del totalizador de cada sección de descuentos: nómina por
	/// conductor, gastos de vehículo, anticipos e impuestos. TOTAL DESCUENTOS es
	/// la suma VIVA de todas ellas, así que necesita saber dónde acabaron.
	const filasTotalizadoras: number[] = [];

	// ═══ TÍTULO DE LA HOJA ═══════════════════════════════════════════
	// El nombre de pestaña va truncado a 31 caracteres, así que el nombre
	// completo del tercero solo se puede leer aquí.
	const tituloRow = row;
	set(row, 0,
		`${hoja.placa}  ·  ${hoja.tercero_nombre || 'SIN TERCERO'}  ·  ${hoja.consecutivo}`,
		tituloHoja);
	merge(row, 0, TOTAL_COLS - 1);
	soloEstilo(row, 1, TOTAL_COLS - 1, tituloHoja);
	cellData[row][0] = {
		v: `${hoja.placa}  ·  ${hoja.tercero_nombre || 'SIN TERCERO'}  ·  ${hoja.consecutivo}`,
		t: CellValueType.STRING,
		s: tituloHoja
	};
	rowData[row] = { h: 30 };
	row++;

	if (!editable) {
		set(row, 0, `HOJA EN ESTADO ${hoja.estado} — SOLO LECTURA`, avisoBloqueo);
		merge(row, 0, TOTAL_COLS - 1);
		soloEstilo(row, 1, TOTAL_COLS - 1, avisoBloqueo);
		cellData[row][0] = {
			v: `HOJA EN ESTADO ${hoja.estado} — SOLO LECTURA`,
			t: CellValueType.STRING,
			s: avisoBloqueo
		};
		rowData[row] = { h: 22 };
		row++;
	}

	// ═══ 1. ITEMS ════════════════════════════════════════════════════
	const headerItemsRow = row;
	COLUMN_HEADERS.forEach((lbl, i) => {
		set(row, i, lbl, i === COL.CANT ? { ...headerStyle, ht: HorizontalAlign.RIGHT } : headerStyle);
	});
	rowData[row] = { h: 28 };
	row++;

	const sums: Record<number, number> = Object.fromEntries(
		COLS_SUMADAS.map((c) => [c, 0])
	);
	const firstItemRow = row;
	/// Fila → id del item que la ocupa. Lo que se anote AL LADO de un item se
	/// ancla a ese id, no a una fila: si mañana entra otro item por encima, la
	/// nota sigue junto al suyo en vez de quedarse a la altura del vecino.
	const itemPorFila = new Map<number, string>();

	items.forEach((it, idx) => {
		const z = idx % 2 === 1;
		if (it.pivoteId) itemPorFila.set(row, String(it.pivoteId));
		// El tachado se conserva por si algún día `detallePeriodo` empieza a
		// mandar los items quitados; hoy no llegan nunca, así que en la
		// práctica esta rama no se toma.
		const text = it.excluido
			? { ...(z ? cellZebra : cellBase), st: { s: 1 } }
			: z ? cellZebra : cellBase;
		const ingresoTransmeralda = n(it.ingreso_extra_global) - n(it.ingresos_extra_aval);

		set(row, COL.NUM, idx + 1, z ? cantZebra : cant);
		set(row, COL.CLIENTE, it.cliente_nombre, text);
		set(row, COL.LIQ, it.liquidacion_servicio_consecutivo, text);
		set(row, COL.TERCERO, it.tercero_nombre, text);
		set(row, COL.RECORRIDO, it.recorrido, text);
		set(row, COL.FECHAS, it.fechas, text);
		set(row, COL.V_UNIDAD, n(it.valor_unitario), z ? moneyZebra : money);
		set(row, COL.CANT, n(it.cantidad) || 1, z ? cantZebra : cant);
		// ADMON % como NÚMERO con patrón, no como la cadena `"10%"`.
		//
		// Escrita como texto, Univer la marcaba con el aviso de «número
		// almacenado como texto» y, sobre todo, la celda no tenía binding: al
		// editarla el adapter no encontraba a qué entidad pertenecía y la
		// mandaba por el camino de las ANOTACIONES de la zona libre, que
		// calcula su ancla como filas por DEBAJO del final de los items. Para
		// una fila que está por encima el offset sale negativo y el servidor
		// respondía `offset_fila debe ser un entero >= 0`. El valor se quedaba
		// en pantalla sin guardarse.
		//
		// Es el mismo arreglo que ya se hizo en la columna C de prestaciones y
		// seguridad social; esta se quedó atrás.
		setPorcentaje(row, COL.ADMON_PCT, n(it.porcentaje_admin), text);
		bind(row, COL.ADMON_PCT, {
			entityType: 'item', entityId: it.pivoteId,
			field: 'porcentaje_admin', section: 'items'
		});
		set(row, COL.ADMON, n(it.valor_admin), z ? admonZebra : admon);
		set(row, COL.TOTAL, n(it.total_facturado), z ? totalFactZebra : totalFact);
		set(row, COL.V_LIQUIDAR, n(it.valor_liquidar), z ? vliqZebra : vliq);
		// Derivadas del porcentaje: no se editan, pero sí se repintan cuando
		// el servidor devuelve la fila —propia o de otro usuario del room—.
		bindDerivada(row, COL.ADMON, {
			entityType: 'item', entityId: it.pivoteId,
			field: 'valor_admin', section: 'items'
		});
		bindDerivada(row, COL.V_LIQUIDAR, {
			entityType: 'item', entityId: it.pivoteId,
			field: 'valor_liquidar', section: 'items'
		});
		set(row, COL.PLANILLA, it.numero_planilla, text);
		set(row, COL.ING_EXTRA_GLOBAL, n(it.ingreso_extra_global), z ? moneyZebra : money);
		set(row, COL.ING_EXTRAS_AVAL, n(it.ingresos_extra_aval), z ? moneyZebra : money);
		set(row, COL.ING_COTRANSMEQ, ingresoTransmeralda, z ? totalFactZebra : totalFact);
		set(row, COL.FACTURA, it.numero_factura, text);

		// ── Columna de acción ──
		// El VALOR sigue siendo la cadena SÍ/NO aunque el engine le cuelgue
		// encima un checkbox de validación de datos: `requireCheckbox('SÍ',
		// 'NO')` solo cambia cómo se PINTA la celda, no lo que guarda. Así el
		// binding, el adapter, los permisos y el backend no se enteran, y una
		// hoja montada antes del checkbox se lee igual. Ver `checkbox-si-no.ts`.
		set(row, COL.APLICA_IMP, it.aplica_impuestos ? 'SÍ' : 'NO',
			it.aplica_impuestos ? accionSi : accionNo);
		bind(row, COL.APLICA_IMP, {
			entityType: 'item', entityId: it.pivoteId,
			field: 'aplica_impuestos', section: 'items'
		});

		// Un item excluido no cuenta en los totales del pivote.
		if (!it.excluido) {
			sums[COL.ADMON] += n(it.valor_admin);
			sums[COL.TOTAL] += n(it.total_facturado);
			sums[COL.V_LIQUIDAR] += n(it.valor_liquidar);
			sums[COL.ING_EXTRA_GLOBAL] += n(it.ingreso_extra_global);
			sums[COL.ING_EXTRAS_AVAL] += n(it.ingresos_extra_aval);
			sums[COL.ING_COTRANSMEQ] += ingresoTransmeralda;
		}
		row++;
	});

	// ═══ 1b. ADICIONALES, EN LA MISMA TABLA ══════════════════════════
	// Eran una tabla aparte: banda propia, cabecera propia de 7 columnas —que
	// además no cuadraban con las de arriba— y su propio TOTAL ADICIONALES.
	// Eso obligaba a totalizar en dos sitios y a sumarlos a mano en TOTAL A
	// PAGAR, donde acababan como un número muerto: teclear una cantidad de un
	// adicional no movía ninguna cifra de la hoja hasta recargar.
	//
	// Ahora van al FINAL de la tabla de items y con SU MISMO juego de
	// columnas, así que el `=SUM()` del pie los recoge y la cascada llega sola
	// hasta TOTAL A PAGAR. Un solo total, y vivo.
	//
	// Siguen siendo otra cosa —otra tabla de la base, con compare-and-swap
	// propio— y por eso la fila se lee distinta. Ver `adicBase`/`adicBadge`.
	let anclaAdicionales: number | null = adicionales.length > 0 ? row : null;
	let totalAdicionales = 0;

	adicionales.forEach((a, idx) => {
		itemPorFila.set(row, String(a.id));
		const bruto = n(a.valor_unitario) * (n(a.cantidad) || 1);

		// Primero el relleno de las columnas que un adicional no usa: va antes
		// que los `set` porque `soloEstilo` PISA la celda entera.
		soloEstilo(row, COL.LIQ, COL.LIQ, adicBase);
		soloEstilo(row, COL.PLANILLA, COL.FACTURA, adicBase);

		// `T1`, `T2`… y no la numeración corrida de los items: es la misma marca
		// que usa el PDF (`filaDeAdicional` en `preview/datos/cierres.doc.ts`),
		// que ya los concatenaba en esta misma tabla. Numerarlos distinto en
		// cada vista obligaría a traducir mentalmente al cotejar las dos.
		set(row, COL.NUM, `T${idx + 1}`, adicCant);
		// EL DISTINTIVO VA EN EL TEXTO, no solo en el color: la hoja se
		// exporta y se imprime, y un fondo verde claro no sobrevive a eso tan
		// bien como una palabra. Por lo mismo esta celda NO lleva binding
		// aunque `cliente` sea editable en la base: lo que se tecleara aquí se
		// guardaría con el distintivo pegado al nombre del cliente.
		set(row, COL.CLIENTE, `ADICIONAL · ${a.cliente || 'COTRANSMEQ'}`, adicBadge);
		set(row, COL.TERCERO, a.tercero_nombre || '', adicBase);
		set(row, COL.RECORRIDO, a.recorrido || '', adicBase);
		set(row, COL.FECHAS, a.fechas || '', adicBase);

		set(row, COL.V_UNIDAD, n(a.valor_unitario), adicMoney);
		bind(row, COL.V_UNIDAD, {
			entityType: 'adicional', entityId: a.id,
			field: 'valor_unitario', section: 'adicionales'
		});

		set(row, COL.CANT, n(a.cantidad) || 1, adicCant);
		bind(row, COL.CANT, {
			entityType: 'adicional', entityId: a.id,
			field: 'cantidad', section: 'adicionales'
		});

		setPorcentaje(row, COL.ADMON_PCT, n(a.porcentaje_admin), adicBase);
		bind(row, COL.ADMON_PCT, {
			entityType: 'adicional', entityId: a.id,
			field: 'porcentaje_admin', section: 'adicionales'
		});

		// ADMON $ y V/LIQUIDAR los deriva el SERVIDOR (`derivarAdicional`). Se
		// pintan como literales y se marcan derivadas para que el patch de
		// vuelta pueda repintarlas.
		set(row, COL.ADMON, n(a.valor_admin), adicAdmon);
		bindDerivada(row, COL.ADMON, {
			entityType: 'adicional', entityId: a.id,
			field: 'valor_admin', section: 'adicionales'
		});

		// TOTAL no es un campo del adicional: es V/UNIDAD × CANT. Como fórmula
		// se mueve sola al teclear cualquiera de las dos, sin esperar al
		// servidor.
		setFormula(
			row, COL.TOTAL,
			`=${colLetter(COL.V_UNIDAD)}${row + 1}*${colLetter(COL.CANT)}${row + 1}`,
			bruto,
			adicTotal
		);

		set(row, COL.V_LIQUIDAR, n(a.valor_liquidar), adicVliq);
		bindDerivada(row, COL.V_LIQUIDAR, {
			entityType: 'adicional', entityId: a.id,
			field: 'valor_liquidar', section: 'adicionales'
		});

		// ── Los ingresos de un adicional van en NEGATIVO ──
		// Un adicional no se lo factura nadie: no viene de una liquidación de
		// servicio, así que no trae ingreso que repartir. Es dinero que la
		// empresa pone de lo suyo para pagárselo al tercero, y por eso entra en
		// la hoja RESTANDO.
		//
		// Va en las DOS columnas y no solo en ING. COTRANSMEQ. Esa columna se
		// lee como `ING. EXTRA GLOBAL − ING. EXTRAS AVAL` —así la calculan las
		// filas de item, arriba—, y dejar EXTRA GLOBAL vacía rompía la relación
		// justo en el pie: TOTALES mostraba una resta que no salía de sus
		// propias columnas. Con el negativo en las dos, y AVAL en 0, la
		// igualdad se cumple fila a fila y en el total.
		//
		// FÓRMULAS y no literales: V/LIQUIDAR lo deriva el SERVIDOR y se
		// repinta al teclear V/UNIDAD, CANT o ADMON %. Escritas como número,
		// estas celdas se quedarían con la cifra de la carga hasta recargar la
		// hoja, que es la misma trampa que ya tenía TOTAL antes de pasarlo a
		// fórmula.
		const refVliq = `${colLetter(COL.V_LIQUIDAR)}${row + 1}`;
		const ingresoAdicional = -n(a.valor_liquidar);
		setFormula(row, COL.ING_EXTRA_GLOBAL, `=-${refVliq}`, ingresoAdicional, adicResta);
		set(row, COL.ING_EXTRAS_AVAL, 0, adicMoney);
		setFormula(
			row, COL.ING_COTRANSMEQ,
			`=${colLetter(COL.ING_EXTRA_GLOBAL)}${row + 1}-${colLetter(COL.ING_EXTRAS_AVAL)}${row + 1}`,
			ingresoAdicional,
			adicRestaFuerte
		);

		set(row, COL.APLICA_IMP, a.aplica_impuestos ? 'SÍ' : 'NO',
			a.aplica_impuestos ? accionSi : accionNo);
		bind(row, COL.APLICA_IMP, {
			entityType: 'adicional', entityId: a.id,
			field: 'aplica_impuestos', section: 'adicionales'
		});

		sums[COL.ADMON] += n(a.valor_admin);
		sums[COL.TOTAL] += bruto;
		sums[COL.V_LIQUIDAR] += n(a.valor_liquidar);
		sums[COL.ING_EXTRA_GLOBAL] += ingresoAdicional;
		sums[COL.ING_COTRANSMEQ] += ingresoAdicional;
		totalAdicionales += n(a.valor_liquidar);
		row++;
	});

	/// Última fila de la tabla, items y adicionales incluidos. Es lo que
	/// totaliza el pie y lo que abarca el checkbox de APLICA IMP.
	const ultimaFilaTabla = row - 1;
	const hayFilas = ultimaFilaTabla >= firstItemRow;

	// Fila TOTALES de items: SUM vivas, no valores estáticos.
	const totalesItemsRow = row;
	set(row, COL.NUM, 'TOTALES', tfoot);
	merge(row, COL.NUM, COL.ADMON_PCT);
	soloEstilo(row, COL.NUM + 1, COL.ADMON_PCT, tfoot);
	// `SUM` normal. Era un `SUMIF` sobre la columna EXCLUIR para dejar fuera
	// los items tachados, pero esos items nunca llegan a la hoja —el detalle
	// filtra los que tienen `deleted_at`—, así que el condicional filtraba
	// sobre una columna donde todas las filas decían "NO". Al retirar la
	// columna, el `SUMIF` se quedaba además sin rango al que apuntar.
	for (const col of COLS_SUMADAS) {
		const L = colLetter(col);
		// El rango llega hasta `ultimaFilaTabla` y no hasta el último item: los
		// adicionales van dentro de esta misma tabla y este pie es su único
		// totalizador.
		const formula = hayFilas
			? `=SUM(${L}${firstItemRow + 1}:${L}${ultimaFilaTabla + 1})`
			: '=0';
		setFormula(row, col, formula, sums[col], tfoot);
	}
	if (!cellData[row]) cellData[row] = {};
	for (const col of COLS_PIE_VACIAS) cellData[row][col] = { s: tfoot };
	rowData[row] = { h: 24 };
	row++;

	// ═══ 2. DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO ════════════════
	row++; // separación
	const anclaDescuentos = row;

	set(row, 0, 'DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO', nominaHeaderBand);
	merge(row, 0, 4);
	soloEstilo(row, 1, 4, nominaHeaderBand);
	cellData[row][0] = {
		v: 'DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO',
		t: CellValueType.STRING, s: nominaHeaderBand
	};
	rowData[row] = { h: 22 };
	row++;

	const subHeaderConceptos = (r: number) => {
		set(r, 0, 'CONCEPTO', nominaSubHeader);
		merge(r, 0, 1);
		if (!cellData[r]) cellData[r] = {};
		cellData[r][1] = { s: nominaSubHeader };
		set(r, 2, 'DIAS / %', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
		set(r, 3, 'VALOR', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
		set(r, 4, 'TOTAL', { ...nominaSubHeader, ht: HorizontalAlign.RIGHT });
		rowData[r] = { h: 22 };
	};

	/**
	 * Fila de concepto laboral. A:B = nombre, C = días/%, D = valor,
	 * E = TOTAL.
	 *
	 * Las tres secciones son fórmula viva: en salarios `=C*D`, y en
	 * prestaciones / seguridad social `=C/100*D` sobre una BASE que a su vez
	 * es fórmula sobre las filas de salario. Antes D y E se pintaban con el
	 * número del servidor: al cambiar los días de SALARIO, todo lo que cuelga
	 * de la base se quedaba con el importe viejo hasta que volvía la
	 * respuesta —y en $0 si el servidor nunca lo había calculado.
	 */
	const filaConcepto = (
		r: number,
		c: ConceptoDescuento,
		nombre: string,
		diasOPct: string | number,
		valor: number,
		total: number,
		style: IStyleData,
		section: 'salarios' | 'prest' | 'ss',
		boldTotal = false,
		/// Fórmula de la columna VALOR (la BASE). Solo en prest/ss.
		baseFormula?: string,
		/// Las filas de CATEGORÍA no ligan su % a ningún concepto: es un
		/// agregado, no el porcentaje del primer hijo.
		bindC = true
	) => {
		set(r, 0, nombre, style);
		merge(r, 0, 1);
		if (!cellData[r]) cellData[r] = {};
		cellData[r][1] = { s: style };

		const fieldC = section === 'salarios' ? 'dias' : 'porcentaje';
		if (section === 'salarios') {
			set(r, 2, diasOPct, { ...style, ht: HorizontalAlign.RIGHT });
		} else {
			setPorcentaje(r, 2, Number(diasOPct) || 0, { ...style, ht: HorizontalAlign.RIGHT });
		}
		if (bindC) bind(r, 2, { entityType: 'concepto', entityId: c.id!, field: fieldC, section });

		const dinero = { ...style, n: { pattern: '"$"#,##0' } } as any;
		if (section === 'salarios') {
			set(r, 3, valor, dinero);
			bind(r, 3, {
				entityType: 'concepto', entityId: c.id!,
				field: 'valor_unitario', section
			});
		} else {
			// En prest/ss la columna D es `base_calculo`. Va como fórmula sobre
			// las filas de salario y se deja SIN `bindDerivada` a propósito:
			// `pintarFilas` repinta con `setValue` toda celda mapeada a un
			// campo del servidor, y eso borraría la `f` de la celda dejando la
			// base congelada (ver punto 3 de `apply-remote-patch.ts`).
			setFormula(r, 3, baseFormula ?? '=0', valor, dinero);
		}

		const totalStyle: IStyleData = {
			...(boldTotal ? { ...style, bl: 1 } : style),
			n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT
		} as any;

		// En las filas de porcentaje C guarda 8.33 y el «%» es solo formato:
		// sin el /100 el total salía multiplicado por cien.
		setFormula(
			r, 4,
			section === 'salarios' ? `=C${r + 1}*D${r + 1}` : `=C${r + 1}/100*D${r + 1}`,
			total, totalStyle
		);
	};

	const grupos = getConductorGrupos(conceptos);

	if (grupos.length === 0) {
		subHeaderConceptos(row);
		row++;
		set(row, 0, '⚠ Sin conceptos de nómina. Usa «Sincronizar con nómina» en la barra superior.', {
			fs: 10, it: 1, cl: { rgb: MUTED }, bd: allBorders()
		});
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, nominaCellBase);
		cellData[row][0] = {
			v: '⚠ Sin conceptos de nómina. Usa «Sincronizar con nómina» en la barra superior.',
			t: CellValueType.STRING,
			s: { fs: 10, it: 1, cl: { rgb: MUTED }, bd: allBorders() }
		};
		rowData[row] = { h: 22 };
		row++;
	} else {
		for (const g of grupos) {
			const cKey = claveConductor(g.conductorId);
			const esProp = propietarios[cKey] === true;
			const ccDoc = (g.conceptos[0] as any)?.conductor?.numero_identificacion;

			set(row, 0, `${g.nombre}${ccDoc ? `  ·  CC: ${ccDoc}` : ''}`, conductorHeader);
			merge(row, 0, 2);
			soloEstilo(row, 1, 2, conductorHeader);
			cellData[row][0] = {
				v: `${g.nombre}${ccDoc ? `  ·  CC: ${ccDoc}` : ''}`,
				t: CellValueType.STRING, s: conductorHeader
			};
			set(row, 3, 'PROPIETARIO', { ...conductorHeader, ht: HorizontalAlign.RIGHT });
			set(row, 4, esProp ? 'SÍ' : 'NO', {
				...conductorHeader, ht: HorizontalAlign.CENTER, bl: 1,
				cl: { rgb: esProp ? GREEN_DARK : MUTED }
			});
			rowData[row] = { h: 24 };
			row++;

			subHeaderConceptos(row);
			row++;

			// Fila en la que quedó cada concepto de salario: las bases de abajo
			// se construyen refiriéndose a ellas, no re-sumando valores
			// sueltos, para que todo cascadee al editar días o valor unitario.
			const filaSalario: Record<string, number> = {};
			const primerSalarioRow = row;
			for (const c of g.salarios) {
				filaSalario[c.concepto] = row;
				const dias = n(c.dias);
				const vu = n(c.valor_unitario);
				filaConcepto(row, c, c.concepto.replace(/_/g, ' '), dias, vu, dias * vu,
					nominaCellBase, 'salarios');
				row++;
			}
			const ultimoSalarioRow = row - 1;

			// ── Bases de cálculo ──
			// PRESTACIONES: salario + auxilio de transporte + recargos.
			// SEGURIDAD SOCIAL (y VACACIONES): salario + recargos, sin auxilio.
			// Un conductor puede no tener las cinco filas de salario, así que
			// se suman SOLO las que existen: con un `+E` colgando la fórmula
			// daría #NAME? y la columna entera se quedaría en error.
			const eDe = (nombre: string) =>
				filaSalario[nombre] != null ? `E${filaSalario[nombre] + 1}` : null;
			const sumaDe = (nombres: string[]) => {
				const partes = nombres.map(eDe).filter(Boolean) as string[];
				return partes.length ? `=${partes.join('+')}` : '=0';
			};
			const BASE_PREST = sumaDe(['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS']);
			const BASE_SS = sumaDe(['SALARIO', 'RECARGOS']);
			// Cacheados de la base: mismo criterio que la fórmula (días × valor
			// unitario), para que la primera pintura no muestre otro número que
			// el que evaluará el motor.
			const totalSalarioDe = (nombre: string) => {
				const c = g.salarios.find((x) => x.concepto === nombre);
				return c ? n(c.dias) * n(c.valor_unitario) : 0;
			};
			const cacheBasePrest =
				totalSalarioDe('SALARIO') + totalSalarioDe('AUXILIO_TRANSPORTE') +
				totalSalarioDe('RECARGOS');
			const cacheBaseSS = totalSalarioDe('SALARIO') + totalSalarioDe('RECARGOS');

			// Las filas de categoría se referencian desde el VALOR TOTAL
			// CONDUCTOR, así que viven fuera de los `if`.
			let prestCatRow: number | null = null;
			let ssCatRow: number | null = null;

			// PRESTACIONES SOCIALES: categoría + hijos, con el TOTAL de la
			// categoría como SUM viva de los hijos.
			if (g.prestaciones.length > 0) {
				const pct = g.prestaciones.reduce((s, c) => s + n(c.porcentaje), 0);
				const total = g.prestaciones.reduce((s, c) => s + n(c.valor_total), 0);
				const catRow = row;
				prestCatRow = catRow;
				filaConcepto(row, g.prestaciones[0], 'PRESTACIONES SOCIALES',
					pct, cacheBasePrest, total, nominaCatStyle, 'prest', true,
					BASE_PREST, false);
				row++;
				const first = row;
				for (const c of g.prestaciones) {
					// VACACIONES es la excepción: se calcula sin el auxilio de
					// transporte, igual que la seguridad social.
					const esVacaciones = c.concepto === 'VACACIONES';
					filaConcepto(row, c, c.concepto.replace(/_/g, ' '),
						n(c.porcentaje), n(c.base_calculo), n(c.valor_total),
						{ ...nominaCellBase, it: 1 }, 'prest', false,
						esVacaciones ? BASE_SS : BASE_PREST);
					row++;
				}
				// El % de la categoría es la SUMA de los de sus hijos: si se
				// ajusta uno, el agregado se mueve solo en vez de quedarse con
				// el número con el que se construyó la hoja.
				setFormula(catRow, 2, `=SUM(C${first + 1}:C${row})`, pct, {
					...nominaCatStyle, bl: 1, n: { pattern: '0.00"%"' },
					ht: HorizontalAlign.RIGHT
				} as any);
				// El TOTAL se suma, no se recalcula con C/100*D: cada hijo puede
				// tener una base distinta (VACACIONES va sin auxilio).
				setFormula(catRow, 4, `=SUM(E${first + 1}:E${row})`, total, {
					...nominaCatStyle, bl: 1, n: { pattern: '"$"#,##0' },
					ht: HorizontalAlign.RIGHT
				} as any);
			}

			if (g.seguridadSocial.length > 0) {
				const pct = g.seguridadSocial.reduce((s, c) => s + n(c.porcentaje), 0);
				const total = g.seguridadSocial.reduce((s, c) => s + n(c.valor_total), 0);
				const catRow = row;
				ssCatRow = catRow;
				filaConcepto(row, g.seguridadSocial[0], 'SEGURIDAD SOCIAL',
					pct, cacheBaseSS, total, nominaCatStyle, 'ss', true,
					BASE_SS, false);
				row++;
				const first = row;
				for (const c of g.seguridadSocial) {
					filaConcepto(row, c, c.concepto.replace(/_/g, ' '),
						n(c.porcentaje), n(c.base_calculo), n(c.valor_total),
						{ ...nominaCellBase, it: 1 }, 'ss', false, BASE_SS);
					row++;
				}
				setFormula(catRow, 2, `=SUM(C${first + 1}:C${row})`, pct, {
					...nominaCatStyle, bl: 1, n: { pattern: '0.00"%"' },
					ht: HorizontalAlign.RIGHT
				} as any);
				setFormula(catRow, 4, `=SUM(E${first + 1}:E${row})`, total, {
					...nominaCatStyle, bl: 1, n: { pattern: '"$"#,##0' },
					ht: HorizontalAlign.RIGHT
				} as any);
			}

			filasTotalizadoras.push(row + 1);
	set(row, 0, `VALOR TOTAL CONDUCTOR · ${g.nombre.toUpperCase()}`, nominaTfStyle);
			merge(row, 0, 3);
			soloEstilo(row, 1, 3, nominaTfStyle);
			cellData[row][0] = {
				v: `VALOR TOTAL CONDUCTOR · ${g.nombre.toUpperCase()}`,
				t: CellValueType.STRING, s: nominaTfStyle
			};
			// Suma viva —salarios + las dos categorías— y no el número del
			// servidor: como literal se quedaba desfasado en cuanto se editaba
			// cualquier fila de arriba, mostrando un total que ya no era el de
			// las filas que tenía encima.
			const partesTotal = [
				g.salarios.length
					? `SUM(E${primerSalarioRow + 1}:E${ultimoSalarioRow + 1})`
					: null,
				prestCatRow != null ? `E${prestCatRow + 1}` : null,
				ssCatRow != null ? `E${ssCatRow + 1}` : null
			].filter(Boolean) as string[];
			setFormula(row, 4,
				partesTotal.length ? `=${partesTotal.join('+')}` : '=0',
				n(g.totalConductor),
				{ ...nominaTfStyle, ht: HorizontalAlign.RIGHT } as any);
			rowData[row] = { h: 22 };
			row += 2; // fila + separación
		}
	}

	// ═══ 3. GASTOS DE VEHÍCULO ═══════════════════════════════════════
	const gastos = conceptos
		.filter((c) => c.tipo === 'GASTO_OPERATIVO')
		.sort((a, b) => (a.orden || 0) - (b.orden || 0));

	/**
	 * Cantidad de cada gasto.
	 *
	 * DOTACION y EXAMEN_MEDICO son AUTOMÁTICOS: su cantidad son los días de
	 * SALARIO de los conductores NO propietarios, exactamente la regla que
	 * aplica el servidor en su cascada (`recalcularGastosAutomaticos`). Se
	 * deriva aquí y no se lee la `dias` almacenada porque una hoja sin
	 * conductores nunca ha pasado por esa cascada: su `dias` es NULL, y el
	 * builder lo pintaba como 1 —había un `?? 1`—, así que la hoja cobraba una
	 * dotación y un examen médico de un conductor que no existe. Con cero
	 * conductores la regla da 0, que es lo que el servidor calcularía en
	 * cuanto algo dispare la cascada: derivarlo no introduce una segunda
	 * aritmética, evita que la hoja muestre una tercera.
	 *
	 * `calculado === false` es la marca de que alguien puso el número a mano:
	 * ahí manda lo guardado, igual que en el servidor.
	 *
	 * El resto de gastos (COMBUSTIBLE, PAPELERIA, GASTOS_DIVERSOS y los
	 * añadidos a mano) van con su `dias`, y sin cantidad son 0 — nunca 1.
	 */
	const GASTOS_POR_DIAS_CONDUCTOR = new Set(['DOTACION', 'EXAMEN_MEDICO']);
	const diasNoPropietarios = totalDiasNoPropietarios(conceptos, propietarios);
	const cantidadDeGasto = (g: ConceptoDescuento) =>
		g.calculado !== false && GASTOS_POR_DIAS_CONDUCTOR.has(g.concepto)
			? diasNoPropietarios
			: n(g.dias);

	// Cacheado con el MISMO criterio que la fórmula `=C*D` de cada fila: si se
	// sumara el `valor_total` guardado, la primera pintura mostraría el importe
	// de la última cascada y el motor lo cambiaría por otro al evaluar.
	const totalGastos = gastos.reduce(
		(s, g) => s + cantidadDeGasto(g) * n(g.valor_unitario),
		0
	);
	const anclaGastos = row;

	set(row, 0, 'GASTOS DE VEHÍCULO', gastosBand);
	merge(row, 0, 4);
	soloEstilo(row, 1, 4, gastosBand);
	cellData[row][0] = { v: 'GASTOS DE VEHÍCULO', t: CellValueType.STRING, s: gastosBand };
	rowData[row] = { h: 22 };
	row++;

	set(row, 0, 'CONCEPTO', gastosSubHeader);
	merge(row, 0, 1);
	if (!cellData[row]) cellData[row] = {};
	cellData[row][1] = { s: gastosSubHeader };
	set(row, 2, 'CANTIDAD', { ...gastosSubHeader, ht: HorizontalAlign.RIGHT });
	set(row, 3, 'VALOR', { ...gastosSubHeader, ht: HorizontalAlign.RIGHT });
	set(row, 4, 'TOTAL', { ...gastosSubHeader, ht: HorizontalAlign.RIGHT });
	rowData[row] = { h: 22 };
	row++;

	const firstGasto = row;
	for (const g of gastos) {
		const cantidad = cantidadDeGasto(g);
		const vu = n(g.valor_unitario);
		set(row, 0, String(g.concepto).replace(/_/g, ' '), nominaCellBase);
		merge(row, 0, 1);
		if (!cellData[row]) cellData[row] = {};
		cellData[row][1] = { s: nominaCellBase };

		set(row, 2, cantidad, { ...nominaCellBase, ht: HorizontalAlign.RIGHT });
		bind(row, 2, { entityType: 'concepto', entityId: g.id!, field: 'dias', section: 'gastos' });

		set(row, 3, vu, {
			...nominaCellBase, n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT
		} as any);
		bind(row, 3, {
			entityType: 'concepto', entityId: g.id!, field: 'valor_unitario', section: 'gastos'
		});

		setFormula(row, 4, `=C${row + 1}*D${row + 1}`, cantidad * vu, {
			...nominaCellBase, n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT
		} as any);
		row++;
	}
	const lastGasto = row - 1;
	if (gastos.length === 0) {
		set(row, 0, '(sin gastos)', nominaCellBase);
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, nominaCellBase);
		cellData[row][0] = { v: '(sin gastos)', t: CellValueType.STRING, s: nominaCellBase };
		row++;
	}

	filasTotalizadoras.push(row + 1);
	set(row, 0, 'TOTAL GASTOS DE VEHÍCULO', secTfStyle);
	merge(row, 0, 3);
	soloEstilo(row, 1, 3, secTfStyle);
	cellData[row][0] = {
		v: 'TOTAL GASTOS DE VEHÍCULO', t: CellValueType.STRING, s: secTfStyle
	};
	setFormula(row, 4,
		gastos.length > 0 ? `=SUM(E${firstGasto + 1}:E${lastGasto + 1})` : '=0',
		totalGastos,
		{ ...secTfStyle, bl: 1, cl: { rgb: AMBER }, bg: { rgb: AMBER_SOFT },
			n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT } as any);
	row += 2;

	// ═══ 4. ANTICIPOS ════════════════════════════════════════════════
	const anticipos = conceptos
		.filter((c) => c.tipo === 'ANTICIPO')
		.sort((a, b) => (a.orden || 0) - (b.orden || 0));
	const totalAnticipos = anticipos.reduce((s, c) => s + n(c.valor_total), 0);
	const anclaAnticipos = row;

	set(row, 0, 'ANTICIPOS DEL VEHÍCULO', anticiposBand);
	merge(row, 0, 4);
	soloEstilo(row, 1, 4, anticiposBand);
	cellData[row][0] = { v: 'ANTICIPOS DEL VEHÍCULO', t: CellValueType.STRING, s: anticiposBand };
	rowData[row] = { h: 22 };
	row++;

	set(row, 0, 'CONCEPTO', anticiposSubHeader);
	merge(row, 0, 1);
	if (!cellData[row]) cellData[row] = {};
	cellData[row][1] = { s: anticiposSubHeader };
	set(row, 2, 'FECHA', anticiposSubHeader);
	set(row, 3, '', anticiposSubHeader);
	set(row, 4, 'VALOR', { ...anticiposSubHeader, ht: HorizontalAlign.RIGHT });
	rowData[row] = { h: 22 };
	row++;

	const firstAnticipo = row;
	for (const a of anticipos) {
		set(row, 0, String(a.concepto).replace(/_/g, ' '), nominaCellBase);
		merge(row, 0, 1);
		if (!cellData[row]) cellData[row] = {};
		cellData[row][1] = { s: nominaCellBase };
		bind(row, 0, {
			entityType: 'concepto', entityId: a.id!, field: 'concepto', section: 'anticipos'
		});

		// La FECHA del anticipo se guarda en `observaciones` (herencia del
		// editor tabular; no hay columna propia).
		set(row, 2, a.observaciones || '—', { ...nominaCellBase, ht: HorizontalAlign.RIGHT });
		bind(row, 2, {
			entityType: 'concepto', entityId: a.id!, field: 'observaciones', section: 'anticipos'
		});

		set(row, 3, '', nominaCellBase);
		set(row, 4, n(a.valor_unitario ?? a.valor_total), {
			...nominaCellBase, ht: HorizontalAlign.RIGHT, n: { pattern: '"$"#,##0' }
		} as any);
		bind(row, 4, {
			entityType: 'concepto', entityId: a.id!, field: 'valor_unitario', section: 'anticipos'
		});
		row++;
	}
	const lastAnticipo = row - 1;
	if (anticipos.length === 0) {
		set(row, 0, '(sin anticipos)', nominaCellBase);
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, nominaCellBase);
		cellData[row][0] = { v: '(sin anticipos)', t: CellValueType.STRING, s: nominaCellBase };
		row++;
	}

	filasTotalizadoras.push(row + 1);
	set(row, 0, 'TOTAL ANTICIPOS DEL VEHÍCULO', secTfStyle);
	merge(row, 0, 3);
	soloEstilo(row, 1, 3, secTfStyle);
	cellData[row][0] = {
		v: 'TOTAL ANTICIPOS DEL VEHÍCULO', t: CellValueType.STRING, s: secTfStyle
	};
	setFormula(row, 4,
		anticipos.length > 0 ? `=SUM(E${firstAnticipo + 1}:E${lastAnticipo + 1})` : '=0',
		totalAnticipos,
		{ ...secTfStyle, bl: 1, cl: { rgb: BLUE }, bg: { rgb: BLUE_SOFT },
			n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT } as any);
	row += 2;

	// ═══ 5. IMPUESTOS ════════════════════════════════════════════════
	// En multi-propietario la sección global se OMITE: los impuestos se
	// prorratean por copropietario y se ven en la matriz de abajo. Es la
	// misma regla del editor tabular.
	const impuestos = conceptos
		.filter((c) => c.tipo === 'IMPUESTO')
		.sort((a, b) => (ORDEN_IMPUESTOS[a.concepto] ?? 999) - (ORDEN_IMPUESTOS[b.concepto] ?? 999));
	const totalImpuestos = impuestos.reduce((s, c) => s + n(c.valor_total), 0);
	const anclaImpuestos = row;

	if (!hoja.es_multi_propietario) {
		set(row, 0, 'IMPUESTOS Y RETENCIONES', impuestosBand);
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, impuestosBand);
		cellData[row][0] = {
			v: 'IMPUESTOS Y RETENCIONES', t: CellValueType.STRING, s: impuestosBand
		};
		rowData[row] = { h: 22 };
		row++;

		set(row, 0, 'CONCEPTO', impuestosSubHeader);
		merge(row, 0, 1);
		if (!cellData[row]) cellData[row] = {};
		cellData[row][1] = { s: impuestosSubHeader };
		set(row, 2, 'PORCENTAJE', { ...impuestosSubHeader, ht: HorizontalAlign.RIGHT });
		set(row, 3, 'BASE', { ...impuestosSubHeader, ht: HorizontalAlign.RIGHT });
		set(row, 4, 'VALOR', { ...impuestosSubHeader, ht: HorizontalAlign.RIGHT });
		rowData[row] = { h: 22 };
		row++;

		const firstImp = row;
		for (const i of impuestos) {
			set(row, 0, String(i.concepto).replace(/_/g, ' '), nominaCellBase);
			merge(row, 0, 1);
			if (!cellData[row]) cellData[row] = {};
			cellData[row][1] = { s: nominaCellBase };
			set(row, 2, i.porcentaje != null ? `${n(i.porcentaje).toFixed(2)}%` : '—',
				{ ...nominaCellBase, ht: HorizontalAlign.RIGHT });
			set(row, 3, n(i.base_calculo), {
				...nominaCellBase, ht: HorizontalAlign.RIGHT, n: { pattern: '"$"#,##0' }
			} as any);
			set(row, 4, n(i.valor_total), {
				...nominaCellBase, ht: HorizontalAlign.RIGHT, n: { pattern: '"$"#,##0' }
			} as any);
			// Los impuestos los calcula ÍNTEGRAMENTE el servidor
			// (`calcularImpuestos`), incluida la regla de que AVISOS y
			// SOBRETASA gravan sobre el VALOR de RETENCION_ICA. Ninguna celda
			// es editable; se marcan derivadas para poder repintarlas.
			bindDerivada(row, 3, {
				entityType: 'concepto', entityId: i.id!, field: 'base_calculo', section: 'impuestos'
			});
			bindDerivada(row, 4, {
				entityType: 'concepto', entityId: i.id!, field: 'valor_total', section: 'impuestos'
			});
			row++;
		}
		const lastImp = row - 1;
		if (impuestos.length === 0) {
			set(row, 0, '(sin impuestos)', nominaCellBase);
			merge(row, 0, 4);
			soloEstilo(row, 1, 4, nominaCellBase);
			cellData[row][0] = { v: '(sin impuestos)', t: CellValueType.STRING, s: nominaCellBase };
			row++;
		}

		filasTotalizadoras.push(row + 1);
	set(row, 0, 'TOTAL IMPUESTOS Y RETENCIONES', secTfStyle);
		merge(row, 0, 3);
		soloEstilo(row, 1, 3, secTfStyle);
		cellData[row][0] = {
			v: 'TOTAL IMPUESTOS Y RETENCIONES', t: CellValueType.STRING, s: secTfStyle
		};
		setFormula(row, 4,
			impuestos.length > 0 ? `=SUM(E${firstImp + 1}:E${lastImp + 1})` : '=0',
			totalImpuestos,
			{ ...secTfStyle, bl: 1, cl: { rgb: RED }, bg: { rgb: RED_SOFT },
				n: { pattern: '"$"#,##0' }, ht: HorizontalAlign.RIGHT } as any);
		row += 2;
	}

	// ═══ 6. COPROPIETARIOS (solo multi-propietario) ══════════════════
	let anclaCopro: number | null = null;

	if (hoja.es_multi_propietario && copropietarios.length > 0) {
		anclaCopro = row;

		set(row, 0, 'REPARTO POR COPROPIETARIOS', coproBand);
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, coproBand);
		cellData[row][0] = {
			v: 'REPARTO POR COPROPIETARIOS', t: CellValueType.STRING, s: coproBand
		};
		rowData[row] = { h: 22 };
		row++;

		const sumaPct = copropietarios.reduce((s, p) => s + n(p.porcentaje), 0);
		set(row, 0, 'COPROPIETARIO', coproSubHeader);
		merge(row, 0, 1);
		if (!cellData[row]) cellData[row] = {};
		cellData[row][1] = { s: coproSubHeader };
		set(row, 2, 'IDENTIFICACIÓN', coproSubHeader);
		set(row, 3, '%', { ...coproSubHeader, ht: HorizontalAlign.RIGHT });
		set(row, 4, 'PARTICIPACIÓN', { ...coproSubHeader, ht: HorizontalAlign.RIGHT });
		rowData[row] = { h: 22 };
		row++;

		for (const p of copropietarios) {
			set(row, 0, p.nombre, nominaCellBase);
			merge(row, 0, 1);
			if (!cellData[row]) cellData[row] = {};
			cellData[row][1] = { s: nominaCellBase };
			set(row, 2, p.identificacion || '—', nominaCellBase);
			set(row, 3, `${n(p.porcentaje).toFixed(2)}%`,
				{ ...nominaCellBase, ht: HorizontalAlign.RIGHT });
			set(row, 4, '', nominaCellBase);
			row++;
		}

		// La suma NO se valida contra 100%: por requisito del negocio, un
		// cierre puede repartir 115%. Se muestra el dato con aviso, sin
		// corregirlo — normalizarlo rompería la liquidación.
		const avisa = Math.abs(sumaPct - 100) > 0.01;
		set(row, 0, avisa
			? `SUMA DE PARTICIPACIONES: ${sumaPct.toFixed(2)}%  (distinta de 100%)`
			: `SUMA DE PARTICIPACIONES: ${sumaPct.toFixed(2)}%`,
			{ ...secTfStyle, cl: { rgb: avisa ? AMBER : TEXT_DARK },
				bg: { rgb: avisa ? AMBER_SOFT : SUBTLE_BG } } as any);
		merge(row, 0, 4);
		soloEstilo(row, 1, 4, { ...secTfStyle,
			bg: { rgb: avisa ? AMBER_SOFT : SUBTLE_BG } } as any);
		cellData[row][0] = {
			v: avisa
				? `SUMA DE PARTICIPACIONES: ${sumaPct.toFixed(2)}%  (distinta de 100%)`
				: `SUMA DE PARTICIPACIONES: ${sumaPct.toFixed(2)}%`,
			t: CellValueType.STRING,
			s: { ...secTfStyle, cl: { rgb: avisa ? AMBER : TEXT_DARK },
				bg: { rgb: avisa ? AMBER_SOFT : SUBTLE_BG } } as any
		};
		row += 2;

		// ── Matriz concepto × copropietario ──
		set(row, 0, 'DESGLOSE DE IMPUESTOS POR COPROPIETARIO', coproBand);
		const ultimaColMatriz = Math.min(1 + copropietarios.length, TOTAL_COLS - 1);
		merge(row, 0, ultimaColMatriz);
		soloEstilo(row, 1, ultimaColMatriz, coproBand);
		cellData[row][0] = {
			v: 'DESGLOSE DE IMPUESTOS POR COPROPIETARIO',
			t: CellValueType.STRING, s: coproBand
		};
		rowData[row] = { h: 22 };
		row++;

		set(row, 0, 'CONCEPTO', coproSubHeader);
		copropietarios.forEach((p, i) => {
			set(row, 1 + i, p.nombre, { ...coproSubHeader, ht: HorizontalAlign.RIGHT });
		});
		rowData[row] = { h: 22 };
		row++;

		const conceptosImp = Array.from(new Set(impuestos.map((i) => i.concepto)))
			.sort((a, b) => (ORDEN_IMPUESTOS[a] ?? 999) - (ORDEN_IMPUESTOS[b] ?? 999));

		for (const nombreConcepto of conceptosImp) {
			set(row, 0, nombreConcepto.replace(/_/g, ' '), nominaCellBase);
			copropietarios.forEach((p, i) => {
				const fila = impuestos.find(
					(x) => x.concepto === nombreConcepto && (x as any).propietario_id === p.id
				);
				set(row, 1 + i, n(fila?.valor_total), {
					...nominaCellBase, ht: HorizontalAlign.RIGHT, n: { pattern: '"$"#,##0' }
				} as any);
				if (fila?.id) {
					bindDerivada(row, 1 + i, {
						entityType: 'concepto', entityId: fila.id,
						field: 'valor_total', section: 'copropietarios'
					});
				}
			});
			row++;
		}
		row++;
	}

	// ═══ 7. TOTALES FINALES ══════════════════════════════════════════
	// PARIDAD CON EL EDITOR: incluye los adicionales. El canvas antiguo los
	// omitía y por eso su TOTAL A PAGAR no cuadraba.
	// Estos números son el valor CACHEADO de las fórmulas de abajo, para que
	// la primera pintura no enseñe ceros mientras el motor evalúa.
	// Los EXCLUIDOS no suman: la fila TOTALES de la tabla ya los descarta con
	// SUMIF(...,"NO",...), así que incluirlos aquí daba dos cifras distintas del
	// mismo dato en la misma hoja.
	const totalLiquidarItems = items
		.filter((it) => !it.excluido)
		.reduce((s, it) => s + n(it.valor_liquidar), 0);
	const totalServicio = totalLiquidarItems + totalAdicionales;
	const totalCostosLaborales = conceptos
		.filter((c) => c.tipo === 'COSTO_LABORAL')
		.reduce((s, c) => s + n(c.valor_total), 0);
	const totalDescuentos =
		totalCostosLaborales + totalGastos + totalImpuestos + totalAnticipos;
	const totalPagar = totalServicio - totalDescuentos;

	const filaTotalDescuentos = row;
	set(row, 0, 'TOTAL DESCUENTOS', redTotalLabel);
	merge(row, 0, 3);
	soloEstilo(row, 1, 3, redTotalLabel);
	cellData[row][0] = { v: 'TOTAL DESCUENTOS', t: CellValueType.STRING, s: redTotalLabel };
	// Suma VIVA de los totalizadores de cada sección (nómina + gastos +
	// anticipos + impuestos). Antes era un número calculado aparte, que podía
	// contradecir lo que se ve justo encima en la propia hoja.
	setFormula(
		row,
		4,
		filasTotalizadoras.length ? '=' + filasTotalizadoras.map((f) => `E${f}`).join('+') : '=0',
		totalDescuentos,
		redTotalValue
	);
	rowData[row] = { h: 28 };
	row++;

	const filaTotalPagar = row;
	set(row, 0, 'TOTAL A PAGAR', greenTotalLabel);
	merge(row, 0, 3);
	soloEstilo(row, 1, 3, greenTotalLabel);
	cellData[row][0] = { v: 'TOTAL A PAGAR', t: CellValueType.STRING, s: greenTotalLabel };
	// LAS DOS CIFRAS SALEN DE LA HOJA, no de números calculados aparte: el
	// servicio es el pie de la tabla de items —que desde que los adicionales
	// viven ahí dentro ya los incluye— y los descuentos son su propia fila.
	// Antes el servicio iba incrustado como literal, así que teclear la
	// cantidad de un item o de un adicional dejaba TOTAL A PAGAR congelado
	// hasta recargar, contradiciendo a la tabla que tenía encima.
	const refServicio = `${colLetter(COL.V_LIQUIDAR)}${totalesItemsRow + 1}`;
	setFormula(row, 4, `=${refServicio}-E${filaTotalDescuentos + 1}`, totalPagar, greenTotalValue);
	rowData[row] = { h: 28 };
	row++;

	const filaLibreDesde = Math.max(row + 2, items.length + 22);
	const totalFilas = filaLibreDesde + FILAS_ANOTABLES;
	// Retícula continua: sin esto la tabla "se acaba" de golpe donde terminan
	// los datos. Ver `relleno-bordes.ts` sobre por qué no se puede por config.
	rellenarBordesVacios(cellData, totalFilas, TOTAL_COLS, mergeData);
	// Zona libre: debajo del bloque estructurado el equipo puede dejar
	// referencias o valores de apoyo. Se registra para que `cell-permission`
	// las deje editar y el adaptador sepa que eso es una anotación, no un
	// campo de la base de datos.
	registrarHojaEditable(unitId, sheetId, {
		finItems: filaLibreDesde,
		// Por encima de la tabla de items está la cabecera (título + fila de
		// encabezados), que NO se desplaza cuando entran o salen items: se ancla
		// por fila absoluta. Sin declararlo, esas celdas caían en el ancla de
		// `fila` con un offset negativo enorme y bajaban una fila por cada item
		// nuevo.
		inicioItems: firstItemRow,
		itemPorFila
	});
	aplicarCapa(cellData, unitId, sheetId, anotaciones);

	// ─── Ensamblado de la hoja ──────────────────────────────────────
	const sheet = {
		id: sheetId,
		name: sheetName,
		// El color de la pestaña lo decide el ESTADO, no si la hoja es
		// editable: con N pestañas hace falta distinguir BORRADOR de
		// LIQUIDADA de APROBADA de un vistazo, y "editable / no editable"
		// solo daba dos colores para seis estados. Un override manual del
		// usuario (`color_hoja`) gana sobre el estado.
		tabColor: colorDeHoja(hoja),
		hidden: BooleanNumber.FALSE,
		freeze: {
			startRow: headerItemsRow + 1,
			startColumn: 0,
			ySplit: headerItemsRow + 1,
			xSplit: 0
		},
		rowCount: totalFilas,
		columnCount: TOTAL_COLS,
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

	return {
		sheet,
		bindings,
		anclas: {
			headerItems: headerItemsRow,
			totalesItems: totalesItemsRow,
			rangoItems: hayFilas ? { desde: firstItemRow, hasta: ultimaFilaTabla } : null,
			adicionales: anclaAdicionales,
			descuentos: anclaDescuentos,
			gastos: anclaGastos,
			anticipos: anclaAnticipos,
			impuestos: anclaImpuestos,
			copropietarios: anclaCopro,
			totalDescuentos: filaTotalDescuentos,
			totalPagar: filaTotalPagar,
			ultimaFila: row
		}
	};
}

// ─── Ensamblador del libro del periodo ────────────────────────────────

export interface CierresFinalesPeriodoInput {
	anio: number;
	mes: number;
	cierres: CierreFinalCompleto[];
	/// Notas libres del periodo: `{ [mes]: { [id de cierre]: AnotacionCelda[] } }`.
	/// Aquí la `sheet_key` es el id del CIERRE: el libro es de un periodo y
	/// tiene una hoja por placa.
	anotaciones?: Record<number, Record<string, CeldaDeCapa[]>>;
}

export interface CierresFinalesPeriodoResult {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorCierre: Record<string, string>;
	ordenHojas: string[];
	bindingsPorHoja: Record<string, BindingSeed[]>;
	anclasPorHoja: Record<string, AnclasHoja>;
}

/**
 * Construye el libro del periodo.
 *
 * `cierres` debe llegar ya ordenado (el servidor lo devuelve así). El orden
 * de `sheetOrder` es el que ve el usuario en la barra de pestañas.
 *
 * Los cierres SIN detalle cargado —modo perezoso— se pasan con arrays
 * vacíos: rinden una hoja con el título y la estructura, y se rellenan
 * después reconstruyendo solo esa hoja.
 */
export function buildCierresFinalesPeriodoWorkbook(
	input: CierresFinalesPeriodoInput
): CierresFinalesPeriodoResult {
	const { anio, mes, cierres } = input;
	const unitId = cierresFinalesUnitId(anio, mes);
	const nombres = nombresUnicos(cierres.map((c) => c.hoja));

	const sheets: Record<string, any> = {};
	const sheetOrder: string[] = [];
	const sheetIdPorCierre: Record<string, string> = {};
	const bindingsPorHoja: Record<string, BindingSeed[]> = {};
	const anclasPorHoja: Record<string, AnclasHoja> = {};

	for (const cierre of cierres) {
		const sheetId = cierreFinalSheetId(cierre.hoja.id);
		const { sheet, bindings, anclas } = buildCierreFinalSheet({
			unitId,
			sheetId,
			sheetName: nombres[cierre.hoja.id],
			cierre,
			// `sheet_key` = id del cierre: el libro es de un periodo y cada hoja
			// es una placa.
			anotaciones: input.anotaciones?.[mes]?.[cierre.hoja.id] ?? []
		});
		sheets[sheetId] = sheet;
		sheetOrder.push(sheetId);
		sheetIdPorCierre[cierre.hoja.id] = sheetId;
		bindingsPorHoja[sheetId] = bindings;
		anclasPorHoja[sheetId] = anclas;
	}

	const workbook: IWorkbookData = {
		id: unitId,
		name: `Cierres finales ${String(mes).padStart(2, '0')}/${anio}`,
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder,
		sheets
	};

	return { workbook, unitId, sheetIdPorCierre, ordenHojas: sheetOrder, bindingsPorHoja, anclasPorHoja };
}
