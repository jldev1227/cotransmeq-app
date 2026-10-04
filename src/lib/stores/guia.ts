import { writable } from 'svelte/store';
import type { Guia } from '$lib/guias/motor';

/**
 * Guía en curso. Vive en un store para que el panel del asistente la arranque
 * y el visor (montado en el layout) la pinte, y para que sobreviva a los
 * cambios de ruta que la propia guía provoca.
 */
export interface EstadoGuia {
	guia: Guia;
	paso: number;
}

export const guiaActiva = writable<EstadoGuia | null>(null);

export function iniciarGuia(guia: Guia) {
	if (!guia.pasos.length) return;
	guiaActiva.set({ guia, paso: 0 });
}

export function terminarGuia() {
	guiaActiva.set(null);
}

export function irAPaso(paso: number) {
	guiaActiva.update((g) => {
		if (!g) return g;
		if (paso < 0 || paso >= g.guia.pasos.length) return null;
		return { ...g, paso };
	});
}
