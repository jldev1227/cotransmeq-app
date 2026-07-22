import { writable, type Readable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration?: number;
}

interface ToastOptions {
	duration?: number;
}

const toasts = writable<Toast[]>([]);

function addToast(type: ToastType, message: string, options?: ToastOptions | number) {
	const duration = typeof options === 'number' ? options : options?.duration ?? 4000;
	const id = crypto.randomUUID();
	const newToast: Toast = { id, type, message, duration };

	toasts.update((t) => [...t, newToast]);

	setTimeout(() => {
		toasts.update((t) => t.filter((item) => item.id !== id));
	}, duration);

	return id;
}

export const toast: Readable<Toast[]> & {
	success: (message: string, options?: ToastOptions | number) => string;
	error: (message: string, options?: ToastOptions | number) => string;
	warning: (message: string, options?: ToastOptions | number) => string;
	info: (message: string, options?: ToastOptions | number) => string;
	remove: (id: string | number) => void;
} = {
	subscribe: toasts.subscribe,

	success: (message: string, options?: ToastOptions | number) => addToast('success', message, options),
	error: (message: string, options?: ToastOptions | number) => addToast('error', message, options),
	warning: (message: string, options?: ToastOptions | number) => addToast('warning', message, options),
	info: (message: string, options?: ToastOptions | number) => addToast('info', message, options),

	remove: (id: string | number) => {
		toasts.update((t) => t.filter((item) => item.id !== String(id)));
	}
};
