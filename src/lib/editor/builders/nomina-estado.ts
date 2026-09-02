/**
 * Vocabulario de estados de la nómina en el lado del cliente.
 *
 * ESPEJO de `backend-nest/src/modules/nomina-canvas/nomina-estado.service.ts`.
 * Está duplicado a propósito —son dos builds y no hay paquete compartido—, así
 * que cambiar una matriz obliga a cambiar la otra. Si divergen, la barra
 * ofrece acciones que el servidor rechaza y el usuario no entiende por qué.
 *
 * Aquí vive además lo que el servidor no necesita: las etiquetas en español,
 * el tono del botón y los colores. El color de la PESTAÑA y el de la INSIGNIA
 * están en el mismo archivo a propósito: son la misma información en dos
 * sitios de la pantalla, y separarlos es garantizar que un día digan cosas
 * distintas.
 */

export type EstadoNomina = 'BORRADOR' | 'LIQUIDADA' | 'APROBADA' | 'PAGADA' | 'ANULADA';

export const ESTADOS_VALIDOS: EstadoNomina[] = [
	'BORRADOR',
	'LIQUIDADA',
	'APROBADA',
	'PAGADA',
	'ANULADA'
];

export const TRANSICIONES: Record<string, EstadoNomina[]> = {
	BORRADOR: ['LIQUIDADA', 'ANULADA'],
	LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
	APROBADA: ['PAGADA', 'LIQUIDADA', 'ANULADA'],
	PAGADA: ['ANULADA'],
	ANULADA: []
};

export const ESTADOS_QUE_EXIGEN_ADMIN: EstadoNomina[] = ['APROBADA', 'PAGADA'];
export const ESTADOS_BLOQUEADOS: string[] = ['APROBADA', 'PAGADA', 'ANULADA'];
export const ESTADOS_QUE_EXIGEN_MOTIVO: EstadoNomina[] = ['ANULADA'];

export function esAdmin(areas: string[] | string | null | undefined): boolean {
	const lista = !areas ? [] : Array.isArray(areas) ? areas : [areas];
	return lista.some((a) => String(a).toUpperCase() === 'ADMINISTRACION');
}

export function transicionesPermitidas(
	estadoActual: string,
	areas: string[] | string | null | undefined
): EstadoNomina[] {
	const admin = esAdmin(areas);
	const posibles = TRANSICIONES[estadoActual] ?? [];
	if (ESTADOS_BLOQUEADOS.includes(estadoActual) && !admin) return [];
	return admin ? posibles : posibles.filter((e) => !ESTADOS_QUE_EXIGEN_ADMIN.includes(e));
}

export interface AccionEstado {
	estado: EstadoNomina;
	etiqueta: string;
	tono: 'primario' | 'neutro' | 'peligro';
	exigeMotivo: boolean;
}

/** Cómo se llama cada transición en la barra. El verbo, no el estado. */
const ETIQUETA: Record<EstadoNomina, string> = {
	BORRADOR: 'Devolver a borrador',
	LIQUIDADA: 'Liquidar',
	APROBADA: 'Aprobar',
	PAGADA: 'Marcar pagada',
	ANULADA: 'Anular'
};

const TONO: Record<EstadoNomina, AccionEstado['tono']> = {
	BORRADOR: 'neutro',
	LIQUIDADA: 'primario',
	APROBADA: 'primario',
	PAGADA: 'primario',
	ANULADA: 'peligro'
};

export function accionesDisponibles(
	estadoActual: string,
	areas: string[] | string | null | undefined
): AccionEstado[] {
	return transicionesPermitidas(estadoActual, areas).map((estado) => ({
		estado,
		etiqueta: ETIQUETA[estado],
		tono: TONO[estado],
		exigeMotivo: ESTADOS_QUE_EXIGEN_MOTIVO.includes(estado)
	}));
}

/** Color de la pestaña del canvas. */
export const COLOR_HOJA_POR_ESTADO: Record<string, string> = {
	BORRADOR: '#94A3B8',
	LIQUIDADA: '#0EA5E9',
	APROBADA: '#16A34A',
	PAGADA: '#0F4025',
	ANULADA: '#B91C1C'
};

export function colorDeHoja(estado: string): string {
	return COLOR_HOJA_POR_ESTADO[estado] ?? COLOR_HOJA_POR_ESTADO.BORRADOR;
}

/** Clases Tailwind de la insignia. Mismo dato que el color de pestaña. */
export function claseBadgeEstado(estado: string): string {
	switch (estado) {
		case 'LIQUIDADA':
			return 'bg-sky-100 text-sky-800 ring-sky-600/20';
		case 'APROBADA':
			return 'bg-green-100 text-green-800 ring-green-600/20';
		case 'PAGADA':
			return 'bg-orange-900/10 text-orange-900 ring-orange-900/20';
		case 'ANULADA':
			return 'bg-red-100 text-red-800 ring-red-600/20';
		default:
			return 'bg-slate-100 text-slate-700 ring-slate-500/20';
	}
}

/** ¿Se puede editar una hoja en este estado? */
export function esEditable(estado: string): boolean {
	return !ESTADOS_BLOQUEADOS.includes(estado);
}
