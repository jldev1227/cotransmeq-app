/**
 * Definición declarativa de los filtros de una lista.
 *
 * Cada página declara QUÉ filtros tiene y cómo se serializan; el resto —leer y
 * escribir la URL, calcular la firma para la caché, saber si hay filtros
 * activos— sale de aquí y no se reimplementa en cada `+page.svelte`.
 *
 * Antes cada página lo resolvía a su manera: siete valores de debounce
 * distintos, dos mecanismos incompatibles de escribir la URL, y de 23 páginas
 * con lista solo 8 sincronizaban algo —tres de ellas únicamente la pestaña—.
 * Ninguna ponía la página en la URL, así que compartir un enlace siempre
 * devolvía a la primera.
 */

/** Cómo se lee y se escribe un filtro en la URL. */
export interface DefinicionFiltro<T> {
	/** Valor cuando el filtro no está puesto. NO se escribe en la URL. */
	porDefecto: T
	/** De valor a texto de URL. Devolver `null` deja el parámetro fuera. */
	aUrl?: (valor: T) => string | null
	/** De texto de URL a valor. Recibe solo cadenas no vacías. */
	desdeUrl?: (texto: string) => T
}

export type DefinicionesFiltros<F> = {
	[K in keyof F]: DefinicionFiltro<F[K]>
}

/** Filtro de texto libre (búsqueda, códigos…). */
export function texto(porDefecto = ''): DefinicionFiltro<string> {
	return { porDefecto }
}

/**
 * Filtro de opción única. `porDefecto` suele ser el equivalente a «Todos».
 *
 * Las dos firmas existen porque, sin la primera, `opcion('TODOS')` infiere el
 * tipo literal `'TODOS'` y no encaja en un campo declarado como `string`. Con
 * ellas, el caso corriente da `string` y quien quiera un tipo cerrado lo pide
 * explícitamente: `opcion<'ACTIVO' | 'INACTIVO'>('ACTIVO')`.
 */
export function opcion(porDefecto: string): DefinicionFiltro<string>
export function opcion<T extends string>(porDefecto: T): DefinicionFiltro<T>
export function opcion<T extends string>(porDefecto: T): DefinicionFiltro<T> {
	return { porDefecto, desdeUrl: (t) => t as T }
}

/** Filtro numérico —página, tamaño…—. Descarta lo que no sea número. */
export function numero(porDefecto: number): DefinicionFiltro<number> {
	return {
		porDefecto,
		aUrl: (v) => (Number.isFinite(v) ? String(v) : null),
		desdeUrl: (t) => {
			const n = Number(t)
			return Number.isFinite(n) ? n : porDefecto
		}
	}
}

/** Filtro de sí/no. En la URL viaja como `1`, y ausente cuando es `false`. */
export function bandera(porDefecto = false): DefinicionFiltro<boolean> {
	return {
		porDefecto,
		aUrl: (v) => (v ? '1' : null),
		desdeUrl: (t) => t === '1' || t === 'true'
	}
}

/** Selección múltiple. En la URL van separados por coma. */
export function lista(porDefecto: string[] = []): DefinicionFiltro<string[]> {
	return {
		porDefecto,
		aUrl: (v) => (v.length ? v.join(',') : null),
		desdeUrl: (t) => t.split(',').filter(Boolean)
	}
}

function serializar<T>(def: DefinicionFiltro<T>, valor: T): string | null {
	if (def.aUrl) return def.aUrl(valor)
	if (valor === null || valor === undefined || valor === '') return null
	return String(valor)
}

function deserializar<T>(def: DefinicionFiltro<T>, texto: string): T {
	if (def.desdeUrl) return def.desdeUrl(texto)
	return texto as unknown as T
}

/** ¿Es el valor por defecto? Los que lo son no se escriben en la URL. */
function esPorDefecto<T>(def: DefinicionFiltro<T>, valor: T): boolean {
	const a = def.porDefecto
	if (Array.isArray(a) && Array.isArray(valor)) {
		return a.length === valor.length && a.every((x, i) => x === valor[i])
	}
	return a === valor
}

/** Valores iniciales, todos por defecto. */
export function valoresPorDefecto<F>(defs: DefinicionesFiltros<F>): F {
	const salida = {} as F
	for (const clave of Object.keys(defs) as Array<keyof F>) {
		salida[clave] = defs[clave].porDefecto
	}
	return salida
}

/**
 * Lee los filtros de unos `searchParams`.
 *
 * Lo que no venga en la URL toma su valor por defecto, de modo que una URL
 * limpia y una URL con todos los parámetros en su valor por defecto describen
 * exactamente el mismo estado.
 */
export function leerDeParams<F>(defs: DefinicionesFiltros<F>, params: URLSearchParams): F {
	const salida = {} as F
	for (const clave of Object.keys(defs) as Array<keyof F>) {
		const def = defs[clave]
		const crudo = params.get(String(clave))
		salida[clave] = crudo === null || crudo === '' ? def.porDefecto : deserializar(def, crudo)
	}
	return salida
}

/**
 * Convierte los filtros a `searchParams`.
 *
 * Los valores por defecto NO se escriben: si se escribieran, entrar a una
 * página dejaría la barra de direcciones llena de `estado=TODOS&pagina=1&…`
 * antes de que el usuario tocara nada.
 */
export function aParams<F>(defs: DefinicionesFiltros<F>, valores: F): URLSearchParams {
	const params = new URLSearchParams()
	for (const clave of Object.keys(defs) as Array<keyof F>) {
		const def = defs[clave]
		const valor = valores[clave]
		if (esPorDefecto(def, valor)) continue
		const texto = serializar(def, valor)
		if (texto !== null && texto !== '') params.set(String(clave), texto)
	}
	return params
}

/**
 * Firma estable de un conjunto de filtros.
 *
 * Es la `key` de la caché: si cambia, el dato guardado ya no corresponde a lo
 * que se está pidiendo y hay que ir al servidor aunque sea reciente. Servir
 * cincuenta filas de otro filtro es peor que un spinner.
 *
 * Se ordenan las claves para que el mismo estado dé siempre la misma firma
 * independientemente del orden en que se escribieran.
 */
export function firma<F>(defs: DefinicionesFiltros<F>, valores: F): string {
	const params = aParams(defs, valores)
	const pares = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
	return pares.map(([k, v]) => `${k}=${v}`).join('&')
}

/** Cuántos filtros están puestos. Alimenta el contador del panel de filtros. */
export function contarActivos<F>(defs: DefinicionesFiltros<F>, valores: F, ignorar: Array<keyof F> = []): number {
	let n = 0
	for (const clave of Object.keys(defs) as Array<keyof F>) {
		if (ignorar.includes(clave)) continue
		if (!esPorDefecto(defs[clave], valores[clave])) n++
	}
	return n
}

/** Vuelve todo a su valor por defecto salvo lo que se pida conservar. */
export function limpiar<F>(defs: DefinicionesFiltros<F>, valores: F, conservar: Array<keyof F> = []): F {
	const salida = valoresPorDefecto(defs)
	for (const clave of conservar) salida[clave] = valores[clave]
	return salida
}
