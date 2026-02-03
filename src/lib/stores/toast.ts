import { toast as sonnerToast } from 'svelte-sonner';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration?: number;
}

interface ToastOptions {
	duration?: number;
	description?: string;
}

// Wrapper para usar svelte-sonner con nuestra API existente
export const toast = {
	success: (message: string, options?: ToastOptions | number) => {
		const opts = typeof options === 'number' ? { duration: options } : options || {};
		return sonnerToast.success(message, opts);
	},

	error: (message: string, options?: ToastOptions | number) => {
		const opts = typeof options === 'number' ? { duration: options } : options || {};
		return sonnerToast.error(message, opts);
	},

	warning: (message: string, options?: ToastOptions | number) => {
		const opts = typeof options === 'number' ? { duration: options } : options || {};
		return sonnerToast.warning(message, opts);
	},

	info: (message: string, options?: ToastOptions | number) => {
		const opts = typeof options === 'number' ? { duration: options } : options || {};
		return sonnerToast.info(message, opts);
	},

	remove: (id: string | number) => {
		sonnerToast.dismiss(id);
	}
};
