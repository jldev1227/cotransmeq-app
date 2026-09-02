import { writable, derived, get } from 'svelte/store';
import type { TabId } from './liquidacionesServiciosCache';

/**
 * Feed de eventos de socket de `/dashboard/liquidaciones-servicios`.
 *
 * PROBLEMA QUE RESUELVE: los sockets ya llegaban, pero se aplicaban en
 * silencio — una fila aparecía o cambiaba de color y el usuario no sabía
 * quién la tocó ni qué pasó. Peor: los eventos de un tab que no estaba
 * abierto se descartaban sin dejar rastro.
 *
 * El servidor manda un sobre `_evento` (ver `EventoSocketMeta` en
 * `backend-nest/src/sockets/index.ts`) con el actor, la etiqueta ya
 * resuelta y —en los cambios de estado— el estado anterior. Aquí solo se
 * normaliza y se acumula.
 */

/**
 * Qué pasó.
 *
 * `estado` es un `updated` que además movió el estado de la liquidación. Se
 * separa porque se pinta MÁS DISCRETO que un alta: en un mes normal los
 * cambios de estado son el evento más frecuente y con el mismo peso visual
 * que un alta el feed se vuelve ruido.
 */
export type TipoEvento = 'created' | 'updated' | 'estado' | 'deleted' | 'anulada';

/** Sobre que adjunta el backend a cada payload de socket. */
export interface EventoSocketMeta {
	tipo: TipoEvento;
	scope: TabId;
	actor: { id: string | null; nombre: string } | null;
	etiqueta: string;
	estado_anterior?: string;
	estado_nuevo?: string;
	ts: string;
}

export interface EventoLog {
	/** Id local del evento en el feed. No es el id de la entidad. */
	id: string;
	tipo: TipoEvento;
	scope: TabId;
	/** Id de la entidad, para el botón "ver". Vacío si no aplica. */
	entidadId: string;
	/** Consecutivo o nº de factura, ya resuelto por el servidor. */
	etiqueta: string;
	actor: string;
	estadoAnterior?: string;
	estadoNuevo?: string;
	/** Epoch ms. Del servidor si vino, del cliente si no. */
	ts: number;
	/** El usuario ya lo vio (entró al tab afectado o lo descartó). */
	visto: boolean;
}

/**
 * Tope del feed.
 *
 * Es una vista de "qué acaba de pasar", no un historial — para eso está el
 * modal de historial de cada liquidación. Sin tope, una sesión larga con
 * mucha actividad crece sin límite en memoria.
 */
const MAX_EVENTOS = 50;

const store = writable<EventoLog[]>([]);

/** Store para `$eventLog` en los componentes. Más recientes primero. */
export const eventLog = { subscribe: store.subscribe };

/** Nº de eventos sin ver, para el contador de la barra. */
export const eventosSinVer = derived(store, ($e) => $e.filter((x) => !x.visto).length);

let seq = 0;
function nuevoId(): string {
	seq += 1;
	return `evt-${Date.now()}-${seq}`;
}

/**
 * Normaliza un payload de socket en una entrada del feed.
 *
 * Devuelve `null` si el payload no trae el sobre `_evento`. Eso pasa con
 * emisores que todavía no se migraron: se prefiere no pintar nada antes que
 * inventar un actor o una etiqueta que el usuario leería como dato real.
 */
export function desdePayload(data: any, fallbackScope: TabId): EventoLog | null {
	const meta = data?._evento as EventoSocketMeta | undefined;
	if (!meta?.tipo) return null;

	const ts = Date.parse(meta.ts);
	return {
		id: nuevoId(),
		tipo: meta.tipo,
		scope: meta.scope ?? fallbackScope,
		entidadId: data?.id ?? data?.liquidacion_id ?? '',
		etiqueta: meta.etiqueta || '—',
		actor: meta.actor?.nombre || 'Alguien',
		estadoAnterior: meta.estado_anterior,
		estadoNuevo: meta.estado_nuevo,
		// `Date.parse` da NaN si el servidor mandó basura; en ese caso vale
		// más la hora local que un evento que se ordena al principio de los
		// tiempos y se queda pegado al fondo del feed.
		ts: Number.isFinite(ts) ? ts : Date.now(),
		visto: false
	};
}

/**
 * Añade un evento al feed.
 *
 * `propio` marca los eventos causados por el usuario que los recibe: el
 * servidor emite a TODOS los clientes, incluido el que hizo la acción, y
 * anunciarle "Juan creó LS-045" a Juan justo después de que Juan pulsara
 * Guardar es ruido. Se descartan en vez de guardarlos como vistos porque
 * tampoco aportan nada al historial de la sesión.
 */
export function registrar(evt: EventoLog | null, propio = false): EventoLog | null {
	if (!evt || propio) return null;
	store.update((lista) => [evt, ...lista].slice(0, MAX_EVENTOS));
	return evt;
}

/** Marca como vistos los eventos de un scope. Se llama al entrar a su tab. */
export function marcarVistos(scope: TabId) {
	store.update((lista) =>
		lista.map((e) => (e.scope === scope && !e.visto ? { ...e, visto: true } : e))
	);
}

export function marcarTodosVistos() {
	store.update((lista) => lista.map((e) => (e.visto ? e : { ...e, visto: true })));
}

/** Quita un evento del feed (botón × de la barra). */
export function descartar(id: string) {
	store.update((lista) => lista.filter((e) => e.id !== id));
}

export function limpiarLog() {
	store.set([]);
}

/** Snapshot sin suscribirse. */
export function leerLog(): EventoLog[] {
	return get(store);
}

/**
 * Frase del evento, en pasado y con el actor delante.
 *
 * Vive aquí y no en el componente porque el mismo texto se usa en la barra
 * y en el `title` del elemento; duplicarlo garantizaba que se separaran.
 */
export function describir(e: EventoLog): string {
	switch (e.tipo) {
		case 'created':
			return `${e.actor} creó ${e.etiqueta}`;
		case 'deleted':
			return `${e.actor} eliminó ${e.etiqueta}`;
		case 'anulada':
			return `${e.actor} anuló ${e.etiqueta}`;
		case 'estado':
			return e.estadoAnterior && e.estadoNuevo
				? `${e.actor} pasó ${e.etiqueta} de ${e.estadoAnterior} a ${e.estadoNuevo}`
				: `${e.actor} cambió el estado de ${e.etiqueta}`;
		default:
			return `${e.actor} actualizó ${e.etiqueta}`;
	}
}

/** "hace 2m". Relativo porque el absoluto obliga a restar mentalmente. */
export function haceCuanto(ts: number, ahora = Date.now()): string {
	const s = Math.max(0, Math.floor((ahora - ts) / 1000));
	if (s < 10) return 'ahora';
	if (s < 60) return `hace ${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `hace ${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `hace ${h}h`;
	return `hace ${Math.floor(h / 24)}d`;
}
