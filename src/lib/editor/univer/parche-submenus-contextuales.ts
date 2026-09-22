/**
 * Parche para los submenús del menú contextual de Univer (0.25.x).
 *
 * EL FALLO. Cada ítem con submenú («Insertar», «Eliminar»…) lleva su propio
 * estado: `submenuVisible` y `submenuPositionReady`. Al entrar con el ratón
 * pone `ready = false` y `visible = true`; un efecto que depende SOLO de
 * `visible` mide la posición y vuelve a poner `ready = true`. Al salir, el
 * cierre se aplaza 500 ms. Si el usuario vuelve al ítem antes de esos 500 ms,
 * `visible` ya era `true`, el efecto no se vuelve a ejecutar y el submenú se
 * queda montado con `visibility: hidden` hasta que el ratón sale, pasa el
 * temporizador y vuelve a entrar. En la práctica: se pasa por «Insertar»,
 * por «Eliminar», se vuelve a «Insertar» y no se despliega nada.
 *
 * Además, los submenús se montan en un portal en el orden en que se abren,
 * así que uno abierto de nuevo puede quedar DEBAJO del que aún no se cerró.
 *
 * EL PARCHE. Un submenú solo pasa de visible a oculto sin desmontarse en ese
 * camino roto (cuando `visible` pasa a `false` el elemento desaparece en el
 * mismo render). Se observa el atributo `style` de cada submenú y, cuando se
 * ve esa transición, se fuerza visible y encima del resto. La posición no
 * cambió —el ítem no se movió—, así que sale donde debe.
 *
 * Se instala una sola vez por página: el menú contextual es compartido por
 * todos los canvas y el coste es un observador de nodos añadidos en `body`.
 */

const SELECTOR_SUBMENU = '[data-u-context-menu-submenu]';
const Z_BASE = 1080;

let instalado = false;
let capa = Z_BASE;

/** Trae el submenú al frente: el último que se abre o se repara, encima. */
function alFrente(el: HTMLElement): void {
	capa += 1;
	// `z-index` no está en el `style` que gestiona React (viene de una clase),
	// así que no lo va a pisar en el siguiente render.
	el.style.zIndex = String(capa);
}

function forzarVisible(el: HTMLElement): void {
	// `important` porque React escribe `visibility: hidden` como valor normal
	// y, si vuelve a hacerlo, el nuestro sigue mandando.
	el.style.setProperty('visibility', 'visible', 'important');
	el.style.setProperty('pointer-events', 'auto', 'important');
	alFrente(el);
}

function vigilarSubmenu(el: HTMLElement): void {
	let ultima = el.style.visibility;
	const obs = new MutationObserver(() => {
		const ahora = el.style.visibility;
		if (ahora === ultima) return;
		if (ultima === 'visible' && ahora === 'hidden' && el.isConnected) {
			forzarVisible(el);
			ultima = 'visible';
			return;
		}
		if (ahora === 'visible') alFrente(el);
		ultima = ahora;
	});
	obs.observe(el, { attributes: true, attributeFilter: ['style'] });
}

/**
 * Instala el parche. Idempotente; no hay nada que desinstalar porque el
 * observador es único por página y no retiene los engines.
 */
export function instalarParcheSubmenusContextuales(): void {
	if (instalado || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
	instalado = true;

	const registrar = (raiz: ParentNode) => {
		if (raiz instanceof HTMLElement && raiz.matches(SELECTOR_SUBMENU)) vigilarSubmenu(raiz);
		raiz.querySelectorAll?.<HTMLElement>(SELECTOR_SUBMENU).forEach(vigilarSubmenu);
	};

	registrar(document.body);
	// Univer monta cada submenú con un portal directamente en `body`
	// (`submenuPortalContainer`), así que basta con mirar los hijos directos:
	// observar todo el subárbol cobraría cada inserción de la página.
	new MutationObserver((cambios) => {
		for (const c of cambios) {
			c.addedNodes.forEach((n) => {
				if (n.nodeType === Node.ELEMENT_NODE) registrar(n as HTMLElement);
			});
		}
	}).observe(document.body, { childList: true });
}
