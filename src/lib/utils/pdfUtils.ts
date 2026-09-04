/**
 * Utilidades compartidas para generación de PDFs con pdfmake
 */

/**
 * Convierte una imagen (URL relativa o absoluta) a base64 PNG para pdfmake.
 * pdfmake/pdfkit no soporta WebP, así que cualquier formato se transcodifica
 * a PNG vía <canvas> antes de devolver.
 */
export async function imageToBase64(url: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();

	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No se pudo crear contexto 2D para transcodificar imagen');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	return canvas.toDataURL('image/png');
}

/**
 * Logo de cabecera para los PDF de nómina.
 *
 * Este repo NO tiene arte de Transmeralda: las dos ramas son de Cotransmeq y
 * lo único que cambia es la pieza. `logo.webp` es el símbolo suelto (el
 * caballo, 1200x675) y `logo_nombre.webp` la marca con razón social
 * (177x113): al elegir hay que mirar el `width`/`height` del nodo de pdfmake,
 * porque las proporciones no son las mismas y forzar ambas deforma la imagen.
 */
export async function obtenerLogoBase64(esCotransmeq: boolean): Promise<string | null> {
	try {
		const logoPath = esCotransmeq ? '/assets/logo_nombre.webp' : '/assets/logo.webp';
		const dataUrl = await imageToBase64(logoPath);
		if (!dataUrl.startsWith('data:image/')) {
			console.warn('Logo no es una imagen válida, se omite:', logoPath);
			return null;
		}
		return dataUrl;
	} catch (error) {
		console.warn('No se pudo cargar el logo para el PDF:', error);
		return null;
	}
}

/**
 * Convierte una URL (o data URL) a base64 PNG para pdfmake.
 * Si ya viene como data URL, se re-transcodifica a PNG para garantizar
 * compatibilidad (pdfkit no soporta WebP).
 */
export async function imageToBase64Url(url: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();

	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No se pudo crear contexto 2D para transcodificar imagen');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	return canvas.toDataURL('image/png');
}
