import { browser } from '$app/environment';
import { getSocket, connectSocket } from '$lib/socketClient';
import { liquidacionesChatAPI, type ChatMessage } from '$lib/api/liquidaciones-chat';
import {
	liquidacionesRecordatoriosAPI,
	type Recordatorio
} from '$lib/api/liquidaciones-recordatorios';

interface PresenceUser {
	id: string;
	name: string;
	joinedAt: string;
}

interface ChatState {
	liquidacionId: string;
	messages: ChatMessage[];
	presence: PresenceUser[];
	typing: Map<string, { name: string; ts: number }>;
	recordatorios: Recordatorio[];
	connectionState: 'disconnected' | 'connecting' | 'connected';
	hasMore: boolean;
	loadingMore: boolean;
	unreadCount: number;
	stickyBottom: boolean;
	initialized: boolean;
}

const state: ChatState = {
	liquidacionId: '',
	messages: [],
	presence: [],
	typing: new Map(),
	recordatorios: [],
	connectionState: 'disconnected',
	hasMore: false,
	loadingMore: false,
	unreadCount: 0,
	stickyBottom: true,
	initialized: false
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
	for (const l of listeners) l();
}

let currentUser: { id: string; name: string } | null = null;
let liquidacionInfo: { placa: string; mes: number; anio: number } | null = null;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let socketListeners: { event: string; handler: (...args: any[]) => void }[] = [];

export function subscribe(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function getState(): ChatState {
	return { ...state, typing: new Map(state.typing) };
}

export async function init(
	lqId: string,
	user: { id: string; name: string },
	info: { placa: string; mes: number; anio: number }
) {
	const isSameSession =
		state.initialized &&
		state.liquidacionId === lqId &&
		currentUser?.id === user.id;

	currentUser = user;
	liquidacionInfo = info;

	if (isSameSession && socketListeners.length > 0) {
		if (state.liquidacionId !== lqId) {
			state.liquidacionId = lqId;
		}
		const socket = getSocket();
		if (socket) {
			if (!socket.connected) {
				state.connectionState = 'connecting';
				notify();
			} else {
				state.connectionState = 'connected';
				socket.emit('chat:join', { liquidacionId: lqId, user });
				notify();
			}
		}
		return;
	}

	if (socketListeners.length > 0) {
		teardownSocket();
	}

	state.liquidacionId = lqId;

	await loadReadState();
	await loadMessages();
	await loadRecordatorios();

	connectSocket();
	const socket = getSocket();
	if (socket) {
		state.connectionState = socket.connected ? 'connected' : 'connecting';
		notify();

		const onConnect = () => {
			state.connectionState = 'connected';
			socket.emit('chat:join', { liquidacionId: lqId, user });
			notify();
		};

		const onMessage = (data: any) => {
			const incoming = normalizeMessage(data);
			if (state.messages.some((m) => m.id === incoming.id)) return;
			state.messages.push(incoming);
			const fromOther = incoming.usuario_id && incoming.usuario_id !== currentUser?.id;
			if (fromOther) {
				const visible = isPanelOpen() && state.stickyBottom;
				if (!visible) {
					state.unreadCount++;
					saveReadState();
				}
			}
			notify();
		};

		const onPresence = (data: { users: PresenceUser[] }) => {
			state.presence = data.users;
			notify();
		};

		const onTyping = (data: { userId: string; name: string; typing: boolean }) => {
			handleTyping(data);
		};

		const onRecordatorioNuevo = (data: Recordatorio) => {
			state.recordatorios.push(data);
			notify();
		};

		const onRecordatorioEstado = (data: {
			id: string;
			estado: string;
			aplicado_en_liquidacion_id?: string;
		}) => {
			const idx = state.recordatorios.findIndex((r) => r.id === data.id);
			if (idx !== -1) {
				state.recordatorios[idx].estado = data.estado as any;
				if (data.aplicado_en_liquidacion_id) {
					state.recordatorios[idx].aplicado_en_liquidacion_id = data.aplicado_en_liquidacion_id;
				}
				notify();
			}
		};

		const onDisconnect = () => {
			state.connectionState = 'disconnected';
			notify();
		};

		socket.on('connect', onConnect);
		socketListeners.push({ event: 'connect', handler: onConnect });

		socket.on('chat:message', onMessage);
		socketListeners.push({ event: 'chat:message', handler: onMessage });

		socket.on('chat:presence', onPresence);
		socketListeners.push({ event: 'chat:presence', handler: onPresence });

		socket.on('chat:typing', onTyping);
		socketListeners.push({ event: 'chat:typing', handler: onTyping });

		socket.on('chat:recordatorio:nuevo', onRecordatorioNuevo);
		socketListeners.push({ event: 'chat:recordatorio:nuevo', handler: onRecordatorioNuevo });

		socket.on('chat:recordatorio:estado', onRecordatorioEstado);
		socketListeners.push({ event: 'chat:recordatorio:estado', handler: onRecordatorioEstado });

		socket.on('disconnect', onDisconnect);
		socketListeners.push({ event: 'disconnect', handler: onDisconnect });

		if (socket.connected) {
			onConnect();
		}
	}

	state.initialized = true;
	notify();
}

function teardownSocket() {
	const socket = getSocket();
	if (socket && state.liquidacionId) {
		socket.emit('chat:leave', { liquidacionId: state.liquidacionId });
		for (const { event, handler } of socketListeners) {
			socket.off(event, handler);
		}
	}
	socketListeners = [];
}

export function destroy() {
	teardownSocket();

	state.messages = [];
	state.presence = [];
	state.typing.clear();
	state.recordatorios = [];
	state.liquidacionId = '';
	state.initialized = false;
	state.connectionState = 'disconnected';
	state.unreadCount = 0;
	currentUser = null;
	liquidacionInfo = null;
	notify();
}

async function loadMessages() {
	try {
		const res = await liquidacionesChatAPI.listar(state.liquidacionId, { limit: 50 });
		state.messages = (res.mensajes || []).map((m: any) => normalizeMessage(m));
		state.hasMore = res.hasMore;
	} catch (e) {
		console.error('[chat] error loading messages:', e);
	}
	notify();
}

function normalizeMessage(m: any) {
	return {
		id: m.id,
		liquidacion_tercero_id: m.liquidacion_tercero_id,
		usuario_id: m.usuario_id,
		usuario_nombre: m.usuario_nombre || m.usuario?.nombre || 'Usuario',
		contenido: m.contenido ?? m.contenido_cifrado ?? '',
		nonce: m.nonce || '',
		tipo: m.tipo || 'NOTA',
		recordatorio_id: m.recordatorio_id,
		created_at: m.created_at
	};
}

async function loadRecordatorios() {
	try {
		state.recordatorios = await liquidacionesRecordatoriosAPI.listar(state.liquidacionId);
	} catch (e) {
		console.error('[chat] error loading recordatorios:', e);
	}
	notify();
}

export async function loadMore() {
	if (state.loadingMore || !state.hasMore) return;
	state.loadingMore = true;
	notify();

	try {
		const oldest = state.messages[0]?.created_at;
		const res = await liquidacionesChatAPI.listar(state.liquidacionId, {
			before: oldest,
			limit: 50
		});
		state.messages = [...res.mensajes, ...state.messages];
		state.hasMore = res.hasMore;
	} catch (e) {
		console.error('[chat] error loading more messages:', e);
	} finally {
		state.loadingMore = false;
	}
	notify();
}

export async function sendMessage(contenido: string) {
	if (!currentUser || !contenido.trim()) return;

	try {
		const msg = await liquidacionesChatAPI.enviar(state.liquidacionId, {
			contenido: contenido.trim(),
			tipo: 'NOTA'
		});

		state.messages.push(normalizeMessage(msg));
		notify();
	} catch (e) {
		console.error('[chat] error sending message:', e);
	}
}

export async function deleteMessage(messageId: string) {
	if (!currentUser) return;
	try {
		await liquidacionesChatAPI.eliminar(state.liquidacionId, messageId);
		state.messages = state.messages.filter((m) => m.id !== messageId);
		notify();
	} catch (e) {
		console.error('[chat] error deleting message:', e);
	}
}

export async function crearRecordatorio(data: {
	placa: string;
	mes: number;
	anio: number;
	descripcion: string;
	monto?: number;
	prioridad: 'BAJA' | 'MEDIA' | 'ALTA';
	aplica_en?: string;
}) {
	if (!currentUser) return;

	try {
		const rec = await liquidacionesRecordatoriosAPI.crear(state.liquidacionId, {
			...data
		});

		state.recordatorios.push(rec);
		notify();

		state.messages.push({
			id: crypto.randomUUID(),
			liquidacion_tercero_id: state.liquidacionId,
			usuario_id: currentUser.id,
			usuario_nombre: currentUser.name,
			contenido: `Recordatorio creado: ${data.descripcion}`,
			nonce: '',
			tipo: 'RECORDATORIO_REF',
			recordatorio_id: rec.id,
			created_at: new Date().toISOString()
		});
		notify();
	} catch (e) {
		console.error('[chat] error creating recordatorio:', e);
	}
}

export async function cambiarEstadoRecordatorio(
	recordatorioId: string,
	estado: 'PENDIENTE' | 'APLICADO' | 'CANCELADO' | 'VENCIDO',
	liquidacion_aplicada_id?: string
) {
	try {
		const rec = await liquidacionesRecordatoriosAPI.cambiarEstado(
			recordatorioId,
			estado,
			liquidacion_aplicada_id
		);
		const idx = state.recordatorios.findIndex((r) => r.id === recordatorioId);
		if (idx !== -1) {
			state.recordatorios[idx] = rec;
			notify();
		}
	} catch (e) {
		console.error('[chat] error changing recordatorio state:', e);
	}
}

export function emitTyping(typing: boolean) {
	if (!currentUser || !state.liquidacionId) return;
	const socket = getSocket();
	if (!socket) return;

	if (typingTimer) clearTimeout(typingTimer);
	if (typing) {
		socket.emit('chat:typing', {
			liquidacionId: state.liquidacionId,
			userId: currentUser.id,
			name: currentUser.name,
			typing: true
		});
	} else {
		typingTimer = setTimeout(() => {
			if (currentUser) {
				socket.emit('chat:typing', {
					liquidacionId: state.liquidacionId,
					userId: currentUser.id,
					name: currentUser.name,
					typing: false
				});
			}
		}, 1500);
	}
}

function handleTyping(data: { userId: string; name: string; typing: boolean }) {
	if (data.userId === currentUser?.id) return;
	if (data.typing) {
		state.typing.set(data.userId, { name: data.name, ts: Date.now() });
	} else {
		state.typing.delete(data.userId);
	}
	notify();
}

export function markAsRead() {
	if (state.unreadCount === 0) return;
	state.unreadCount = 0;
	saveReadState();
	notify();
}

export function setStickyBottom(sticky: boolean) {
	if (state.stickyBottom === sticky) return;
	state.stickyBottom = sticky;
	if (sticky && isPanelOpen() && state.unreadCount > 0) {
		state.unreadCount = 0;
		saveReadState();
	}
	notify();
}

function isMessageVisible(messageId: string): boolean {
	if (!browser) return false;
	if (!isPanelOpen()) return false;
	return state.stickyBottom;
}

function isPanelOpen(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(`liq-chat-panel:${state.liquidacionId}`) === 'open';
	} catch {
		return false;
	}
}

async function loadReadState() {
	if (!browser) return;
	try {
		const raw = localStorage.getItem(`liq-chat-unread:${state.liquidacionId}`);
		state.unreadCount = raw ? parseInt(raw, 10) : 0;
	} catch {
		state.unreadCount = 0;
	}
}

function saveReadState() {
	if (!browser) return;
	localStorage.setItem(`liq-chat-unread:${state.liquidacionId}`, String(state.unreadCount));
}

export function getRecordatoriosPendientes() {
	return state.recordatorios.filter((r) => r.estado === 'PENDIENTE');
}

export function getRecordatoriosAplicados() {
	return state.recordatorios.filter((r) => r.estado === 'APLICADO');
}

export function getRecordatoriosByPlacaMesAnio(placa: string, mes: number, anio: number) {
	return state.recordatorios.filter(
		(r) =>
			r.placa === placa &&
			r.mes === mes &&
			r.anio === anio &&
			(r.estado === 'PENDIENTE' || r.estado === 'APLICADO')
	);
}
