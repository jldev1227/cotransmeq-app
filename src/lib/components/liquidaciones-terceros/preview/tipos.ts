/**
 * Modelo del documento que pintan los previews de canvas.
 *
 * Los cuatro canvas del módulo (cierres, adicionales, ocasional, ingresos)
 * son hojas de cálculo distintas, pero lo que se IMPRIME de ellas tiene la
 * misma forma: una o varias tablas con sus totales, precedidas de una
 * cabecera de documento y seguidas de un resumen y unas firmas.
 *
 * Por eso hay UN componente de preview y no cuatro: cada canvas aporta un
 * adaptador (`datos/*.ts`) que traduce su estado a estas estructuras, y
 * `PreviewCanvasModal.svelte` las pinta. Añadir un canvas es escribir un
 * adaptador, no otro documento entero.
 */

/**
 * Cómo se formatea y alinea una celda.
 *
 * El adaptador entrega valores CRUDOS (números, strings) y el tipo decide
 * el formato. Si cada adaptador formateara por su cuenta acabaríamos con
 * cuatro maneras distintas de escribir un peso, que es exactamente lo que
 * este módulo viene a evitar.
 */
export type TipoColumna = 'texto' | 'moneda' | 'numero' | 'porcentaje' | 'placa' | 'booleano';

export interface ColumnaPreview {
	/** Identidad de la columna. Es lo que se guarda en la selección. */
	key: string;
	label: string;
	tipo: TipoColumna;
	/**
	 * Peso del ancho. No es un porcentaje: el `colgroup` se normaliza sobre
	 * las columnas VISIBLES, así que ocultar una reparte su espacio entre
	 * las demás en vez de dejar un hueco.
	 */
	peso: number;
	/**
	 * Columna de uso interno: se pinta en gris y NO entra en la selección
	 * por defecto. Es lo que el documento del tercero no debería llevar.
	 */
	interna?: boolean;
	/** No se puede ocultar (el `#`, la placa…). */
	fija?: boolean;
	/** Visible mientras el usuario no toque el selector. Default: `true`. */
	defecto?: boolean;
	/** Ayuda del selector de columnas. */
	nota?: string;
}

/** Celda con formato ya decidido por el adaptador, saltándose el tipo. */
export interface CeldaFormateada {
	texto: string;
	/** `neg` la pinta en rojo, `pos` en verde. */
	signo?: 'neg' | 'pos';
	/**
	 * Importe CRUDO del que salió `texto`.
	 *
	 * El HTML solo necesita el texto, pero el export a Excel necesita el
	 * número: una celda con `"$ 1.234"` es una cadena, no suma y no se
	 * puede filtrar. Lo rellenan los helpers de `formato.ts`, que son los
	 * únicos sitios donde se construyen estas celdas; si algún día un
	 * adaptador arma una a mano sin `valor`, el export cae al texto.
	 */
	valor?: number;
}

export type ValorCelda = string | number | boolean | null | undefined | CeldaFormateada;

export interface FilaPreview {
	/** Valores por `key` de columna. Las claves ausentes salen vacías. */
	celdas: Record<string, ValorCelda>;
	/** Fila de énfasis (adicional de COTRANSMEQ, subtotal por placa…). */
	destacada?: boolean;
	/** Fila excluida del cómputo: se muestra tachada. */
	excluida?: boolean;
	/**
	 * Papel de la fila dentro de un bloque jerárquico.
	 *
	 * `categoria` es el agregado (PRESTACIONES SOCIALES) e `hija` cada
	 * concepto que cuelga de él. Es la misma jerarquía que pinta la hoja;
	 * sin ella, los porcentajes de la categoría y los de sus hijos se leen
	 * como si fueran del mismo nivel y parecen contradecirse.
	 */
	variante?: 'categoria' | 'hija';
}

/** Fila de un bloque clave/valor (totales de una hoja, resumen final). */
export interface LineaResumen {
	label: string;
	valor: ValorCelda;
	/** Se pinta como línea de descuento (fondo gris, cifra en rojo). */
	descuento?: boolean;
	/** Línea final: fondo verde, cuerpo mayor. */
	fuerte?: boolean;
}

/**
 * Sub-tabla con columnas PROPIAS, fuera del catálogo del canvas.
 *
 * Existe para los bloques de descuentos de la hoja de un cierre —un
 * conductor, los gastos, los anticipos, los impuestos—: sus columnas
 * (CONCEPTO / DÍAS / VALOR / TOTAL) no son columnas del documento sino de
 * ese bloque, y meterlas en el catálogo llenaría el selector de opciones
 * que solo aplican a un trozo. Por eso NO pasan por la selección: lo que
 * el usuario delimita es la tabla de items.
 */
export interface BloquePreview {
	id: string;
	titulo?: string;
	/** Segunda línea de la cabecera (nombre del conductor, su cédula…). */
	subtitulo?: string;
	/** Marca a la derecha de la cabecera («PROPIETARIO: SÍ»). */
	etiqueta?: string;
	columnas: ColumnaPreview[];
	filas: FilaPreview[];
	/** Pie del bloque: una sola línea etiqueta + importe. */
	pie?: { label: string; valor: ValorCelda };
	/**
	 * Color del bloque, como en el PDF: ámbar gastos, azul anticipos…
	 *
	 * `concepto` es el verde CLARO de los pagos internos por concepto. Va
	 * aparte de `copropietario` —verde pleno— a propósito: ese dinero se
	 * destina a un concepto y no sale hacia nadie, y con el mismo verde los
	 * dos bloques se leían como el mismo tipo de pago.
	 */
	variante?: 'neutro' | 'gastos' | 'anticipos' | 'impuestos' | 'copropietario' | 'concepto';
	/** Qué decir cuando el bloque no tiene filas. */
	vacio?: string;
	/**
	 * 'completo' hace que el bloque ocupe TODA la fila de la rejilla
	 * (grid-column 1/-1), sin importar `bloquesPorFila`. Para bloques con
	 * protagonismo: el resumen de la sección o un pago interno por concepto.
	 */
	ancho?: 'completo';
}

export interface SeccionPreview {
	id: string;
	titulo: string;
	/** Texto pequeño a la derecha del título (conteos, porcentajes…). */
	nota?: string;
	/** Sub-tablas de la sección. Se pintan bajo la tabla principal, si la hay. */
	bloques?: BloquePreview[];
	/** Cuántos bloques por fila. Default: 3. */
	bloquesPorFila?: 1 | 2 | 3;
	/**
	 * Claves del catálogo que ESTA sección sabe rellenar.
	 *
	 * No es la lista de lo que se ve: eso lo decide la selección del
	 * usuario. Una sección declara lo que tiene, y el documento pinta la
	 * intersección con lo que el usuario dejó activo.
	 */
	columnas: string[];
	filas: FilaPreview[];
	/** Pie de la tabla, por `key` de columna. */
	totales?: Record<string, ValorCelda>;
	/** Etiqueta del pie. Ocupa las columnas anteriores a la primera con total. */
	totalesLabel?: string;
	/** Qué decir cuando no hay filas. */
	vacio?: string;
	/** Bloque clave/valor bajo la tabla (totales de la hoja). */
	resumen?: LineaResumen[];
	/** Empuja la sección a una página nueva en el PDF. */
	saltoDePagina?: boolean;
}

export interface MetaDocumento {
	/** Nombre del documento bajo la razón social. */
	titulo: string;
	/** Filas de la tabla de la esquina (Código / Versión / Fecha). */
	meta: Array<{ label: string; valor: string }>;
	/** Banda de periodo: mes, año, consecutivo, estado… */
	periodo: Array<{ label: string; valor: string }>;
}

export interface DocumentoPreview extends MetaDocumento {
	secciones: SeccionPreview[];
	/** Resumen final, alineado a la derecha bajo la última sección. */
	resumen?: LineaResumen[];
	/** `false` en documentos internos que nadie firma. */
	firmas?: boolean;
	/**
	 * Estampar el sello de la empresa sobre la línea de LIQUIDADO POR.
	 *
	 * Va en el documento y no se deduce aquí porque la condición es del NEGOCIO
	 * —el cierre dejó de ser un borrador— y cada adaptador sabe dónde vive su
	 * estado. Mismo criterio que el PDF que sale por correo
	 * (`renderFirmas` en `liquidaciones-terceros-pdf.template.ts`) y que el
	 * preview del editor: los tres tienen que sellar en el mismo momento o el
	 * mismo documento saldría firmado o sin firmar según por dónde se imprima.
	 */
	sello?: boolean;
	/** Base del nombre del fichero PDF. */
	nombreArchivo: string;
}
