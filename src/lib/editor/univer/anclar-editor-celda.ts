import { ICommandService, type Univer } from '@univerjs/core';
import { DeviceInputEventType } from '@univerjs/engine-render';
// @ts-ignore  — igual que en los cuatro `cell-permission-*`: el servicio existe
// en runtime pero no está tipado en la superficie pública de sheets-ui.
import { IEditorBridgeService } from '@univerjs/sheets-ui';

const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible';

/**
 * Ancla el editor de celda a SU celda mientras dura la edición.
 *
 * EL PROBLEMA: al escribir o formular en una celda y desplazarse con la rueda,
 * el viewport de la hoja se mueve pero el editor sigue clavado en su posición
 * de pantalla, así que acaba flotando sobre una celda distinta a la que está
 * editando. Con la celda solo SELECCIONADA no pasa: la selección se repinta
 * junto al resto de la hoja, mientras que el editor es un overlay aparte.
 *
 * EL ARREGLO: mientras el editor está abierto se descarta el desplazamiento.
 * Se hace en fase de CAPTURA sobre el contenedor del canvas, es decir antes de
 * que Univer procese la rueda, que es la única forma de que el viewport no
 * llegue a moverse.
 *
 * POR QUÉ SE PREGUNTA EL ESTADO VIVO Y NO SE GUARDA UN FLAG: antes esto era un
 * `let editando` que se ponía en true con `SheetEditStarted` y solo volvía a
 * false con `SheetEditEnded`. Era un pestillo de un solo sentido: si ese evento
 * se perdía UNA vez, el contenedor se tragaba TODOS los `wheel`/`touchmove` de
 * por vida y el usuario lo leía como «la celda se trabó, no sale ni con Escape
 * ni haciendo clic fuera» (el editor sí cerraba; lo que quedaba congelado era
 * el scroll de la hoja, y solo recargar la página lo arreglaba). El evento se
 * pierde de verdad en dos casos: (a) el facade de sheets-ui desreferencia
 * `getEditLocation()` sin comprobar null y revienta antes de emitirlo cuando el
 * estado de edición ya se limpió (unidad dispuesta, patch remoto que rehace la
 * hoja), y el despachador de comandos de core no envuelve a los oyentes en
 * try/catch; (b) al formular, el modo «seleccionar referencia» activa
 * `enableForceKeepVisible()` y el clic fuera deja de cerrar el editor, así que
 * nunca se emite el cierre.
 * Preguntando `isVisible()` en cada evento el fallo pasa a ser fail-open: si
 * algo va mal el peor caso es que vuelva el scroll, no que se congele para
 * siempre.
 *
 * Tampoco se hace `stopPropagation()`: `preventDefault()` basta para que el
 * navegador no desplace, y cortar la propagación en captura además ciega a los
 * propios controladores de Univer que cuelgan del contenedor.
 *
 * RED DE SEGURIDAD: Escape a nivel `document`. En el modo «seleccionar
 * referencia» Univer mantiene el editor abierto a propósito y su
 * `_tryHideEditor()` es un no-op, así que el usuario se puede quedar sin forma
 * de salir. Se comprueba DESPUÉS de dejar actuar a Univer (no en captura, para
 * no robarle su propio Escape, que es el que descarta el valor en vez de
 * confirmarlo) y solo se fuerza el cierre si el editor sigue visible.
 *
 * Se cubre también `touchmove` para trackpads y pantallas táctiles, que no
 * emiten `wheel`.
 *
 * Devuelve el disposer; los engines lo acumulan en su lista de teardown.
 */
export function anclarEditorDeCelda(univer: Univer, container: HTMLElement): () => void {
	type Bridge = {
		isVisible(): { visible?: boolean; unitId?: string };
		isForceKeepVisible?(): boolean;
		disableForceKeepVisible?(): void;
	};

	/// Se resuelve de forma perezosa: en el momento del montaje el inyector
	/// puede no tener todavía el servicio, y fallar aquí no debe dejar el
	/// contenedor con un oyente que no sabe cuándo parar.
	///
	/// SOLO SE CACHEA EL ÉXITO: el `get()` de redi LANZA (`DependencyNotFoundError`)
	/// cuando el servicio aún no está registrado. Si se guardara ese fallo, un
	/// único evento llegado demasiado pronto dejaría el ancla desactivada para
	/// toda la vida del engine. Se reintenta un número acotado de veces para no
	/// pagar una excepción por cada `wheel` si el servicio de verdad no existe.
	let bridge: Bridge | null = null;
	let intentos = 0;
	const getBridge = (): Bridge | null => {
		if (bridge) return bridge;
		if (intentos >= 5) return null;
		intentos++;
		try {
			// @ts-ignore
			bridge = univer.__getInjector().get(IEditorBridgeService as any) as Bridge;
		} catch {
			bridge = null;
		}
		return bridge;
	};

	const editorAbierto = (): boolean => {
		try {
			return getBridge()?.isVisible()?.visible === true;
		} catch {
			return false;
		}
	};

	const frenar = (e: Event) => {
		if (!editorAbierto()) return;
		e.preventDefault();
	};

	// `passive: false` es obligatorio: sin él el navegador ignora el
	// `preventDefault()` en eventos de scroll y el arreglo no surte efecto.
	const opts = { capture: true, passive: false } as AddEventListenerOptions;
	container.addEventListener('wheel', frenar, opts);
	container.addEventListener('touchmove', frenar, opts);

	let tempEscape: ReturnType<typeof setTimeout> | null = null;
	const alEscape = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		/// Si al pulsar Escape no había editor abierto no hay nada que rescatar, y
		/// armar el temporizador sería contraproducente: un Escape suelto (cerrar
		/// un modal, por ejemplo) seguido de abrir una celda antes de 250 ms
		/// cerraría de golpe ese editor recién abierto.
		if (!editorAbierto()) return;
		if (tempEscape) clearTimeout(tempEscape);
		/// El margen deja que Univer procese su propio Escape (cierre del
		/// autocompletado de fórmulas primero, luego el editor). Solo si tras
		/// eso el editor SIGUE abierto se fuerza el cierre a mano.
		tempEscape = setTimeout(() => {
			tempEscape = null;
			try {
				const b = getBridge();
				const estado = b?.isVisible();
				if (estado?.visible !== true) return;
				/// Sin esto el cierre no prende: mientras `forceKeepVisible` está
				/// activo el propio Univer reabre/ignora la ocultación.
				b?.disableForceKeepVisible?.();
				univer
					.__getInjector()
					.get(ICommandService)
					.executeCommand(SET_CELL_EDIT_VISIBLE, {
						visible: false,
						eventType: DeviceInputEventType.Keyboard,
						keycode: 27,
						unitId: estado?.unitId
					});
			} catch (err) {
				console.warn('[univer] no se pudo forzar el cierre del editor con Escape', err);
			}
		}, 250);
	};
	document.addEventListener('keydown', alEscape);

	return () => {
		container.removeEventListener('wheel', frenar, opts);
		container.removeEventListener('touchmove', frenar, opts);
		document.removeEventListener('keydown', alEscape);
		if (tempEscape) clearTimeout(tempEscape);
	};
}
