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

/** Campo de texto del diálogo de `pedirTexto()`. */
export interface EntradaTexto {
	label: string;
	placeholder?: string;
	valorInicial?: string;
	/** `false` permite aceptar vacío. Por defecto el botón espera texto. */
	requerido?: boolean;
	maxLength?: number;
}

export interface TextoOptions extends Omit<ConfirmOptions, 'cancelText'>, EntradaTexto {}

interface Pendiente extends ConfirmOptions {
	entrada?: EntradaTexto;
	/** `texto` solo llega desde el diálogo de `pedirTexto()`. */
	resolve: (ok: boolean, texto?: string) => void;
}

export const confirmActual = writable<Pendiente | null>(null);

/// Si llega otra confirmación con una abierta, la anterior se da por
/// cancelada: dos diálogos encimados harían que el «Sí» respondiera al
/// equivocado.
let abierta: Pendiente | null = null;

function abrir<T>(
	opciones: Omit<Pendiente, 'resolve'>,
	alResolver: (ok: boolean, texto?: string) => T
): Promise<T> {
	abierta?.resolve(false);
	return new Promise<T>((resolve) => {
		const pendiente: Pendiente = {
			...opciones,
			resolve: (ok, texto) => {
				if (abierta === pendiente) {
					abierta = null;
					confirmActual.set(null);
				}
				resolve(alResolver(ok, texto));
			}
		};
		abierta = pendiente;
		confirmActual.set(pendiente);
	});
}

export function confirmar(opciones: ConfirmOptions): Promise<boolean> {
	return abrir(opciones, (ok) => ok);
}

/**
 * Pide un texto corto —un motivo, una observación— con la misma tarjeta de
 * `confirmar()`. Devuelve el texto sin espacios sobrantes, o `null` si se
 * canceló.
 *
 * Reemplaza a `window.prompt()`: además de bloquear la pestaña, el nativo es
 * de una sola línea, no deja ver lo escrito en un motivo largo y Chrome lo
 * puede silenciar para siempre igual que a `confirm()`.
 */
export function pedirTexto(opciones: TextoOptions): Promise<string | null> {
	const { label, placeholder, valorInicial, requerido, maxLength, ...resto } = opciones;
	return abrir(
		{ ...resto, entrada: { label, placeholder, valorInicial, requerido, maxLength } },
		(ok, texto) => (ok ? (texto ?? '').trim() : null)
	);
}

/** Atajo para acciones destructivas: eliminar, anular, descartar. */
export function confirmarEliminacion(
	opciones: Omit<ConfirmOptions, 'tone'> & { confirmText?: string }
): Promise<boolean> {
	return confirmar({ confirmText: 'Eliminar', ...opciones, tone: 'danger' });
}
