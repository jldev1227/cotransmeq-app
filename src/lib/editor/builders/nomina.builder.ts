/**
 * Construye el libro de nómina de un periodo: una hoja por conductor, en
 * orden alfabético, replicando la estructura de los Excel que hasta ahora se
 * montaban a mano.
 *
 * CINCO ZONAS por hoja, las mismas del Excel:
 *
 *   A  Tabla de días (arriba)      — un día por columna: turno, horas,
 *                                    disponibilidad y las siete filas de
 *                                    recargo, resaltadas por tipo.
 *   B  Configuración (abajo izq.)  — tarifas vigentes y acumulado por tipo.
 *   C  Empresas (abajo izq., más)  — un bloque por empresa y mes, con los
 *                                    días agrupados en texto.
 *   D  Jornada (abajo centro)      — topes legales y horas por semana.
 *   E  Desprendible (abajo dcha.)  — devengos, deducciones y neto.
 *
 * Debajo de la fila 22 las columnas de los días quedan libres, así que las
 * zonas B, C, D y E conviven en el mismo rango de columnas sin estorbarse.
 * Es lo que hace el Excel y por eso la hoja cabe en un ancho razonable.
 *
 * Lo único EDITABLE es el desprendible y las dos constantes de
 * disponibilidad; todo lo demás es derivado de las planillas y se registra
 * sin binding, de modo que `cell-permission-nomina` lo bloquea por defecto.
 */

import {
	BooleanNumber,
	HorizontalAlign,
	LocaleType,
	VerticalAlign,
	type ICellData,
	type IStyleData,
	type IWorkbookData,
	type IWorksheetData
} from '@univerjs/core';
import { allBorders, colLetra, comoTexto, GREEN, MUTED, TEXT_DARK, TOTALES_BG } from './historial-comun';
import { rellenarBordesVacios } from './relleno-bordes';
import { setNominaBinding, type NominaBinding } from '../business/nomina-cell-binding';
import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';

// ─── Tipos de entrada (espejo de `nomina-canvas.types.ts` del backend) ───

export type CodigoRecargo = 'RN' | 'HEN' | 'HED' | 'HEFD' | 'HEFN' | 'RD' | 'RNDF';

export interface DiaPeriodoDTO {
	fecha: string;
	dia: number;
	mes: number;
	anio: number;
	nombreMes: string;
	nombreDia: string;
	esDomingo: boolean;
	indice: number;
}

export interface SemanaDTO {
	etiqueta: string;
	indices: number[];
}

export interface DiaHojaDTO {
	indice: number;
	fecha: string;
	horaInicio: number | null;
	horaFin: number | null;
	totalHoras: number;
	esFestivo: boolean;
	esDomingo: boolean;
	disponibilidad: boolean;
	pernocte: boolean;
	horas: Partial<Record<CodigoRecargo, number>>;
	empresa: string | null;
	empresaId: string | null;
	empresaColor: string | null;
}

export interface ClienteNominaDTO {
	id: string;
	nombre: string;
	color: string;
}

export interface TarifaDTO {
	codigo: CodigoRecargo;
	nombre: string;
	color: string;
	porcentaje: number;
	valorHora: number;
	horas: number;
	valor: number;
}

export interface BloqueEmpresaDTO {
	empresaId: string;
	empresa: string;
	color: string;
	mes: number;
	anio: number;
	textoDias: string;
	dias: number[];
	lineas: { codigo: CodigoRecargo; nombre: string; horas: number; valor: number }[];
	totalHoras: number;
	totalValor: number;
}

export interface ConceptoDTO {
	clave: string;
	nombre: string;
	cantidad: number | null;
	valor: number;
	editable: boolean;
}

export interface HojaNominaDTO {
	conductorId: string;
	liquidacionId: string | null;
	version: number;
	estado: string;
	nombre: string;
	cedula: string | null;
	cargo: string;
	nombreHoja: string;
	tipoVehiculo: string | null;
	placas: string[];
	dias: DiaHojaDTO[];
	tarifas: TarifaDTO[];
	bloquesEmpresa: BloqueEmpresaDTO[];
	salarioBasico: number;
	valorHora: number;
	horasMensualesBase: number;
	totalHorasMes: number;
	repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
	repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];
	devengos: ConceptoDTO[];
	deducciones: ConceptoDTO[];
	totales: Record<string, number>;
	clientes: ClienteNominaDTO[];
	avisos: string[];
}

export interface PeriodoNominaDTO {
	anio: number;
	mes: number;
	corte: number;
	etiqueta: string;
	periodo: { dias: DiaPeriodoDTO[]; semanas: SemanaDTO[] };
	disponibilidad: { horasBase: number; horasDescuento: number };
	topes: { horasSemanales: number; horasMensuales: number; horasExtrasMes: number };
	hojas: HojaNominaDTO[];
	clientes?: ClienteNominaDTO[];
	avisos: string[];
}

// ─── Geometría ────────────────────────────────────────────────────────

/** Columnas fijas de la izquierda. Nunca índices crudos en el código. */
export const COL = {
	NUM: 0,
	NOMBRE: 1,
	CEDULA: 2,
	CARGO: 3,
	VEHICULO: 4,
	PLACA: 5,
	PLACA_FIN: 6,
	/** Primera columna de día. */
	DIA0: 7
} as const;

/** Filas de la zona A, 0-indexadas. */
const FILA = {
	CAB_MES: 1,
	CAB_MES_FIN: 2,
	CAB_DIA: 3,
	CAB_NOMBRE_DIA: 4,
	TURNO: 5,
	INICIO: 6,
	FIN: 7,
	HORAS: 8,
	DISPONIBILIDAD: 9,
	/** Primera de las siete filas de recargo. */
	RECARGO0: 10,
	/**
	 * Cliente del día. Antes llevaba el NOMBRE de la empresa, pero con 31
	 * columnas de 46px no cabía —salía «FIPETRO», «TRANSMERAL»— y encima
	 * repetía en cada día lo que el bloque de abajo ya dice. Ahora la celda
	 * solo se rellena con el color del cliente y quién es cada color lo dice
	 * la leyenda de la fila 21.
	 */
	CLIENTE_DIA: 17,
	TOTALES_TURNO: 19,
	LEYENDA: 20
} as const;

/** Primera fila de la mitad inferior (config, empresas, jornada, desprendible). */
const FILA_INFERIOR = 22;

/** Orden de las siete filas de recargo, el mismo del Excel. */
export const ORDEN_RECARGOS: CodigoRecargo[] = ['RN', 'HEN', 'HED', 'HEFD', 'HEFN', 'RD', 'RNDF'];

/**
 * Columnas de las zonas inferiores. Se apoyan en que, por debajo de la fila
 * 22, las columnas de los días quedan libres.
 *
 * ⚠️ TODAS LAS COLUMNAS DE DÍA MIDEN LO MISMO Y NINGUNA SE ENSANCHA. El ancho
 * es una propiedad de la COLUMNA ENTERA: ensanchar la N para que quepa
 * «SEMANA DEL 27 DE JULIO AL 2 DE AGOSTO» ensanchaba también el día 27 de la
 * tabla de arriba, y la cuadrícula quedaba con columnas de distinto tamaño
 * salteadas. Aquí los rótulos largos ganan sitio COMBINANDO celdas, que es lo
 * que hace el Excel y lo único que no deforma la rejilla.
 */
const ZONA = {
	CONFIG_C0: 1, // B — columnas propias, no son de día
	/** Arrancaba en la 13 y dejaba un hueco muerto entre el bloque de
	 *  configuración (que acaba en la 6) y esta zona. */
	JORNADA_C0: 9,
	DESPRENDIBLE_C0: 24
} as const;

/** Celdas que ocupa cada campo de las zonas inferiores. */
const SPAN = {
	/** Rótulo de una fila de topes / semana. */
	JORNADA_LABEL: 5,
	/** Su valor. */
	JORNADA_VALOR: 2,
	/** La barra de título de la zona. No abarca la tabla entera a propósito:
	 *  es un rótulo, no una cabecera de columnas. */
	JORNADA_TITULO: 7,
	/** Código de recargo en la tabla de reparto. */
	REPARTO_COD: 2,
	/** Columna de horas. Tres celdas porque sus cabeceras son «DESPRENDIBLE»
	 *  y «DISPONIBILIDAD», que en dos se quedaban cortadas. */
	REPARTO_HORAS: 3,
	REPARTO_VALOR: 2,
	/** Nombre del concepto en la columna de DEVENGOS. Es la más larga:
	 *  «RECARGO NOCTURNO DOMINICAL O FESTIVO - RNDF». */
	DESP_CONCEPTO: 6,
	/** Nombre del concepto en DEDUCCIONES: SALUD, PENSION, ANTICIPOS. Con seis
	 *  columnas ocupaba media hoja para escribir siete letras. */
	DESP_DED_CONCEPTO: 3,
	DESP_CANT: 1,
	/** Un importe con formato («$1.750.905») cabe en dos columnas. */
	DESP_VALOR: 2
} as const;

/** Ancho total en columnas de cada zona, para dimensionar la hoja. */
const ANCHO_JORNADA =
	SPAN.REPARTO_COD + SPAN.REPARTO_HORAS + SPAN.REPARTO_VALOR * 2 + SPAN.REPARTO_HORAS;
const ANCHO_DESPRENDIBLE =
	SPAN.DESP_CONCEPTO +
	SPAN.DESP_CANT +
	SPAN.DESP_VALOR +
	SPAN.DESP_DED_CONCEPTO +
	SPAN.DESP_VALOR;

const ANCHO_COL_DIA = 46;
const MIN_COLUMNAS = 27;

// ─── Estilos ──────────────────────────────────────────────────────────

const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
/**
 * Las horas van SIN patrón a propósito.
 *
 * Univer 0.25.1 renderiza los decimales opcionales de `#,##0.##` dejando el
 * punto cuando el número es entero: 178 sale como «178.» y 35 % como «35.%».
 * Excel no lo hace, pero aquí lo que se ve es Univer. Sin patrón, 178 sale
 * «178» y 12,5 sale «12.5», que es lo que se quiere. Por eso los builders que
 * ya funcionan solo usan patrones sin decimales opcionales (`"$"#,##0`,
 * `0.00"%"`).
 */
const FMT_HORAS = undefined;
const FMT_PCT = '0.00"%"';

const base = (): IStyleData => ({
	bd: allBorders(),
	vt: VerticalAlign.MIDDLE,
	cl: { rgb: TEXT_DARK },
	fs: 10
});

const cabecera = (bg = GREEN): IStyleData => ({
	...base(),
	bg: { rgb: bg },
	cl: { rgb: '#FFFFFF' },
	bl: 1,
	ht: HorizontalAlign.CENTER
});

const etiqueta = (): IStyleData => ({ ...base(), bl: 1, cl: { rgb: MUTED } });

const numero = (fmt: string): IStyleData => ({ ...base(), ht: HorizontalAlign.RIGHT });

const totales = (): IStyleData => ({ ...base(), bg: { rgb: TOTALES_BG }, bl: 1 });

/**
 * Celda derivada: fondo apenas gris. Es la señal de que ese número viene de
 * las planillas y no se teclea aquí; sin ella, el usuario intenta corregir el
 * recargo en el desprendible y el canvas se lo rechaza sin que entienda por qué.
 */
/**
 * Festivos. Es el mismo ámbar que usa el desprendible en PDF («Los días
 * dominicales o festivos se resaltan en naranja»), para que la hoja y el
 * papel señalen lo mismo del mismo color.
 */
const FESTIVO_BG = '#FEF3C7';
const FESTIVO_TEXTO = '#92400E';
const FESTIVO_CABECERA = '#B45309';

const DERIVADA_BG = '#F8FAFC';
const derivada = (): IStyleData => ({ ...base(), bg: { rgb: DERIVADA_BG } });

/** Celda que sí se teclea: blanca y con el borde algo más marcado. */
const EDITABLE_BG = '#FFFFFF';
const editable = (): IStyleData => ({ ...base(), bg: { rgb: EDITABLE_BG } });

// ─── Construcción ─────────────────────────────────────────────────────

export function nominaSheetId(conductorId: string): string {
	return `nomina-${conductorId}`;
}

export interface ResultadoBuild {
	workbook: IWorkbookData;
	unitId: string;
	/** `conductorId → sheetId`, para activar hoja sin remontar. */
	sheetIdPorConductor: Record<string, string>;
	/** `sheetId → conductorId`, para resolver el destino de un comando. */
	conductorPorSheetId: Record<string, string>;
}

export function buildNominaWorkbook(dto: PeriodoNominaDTO): ResultadoBuild {
	const unitId = `nomina-${dto.anio}-${dto.mes}`;
	const dias = dto.periodo.dias;
	// La leyenda de clientes se escribe hacia la derecha a razón de 4 columnas
	// por cliente (nombre en dos, color en una, hueco en una). Con muchos
	// clientes se sale del ancho de los días, así que la hoja tiene que ser al
	// menos tan ancha como la leyenda más larga del libro.
	// Festivos del periodo, calculados UNA vez para todo el libro.
	// `obtenerFestivosCompletos` recalcula el año entero en cada llamada; con
	// 31 días × 24 conductores serían 744 recálculos.
	const festivos = festivosDelPeriodo(dias);

	const maxClientes = dto.hojas.reduce((m, h) => Math.max(m, h.clientes?.length ?? 0), 0);
	const numColumnas = Math.max(
		COL.DIA0 + dias.length,
		COL.DIA0 + maxClientes * 4,
		// Las zonas de abajo ya no ensanchan columnas: ganan sitio combinando
		// celdas, así que la hoja tiene que tener columnas suficientes.
		ZONA.JORNADA_C0 + ANCHO_JORNADA,
		ZONA.DESPRENDIBLE_C0 + ANCHO_DESPRENDIBLE,
		MIN_COLUMNAS
	);

	const sheets: Record<string, Partial<IWorksheetData>> = {};
	const sheetOrder: string[] = [];
	const sheetIdPorConductor: Record<string, string> = {};
	const conductorPorSheetId: Record<string, string> = {};

	dto.hojas.forEach((hoja, i) => {
		const sheetId = nominaSheetId(hoja.conductorId);
		sheetOrder.push(sheetId);
		sheetIdPorConductor[hoja.conductorId] = sheetId;
		conductorPorSheetId[sheetId] = hoja.conductorId;
		sheets[sheetId] = construirHoja({
			dto,
			hoja,
			indice: i + 1,
			sheetId,
			unitId,
			numColumnas,
			festivos
		});
	});

	// Un libro sin hojas no lo acepta Univer: mejor una hoja que lo explique
	// que un error de consola.
	if (!sheetOrder.length) {
		const sheetId = 'nomina-vacio';
		sheetOrder.push(sheetId);
		sheets[sheetId] = hojaVacia(dto);
	}

	return {
		workbook: {
			id: unitId,
			name: `Nómina ${dto.etiqueta}`,
			appVersion: '0.25.1',
			locale: LocaleType.ES_ES,
			styles: {},
			sheetOrder,
			sheets
		} as IWorkbookData,
		unitId,
		sheetIdPorConductor,
		conductorPorSheetId
	};
}

function hojaVacia(dto: PeriodoNominaDTO): Partial<IWorksheetData> {
	const cellData: Record<number, Record<number, ICellData>> = {
		1: {
			1: {
				v: `No hay conductores en nómina para ${dto.etiqueta}.`,
				s: { ...base(), bl: 1 }
			}
		}
	};
	return {
		id: 'nomina-vacio',
		name: 'Sin conductores',
		rowCount: 10,
		columnCount: 10,
		cellData,
		mergeData: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 8 }],
		showGridlines: BooleanNumber.FALSE
	};
}

function construirHoja(args: {
	dto: PeriodoNominaDTO;
	hoja: HojaNominaDTO;
	indice: number;
	sheetId: string;
	unitId: string;
	numColumnas: number;
	/** Fechas ISO festivas del periodo. */
	festivos: Set<string>;
}): Partial<IWorksheetData> {
	const { dto, hoja, indice, sheetId, unitId, numColumnas, festivos } = args;
	const dias = dto.periodo.dias;

	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] = [];

	const set = (r: number, c: number, cell: ICellData) => {
		(cellData[r] ??= {})[c] = cell;
	};
	const merge = (r1: number, c1: number, r2: number, c2: number) => {
		mergeData.push({ startRow: r1, endRow: r2, startColumn: c1, endColumn: c2 });
	};
	const bind = (r: number, c: number, binding: NominaBinding) => {
		setNominaBinding(unitId, sheetId, r, c, binding);
	};

	// Índice por columna de los días con planilla, para no buscar en bucle.
	const porIndice = new Map<number, DiaHojaDTO>(hoja.dias.map((d) => [d.indice, d]));

	zonaDias({ dias, hoja, porIndice, set, merge, indice, dto, festivos });

	// Un día que la ley marca como festivo pero la planilla no, se paga como
	// día normal: sin RD ni RNDF. Es dinero, y no salta por ningún lado.
	const festivosSinMarcar = hoja.dias
		.filter((d) => festivos.has(d.fecha) && !d.esFestivo)
		.map((d) => d.fecha);
	const avisosHoja = [...hoja.avisos];
	if (festivosSinMarcar.length) {
		avisosHoja.push(
			`Festivo(s) sin marcar en la planilla: ${festivosSinMarcar.join(', ')}. ` +
				'Esos días se liquidaron como ordinarios, sin recargo dominical ni festivo.'
		);
	}
	const finConfig = zonaConfiguracion({ hoja, set, merge });
	const finEmpresas = zonaEmpresas({ hoja, set, merge, desdeFila: finConfig + 2 });
	zonaJornada({ dto, hoja, set, merge });
	const finDesprendible = zonaDesprendible({ hoja, set, merge, bind, avisos: avisosHoja });

	const rowCount = Math.max(finEmpresas, finDesprendible) + 3;

	const columnData: Record<number, { w: number }> = {};
	columnData[COL.NUM] = { w: 32 };
	columnData[COL.NOMBRE] = { w: 210 };
	columnData[COL.CEDULA] = { w: 100 };
	columnData[COL.CARGO] = { w: 90 };
	columnData[COL.VEHICULO] = { w: 118 };
	columnData[COL.PLACA] = { w: 96 };
	// Aquí van los rótulos de las filas del bloque de días («DISPONIBILIDAD»,
	// «EMPRESA») y, más abajo, los nombres largos de recargo.
	columnData[COL.PLACA_FIN] = { w: 104 };
	// TODAS las columnas de día miden lo mismo, sin excepción. Las zonas de
	// abajo comparten estas columnas y ganan sitio combinando celdas, nunca
	// ensanchándolas: un ancho es de la columna entera y deformaría la
	// cuadrícula de días de arriba.
	for (let c = COL.DIA0; c < numColumnas; c++) columnData[c] = { w: ANCHO_COL_DIA };

	cerrarBordesDeCombinadas(cellData, mergeData);
	rellenarBordesVacios(cellData, rowCount, numColumnas, mergeData);

	return {
		id: sheetId,
		name: hoja.nombreHoja,
		tabColor: colorDePestana(hoja.estado),
		hidden: BooleanNumber.FALSE,
		// Solo se congelan las FILAS de cabecera. Las columnas A-G iban
		// congeladas y estorbaban: ocupan casi la mitad del ancho útil, y al
		// desplazarse por los días o por los bloques de abajo se llevaban por
		// delante el espacio de lo que se estaba mirando.
		freeze: {
			startRow: FILA.CAB_NOMBRE_DIA + 1,
			startColumn: 0,
			ySplit: FILA.CAB_NOMBRE_DIA + 1,
			xSplit: 0
		},
		rowCount,
		columnCount: numColumnas,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 90,
		defaultRowHeight: 20,
		mergeData,
		cellData,
		rowData: {},
		columnData,
		rowHeader: { width: 40 },
		columnHeader: { height: 22 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};
}

/** Color de pestaña por estado. Espejo de `nomina-estado.ts`. */
function colorDePestana(estado: string): string {
	switch (estado) {
		case 'LIQUIDADA':
			return '#0EA5E9';
		case 'APROBADA':
			return '#16A34A';
		case 'PAGADA':
			return '#0F4025';
		case 'ANULADA':
			return '#B91C1C';
		default:
			return '#94A3B8';
	}
}

// ─── Zona A: tabla de días ────────────────────────────────────────────

function zonaDias(args: {
	dias: DiaPeriodoDTO[];
	hoja: HojaNominaDTO;
	porIndice: Map<number, DiaHojaDTO>;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	indice: number;
	dto: PeriodoNominaDTO;
	festivos: Set<string>;
}) {
	const { dias, hoja, porIndice, set, merge, indice, dto, festivos } = args;

	// Cabecera izquierda: rótulos arriba (filas 1-4), datos debajo (5-8).
	const rotulos: [number, string][] = [
		[COL.NUM, '#'],
		[COL.NOMBRE, 'NOMBRES Y APELLIDOS'],
		[COL.CEDULA, 'CEDULA'],
		[COL.CARGO, 'CARGO'],
		[COL.VEHICULO, 'TIPO DE VEHICULO'],
		[COL.PLACA, 'PLACA']
	];
	for (const [c, texto] of rotulos) {
		set(FILA.CAB_MES, c, { v: texto, s: cabecera() });
		merge(FILA.CAB_MES, c, FILA.CAB_NOMBRE_DIA, c === COL.PLACA ? COL.PLACA_FIN : c);
	}

	const datos: [number, ICellData][] = [
		[COL.NUM, { v: indice, s: { ...base(), ht: HorizontalAlign.CENTER } }],
		[COL.NOMBRE, comoTexto({ v: hoja.nombre, s: { ...base(), bl: 1 } })],
		[COL.CEDULA, comoTexto({ v: hoja.cedula ?? '', s: base() })],
		[COL.CARGO, comoTexto({ v: hoja.cargo, s: base() })],
		[COL.VEHICULO, comoTexto({ v: hoja.tipoVehiculo ?? '', s: base() })],
		[COL.PLACA, comoTexto({ v: hoja.placas.join(', '), s: base() })]
	];
	for (const [c, cell] of datos) {
		set(FILA.TURNO, c, cell);
		merge(FILA.TURNO, c, FILA.HORAS, c === COL.PLACA ? COL.PLACA_FIN : c);
	}

	// Fila de mes: un merge por tramo de mes seguido.
	let tramoInicio = 0;
	for (let i = 0; i <= dias.length; i++) {
		const cambia = i === dias.length || dias[i].mes !== dias[tramoInicio].mes;
		if (!cambia) continue;
		const d = dias[tramoInicio];
		const c1 = COL.DIA0 + tramoInicio;
		const c2 = COL.DIA0 + i - 1;
		set(FILA.CAB_MES, c1, { v: `${d.nombreMes} ${d.anio}`, s: cabecera() });
		merge(FILA.CAB_MES, c1, FILA.CAB_MES_FIN, c2);
		tramoInicio = i;
	}

	// Rótulos de las filas 5-17, en la columna de la placa (ya libre ahí).
	const rotulosFila: [number, string][] = [
		[FILA.TURNO, 'TURNO'],
		[FILA.INICIO, 'HORA INICIO'],
		[FILA.FIN, 'HORA FIN'],
		[FILA.HORAS, 'TOTAL HORAS'],
		[FILA.DISPONIBILIDAD, 'DISPONIBILIDAD'],
		[FILA.CLIENTE_DIA, 'CLIENTE']
	];
	for (const [r, texto] of rotulosFila) {
		if (r === FILA.TURNO) continue; // ocupado por los datos del conductor
		set(r, COL.PLACA_FIN, { v: texto, s: etiqueta() });
	}
	ORDEN_RECARGOS.forEach((codigo, i) => {
		const tarifa = hoja.tarifas.find((t) => t.codigo === codigo);
		set(FILA.RECARGO0 + i, COL.PLACA_FIN, {
			v: codigo,
			s: {
				...etiqueta(),
				bg: { rgb: tarifa?.color ?? '#E2E8F0' },
				ht: HorizontalAlign.CENTER,
				cl: { rgb: contraste(tarifa?.color ?? '#E2E8F0') }
			}
		});
	});

	// Una columna por día.
	for (const d of dias) {
		const c = COL.DIA0 + d.indice;
		const dh = porIndice.get(d.indice);
		const domingo = d.esDomingo;
		// Festivo según el calendario colombiano (`festivosColombia.ts`), no
		// según la marca de la planilla: la ley no depende de que alguien la
		// tecleara. Cuando las dos no coinciden, la hoja lo avisa.
		const festivo = festivos.has(d.fecha);

		// En un día festivo las celdas van en ámbar, el mismo que usa el PDF.
		const celdaDia = (): IStyleData =>
			festivo
				? { ...base(), bg: { rgb: FESTIVO_BG }, cl: { rgb: FESTIVO_TEXTO } }
				: derivada();

		set(FILA.CAB_DIA, c, {
			v: d.dia,
			s: { ...cabecera(festivo ? FESTIVO_CABECERA : domingo ? '#7F1D1D' : GREEN), fs: 10 }
		});
		set(FILA.CAB_NOMBRE_DIA, c, {
			v: d.nombreDia.slice(0, 3),
			s: { ...cabecera(festivo ? '#92400E' : domingo ? '#991B1B' : '#1E4D33'), fs: 9 }
		});

		if (!dh) {
			// Día sin planilla: se deja en blanco, no en cero. Un cero diría
			// «trabajó cero horas» y lo que pasa es que no hay dato.
			continue;
		}

		set(FILA.TURNO, c, { v: 'T', s: { ...celdaDia(), ht: HorizontalAlign.CENTER } });
		set(FILA.INICIO, c, {
			v: horaTexto(dh.horaInicio),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9 }
		});
		set(FILA.FIN, c, {
			v: horaTexto(dh.horaFin),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9 }
		});
		set(FILA.HORAS, c, {
			v: redondear(dh.totalHoras),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, bl: 1 }
		});

		// Disponibilidad: literal en los días de standby, cálculo en el resto.
		// Es la fila 10 del Excel (`horas − 7 − 3`), con las dos constantes
		// como dato del periodo y no clavadas en la fórmula.
		if (dh.disponibilidad) {
			set(FILA.DISPONIBILIDAD, c, {
				v: 'DISP',
				s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9, cl: { rgb: MUTED }, bl: 1 }
			});
		} else {
			const { horasBase, horasDescuento } = dto.disponibilidad;
			set(FILA.DISPONIBILIDAD, c, {
				v: redondear(dh.totalHoras - horasBase - horasDescuento),
				s: { ...derivada(), ht: HorizontalAlign.CENTER, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
			});
		}

		// Las siete filas de recargo. El día se resalta con el color del tipo
		// cuando tiene horas de ese tipo — igual que en el Excel, donde el
		// color es lo que deja ver de un vistazo qué clase de recargo hubo.
		const tieneAlguno = ORDEN_RECARGOS.some((cod) => (dh.horas[cod] ?? 0) > 0);
		ORDEN_RECARGOS.forEach((codigo, i) => {
			const h = dh.horas[codigo] ?? 0;
			const tarifa = hoja.tarifas.find((t) => t.codigo === codigo);
			const color = tarifa?.color ?? '#E2E8F0';
			set(FILA.RECARGO0 + i, c, {
				v: h > 0 ? redondear(h) : '',
				s: {
					...base(),
					// Solo se pinta si el día tuvo recargos: así el bloque de
					// color marca los días con actividad y el resto queda limpio.
					...(tieneAlguno ? { bg: { rgb: color }, cl: { rgb: contraste(color) } } : {}),
					ht: HorizontalAlign.CENTER,
					...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}),
					fs: 9
				}
			});
		});

		// Solo el COLOR del cliente, sin texto: el nombre no cabe en 46px y ya
		// está en la leyenda de abajo y en el desglose por empresa.
		if (dh.empresaColor) {
			set(FILA.CLIENTE_DIA, c, {
				v: '',
				s: { ...base(), bg: { rgb: dh.empresaColor } }
			});
		}
	}

	// Total de horas del periodo, con fórmula viva: si alguien corrige una
	// celda de horas, el total sigue.
	const cIni = colLetra(COL.DIA0);
	const cFin = colLetra(COL.DIA0 + dias.length - 1);
	set(FILA.TOTALES_TURNO, COL.NOMBRE, { v: 'TOTAL HORAS DEL PERIODO', s: etiqueta() });
	merge(FILA.TOTALES_TURNO, COL.NOMBRE, FILA.TOTALES_TURNO, COL.PLACA_FIN);
	set(FILA.TOTALES_TURNO, COL.DIA0, {
		f: `=SUM(${cIni}${FILA.HORAS + 1}:${cFin}${FILA.HORAS + 1})`,
		s: { ...totales(), ht: HorizontalAlign.LEFT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
	});
	merge(FILA.TOTALES_TURNO, COL.DIA0, FILA.TOTALES_TURNO, COL.DIA0 + 3);

	leyendaClientes({ hoja, set, merge });
}

/**
 * Leyenda de clientes: de izquierda a derecha, dos celdas para el nombre y
 * una para el color, con una celda en blanco entre item e item.
 *
 * Va aquí y no en un panel aparte porque la fila 18 solo lleva color: sin
 * leyenda, esos colores no significan nada. Solo se listan los clientes de
 * ESTA hoja; el color sí es del periodo, así que comparar entre conductores
 * sigue funcionando.
 */
function leyendaClientes(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
}) {
	const { hoja, set, merge } = args;
	if (!hoja.clientes?.length) return;

	const r = FILA.LEYENDA;
	set(r, COL.NOMBRE, { v: 'CLIENTES', s: { ...etiqueta(), ht: HorizontalAlign.RIGHT } });

	/// nombre (2) + color (1) + hueco (1)
	const PASO = 4;
	let c = COL.DIA0;
	for (const cliente of hoja.clientes) {
		set(r, c, {
			// Alineado a la IZQUIERDA: dos columnas de día son ~92px y casi
			// ningún nombre de cliente cabe. Alineado a la derecha se recortaba
			// por delante —«FIPETROL S.A.S» por CONFIPETROL— que es justo la
			// parte que lo identifica.
			v: nombreCortoCliente(cliente.nombre),
			s: { ...base(), fs: 8, ht: HorizontalAlign.LEFT }
		});
		merge(r, c, r, c + 1);
		set(r, c + 2, { v: '', s: { ...base(), bg: { rgb: cliente.color } } });
		c += PASO;
	}
}

/**
 * El nombre del cliente sin su forma jurídica.
 *
 * «FEPCO SERVICIOS S.A.S» y «MCS CONSULTORIA Y MONITOREO AMBIENTAL S. A. S.»
 * no caben en dos columnas, y lo que sobra —el S.A.S— es justo lo que no
 * distingue a un cliente de otro. El nombre completo sigue en el bloque de
 * desglose por empresa.
 */
function nombreCortoCliente(nombre: string): string {
	return nombre
		.replace(/\s*\b(S\.?\s?A\.?\s?S\.?|S\.?A\.?|LTDA\.?|SAS|SUCURSAL\s+COLOMBIA)\s*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ─── Zona B: configuración y acumulado ────────────────────────────────

function zonaConfiguracion(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
}): number {
	const { hoja, set, merge } = args;
	const c0 = ZONA.CONFIG_C0;
	let r = FILA_INFERIOR;

	set(r, c0, { v: 'LIQUIDACIÓN DE HORAS EXTRAS Y RECARGOS', s: cabecera() });
	merge(r, c0, r, c0 + 5);
	r++;

	// Base de cálculo, que es lo que hace comprensible todo lo de abajo.
	const baseInfo: [string, number, string | undefined][] = [
		['Salario básico', hoja.salarioBasico, FMT_COP],
		// Las horas van sin patrón (ver FMT_HORAS).
		['Horas mensuales base', hoja.horasMensualesBase, FMT_HORAS],
		['Valor hora', hoja.valorHora, FMT_COP]
	];
	for (const [rotulo, valor, fmt] of baseInfo) {
		set(r, c0, { v: rotulo, s: etiqueta() });
		merge(r, c0, r, c0 + 2);
		set(r, c0 + 3, {
			v: redondear(valor),
			s: { ...derivada(), ht: HorizontalAlign.RIGHT, ...(fmt ? { n: { pattern: fmt } } : {}) }
		});
		merge(r, c0 + 3, r, c0 + 5);
		r++;
	}
	r++;

	const cabeceras = ['RECARGO', '%', 'VALOR HORA', 'HORAS MES', 'VALOR'];
	cabeceras.forEach((t, i) => {
		const c = i === 0 ? c0 : c0 + i + 1;
		set(r, c, { v: t, s: cabecera('#1E4D33') });
		if (i === 0) merge(r, c0, r, c0 + 1);
	});
	r++;

	const primeraTarifa = r;
	for (const codigo of ORDEN_RECARGOS) {
		const t = hoja.tarifas.find((x) => x.codigo === codigo);
		if (!t) continue;
		set(r, c0, {
			v: t.nombre,
			s: { ...base(), bg: { rgb: t.color }, cl: { rgb: contraste(t.color) }, bl: 1, fs: 9 }
		});
		merge(r, c0, r, c0 + 1);
		set(r, c0 + 2, { v: t.porcentaje, s: { ...derivada(), ht: HorizontalAlign.CENTER, n: { pattern: FMT_PCT } } });
		set(r, c0 + 3, { v: redondear(t.valorHora), s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } } });
		set(r, c0 + 4, { v: redondear(t.horas), s: { ...derivada(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) } });
		set(r, c0 + 5, { v: t.valor, s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } } });
		r++;
	}

	const L = (c: number) => colLetra(c);
	set(r, c0, { v: 'TOTALES', s: totales() });
	merge(r, c0, r, c0 + 3);
	set(r, c0 + 4, {
		f: `=SUM(${L(c0 + 4)}${primeraTarifa + 1}:${L(c0 + 4)}${r})`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
	});
	set(r, c0 + 5, {
		f: `=SUM(${L(c0 + 5)}${primeraTarifa + 1}:${L(c0 + 5)}${r})`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});

	return r;
}

// ─── Zona C: desglose por empresa ─────────────────────────────────────

function zonaEmpresas(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	desdeFila: number;
}): number {
	const { hoja, set, merge, desdeFila } = args;
	const c0 = ZONA.CONFIG_C0;
	let r = desdeFila;

	set(r, c0, { v: 'RECARGOS Y HORAS EXTRAS POR EMPRESA', s: cabecera() });
	merge(r, c0, r, c0 + 5);
	r += 1;

	if (!hoja.bloquesEmpresa.length) {
		set(r, c0, { v: 'Sin planillas en el periodo.', s: { ...base(), cl: { rgb: MUTED } } });
		merge(r, c0, r, c0 + 5);
		return r;
	}

	// Un bloque por (empresa, mes). En el Excel esto estaba limitado a siete
	// bloques fijos; aquí se generan los que haya.
	for (const b of hoja.bloquesEmpresa) {
		set(r, c0, { v: b.empresa, s: cabecera('#1E4D33') });
		merge(r, c0, r, c0 + 3);
		// Los días agrupados en texto: «7, 13 AL 19 DE AGOSTO DE 2026».
		set(r, c0 + 4, { v: b.textoDias, s: { ...cabecera('#1E4D33'), ht: HorizontalAlign.LEFT, fs: 9 } });
		merge(r, c0 + 4, r, c0 + 5);
		r++;

		const primera = r;
		for (const linea of b.lineas) {
			const t = hoja.tarifas.find((x) => x.codigo === linea.codigo);
			set(r, c0, { v: linea.nombre, s: { ...base(), fs: 9 } });
			merge(r, c0, r, c0 + 2);
			set(r, c0 + 3, {
				v: '',
				s: { ...base(), bg: { rgb: t?.color ?? '#E2E8F0' } }
			});
			set(r, c0 + 4, {
				v: redondear(linea.horas),
				s: { ...derivada(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
			});
			set(r, c0 + 5, {
				v: linea.valor,
				s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
			});
			r++;
		}

		const L = (c: number) => colLetra(c);
		set(r, c0, { v: 'TOTAL', s: totales() });
		merge(r, c0, r, c0 + 3);
		set(r, c0 + 4, {
			f: `=SUM(${L(c0 + 4)}${primera + 1}:${L(c0 + 4)}${r})`,
			s: { ...totales(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
		});
		set(r, c0 + 5, {
			f: `=SUM(${L(c0 + 5)}${primera + 1}:${L(c0 + 5)}${r})`,
			s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
		r += 2;
	}

	return r;
}

// ─── Zona D: control de jornada ───────────────────────────────────────

function zonaJornada(args: {
	dto: PeriodoNominaDTO;
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
}) {
	const { dto, hoja, set, merge } = args;
	const c0 = ZONA.JORNADA_C0;
	let r = FILA_INFERIOR;

	/** Escribe una celda que ocupa `span` columnas. Devuelve la siguiente libre. */
	const campo = (fila: number, col: number, span: number, cell: ICellData): number => {
		set(fila, col, cell);
		if (span > 1) merge(fila, col, fila, col + span - 1);
		return col + span;
	};

	const L = (c: number) => colLetra(c);

	campo(r, c0, SPAN.JORNADA_TITULO, { v: 'CONTROL DE JORNADA', s: cabecera() });
	r++;

	const topes: [string, number][] = [
		['Horas semanales', dto.topes.horasSemanales],
		['Horas máximas mensuales', dto.topes.horasMensuales],
		['Tope horas extras mes', dto.topes.horasExtrasMes]
	];
	for (const [rotulo, valor] of topes) {
		let c = campo(r, c0, SPAN.JORNADA_LABEL, { v: rotulo, s: etiqueta() });
		campo(r, c, SPAN.JORNADA_VALOR, {
			v: valor,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		r++;
	}
	r++;

	let c = campo(r, c0, SPAN.JORNADA_LABEL, { v: 'SEMANA', s: cabecera('#1E4D33') });
	const colHoras = c;
	campo(r, c, SPAN.JORNADA_VALOR, { v: 'HORAS', s: cabecera('#1E4D33') });
	r++;

	const primera = r;
	for (const semana of dto.periodo.semanas) {
		campo(r, c0, SPAN.JORNADA_LABEL, { v: semana.etiqueta, s: { ...base(), fs: 9 } });
		// Fórmula viva sobre las columnas de esa semana en la fila de horas:
		// si se corrige un día, el total semanal se mueve solo.
		const cIni = colLetra(COL.DIA0 + semana.indices[0]);
		const cFin = colLetra(COL.DIA0 + semana.indices[semana.indices.length - 1]);
		campo(r, colHoras, SPAN.JORNADA_VALOR, {
			f: `=SUM(${cIni}${FILA.HORAS + 1}:${cFin}${FILA.HORAS + 1})`,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		r++;
	}

	campo(r, c0, SPAN.JORNADA_LABEL, { v: 'TOTAL', s: totales() });
	campo(r, colHoras, SPAN.JORNADA_VALOR, {
		f: `=SUM(${L(colHoras)}${primera + 1}:${L(colHoras)}${r})`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT }
	});
	r += 2;

	// Reparto entre lo que se paga en el desprendible y lo que se imputa a
	// disponibilidad. Es la parte central del Excel (cols N-S).
	c = campo(r, c0, SPAN.REPARTO_COD, { v: 'RECARGO', s: cabecera('#1E4D33') });
	const colDespH = c;
	c = campo(r, c, SPAN.REPARTO_HORAS, { v: 'DESPRENDIBLE', s: cabecera('#1E4D33') });
	const colDespV = c;
	c = campo(r, c, SPAN.REPARTO_VALOR, { v: '$', s: cabecera('#1E4D33') });
	const colDispH = c;
	c = campo(r, c, SPAN.REPARTO_HORAS, { v: 'DISPONIBILIDAD', s: cabecera('#1E4D33') });
	const colDispV = c;
	campo(r, c, SPAN.REPARTO_VALOR, { v: '$', s: cabecera('#1E4D33') });
	r++;

	const primeraReparto = r;
	for (const codigo of ORDEN_RECARGOS) {
		const desp = hoja.repartoDesprendible.find((x) => x.codigo === codigo);
		const disp = hoja.repartoDisponibilidad.find((x) => x.codigo === codigo);
		const t = hoja.tarifas.find((x) => x.codigo === codigo);
		const colorTipo = t?.color ?? '#E2E8F0';

		campo(r, c0, SPAN.REPARTO_COD, {
			v: codigo,
			s: {
				...base(),
				bg: { rgb: colorTipo },
				cl: { rgb: contraste(colorTipo) },
				bl: 1,
				ht: HorizontalAlign.CENTER
			}
		});
		campo(r, colDespH, SPAN.REPARTO_HORAS, {
			v: redondear(desp?.horas ?? 0),
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		campo(r, colDespV, SPAN.REPARTO_VALOR, {
			v: desp?.valor ?? 0,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
		campo(r, colDispH, SPAN.REPARTO_HORAS, {
			v: redondear(disp?.horas ?? 0),
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		campo(r, colDispV, SPAN.REPARTO_VALOR, {
			v: disp?.valor ?? 0,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
		r++;
	}

	campo(r, c0, SPAN.REPARTO_COD, { v: 'TOTAL', s: totales() });
	for (const [col, span, esMoneda] of [
		[colDespH, SPAN.REPARTO_HORAS, false],
		[colDespV, SPAN.REPARTO_VALOR, true],
		[colDispH, SPAN.REPARTO_HORAS, false],
		[colDispV, SPAN.REPARTO_VALOR, true]
	] as [number, number, boolean][]) {
		campo(r, col, span, {
			f: `=SUM(${L(col)}${primeraReparto + 1}:${L(col)}${r})`,
			s: {
				...totales(),
				ht: HorizontalAlign.RIGHT,
				...(esMoneda ? { n: { pattern: FMT_COP } } : {})
			}
		});
	}
}

// ─── Zona E: desprendible ─────────────────────────────────────────────

function zonaDesprendible(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	bind: (r: number, c: number, binding: NominaBinding) => void;
	/** Los de la hoja más los que detecta el builder (festivos sin marcar). */
	avisos: string[];
}): number {
	const { hoja, set, merge, bind, avisos } = args;
	const c0 = ZONA.DESPRENDIBLE_C0;
	const L = (c: number) => colLetra(c);
	let r = FILA_INFERIOR;

	const campo = (fila: number, col: number, span: number, cell: ICellData): number => {
		set(fila, col, cell);
		if (span > 1) merge(fila, col, fila, col + span - 1);
		return col + span;
	};

	// Columnas de cada campo, calculadas una vez: el resto de la zona se
	// alinea contra ellas en vez de ir sumando spans en cada fila.
	const colDevCant = c0 + SPAN.DESP_CONCEPTO;
	const colDevValor = colDevCant + SPAN.DESP_CANT;
	const colDedConcepto = colDevValor + SPAN.DESP_VALOR;
	const colDedValor = colDedConcepto + SPAN.DESP_DED_CONCEPTO;
	const finZona = colDedValor + SPAN.DESP_VALOR - 1;

	campo(r, c0, finZona - c0 + 1, {
		v: `DESPRENDIBLE · ${hoja.estado}`,
		s: cabecera()
	});
	r++;

	campo(r, c0, SPAN.DESP_CONCEPTO, { v: 'DEVENGOS', s: cabecera('#1E4D33') });
	campo(r, colDevCant, SPAN.DESP_CANT, { v: 'CANT.', s: cabecera('#1E4D33') });
	campo(r, colDevValor, SPAN.DESP_VALOR, { v: 'VALOR', s: cabecera('#1E4D33') });
	campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
		v: 'DEDUCCIONES',
		s: cabecera('#7F1D1D')
	});
	campo(r, colDedValor, SPAN.DESP_VALOR, { v: 'VALOR', s: cabecera('#7F1D1D') });
	r++;

	const primeraDevengo = r;
	const filas = Math.max(hoja.devengos.length, hoja.deducciones.length);

	for (let i = 0; i < filas; i++) {
		const dev = hoja.devengos[i];
		const ded = hoja.deducciones[i];

		if (dev) {
			const estilo = dev.editable ? editable() : derivada();
			campo(r, c0, SPAN.DESP_CONCEPTO, { v: dev.nombre, s: { ...base(), fs: 9 } });
			campo(r, colDevCant, SPAN.DESP_CANT, {
				v: dev.cantidad ?? '',
				s: { ...estilo, ht: HorizontalAlign.CENTER }
			});
			campo(r, colDevValor, SPAN.DESP_VALOR, {
				v: Math.round(dev.valor),
				s: { ...estilo, ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
			});
			// Solo se registra binding en lo que de verdad se teclea. El resto
			// queda sin entrada y el permiso de celda lo bloquea por defecto.
			if (dev.editable && hoja.liquidacionId) {
				const campoValor = campoDeConcepto(dev.clave);
				if (campoValor) {
					bind(r, colDevValor, {
						entityType: 'liquidacion',
						entityId: hoja.liquidacionId,
						field: campoValor,
						conductorId: hoja.conductorId
					});
				}
				const campoCantidad = campoDeCantidad(dev.clave);
				if (campoCantidad) {
					bind(r, colDevCant, {
						entityType: 'liquidacion',
						entityId: hoja.liquidacionId,
						field: campoCantidad,
						conductorId: hoja.conductorId
					});
				}
			}
		}

		if (ded) {
			campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
				v: ded.nombre,
				s: { ...base(), fs: 9 }
			});
			campo(r, colDedValor, SPAN.DESP_VALOR, {
				v: Math.round(ded.valor),
				s: {
					...derivada(),
					ht: HorizontalAlign.RIGHT,
					n: { pattern: FMT_COP },
					cl: { rgb: '#B91C1C' }
				}
			});
		}

		r++;
	}
	const ultimaFila = r - 1;

	// Totales con fórmula viva: si se edita un concepto, el neto se mueve sin
	// esperar al servidor. El servidor recalcula igual y manda el suyo, pero
	// mientras tanto la hoja no miente.
	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, { v: 'TOTAL DEVENGADO', s: totales() });
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		f: `=SUM(${L(colDevValor)}${primeraDevengo + 1}:${L(colDevValor)}${ultimaFila + 1})`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
		v: 'TOTAL DEDUCCIONES',
		s: { ...totales(), fs: 9 }
	});
	campo(r, colDedValor, SPAN.DESP_VALOR, {
		f: `=SUM(${L(colDedValor)}${primeraDevengo + 1}:${L(colDedValor)}${ultimaFila + 1})`,
		s: {
			...totales(),
			ht: HorizontalAlign.RIGHT,
			n: { pattern: FMT_COP },
			cl: { rgb: '#B91C1C' }
		}
	});
	const filaTotales = r;
	r++;

	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, {
		v: 'BASE PRESTACIONAL',
		s: etiqueta()
	});
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		v: Math.round(hoja.totales.baseCalculo ?? 0),
		s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	r++;

	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, {
		v: 'NETO A PAGAR',
		s: { ...cabecera(), fs: 12 }
	});
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		f: `=${L(colDevValor)}${filaTotales + 1}-${L(colDedValor)}${filaTotales + 1}`,
		s: { ...cabecera(), fs: 12, ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	r++;

	// Avisos de la hoja, si los hay. Van aquí y no en un toast porque son de
	// esta hoja concreta y el usuario está mirando treinta.
	if (avisos.length) {
		r++;
		campo(r, c0, finZona - c0 + 1, { v: 'AVISOS', s: cabecera(FESTIVO_CABECERA) });
		r++;
		for (const aviso of avisos) {
			campo(r, c0, finZona - c0 + 1, {
				v: aviso,
				s: { ...base(), fs: 9, cl: { rgb: '#B45309' } }
			});
			r++;
		}
	}

	return r;
}

/**
 * Campo de `liquidaciones` que edita el IMPORTE de un concepto.
 * `null` significa que el importe no se teclea directamente (sale de una
 * cantidad, de las planillas o de otra tabla).
 */
function campoDeConcepto(clave: string): string | null {
	switch (clave) {
		case 'vacaciones':
			return 'total_vacaciones';
		case 'ajuste_salarial':
			return 'ajuste_salarial';
		default:
			return null;
	}
}

/** Campo que edita la CANTIDAD (los días) de un concepto. */
function campoDeCantidad(clave: string): string | null {
	switch (clave) {
		case 'salario':
		case 'auxilio_transporte':
			return 'dias_laborados';
		case 'ajuste_salarial':
			return 'dias_laborados_villanueva';
		default:
			return null;
	}
}

/**
 * Cierra el borde de las celdas combinadas.
 *
 * EL PROBLEMA: Univer 0.25.1 dibuja el borde del ANCLA a su tamaño propio, no
 * al de la combinación. En una fila «TOTAL HORAS DEL PERIODO» combinada de B a
 * G se veía el recuadro solo alrededor de la B y el resto quedaba sin trazar;
 * y las filas cuyo rótulo y valor son dos combinaciones seguidas se quedaban
 * directamente sin retícula. Al lado, las celdas sueltas sí la tenían, así que
 * la hoja parecía a medio dibujar.
 *
 * LA SOLUCIÓN: materializar las celdas CUBIERTAS con bordes PARCIALES —arriba
 * y abajo siempre, el izquierdo solo en la primera y el derecho solo en la
 * última—. Así el rectángulo se cierra sin que aparezcan las líneas verticales
 * interiores, que es justo lo que la combinación viene a quitar. `rellenarBordesVacios`
 * las salta a propósito (por eso no lo hacía él), y lleva un aviso explicando
 * que rellenarlas con el borde COMPLETO dibujaba por dentro.
 *
 * Se copia además el fondo del ancla: si el renderizador pinta las cubiertas
 * por separado, el color de la cabecera sigue siendo continuo.
 */
function cerrarBordesDeCombinadas(
	cellData: Record<number, Record<number, ICellData>>,
	mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]
): void {
	for (const m of mergeData) {
		const ancla = cellData[m.startRow]?.[m.startColumn];
		const estiloAncla = (ancla?.s ?? {}) as IStyleData;
		const bordeAncla = estiloAncla.bd;
		// Si el ancla no lleva borde, la combinación tampoco debe llevarlo.
		if (!bordeAncla) continue;

		// EL ANCLA PIERDE SUS BORDES INTERIORES. Conservaba el derecho (y el
		// inferior en combinaciones de varias filas) de su estilo original, y
		// eso dibujaba una vertical DENTRO de la combinación, justo detrás del
		// rótulo: era lo que hacía que el recuadro pareciera cortado a medias.
		// El borde derecho pertenece a la última columna del rango, no al ancla.
		const variasColumnas = m.endColumn > m.startColumn;
		const variasFilas = m.endRow > m.startRow;
		if (variasColumnas || variasFilas) {
			cellData[m.startRow][m.startColumn] = {
				...ancla,
				s: {
					...estiloAncla,
					bd: {
						...bordeAncla,
						...(variasColumnas ? { r: undefined } : {}),
						...(variasFilas ? { b: undefined } : {})
					}
				}
			};
		}

		for (let r = m.startRow; r <= m.endRow; r++) {
			const fila = (cellData[r] ??= {});
			for (let c = m.startColumn; c <= m.endColumn; c++) {
				if (r === m.startRow && c === m.startColumn) continue;

				const bd: Record<string, unknown> = {};
				if (r === m.startRow && bordeAncla.t) bd.t = bordeAncla.t;
				if (r === m.endRow && bordeAncla.b) bd.b = bordeAncla.b;
				if (c === m.startColumn && bordeAncla.l) bd.l = bordeAncla.l;
				if (c === m.endColumn && bordeAncla.r) bd.r = bordeAncla.r;

				fila[c] = {
					s: {
						...(estiloAncla.bg ? { bg: estiloAncla.bg } : {}),
						bd: bd as IStyleData['bd']
					}
				};
			}
		}
	}
}

// ─── Utilidades ───────────────────────────────────────────────────────

/**
 * Fechas ISO festivas que caen dentro del periodo.
 *
 * El periodo cruza dos meses y puede cruzar dos años (diciembre → enero), así
 * que se piden los festivos de cada año presente y se filtran por fecha.
 */
function festivosDelPeriodo(dias: DiaPeriodoDTO[]): Set<string> {
	const anios = new Set(dias.map((d) => d.anio));
	const delPeriodo = new Set(dias.map((d) => d.fecha));
	const out = new Set<string>();
	for (const anio of anios) {
		for (const f of obtenerFestivosCompletos(anio)) {
			if (delPeriodo.has(f.fechaCompleta)) out.add(f.fechaCompleta);
		}
	}
	return out;
}

/** Hora decimal (5.5) → «05:30». En la planilla se guarda como decimal. */
function horaTexto(h: number | null): string {
	if (h === null || h === undefined || !Number.isFinite(h)) return '';
	const horas = Math.floor(h);
	const min = Math.round((h - horas) * 60);
	return `${String(horas).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function redondear(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Texto blanco o negro según lo oscuro que sea el fondo. Los colores de
 * recargo vienen de los Excel y van del amarillo al morado oscuro; con un
 * color de texto fijo, la mitad quedaría ilegible.
 */
function contraste(hex: string): string {
	const c = hex.replace('#', '');
	if (c.length !== 6) return TEXT_DARK;
	const r = parseInt(c.slice(0, 2), 16);
	const g = parseInt(c.slice(2, 4), 16);
	const b = parseInt(c.slice(4, 6), 16);
	// Luminancia relativa, redondeada: no hace falta más precisión para
	// decidir entre dos colores.
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.6 ? TEXT_DARK : '#FFFFFF';
}
