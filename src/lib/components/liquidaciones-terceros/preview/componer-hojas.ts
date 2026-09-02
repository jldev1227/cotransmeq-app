/**
 * Composición del HTML de hojas de un canvas de terceros FUERA de la vista.
 *
 * Es el corazón que compartían el export ZIP y ahora también el envío por
 * correo: se monta `DocumentoHoja` (el MISMO componente del preview) en un
 * contenedor fuera de pantalla, se lee su `outerHTML` ya con layout y se
 * desmonta. Así el PDF de una hoja que nunca se abrió sale idéntico al de
 * una que sí.
 *
 * Extraído de `exportar-zip.ts` para que el modal de envíos no duplique el
 * taller ni pueda divergir de lo que produce el ZIP.
 */

import { mount, unmount, tick } from 'svelte';
import DocumentoHoja from './DocumentoHoja.svelte';
import { cargarSeleccion, type ScopePreview } from './columnas';
import type { DocumentoPreview } from './tipos';

const LOGO_URL = '/assets/logo_transmeralda-264.webp';

/** Ancho del lienzo. El mismo que usa el preview; el PDF lo reescala con `@page`. */
export const ANCHO_LIENZO = 2480;

let logoCache: string | null = null;

/**
 * El logo como data-URL.
 *
 * Puppeteer renderiza con `setContent`, sin URL base: una ruta relativa no
 * resuelve contra nada y el hueco del logo saldría vacío en las cuarenta
 * hojas. Se cachea porque se incrusta una vez por documento.
 */
export async function logoDataUrl(): Promise<string> {
	if (logoCache !== null) return logoCache;
	try {
		const res = await fetch(LOGO_URL);
		if (!res.ok) throw new Error(String(res.status));
		const blob = await res.blob();
		logoCache = await new Promise<string>((resolve, reject) => {
			const lector = new FileReader();
			lector.onloadend = () => resolve(String(lector.result));
			lector.onerror = reject;
			lector.readAsDataURL(blob);
		});
	} catch {
		/// Sin logo el documento sigue siendo válido: la cabecera tiene su
		/// alternativa de texto. No merece abortar una exportación de cuarenta.
		logoCache = '';
	}
	return logoCache;
}


const SELLO_URL = '/assets/sello-firma-terceros.webp';
let selloCache: string | null = null;

/**
 * El sello como data-URL.
 *
 * Por lo mismo que el logo: Puppeteer renderiza con `setContent`, sin URL base,
 * y una ruta relativa no resolvería contra nada. Se cachea porque en un lote de
 * cuarenta hojas se pide cuarenta veces.
 *
 * Es la copia REDUCIDA del sello (560px, ~29 KB) y no el original de 1536px y
 * 2,3 MB que usan el editor viejo y el PDF del correo: aquí se incrusta en el
 * HTML de CADA hoja, y con el grande un ZIP de cuarenta habría mandado más de
 * cien megas al servidor. A la escala a la que se imprime —58px de alto— no se
 * distingue.
 */
async function selloDataUrl(): Promise<string> {
	try {
		const res = await fetch(SELLO_URL);
		if (!res.ok) throw new Error(String(res.status));
		const blob = await res.blob();
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(String(reader.result));
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch {
		// Sin sello el documento sigue valiendo: la línea de firma queda vacía,
		// que es como sale un borrador. No merece abortar la exportación.
		return '';
	}
}

/** Deja el nodo listo para el PDF: sin herramientas y con las imágenes incrustadas. */
function prepararCuerpo(nodo: HTMLElement, logo: string, sello: string): string {
	const clon = nodo.cloneNode(true) as HTMLElement;

	/// El preview escala el lienzo con un `transform` en el atributo `style`; en
	/// el PDF la escala la pone `@page`, así que ese transform sobra y además
	/// recortaría el contenido.
	clon.removeAttribute('style');

	for (const el of Array.from(clon.querySelectorAll('.no-print'))) el.remove();

	for (const img of Array.from(clon.querySelectorAll('img'))) {
		const src = img.getAttribute('src') ?? '';
		if (src.startsWith('data:')) continue;
		// El SELLO se reconoce por su marca, no por el src: sin distinguirlo, la
		// rama de abajo lo convertía en el logo de la cabecera.
		const reemplazo = img.getAttribute('data-rol') === 'sello' ? sello : logo;
		if (reemplazo) img.setAttribute('src', reemplazo);
		else img.remove();
	}

	return clon.outerHTML;
}

export interface HojaAComponer {
	/** Nombre del PDF, sin extensión. El servidor lo sanea. */
	nombreArchivo: string;
	documento: DocumentoPreview;
}

export interface OpcionesComposicion {
	/** Progreso de la composición: cuarenta hojas no deben parecer un cuelgue. */
	onProgreso?: (hechas: number, total: number) => void;
	/**
	 * Columnas activas. Si se omite se usan las que el usuario dejó guardadas
	 * para ese canvas, que es lo que ve en el preview.
	 */
	seleccion?: string[];
}

export interface ResultadoComposicion {
	documentos: Array<{ html: string; filename: string }>;
	/** Nombres de las hojas que no se pudieron componer. */
	fallidas: string[];
}

/**
 * Compone las hojas de una en una y devuelve su HTML listo para Chromium.
 *
 * El montaje va secuencial a propósito: cuarenta documentos de 2480 px
 * montados a la vez son decenas de miles de nodos y el navegador de un
 * portátil de oficina deja de responder. Una hoja que falle NO aborta el
 * resto: se anota en `fallidas` y se sigue.
 */
export async function componerHojasHtml(
	scope: ScopePreview,
	hojas: HojaAComponer[],
	opciones: OpcionesComposicion = {}
): Promise<ResultadoComposicion> {
	const seleccion = opciones.seleccion ?? cargarSeleccion(scope);
	const [logo, sello] = await Promise.all([logoDataUrl(), selloDataUrl()]);

	/// Contenedor fuera de la vista, no `display: none`: un nodo oculto no tiene
	/// layout, y sin layout las tablas no reparten sus columnas —el HTML saldría
	/// estructuralmente correcto y visualmente roto.
	const taller = document.createElement('div');
	taller.style.cssText = `position:fixed; left:-100000px; top:0; width:${ANCHO_LIENZO}px; pointer-events:none;`;
	document.body.appendChild(taller);

	const documentos: Array<{ html: string; filename: string }> = [];
	const fallidas: string[] = [];

	try {
		for (const [i, hoja] of hojas.entries()) {
			const host = document.createElement('div');
			taller.appendChild(host);
			let nodo: HTMLElement | null = null;
			let instancia: Record<string, unknown> | null = null;

			try {
				instancia = mount(DocumentoHoja, {
					target: host,
					props: {
						scope,
						documento: hoja.documento,
						seleccion,
						ancho: ANCHO_LIENZO,
						zoom: 1,
						get el() {
							return nodo;
						},
						set el(v: HTMLElement | null) {
							nodo = v;
						}
					}
				});

				/// Un `tick` para que Svelte pinte y el navegador calcule el layout de
				/// las tablas antes de leer el marcado.
				await tick();

				if (nodo) documentos.push({ html: prepararCuerpo(nodo, logo, sello), filename: hoja.nombreArchivo });
				else fallidas.push(hoja.nombreArchivo);
			} catch (err) {
				console.error('[componer-hojas] no se pudo componer', hoja.nombreArchivo, err);
				fallidas.push(hoja.nombreArchivo);
			} finally {
				if (instancia) await unmount(instancia);
				host.remove();
			}

			opciones.onProgreso?.(i + 1, hojas.length);
		}
	} finally {
		taller.remove();
	}

	return { documentos, fallidas };
}
