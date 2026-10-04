/**
 * Motor de las guías interactivas: encuentra el elemento de un paso, lo
 * espera si todavía no está (modal abriéndose, ruta cargando), bloquea los
 * clics fuera de él cuando el paso exige interacción y avisa cuando el
 * usuario interactuó. No pinta nada: de eso se ocupa `GuiaVisor.svelte`.
 *
 * Es un port reducido del `SpotlightService` de segispro, sin su tabla de
 * guías ni sus acciones nunca usadas, y con tres formas de ancla (ver
 * `resolverAncla`) para no tener que sembrar `data-tour` por todas partes.
 */
export interface PasoGuia {
	titulo: string;
	texto: string;
	ancla?: string;
	ruta?: string;
	accion?: 'clic';
}

export interface Guia {
	id: string;
	titulo: string;
	descripcion: string;
	ruta: string;
	pasos: PasoGuia[];
}

/** Atributo que marca lo que el bloqueo deja pasar aunque no sea el objetivo. */
export const ATRIBUTO_VISOR = 'data-guia-visor';

function normalizar(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

export function esVisible(el: Element): boolean {
	// Lo que pinta el propio visor (tarjeta con role="dialog", velo) nunca es
	// un objetivo: un ancla genérica como `[role="dialog"]` lo encontraría y el
	// foco se perseguiría a sí mismo.
	if (el.closest(`[${ATRIBUTO_VISOR}]`)) return false;
	const r = el.getBoundingClientRect();
	if (r.width === 0 && r.height === 0) return false;
	const cs = getComputedStyle(el);
	return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/**
 * `@nombre` → `[data-tour="nombre"]`; `texto:button:Facturar` o
 * `texto:Facturar` → primer elemento visible cuyo texto contenga eso;
 * cualquier otra cosa → selector CSS. Devuelve el primero VISIBLE que
 * coincide: en una página puede haber dos cabeceras (móvil y escritorio) y
 * solo una está pintada.
 */
export function resolverAncla(ancla: string): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	if (ancla.startsWith('texto:')) {
		const partes = ancla.slice(6).split(':');
		const etiqueta = partes.length > 1 ? partes[0] : 'button, a, label, h1, h2, h3, th, span';
		const buscado = normalizar(partes.length > 1 ? partes.slice(1).join(':') : partes[0]);
		for (const el of document.querySelectorAll<HTMLElement>(etiqueta)) {
			if (esVisible(el) && normalizar(el.textContent ?? '').includes(buscado)) return el;
		}
		return null;
	}
	const selector = ancla.startsWith('@') ? `[data-tour="${ancla.slice(1)}"]` : ancla;
	let candidatos: NodeListOf<HTMLElement>;
	try {
		candidatos = document.querySelectorAll<HTMLElement>(selector);
	} catch {
		return null;
	}
	for (const el of candidatos) if (esVisible(el)) return el;
	for (const el of candidatos) if (!el.closest(`[${ATRIBUTO_VISOR}]`)) return el;
	return null;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reintenta hasta que el ancla exista: un modal tarda en montarse, una ruta en cargar. */
export async function esperarAncla(ancla: string, intentos = 15, cada = 400): Promise<HTMLElement | null> {
	for (let i = 0; i < intentos; i++) {
		const el = resolverAncla(ancla);
		if (el) return el;
		await dormir(cada);
	}
	return null;
}

/* ───────────── bloqueo de interacción ───────────── */

const EVENTOS = ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'keypress', 'submit'];
let permitido: Element | null = null;
let manejador: ((e: Event) => void) | null = null;

/**
 * Deja pasar solo lo que ocurre dentro del visor o del elemento permitido.
 * Se instala en fase de captura para adelantarse a cualquier otro listener.
 */
export function bloquearInteraccion(el: Element | null) {
	permitido = el;
	if (manejador) return;
	manejador = (e: Event) => {
		const t = e.target as Element | null;
		if (!t) return;
		if (t.closest?.(`[${ATRIBUTO_VISOR}]`)) return;
		if (permitido && (permitido === t || permitido.contains(t))) return;
		// Escape siempre pasa: es la salida de la guía.
		if (e instanceof KeyboardEvent && e.key === 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	};
	for (const ev of EVENTOS) document.addEventListener(ev, manejador, true);
}

export function desbloquearInteraccion() {
	if (manejador) for (const ev of EVENTOS) document.removeEventListener(ev, manejador, true);
	manejador = null;
	permitido = null;
}

/**
 * Se resuelve cuando el usuario usó el elemento: escribió en un campo,
 * cambió un select o pulsó un botón. Devuelve una función para dejar de
 * escuchar si la guía cambia de paso antes.
 */
export function esperarInteraccion(el: HTMLElement, alOcurrir: () => void): () => void {
	const esCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
	const eventos = esCampo ? ['input', 'change'] : ['click'];
	const h = () => {
		quitar();
		alOcurrir();
	};
	const quitar = () => eventos.forEach((ev) => el.removeEventListener(ev, h));
	eventos.forEach((ev) => el.addEventListener(ev, h));
	return quitar;
}

/** Hace scroll hasta que el elemento quede a la vista y da tiempo a que termine. */
export async function traerAVista(el: HTMLElement) {
	const r = el.getBoundingClientRect();
	const fuera = r.top < 80 || r.bottom > window.innerHeight - 80 || r.left < 0 || r.right > window.innerWidth;
	if (fuera) {
		el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
		await dormir(350);
	}
}
