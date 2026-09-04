/**
 * Exportación a PDF del documento que el preview tiene en pantalla.
 *
 * El cuerpo se toma del DOM ya renderizado en vez de volver a componerlo:
 * así el PDF no puede salir con otras columnas, otro orden o unos totales
 * distintos de los que el usuario acaba de mirar. Lo único que cambia
 * entre pantalla y papel es la ESCALA de la hoja de estilos —el preview
 * dibuja sobre un lienzo mucho más ancho que una carta— y eso vive en
 * `documentoCss(escala)`.
 */

import { liquidacionesTercerosCanvasPdfAPI } from '$lib/api/liquidaciones-terceros-canvas-pdf';
import { documentoCss } from './documento.css';

const LOGO_URL = '/assets/logo_nombre.webp';

let logoCache: string | null = null;

/**
 * El logo como data-URL.
 *
 * Puppeteer renderiza el HTML con `setContent`, sin URL base: una ruta
 * relativa no resuelve contra nada y el hueco del logo saldría vacío.
 */
async function logoDataUrl(): Promise<string> {
	if (logoCache !== null) return logoCache;
	try {
		const res = await fetch(LOGO_URL);
		if (!res.ok) throw new Error(String(res.status));
		const blob = await res.blob();
		logoCache = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(String(reader.result));
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch {
		// Sin logo el documento sigue siendo válido: el header tiene su
		// fallback de texto. No merece abortar la exportación.
		logoCache = '';
	}
	return logoCache;
}

/**
 * Cuerpo del documento listo para mandar: sin nada marcado `no-print` y
 * con las imágenes incrustadas.
 *
 * Exportada porque el ZIP la necesita: monta cada hoja fuera de pantalla y
 * la pasa por aquí, de modo que el cuerpo de un PDF del lote se compone
 * exactamente igual que el de una exportación suelta. Ver `exportar-zip.ts`.
 */

const SELLO_URL = '/assets/sello-firma-terceros.jpg';
let selloCache: string | null = null;

/**
 * El sello como data-URL.
 *
 * Por lo mismo que el logo: Puppeteer renderiza con `setContent`, sin URL base,
 * y una ruta relativa no resolvería contra nada. Se cachea porque la hoja suelta lo pide una vez, pero
 * el ZIP pasa por su propia copia en `componer-hojas.ts`.
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

export async function cuerpoParaPdf(doc: HTMLElement): Promise<string> {
	const clon = doc.cloneNode(true) as HTMLElement;

	// El preview escala la hoja con un `transform` en el atributo `style`.
	// En el PDF la escala la pone `@page`, así que ese transform sobra y
	// además recortaría el contenido.
	clon.removeAttribute('style');

	for (const el of Array.from(clon.querySelectorAll('.no-print'))) {
		el.remove();
	}

	const [logo, sello] = await Promise.all([logoDataUrl(), selloDataUrl()]);
	for (const img of Array.from(clon.querySelectorAll('img'))) {
		const src = img.getAttribute('src') || '';
		if (src.startsWith('data:')) continue;
		// Ver la nota de `prepararCuerpo` en `componer-hojas.ts`: sin mirar el
		// `data-rol`, el sello acababa siendo el logo.
		const reemplazo = img.getAttribute('data-rol') === 'sello' ? sello : logo;
		if (reemplazo) img.setAttribute('src', reemplazo);
		else img.remove();
	}

	return clon.outerHTML;
}

/** Mensaje de error de una respuesta que vino como Blob por `responseType`. */
async function mensajeDeBlob(e: any): Promise<string> {
	const data = e?.response?.data;
	if (data instanceof Blob) {
		try {
			const texto = await data.text();
			const json = JSON.parse(texto);
			if (json?.error) return String(json.error);
		} catch {
			/* el cuerpo no era JSON: se cae al mensaje de axios */
		}
	}
	return e?.message || 'Error generando el PDF';
}

/**
 * Hoja de estilos del documento IMPRESO.
 *
 * Escala 1 y con `@page`: lo que distingue al papel del preview es solo
 * eso, la escala del lienzo. Ver la cabecera de este fichero.
 */
export const cssParaPdf = () => documentoCss(1, true);

/**
 * Manda un cuerpo ya compuesto a Chromium y devuelve el PDF.
 *
 * Es el paso que comparten la exportación de a uno y la del lote: uno
 * abre el resultado en una pestaña, el otro lo mete en el ZIP.
 */
export async function renderizarPdf(html: string, nombreArchivo: string): Promise<Blob> {
	try {
		return await liquidacionesTercerosCanvasPdfAPI.renderizar({
			html,
			css: cssParaPdf(),
			filename: nombreArchivo
		});
	} catch (e: any) {
		throw new Error(await mensajeDeBlob(e));
	}
}

/**
 * Renderiza el documento y lo abre en una pestaña nueva.
 *
 * Se abre en vez de descargarse por lo mismo que el PDF de una
 * liquidación: casi siempre se quiere MIRAR antes de guardar, y el visor
 * del navegador ya trae el botón de descarga.
 */
export async function exportarPdfDocumento(doc: HTMLElement, nombreArchivo: string): Promise<void> {
	const blob = await renderizarPdf(await cuerpoParaPdf(doc), nombreArchivo);

	const url = URL.createObjectURL(blob);
	window.open(url, '_blank');
	// El visor ya tiene el blob cargado pasado un minuto; retenerlo más solo
	// consume memoria de la pestaña que abrió el preview.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
