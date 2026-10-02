import { writable, derived, type Readable } from 'svelte/store';

/**
 * ¿Hay un canvas Univer ocupando la pantalla ahora mismo?
 *
 * POR QUÉ EXISTE: el `<Toaster>` es único (`ToastProvider`, en el layout
 * raíz) y siempre va abajo al centro. En los canvas, abajo está la barra de
 * pestañas y el zoom, con lo que se navega entre hojas: el toast tiene que
 * subirse para quedar apoyado sobre ella en vez de taparla.
 *
 * POR QUÉ UN CONTADOR Y NO UN BOOLEANO: al navegar de un canvas a otro, los
 * dos layouts existen a la vez durante un instante y Svelte no garantiza que
 * el `onDestroy` del que sale corra antes del `onMount` del que entra. Con un
 * booleano, ese orden dejaría el flag en `false` estando dentro de un canvas.
 *
 * Lo registra `UniverShell`, que es el componente que monta todo canvas y
 * nadie más. Así una pantalla nueva queda cubierta sin tocar este archivo.
 */
const montados = writable(0);

export const univerShell = {
	/** Llamar en el `onMount` del shell. */
	entrar: () => montados.update((n) => n + 1),
	/** Llamar en el `onDestroy` del shell. */
	salir: () => montados.update((n) => Math.max(0, n - 1))
};

export const enUniverShell: Readable<boolean> = derived(montados, (n) => n > 0);
