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
export async function obtenerLogoBase64(esCotransmeq: boolean = true): Promise<string | null> {
	try {
		const logoPath = '/assets/logo.png';
		return await imageToBase64(logoPath);
	} catch (error) {
		console.warn('No se pudo cargar el logo para el PDF:', error);
		return null;
	}
}
