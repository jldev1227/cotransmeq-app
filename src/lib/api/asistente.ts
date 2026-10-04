import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore } from '$lib/stores/auth';

const API_BASE = browser
	? (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
	: 'http://localhost:4000';

export interface MensajeAsistente {
	rol: 'usuario' | 'asistente';
	contenido: string;
}

/** Dónde está el usuario cuando pregunta, para que el asistente responda sobre lo que ve. */
export interface ContextoAsistente {
	ruta?: string;
	titulo?: string;
	filtros?: Record<string, unknown>;
}

import type { Guia } from '$lib/guias/motor';

export type EventoAsistente =
	| { t: 'herramienta'; nombre: string; etiqueta: string }
	| { t: 'texto'; d: string }
	/** El backend pide abrir una ruta interna (ya validada con los permisos del usuario). */
	| { t: 'navegar'; ruta: string }
	/** Guía paso a paso para pintar en pantalla; con `iniciar` arranca sin botón. */
	| { t: 'guia'; guia: Guia; iniciar: boolean }
	| { t: 'fin' }
	| { t: 'error'; mensaje: string };

export class ErrorAsistente extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message);
	}
}

function token(): string {
	return get(authStore).token ?? (browser ? localStorage.getItem('transmeralda_token') ?? '' : '');
}

/** ¿Hay asistente en este servidor? (variables de Azure configuradas). */
export async function asistenteDisponible(): Promise<boolean> {
	try {
		const res = await fetch(`${API_BASE}/api/asistente/estado`, {
			headers: { Authorization: `Bearer ${token()}` }
		});
		if (!res.ok) return false;
		const data = (await res.json()) as { disponible?: boolean };
		return data.disponible === true;
	} catch {
		return false;
	}
}

/**
 * Envía la conversación y va entregando los eventos a medida que llegan. El
 * backend responde Server-Sent Events sobre el POST, así que se lee el cuerpo
 * como stream en vez de usar EventSource (que solo hace GET y no lleva token).
 */
export async function conversarConAsistente(
	mensajes: MensajeAsistente[],
	contexto: ContextoAsistente,
	onEvento: (e: EventoAsistente) => void,
	signal: AbortSignal
): Promise<void> {
	const res = await fetch(`${API_BASE}/api/asistente/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token()}`
		},
		body: JSON.stringify({ mensajes, contexto }),
		signal
	});
	if (!res.ok || !res.body) {
		throw new ErrorAsistente(`El asistente respondió ${res.status}`, res.status);
	}

	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let pendiente = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		pendiente += value;
		const bloques = pendiente.split('\n\n');
		pendiente = bloques.pop() ?? '';
		for (const bloque of bloques) {
			const linea = bloque.split('\n').find((l) => l.startsWith('data: '));
			if (!linea) continue;
			try {
				onEvento(JSON.parse(linea.slice(6)) as EventoAsistente);
			} catch {
				// Un bloque mal formado no debe cortar la respuesta entera.
			}
		}
	}
}
