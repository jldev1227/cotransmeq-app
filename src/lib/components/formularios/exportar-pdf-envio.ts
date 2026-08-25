/**
 * Exportación a PDF del documento de un envío.
 *
 * Mismo enfoque que el preview de los canvas de terceros: el cuerpo se toma del
 * DOM YA RENDERIZADO en vez de volver a componerlo, así el PDF no puede salir
 * con otra disposición, otro orden o unos valores distintos de los que el
 * usuario acaba de mirar. El servidor aporta lo único que el navegador no puede
 * dar por sí solo: las fuentes embebidas y Chromium.
 *
 * La alternativa —reconstruir el documento en el backend— obligaría a
 * reimplementar allí los diecinueve tipos de campo y su disposición adaptativa,
 * y ese segundo renderizador divergiría del primero a la primera modificación.
 */

import { formulariosDocumentoPdfAPI } from '$lib/api/formularios-documento-pdf';
import { documentoEnvioCss } from './documento-envio.css';

/**
 * El logo como data-URL.
 *
 * Puppeteer renderiza con `setContent` y sin URL base, así que una ruta relativa
 * como `/assets/logo.webp` no resuelve contra nada y el hueco saldría vacío. Las
 * fotos y firmas NO necesitan esto: sus URL firmadas de S3 son absolutas y
 * `pdfFromHtml` espera a que carguen antes de imprimir.
 */
async function comoDataUrl(url: string): Promise<string | null> {
	try {
		const respuesta = await fetch(url);
		if (!respuesta.ok) return null;
		const blob = await respuesta.blob();
		return await new Promise<string>((resolve, reject) => {
			const lector = new FileReader();
			lector.onloadend = () => resolve(String(lector.result));
			lector.onerror = reject;
			lector.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}

/** Cuerpo listo para mandar: sin lo marcado `no-print` y con el logo incrustado. */
async function cuerpoParaPdf(doc: HTMLElement): Promise<string> {
	const clon = doc.cloneNode(true) as HTMLElement;

	for (const el of Array.from(clon.querySelectorAll('.no-print'))) el.remove();

	for (const img of Array.from(clon.querySelectorAll('img'))) {
		const src = img.getAttribute('src') ?? '';
		if (!src || src.startsWith('data:') || /^https?:/i.test(src)) continue;
		const dataUrl = await comoDataUrl(src);
		/// Sin logo el documento sigue siendo válido y legible; abortar la
		/// exportación entera por una imagen de membrete sería desproporcionado.
		if (dataUrl) img.setAttribute('src', dataUrl);
		else img.remove();
	}

	return clon.outerHTML;
}

/** Mensaje de error de una respuesta que vino como Blob por `responseType`. */
async function mensajeDeBlob(e: any): Promise<string> {
	const data = e?.response?.data;
	if (data instanceof Blob) {
		try {
			const json = JSON.parse(await data.text());
			if (json?.error) return String(json.error);
		} catch {
			/* el cuerpo no era JSON: se cae al mensaje de axios */
		}
	}
	return e?.message || 'No se pudo generar el PDF.';
}

/**
 * Renderiza el documento y lo abre en una pestaña nueva.
 *
 * Se abre en vez de descargarse por lo mismo que el PDF de una liquidación: casi
 * siempre se quiere MIRAR antes de guardar, y el visor del navegador ya trae su
 * propio botón de descarga.
 */
export async function exportarPdfEnvio(doc: HTMLElement, nombreArchivo: string): Promise<void> {
	const html = await cuerpoParaPdf(doc);
	/// La MISMA hoja que pinta el preview, importada como valor. No se extrae del
	/// CSSOM: ese camino depende de la clase de scoping de Svelte y de si la hoja
	/// es legible, y cuando falla el PDF sale sin una sola regla —solo texto e
	/// imágenes— sin dar ningún aviso.
	const css = documentoEnvioCss();

	let blob: Blob;
	try {
		blob = await formulariosDocumentoPdfAPI.renderizar({ html, css, filename: nombreArchivo });
	} catch (e: any) {
		throw new Error(await mensajeDeBlob(e));
	}

	const url = URL.createObjectURL(blob);
	window.open(url, '_blank');
	/// El visor ya tiene el blob cargado pasado un minuto; retenerlo más solo
	/// consume memoria de la pestaña que abrió el preview.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
