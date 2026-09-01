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
export async function cuerpoParaPdf(doc: HTMLElement): Promise<string> {
	const clon = doc.cloneNode(true) as HTMLElement;

	// El preview escala la hoja con un `transform` en el atributo `style`.
	// En el PDF la escala la pone `@page`, así que ese transform sobra y
	// además recortaría el contenido.
	clon.removeAttribute('style');

	for (const el of Array.from(clon.querySelectorAll('.no-print'))) {
		el.remove();
	}

	const logo = await logoDataUrl();
	for (const img of Array.from(clon.querySelectorAll('img'))) {
		const src = img.getAttribute('src') || '';
		if (src.startsWith('data:')) continue;
		if (logo) img.setAttribute('src', logo);
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
