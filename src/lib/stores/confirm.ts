import { writable } from 'svelte/store';
import type { MascotIntent } from '$lib/mascot';

/**
 * Confirmaciones con la tarjeta de la app móvil (encabezado oscuro + mascota)
 * en lugar del `confirm()` del navegador.
 *
 * `confirm()` bloquea la pestaña, no se puede estilizar y en Chrome ofrece
 * «Evitar que esta página cree más diálogos», que deja la acción sin
 * confirmar para siempre. Aquí se pide igual —`if (!(await confirmar(…)))`—
 * y lo pinta un único `ConfirmHost` montado en el layout raíz.
 */
export type ConfirmTone = 'danger' | 'warning' | 'success' | 'info';

export interface ConfirmOptions {
	title: string;
	message?: string;
	tone?: ConfirmTone;
	eyebrow?: string;
	mascot?: MascotIntent;
	confirmText?: string;
	/** `null` oculta el botón: un aviso que solo se acepta. */
	cancelText?: string | null;
}

interface Pendiente extends ConfirmOptions {
	resolve: (ok: boolean) => void;
}

export const confirmActual = writable<Pendiente | null>(null);

/// Si llega otra confirmación con una abierta, la anterior se da por
/// cancelada: dos diálogos encimados harían que el «Sí» respondiera al
/// equivocado.
let abierta: Pendiente | null = null;

export function confirmar(opciones: ConfirmOptions): Promise<boolean> {
	abierta?.resolve(false);
	return new Promise<boolean>((resolve) => {
		const pendiente: Pendiente = {
			...opciones,
			resolve: (ok) => {
				if (abierta === pendiente) {
					abierta = null;
					confirmActual.set(null);
				}
				resolve(ok);
			}
		};
		abierta = pendiente;
		confirmActual.set(pendiente);
	});
}

/** Atajo para acciones destructivas: eliminar, anular, descartar. */
export function confirmarEliminacion(
	opciones: Omit<ConfirmOptions, 'tone'> & { confirmText?: string }
): Promise<boolean> {
	return confirmar({ confirmText: 'Eliminar', ...opciones, tone: 'danger' });
}
