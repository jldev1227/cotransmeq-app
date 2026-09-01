/**
 * Builder del workbook Univer del canvas **INGRESOS DE COTRANSMEQ**.
 *
 * Réplica de las hojas «OTROS INGRESOS <MES>» y «ADICIONALES <MES>» del
 * formato GAF-FR-11, incluida la aritmética: las fórmulas de aquí son las del
 * Excel, no una reinterpretación.
 *
 * LAYOUT: DOS hojas, «INGRESOS» y «ADICIONALES», las del MES que se está
 * mirando. El eje del workbook es el PERIODO
 * (`unitId = workbook-ingresos-terceros-YYYY-M`), así que cambiar de mes
 * reconstruye el libro.
 *
 * Antes eran las 24 del año —dos por mes— y la sheet bar las mostraba todas.
 * Con doce «ENERO / ADIC ENERO / FEBRERO / ADIC FEBRERO…» seguidas, encontrar
 * la hoja del mes que se está liquidando era el paso más lento de la vista, y
 * el nombre de la pestaña repetía un dato que la barra superior ya da. El mes
 * se elige arriba, en el selector del header; abajo solo quedan las dos hojas
 * del documento, que es lo que de verdad se alterna.
 *
 * ── LA TABLA ────────────────────────────────────────────────────────────
 * UNA FILA POR SERVICIO, no por cliente. Antes esta hoja consolidaba los
 * items de cada cliente en una sola fila; el Excel detalla cada servicio con
 * su recorrido, y sin ese detalle no hay forma de marcar cuáles bajan a la
 * hoja de adicionales, que es de lo que va todo este documento.
 *
 *   EMPRESA     ← cliente de la liquidación de servicio
 *   DESCRIPCION ← recorrido del item
 *   FECHAS      ← fechas del servicio
 *   PLACA       ← placa del vehículo; es además la clave de ORDEN de la tabla
 *   V/UNIDAD    ← `ingreso_empresa` (lo que dejó el servicio a Cotransmeq)
 *   CANT        ← editable (1 por defecto)
 *   ADMON       ← fórmula: % de administración sobre el TOTAL
 *   TOTAL       ← fórmula: V/UNIDAD × CANT
 *   V/LIQUIDAR  ← fórmula: TOTAL − ADMON
 *   INCLUIR     ← editable (SÍ/NO). Solo en la hoja de INGRESOS: marca qué
 *                 servicios bajan a la de ADICIONALES.
 *
 * ── EL CIRCUITO ENTRE LAS DOS HOJAS ─────────────────────────────────────
 * La hoja de ADICIONALES toma los servicios marcados, les aplica un % de
 * ganancia (70 % por defecto) sobre el V/UNIDAD, y liquida por su cuenta
 * hasta un TRANSPORTE POR PAGAR. Ese número vuelve a la hoja de INGRESOS
 * como «TOTAL DESCUENTOS LIQUIDACIÓN ADICIONALES <MES> <AÑO>» y se resta
 * allí. Por eso ADICIONALES se construye PRIMERO: la hoja de ingresos
 * necesita saber en qué fila acabó su total para referenciarla.
 *
 * ── POR QUÉ ADICIONALES LLEVA TODOS LOS SERVICIOS ───────────────────────
 * La hoja de ADICIONALES pinta una fila por CADA servicio del mes —no solo
 * por los marcados— y ESCONDE las que no lo están. Su geometría no depende
 * entonces de la columna INCLUIR: marcar una casilla no añade ni quita
 * filas, no desplaza el pie ni la fila del TOTAL A PAGAR que la otra hoja
 * referencia, y por tanto no obliga a reconstruir el libro. Antes sí lo
 * obligaba, y cada clic en una casilla desmontaba y volvía a montar Univer
 * entero: la pantalla se quedaba en blanco medio segundo.
 *
 * Lo que apaga una fila no marcada es su fórmula de TOTAL, que cuelga de la
 * casilla INCLUIR de la otra hoja (`=IF(LEFT('INGRESOS'!J7,1)="S",…,0)`).
 * Como ADMON y V/LIQUIDAR se derivan del TOTAL y los SUM del pie cuelgan de
 * esas tres columnas, marcar la casilla recalcula el documento entero solo.
 * Las filas ocultas siguen sumando cero, así que esconderlas es cosmética.
 */

import {
	BooleanNumber,
	BorderStyleTypes,
	CellValueType,
	HorizontalAlign,
	VerticalAlign,
	LocaleType,
	WrapStrategy,
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
import { setIngresosBinding } from '../business/ingresos-cell-binding';
import {
	alcanceIngresos,
	calcularTotales,
	ensureConceptosIngresos,
	esClientePrioritario,
	GASTOS_DIVERSOS_FIJO,
	GASTOS_DIVERSOS_PCT,
	indexarFilas,
	ordenarFilasIngresos,
	porcentajesDe,
	type FilaCalculada,
	type PorcentajesIngresos
} from '../business/ingresos-transmeralda';
import { CHECKBOX_SI, CHECKBOX_NO } from '../univer/checkbox-si-no';
import type {
	ConceptoIngreso,
	EstadoIngresoMes,
	HojaIngreso,
	IngresoTerceroRow
} from '$lib/api/liquidaciones-terceros-ingresos';

/// Filas anotables que se abren bajo el bloque estructurado de cada hoja.
export const FILAS_ANOTABLES = 40;

/**
 * Primera fila 0-based de la tabla de servicios, EN LAS DOS HOJAS.
 *
 * Las dos empiezan por la fila de cabeceras y siguen con los servicios del mes
 * en el mismo orden, así que el servicio nº `i` cae en la fila
 * `PRIMERA_FILA_ITEMS + i` tanto en INGRESOS como en ADICIONALES. De ahí que la
 * hoja de adicionales pueda apuntar a la casilla INCLUIR de la de ingresos con
 * solo su índice, sin esperar a que la otra hoja esté construida.
 */
export const PRIMERA_FILA_ITEMS = 1;

const GREEN = '#0F4025';
const GREEN_DARK = '#166534';
const RED = '#B91C1C';
const AMBER = '#B45309';
const BLUE = '#1D4ED8';
const TEXT_DARK = '#0F172A';
const SUBTLE_BG = '#F1F5F9';
const TOTALES_BG = '#E2E8F0';
const ZEBRA_BG = '#F8FAFC';
const MUTED = '#475569';
const BLANCO = '#FFFFFF';
/// Fondo de las celdas editables de la tabla: «aquí se escribe».
const EDITABLE_BG = '#EFF6FF';

/**
 * Fondos con los que la tabla de INGRESOS dice qué es cada fila.
 *
 * `blue-200` para los clientes PRIORITARIOS y `green-200` para lo que baja a
 * adicionales (los de Tailwind, la paleta del resto de la app). El azul era
 * antes un `#E0E7FF` de índigo; se iguala al de la fila entera porque la
 * misma decisión no puede pintarse de dos azules según cuánto ocupe.
 */
const AZUL_PRIORIDAD = '#BFDBFE';
const VERDE_INCLUIDA = '#BBF7D0';

/**
 * Colores de las dos columnas de dinero de la tabla: `green-600` para
 * V/LIQUIDAR y `red-600` para ADMON (los de Tailwind, que es la paleta del
 * resto de la app).
 *
 * Solo TIÑEN EL TEXTO, sin fondo: son doscientas filas y un fondo por columna
 * convertiría la tabla en dos bandas de color.
 *
 * Antes ADMON iba en gris, a propósito: en esta hoja el rojo del patrón de
 * moneda significa «negativo», y teñir la columna entera lo hacía
 * indistinguible. Sigue siendo cierto para ADMON —ahora es roja siempre—,
 * pero en V/LIQUIDAR no se pierde nada: el patrón `[Red]` gana al color del
 * estilo, así que un V/LIQUIDAR negativo sigue saliendo en rojo sobre una
 * columna verde y se ve todavía mejor que antes.
 */
const VERDE_LIQUIDAR = '#16A34A';
const ROJO_ADMON = '#DC2626';

const MESES = [
	'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
	'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

/** Id de la hoja de INGRESOS de un mes. Estable: el deep-link `?mes=` lo usa. */
export function ingresosSheetId(mes: number): string {
	return `sheet-${mes}`;
}

/** Id de la hoja de ADICIONALES de un mes. */
export function adicionalesSheetId(mes: number): string {
	return `sheet-adic-${mes}`;
}

/**
 * Nombres visibles de las dos pestañas.
 *
 * Sin el mes dentro: el libro es de UN mes y la barra superior ya dice cuál.
 * Sin punto ni tilde a propósito: el nombre de ADICIONALES entra en una
 * referencia entre hojas (`='ADICIONALES'!I92`) y esos son justo los
 * caracteres con los que tropiezan los parsers de fórmulas.
 */
export const SHEET_NAME_INGRESOS = 'INGRESOS';
export const SHEET_NAME_ADICIONALES = 'ADICIONALES';

/**
 * Id de workbook de un PERIODO.
 *
 * Lleva el mes porque el libro solo tiene sus dos hojas: con un unitId por año
 * los bindings de enero y los de febrero compartirían espacio de claves y una
 * edición podría resolver contra la fila de otro mes.
 */
export function ingresosUnitId(anio: number, mes: number): string {
	return `workbook-ingresos-terceros-${anio}-${mes}`;
}

const HEADERS = [
	'EMPRESA',
	'DESCRIPCION',
	'FECHAS',
	'PLACA',
	'V/UNIDAD',
	'CANT',
	'ADMON',
	'TOTAL',
	'V/ LIQUIDAR'
];
const HEADER_INCLUIR = 'INCLUIR';

// DESCRIPCION baja de 330 a 260: ya no carga con las fechas ni la placa, que
// ahora tienen columna propia.
const COLUMN_WIDTHS = [300, 260, 120, 100, 130, 65, 120, 130, 130, 95];

/// Columnas por hoja. La de INGRESOS lleva una más: la de INCLUIR.
const COLS_INGRESOS = 10;
const COLS_ADICIONALES = 9;

/// Índices de columna, para no repartir números sueltos por el fichero.
///
/// Todas las referencias del builder pasan por aquí y por `ref()`, así que
/// insertar una columna es cambiar este mapa y los anchos — no hay letras
/// de columna escritas a mano en ninguna fórmula.
const COL = {
	EMPRESA: 0,
	DESCRIPCION: 1,
	FECHAS: 2,
	PLACA: 3,
	V_UNIDAD: 4,
	CANT: 5,
	ADMON: 6,
	TOTAL: 7,
	V_LIQUIDAR: 8,
	INCLUIR: 9
} as const;

/**
 * Columna INCLUIR, para que el engine le cuelgue el checkbox de validación
 * de datos. Se exporta el índice y no el mapa entero: fuera del builder
 * nadie tiene por qué saber dónde cae el resto.
 */
export const COL_INCLUIR: number = COL.INCLUIR;

/**
 * Colores de la casilla INCLUIR según esté marcada o no.
 *
 * Se exportan porque el repintado en caliente los necesita: marcar la casilla
 * ya no reconstruye la hoja, así que quien la marca tiene que teñir la celda
 * él mismo y ha de hacerlo con exactamente estos dos colores. Tenerlos en dos
 * sitios es garantizar que un día dejen de coincidir.
 */
export const COLORES_INCLUIR = {
	si: { fondo: '#ECFDF5', texto: GREEN_DARK },
	no: { fondo: '#F8FAFC', texto: MUTED }
} as const;

/**
 * Columnas que abarca el resaltado de fila: de EMPRESA a V/LIQUIDAR.
 *
 * INCLUIR se queda FUERA a propósito. Es la columna de acción y tiene su
 * propio semáforo (`COLORES_INCLUIR`): teñirla del color de la fila borraría
 * justo la señal que dice si la casilla está marcada, que es lo que el
 * resaltado viene a reforzar.
 */
export const COLS_RESALTADO = { desde: COL.EMPRESA, hasta: COL.V_LIQUIDAR } as const;

/**
 * Fondo de UNA celda de la tabla de ingresos.
 *
 * Aquí se decide qué dice el color de una fila, y es la ÚNICA implementación:
 * la usa el builder al pintar la hoja y el engine al repintarla en caliente
 * cuando alguien marca una casilla (marcar ya no reconstruye el libro, ver el
 * encabezado). Con dos copias, una fila recién marcada y esa misma fila tras
 * recargar acabarían de distinto color.
 *
 * Las reglas, en orden de precedencia:
 *
 *  1. Marcada con INCLUIR → la fila entera en verde, de EMPRESA a V/LIQUIDAR.
 *  2. Marcada Y de un cliente PRIORITARIO → la fila entera en azul. El azul
 *     gana: qué cliente es se sigue leyendo, y que esté marcada ya lo dice la
 *     casilla, que queda fuera del resaltado.
 *  3. Prioritario SIN marcar → azul solo en la celda del nombre. Es la señal
 *     de siempre: distingue al cliente sin afirmar nada sobre la decisión.
 *  4. Nada de lo anterior → lo que la celda sería por sí sola: el azul claro
 *     de las editables, o la cebra de las filas impares.
 */
export function fondoFilaIngresos(o: {
	prioritaria: boolean;
	incluida: boolean;
	/// Fila impar de la tabla (0-based sobre los items), que lleva cebra.
	zebra: boolean;
	columna: number;
}): string {
	if (o.incluida) return o.prioritaria ? AZUL_PRIORIDAD : VERDE_INCLUIDA;
	if (o.prioritaria && o.columna === COL.EMPRESA) return AZUL_PRIORIDAD;
	if (o.columna === COL.CANT) return EDITABLE_BG;
	return o.zebra ? ZEBRA_BG : BLANCO;
}

function colLetter(col: number): string {
	let letter = '';
	let n = col;
	while (n >= 0) {
		letter = String.fromCharCode(65 + (n % 26)) + letter;
		n = Math.floor(n / 26) - 1;
	}
	return letter;
}

/// Referencia a una celda de ESTA hoja, en notación de fórmula (1-based).
const ref = (col: number, fila0: number) => `${colLetter(col)}${fila0 + 1}`;

// ═══════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DE UNA HOJA
// ═══════════════════════════════════════════════════════════════════════

interface HojaInput {
	unitId: string;
	sheetId: string;
	sheetName: string;
	anio: number;
	mes: number;
	hoja: HojaIngreso;
	filas: FilaCalculada[];
	conceptos: ConceptoIngreso[];
	pct: PorcentajesIngresos;
	anotaciones?: CeldaDeCapa[];
	/**
	 * Solo para la hoja de INGRESOS: dónde vive el TOTAL A PAGAR de la de
	 * ADICIONALES, para referenciarlo en vez de copiar el número. Sin esto las
	 * dos hojas se desincronizarían en cuanto alguien tocara un adicional.
	 */
	refTotalAdicionales?: { sheetName: string; fila0: number } | null;
	/**
	 * Solo para la hoja de ADICIONALES: dónde vive la casilla INCLUIR de cada
	 * servicio, en la hoja de INGRESOS. La fila es la misma que ocupa el
	 * servicio aquí (ver `PRIMERA_FILA_ITEMS`), así que basta el nombre de la
	 * hoja y la columna.
	 */
	refIncluir?: { sheetName: string; columna: number } | null;
}

interface HojaSalida {
	sheet: any;
	/// Fila 0-based del total que cierra la hoja. La de ADICIONALES la expone
	/// para que la de INGRESOS pueda apuntarla.
	filaTotalFinal: number;
	/**
	 * Filas 0-based que ocupa la columna INCLUIR, para colgarles el checkbox.
	 *
	 * Lo expone el builder y no lo deduce el engine porque es él quien sabe
	 * dónde empezó y acabó la tabla: recalcularlo fuera sería una segunda
	 * copia de la geometría de la hoja, que cambia con cada aviso o fila
	 * vacía.
	 *
	 * `null` en la hoja de ADICIONALES (no tiene columna INCLUIR) y en los
	 * meses sin filas.
	 */
	rangoIncluir: { desde: number; hasta: number } | null;
	/**
	 * Fila 0-based del aviso «ningún servicio marcado» de la hoja de
	 * ADICIONALES, que se muestra u oculta según haya marcados. `null` cuando
	 * el aviso no es de los que se ocultan: en la hoja de INGRESOS y en los
	 * meses sin ningún servicio, donde lo que dice es otra cosa y se queda.
	 */
	filaAvisoOcultable: number | null;
}

function construirHoja(input: HojaInput): HojaSalida {
	const { unitId, sheetId, hoja, filas, conceptos, pct } = input;
	const esIngresos = hoja === 'INGRESOS';
	const numCols = esIngresos ? COLS_INGRESOS : COLS_ADICIONALES;

	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: any[] = [];
	const rowData: Record<number, { h?: number; hd?: BooleanNumber }> = {};
	const colData: Record<number, { w?: number }> = {};
	for (let i = 0; i < numCols; i++) colData[i] = { w: COLUMN_WIDTHS[i] };

	// ─── Estilos ────────────────────────────────────────────────────────
	const thin = (): IBorderStyleData => ({
		s: BorderStyleTypes.THIN,
		cl: { rgb: '#CBD5E1' }
	});
	const bordes = (): IBorderData => ({ t: thin(), r: thin(), b: thin(), l: thin() });

	const headerStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: GREEN },
		ht: HorizontalAlign.CENTER,
		bd: bordes()
	};
	const cellBase: IStyleData = { fs: 10, cl: { rgb: TEXT_DARK }, bd: bordes() };
	const cellZebra: IStyleData = { ...cellBase, bg: { rgb: ZEBRA_BG } };
	/**
	 * Formato de dinero de la hoja.
	 *
	 * Dos secciones: la primera es el positivo, la segunda el NEGATIVO, en rojo
	 * y con su guion delante. Aquí los negativos son reales y significativos —un
	 * servicio puede dejar a la empresa en rojo ese mes— y con el formato de una
	 * sola sección se perdían entre el resto de cifras.
	 *
	 * Sin decimales: el COP no usa centavos en estos documentos. Se evita el
	 * patrón `#,##0.##` porque la librería `numfmt` de Univer deja un "."
	 * colgante cuando el valor no tiene parte decimal.
	 */
	const PATRON_COP = '"$"#,##0;[Red]-"$"#,##0';
	const money = (base: IStyleData): IStyleData =>
		({ ...base, ht: HorizontalAlign.RIGHT, n: { pattern: PATRON_COP } }) as any;
	/// Celda editable: fondo azulado, para que se distinga de las derivadas.
	const editable = (base: IStyleData): IStyleData =>
		({ ...base, cl: { rgb: BLUE }, bg: { rgb: '#EFF6FF' } }) as any;

	// Sin fondo: lo pone `fondoFilaIngresos`, que es quien sabe si el azul de
	// esta celda le corresponde a ella sola o a la fila entera.
	const empresaStyle = (prioritaria: boolean): IStyleData => ({
		fs: 10,
		bl: prioritaria ? 1 : 0,
		cl: { rgb: prioritaria ? GREEN_DARK : TEXT_DARK },
		bd: bordes(),
		ht: HorizontalAlign.LEFT,
		vt: VerticalAlign.MIDDLE
	});
	// Los colores salen de `COLORES_INCLUIR` y no de literales sueltos: el
	// repintado en caliente tiñe esta misma celda con ellos, y dos copias es
	// garantizar que un día una hoja recién montada y una recién marcada dejen
	// de parecerse.
	const accion = (marcada: boolean): IStyleData => {
		const c = marcada ? COLORES_INCLUIR.si : COLORES_INCLUIR.no;
		return {
			...cellBase,
			bl: 1,
			ht: HorizontalAlign.CENTER,
			cl: { rgb: c.texto },
			bg: { rgb: c.fondo }
		};
	};
	const etiquetaStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: SUBTLE_BG },
		bd: bordes(),
		ht: HorizontalAlign.LEFT
	};
	const valorStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: SUBTLE_BG },
		bd: bordes(),
		ht: HorizontalAlign.RIGHT,
		n: { pattern: PATRON_COP }
	} as any;
	const totalStyle: IStyleData = {
		fs: 10,
		bl: 1,
		cl: { rgb: TEXT_DARK },
		bg: { rgb: TOTALES_BG },
		bd: bordes(),
		ht: HorizontalAlign.RIGHT,
		n: { pattern: PATRON_COP }
	} as any;
	const banda = (bg: string): IStyleData => ({
		fs: 11,
		bl: 1,
		cl: { rgb: '#FFFFFF' },
		bg: { rgb: bg },
		ht: HorizontalAlign.CENTER,
		bd: bordes()
	});
	// Las líneas de cierre van en blanco sobre fondo oscuro, así que aquí NO se
	// usa `[Red]`: el rojo sobre verde no se lee. El negativo sigue marcado por
	// su guion, que es lo que distingue la cifra.
	const cierreStyle = (bg: string): IStyleData =>
		({
			fs: 13,
			bl: 1,
			cl: { rgb: '#FFFFFF' },
			bg: { rgb: bg },
			bd: bordes(),
			ht: HorizontalAlign.RIGHT,
			n: { pattern: '"$"#,##0;-"$"#,##0' }
		}) as any;
	const cierreEtiqueta = (bg: string, fg: string): IStyleData => ({
		fs: 12,
		bl: 1,
		cl: { rgb: fg },
		bg: { rgb: bg },
		bd: bordes(),
		ht: HorizontalAlign.LEFT
	});

	// ─── Escritores ─────────────────────────────────────────────────────
	const set = (r: number, c: number, v: any, s: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][c] = {
			v,
			t: typeof v === 'number' ? CellValueType.NUMBER : CellValueType.STRING,
			s
		};
	};
	const setFormula = (
		r: number,
		c: number,
		formula: string,
		cached: number,
		s: IStyleData
	) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][c] = {
			v: cached,
			t: CellValueType.NUMBER,
			f: formula,
			s,
			custom: { locked: true }
		};
	};
	const setPercent = (r: number, c: number, valor: number, s: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][c] = {
			v: Number(valor) || 0,
			t: CellValueType.NUMBER,
			s: { ...s, n: { pattern: '0.00"%"' } } as any
		};
	};
	/// Celda sin valor pero CON estilo. Hace falta en las que cubre un merge y
	/// en las columnas que no participan de una fila de totales: sin ella
	/// Univer deja el hueco sin bordes y la banda se ve partida.
	const stub = (r: number, c: number, s: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][c] = { s };
	};
	const merge = (r: number, desde: number, hasta: number) => {
		mergeData.push({
			startRow: r,
			endRow: r,
			startColumn: desde,
			endColumn: hasta,
			rangeType: 0
		});
	};

	let r = 0;

	/// Banda de sección a todo lo ancho.
	const escribirBanda = (texto: string, bg: string) => {
		set(r, 0, texto, banda(bg));
		merge(r, 0, numCols - 1);
		for (let c = 1; c < numCols; c++) stub(r, c, banda(bg));
		rowData[r] = { h: 22 };
		r++;
	};

	/**
	 * Fila de «etiqueta … valor»: la etiqueta ocupa desde la columna 0 hasta
	 * la anterior a la del valor, y el resto queda con estilo para que la
	 * banda no se rompa.
	 */
	const escribirLinea = (o: {
		etiqueta: string;
		colValor: number;
		formula?: string;
		valor: number;
		estiloEtiqueta?: IStyleData;
		estiloValor?: IStyleData;
		alto?: number;
	}): number => {
		const eEt = o.estiloEtiqueta ?? etiquetaStyle;
		const eVal = o.estiloValor ?? valorStyle;
		set(r, 0, o.etiqueta, eEt);
		merge(r, 0, o.colValor - 1);
		for (let c = 1; c < o.colValor; c++) stub(r, c, eEt);
		if (o.formula) setFormula(r, o.colValor, o.formula, o.valor, eVal);
		else set(r, o.colValor, o.valor, eVal);
		for (let c = o.colValor + 1; c < numCols; c++) stub(r, c, eEt);
		rowData[r] = { h: o.alto ?? 22 };
		const fila = r;
		r++;
		return fila;
	};

	// ─── Cabecera de la tabla ───────────────────────────────────────────
	const cabeceras = esIngresos ? [...HEADERS, HEADER_INCLUIR] : HEADERS;
	cabeceras.forEach((lbl, i) => {
		set(
			r,
			i,
			lbl,
			i >= COL.V_UNIDAD ? { ...headerStyle, ht: HorizontalAlign.RIGHT } : headerStyle
		);
	});
	rowData[r] = { h: 28 };
	r++;

	// ─── Filas ──────────────────────────────────────────────────────────
	const primeraFila = r;
	if (primeraFila !== PRIMERA_FILA_ITEMS) {
		// La referencia cruzada a la casilla INCLUIR se calcula con
		// `PRIMERA_FILA_ITEMS + idx` (ver la constante): si la tabla dejara de
		// empezar ahí, apuntaría a la fila equivocada de la otra hoja.
		console.warn(
			'[ingresos-builder] la tabla no empieza en PRIMERA_FILA_ITEMS',
			{ primeraFila, esperada: PRIMERA_FILA_ITEMS }
		);
	}
	filas.forEach((f, idx) => {
		// La cebra, solo en INGRESOS. En ADICIONALES las filas no marcadas están
		// escondidas, así que alternar por índice pinta dos claras seguidas en
		// cuanto falta una de por medio; y hacerlo por posición VISIBLE obligaría
		// a repintar la tabla entera cada vez que se marca una casilla, que es
		// justo lo que este diseño evita. Sin cebra la hoja se lee igual: los
		// bordes ya separan las filas.
		const zebra = esIngresos && idx % 2 === 1;
		const base = zebra ? cellZebra : cellBase;
		const prioritaria = esClientePrioritario(f.item.cliente_nombre);

		/**
		 * Pone a una celda de la tabla el fondo que le toca por lo que la fila
		 * SIGNIFICA: verde si baja a adicionales, azul si es de un cliente
		 * prioritario. Las reglas están en `fondoFilaIngresos`.
		 *
		 * Solo en la hoja de INGRESOS, que es donde se decide. En ADICIONALES
		 * estar en la tabla ES la condición de entrada —las no marcadas van
		 * escondidas—, así que pintarlas todas de verde no distinguiría nada:
		 * sería teñir la hoja entera.
		 */
		const conFondo = (s: IStyleData, columna: number): IStyleData =>
			esIngresos
				? ({
						...s,
						bg: {
							rgb: fondoFilaIngresos({
								prioritaria,
								incluida: f.incluida,
								zebra,
								columna
							})
						}
					} as IStyleData)
				: s;

		set(r, COL.EMPRESA, f.item.cliente_nombre, conFondo(empresaStyle(prioritaria), COL.EMPRESA));
		set(
			r,
			COL.DESCRIPCION,
			descripcionDe(f.item),
			conFondo({ ...base, tb: WrapStrategy.CLIP } as IStyleData, COL.DESCRIPCION)
		);
		// FECHAS y PLACA salían pegadas dentro de DESCRIPCION. Con columna
		// propia se pueden leer en vertical —y la placa, ordenar—, que es para
		// lo que se miran.
		set(
			r,
			COL.FECHAS,
			f.item.fechas || '',
			conFondo({ ...base, tb: WrapStrategy.CLIP } as IStyleData, COL.FECHAS)
		);
		set(
			r,
			COL.PLACA,
			f.item.placa || '',
			conFondo({ ...base, ht: HorizontalAlign.CENTER } as IStyleData, COL.PLACA)
		);

		if (esIngresos) {
			// V/UNIDAD es el ingreso que dejó el servicio: dato derivado.
			set(r, COL.V_UNIDAD, f.vUnidad, conFondo(money(base), COL.V_UNIDAD));
		} else {
			// En ADICIONALES el V/UNIDAD es el % de ganancia sobre aquel, y es
			// EDITABLE: el Excel de referencia tiene una fila escrita a mano, y
			// sin poder pisarla habría que retorcer el porcentaje.
			set(r, COL.V_UNIDAD, f.vUnidad, money(editable(base)));
			setIngresosBinding(unitId, sheetId, r, COL.V_UNIDAD, {
				entityType: 'fila',
				entityId: f.item.id,
				field: 'valor_unitario_adicional',
				hoja,
				section: 'tabla'
			});
		}

		// En una fila resaltada, CANT pierde su fondo azul claro de «aquí se
		// escribe» y se queda con el de la fila. Sigue distinguiéndose por el
		// color del texto, que es el mismo azul de siempre.
		set(
			r,
			COL.CANT,
			f.cantidad,
			conFondo({ ...editable(base), ht: HorizontalAlign.RIGHT } as IStyleData, COL.CANT)
		);
		setIngresosBinding(unitId, sheetId, r, COL.CANT, {
			entityType: 'fila',
			entityId: f.item.id,
			field: 'cantidad',
			hoja,
			section: 'tabla'
		});

		// TOTAL = V/UNIDAD × CANT; ADMON = % del TOTAL; V/LIQUIDAR = TOTAL − ADMON.
		// El ADMON se calcula sobre el TOTAL y no sobre el V/UNIDAD —que es lo
		// mismo mientras CANT valga 1— para que siga siendo correcto en cuanto
		// alguien cambie la cantidad.
		const pctAdmon = esIngresos
			? (f.estado?.pct_admon_ingresos ?? pct.admonIngresos)
			: (f.estado?.pct_admon_adicional ?? pct.admonAdicionales);

		// En ADICIONALES están TODOS los servicios del mes y lo que decide si uno
		// aporta o no es su casilla INCLUIR, que vive en la OTRA hoja. El TOTAL
		// la consulta y devuelve cero cuando no está marcada; ADMON y V/LIQUIDAR
		// cuelgan del TOTAL, así que se apagan con él, y con ellos los SUM del
		// pie. Marcar la casilla recalcula la hoja entera sin mover una fila.
		//
		// `LEFT(...,1)="S"` y no `="SÍ"`: la comparación se queda en ASCII y da
		// igual si la celda dice «SÍ», «SI» o llega vacía de un borrado.
		const producto = `${ref(COL.V_UNIDAD, r)}*${ref(COL.CANT, r)}`;
		const rIncluir = input.refIncluir;
		const formulaTotal =
			esIngresos || !rIncluir
				? `=${producto}`
				: `=IF(LEFT('${rIncluir.sheetName}'!${ref(rIncluir.columna, PRIMERA_FILA_ITEMS + idx)},1)="S",${producto},0)`;

		// Valor cacheado: el que va a dar la fórmula. Una fila no marcada aporta
		// cero, y sembrar aquí su importe real dejaría la hoja mostrando un total
		// inflado hasta que el motor terminara el primer recálculo.
		const aporta = esIngresos || f.incluida;
		setFormula(r, COL.TOTAL, formulaTotal, aporta ? f.total : 0, conFondo(money(base), COL.TOTAL));
		// ADMON en rojo y V/LIQUIDAR en verde: lo que se descuenta y lo que
		// queda. Ver `ROJO_ADMON` / `VERDE_LIQUIDAR`.
		setFormula(
			r,
			COL.ADMON,
			`=ROUND(${ref(COL.TOTAL, r)}*${pctAdmon}/100,0)`,
			aporta ? f.admon : 0,
			conFondo(money({ ...base, cl: { rgb: ROJO_ADMON } }), COL.ADMON)
		);
		setFormula(
			r,
			COL.V_LIQUIDAR,
			`=${ref(COL.TOTAL, r)}-${ref(COL.ADMON, r)}`,
			aporta ? f.vLiquidar : 0,
			conFondo(money({ ...base, cl: { rgb: VERDE_LIQUIDAR } }), COL.V_LIQUIDAR)
		);

		if (esIngresos) {
			// SÍ/NO y no un booleano: Univer pinta "true"/"false" literal, y el
			// mismo semáforo que usan los otros canvas hace la hoja legible de un
			// vistazo.
			set(
				r,
				COL.INCLUIR,
				f.incluida ? CHECKBOX_SI : CHECKBOX_NO,
				accion(f.incluida)
			);
			setIngresosBinding(unitId, sheetId, r, COL.INCLUIR, {
				entityType: 'fila',
				entityId: f.item.id,
				field: 'incluir_adicional',
				hoja,
				section: 'tabla'
			});
		}

		rowData[r] = { h: 24 };
		// La fila de un servicio sin marcar existe en ADICIONALES pero no se ve:
		// su sitio está reservado para que marcarlo no desplace nada.
		if (!esIngresos && !f.incluida) rowData[r].hd = BooleanNumber.TRUE;
		r++;
	});
	const ultimaFila = r - 1;
	const hayFilas = ultimaFila >= primeraFila;
	/// Solo tiene sentido en ADICIONALES, que pinta marcados y no marcados.
	const hayMarcados = filas.some((f) => f.incluida);

	/**
	 * Aviso de tabla vacía.
	 *
	 * En INGRESOS aparece solo cuando el mes no trajo ningún servicio.
	 *
	 * En ADICIONALES «vacía» ya no es una cuestión de geometría sino de
	 * visibilidad —la hoja lleva todas las filas y esconde las no marcadas—,
	 * así que el aviso se emite SIEMPRE y se oculta en cuanto hay algo
	 * marcado. Emitirlo solo cuando hace falta lo devolvería todo al punto de
	 * partida: marcar la primera casilla movería una fila.
	 */
	let filaAvisoOcultable: number | null = null;
	if (!hayFilas || !esIngresos) {
		const aviso: IStyleData = {
			fs: 11,
			it: 1,
			cl: { rgb: MUTED },
			bg: { rgb: SUBTLE_BG },
			bd: bordes(),
			ht: HorizontalAlign.CENTER
		};
		set(
			r,
			0,
			hayFilas
				? 'Ningún servicio marcado con INCLUIR en la hoja del mes'
				: 'Sin ingresos de Cotransmeq en este mes',
			aviso
		);
		merge(r, 0, numCols - 1);
		for (let c = 1; c < numCols; c++) stub(r, c, aviso);
		rowData[r] = { h: 30 };
		// Un mes sin ningún servicio no tiene nada que marcar: ese aviso se
		// queda puesto y no es de los que se ocultan.
		if (hayFilas) {
			filaAvisoOcultable = r;
			if (hayMarcados) rowData[r].hd = BooleanNumber.TRUE;
		}
		r++;
	}

	/// Rango de una columna de la tabla, para los SUM del pie. Sin filas el
	/// rango sería inverso (`F3:F2`) y Univer devolvería `#REF!`, así que la
	/// hoja vacía se cablea a 0.
	const sumaDe = (col: number) =>
		hayFilas
			? `=SUM(${ref(col, primeraFila)}:${ref(col, ultimaFila)})`
			: '=0';

	const t = calcularTotales({
		items: filas.map((f) => f.item),
		porItem: new Map(filas.map((f) => [f.item.id, f.estado!]).filter(([, e]) => !!e) as any),
		conceptos,
		pct
	});
	const tot = esIngresos ? t.ingresos : t.adicionales;

	// ─── Pie: cierre de la tabla ────────────────────────────────────────
	const filaFacturado = escribirLinea({
		etiqueta: 'TOTAL FACTURADO',
		colValor: COL.TOTAL,
		formula: sumaDe(COL.TOTAL),
		valor: tot.facturado,
		estiloValor: totalStyle
	});
	// Estas dos cierran las columnas ADMON y V/LIQUIDAR, así que llevan su
	// mismo color: son su suma, no una línea más del pie.
	escribirLinea({
		etiqueta: esIngresos ? 'TOTAL ADMINISTRACION CAMIONETAS' : 'TOTAL ADMINISTRACION',
		colValor: COL.ADMON,
		formula: sumaDe(COL.ADMON),
		valor: tot.admon,
		estiloValor: { ...totalStyle, cl: { rgb: ROJO_ADMON } } as IStyleData
	});
	const filaValorServicio = escribirLinea({
		etiqueta: 'VALOR SERVICIO DE TRANSPORTE',
		colValor: COL.V_LIQUIDAR,
		formula: sumaDe(COL.V_LIQUIDAR),
		valor: tot.valorServicio,
		estiloValor: { ...totalStyle, cl: { rgb: VERDE_LIQUIDAR } } as IStyleData
	});

	// NI PRÉSTAMOS NI HORAS EXTRAS, NI TOTAL GENERAL. Aquí iba el bloque
	// «PRESTAMOS Y PAGO HORAS EXTRAS» del Excel —cuatro filas libres, su
	// totalizador— y detrás un TOTAL GENERAL que se los sumaba al valor del
	// servicio. En este documento no se liquida ninguno de los dos, así que
	// eran cuatro filas vacías por hoja y una línea de total que repetía la
	// anterior. Todo lo que colgaba de TOTAL GENERAL cuelga ahora de VALOR
	// SERVICIO DE TRANSPORTE, que es lo que aquel valía.

	// ─── Pie: personal para la ejecución ────────────────────────────────
	// Solo se pinta si hay conceptos laborales. La plantilla del Excel trae el
	// bloque siempre, con dos personas y todo a cero; replicar eso serían 28
	// filas vacías en cada una de las 24 hojas. Aparece en cuanto haya datos.
	const laborales = conceptos.filter((c) => c.hoja === hoja && c.tipo === 'COSTO_LABORAL');
	const filasLaborales: number[] = [];
	if (laborales.length) {
		escribirBanda('DESCUENTOS POR LA PRESTACION DEL SERVICIO', GREEN_DARK);
		const personas = [...new Set(laborales.map((c) => c.persona || 'PERSONAL'))];
		for (const persona of personas) {
			escribirBanda(`PERSONAL PARA LA EJECUCION · ${persona}`, MUTED);
			for (const c of laborales.filter((x) => (x.persona || 'PERSONAL') === persona)) {
				const fila = escribirLinea({
					etiqueta: c.concepto.replace(/_/g, ' '),
					colValor: COL.V_LIQUIDAR,
					valor: Number(c.valor_total) || 0,
					estiloEtiqueta: cellBase,
					estiloValor: money(editable(cellBase))
				});
				filasLaborales.push(fila);
				if (c.id) {
					setIngresosBinding(unitId, sheetId, fila, COL.V_LIQUIDAR, {
						entityType: 'concepto',
						entityId: c.id,
						field: 'valor_total',
						hoja,
						section: 'personal'
					});
				}
			}
		}
	}

	/**
	 * Fila de concepto del pie: NOMBRE editable e importe editable.
	 *
	 * El nombre es editable porque el pie de este documento no es un catálogo
	 * cerrado. Un mes se descuenta un juego de llantas de un proveedor y al
	 * siguiente el mantenimiento de otro; con las etiquetas fijas no había
	 * dónde escribirlos, y lo que llegaba al canvas era un «PAPELERIA» que
	 * significaba otra cosa. Las filas libres que abre `ensureConceptosIngresos`
	 * («GASTO 1», «ANTICIPO 1»…) están justo para eso.
	 *
	 * La identidad NO es el nombre sino el id del concepto, así que renombrar
	 * una fila la sigue guardando en su mismo registro.
	 */
	const escribirConcepto = (c: ConceptoIngreso, section: string): number => {
		const fila = escribirLinea({
			etiqueta: c.concepto.replace(/_/g, ' '),
			colValor: COL.V_LIQUIDAR,
			valor: Number(c.valor_total) || 0,
			estiloEtiqueta: editable(etiquetaStyle),
			estiloValor: money(editable(cellBase))
		});
		if (c.id) {
			// `escribirLinea` funde las columnas 0..V_LIQUIDAR-1 en la etiqueta,
			// y el ancla de un merge es su celda de arriba a la izquierda: el
			// binding va en la columna 0.
			setIngresosBinding(unitId, sheetId, fila, 0, {
				entityType: 'concepto',
				entityId: c.id,
				field: 'concepto',
				hoja,
				section
			});
			setIngresosBinding(unitId, sheetId, fila, COL.V_LIQUIDAR, {
				entityType: 'concepto',
				entityId: c.id,
				field: 'valor_total',
				hoja,
				section
			});
		}
		return fila;
	};

	/// Conceptos de un tipo en ESTA hoja, en el orden en que los pinta el pie.
	const conceptosDe = (tipo: ConceptoIngreso['tipo']): ConceptoIngreso[] =>
		conceptos
			.filter((c) => c.hoja === hoja && c.tipo === tipo)
			.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

	// ─── Pie: lo que separa a las dos hojas ─────────────────────────────
	let filaBaseDescuentos: number;

	if (esIngresos) {
		// Aquí entra el circuito: lo que se paga por la liquidación de
		// adicionales de este mismo mes. Va como REFERENCIA a la otra hoja y no
		// como número copiado —si no, tocar un adicional dejaría esta cifra
		// mintiendo hasta la siguiente recarga.
		const rAdic = input.refTotalAdicionales;
		const filaDesc = escribirLinea({
			etiqueta: `TOTAL DESCUENTOS LIQUIDACION ADICIONALES ${MESES[input.mes - 1]} ${input.anio}`,
			colValor: COL.V_LIQUIDAR,
			formula: rAdic
				? `='${rAdic.sheetName}'!${ref(COL.V_LIQUIDAR, rAdic.fila0)}`
				: '=0',
			valor: t.adicionales.transportePorPagar,
			estiloEtiqueta: cierreEtiqueta('#FEF3C7', AMBER),
			estiloValor: { ...totalStyle, cl: { rgb: AMBER } } as any,
			alto: 24
		});
		filaBaseDescuentos = escribirLinea({
			etiqueta: 'VALOR SERVICIO DE TRANSPORTE A FACTURAR',
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.V_LIQUIDAR, filaValorServicio)}-${ref(COL.V_LIQUIDAR, filaDesc)}`,
			valor: tot.valorAFacturar,
			estiloValor: totalStyle,
			alto: 24
		});
	} else {
		// En ADICIONALES los descuentos van ANTES de la base imponible: papelería
		// y gastos diversos se restan del total general, y sobre lo que queda se
		// calculan las retenciones.
		escribirBanda('GASTOS DEL VEHICULO', AMBER);
		const filasGasto = conceptosDe('GASTO_OPERATIVO').map((c) =>
			escribirConcepto(c, 'gastos')
		);
		// GASTOS DIVERSOS es una FÓRMULA, no un concepto: el % del facturado más
		// una parte fija (ver `GASTOS_DIVERSOS_FIJO`). Por eso no se guarda en la
		// base — se recalcula.
		const filaDiversos = escribirLinea({
			etiqueta: `GASTOS DIVERSOS (${GASTOS_DIVERSOS_PCT}% del facturado + $${GASTOS_DIVERSOS_FIJO.toLocaleString('es-CO')})`,
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.TOTAL, filaFacturado)}*${GASTOS_DIVERSOS_PCT}/100+${GASTOS_DIVERSOS_FIJO}`,
			valor: tot.gastosDiversos,
			estiloValor: valorStyle
		});
		const sumandos = [...filasLaborales, ...filasGasto, filaDiversos].map((f) =>
			ref(COL.V_LIQUIDAR, f)
		);
		const filaTotalDesc = escribirLinea({
			etiqueta: 'TOTAL DESCUENTOS',
			colValor: COL.V_LIQUIDAR,
			formula: sumandos.length ? `=${sumandos.join('+')}` : '=0',
			valor: tot.descuentos,
			estiloValor: totalStyle
		});
		filaBaseDescuentos = escribirLinea({
			etiqueta: 'VALOR SERVICIO DE TRANSPORTE A FACTURAR',
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.V_LIQUIDAR, filaValorServicio)}-${ref(COL.V_LIQUIDAR, filaTotalDesc)}`,
			valor: tot.valorAFacturar,
			estiloValor: totalStyle,
			alto: 24
		});
	}

	// ─── Pie: impuestos y gastos del vehículo ───────────────────────────
	escribirBanda('IMPUESTOS Y GASTOS DEL VEHICULO', RED);
	const filasDescuentoFinal: number[] = [];

	for (const c of conceptosDe('ANTICIPO')) {
		filasDescuentoFinal.push(escribirConcepto(c, 'anticipos'));
	}

	if (esIngresos) {
		// En la hoja de INGRESOS el bloque de abajo son gastos, no retenciones:
		// esta hoja no retiene nada.
		for (const c of conceptosDe('GASTO_OPERATIVO')) {
			filasDescuentoFinal.push(escribirConcepto(c, 'gastos'));
		}
		// El bloque de personal de esta hoja también es un descuento. En el Excel
		// queda fuera de la última línea —con todo a cero la omisión no se nota—,
		// pero la etiqueta «DESCUENTOS» promete otra cosa: incluirlo da el mismo
		// número hoy y deja de mentir en cuanto alguien rellene el bloque.
		filasDescuentoFinal.push(...filasLaborales);
	} else {
		// Retenciones. Las tres últimas cuelgan de la retención de ICA, no de la
		// base: es lo que dice el Excel (`=+H90*15%`), y calcularlas sobre la
		// base las multiplicaría por cien.
		const impuestos = conceptosDe('IMPUESTO');
		const baseRef = ref(COL.V_LIQUIDAR, filaBaseDescuentos);
		let filaReteIca = -1;

		// La de ICA se pinta primero aunque no sea la primera de la lista: las
		// otras dos la referencian y una fórmula no puede apuntar hacia abajo
		// sin que el primer pintado muestre un cero.
		const ordenadas = [
			...impuestos.filter((c) => c.concepto === 'RETENCION_ICA'),
			...impuestos.filter((c) => c.concepto !== 'RETENCION_ICA')
		];

		for (const c of ordenadas) {
			const pctImp = Number(c.porcentaje) || 0;
			const cuelgaDeIca =
				c.concepto === 'AVISOS_TABLEROS' || c.concepto === 'SOBRETASA_BOMBERIL';
			const origen = cuelgaDeIca && filaReteIca >= 0
				? ref(COL.V_LIQUIDAR, filaReteIca)
				: baseRef;

			set(r, 0, c.concepto.replace(/_/g, ' '), etiquetaStyle);
			merge(r, 0, COL.ADMON - 1);
			for (let cc = 1; cc < COL.ADMON; cc++) stub(r, cc, etiquetaStyle);
			setPercent(r, COL.ADMON, pctImp, {
				...editable(cellBase),
				ht: HorizontalAlign.RIGHT
			} as IStyleData);
			setFormula(r, COL.TOTAL, `=${origen}`, 0, money({ ...cellBase, cl: { rgb: MUTED } }));
			setFormula(
				r,
				COL.V_LIQUIDAR,
				`=${ref(COL.TOTAL, r)}*${ref(COL.ADMON, r)}/100`,
				0,
				money(cellBase)
			);
			rowData[r] = { h: 22 };
			if (c.id) {
				setIngresosBinding(unitId, sheetId, r, COL.ADMON, {
					entityType: 'concepto',
					entityId: c.id,
					field: 'porcentaje',
					hoja,
					section: 'impuestos'
				});
			}
			if (c.concepto === 'RETENCION_ICA') filaReteIca = r;
			filasDescuentoFinal.push(r);
			r++;
		}
	}

	const filaTotalDescuentosFinal = escribirLinea({
		etiqueta: 'TOTAL DESCUENTOS',
		colValor: COL.V_LIQUIDAR,
		formula: filasDescuentoFinal.length
			? `=${filasDescuentoFinal.map((f) => ref(COL.V_LIQUIDAR, f)).join('+')}`
			: '=0',
		valor: esIngresos ? tot.descuentos : (t.adicionales.impuestos ?? 0),
		estiloEtiqueta: cierreEtiqueta('#FEE2E2', RED),
		estiloValor: { ...totalStyle, cl: { rgb: RED } } as any,
		alto: 24
	});

	const filaPorPagar = escribirLinea({
		etiqueta: 'TRANSPORTE POR PAGAR',
		colValor: COL.V_LIQUIDAR,
		formula: `=${ref(COL.V_LIQUIDAR, filaBaseDescuentos)}-${ref(COL.V_LIQUIDAR, filaTotalDescuentosFinal)}`,
		valor: tot.transportePorPagar,
		estiloEtiqueta: cierreEtiqueta('#DCFCE7', GREEN_DARK),
		estiloValor: cierreStyle(GREEN_DARK),
		alto: 28
	});

	let filaTotalFinal = filaPorPagar;

	if (esIngresos) {
		// GASTOS DIVERSOS de esta hoja va DESPUÉS del transporte por pagar (en la
		// de adicionales iba antes). No es una inconsistencia mía: es lo que hace
		// el Excel, y cambiarlo movería el número final.
		const filaDiversos = escribirLinea({
			etiqueta: `GASTOS DIVERSOS (${GASTOS_DIVERSOS_PCT}% del facturado + $${GASTOS_DIVERSOS_FIJO.toLocaleString('es-CO')})`,
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.TOTAL, filaFacturado)}*${GASTOS_DIVERSOS_PCT}/100+${GASTOS_DIVERSOS_FIJO}`,
			valor: tot.gastosDiversos,
			estiloValor: valorStyle
		});
		filaTotalFinal = escribirLinea({
			etiqueta: `TOTAL INGRESO COTRANSMEQ ${MESES[input.mes - 1]} ${input.anio}`,
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.V_LIQUIDAR, filaPorPagar)}-${ref(COL.V_LIQUIDAR, filaDiversos)}`,
			valor: (tot as any).totalIngresoTransmeralda ?? 0,
			estiloEtiqueta: cierreEtiqueta('#0F4025', '#FFFFFF'),
			estiloValor: cierreStyle(GREEN),
			alto: 30
		});
	} else {
		filaTotalFinal = escribirLinea({
			etiqueta: 'TOTAL A PAGAR',
			colValor: COL.V_LIQUIDAR,
			formula: `=${ref(COL.V_LIQUIDAR, filaPorPagar)}`,
			valor: tot.transportePorPagar,
			estiloEtiqueta: cierreEtiqueta('#0F4025', '#FFFFFF'),
			estiloValor: cierreStyle(GREEN),
			alto: 30
		});
	}

	// ─── Cierre de la hoja ──────────────────────────────────────────────
	// El ancla de la zona libre va DEBAJO de todo el bloque estructurado. Si se
	// pusiera al final de la tabla, las celdas del pie sin binding se tratarían
	// como anotaciones y `aplicarCapa` las reescribiría como texto, borrando su
	// fórmula: los totales se congelarían en cero.
	const filaLibreDesde = r + 2;
	const totalRows = filaLibreDesde + FILAS_ANOTABLES;
	rellenarBordesVacios(cellData, totalRows, numCols, mergeData);
	registrarHojaEditable(unitId, sheetId, { finItems: filaLibreDesde, soloDebajo: true });
	aplicarCapa(cellData, unitId, sheetId, input.anotaciones);

	return {
		filaTotalFinal,
		// Solo la hoja de INGRESOS tiene columna INCLUIR, y solo si llegó a
		// pintar filas: un mes vacío no tiene nada que marcar.
		rangoIncluir:
			esIngresos && hayFilas ? { desde: primeraFila, hasta: ultimaFila } : null,
		filaAvisoOcultable,
		sheet: {
			id: sheetId,
			name: input.sheetName,
			tabColor: esIngresos ? GREEN : AMBER,
			hidden: BooleanNumber.FALSE,
			// Header congelado: los meses con muchos servicios se recorren enteros
			// y sin esto se pierde de vista qué columna es cuál.
			freeze: { startRow: 1, startColumn: 0, ySplit: 1, xSplit: 0 },
			rowCount: totalRows,
			columnCount: numCols,
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
		}
	};
}

// ═══════════════════════════════════════════════════════════════════════
// LIBRO DEL MES
// ═══════════════════════════════════════════════════════════════════════

export interface IngresosMesInput {
	anio: number;
	/** Mes (1..12) del que se emiten las dos hojas. */
	mes: number;
	/** Filas derivadas por mes, claves 1..12. Solo se usa la del mes emitido. */
	filasPorMes: Record<number, IngresoTerceroRow[]>;
	/** Capa editable por mes: cabecera, overrides y conceptos del pie. */
	estadoPorMes: Record<number, EstadoIngresoMes>;
	/// Notas libres por mes y hoja: `{ [mes]: { [sheet_key]: CeldaDeCapa[] } }`.
	/// La `sheet_key` distingue las dos hojas del mes: '' es la de INGRESOS y
	/// 'adic' la de ADICIONALES.
	anotaciones?: Record<number, Record<string, CeldaDeCapa[]>>;
}

/// `sheet_key` de la capa de anotaciones para cada hoja de un mes.
export function sheetKeyDeHoja(hoja: HojaIngreso): string {
	return hoja === 'INGRESOS' ? '' : 'adic';
}

/**
 * Dónde cayó cada cosa que el INCLUIR mueve, para poder reflejarlo en caliente.
 *
 * Marcar una casilla ya no reconstruye el libro (ver el encabezado): quien la
 * marca tiñe la celda y esconde o enseña la fila de la hoja de adicionales, y
 * para eso necesita saber en qué fila está cada servicio. Lo publica el builder
 * y no lo deduce el engine: recalcularlo fuera sería una segunda copia de la
 * geometría de la hoja.
 */
export interface GeometriaIncluirMes {
	/// `liquidacion_tercero_id` → fila 0-based. La MISMA en las dos hojas.
	filaPorItem: Record<string, number>;
	/// Estado de INCLUIR con el que se pintó el libro, para saber qué cambió.
	incluidoPorItem: Record<string, boolean>;
	/// Servicios de un cliente PRIORITARIO: su resaltado es azul y no verde.
	/// Se publica porque el repintado en caliente lo necesita y el nombre del
	/// cliente ya no está a mano cuando alguien marca una casilla.
	prioritarioPorItem: Record<string, boolean>;
	/// Fila del aviso «ningún servicio marcado» de ADICIONALES, si es ocultable.
	filaAvisoAdicionales: number | null;
	/// Columnas de la hoja de ADICIONALES, para los rangos de fila completos.
	columnasAdicionales: number;
}

/**
 * Construye el libro de UN MES: la hoja de INGRESOS y la de ADICIONALES.
 *
 * Se sigue devolviendo un mapa por mes —con una sola clave— porque el engine y
 * la página resuelven `sheetId → mes` con él, y un cambio de mes es un libro
 * nuevo: nada tiene que saber si dentro hay uno o doce.
 */
export function buildIngresosMesWorkbook(input: IngresosMesInput): {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorMes: Record<number, string>;
	adicionalesSheetIdPorMes: Record<number, string>;
	/**
	 * Filas de la columna INCLUIR por mes, para que el engine le cuelgue el
	 * checkbox. Un mes sin filas no aparece.
	 */
	rangoIncluirPorMes: Record<number, { desde: number; hasta: number }>;
	/// Geometría de lo que mueve el INCLUIR, por mes. Ver `GeometriaIncluirMes`.
	geometriaIncluirPorMes: Record<number, GeometriaIncluirMes>;
} {
	const { anio, mes } = input;
	const unitId = ingresosUnitId(anio, mes);

	const idIngresos = ingresosSheetId(mes);
	const idAdic = adicionalesSheetId(mes);
	const sheetIdPorMes: Record<number, string> = { [mes]: idIngresos };
	const adicionalesSheetIdPorMes: Record<number, string> = { [mes]: idAdic };
	const rangoIncluirPorMes: Record<number, { desde: number; hasta: number }> = {};

	const estado = input.estadoPorMes[mes] ?? {
		cabecera: null,
		filas: [],
		conceptos: []
	};
	const pct = porcentajesDe(estado.cabecera);
	const conceptos = ensureConceptosIngresos(
		estado.conceptos ?? [],
		alcanceIngresos(anio, mes)
	);
	const items = ordenarFilasIngresos(input.filasPorMes[mes] ?? []);
	const porItem = indexarFilas(estado.filas ?? []);
	const { filasIngresos, filasAdicionalesTodas } = calcularTotales({
		items,
		porItem,
		conceptos,
		pct
	});

	// La de ADICIONALES primero: la de INGRESOS necesita saber en qué fila
	// acabó su TOTAL A PAGAR para referenciarlo (ver el encabezado). Lleva
	// TODOS los servicios del mes, marcados o no, y esconde los que no lo
	// están, para que marcar uno no cambie la geometría de la hoja.
	const adic = construirHoja({
		unitId,
		sheetId: idAdic,
		sheetName: SHEET_NAME_ADICIONALES,
		anio,
		mes,
		hoja: 'ADICIONALES',
		filas: filasAdicionalesTodas,
		conceptos,
		pct,
		anotaciones: input.anotaciones?.[mes]?.['adic'] ?? [],
		refIncluir: { sheetName: SHEET_NAME_INGRESOS, columna: COL.INCLUIR }
	});
	const ing = construirHoja({
		unitId,
		sheetId: idIngresos,
		sheetName: SHEET_NAME_INGRESOS,
		anio,
		mes,
		hoja: 'INGRESOS',
		filas: filasIngresos,
		conceptos,
		pct,
		anotaciones: input.anotaciones?.[mes]?.[''] ?? [],
		refTotalAdicionales: {
			sheetName: SHEET_NAME_ADICIONALES,
			fila0: adic.filaTotalFinal
		}
	});

	if (ing.rangoIncluir) rangoIncluirPorMes[mes] = ing.rangoIncluir;

	// La fila de cada servicio se deriva del ORDEN de `items`, no de recorrer
	// las hojas: es la misma lista con la que se pintaron las dos, así que no
	// hay forma de que este mapa y lo pintado discrepen.
	const filaPorItem: Record<string, number> = {};
	const incluidoPorItem: Record<string, boolean> = {};
	const prioritarioPorItem: Record<string, boolean> = {};
	items.forEach((it, i) => {
		filaPorItem[it.id] = PRIMERA_FILA_ITEMS + i;
		incluidoPorItem[it.id] = porItem.get(it.id)?.incluir_adicional === true;
		prioritarioPorItem[it.id] = esClientePrioritario(it.cliente_nombre);
	});
	const geometriaIncluirPorMes: Record<number, GeometriaIncluirMes> = {
		[mes]: {
			filaPorItem,
			incluidoPorItem,
			prioritarioPorItem,
			filaAvisoAdicionales: adic.filaAvisoOcultable,
			columnasAdicionales: COLS_ADICIONALES
		}
	};

	const workbook: IWorkbookData = {
		id: unitId,
		name: `Ingresos Cotransmeq ${MESES[mes - 1]} ${anio}`,
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder: [idIngresos, idAdic],
		sheets: { [idIngresos]: ing.sheet, [idAdic]: adic.sheet }
	};

	return {
		workbook,
		unitId,
		sheetIdPorMes,
		adicionalesSheetIdPorMes,
		rangoIncluirPorMes,
		geometriaIncluirPorMes
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * DESCRIPCION de una fila: el recorrido del servicio, y nada más.
 *
 * Antes concatenaba también las fechas y la placa, porque dos servicios del
 * mismo cliente y recorrido son indistinguibles sin ellos. Ahora las dos
 * tienen COLUMNA PROPIA (`COL.FECHAS`, `COL.PLACA`): se sigue pudiendo
 * decidir cuál se marca, y además se pueden leer en vertical y ordenar por
 * placa, que dentro de una cadena concatenada no se podía.
 */
function descripcionDe(it: IngresoTerceroRow): string {
	return it.recorrido || '';
}
