/**
 * Catálogo de columnas por canvas, y la selección que el usuario hace
 * sobre él.
 *
 * ── Por qué el catálogo está aquí y no en cada adaptador ──
 * La selección se guarda por `key`, y tiene que sobrevivir a que el
 * usuario cierre el preview, cambie de mes y lo vuelva a abrir. Si cada
 * adaptador declarase sus columnas al vuelo, dos meses con datos distintos
 * darían catálogos distintos y la selección guardada dejaría de aplicar a
 * la mitad de ellas.
 *
 * ── Columnas «internas» ──
 * Las que el documento que se entrega al tercero NO debería llevar
 * (ingreso de Cotransmeq, número de planilla, flags del pivote). Se
 * pueden mostrar —el equipo las usa para revisar— pero salen apagadas por
 * defecto y en gris, igual que en `PreviewTerceroPDF`.
 */

import type { ColumnaPreview } from './tipos';

export type ScopePreview = 'cierres' | 'adicionales' | 'ocasional' | 'ingresos' | 'nomina';

/** Nombre legible del canvas. Sale en el título del documento. */
export const TITULO_SCOPE: Record<ScopePreview, string> = {
	cierres: 'LIQUIDACION DE INGRESOS RECIBIDOS PARA TERCEROS',
	adicionales: 'ADICIONALES DE CIERRES FINALES',
	ocasional: 'LIQUIDACION OCASIONAL DE TERCEROS',
	ingresos: 'INGRESOS RECIBIDOS PARA TERCEROS',
	nomina: 'DESPRENDIBLE DE NOMINA'
};

// ─── Catálogos ────────────────────────────────────────────────────────

/**
 * Tabla de items de la hoja de un cierre. Mismas columnas que pinta el
 * canvas y que lleva el PDF de la liquidación, incluidas las de uso
 * interno que el preview del cierre ya distinguía en gris.
 */
const COLUMNAS_CIERRES: ColumnaPreview[] = [
	{ key: 'n', label: '#', tipo: 'numero', peso: 3, fija: true },
	{ key: 'cliente', label: 'Cliente', tipo: 'texto', peso: 13 },
	{ key: 'consecutivo', label: '# Liq', tipo: 'texto', peso: 6 },
	{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 5, fija: true },
	{ key: 'tercero', label: 'Nombre 3°', tipo: 'texto', peso: 13 },
	{ key: 'recorrido', label: 'Recorrido', tipo: 'texto', peso: 14 },
	{ key: 'fechas', label: 'Fechas', tipo: 'texto', peso: 7 },
	{ key: 'v_unidad', label: 'V/Unidad', tipo: 'moneda', peso: 8 },
	{ key: 'cantidad', label: 'Cant', tipo: 'numero', peso: 3 },
	{ key: 'pct_admon', label: 'Admon %', tipo: 'porcentaje', peso: 4 },
	{ key: 'admon', label: 'Admon $', tipo: 'moneda', peso: 7 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 8 },
	{ key: 'valor_liquidar', label: 'V/Liquidar', tipo: 'moneda', peso: 8 },
	{ key: 'planilla', label: '# Planilla', tipo: 'texto', peso: 7, interna: true },
	{
		key: 'ing_extra_global',
		label: 'Ing. extra global',
		tipo: 'moneda',
		peso: 8,
		interna: true
	},
	{
		key: 'ing_extras_aval',
		label: 'Ing. extras aval',
		tipo: 'moneda',
		peso: 8,
		interna: true
	},
	{
		key: 'ingreso_empresa',
		label: 'Ing. Cotransmeq',
		tipo: 'moneda',
		peso: 8,
		interna: true,
		nota: 'Ingreso extra global menos el avalado. Uso interno.'
	},
	{ key: 'factura', label: '# Factura', tipo: 'texto', peso: 6, interna: true },
	{
		key: 'aplica_impuestos',
		label: 'Aplica imp.',
		tipo: 'booleano',
		peso: 5,
		interna: true,
		nota: 'Si el item entra en la base imponible de ICA, avisos y bomberil.'
	}
];

const COLUMNAS_ADICIONALES: ColumnaPreview[] = [
	{ key: 'n', label: '#', tipo: 'numero', peso: 3, fija: true },
	{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 6, fija: true },
	{ key: 'tercero', label: 'Nombre 3°', tipo: 'texto', peso: 15 },
	{ key: 'cliente', label: 'Empresa', tipo: 'texto', peso: 14 },
	{ key: 'recorrido', label: 'Descripcion / recorrido', tipo: 'texto', peso: 18 },
	{ key: 'fechas', label: 'Fechas', tipo: 'texto', peso: 8 },
	{ key: 'v_unidad', label: 'V/Unidad', tipo: 'moneda', peso: 9 },
	{ key: 'cantidad', label: 'Cant', tipo: 'numero', peso: 3 },
	{ key: 'pct_admon', label: 'Admon %', tipo: 'porcentaje', peso: 4 },
	{ key: 'admon', label: 'Admon $', tipo: 'moneda', peso: 8 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 9 },
	{ key: 'valor_liquidar', label: 'V/Liquidar', tipo: 'moneda', peso: 9 },
	{ key: 'cierre', label: '# Cierre', tipo: 'texto', peso: 7, interna: true },
	{ key: 'estado', label: 'Estado cierre', tipo: 'texto', peso: 7, interna: true },
	{
		key: 'aplica_impuestos',
		label: 'Aplica imp.',
		tipo: 'booleano',
		peso: 5,
		interna: true,
		nota: 'Si la fila entra en la base imponible de ICA, avisos y bomberil.'
	}
];

const COLUMNAS_OCASIONAL: ColumnaPreview[] = [
	{ key: 'n', label: '#', tipo: 'numero', peso: 3, fija: true },
	{ key: 'cliente', label: 'Cliente', tipo: 'texto', peso: 13 },
	{ key: 'consecutivo', label: '# Liq', tipo: 'texto', peso: 6 },
	{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 5, fija: true },
	{ key: 'tercero', label: 'Nombre 3°', tipo: 'texto', peso: 13 },
	{ key: 'recorrido', label: 'Recorrido', tipo: 'texto', peso: 14 },
	{ key: 'fechas', label: 'Fechas', tipo: 'texto', peso: 7 },
	{ key: 'v_unidad', label: 'V/Unidad', tipo: 'moneda', peso: 8 },
	{ key: 'cantidad', label: 'Cant', tipo: 'numero', peso: 3 },
	{ key: 'pct_admon', label: 'Admon %', tipo: 'porcentaje', peso: 4 },
	{ key: 'admon', label: 'Admon $', tipo: 'moneda', peso: 7 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 8 },
	{ key: 'valor_liquidar', label: 'V/Liquidar', tipo: 'moneda', peso: 8 },
	{ key: 'planilla', label: '# Planilla', tipo: 'texto', peso: 7, interna: true },
	{
		key: 'ing_extra_global',
		label: 'Ing. extra global',
		tipo: 'moneda',
		peso: 8,
		interna: true
	},
	{
		key: 'ing_extras_aval',
		label: 'Ing. extras aval',
		tipo: 'moneda',
		peso: 8,
		interna: true
	},
	{
		key: 'ingreso_empresa',
		label: 'Ing. Cotransmeq',
		tipo: 'moneda',
		peso: 8,
		interna: true
	},
	{ key: 'recargos', label: 'Recargos', tipo: 'moneda', peso: 7, interna: true },
	{ key: 'factura', label: '# Factura', tipo: 'texto', peso: 6, interna: true },
	{ key: 'aplica_impuestos', label: 'Aplica imp.', tipo: 'booleano', peso: 5, interna: true }
];

/**
 * Tabla del documento de ingresos. UNA FILA POR EMPRESA, no por servicio.
 *
 * El canvas detalla cada servicio porque ahí hay que decidir cuáles bajan a
 * adicionales; el papel consolida por cliente, que es como se lee y como lo
 * hacía el Excel. De ahí que aquí NO haya columna PLACA: una empresa agrupa
 * servicios de varios vehículos y no hay una placa que poner (ver
 * `agruparPorEmpresa` en `datos/ingresos.doc.ts`).
 */
const COLUMNAS_INGRESOS: ColumnaPreview[] = [
	{ key: 'n', label: '#', tipo: 'numero', peso: 3, fija: true },
	{ key: 'empresa', label: 'Empresa', tipo: 'texto', peso: 22, fija: true },
	{
		key: 'descripcion',
		label: 'Descripcion',
		tipo: 'texto',
		peso: 22,
		nota: 'El recorrido del primer servicio de la empresa.'
	},
	{
		key: 'fechas',
		label: 'Fechas',
		tipo: 'texto',
		peso: 9,
		nota: 'Las del primer servicio de la empresa.'
	},
	{
		key: 'servicios',
		label: 'Servicios',
		tipo: 'numero',
		peso: 5,
		nota: 'Cuántos servicios de esa empresa se consolidan en la fila.'
	},
	{ key: 'v_unidad', label: 'V/Unidad', tipo: 'moneda', peso: 11 },
	{ key: 'cantidad', label: 'Cant', tipo: 'numero', peso: 4 },
	{ key: 'admon', label: 'Admon', tipo: 'moneda', peso: 11 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 11 },
	{ key: 'valor_liquidar', label: 'V/Liquidar', tipo: 'moneda', peso: 11 },
	{
		key: 'incluir',
		label: 'Incluir',
		tipo: 'booleano',
		peso: 6,
		interna: true,
		nota: 'Solo en la hoja de ingresos: cuántos servicios de la empresa bajan a adicionales.'
	}
];

/**
 * Columnas del desprendible de nómina.
 *
 * A diferencia de los canvas de terceros, aquí la tabla principal es la lista
 * de CONCEPTOS del desprendible: una línea por devengo o deducción. El
 * desglose por empresa y la tabla de días van como bloques de la sección, con
 * sus propias columnas, porque son de ese bloque y no del documento.
 */
const COLUMNAS_NOMINA: ColumnaPreview[] = [
	{ key: 'concepto', label: 'CONCEPTO', tipo: 'texto', peso: 4, fija: true },
	{ key: 'cantidad', label: 'CANT.', tipo: 'numero', peso: 1 },
	{ key: 'devengado', label: 'DEVENGADO', tipo: 'moneda', peso: 2 },
	{ key: 'deducido', label: 'DEDUCIDO', tipo: 'moneda', peso: 2 },
	{
		key: 'origen',
		label: 'ORIGEN',
		tipo: 'texto',
		peso: 2,
		interna: true,
		nota: 'De dónde sale la cifra: de las planillas o tecleada a mano.'
	}
];

export const CATALOGO: Record<ScopePreview, ColumnaPreview[]> = {
	cierres: COLUMNAS_CIERRES,
	adicionales: COLUMNAS_ADICIONALES,
	ocasional: COLUMNAS_OCASIONAL,
	ingresos: COLUMNAS_INGRESOS,
	nomina: COLUMNAS_NOMINA
};

// ─── Selección ────────────────────────────────────────────────────────

/** Columnas activas cuando el usuario todavía no ha tocado el selector. */
export function seleccionPorDefecto(scope: ScopePreview): string[] {
	return CATALOGO[scope]
		.filter((c) => c.fija || (c.defecto !== false && !c.interna))
		.map((c) => c.key);
}

/**
 * Clave de la selección guardada, VERSIONADA.
 *
 * La selección se guarda como lista de claves activas, así que una columna
 * NUEVA nace apagada para todo el que ya tenga algo guardado — no aparece
 * en su lista y `cargarSeleccion` solo rescata las `fija`. Subir la versión
 * descarta lo guardado una vez y devuelve a todos al catálogo por defecto,
 * que es lo que se quiere cuando el documento gana una columna.
 *
 * v2: FECHAS y PLACA salen de DESCRIPCION a columna propia en ingresos.
 * v3: ingresos consolida por empresa — se va PLACA, entra SERVICIOS.
 */
const CLAVE_STORAGE = (scope: ScopePreview) => `tpdf-preview-cols:v3:${scope}`;

/**
 * Selección guardada, saneada contra el catálogo actual.
 *
 * Se filtra por lo que EXISTE hoy: una selección guardada hace meses puede
 * nombrar columnas que ya no están, y arrastrarlas dejaría un `colgroup`
 * con más entradas que celdas.
 */
export function cargarSeleccion(scope: ScopePreview): string[] {
	if (typeof localStorage === 'undefined') return seleccionPorDefecto(scope);
	try {
		const crudo = localStorage.getItem(CLAVE_STORAGE(scope));
		if (!crudo) return seleccionPorDefecto(scope);
		const guardadas = JSON.parse(crudo);
		if (!Array.isArray(guardadas)) return seleccionPorDefecto(scope);
		const validas = new Set(CATALOGO[scope].map((c) => c.key));
		const limpias = guardadas.filter(
			(k: unknown): k is string => typeof k === 'string' && validas.has(k)
		);
		// Las fijas no se pueden perder aunque falten en lo guardado.
		for (const c of CATALOGO[scope]) {
			if (c.fija && !limpias.includes(c.key)) limpias.unshift(c.key);
		}
		return limpias.length ? limpias : seleccionPorDefecto(scope);
	} catch {
		return seleccionPorDefecto(scope);
	}
}

export function guardarSeleccion(scope: ScopePreview, keys: string[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(CLAVE_STORAGE(scope), JSON.stringify(keys));
	} catch {
		// Cuota llena o almacenamiento bloqueado: la selección vale para esta
		// sesión igualmente. No merece un aviso al usuario.
	}
}

/**
 * Columnas visibles de una sección, en el orden del CATÁLOGO.
 *
 * El orden lo manda el catálogo y no la selección: es el orden en que se
 * lee el documento, y dejar que dependa de en qué orden el usuario marcó
 * las casillas produciría un papel distinto cada vez.
 *
 * @param disponibles claves que esa sección concreta sabe rellenar. Una
 *   sección no tiene por qué usar todo el catálogo del canvas (la hoja de
 *   adicionales de ingresos no tiene columna INCLUIR).
 */
export function columnasVisibles(
	scope: ScopePreview,
	seleccion: string[],
	disponibles?: string[]
): ColumnaPreview[] {
	const activas = new Set(seleccion);
	const permitidas = disponibles ? new Set(disponibles) : null;
	return CATALOGO[scope].filter(
		(c) => activas.has(c.key) && (!permitidas || permitidas.has(c.key))
	);
}
