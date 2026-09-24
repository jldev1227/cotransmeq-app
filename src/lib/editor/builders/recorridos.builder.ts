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
import type { RecorridoBindingSeed } from '../business/recorridos-cell-binding';

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
	/** Días de desfase de cada extremo: 0 mismo día, 1 el siguiente. */
	dias_offset_inicio: number;
	dias_offset_fin: number;
	horas_conducidas: number;
	km_inicial: number | null;
	km_final: number | null;
	pernocte: boolean;
	/** Lo que se lee en la columna DESCRIPCIÓN, sea del tramo o del día. */
	descripcion: string | null;
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
 * son dinámicas; el valor a pagar cierra la tabla.
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

/**
 * Las filas de cabecera NO son constantes: una hoja de solo consulta añade la
 * banda de aviso y desplaza todo una fila. El builder las va contando y
 * devuelve el rango de datos en `rangoFilas`.
 */

/** Filas en blanco bajo la tabla, para que la hoja no acabe a ras del dato. */
const FILAS_COLCHON = 6;

export function totalColumnas(bonos: BonoColumna[]): number {
	// Fijas + una por bono + valor a pagar.
	return COL_BONO_INICIO + bonos.length + 1;
}

export function colValorPagar(bonos: BonoColumna[]): number {
	return COL_BONO_INICIO + bonos.length;
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

/**
 * Tonos de MARCA. Salen de `identidad-empresa.ts`, el único archivo que
 * diverge entre los dos repos: escritos aquí, el canvas de Cotransmeq se
 * pintaba con el verde de Transmeralda.
 */
const GREEN: string = IDENTIDAD.colores.fuerte;
/** La marca usada COMO TEXTO sobre fondo claro: importes y totales. */
const TEXTO_MARCA: string = IDENTIDAD.colores.textoMarca;
const GREEN_DARK: string = IDENTIDAD.colores.acento;
const GREEN_SOFT: string = IDENTIDAD.colores.suave;
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

/**
 * Formato de la columna de horas: «6 horas», «6.5 horas», «1 hora».
 *
 * Es FORMATO NUMÉRICO, no texto: el valor de la celda sigue siendo el número,
 * así que el binding, el backend y el PDF no se enteran, y sumar la columna
 * sigue funcionando. La palabra la pone Univer al pintar. Quien teclea «6
 * horas» también entra: el backend lo lee como 6 y devuelve el número.
 */
export const FORMATO_HORAS = '[=1]General" hora";General" horas"';

const horas = (z: boolean): IStyleData =>
	({ ...derecha(z), n: { pattern: FORMATO_HORAS } }) as IStyleData;

/**
 * Fondo de una fila BORRADOR: insertada en el canvas y aún sin guardar.
 *
 * Ámbar suave, el mismo tono del contador del carril. Se quita al vincularla:
 * el color dice «esto todavía no está en el servidor».
 */
export const BORRADOR_BG = '#FEF3C7';

const moneda = (z: boolean): IStyleData =>
	({
		...celda(z),
		bl: 1,
		cl: { rgb: TEXTO_MARCA },
		ht: HorizontalAlign.RIGHT,
		n: { pattern: '"$"#,##0' }
	}) as IStyleData;

export const estiloTipo = (tipo: string, z: boolean): IStyleData =>
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
		bg: { rgb: marcada ? IDENTIDAD.colores.acentoTenue : z ? ZEBRA_BG : BLANCO }
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
	/**
	 * Primera fila que ocuparían los datos, aunque no haya ninguno. La usa el
	 * engine para saber dónde puede insertar el usuario en una hoja vacía.
	 */
	filaInicioDatos: number;
}

/**
 * Las celdas de una fila de datos EN BLANCO, con los estilos de sus vecinas.
 *
 * Es lo que se pinta en una fila que el usuario acaba de insertar: Univer copia
 * los estilos de la fila de encima, pero copiaría también el verde de una
 * casilla marcada o el color del tipo de día, y la fila nueva parecería llena.
 * Aquí sale limpia, con las casillas en NO y el valor a pagar en cero.
 */
export function celdasFilaVacia(
	bonos: BonoColumna[],
	opts: { borrador?: boolean; z?: boolean } = {}
): Record<number, ICellData> {
	const z = opts.z ?? false;
	/// `bg: null` y no «sin bg»: Univer FUSIONA el estilo nuevo con el que ya
	/// tiene la celda, así que omitir el fondo dejaría el ámbar del borrador
	/// pegado a la fila ya guardada. Un `null` explícito sí lo quita.
	const bg = opts.borrador ? { bg: { rgb: BORRADOR_BG } } : z ? {} : { bg: null };
	/// Resets explícitos por lo mismo: la fila puede haber heredado negrita,
	/// ajuste de texto o un formato numérico de la fila copiada. `null` quita
	/// la propiedad; omitirla la dejaría.
	const reset = { bl: 0, it: 0, tb: null, vt: null, n: null } as Partial<IStyleData>;
	const con = (s: IStyleData): IStyleData => ({ ...reset, ...s, ...bg }) as IStyleData;
	const texto = (v: string | number, s: IStyleData): ICellData => ({
		v,
		t: typeof v === 'number' ? CellValueType.NUMBER : CellValueType.STRING,
		s: con(s)
	});

	const out: Record<number, ICellData> = {
		[COL.ITEM]: texto(opts.borrador ? '+' : '', centrado(z)),
		[COL.FECHA]: texto('', centrado(z)),
		[COL.DIA_SEMANA]: texto('', centrado(z)),
		[COL.TIPO]: texto('', centrado(z)),
		[COL.PLACA]: texto('', centrado(z)),
		[COL.DESCRIPCION]: texto('', celda(z)),
		[COL.HORA_INI]: texto('', centrado(z)),
		[COL.HORA_FIN]: texto('', centrado(z)),
		[COL.HORAS]: texto('', horas(z)),
		[COL.PERNOCTE]: texto(CASILLA_NO, estiloCasilla(false, z)),
		[COL.CLIENTE]: texto('', celda(z)),
		[COL.KM_INI]: texto('', derecha(z)),
		[COL.KM_FIN]: texto('', derecha(z))
	};
	bonos.forEach((_, k) => {
		out[COL_BONO_INICIO + k] = texto(CASILLA_NO, estiloCasilla(false, z));
	});
	out[colValorPagar(bonos)] = texto(0, moneda(z));
	if (opts.borrador) {
		for (const c of Object.values(out)) c.s = con(c.s as IStyleData);
	}
	return out;
}

/**
 * Bindings de una fila BORRADOR: las mismas columnas editables que un
 * recorrido, más el tipo de día, para que el usuario pueda escribir cualquiera
 * de las dos clases de fila y el canvas decida al guardar.
 *
 * Los bonos también: se marcan en el borrador y viajan con el alta.
 */
export function bindingsFilaNueva(
	r: number,
	entityId: string,
	conductorId: string,
	bonos: BonoColumna[]
): RecorridoBindingSeed[] {
	const comun = { tipoFila: 'nueva' as const, entityId, conductorId, registroDiaId: '' };
	const campos: Array<[number, string]> = [
		[COL.FECHA, 'fecha'],
		[COL.TIPO, 'tipo_dia'],
		[COL.PLACA, 'vehiculo_placa'],
		[COL.DESCRIPCION, 'descripcion'],
		[COL.HORA_INI, 'hora_inicio'],
		[COL.HORA_FIN, 'hora_fin'],
		[COL.HORAS, 'horas_conducidas'],
		[COL.PERNOCTE, 'pernocte'],
		[COL.CLIENTE, 'cliente_nombre'],
		[COL.KM_INI, 'km_inicial'],
		[COL.KM_FIN, 'km_final']
	];
	const seeds = campos.map(([c, field]) => ({ r, c, binding: { ...comun, field } }));
	bonos.forEach((b, k) =>
		seeds.push({ r, c: COL_BONO_INICIO + k, binding: { ...comun, field: `bono:${b.config_id}` } })
	);
	return seeds;
}

/**
 * Bindings de una fila ya GUARDADA, por su `FilaRecorrido`.
 *
 * Es la misma regla que aplica el builder al montar —qué columnas se editan en
 * un recorrido y cuáles en un día—, sacada a una función para que una fila
 * vinculada tras insertarla quede exactamente igual que sus vecinas.
 */
export function bindingsDeFila(
	r: number,
	f: FilaRecorrido,
	conductorId: string,
	bonos: BonoColumna[]
): RecorridoBindingSeed[] {
	const comun = {
		tipoFila: f.tipo_fila,
		entityId: f.segmento_id ?? f.registro_dia_id,
		conductorId,
		registroDiaId: f.registro_dia_id
	};
	const seeds: RecorridoBindingSeed[] = [];
	const bind = (c: number, field: string) => seeds.push({ r, c, binding: { ...comun, field } });

	/// La FECHA se edita en las dos clases de fila. Es la del DÍA: moverla en
	/// un recorrido mueve la jornada entera con sus demás tramos, y el
	/// servidor devuelve cuáles para repintarlos.
	bind(COL.FECHA, 'fecha');
	if (f.tipo_fila === 'dia') bind(COL.TIPO, 'tipo_dia');

	if (f.tipo_fila === 'segmento') {
		bind(COL.PLACA, 'vehiculo_placa');
		/// Mismo sitio en la hoja, columna distinta en la base: en un tramo es la
		/// descripción del servicio, y es obligatoria.
		bind(COL.DESCRIPCION, 'descripcion_servicio');
		bind(COL.HORA_INI, 'hora_inicio');
		bind(COL.HORA_FIN, 'hora_fin');
		bind(COL.HORAS, 'horas_conducidas');
		bind(COL.PERNOCTE, 'pernocte');
		bind(COL.CLIENTE, 'cliente_nombre');
		bind(COL.KM_INI, 'km_inicial');
		bind(COL.KM_FIN, 'km_final');
	} else {
		bind(COL.DESCRIPCION, 'observaciones');
		/// PERNOCTE también en las filas de DÍA.
		///
		/// Son los días sin recorrido —disponibilidad, descanso—, y en un
		/// corte son más de la mitad de las filas. La casilla se pintaba en
		/// todas pero solo tenía binding en los recorridos, así que en la
		/// mayoría el clic moría contra la guarda con un «esta celda no se
		/// edita aquí». El valor va a la columna `pernocte` del día, que es
		/// donde vive cuando no hay tramo al que colgarlo.
		bind(COL.PERNOCTE, 'pernocte');
	}
	bonos.forEach((b, k) => bind(COL_BONO_INICIO + k, `bono:${b.config_id}`));
	return seeds;
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

	/// En una hoja de solo lectura NO se registra ningún binding: el interceptor
	/// de permisos es default-deny, así que sin bindings la hoja entera queda
	/// bloqueada sin necesidad de una segunda regla que mantener en paralelo.

	let row = 0;

	// ═══ TÍTULO DE LA HOJA ═══════════════════════════════════════════
	// El nombre de pestaña va truncado a 31 caracteres, así que el nombre
	// completo del conductor solo se puede leer aquí. NOMBRE y luego apellido,
	// como se presenta una persona.
	const nombreCompleto = `${hoja.nombre} ${hoja.apellido}`.replace(/\s+/g, ' ').trim();
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
	set(row, COL.DESCRIPCION, 'DESCRIPCIÓN DEL SERVICIO', CABECERA);
	set(row, COL.HORA_INI, 'HORA INICIAL', CABECERA);
	set(row, COL.HORA_FIN, 'HORA FINAL', CABECERA);
	set(row, COL.HORAS, 'TIEMPO DE CONDUCCIÓN', CABECERA);
	set(row, COL.PERNOCTE, 'PERNOTE', CABECERA);
	set(row, COL.CLIENTE, 'CLIENTE', CABECERA);
	set(row, COL.KM_INI, 'KM INICIAL', CABECERA);
	set(row, COL.KM_FIN, 'KM FINAL', CABECERA);
	bonos.forEach((b, i) => set(row, COL_BONO_INICIO + i, b.nombre.toUpperCase(), CABECERA));
	set(row, colTotal, 'VALOR A PAGAR', CABECERA);
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

		set(row, COL.ITEM, i + 1, centrado(z));
		set(row, COL.FECHA, f.fecha, centrado(z));
		set(row, COL.DIA_SEMANA, diaSemana(f.fecha), centrado(z));
		set(row, COL.TIPO, f.tipo_dia, estiloTipo(f.tipo_dia, z));
		set(row, COL.PLACA, f.vehiculo_placa ?? '', centrado(z));
		set(row, COL.DESCRIPCION, f.descripcion ?? '', celda(z));
		set(row, COL.HORA_INI, horaConDia(f.hora_inicio, f.dias_offset_inicio), centrado(z));
		set(row, COL.HORA_FIN, horaConDia(f.hora_fin, f.dias_offset_fin), centrado(z));
		set(row, COL.HORAS, f.horas_conducidas, horas(z));
		set(row, COL.PERNOCTE, comoCasilla(f.pernocte), estiloCasilla(f.pernocte, z));
		set(row, COL.CLIENTE, f.cliente_nombre ?? '', celda(z));
		set(row, COL.KM_INI, f.km_inicial ?? '', derecha(z));
		set(row, COL.KM_FIN, f.km_final ?? '', derecha(z));

		bonos.forEach((b, k) => {
			const marcado = f.bonos?.[b.config_id] === true;
			set(row, COL_BONO_INICIO + k, comoCasilla(marcado), estiloCasilla(marcado, z));
		});

		/// Qué se edita en cada fila lo decide `bindingsDeFila`, compartido con
		/// la vinculación de las filas insertadas en el canvas.
		if (editable) bindings.push(...bindingsDeFila(row, f, hoja.conductor_id, bonos));

		// Derivada: la suma de los bonos marcados. La pinta el canvas y la
		// repinta el servidor al confirmar el patch; nadie la teclea.
		set(row, colTotal, valorFila(f, bonos), moneda(z));

		row++;
	});

	const hayFilas = hoja.filas.length > 0;
	const ultimaFila = row - 1;

	// ═══ PIE ═════════════════════════════════════════════════════════
	// SIEMPRE, también sin filas: el pie es el tope de la zona donde el usuario
	// puede insertar, y su fórmula se reescribe al insertar o eliminar. En una
	// hoja vacía suma la única fila en blanco que hay debajo de la cabecera.
	for (let c = 0; c < nCols; c++) set(row, c, '', PIE);
	set(row, COL.DESCRIPCION, 'TOTAL EN BONOS DEL PERIODO', PIE_ETIQUETA);
	cellData[row][colTotal] = {
		v: 0,
		t: CellValueType.NUMBER,
		/// Sin filas no hay fórmula: apuntaría a sí misma. El engine la pone
		/// en cuanto se inserta la primera.
		...(hayFilas ? { f: formulaPie(colTotal, primeraFila, ultimaFila) } : {}),
		s: PIE
	};
	rowData[row] = { h: 26 };
	row++;

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
		rangoFilas: hayFilas ? { desde: primeraFila, hasta: ultimaFila } : null,
		filaInicioDatos: primeraFila
	};
}

/**
 * Fórmula del pie de totales. `SUBTOTAL(109,…)` y no `SUM` para que el pie siga
 * al autofiltro: si el usuario filtra por una placa, el total debe cuadrar con
 * lo que ve. Exportada porque el engine la reescribe al insertar o eliminar
 * filas: Excel —y Univer— no extienden un rango cuando se inserta justo debajo
 * de su última fila.
 */
export function formulaPie(colTotal: number, primeraFila: number, ultimaFila: number): string {
	return `=SUBTOTAL(109,${letra(colTotal)}${primeraFila + 1}:${letra(colTotal)}${ultimaFila + 1})`;
}

/** Estilo del pie, para repintar la celda de la fórmula. */
export { PIE as ESTILO_PIE };

// ─── Workbook completo ────────────────────────────────────────────────

export interface LibroRecorridos {
	workbook: IWorkbookData;
	unitId: string;
	sheetIdPorConductor: Record<string, string>;
	bindingsPorHoja: Record<string, RecorridoBindingSeed[]>;
	rangoPorHoja: Record<string, { desde: number; hasta: number } | null>;
	/** Primera fila de datos de cada hoja, aunque esté vacía. */
	inicioDatosPorHoja: Record<string, number>;
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
	const inicioDatosPorHoja: Record<string, number> = {};

	for (const hoja of dto.hojas) {
		const sheetId = conductorSheetId(hoja.conductor_id);
		const { sheet, bindings, rangoFilas, filaInicioDatos } = buildHojaRecorridos({
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
		inicioDatosPorHoja[sheetId] = filaInicioDatos;
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

	return { workbook, unitId, sheetIdPorConductor, bindingsPorHoja, rangoPorHoja, inicioDatosPorHoja };
}

function hojaVacia(etiqueta: string) {
	const cellData: Record<number, Record<number, ICellData>> = {
		0: {
			0: { v: `No hay recorridos registrados en ${etiqueta}.`, t: CellValueType.STRING, s: TITULO_HOJA }
		},
		1: {
			0: {
				v: 'Registra el primer día desde la ficha del conductor, o cambia de corte en la barra superior.',
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

/**
 * `YYYY-MM-DD` → «LUN». Se leen los componentes en crudo, sin zona horaria.
 *
 * Exportada: el engine la usa para rellenar la columna DÍA cuando el usuario
 * escribe una fecha, que es la única celda derivada que cambia con una
 * edición local.
 */
export function diaSemana(iso: string): string {
	const [a, m, d] = iso.split('-').map(Number);
	if (!a || !m || !d) return '';
	return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * La hora, y de qué día es cuando no es el del registro.
 *
 * En la celda no cabe la fecha completa —la columna es estrecha y son cientos
 * de filas—, así que se abrevia a «(día sig.)» / «(+2 días)». Sigue siendo
 * legible, que es lo que el «+1» a secas no era: nadie sabía si era una hora
 * más, un día más o el día anterior.
 */
function horaConDia(hora: string | null, diasOffset: number): string {
	if (!hora) return '';
	const n = Math.max(0, Math.trunc(Number(diasOffset) || 0));
	if (n === 0) return hora;
	return n === 1 ? `${hora} (día sig.)` : `${hora} (+${n} días)`;
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
