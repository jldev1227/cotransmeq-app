/**
 * Socket del portal para formularios dinámicos.
 *
 * Conexión SEPARADA de `socketClient.ts`. Ese cliente compartido lee el token del
 * dashboard de `localStorage['transmeralda_token']`; el portal se autentica con el
 * token del magic link, que vive en `portalSession`. Reutilizar el socket
 * compartido enviaría el token equivocado en el handshake y el backend no podría
 * derivar el conductor —que es precisamente lo que impide que un cliente se una
 * al room de otro.
 *
 * El socket ACELERA; no es la autoridad. Cada evento se traduce en «vuelve a
 * pedir el GET», nunca en «aplica este cambio»: los payloads solo llevan ids y no
 * traen definiciones ni respuestas.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { io, type Socket } from 'socket.io-client';
import { portalSession } from '$lib/stores/portalStore';
import { wakeAll } from './forms-sync';

export const FORM_EVENTS = {
	assignmentChanged: 'forms:assignment.changed',
	versionPublished: 'forms:version.published',
	submissionAccepted: 'forms:submission.accepted',
	submissionVoided: 'forms:submission.voided',
	attachmentReady: 'forms:attachment.ready'
} as const;

export type FormEventName = (typeof FORM_EVENTS)[keyof typeof FORM_EVENTS];

/** Qué hacer cuando llega un evento. Siempre acaba en un GET de reconciliación. */
export interface PortalSocketHandlers {
	/** La lista de asignaciones puede haber cambiado. */
	onInvalidateList?: () => void;
	/** Un envío propio quedó confirmado o anulado. */
	onSubmissionChanged?: (submissionId: string) => void;
}

let socket: Socket | null = null;
let handlers: PortalSocketHandlers = {};
/**
 * Ids de evento ya procesados.
 *
 * La reconexión de Socket.IO puede reenviar lo mismo, y el servidor emite a
 * varios rooms: sin deduplicar, un envío aceptado dispararía dos o tres
 * reconciliaciones seguidas. Se acota el tamaño para no crecer sin límite en una
 * sesión de todo el día.
 */
const vistos = new Set<string>();
const MAX_VISTOS = 300;

function yaVisto(eventId: unknown): boolean {
	if (typeof eventId !== 'string') return false;
	if (vistos.has(eventId)) return true;
	vistos.add(eventId);
	if (vistos.size > MAX_VISTOS) {
		/// Se descarta el más antiguo; `Set` conserva el orden de inserción.
		const primero = vistos.values().next().value;
		if (primero) vistos.delete(primero);
	}
	return false;
}

export function connectPortalFormsSocket(nuevos: PortalSocketHandlers = {}): Socket | null {
	if (!browser) return null;
	handlers = { ...handlers, ...nuevos };

	const token = get(portalSession)?.token;
	if (!token) return null;

	if (socket) {
		/// Si el token cambió (el conductor usó un enlace nuevo), se rehace el
		/// handshake: el backend deriva el conductor del token, y un token viejo
		/// dejaría al socket en el room de la sesión anterior.
		const actual = (socket.auth as any)?.token;
		if (actual !== token) {
			socket.auth = { token };
			socket.disconnect().connect();
		}
		return socket;
	}

	socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
		autoConnect: true,
		reconnection: true,
		/// Sin tope de reintentos mientras haya sesión válida: el conductor pasa
		/// horas sin cobertura y el socket tiene que seguir intentando.
		reconnectionAttempts: Infinity,
		reconnectionDelay: 1_000,
		reconnectionDelayMax: 30_000,
		/// `randomizationFactor` es el jitter: veinte conductores que recuperan
		/// señal en el mismo punto no deben reconectar en el mismo milisegundo.
		randomizationFactor: 0.5,
		auth: { token }
	});

	socket.on('connect', () => {
		/// `forms:join` NO lleva `conductorId`: el backend lo deriva del token. Si
		/// aceptara un id del cliente, cualquiera podría escuchar los avisos de otro.
		socket!.emit('forms:join', {}, () => {
			/// Tras (re)unirse al room, se reconcilia por GET y se despierta la
			/// outbox. El socket puede haber perdido eventos mientras no había
			/// conexión, así que el GET es lo que pone al día de verdad.
			handlers.onInvalidateList?.();
			wakeAll();
		});
	});

	socket.on(FORM_EVENTS.assignmentChanged, (payload: any) => {
		if (yaVisto(payload?.eventId)) return;
		handlers.onInvalidateList?.();
	});

	socket.on(FORM_EVENTS.versionPublished, (payload: any) => {
		if (yaVisto(payload?.eventId)) return;
		/// Una versión nueva invalida la definición cacheada. No se descarga aquí:
		/// la lista revalida con ETag y solo baja el árbol si de verdad cambió.
		handlers.onInvalidateList?.();
	});

	socket.on(FORM_EVENTS.submissionAccepted, (payload: any) => {
		if (yaVisto(payload?.eventId)) return;
		if (payload?.submissionId) handlers.onSubmissionChanged?.(payload.submissionId);
		handlers.onInvalidateList?.();
	});

	socket.on(FORM_EVENTS.submissionVoided, (payload: any) => {
		if (yaVisto(payload?.eventId)) return;
		if (payload?.submissionId) handlers.onSubmissionChanged?.(payload.submissionId);
		handlers.onInvalidateList?.();
	});

	socket.on(FORM_EVENTS.attachmentReady, (payload: any) => {
		if (yaVisto(payload?.eventId)) return;
		/// El servidor verificó un adjunto: la outbox puede continuar con el SUBMIT
		/// que dependía de él sin esperar su próximo tick.
		wakeAll();
	});

	return socket;
}

export function disconnectPortalFormsSocket(): void {
	if (!socket) return;
	try {
		socket.emit('forms:leave', {});
		socket.disconnect();
	} finally {
		socket = null;
		vistos.clear();
	}
}

export function portalFormsSocket(): Socket | null {
	return socket;
}
