import { readable, type Readable } from 'svelte/store';
import { toast as sonner } from 'svelte-sonner';

/**
 * API histórica de avisos (`toast.success('…')`), ahora sobre svelte-sonner.
 *
 * Antes guardaba la cola en un store propio que pintaba `ToastContainer`, pero
 * ese contenedor no estaba montado en ningún layout: estos avisos —entre ellos
 * «Tu sesión ha expirado»— no se veían nunca. Se conserva la firma para no
 * tocar a quienes la usan; todos los avisos salen ahora por el mismo
 * `<Toaster>` (`ToastProvider`), con el mismo aspecto y posición.
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastOptions {
	duration?: number;
	description?: string;
}

function mostrar(type: ToastType, message: string, options?: ToastOptions | number): string {
	const opciones = typeof options === 'number' ? { duration: options } : (options ?? {});
	return String(sonner[type](message, opciones));
}

export const toast: Readable<never[]> & {
	success: (message: string, options?: ToastOptions | number) => string;
	error: (message: string, options?: ToastOptions | number) => string;
	warning: (message: string, options?: ToastOptions | number) => string;
	info: (message: string, options?: ToastOptions | number) => string;
	remove: (id: string | number) => void;
} = {
	/// Ya no hay cola propia que observar; se mantiene por compatibilidad de tipo.
	subscribe: readable<never[]>([]).subscribe,
	success: (message, options) => mostrar('success', message, options),
	error: (message, options) => mostrar('error', message, options),
	warning: (message, options) => mostrar('warning', message, options),
	info: (message, options) => mostrar('info', message, options),
	/// Sonner numera sus avisos; el id viaja como texto por la firma de arriba.
	remove: (id) => sonner.dismiss(typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id)
};
