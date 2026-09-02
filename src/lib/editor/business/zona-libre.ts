import type { ICellData } from '@univerjs/core';
import { ESTILO_CELDA_VACIA } from '../builders/relleno-bordes';
import { numeroDeCelda } from './numero-de-celda';

/**
 * CAPA DE HOJA: todo lo que el usuario escribe en celdas que no son un campo
 * de la base de datos.
 *
 * Los canvas son hojas de trabajo COMPARTIDAS, y en una hoja uno escribe donde
 * necesita: una referencia junto a una placa, un recordatorio bajo los totales,
 * renombrar una etiqueta. Antes todo eso estaba bloqueado por el default-deny
 * de `cell-permission-*`, y lo poco que se dejaba escribir se perdía al
 * recargar. Esta capa lo persiste y lo comparte.
 *
 * LO QUE **NO** ENTRA AQUÍ: las celdas con binding, es decir los campos con
 * respaldo en la base (V/UNIDAD, CANT, %) y las derivadas (totales, fórmulas).
 * Esas siguen su camino de siempre: se guardan en su columna y recalculan. Así
 * la hoja y la base nunca cuentan cosas distintas del mismo dato.
 *
 * ── ANCLAJE ──
 * Una celda no se guarda por su fila absoluta, porque la hoja cambia de forma
 * cuando entran o salen items. Se guarda por CÓMO se la vuelve a encontrar:
 *
 *  · `fila`: la celda está DEBAJO de la tabla de items. Se guarda su distancia
 *    al final de esa tabla. Toda esa zona —descuentos, gastos, impuestos y el
 *    área libre— se desplaza en bloque, así que lo escrito baja con su sección.
 *
 *  · `item`: la celda está AL LADO de una fila de item. Se ancla al id de ese
 *    item, así lo sigue aunque se reordene o se refresque la tabla.
 *
 *  · `clave`: la celda es UNA EN CONCRETO que el builder declara por nombre
 *    (p. ej. el % de ADMON del canvas de ocasionales). No es una nota suelta:
 *    es un parámetro del cálculo que vive en la hoja porque no tiene columna
 *    en la base. Se ancla al nombre, así que da igual cuántas filas crezca o
 *    encoja el bloque que tiene encima o debajo.
 *
 *  · `top`: la celda está POR ENCIMA de la tabla de items — la cabecera de la
 *    hoja. Esa franja NO se mueve: no la empuja que entren o salgan items. Se
 *    guarda su fila absoluta, porque anclarla al final de la tabla la haría
 *    bajar una fila por cada item nuevo.
 *
 * ── EL OFFSET DE `fila` ES CON SIGNO ──
 * El ancla de `fila` es el final del bloque estructurado, que en cierres y
 * adicionales está por DEBAJO de casi toda la hoja. Así que anotar sobre los
 * gastos, los anticipos o los impuestos da un offset NEGATIVO, y es correcto:
 * toda esa zona baja en bloque con el ancla. Exigir `>= 0` —como hacía el
 * servicio— rechazaba justo esas celdas, y el usuario veía su texto en la
 * pantalla creyendo que estaba guardado.
 */

export type TipoAncla = 'fila' | 'item' | 'clave' | 'top';

/** Dónde vive una celda de la capa, de forma estable frente a cambios. */
export interface Ancla {
	tipo: TipoAncla;
	/// Id del item (`item`) o nombre declarado por el builder (`clave`);
	/// cadena vacía en `fila`.
	ref: string;
	/// Filas bajo el final de la tabla de items cuando `tipo === 'fila'`, con
	/// signo: negativo si la celda queda por encima de ese final. La fila
	/// absoluta cuando `tipo === 'top'`. Siempre 0 en `item` y `clave`.
	offset: number;
	columna: number;
}

interface HojaEditable {
	/// Primera fila por debajo de la tabla de items.
	finItems: number;
	/// Primera fila DE la tabla de items. Lo que queda por encima es cabecera y
	/// no se mueve nunca, así que se ancla por fila absoluta (`top`). `0` = la
	/// hoja no declara cabecera y no hay zona `top`.
	inicioItems: number;
	/// Fila → id del item que la ocupa. Solo las filas de la tabla de items.
	itemPorFila: Map<number, string>;
	/// Nombre → celda que el builder declara editable-y-persistente por clave.
	celdaPorClave: Map<string, { fila: number; columna: number }>;
	/// `${fila}:${columna}` → nombre. El índice inverso, para no recorrer el
	/// mapa en cada tecla.
	clavePorCelda: Map<string, string>;
	/// Solo hay capa DEBAJO del ancla (más las filas de item).
	soloDebajo: boolean;
}

const hojas = new Map<string, HojaEditable>();

const clave = (unitId: string, sheetId: string) => `${unitId}:${sheetId}`;

export function registrarHojaEditable(
	unitId: string,
	sheetId: string,
	datos: {
		finItems: number;
		inicioItems?: number;
		itemPorFila?: Map<number, string>;
		soloDebajo?: boolean;
		celdasClave?: Record<string, { fila: number; columna: number }>;
	}
): void {
	const celdaPorClave = new Map(Object.entries(datos.celdasClave ?? {}));
	const clavePorCelda = new Map<string, string>();
	for (const [nombre, celda] of celdaPorClave) {
		clavePorCelda.set(`${celda.fila}:${celda.columna}`, nombre);
	}
	hojas.set(clave(unitId, sheetId), {
		finItems: datos.finItems,
		inicioItems: datos.inicioItems ?? 0,
		itemPorFila: datos.itemPorFila ?? new Map(),
		soloDebajo: datos.soloDebajo ?? false,
		celdaPorClave,
		clavePorCelda
	});
}

/**
 * Ancla de una celda.
 *
 * Solo se llama para celdas SIN binding: permisos y adaptador consultan el
 * registro de bindings antes, así que aquí no hace falta duplicar esa lista —
 * duplicarla sería garantizar que un día dejen de coincidir.
 */
export function anclaDe(
	unitId: string,
	sheetId: string,
	fila: number,
	columna: number
): Ancla | null {
	const h = hojas.get(clave(unitId, sheetId));
	if (!h) return null;

	// Las celdas por clave se comprueban PRIMERO: son las únicas que pueden
	// estar por encima del ancla, así que la guarda `soloDebajo` de más abajo
	// las descartaría.
	const nombre = h.clavePorCelda.get(`${fila}:${columna}`);
	if (nombre) return { tipo: 'clave', ref: nombre, offset: 0, columna };

	const itemId = h.itemPorFila.get(fila);
	if (itemId) return { tipo: 'item', ref: itemId, offset: 0, columna };
	// POR ENCIMA DEL ANCLA NO HAY CAPA (en las hojas que lo piden). Sin esta
	// guarda `anclaDe` no devolvía nunca `null`: toda la hoja era «zona libre»,
	// incluido el bloque estructurado, cuyas filas quedaban con offset NEGATIVO.
	// En ocasional eso convertía en anotación de texto cada celda calculada sin
	// binding —TOTAL, categorías, VALOR TOTAL CONDUCTOR—, y al repintar
	// (`aplicarCapa`) perdían la fórmula y el total se congelaba.
	// Es opcional porque en cierres/adicionales el equipo SÍ anota a la altura
	// del bloque estructurado y esas hojas no declaran sus filas de item.
	if (h.soloDebajo && fila < h.finItems) return null;
	// CABECERA: por encima de la tabla de items nada se desplaza, así que la
	// celda se guarda por su fila absoluta. Con el ancla de `fila` bajaría una
	// fila por cada item nuevo y acabaría encima de la tabla que describe.
	if (fila < h.inicioItems) return { tipo: 'top', ref: '', offset: fila, columna };
	return { tipo: 'fila', ref: '', offset: fila - h.finItems, columna };
}

/// ¿Esta celda es editable como capa de hoja?
export function esCeldaDeCapa(
	unitId: string,
	sheetId: string,
	fila: number,
	columna: number
): boolean {
	return anclaDe(unitId, sheetId, fila, columna) != null;
}

/// Fila en la que hay que pintar una celda de la capa, o `null` si su ancla ya
/// no existe (p. ej. borraron el item al que estaba atada).
export function filaDeAncla(
	unitId: string,
	sheetId: string,
	a: { ancla_tipo?: string; ancla_ref?: string; offset_fila: number }
): number | null {
	const h = hojas.get(clave(unitId, sheetId));
	if (!h) return null;
	const tipo = a.ancla_tipo ?? 'fila';
	// La cabecera se guarda por fila absoluta: no hay nada que recalcular.
	if (tipo === 'top') return a.offset_fila;
	if (tipo === 'clave') {
		// Si el builder ya no declara esa clave, el parámetro dejó de existir:
		// se ignora en vez de caer sobre una celda cualquiera.
		return h.celdaPorClave.get(String(a.ancla_ref ?? ''))?.fila ?? null;
	}
	if (tipo === 'item') {
		for (const [fila, id] of h.itemPorFila) if (id === a.ancla_ref) return fila;
		return null;
	}
	return h.finItems + a.offset_fila;
}

export function limpiarHojasEditables(unitId: string): void {
	for (const k of [...hojas.keys()]) {
		if (k.startsWith(`${unitId}:`)) hojas.delete(k);
	}
}

/**
 * Número que representa un valor de la capa, o `null` si no representa ninguno.
 *
 * La capa guarda TEXTO, y ese texto no siempre es el número crudo: según por
 * dónde entre la edición, lo que llega es lo que la celda MOSTRABA —«15.00%»,
 * «$1.088.233»—. Devolverlo tal cual a una celda de la que cuelga una fórmula
 * la deja muerta: `=E39*C40/100` con C40 en texto da 0.
 *
 * Es el mismo problema que sufren las columnas de dinero con binding, así que
 * comparten parser.
 */
export { numeroDeCelda as numeroDeCapa } from './numero-de-celda';

/// Celda de la capa tal y como la devuelve el backend.
export interface CeldaDeCapa {
	ancla_tipo?: string;
	ancla_ref?: string;
	offset_fila: number;
	columna: number;
	valor: string | null;
	estilo?: Record<string, any> | null;
	version: number;
	actualizado_por?: { id: string; nombre: string } | null;
}

/**
 * Estilo de una celda de la capa: EL MISMO que el de una celda vacía.
 *
 * Nada de fondo ni cursiva propios. Un estilo distinto obliga a Univer a
 * marcar la celda como «con formato», y al borrar su contenido se lleva el
 * estilo entero por delante — incluidos los bordes, dejando un agujero en la
 * retícula que no se recupera hasta recargar.
 */
export { ESTILO_CELDA_VACIA as ESTILO_ANOTACION } from '../builders/relleno-bordes';

/**
 * Vuelca la capa sobre el `cellData` ya construido.
 *
 * Se llama DESPUÉS de pintar la hoja y DESPUÉS del relleno de bordes, para que
 * lo escrito gane a lo generado.
 */
export function aplicarCapa(
	cellData: Record<number, Record<number, ICellData>>,
	unitId: string,
	sheetId: string,
	celdas: CeldaDeCapa[] | undefined
): void {
	for (const c of celdas ?? []) {
		if (c.valor == null || c.valor === '') continue;
		const fila = filaDeAncla(unitId, sheetId, c);
		// Sin ancla: el item al que estaba atada ya no está en la hoja. Se omite
		// en vez de caer en una fila cualquiera.
		if (fila == null || fila < 0) continue;
		const destino = cellData[fila] ?? (cellData[fila] = {});
		// UNA NOTA NUNCA PISA UNA FÓRMULA. Son cifras de dinero: si la capa
		// escribe `{ v, t: STRING }` sobre una celda con `f`, borra la fórmula y
		// el patrón de moneda, y esa celda queda muerta mostrando un número
		// congelado. Pasa con notas viejas guardadas contra un ancla anterior,
		// que al cambiar la forma de la hoja caen dentro del bloque calculado.
		if (destino[c.columna]?.f) continue;

		const previa = destino[c.columna];
		// Una celda que YA venía pintada por el builder (el % de ADMON, una
		// etiqueta renombrada) conserva su formato: es su patrón de moneda o de
		// porcentaje lo que la hace legible, y `ESTILO_CELDA_VACIA` lo borraría.
		// Solo las celdas realmente en blanco estrenan el estilo neutro.
		const estilo = c.estilo ?? previa?.s ?? ESTILO_CELDA_VACIA;

		// La capa guarda texto, pero si pisa una celda NUMÉRICA hay que
		// devolverla como número: el % de ADMON alimenta una fórmula, y un
		// `t: STRING` ahí deja el cálculo aguas abajo en cero.
		const comoNumero = previa?.t === 2 ? numeroDeCelda(c.valor) : null;

		destino[c.columna] = {
			v: comoNumero ?? c.valor,
			t: comoNumero == null ? 1 : 2, // CellValueType.STRING / NUMBER
			s: estilo
		} as ICellData;
	}
}
