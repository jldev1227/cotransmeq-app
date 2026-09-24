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

/**
 * Estados en los que se pueden volver a traer los días desde las planillas.
 *
 * SOLO BORRADOR, y es más estricto que `ESTADOS_BLOQUEADOS` a propósito.
 *
 * «Actualizar días» no es una edición más: DESCARTA la copia del corte y la
 * rehace desde las planillas, así que se lleva por delante las horas que
 * alguien corrigió a mano. En BORRADOR eso es justo lo que se busca —se está
 * armando la liquidación y las planillas mandan—, pero una vez liquidada la
 * cifra ya se revisó y en muchos casos ya se firmó: rehacerla desde el origen
 * no es refrescar, es deshacer el trabajo sin dejar rastro.
 *
 * Por eso no se resuelve con `esEditable()`: en LIQUIDADA la hoja SÍ se edita
 * —se retocan bonos, vacaciones y conceptos— y lo único que se cierra es este
 * botón.
 */
export const ESTADOS_CON_REFRESCO_DIAS: string[] = ['BORRADOR'];

/** ¿Se pueden volver a traer los días de las planillas en este estado? */
export function permiteRefrescarDias(estado: string): boolean {
	return ESTADOS_CON_REFRESCO_DIAS.includes(estado);
}

/**
 * Estados cuya liquidación se puede REHACER ENTERA desde «Generar borradores».
 *
 * Solo BORRADOR, por la misma razón que el refresco de días y con más motivo:
 * reemplazar no edita, DESTRUYE. Reescribe todos los totales desde las
 * planillas y además devuelve `estado_flujo` a BORRADOR, así que marcando la
 * casilla en una APROBADA se perdía la aprobación y las cifras revisadas de
 * golpe, sin aviso y sin forma de volver atrás.
 *
 * ANULADA entra en la lista de prohibidas aunque suene inofensiva: anular es
 * una decisión con motivo escrito, y rehacerla la resucitaría como borrador
 * dejando el motivo colgando de una liquidación viva.
 */
export const ESTADOS_QUE_SE_PUEDEN_REEMPLAZAR: string[] = ['BORRADOR'];

/** ¿Se puede rehacer entera la liquidación que ya existe en este estado? */
export function permiteReemplazar(estado: string): boolean {
	return ESTADOS_QUE_SE_PUEDEN_REEMPLAZAR.includes(estado);
}
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
			return 'bg-emerald-900/10 text-emerald-900 ring-emerald-900/20';
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
