/**
 * Identidad de las hojas del canvas de cierres finales.
 *
 * A diferencia de los canvas anuales (una hoja por mes), aquí el libro es
 * un PERIODO y cada hoja es un CIERRE — es decir, un par placa-propietario.
 * Una misma placa puede aparecer dos veces en el mismo mes si se liquidó a
 * dos propietarios distintos, y son hojas separadas.
 *
 * Un cierre `es_multi_propietario` sigue siendo UNA hoja: el cierre es la
 * unidad de liquidación, y los copropietarios se ven en una sección al pie
 * con su matriz de impuestos prorrateados.
 *
 * Vive en su propio módulo (y no dentro del builder) porque lo necesitan
 * también el engine, la página y la sesión de colaboración, y no queremos
 * que todos ellos arrastren el builder entero.
 */

/** Fila del índice de hojas que devuelve `GET /liquidaciones-terceros/periodo`. */
export interface CierreHoja {
	id: string;
	consecutivo: string;
	placa: string;
	tercero_id: string | null;
	tercero_nombre: string;
	estado: string;
	es_multi_propietario: boolean;
	total_pagar: number;
	valor_liquidar: number;
	version: number;
	/**
	 * Color de la pestaña elegido a mano. `null` = automático por estado.
	 * Ver `colorDeHoja` en `cierres-finales-estado.ts`.
	 */
	color_hoja: string | null;
	orden_alfabetico: string;
	copropietarios: number;
}

/** Estados en los que la hoja es de solo lectura. */
export const ESTADOS_SOLO_LECTURA = new Set([
	'LIQUIDADA',
	'APROBADA',
	'FACTURADA',
	'ANULADA',
	'REEMPLAZADA'
]);

export function esEditable(estado: string): boolean {
	return !ESTADOS_SOLO_LECTURA.has(estado);
}

/** El libro es un PERIODO, no un año: las hojas son placas, no meses. */
export function cierresFinalesUnitId(anio: number, mes: number): string {
	return `workbook-cierres-finales-${anio}-${String(mes).padStart(2, '0')}`;
}

/**
 * Id de hoja = id del cierre.
 *
 * Estable frente a reordenamientos, renombrados y altas: a diferencia de un
 * `sheet-N` posicional, no se descoloca cuando entra una placa nueva en
 * mitad del orden alfabético.
 */
export function cierreFinalSheetId(cierreId: string): string {
	return `cierre-${cierreId}`;
}

/** Extrae el id del cierre de un sheetId. `null` si no es una hoja nuestra. */
export function cierreIdDeSheetId(sheetId: string): string | null {
	return sheetId.startsWith('cierre-') ? sheetId.slice('cierre-'.length) : null;
}

/**
 * Caracteres que Univer y Excel prohíben en el nombre de una pestaña.
 * Se sustituyen por `-` en vez de eliminarse, para no fusionar palabras.
 */
const PROHIBIDOS = /[:\\/?*[\]]/g;

/** Límite duro de Excel para el nombre de hoja. Univer lo hereda. */
const MAX_NOMBRE = 31;

function normalizarPlaca(placa: string): string {
	const limpia = (placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	const m = limpia.match(/^([A-Z]+)(\d+)$/);
	return m ? `${m[1]}-${m[2]}` : limpia || '???';
}

/**
 * Abrevia un nombre de tercero para que quepa junto a la placa.
 *
 * Prefiere las primeras palabras completas antes que un truncado a media
 * palabra: `JUAN P. GOMEZ` se lee mejor que `JUAN PABLO GOM`.
 */
function abreviarTercero(nombre: string, disponible: number): string {
	const limpio = (nombre || '').replace(PROHIBIDOS, '-').trim();
	if (!limpio) return '';
	if (limpio.length <= disponible) return limpio;

	const palabras = limpio.split(/\s+/);
	let out = '';
	for (const p of palabras) {
		const cand = out ? `${out} ${p}` : p;
		if (cand.length > disponible) break;
		out = cand;
	}
	return out || limpio.slice(0, disponible);
}

/**
 * Nombre de la pestaña: `PLACA · TERCERO`, recortado a 31 caracteres.
 *
 * El nombre completo del tercero se pierde aquí a propósito — va en la fila
 * de título de la hoja y en el selector de búsqueda del header, que es
 * donde el usuario realmente lo lee.
 */
export function nombreHoja(c: Pick<CierreHoja, 'placa' | 'tercero_nombre'>): string {
	const placa = normalizarPlaca(c.placa);
	const sep = ' · ';
	const disponible = MAX_NOMBRE - placa.length - sep.length;
	if (disponible <= 2) return placa.slice(0, MAX_NOMBRE);
	const tercero = abreviarTercero(c.tercero_nombre, disponible);
	return tercero ? `${placa}${sep}${tercero}` : placa;
}

/**
 * Asigna nombres únicos a un conjunto de hojas.
 *
 * Dos cierres pueden colapsar al mismo nombre: misma placa y terceros cuyos
 * primeros caracteres coinciden, o un `force_new` que dejó dos cierres del
 * mismo par. Univer no acepta nombres repetidos, así que se desempatan con
 * `~2`, `~3`… respetando el orden recibido (que ya viene alfabético del
 * servidor, así que el sufijo es determinista).
 */
export function nombresUnicos(cierres: CierreHoja[]): Record<string, string> {
	const usados = new Map<string, number>();
	const out: Record<string, string> = {};

	for (const c of cierres) {
		const base = nombreHoja(c);
		const vistas = usados.get(base) ?? 0;
		usados.set(base, vistas + 1);

		if (vistas === 0) {
			out[c.id] = base;
			continue;
		}
		const sufijo = `~${vistas + 1}`;
		const recortada = base.slice(0, MAX_NOMBRE - sufijo.length);
		out[c.id] = `${recortada}${sufijo}`;
	}

	return out;
}

/**
 * Clave de orden de las hojas: placa, luego propietario, luego consecutivo.
 *
 * ⚠️ ESPEJO de `ordenAlfabetico` en
 * `backend-nest/src/modules/liquidaciones-terceros-descuentos/periodo-cierres.service.ts`.
 *
 * Normalmente esta clave llega YA CALCULADA del servidor, en el campo
 * `orden_alfabetico` del índice del periodo, y esa es la que manda. Esta
 * copia solo se usa cuando hay que construir una hoja a partir de un
 * detalle suelto (por ejemplo al recargar un cierre). Si las dos divergen,
 * esa hoja se colocaría en una posición distinta a la que ven los demás
 * usuarios.
 *
 * El `\uFFFF` para el tercero ausente lo empuja al final de su placa, que es
 * donde el usuario espera "lo que no tiene dueño asignado".
 */
/**
 * Separador de los tramos de la clave. U+0000, escapado a propósito: escrito
 * literal es invisible y cualquiera que edite la línea lo borra sin saberlo.
 * Ver la nota extendida en el módulo del servidor.
 */
const SEPARADOR_ORDEN = '\u0000';

export function ordenAlfabetico(c: {
	placa: string;
	tercero_nombre?: string | null;
	consecutivo: string;
}): string {
	return [
		(c.placa || '').toUpperCase(),
		// U+FFFF, el mayor punto de código: ordena después de cualquier
		// nombre. Escapado a propósito — escrito literal es invisible en el
		// editor y se confunde con U+FFFD, que ordena ANTES y rompería la
		// paridad con el servidor.
		(c.tercero_nombre || '\uFFFF').toUpperCase(),
		c.consecutivo || ''
	].join(SEPARADOR_ORDEN);
}

/**
 * Posición alfabética donde insertar un cierre nuevo.
 *
 * Se usa al recibir `sheet:sheet-added`: el servidor manda la fila, el
 * cliente calcula dónde va. Ordena por la misma clave que el servidor
 * (`orden_alfabetico`), así que no puede divergir.
 */
export function posicionDeInsercion(
	existentes: CierreHoja[],
	nuevo: CierreHoja
): number {
	const idx = existentes.findIndex(
		(c) => c.orden_alfabetico.localeCompare(nuevo.orden_alfabetico, 'es') > 0
	);
	return idx === -1 ? existentes.length : idx;
}
