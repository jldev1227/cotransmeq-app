/**
 * Builder del canvas de RECORRIDOS.
 *
 * El formato es el del formato oficial **OP-FR-03 «Control Días Laborados
 * Personal» v3**: misma cabecera (título, código, versión, fecha, nombre del
 * conductor y cédula) y las mismas columnas en el mismo orden. Lo que añade
 * este canvas sobre el papel son las columnas de BONO —que es lo que el Excel
 * se apuntaba a mano al margen— y el valor a pagar que sale de ellas.
 *
 * UNA FILA = UN RECORRIDO. Si un conductor hizo dos recorridos el mismo día,
 * salen dos filas seguidas: no se agrupa por día ni por cliente, y la fecha se
 * repite en ambas. Es deliberado — Operaciones pidió poder filtrar y ordenar
 * por cualquier columna sin que media hoja tenga celdas vacías «de agrupado».
 *
 * El orden es cronológico ASCENDENTE: la fecha más antigua arriba. Lo impone el
 * servidor; aquí solo se pinta lo que llega.
 *
 * Las columnas de bono son DINÁMICAS: una por cada bono visible del año, y su
 * número cambia cuando alguien toca el modal de configuración. Por eso toda la
 * geometría se calcula a partir de `bonos.length` en vez de constantes.
 */

import {
	BooleanNumber,
	CellValueType,
	HorizontalAlign,
	LocaleType,
	VerticalAlign,
	type ICellData,
	type IRange,
	type IStyleData,
	type IWorkbookData
} from '@univerjs/core';
import { BorderStyleTypes, type IBorderData, type IBorderStyleData } from '@univerjs/core';
import { IDENTIDAD } from './identidad-empresa';
import { rellenarBordesVacios } from './relleno-bordes';
import { conductorSheetId, recorridosUnitId } from './recorridos-identidad';
import type {
	RecorridoBinding,
	RecorridoBindingSeed
} from '../business/recorridos-cell-binding';

// ─── Tipos del DTO que sirve el backend ───────────────────────────────

export interface BonoColumna {
	config_id: string;
	nombre: string;
	valor: number;
	anio: number;
}

export interface FilaRecorrido {
	tipo_fila: 'segmento' | 'dia';
	registro_dia_id: string;
	segmento_id: string | null;
	version: number;
	fecha: string;
	tipo_dia: string;
	orden: number;
	cliente_id: string | null;
	cliente_nombre: string | null;
	vehiculo_id: string | null;
	vehiculo_placa: string | null;
	hora_inicio: string | null;
	hora_fin: string | null;
	inicio_dia_siguiente: boolean;
	fin_dia_siguiente: boolean;
	horas_conducidas: number;
	km_inicial: number | null;
	km_final: number | null;
	pernocte: boolean;
	observaciones: string | null;
	bonos: Record<string, boolean>;
}

export interface HojaRecorridos {
	conductor_id: string;
	nombre: string;
	apellido: string;
	numero_identificacion: string | null;
	nombre_hoja: string;
	filas: FilaRecorrido[];
}

export interface RecorridosPeriodoDTO {
	/** Mes en que CIERRA el corte. Identifica el room y los snapshots. */
	anio: number;
	mes: number;
	/** Primer día del corte, `YYYY-MM-DD` inclusive. */
	desde: string;
	/** Último día del corte, `YYYY-MM-DD` inclusive. */
	hasta: string;
	etiqueta: string;
	bonos: BonoColumna[];
	hojas: HojaRecorridos[];
	avisos: string[];
}

// ─── Metadatos del formato ────────────────────────────────────────────

/**
 * Datos del formato impreso OP-FR-03 v3 y de la empresa.
 *
 * El formato aporta el código, la versión y qué columnas lleva el documento;
 * la identidad —razón social, logo y verdes— es la de Transmeralda, igual que
 * en el resto de canvas.
 */
export const FORMATO = {
	// De `identidad-empresa.ts`, que es el único archivo del canvas que cambia
	// entre transmeralda y cotransmeq.
	marca: IDENTIDAD.marca,
	razonSocial: IDENTIDAD.razonSocial,
	titulo: 'CONTROL DÍAS LABORADOS PERSONAL',
	codigo: 'OP-FR-03',
	version: '3',
	fecha: '2025-01-09'
} as const;

// ─── Geometría ────────────────────────────────────────────────────────

/**
 * Columnas fijas, en el orden del OP-FR-03. Las de bono van justo después y
 * son dinámicas; el valor a pagar y la firma cierran la tabla.
 *
 * `DIA` y `TIPO` no están en el papel: se añaden porque sin ellas no se
 * distingue un día de descanso de uno laborado, y el canvas —a diferencia del
 * formato impreso, que se rellena a mano un día por línea— lista el mes entero.
 */
export const COL = {
	ITEM: 0,
	FECHA: 1,
	DIA_SEMANA: 2,
	TIPO: 3,
	PLACA: 4,
	DESCRIPCION: 5,
	HORA_INI: 6,
	HORA_FIN: 7,
	HORAS: 8,
	PERNOCTE: 9,
	CLIENTE: 10,
	KM_INI: 11,
	KM_FIN: 12
} as const;

/** Primera columna de bono. */
export const COL_BONO_INICIO = 13;

/** Anchos de las columnas fijas, derivados de los del OP-FR-03. */
const ANCHOS_FIJOS = [42, 92, 46, 108, 108, 300, 88, 88, 132, 84, 190, 78, 78];
const ANCHO_BONO = 118;
const ANCHO_TOTAL = 112;
const ANCHO_FIRMA = 132;

/**
 * Las filas de cabecera NO son constantes: una hoja de solo consulta añade la
 * banda de aviso y desplaza todo una fila. El builder las va contando y
 * devuelve el rango de datos en `rangoFilas`.
 */

/** Filas en blanco bajo la tabla, para que la hoja no acabe a ras del dato. */
const FILAS_COLCHON = 6;

export function totalColumnas(bonos: BonoColumna[]): number {
	// Fijas + una por bono + valor a pagar + firma.
	return COL_BONO_INICIO + bonos.length + 2;
}

export function colValorPagar(bonos: BonoColumna[]): number {
	return COL_BONO_INICIO + bonos.length;
}

export function colFirma(bonos: BonoColumna[]): number {
	return COL_BONO_INICIO + bonos.length + 1;
}

// ─── Estilos ──────────────────────────────────────────────────────────
//
// Los mismos de `cierres-finales.builder.ts`, deliberadamente: los dos son
// hojas del mismo producto y deben leerse igual. De ahí salen el cuerpo a 10,
// el título de hoja a 13 sobre banda verde, la zebra `#F8FAFC` y el pie
// `#E2E8F0`.
//
// NO se fija tipografía: Univer usa la suya y así el canvas se ve como sus
// hermanos. Fijar Calibri —la del Excel de origen— lo dejaba con aire de hoja
// de oficina pegada dentro de la aplicación.

const DIAS_SEMANA = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

const GREEN = '#0F4025';
const GREEN_DARK = '#166534';
const GREEN_SOFT = '#DCFCE7';
const TEXT_DARK = '#0F172A';
const MUTED = '#475569';
const SUBTLE_BG = '#F1F5F9';
const TOTALES_BG = '#E2E8F0';
const ZEBRA_BG = '#F8FAFC';
const GRIS_BLOQUEADO = '#94A3B8';
const BLANCO = '#FFFFFF';

/** Borde fino gris, el de toda la rejilla. El mismo de cierres. */
const bordeFino = (): IBorderStyleData => ({
	s: BorderStyleTypes.THIN,
	cl: { rgb: '#CBD5E1' }
});
const bordes = (): IBorderData => ({
	t: bordeFino(),
	r: bordeFino(),
	b: bordeFino(),
	l: bordeFino()
});

/** Color del TIPO DE DÍA. Es lo que permite encontrar los días sin recorrido. */
const COLOR_TIPO: Record<string, string> = {
	LABORADO: GREEN_DARK,
	DISPONIBLE: '#1D4ED8',
	DESCANSO: MUTED,
	MANTENIMIENTO: '#B45309'
};

const celda = (z: boolean): IStyleData =>
	({
		fs: 10,
		cl: { rgb: TEXT_DARK },
		bd: bordes(),
		...(z ? { bg: { rgb: ZEBRA_BG } } : {})
	}) as IStyleData;

const centrado = (z: boolean): IStyleData =>
	({ ...celda(z), ht: HorizontalAlign.CENTER }) as IStyleData;

const derecha = (z: boolean): IStyleData =>
	({ ...celda(z), ht: HorizontalAlign.RIGHT }) as IStyleData;

const moneda = (z: boolean): IStyleData =>
	({
		...celda(z),
		bl: 1,
		cl: { rgb: GREEN_DARK },
		ht: HorizontalAlign.RIGHT,
		n: { pattern: '"$"#,##0' }
	}) as IStyleData;

const estiloTipo = (tipo: string, z: boolean): IStyleData =>
	({ ...centrado(z), bl: 1, cl: { rgb: COLOR_TIPO[tipo] ?? TEXT_DARK } }) as IStyleData;

/**
 * Semáforo de una casilla marcada.
 *
 * Mismo criterio que `estiloAplicaImpuestos` en cierres: el color ES el dato.
 * En una hoja con varias columnas de casilla, distinguir «SÍ» de «NO» leyendo
 * el texto celda a celda no es viable.
 */
export function estiloCasilla(marcada: boolean, z = false): IStyleData {
	return {
		fs: 10,
		bl: 1,
		ht: HorizontalAlign.CENTER,
		bd: bordes(),
		cl: { rgb: marcada ? GREEN_DARK : GRIS_BLOQUEADO },
		bg: { rgb: marcada ? '#ECFDF5' : z ? ZEBRA_BG : BLANCO }
	} as IStyleData;
}

/** Cabecera de columnas: blanco sobre verde, como en cierres. */
const CABECERA: IStyleData = {
	fs: 10,
	bl: 1,
	cl: { rgb: BLANCO },
	bg: { rgb: GREEN },
	ht: HorizontalAlign.CENTER,
	vt: VerticalAlign.MIDDLE,
	bd: bordes(),
	tb: 3
} as IStyleData;

/** Título de la hoja: la banda verde ancha del canvas de cierres. */
const TITULO_HOJA: IStyleData = {
	fs: 13,
	bl: 1,
	cl: { rgb: BLANCO },
	bg: { rgb: GREEN },
	ht: HorizontalAlign.LEFT,
	vt: VerticalAlign.MIDDLE,
	bd: bordes()
} as IStyleData;

/** Banda de sección. `banda()` de cierres, en verde medio. */
const BANDA: IStyleData = {
	fs: 11,
	bl: 1,
	cl: { rgb: BLANCO },
	bg: { rgb: GREEN_DARK },
	ht: HorizontalAlign.CENTER,
	vt: VerticalAlign.MIDDLE,
	bd: bordes()
} as IStyleData;

/** Aviso de solo lectura. Copiado tal cual de cierres. */
const AVISO_BLOQUEO: IStyleData = {
	fs: 10,
	bl: 1,
	it: 1,
	cl: { rgb: BLANCO },
	bg: { rgb: GRIS_BLOQUEADO },
	ht: HorizontalAlign.CENTER,
	bd: bordes()
} as IStyleData;

/** Pie de totales. `tfoot` de cierres. */
const PIE: IStyleData = {
	fs: 10,
	bl: 1,
	cl: { rgb: TEXT_DARK },
	bg: { rgb: TOTALES_BG },
	bd: bordes(),
	n: { pattern: '"$"#,##0' }
} as IStyleData;

const PIE_ETIQUETA: IStyleData = {
	fs: 10,
	bl: 1,
	cl: { rgb: TEXT_DARK },
	bg: { rgb: TOTALES_BG },
	ht: HorizontalAlign.RIGHT,
	bd: bordes()
} as IStyleData;

// ─── Valores de las casillas ──────────────────────────────────────────

/**
 * Univer pinta la casilla, pero el valor que guarda sigue siendo esta CADENA.
 * Todo el resto del sistema —binding, adapter, backend, preview— trabaja con
 * ella, así que la casilla es puramente visual.
 */
export const CASILLA_SI = 'SÍ';
export const CASILLA_NO = 'NO';

export const comoCasilla = (v: boolean): string => (v ? CASILLA_SI : CASILLA_NO);

// ─── Construcción de una hoja ─────────────────────────────────────────

export interface HojaConstruida {
	sheet: Record<string, unknown>;
	bindings: RecorridoBindingSeed[];
	/** Rango de filas de datos, para colgar las casillas. */
	rangoFilas: { desde: number; hasta: number } | null;
}


export function buildHojaRecorridos(opts: {
	sheetId: string;
	sheetName: string;
	hoja: HojaRecorridos;
	bonos: BonoColumna[];
	etiqueta: string;
	editable: boolean;
	tabColor: string;
}): HojaConstruida {
	const { sheetId, sheetName, hoja, bonos, etiqueta, editable, tabColor } = opts;

	const nCols = totalColumnas(bonos);
	const colTotal = colValorPagar(bonos);
	const colFirmaOps = colFirma(bonos);

	// `cellData`, `rowData` y `columnData` se crean DENTRO de cada hoja: Univer
	// muta `columnData` in-place al redimensionar, y compartir el objeto entre
	// las hojas propagaría el ajuste de una a todas las demás.
	const cellData: Record<number, Record<number, ICellData>> = {};
	const rowData: Record<number, { h: number }> = {};
	const colData: Record<number, { w: number }> = {};
	const mergeData: IRange[] = [];
	const bindings: RecorridoBindingSeed[] = [];

	for (let c = 0; c < COL_BONO_INICIO; c++) colData[c] = { w: ANCHOS_FIJOS[c] };
	for (let i = 0; i < bonos.length; i++) colData[COL_BONO_INICIO + i] = { w: ANCHO_BONO };
	colData[colTotal] = { w: ANCHO_TOTAL };
	colData[colFirmaOps] = { w: ANCHO_FIRMA };

	const set = (r: number, c: number, v: string | number, s?: IStyleData) => {
		if (!cellData[r]) cellData[r] = {};
		cellData[r][c] = {
			v,
			t: typeof v === 'number' ? CellValueType.NUMBER : CellValueType.STRING,
			...(s ? { s } : {})
		};
	};

	/** Extiende una banda a lo ancho: combina y pinta el resto con su estilo. */
	const banda = (r: number, texto: string, estilo: IStyleData) => {
		set(r, 0, texto, estilo);
		for (let c = 1; c < nCols; c++) set(r, c, '', estilo);
		mergeData.push({ startRow: r, endRow: r, startColumn: 0, endColumn: nCols - 1 } as IRange);
	};

	/**
	 * Registra el binding de una celda editable.
	 *
	 * En una hoja de solo lectura NO se registra ninguno: el interceptor de
	 * permisos es default-deny, así que sin bindings la hoja entera queda
	 * bloqueada sin necesidad de una segunda regla que mantener en paralelo.
	 */
	const bind = (r: number, c: number, binding: RecorridoBinding) => {
		if (!editable) return;
		bindings.push({ r, c, binding });
	};

	let row = 0;

	// ═══ TÍTULO DE LA HOJA ═══════════════════════════════════════════
	// El nombre de pestaña va truncado a 31 caracteres, así que el nombre
	// completo del conductor solo se puede leer aquí. APELLIDO primero, que es
	// como se busca a una persona en una lista.
	const nombreCompleto = `${hoja.apellido} ${hoja.nombre}`.replace(/\s+/g, ' ').trim();
	const cedula = hoja.numero_identificacion ? `C.C. ${hoja.numero_identificacion}` : 'SIN CÉDULA';
	banda(row, `${nombreCompleto}  ·  ${cedula}  ·  ${etiqueta.toUpperCase()}`, TITULO_HOJA);
	rowData[row] = { h: 30 };
	row++;

	if (!editable) {
		banda(row, 'SOLO CONSULTA — TU ÁREA NO PUEDE MODIFICAR RECORRIDOS', AVISO_BLOQUEO);
		rowData[row] = { h: 22 };
		row++;
	}

	// ═══ BANDA DEL FORMATO ═══════════════════════════════════════════
	// El código y la versión del formato oficial viven aquí y no en un cajetín
	// con bordes como el del Excel: en una hoja de cálculo de la aplicación,
	// ese cajetín era un injerto.
	banda(
		row,
		`${FORMATO.marca}  ·  ${FORMATO.titulo}  ·  ${FORMATO.codigo} v${FORMATO.version}`,
		BANDA
	);
	rowData[row] = { h: 24 };
	row++;

	// ═══ CABECERA DE COLUMNAS ════════════════════════════════════════
	const filaCabecera = row;
	set(row, COL.ITEM, '#', CABECERA);
	set(row, COL.FECHA, 'FECHA', CABECERA);
	set(row, COL.DIA_SEMANA, 'DÍA', CABECERA);
	set(row, COL.TIPO, 'TIPO DE DÍA', CABECERA);
	set(row, COL.PLACA, 'PLACA', CABECERA);
	set(row, COL.DESCRIPCION, 'DESCRIPCIÓN DE LA LABOR / RECORRIDO', CABECERA);
	set(row, COL.HORA_INI, 'HORA INICIAL', CABECERA);
	set(row, COL.HORA_FIN, 'HORA FINAL', CABECERA);
	set(row, COL.HORAS, 'TIEMPO DE CONDUCCIÓN', CABECERA);
	set(row, COL.PERNOCTE, 'PERNOTE', CABECERA);
	set(row, COL.CLIENTE, 'CLIENTE', CABECERA);
	set(row, COL.KM_INI, 'KM INICIAL', CABECERA);
	set(row, COL.KM_FIN, 'KM FINAL', CABECERA);
	bonos.forEach((b, i) => set(row, COL_BONO_INICIO + i, b.nombre.toUpperCase(), CABECERA));
	set(row, colTotal, 'VALOR A PAGAR', CABECERA);
	set(row, colFirmaOps, 'FIRMA OPERACIONES', CABECERA);
	// 40 y no 34: los nombres de bono ocupan tres líneas con el ancho de
	// columna y la última se cortaba a media letra.
	rowData[row] = { h: 40 };
	row++;

	// ═══ FILAS ═══════════════════════════════════════════════════════
	const primeraFila = row;

	hoja.filas.forEach((f, i) => {
		// Zebra por DÍA y no por fila: los dos recorridos de una misma jornada
		// se leen como un bloque, aunque cada uno ocupe su fila.
		const z = indiceDeDia(hoja.filas, i) % 2 === 1;

		rowData[row] = { h: 22 };
		const idFila = f.segmento_id ?? f.registro_dia_id;
		const comun = {
			tipoFila: f.tipo_fila,
			entityId: idFila,
			conductorId: hoja.conductor_id,
			registroDiaId: f.registro_dia_id
		};

		set(row, COL.ITEM, i + 1, centrado(z));
		set(row, COL.FECHA, f.fecha, centrado(z));
		set(row, COL.DIA_SEMANA, diaSemana(f.fecha), centrado(z));
		set(row, COL.TIPO, f.tipo_dia, estiloTipo(f.tipo_dia, z));
		if (f.tipo_fila === 'dia') bind(row, COL.TIPO, { ...comun, field: 'tipo_dia' });

		set(row, COL.PLACA, f.vehiculo_placa ?? '', centrado(z));
		set(row, COL.DESCRIPCION, f.observaciones ?? '', celda(z));
		set(row, COL.HORA_INI, horaConMarca(f.hora_inicio, f.inicio_dia_siguiente), centrado(z));
		set(row, COL.HORA_FIN, horaConMarca(f.hora_fin, f.fin_dia_siguiente), centrado(z));
		set(row, COL.HORAS, f.horas_conducidas, derecha(z));
		set(row, COL.PERNOCTE, comoCasilla(f.pernocte), estiloCasilla(f.pernocte, z));
		set(row, COL.CLIENTE, f.cliente_nombre ?? '', celda(z));
		set(row, COL.KM_INI, f.km_inicial ?? '', derecha(z));
		set(row, COL.KM_FIN, f.km_final ?? '', derecha(z));

		if (f.tipo_fila === 'segmento') {
			bind(row, COL.PLACA, { ...comun, field: 'vehiculo_placa' });
			bind(row, COL.DESCRIPCION, { ...comun, field: 'observaciones' });
			bind(row, COL.HORA_INI, { ...comun, field: 'hora_inicio' });
			bind(row, COL.HORA_FIN, { ...comun, field: 'hora_fin' });
			bind(row, COL.HORAS, { ...comun, field: 'horas_conducidas' });
			bind(row, COL.PERNOCTE, { ...comun, field: 'pernocte' });
			bind(row, COL.CLIENTE, { ...comun, field: 'cliente_nombre' });
			bind(row, COL.KM_INI, { ...comun, field: 'km_inicial' });
			bind(row, COL.KM_FIN, { ...comun, field: 'km_final' });
		} else {
			bind(row, COL.DESCRIPCION, { ...comun, field: 'observaciones' });
		}

		bonos.forEach((b, k) => {
			const marcado = f.bonos?.[b.config_id] === true;
			set(row, COL_BONO_INICIO + k, comoCasilla(marcado), estiloCasilla(marcado, z));
			bind(row, COL_BONO_INICIO + k, { ...comun, field: `bono:${b.config_id}` });
		});

		// Derivada: la suma de los bonos marcados. La pinta el canvas y la
		// repinta el servidor al confirmar el patch; nadie la teclea.
		set(row, colTotal, valorFila(f, bonos), moneda(z));
		// En blanco: es la casilla del formato donde Operaciones firma el papel.
		set(row, colFirmaOps, '', centrado(z));

		row++;
	});

	const hayFilas = hoja.filas.length > 0;
	const ultimaFila = row - 1;

	// ═══ PIE ═════════════════════════════════════════════════════════
	if (hayFilas) {
		for (let c = 0; c < nCols; c++) set(row, c, '', PIE);
		set(row, COL.DESCRIPCION, 'TOTAL EN BONOS DEL PERIODO', PIE_ETIQUETA);
		// `SUBTOTAL(109,…)` y no `SUM` para que el pie siga al autofiltro: si el
		// usuario filtra por una placa, el total debe cuadrar con lo que ve.
		cellData[row][colTotal] = {
			v: 0,
			t: CellValueType.NUMBER,
			f: `=SUBTOTAL(109,${letra(colTotal)}${primeraFila + 1}:${letra(colTotal)}${ultimaFila + 1})`,
			s: PIE
		};
		rowData[row] = { h: 26 };
		row++;
	}

	// Colchón para que la hoja no acabe a ras del dato.
	const totalFilas = Math.max(row + FILAS_COLCHON, 30);

	// La retícula completa: Univer solo dibuja bordes en las celdas que EXISTEN
	// en `cellData`, así que las vacías hay que materializarlas. Sin esto la
	// hoja se ve «rota» a la derecha y por debajo del último dato.
	rellenarBordesVacios(cellData, totalFilas, nCols, mergeData);

	const sheet = {
		id: sheetId,
		name: sheetName,
		tabColor,
		hidden: BooleanNumber.FALSE,
		// Congelado solo en HORIZONTAL, como en cierres: la cabecera se queda
		// fija al bajar, pero no se parte la hoja en dos con una columna fija.
		freeze: {
			startRow: primeraFila,
			startColumn: 0,
			ySplit: primeraFila,
			xSplit: 0
		},
		rowCount: totalFilas,
		columnCount: nCols,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 100,
		defaultRowHeight: 22,
		mergeData,
		cellData,
		rowData,
		columnData: colData,
		rowHeader: { width: 42 },
		columnHeader: { height: 22 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};

	return {
		sheet,
		bindings,
		rangoFilas: hayFilas ? { desde: primeraFila, hasta: ultimaFila } : null
	};
}

// ─── Workbook completo ────────────────────────────────────────────────

export interface LibroRecorridos {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorConductor: Record<string, string>;
	bindingsPorHoja: Record<string, RecorridoBindingSeed[]>;
	rangoPorHoja: Record<string, { desde: number; hasta: number } | null>;
}

/**
 * Color de las pestañas.
 *
 * Los recorridos no tienen máquina de estados como un cierre: mientras el mes
 * está abierto, TODA hoja es un borrador. Se usa el mismo pizarra que
 * `BORRADOR` en el canvas de cierres para que las dos barras de pestañas se
 * lean igual — ver `cierres-finales-estado.ts`.
 */
export const COLOR_PESTANA_BORRADOR = '#94A3B8';

export function buildLibroRecorridos(
	dto: RecorridosPeriodoDTO,
	opts: { editable: boolean }
): LibroRecorridos {
	const unitId = recorridosUnitId(dto.desde, dto.hasta);
	const sheets: Record<string, unknown> = {};
	const sheetOrder: string[] = [];
	const sheetIdPorConductor: Record<string, string> = {};
	const bindingsPorHoja: Record<string, RecorridoBindingSeed[]> = {};
	const rangoPorHoja: Record<string, { desde: number; hasta: number } | null> = {};

	for (const hoja of dto.hojas) {
		const sheetId = conductorSheetId(hoja.conductor_id);
		const { sheet, bindings, rangoFilas } = buildHojaRecorridos({
			sheetId,
			sheetName: hoja.nombre_hoja,
			hoja,
			bonos: dto.bonos,
			etiqueta: dto.etiqueta,
			editable: opts.editable,
			tabColor: COLOR_PESTANA_BORRADOR
		});
		sheets[sheetId] = sheet;
		sheetOrder.push(sheetId);
		sheetIdPorConductor[hoja.conductor_id] = sheetId;
		bindingsPorHoja[sheetId] = bindings;
		rangoPorHoja[sheetId] = rangoFilas;
	}

	// Un libro sin hojas revienta Univer. Con el periodo vacío se monta una
	// hoja de aviso, que es más honesto que un canvas en blanco.
	if (sheetOrder.length === 0) {
		sheets['sin-datos'] = hojaVacia(dto.etiqueta);
		sheetOrder.push('sin-datos');
	}

	const workbook: IWorkbookData = {
		id: unitId,
		name: `${FORMATO.titulo} · ${dto.etiqueta}`,
		appVersion: '0.25.1',
		locale: LocaleType.ES_ES,
		styles: {},
		sheetOrder,
		sheets
	} as IWorkbookData;

	return { workbook, unitId, sheetIdPorConductor, bindingsPorHoja, rangoPorHoja };
}

function hojaVacia(etiqueta: string) {
	const cellData: Record<number, Record<number, ICellData>> = {
		0: {
			0: { v: `No hay recorridos registrados en ${etiqueta}.`, t: CellValueType.STRING, s: TITULO_HOJA }
		},
		1: {
			0: {
				v: 'Registra recorridos desde la ficha del conductor, o cambia de mes en la barra superior.',
				t: CellValueType.STRING,
				s: { fs: 10, cl: { rgb: MUTED } } as IStyleData
			}
		}
	};
	return {
		id: 'sin-datos',
		name: 'Sin datos',
		tabColor: COLOR_PESTANA_BORRADOR,
		hidden: BooleanNumber.FALSE,
		rowCount: 20,
		columnCount: 8,
		defaultColumnWidth: 140,
		defaultRowHeight: 23,
		mergeData: [],
		cellData,
		rowData: { 0: { h: 28 } },
		columnData: { 0: { w: 520 } },
		showGridlines: BooleanNumber.FALSE
	};
}

// ─── Auxiliares ───────────────────────────────────────────────────────

/**
 * Valor a pagar de una fila: la suma de los bonos marcados.
 *
 * Se calcula en JS y no con una fórmula de Univer porque las casillas guardan
 * «SÍ»/«NO» y no números: una fórmula tendría que traducir texto a importe en
 * cada celda, y habría que reescribirla cada vez que cambian las columnas.
 */
export function valorFila(f: FilaRecorrido, bonos: BonoColumna[]): number {
	let total = 0;
	for (const b of bonos) if (f.bonos?.[b.config_id]) total += b.valor;
	return total;
}

/**
 * Cuántos días DISTINTOS hay hasta esta fila.
 *
 * Es lo que alterna la zebra: sombrear por fila partiría en dos los dos
 * recorridos de una misma jornada, que es justo lo que hay que leer junto.
 */
function indiceDeDia(filas: FilaRecorrido[], hasta: number): number {
	let n = 0;
	for (let i = 1; i <= hasta; i++) {
		if (filas[i].fecha !== filas[i - 1].fecha) n++;
	}
	return n;
}

/** `YYYY-MM-DD` → «LUN». Se leen los componentes en crudo, sin zona horaria. */
function diaSemana(iso: string): string {
	const [a, m, d] = iso.split('-').map(Number);
	if (!a || !m || !d) return '';
	return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/** Marca `+1` en la hora que cae al día siguiente (turno pasada medianoche). */
function horaConMarca(hora: string | null, diaSiguiente: boolean): string {
	if (!hora) return '';
	return diaSiguiente ? `${hora} +1` : hora;
}

function letra(c: number): string {
	let n = c;
	let s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}
