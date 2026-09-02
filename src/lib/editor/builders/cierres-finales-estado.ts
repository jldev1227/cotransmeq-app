/**
 * Máquina de estados del cierre final, lado cliente.
 *
 * ESPEJO de `backend-nest/src/modules/liquidaciones-terceros-descuentos/cierre-estado.service.ts`.
 * Duplicado a propósito (dos builds, sin paquete compartido). Aquí solo
 * decide qué botones pintar; **el servidor valida igualmente**, así que una
 * divergencia se traduce en un botón que devuelve 403, no en un cambio de
 * estado indebido. Aun así, cambiar una obliga a cambiar la otra.
 */

export type EstadoCierre =
	| 'BORRADOR'
	| 'LIQUIDADA'
	| 'APROBADA'
	| 'FACTURADA'
	| 'ANULADA'
	| 'REEMPLAZADA';

export const TRANSICIONES: Record<string, EstadoCierre[]> = {
	BORRADOR: ['LIQUIDADA', 'ANULADA'],
	LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
	APROBADA: ['LIQUIDADA', 'ANULADA', 'FACTURADA'],
	FACTURADA: ['ANULADA'],
	ANULADA: [],
	REEMPLAZADA: ['BORRADOR']
};

/** Estados a los que solo puede llevar Administración. */
export const ESTADOS_QUE_EXIGEN_ADMIN: EstadoCierre[] = ['APROBADA', 'FACTURADA'];

/** Estados que exigen escribir un motivo antes de confirmar. */
export const ESTADOS_QUE_EXIGEN_MOTIVO: EstadoCierre[] = ['ANULADA'];

export function esAdmin(areas: string | string[] | null | undefined): boolean {
	const lista = !areas ? [] : Array.isArray(areas) ? areas : [areas];
	return lista.some((a) => String(a).toUpperCase() === 'ADMINISTRACION');
}

/**
 * Transiciones que este usuario puede ejecutar desde `estadoActual`.
 *
 * Salir de APROBADA también es privilegio de Administración: si el usuario
 * no lo es, desde APROBADA no puede hacer nada.
 */
export function transicionesPermitidas(
	estadoActual: string,
	areas: string | string[] | null | undefined
): EstadoCierre[] {
	const admin = esAdmin(areas);
	if (estadoActual === 'APROBADA' && !admin) return [];
	const posibles = TRANSICIONES[estadoActual] ?? [];
	return admin ? posibles : posibles.filter((e) => !ESTADOS_QUE_EXIGEN_ADMIN.includes(e));
}

export interface AccionEstado {
	estado: EstadoCierre;
	etiqueta: string;
	/** Cómo pintar el botón. */
	tono: 'primario' | 'neutro' | 'peligro';
	exigeMotivo: boolean;
}

const ETIQUETAS: Record<EstadoCierre, { etiqueta: string; tono: AccionEstado['tono'] }> = {
	BORRADOR: { etiqueta: 'Devolver a borrador', tono: 'neutro' },
	LIQUIDADA: { etiqueta: 'Liquidar', tono: 'primario' },
	APROBADA: { etiqueta: 'Aprobar', tono: 'primario' },
	FACTURADA: { etiqueta: 'Marcar facturada', tono: 'primario' },
	ANULADA: { etiqueta: 'Anular', tono: 'peligro' },
	REEMPLAZADA: { etiqueta: 'Reemplazar', tono: 'neutro' }
};

export function accionesDisponibles(
	estadoActual: string,
	areas: string | string[] | null | undefined
): AccionEstado[] {
	return transicionesPermitidas(estadoActual, areas).map((estado) => ({
		estado,
		etiqueta: ETIQUETAS[estado].etiqueta,
		tono: ETIQUETAS[estado].tono,
		exigeMotivo: ESTADOS_QUE_EXIGEN_MOTIVO.includes(estado)
	}));
}

/**
 * Color de la PESTAÑA de la hoja, por estado.
 *
 * Vive aquí, junto a `claseBadgeEstado`, para que el color de la pestaña y
 * el del badge del header salgan del mismo sitio. Si estuvieran en dos
 * módulos, un cambio de paleta dejaría la pestaña de un color y el badge de
 * otro para el mismo estado, y el usuario no sabría cuál creerse.
 *
 * Son los tonos medios de la misma escala que usan los badges (los `ring-*`
 * de Tailwind son demasiado claros para leerse sobre la barra de pestañas).
 */
export const COLOR_HOJA_POR_ESTADO: Record<string, string> = {
	BORRADOR: '#94A3B8', // pizarra
	LIQUIDADA: '#2563EB', // azul
	APROBADA: '#ea580c', // verde
	FACTURADA: '#7C3AED', // violeta
	ANULADA: '#DC2626', // rojo
	REEMPLAZADA: '#D97706' // ámbar
};

/** Color automático del estado. `BORRADOR` como red de seguridad. */
export function colorDeEstado(estado: string): string {
	return COLOR_HOJA_POR_ESTADO[estado] ?? COLOR_HOJA_POR_ESTADO.BORRADOR;
}

/**
 * Color efectivo de una pestaña: el override manual si existe, si no el del
 * estado.
 *
 * El override GANA a propósito. Si alguien se molestó en pintar una pestaña,
 * es porque le sirve para algo que el estado no le dice. El estado se sigue
 * leyendo en el badge del header y en el selector de hojas.
 */
export function colorDeHoja(hoja: { estado: string; color_hoja?: string | null }): string {
	return hoja.color_hoja || colorDeEstado(hoja.estado);
}

/** Formato aceptado para un override: `#RRGGBB` o `#RRGGBBAA`. */
export const RE_COLOR_HOJA = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * Clases del badge de estado.
 *
 * Autosuficientes (incluyen `ring-1`) para poder usarse tal cual también en
 * el selector de hojas, no solo en el header.
 */
export function claseBadgeEstado(estado: string): string {
	switch (estado) {
		case 'BORRADOR':
			return 'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
		case 'LIQUIDADA':
			return 'bg-blue-50 text-blue-700 ring-1 ring-blue-300';
		case 'APROBADA':
			return 'bg-orange-50 text-orange-700 ring-1 ring-orange-300';
		case 'FACTURADA':
			return 'bg-violet-50 text-violet-700 ring-1 ring-violet-300';
		case 'ANULADA':
			return 'bg-red-50 text-red-700 ring-1 ring-red-300';
		case 'REEMPLAZADA':
			return 'bg-amber-50 text-amber-800 ring-1 ring-amber-300';
		default:
			return 'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
	}
}
