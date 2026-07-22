/**
 * Utilidades compartidas para generación de PDFs con pdfmake
 */

/**
 * Convierte una imagen (URL relativa o absoluta) a base64 data URL para pdfmake
 */
export async function imageToBase64(url: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/**
 * Obtiene el logo de Cotransmeq en base64 para PDFs
 */
export async function obtenerLogoBase64(esCotransmeq: boolean = true, prima: boolean = false): Promise<string | null> {
	try {
		const logoPath = prima ? '/assets/logo_nombre.webp' : '/assets/logo.webp';
		return await imageToBase64(logoPath);
	} catch (error) {
		console.warn('No se pudo cargar el logo para el PDF:', error);
		return null;
	}
}

/**
 * Convierte una URL (o data URL) a base64 con prefijo data:image/...
 * Usado para incrustar imágenes (firmas, logos) en PDFs generados con pdfmake.
 */
export async function imageToBase64Url(url: string): Promise<string> {
	if (url.startsWith('data:')) {
		return url;
	}
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
