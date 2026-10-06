import { writable } from 'svelte/store';
import type { Guia } from '$lib/guias/motor';

export interface MensajeChat {
	id: number;
	rol: 'usuario' | 'asistente';
	contenido: string;
	/** Consultas que hizo el asistente para responder ("Buscando conductores"). */
	pasos?: string[];
	/** Guía que el asistente ofreció con esta respuesta (botón «Iniciar guía»). */
	guia?: Guia;
	error?: boolean;
}

/**
 * Estado del chat con el asistente. Vive fuera del panel para que la
 * conversación sobreviva a la navegación: el usuario sigue un enlace de la
 * respuesta y al volver a abrir el panel la encuentra igual.
 */
export const asistenteAbierto = writable(false);
/**
 * `true` mientras un `UniverSideRail` está montado: el carril lleva su propio
 * botón del asistente y `AsistenteCanvas` no debe pintar el flotante encima.
 */
export const railConAsistente = writable(false);
export const conversacion = writable<MensajeChat[]>([]);

let ultimoId = 0;

/**
 * Id único de mensaje. Va en el módulo y no en el panel: si el panel se vuelve a
 * montar (HMR, cambio de layout) la conversación sigue aquí y un contador local
 * repetiría ids.
 */
export function nuevoIdMensaje(): number {
	return ++ultimoId;
}
