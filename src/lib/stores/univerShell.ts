import { writable, derived, type Readable } from 'svelte/store';

/**
 * ¿Hay un canvas Univer ocupando la pantalla ahora mismo?
 *
 * POR QUÉ EXISTE: el `<Toaster>` es único y vive en el layout raíz, así que
 * su posición la decide una sola línea para toda la app. En las pantallas
 * normales `top-right` está bien, pero en los canvas esa esquina es la más
 * ocupada que hay: los selectores de año y mes, el «Ir a…», el buscador de
 * hoja, los avatares de presencia y el indicador de autoguardado. Un toast
 * ahí tapa justo el desplegable del buscador —que se abre hacia abajo desde
 * esa misma esquina— y el aviso de guardado, que es lo que uno mira cuando
 * quiere saber si su edición llegó. Abajo a la derecha el canvas solo tiene
 * la barra de pestañas y el zoom.
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
