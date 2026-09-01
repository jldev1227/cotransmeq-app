/**
 * Exportación a XLSX de un LIBRO entero de canvas: una pestaña por hoja.
 *
 * ── Por qué no reutiliza `exportar-pdf.ts` ──
 * El PDF se saca del DOM ya renderizado, y el DOM solo tiene el documento
 * que el usuario está mirando. Un libro son doce meses o cuarenta cierres:
 * montarlos todos en el DOM para volver a leerlos sería pintar cuarenta
 * documentos que nadie ve. Aquí se parte del modelo (`DocumentoPreview`),
 * que es lo que los adaptadores de `datos/*.doc.ts` ya saben componer para
 * cualquier hoja, esté o no en pantalla.
 *
 * ── Por qué NO respeta la selección de columnas del preview ──
 * La selección delimita el PAPEL que se entrega al tercero: por eso las
 * columnas internas salen apagadas. El XLSX es la herramienta de trabajo
 * del equipo —se filtra, se cuadra, se pega en otro sitio—, y una columna
 * que falta ahí no se puede recuperar sin volver a exportar. Se escribe el
 * catálogo COMPLETO y las internas se marcan en gris, igual que el papel
 * hace cuando se encienden.
 *
 * ── Números, no cadenas ──
 * Todo importe se escribe como número con `numFmt`. Una celda con
 * «$ 1.234» es texto: no suma, no ordena y no filtra, que es justo para lo
 * que se abre el fichero. De ahí `CeldaFormateada.valor`.
 *
 * `exceljs` se carga con `import()` dinámico: pesa ~1MB y ningún canvas lo
 * necesita hasta que alguien pulsa el botón.
 */

import { CATALOGO, type ScopePreview } from './columnas';
import { fmtPlaca } from './formato';
import type {
	BloquePreview,
	CeldaFormateada,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	LineaResumen,
	SeccionPreview,
	TipoColumna,
	ValorCelda
} from './tipos';

// ─── Paleta ───────────────────────────────────────────────────────────
// ARGB de los mismos tokens que usa el documento impreso (`pdf-tokens.ts`).
// Se escriben aquí en el formato de exceljs en vez de convertirlos en
// tiempo de ejecución: son ocho constantes y la conversión sería más
// código que la tabla.
const VERDE = 'FF0F4025';
const VERDE_BORDE = 'FF0A2E1A';
const VERDE_SUAVE = 'FFEDF7F1';
const VERDE_TEXTO = 'FF065F46';
const TINTA = 'FF0F172A';
const TINTA_SUAVE = 'FF475569';
const TINTA_TENUE = 'FF64748B';
const REJILLA = 'FFDDE3EB';
const FOOT_BG = 'FFE2E8F0';
const INTERNO_BG = 'FFF8FAFC';
const BLANCO = 'FFFFFFFF';
const ROJO = 'FFB91C1C';
const AMBAR = 'FF92400E';
const AZUL = 'FF1D4ED8';

/** Fondo de la cabecera de cada bloque, por variante. Mismo código que el PDF. */
const COLOR_BLOQUE: Record<string, string> = {
	neutro: VERDE,
	gastos: AMBAR,
	anticipos: AZUL,
	impuestos: TINTA_SUAVE,
	copropietario: VERDE_TEXTO
};

// ─── Formatos de número ───────────────────────────────────────────────
const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
const FMT_NUM = '#,##0.##';
// El porcentaje del documento viene ya en unidades de 100 (`10` = 10%), así
// que NO se usa el formato `0%` de Excel: multiplicaría por cien otra vez.
const FMT_PCT = '0.##"%"';

/** Nombre de la pestaña + el documento que va en ella. */
export interface HojaLibro {
	/**
	 * Nombre de la pestaña. Se sanea y se hace único aquí, así que quien
	 * llama puede pasar la placa o el mes tal cual.
	 */
	nombre: string;
	documento: DocumentoPreview;
}

// ─── Estilos ──────────────────────────────────────────────────────────

interface EstiloCelda {
	size?: number;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	color?: string;
	fill?: string;
	align?: 'left' | 'right' | 'center';
	wrap?: boolean;
	indent?: number;
	numFmt?: string;
	sinBorde?: boolean;
}

function borde() {
	return {
		top: { style: 'thin', color: { argb: REJILLA } },
		left: { style: 'thin', color: { argb: REJILLA } },
		bottom: { style: 'thin', color: { argb: REJILLA } },
		right: { style: 'thin', color: { argb: REJILLA } }
	};
}

function pintar(cell: any, valor: any, e: EstiloCelda = {}) {
	if (valor !== undefined) cell.value = valor;
	cell.font = {
		name: 'Calibri',
		size: e.size ?? 9,
		bold: !!e.bold,
		italic: !!e.italic,
		strike: !!e.strike,
		color: { argb: e.color ?? TINTA }
	};
	cell.alignment = {
		horizontal: e.align ?? 'left',
		vertical: 'middle',
		wrapText: !!e.wrap,
		...(e.indent ? { indent: e.indent } : {})
	};
	if (e.fill) {
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: e.fill } };
	}
	if (!e.sinBorde) cell.border = borde();
	if (e.numFmt) cell.numFmt = e.numFmt;
	return cell;
}

// ─── Valores ──────────────────────────────────────────────────────────

function esFormateada(v: ValorCelda): v is CeldaFormateada {
	return typeof v === 'object' && v !== null && 'texto' in v;
}

/**
 * Una celda del documento traducida a celda de hoja: valor + formato.
 *
 * El adaptador puede haber decidido el formato (`CeldaFormateada`), y en
 * ese caso manda su color; el NÚMERO se toma de `valor` si viene, porque
 * el texto ya formateado no serviría para sumar. Si no viene —adaptador
 * que armó la celda a mano— se cae al texto, que al menos se lee.
 */
function celdaDeValor(v: ValorCelda, tipo: TipoColumna): { valor: any; estilo: EstiloCelda } {
	const numerico = (n: any, numFmt: string): { valor: any; estilo: EstiloCelda } => ({
		valor: Number(n) || 0,
		estilo: { numFmt, align: 'right' }
	});

	if (esFormateada(v)) {
		const color = v.signo === 'neg' ? ROJO : v.signo === 'pos' ? VERDE_TEXTO : undefined;
		if (typeof v.valor === 'number' && Number.isFinite(v.valor)) {
			return { valor: v.valor, estilo: { numFmt: FMT_COP, align: 'right', color } };
		}
		return { valor: v.texto, estilo: { align: 'right', color } };
	}

	if (v == null || v === '') return { valor: null, estilo: {} };

	switch (tipo) {
		case 'moneda':
			return numerico(v, FMT_COP);
		case 'numero':
			return numerico(v, FMT_NUM);
		case 'porcentaje':
			return numerico(v, FMT_PCT);
		case 'placa':
			return { valor: fmtPlaca(String(v)), estilo: { align: 'center' } };
		case 'booleano':
			return { valor: v ? 'SÍ' : 'NO', estilo: { align: 'center' } };
		default:
			return { valor: String(v), estilo: { align: 'left' } };
	}
}

/**
 * Ancho de columna a partir del peso del documento.
 *
 * El peso es un reparto proporcional pensado para un `colgroup`; aquí hace
 * falta una medida absoluta. El factor sale de cuadrar las columnas anchas
 * (RECORRIDO, peso 26) con lo que se lee sin ensanchar a mano.
 */
function anchoDe(c: ColumnaPreview): number {
	return Math.max(7, Math.min(38, Math.round((c.peso || 6) * 1.5)));
}

// ─── Nombres de pestaña ───────────────────────────────────────────────

/**
 * Nombre válido y único de pestaña.
 *
 * Excel rechaza el fichero entero si un nombre pasa de 31 caracteres,
 * lleva `[]:*?/\` o se repite. Dos cierres de la misma placa a
 * propietarios distintos SON dos hojas del mismo mes (ver la cabecera del
 * canvas de cierres), así que el choque no es hipotético: se desempata con
 * un sufijo en vez de perder una de las dos.
 */
function nombreDeHoja(bruto: string, usados: Set<string>): string {
	let base = (bruto || 'Hoja')
		.replace(/[\\/?*[\]:]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 31);
	if (!base) base = 'Hoja';
	if (!usados.has(base)) {
		usados.add(base);
		return base;
	}
	for (let i = 2; i < 1000; i++) {
		const sufijo = ` (${i})`;
		const cand = base.slice(0, 31 - sufijo.length) + sufijo;
		if (!usados.has(cand)) {
			usados.add(cand);
			return cand;
		}
	}
	usados.add(base);
	return base;
}

// ─── Pintado de una hoja ──────────────────────────────────────────────

/** Columnas del catálogo que esta sección declara, en el orden del catálogo. */
function columnasDeSeccion(scope: ScopePreview, sec: SeccionPreview): ColumnaPreview[] {
	const declaradas = new Set(sec.columnas);
	return CATALOGO[scope].filter((c) => declaradas.has(c.key));
}

/** Cuántas columnas ocupa la hoja: la sección más ancha, con un mínimo legible. */
function anchoLibro(scope: ScopePreview, doc: DocumentoPreview): number {
	let max = 4;
	for (const sec of doc.secciones) {
		max = Math.max(max, columnasDeSeccion(scope, sec).length);
		for (const b of sec.bloques ?? []) max = Math.max(max, b.columnas.length);
	}
	return max;
}

function fusionar(ws: any, fila: number, desde: number, hasta: number) {
	if (hasta > desde) ws.mergeCells(fila, desde, fila, hasta);
}

/** Tramo de columnas físicas que ocupa una columna lógica. */
type Tramo = [desde: number, hasta: number];

/**
 * Reparte `ancho` columnas físicas entre las columnas de un bloque, según
 * sus pesos.
 *
 * Los bloques traen columnas PROPIAS (CONCEPTO / DÍAS / VALOR / TOTAL) que
 * no son las del catálogo, pero la hoja tiene una sola rejilla: si se
 * escribieran una por columna caerían en los anchos de la tabla principal
 * —CONCEPTO en la columna del `#`, que mide siete— y se verían recortadas.
 * Repartiendo y fusionando, el bloque ocupa el ancho de la hoja como en el
 * papel y cada columna recibe el espacio que pedía.
 */
function repartirColumnas(cols: ColumnaPreview[], ancho: number): Tramo[] {
	const total = cols.reduce((s, c) => s + (c.peso || 1), 0) || 1;
	const tramos: Tramo[] = [];
	let col = 1;
	cols.forEach((c, i) => {
		// La última se estira hasta el borde: repartir por redondeo deja un
		// resto de una o dos columnas, y una tabla que no llega al margen se
		// lee como si le faltara algo.
		const restantes = cols.length - i - 1;
		const ideal = Math.round(((c.peso || 1) * ancho) / total);
		const ancho_i =
			i === cols.length - 1
				? ancho - col + 1
				: Math.max(1, Math.min(ideal, ancho - col - restantes + 1));
		tramos.push([col, col + ancho_i - 1]);
		col += ancho_i;
	});
	return tramos;
}

/** Cabecera del documento: razón social, título y la tabla de la esquina. */
function pintarCabecera(ws: any, doc: DocumentoPreview, ancho: number, fila: number): number {
	const finTitulo = Math.max(1, ancho - 2);

	fusionar(ws, fila, 1, finTitulo);
	pintar(ws.getCell(fila, 1), 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S', {
		size: 12,
		bold: true,
		color: VERDE,
		sinBorde: true
	});
	ws.getRow(fila).height = 20;
	fila++;

	fusionar(ws, fila, 1, finTitulo);
	pintar(ws.getCell(fila, 1), doc.titulo, {
		size: 10,
		bold: true,
		color: TINTA,
		sinBorde: true
	});
	ws.getRow(fila).height = 16;
	fila++;

	// La tabla de la esquina (Código / Versión / Fecha) va bajo el título y
	// no a su derecha: en una hoja de cálculo, un bloque flotante en las dos
	// últimas columnas estorba al filtrar la tabla de abajo.
	for (const m of doc.meta) {
		pintar(ws.getCell(fila, 1), m.label, {
			size: 8,
			bold: true,
			color: TINTA_TENUE,
			sinBorde: true
		});
		fusionar(ws, fila, 2, Math.max(2, finTitulo));
		pintar(ws.getCell(fila, 2), m.valor, { size: 8, color: TINTA_SUAVE, sinBorde: true });
		fila++;
	}

	return fila + 1;
}

/**
 * Banda de periodo: pares etiqueta/valor en dos filas de fondo verde suave.
 *
 * Si hay más datos de periodo que columnas en la hoja, se continúa en otro
 * par de filas debajo en vez de escribir en columnas que ninguna tabla usa
 * —que dejarían la hoja más ancha que su propia tabla al imprimir.
 */
function pintarPeriodo(ws: any, doc: DocumentoPreview, ancho: number, fila: number): number {
	if (!doc.periodo.length) return fila;

	for (let i = 0; i < doc.periodo.length; i += ancho) {
		const tramo = doc.periodo.slice(i, i + ancho);
		for (let c = 1; c <= ancho; c++) {
			const p = tramo[c - 1];
			pintar(ws.getCell(fila, c), p ? p.label.toUpperCase() : null, {
				size: 7.5,
				bold: true,
				color: TINTA_TENUE,
				fill: VERDE_SUAVE,
				align: 'center'
			});
			pintar(ws.getCell(fila + 1, c), p ? p.valor : null, {
				size: 9,
				bold: true,
				color: VERDE,
				fill: VERDE_SUAVE,
				align: 'center',
				wrap: true
			});
		}
		fila += 2;
	}

	return fila + 1;
}

/** Título de sección: banda verde a todo el ancho, con la nota a la derecha. */
function pintarTituloSeccion(ws: any, sec: SeccionPreview, ancho: number, fila: number): number {
	fusionar(ws, fila, 1, ancho);
	const texto = sec.nota ? `${sec.titulo}   ·   ${sec.nota}` : sec.titulo;
	pintar(ws.getCell(fila, 1), texto, {
		size: 10,
		bold: true,
		color: BLANCO,
		fill: VERDE,
		align: 'left'
	});
	for (let c = 1; c <= ancho; c++) {
		ws.getCell(fila, c).border = {
			top: { style: 'medium', color: { argb: VERDE_BORDE } },
			bottom: { style: 'medium', color: { argb: VERDE_BORDE } },
			left: { style: 'thin', color: { argb: VERDE_BORDE } },
			right: { style: 'thin', color: { argb: VERDE_BORDE } }
		};
	}
	ws.getRow(fila).height = 18;
	return fila + 1;
}

/**
 * Fila de cabecera de una tabla. Las columnas internas van en gris.
 *
 * `tramos` mapea cada columna lógica a un tramo de columnas físicas; sin
 * él va una a una. Se estila TODO el tramo antes de fusionarlo: en xlsx el
 * relleno de una celda fusionada solo cubre lo que se pintó, y con solo la
 * celda maestra la banda saldría a medias.
 */
function pintarCabeceraTabla(
	ws: any,
	cols: ColumnaPreview[],
	fila: number,
	fondo = VERDE,
	tramos?: Tramo[]
): number {
	cols.forEach((c, i) => {
		const [desde, hasta] = tramos?.[i] ?? [i + 1, i + 1];
		for (let x = desde; x <= hasta; x++) {
			pintar(ws.getCell(fila, x), x === desde ? c.label.toUpperCase() : null, {
				size: 8,
				bold: true,
				color: BLANCO,
				fill: c.interna ? TINTA_SUAVE : fondo,
				align: 'center',
				wrap: true
			});
		}
		fusionar(ws, fila, desde, hasta);
	});
	ws.getRow(fila).height = 24;
	return fila + 1;
}

/** Cuerpo de una tabla. Devuelve la primera fila libre. */
function pintarFilas(
	ws: any,
	cols: ColumnaPreview[],
	filas: FilaPreview[],
	fila: number,
	tramos?: Tramo[]
): number {
	for (const f of filas) {
		cols.forEach((c, i) => {
			const { valor, estilo } = celdaDeValor(f.celdas[c.key], c.tipo);
			const comun = {
				...estilo,
				size: 9,
				// La fila excluida se tacha, como en el papel: sigue visible para
				// poder restaurarla y NO suma en los totales.
				strike: f.excluida,
				bold: estilo.bold || f.destacada || f.variante === 'categoria',
				italic: f.excluida,
				color: f.excluida ? TINTA_TENUE : estilo.color,
				fill: c.interna
					? INTERNO_BG
					: f.destacada || f.variante === 'categoria'
						? VERDE_SUAVE
						: undefined,
				indent: f.variante === 'hija' && i === 0 ? 1 : estilo.indent
			};
			const [desde, hasta] = tramos?.[i] ?? [i + 1, i + 1];
			for (let x = desde; x <= hasta; x++) {
				pintar(ws.getCell(fila, x), x === desde ? valor : null, comun);
			}
			fusionar(ws, fila, desde, hasta);
		});
		fila++;
	}
	return fila;
}

/** Pie de totales de la tabla principal de una sección. */
function pintarTotales(ws: any, sec: SeccionPreview, cols: ColumnaPreview[], fila: number): number {
	if (!sec.totales) return fila;

	const primera = cols.findIndex((c) => sec.totales?.[c.key] != null);
	const span = primera <= 0 ? 1 : primera;

	fusionar(ws, fila, 1, span);
	pintar(ws.getCell(fila, 1), sec.totalesLabel || 'Totales', {
		size: 9,
		bold: true,
		color: TINTA,
		fill: FOOT_BG,
		align: 'right'
	});

	cols.slice(span).forEach((c, i) => {
		const { valor, estilo } = celdaDeValor(sec.totales?.[c.key], c.tipo);
		pintar(ws.getCell(fila, span + i + 1), valor, {
			...estilo,
			size: 9,
			bold: true,
			fill: FOOT_BG
		});
	});
	ws.getRow(fila).height = 17;
	return fila + 1;
}

/** Un bloque (conductor, gastos, anticipos, impuestos) con su cabecera y su pie. */
function pintarBloque(ws: any, b: BloquePreview, ancho: number, fila: number): number {
	const cols = b.columnas;
	const fondo = COLOR_BLOQUE[b.variante ?? 'neutro'] ?? VERDE;
	// El bloque ocupa el ancho de la hoja, repartido por los pesos de SUS
	// columnas. Ver `repartirColumnas`.
	const tramos = repartirColumnas(cols, ancho);

	if (b.titulo || b.subtitulo || b.etiqueta) {
		const partes = [b.titulo, b.subtitulo].filter(Boolean).join('  ·  ');
		for (let x = 1; x <= ancho; x++) {
			pintar(
				ws.getCell(fila, x),
				x === 1 ? (b.etiqueta ? `${partes}   [${b.etiqueta}]` : partes) : null,
				{
					size: 9,
					bold: true,
					color: BLANCO,
					fill: fondo
				}
			);
		}
		fusionar(ws, fila, 1, ancho);
		ws.getRow(fila).height = 16;
		fila++;
	}

	if (!b.filas.length) {
		fusionar(ws, fila, 1, ancho);
		pintar(ws.getCell(fila, 1), b.vacio || 'Sin filas.', {
			size: 8,
			italic: true,
			color: TINTA_TENUE
		});
		fila++;
	} else {
		fila = pintarCabeceraTabla(ws, cols, fila, fondo, tramos);
		fila = pintarFilas(ws, cols, b.filas, fila, tramos);
	}

	if (b.pie) {
		const { valor, estilo } = celdaDeValor(b.pie.valor, 'moneda');
		// El importe cae bajo la ÚLTIMA columna del bloque (el TOTAL), no en
		// el borde de la hoja: es la columna que ese número cierra.
		const [inicioValor] = tramos[tramos.length - 1] ?? [ancho, ancho];
		for (let x = 1; x <= ancho; x++) {
			pintar(ws.getCell(fila, x), x === 1 ? b.pie.label : x === inicioValor ? valor : null, {
				...(x === inicioValor ? estilo : {}),
				size: 9,
				bold: true,
				fill: FOOT_BG,
				align: x < inicioValor ? 'right' : estilo.align
			});
		}
		fusionar(ws, fila, 1, Math.max(1, inicioValor - 1));
		fusionar(ws, fila, inicioValor, ancho);
		fila++;
	}

	return fila + 1;
}

/**
 * Bloque clave/valor (totales de la hoja, resumen final).
 *
 * Se ancla a la DERECHA de la hoja, como en el papel: son la lectura final
 * del documento y quedan bajo las columnas de importes.
 */
function pintarResumen(ws: any, lineas: LineaResumen[], ancho: number, fila: number): number {
	if (!lineas.length) return fila;

	const colValor = ancho;
	const colLabel = ancho >= 5 ? ancho - 3 : 1;

	for (const l of lineas) {
		const { valor, estilo } = celdaDeValor(l.valor, 'moneda');
		const fondo = l.fuerte ? VERDE_SUAVE : l.descuento ? FOOT_BG : undefined;

		fusionar(ws, fila, colLabel, Math.max(colLabel, colValor - 1));
		pintar(ws.getCell(fila, colLabel), l.label, {
			size: l.fuerte ? 10 : 9,
			bold: true,
			color: l.fuerte ? VERDE : TINTA_SUAVE,
			fill: fondo,
			align: 'right'
		});
		pintar(ws.getCell(fila, colValor), valor, {
			...estilo,
			size: l.fuerte ? 11 : 9,
			bold: true,
			color: l.fuerte ? VERDE_TEXTO : l.descuento ? ROJO : estilo.color,
			fill: fondo
		});
		if (l.fuerte) ws.getRow(fila).height = 20;
		fila++;
	}

	return fila + 1;
}

function pintarFirmas(ws: any, ancho: number, fila: number): number {
	const mitad = Math.max(1, Math.floor(ancho / 2));
	fila++;
	for (const [col, label] of [
		[1, 'LIQUIDADO POR:'],
		[mitad + 1, 'REVISADO POR:']
	] as Array<[number, string]>) {
		pintar(ws.getCell(fila, col), label, {
			size: 8,
			bold: true,
			color: TINTA_TENUE,
			sinBorde: true
		});
	}
	fila++;
	for (const col of [1, mitad + 1]) {
		const hasta = col === 1 ? mitad : ancho;
		fusionar(ws, fila, col, Math.max(col, hasta));
		const cell = ws.getCell(fila, col);
		pintar(cell, null, { sinBorde: true });
		cell.border = { bottom: { style: 'thin', color: { argb: TINTA } } };
	}
	ws.getRow(fila).height = 26;
	return fila + 2;
}

/** Vuelca un documento entero en una pestaña recién creada. */
function pintarDocumento(ws: any, scope: ScopePreview, doc: DocumentoPreview): void {
	const ancho = anchoLibro(scope, doc);

	// Anchos de columna: los del catálogo del canvas, que es la tabla más
	// ancha de la hoja. Los bloques comparten esas columnas físicas aunque
	// sus columnas lógicas sean otras; es la única repartición posible en
	// una rejilla única, y por eso los bloques se apilan y no se ponen en
	// tres por fila como en el papel.
	const catalogo = CATALOGO[scope];
	for (let c = 1; c <= ancho; c++) {
		ws.getColumn(c).width = catalogo[c - 1] ? anchoDe(catalogo[c - 1]) : 14;
	}

	let fila = 1;
	fila = pintarCabecera(ws, doc, ancho, fila);
	fila = pintarPeriodo(ws, doc, ancho, fila);

	for (const sec of doc.secciones) {
		fila = pintarTituloSeccion(ws, sec, ancho, fila);

		const cols = columnasDeSeccion(scope, sec);
		if (cols.length === 0) {
			// Sección sin tabla: solo su bloque clave/valor (los desgloses de
			// descuentos del canvas ocasional).
		} else if (sec.filas.length === 0) {
			fusionar(ws, fila, 1, ancho);
			pintar(ws.getCell(fila, 1), sec.vacio || 'Sin filas.', {
				size: 9,
				italic: true,
				color: TINTA_TENUE
			});
			fila++;
		} else {
			const cabecera = fila;
			fila = pintarCabeceraTabla(ws, cols, fila);
			const ultimaFila = pintarFilas(ws, cols, sec.filas, fila) - 1;
			fila = pintarTotales(ws, sec, cols, ultimaFila + 1);
			// Autofiltro sobre la tabla principal: es lo primero que se hace
			// con este fichero. Solo uno por hoja —Excel no admite más—, así
			// que se queda con la PRIMERA sección con datos. El rango llega
			// hasta la última fila de DATOS: incluir el pie de totales lo
			// dejaría oculto en cuanto se filtre cualquier cosa.
			if (!ws.autoFilter && ultimaFila >= cabecera) {
				ws.autoFilter = {
					from: { row: cabecera, column: 1 },
					to: { row: ultimaFila, column: cols.length }
				};
			}
		}

		fila++;
		for (const b of sec.bloques ?? []) {
			fila = pintarBloque(ws, b, ancho, fila);
		}

		if (sec.resumen?.length) fila = pintarResumen(ws, sec.resumen, ancho, fila);
	}

	if (doc.resumen?.length) fila = pintarResumen(ws, doc.resumen, ancho, fila);
	if (doc.firmas !== false) fila = pintarFirmas(ws, ancho, fila);

	// Cabecera congelada: las hojas de un cierre pasan de cien filas y sin
	// esto se pierde de vista de qué documento se está leyendo.
	ws.views = [{ state: 'frozen', ySplit: 2 }];
	ws.pageSetup = {
		orientation: 'landscape',
		fitToPage: true,
		fitToWidth: 1,
		fitToHeight: 0,
		margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
	};
}

// ─── API ──────────────────────────────────────────────────────────────

/**
 * Genera el XLSX del libro y lo descarga.
 *
 * @param scope   canvas del que salen las hojas: decide el catálogo de columnas.
 * @param hojas   una entrada por pestaña, EN EL ORDEN en que se quieren ver.
 * @param archivo nombre del fichero, sin extensión.
 */
export async function exportarExcelLibro(
	scope: ScopePreview,
	hojas: HojaLibro[],
	archivo: string
): Promise<void> {
	if (typeof window === 'undefined') return;
	if (!hojas.length) throw new Error('No hay hojas con datos que exportar.');

	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Cotransmeq · Canvas de terceros';
	wb.created = new Date();
	wb.modified = new Date();

	const usados = new Set<string>();
	for (const h of hojas) {
		const ws = wb.addWorksheet(nombreDeHoja(h.nombre, usados), {
			properties: { tabColor: { argb: VERDE } }
		});
		pintarDocumento(ws, scope, h.documento);
	}

	const buffer = await wb.xlsx.writeBuffer();
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${archivo}.xlsx`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// El navegador ya tiene el fichero pasado un minuto; retener el blob más
	// tiempo solo ocupa memoria de la pestaña del canvas.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
