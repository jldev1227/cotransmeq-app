import { derived, writable } from 'svelte/store';

/**
 * ¿Hay un formulario de directorio (`ModalEntidad`) abierto?
 *
 * Los toasts van abajo al centro, justo donde el modal tiene su pie con
 * Cancelar/Guardar: en móvil, donde el modal es una hoja pegada al borde
 * inferior, un aviso de validación tapaba los botones. `ToastProvider` lo
 * consulta para subir los avisos mientras el formulario esté abierto.
 */
const abiertos = writable(0);

export const formularioAbierto = {
	entrar: () => abiertos.update((n) => n + 1),
	salir: () => abiertos.update((n) => Math.max(0, n - 1))
};

export const hayFormularioAbierto = derived(abiertos, (n) => n > 0);
