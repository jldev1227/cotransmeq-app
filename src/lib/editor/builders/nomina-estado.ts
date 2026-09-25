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

/**
 * Transiciones que SOLO ejecuta Administración, ADEMÁS de las de `TRANSICIONES`.
 *
 * La matriz base es casi un camino de ida: de LIQUIDADA se baja a BORRADOR y de
 * APROBADA a LIQUIDADA, pero PAGADA no tenía vuelta —su única salida era
 * ANULADA—. Y una hoja se marca pagada por error igual que cualquier otra cosa:
 * el único arreglo era anularla y rehacer la liquidación entera, perdiendo por
 * el camino todo lo que ya estaba revisado.
 *
 * Va aparte y no dentro de `TRANSICIONES` para que la matriz base siga
 * describiendo el flujo NORMAL: esto es la puerta de atrás, no el camino. Quien
 * no sea Administración no la ve ni la puede usar —los dos guards de
 * `transicionesPermitidas` ya lo impedían— y el servidor valida contra la misma
 * unión que el cliente pinta.
 *
 * ANULADA sigue fuera: anular es una decisión con motivo escrito y resucitarla
 * dejaría ese motivo colgando de una liquidación viva.
 *
 * ESPEJO de `backend-nest/src/modules/nomina-canvas/nomina-estado.service.ts`.
 */
export const TRANSICIONES_ADMIN: Record<string, EstadoNomina[]> = {
	PAGADA: ['APROBADA']
};

/**
 * Destinos que EXISTEN desde `estadoActual`, con o sin la puerta de atrás.
 *
 * Responde «¿esta transición está en el mapa?», no «¿puede este usuario
 * hacerla?». De lo segundo se encargan los guards.
 */
export function destinosPosibles(estadoActual: string, admin: boolean): EstadoNomina[] {
	const base = TRANSICIONES[estadoActual] ?? [];
	if (!admin) return base;
	const extra = (TRANSICIONES_ADMIN[estadoActual] ?? []).filter((e) => !base.includes(e));
	return [...base, ...extra];
}

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
	if (ESTADOS_BLOQUEADOS.includes(estadoActual) && !admin) return [];
	const posibles = destinosPosibles(estadoActual, admin);
	return admin ? posibles : posibles.filter((e) => !ESTADOS_QUE_EXIGEN_ADMIN.includes(e));
}

export interface AccionEstado {
	estado: EstadoNomina;
	etiqueta: string;
	tono: 'primario' | 'neutro' | 'peligro';
	exigeMotivo: boolean;
	/** Va hacia atrás en el flujo: no adelanta el documento, deshace un paso. */
	reversion: boolean;
}

/**
 * Posición de cada estado en el flujo.
 *
 * Sirve solo para saber si una transición AVANZA o DESHACE, porque ni el verbo
 * ni el tono se pueden deducir del destino a secas: `APROBADA → LIQUIDADA`
 * decía «Liquidar» —como si quedara algo por calcular— cuando lo que hace es
 * retirar una aprobación, y se pintaba en verde como el avance.
 *
 * ANULADA queda fuera del orden (9): anular no adelanta ni deshace, y su tono
 * es siempre el de peligro.
 */
const ORDEN: Record<EstadoNomina, number> = {
	BORRADOR: 0,
	LIQUIDADA: 1,
	APROBADA: 2,
	PAGADA: 3,
	ANULADA: 9
};

/** ¿La transición deshace un paso del flujo en vez de adelantarlo? */
export function esReversion(estadoActual: string, destino: EstadoNomina): boolean {
	const desde = ORDEN[estadoActual as EstadoNomina];
	return destino !== 'ANULADA' && desde != null && ORDEN[destino] < desde;
}

/**
 * Cómo se llama cada transición cuando AVANZA. El verbo, no el estado.
 *
 * `BORRADOR` no tiene avance posible —es el primer estado del flujo—, así que
 * su entrada aquí no se usa nunca: volver a borrador siempre es reversión y la
 * etiqueta la arma `accionesDisponibles` con `EN_MINUSCULA`.
 */
const ETIQUETA: Record<EstadoNomina, string> = {
	BORRADOR: 'Devolver a borrador',
	LIQUIDADA: 'Liquidar',
	APROBADA: 'Aprobar',
	PAGADA: 'Marcar pagada',
	ANULADA: 'Anular'
};

/** El estado tal como se lee dentro de «Devolver a …». */
const EN_MINUSCULA: Record<EstadoNomina, string> = {
	BORRADOR: 'borrador',
	LIQUIDADA: 'liquidada',
	APROBADA: 'aprobada',
	PAGADA: 'pagada',
	ANULADA: 'anulada'
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
	return transicionesPermitidas(estadoActual, areas).map((estado) => {
		const reversion = esReversion(estadoActual, estado);
		return {
			estado,
			// Deshacer no se anuncia con el verbo del avance: «Devolver a aprobada»
			// dice que se retira el pago, «Aprobar» diría que falta aprobarla.
			etiqueta: reversion ? `Devolver a ${EN_MINUSCULA[estado]}` : ETIQUETA[estado],
			// Y tampoco en verde: una reversión no es el camino, es el arreglo.
			tono: reversion ? 'neutro' : TONO[estado],
			exigeMotivo: ESTADOS_QUE_EXIGEN_MOTIVO.includes(estado),
			reversion
		};
	});
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

/** Clave del grupo de hojas que todavía no tienen liquidación. */
export const SIN_LIQUIDACION = '__SIN_LIQUIDACION__';

/** Una hoja del periodo, vista por el recuento. */
export interface HojaContable {
	liquidacionId: string | null;
	estado: string;
}

/** Un grupo del recuento, en el orden en que se pinta. */
export interface GrupoEstado {
	clave: string;
	n: number;
}

/**
 * Cuántas hojas del periodo hay en cada estado, en el orden del flujo.
 *
 * **«SIN LIQUIDACIÓN» VA APARTE, y es la razón de que esto no sea un `groupBy`
 * de tres líneas.** El servidor manda `estado_flujo ?? 'BORRADOR'`, así que un
 * conductor al que todavía no se le ha creado la liquidación llega
 * indistinguible de un borrador de verdad. Sumarlos diría «23 borradores»
 * donde solo hay uno, y los otros 22 no se arreglan liquidando —no existen—
 * sino con «Generar borradores».
 *
 * Los grupos SUMAN el total de hojas: un estado que el vocabulario no conozca
 * se devuelve igual, al final. Callarlo descuadraría la cuenta sin dejar
 * rastro de por qué.
 */
export function conteoPorEstado(hojas: HojaContable[]): GrupoEstado[] {
	let sinLiquidacion = 0;
	const porEstado = new Map<string, number>();
	for (const h of hojas) {
		if (!h.liquidacionId) {
			sinLiquidacion++;
			continue;
		}
		porEstado.set(h.estado, (porEstado.get(h.estado) ?? 0) + 1);
	}

	const grupos: GrupoEstado[] = ESTADOS_VALIDOS.filter((e) => porEstado.has(e)).map((e) => ({
		clave: e,
		n: porEstado.get(e)!
	}));

	for (const [clave, n] of porEstado) {
		if (!ESTADOS_VALIDOS.includes(clave as EstadoNomina)) grupos.push({ clave, n });
	}

	if (sinLiquidacion) grupos.push({ clave: SIN_LIQUIDACION, n: sinLiquidacion });
	return grupos;
}
