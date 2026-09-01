/**
 * Exportación de las hojas de un periodo, una por PDF, dentro de un ZIP.
 *
 * Cada hoja del canvas de cierres es un par placa-propietario, y cada una se
 * archiva por separado: se manda al propietario, se adjunta a su liquidación y
 * se guarda en su carpeta. Un único PDF de cuarenta hojas obliga a partirlo a
 * mano justo después de generarlo, que es el trabajo que esto existe para
 * evitar.
 *
 * ── Cómo se obtiene el cuerpo de una hoja que no está en pantalla ──
 * El preview solo monta la hoja activa. Para las demás se monta `DocumentoHoja`
 * en un contenedor fuera de la vista, se lee su `outerHTML` y se desmonta. Es el
 * MISMO componente que pinta el preview, así que el PDF de una hoja que nunca se
 * abrió sale idéntico al de una que sí —lo que no garantizaría recomponer el
 * documento por otro camino.
 */

import { mount, unmount, tick } from 'svelte';
import { liquidacionesTercerosCanvasPdfAPI } from '$lib/api/liquidaciones-terceros-canvas-pdf';
import DocumentoHoja from './DocumentoHoja.svelte';
import { documentoCss } from './documento.css';
import { cargarSeleccion, type ScopePreview } from './columnas';
import type { DocumentoPreview } from './tipos';

const LOGO_URL = '/assets/logo_nombre.webp';

/** Ancho del lienzo. El mismo que usa el preview; el PDF lo reescala con `@page`. */
const ANCHO_LIENZO = 2480;

let logoCache: string | null = null;

/**
 * El logo como data-URL.
 *
 * Puppeteer renderiza con `setContent`, sin URL base: una ruta relativa no
 * resuelve contra nada y el hueco del logo saldría vacío en las cuarenta hojas.
 * Se cachea porque se incrusta una vez por documento.
 */
async function logoDataUrl(): Promise<string> {
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

/** Deja el nodo listo para el PDF: sin herramientas y con el logo incrustado. */
function prepararCuerpo(nodo: HTMLElement, logo: string): string {
	const clon = nodo.cloneNode(true) as HTMLElement;

	/// El preview escala el lienzo con un `transform` en el atributo `style`; en
	/// el PDF la escala la pone `@page`, así que ese transform sobra y además
	/// recortaría el contenido.
	clon.removeAttribute('style');

	for (const el of Array.from(clon.querySelectorAll('.no-print'))) el.remove();

	for (const img of Array.from(clon.querySelectorAll('img'))) {
		const src = img.getAttribute('src') ?? '';
		if (src.startsWith('data:')) continue;
		if (logo) img.setAttribute('src', logo);
		else img.remove();
	}

	return clon.outerHTML;
}

export interface HojaPdf {
	/** Nombre del PDF, sin extensión. El servidor lo sanea. */
	nombreArchivo: string;
	documento: DocumentoPreview;
}

export interface OpcionesZip {
	/** Progreso de la composición: cuarenta hojas no deben parecer un cuelgue. */
	onProgreso?: (hechas: number, total: number) => void;
	/**
	 * Columnas activas. Si se omite se usan las que el usuario dejó guardadas
	 * para ese canvas, que es lo que ve en el preview.
	 */
	seleccion?: string[];
}

export interface ResultadoZip {
	/** Hojas que llegaron al ZIP. */
	generados: number;
	/** Nombres de las que no se pudieron componer. */
	fallidas: string[];
}

/**
 * Compone las hojas y descarga el ZIP.
 *
 * El montaje va de una en una y no en paralelo: cuarenta documentos de 2480 px
 * montados a la vez son decenas de miles de nodos, y el navegador de un portátil
 * de oficina deja de responder mientras dura.
 *
 * Una hoja que falle NO aborta el resto: se anota en `fallidas` y se sigue. Con
 * cuarenta hojas, perder las treinta y nueve buenas por una mala sería el peor
 * resultado posible.
 */
export async function exportarZipPdfs(
	scope: ScopePreview,
	hojas: HojaPdf[],
	zipname: string,
	opciones: OpcionesZip = {}
): Promise<ResultadoZip> {
	if (hojas.length === 0) throw new Error('No hay hojas que exportar.');

	const seleccion = opciones.seleccion ?? cargarSeleccion(scope);
	const logo = await logoDataUrl();

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

				if (nodo) documentos.push({ html: prepararCuerpo(nodo, logo), filename: hoja.nombreArchivo });
				else fallidas.push(hoja.nombreArchivo);
			} catch (err) {
				console.error('[exportar-zip] no se pudo componer', hoja.nombreArchivo, err);
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

	if (documentos.length === 0) throw new Error('No se pudo componer ninguna hoja.');

	/// Escala 1 y con `@page`: estos SON los documentos impresos.
	const css = documentoCss(1, true);
	const blob = await liquidacionesTercerosCanvasPdfAPI.renderizarZip({ css, documentos, zipname });

	/// El ZIP se descarga y no se abre en una pestaña: el navegador no sabe
	/// mostrarlo, y lo que se quiere es el archivo en disco para repartir los PDF.
	const url = URL.createObjectURL(blob);
	const enlace = document.createElement('a');
	enlace.href = url;
	enlace.download = `${zipname}.zip`;
	document.body.appendChild(enlace);
	enlace.click();
	enlace.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);

	return { generados: documentos.length, fallidas };
}
