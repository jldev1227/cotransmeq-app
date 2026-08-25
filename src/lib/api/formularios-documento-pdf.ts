import { apiClient } from './apiClient';

/**
 * PDF del documento de un envío de formulario dinámico.
 *
 * Mismo contrato que el PDF de los canvas de terceros: el cuerpo del documento y
 * su hoja de estilos salen del preview que el usuario tiene en pantalla, y el
 * backend solo añade las fuentes embebidas y pasa por Chromium. Ver
 * `backend-nest/src/modules/liquidaciones-terceros-pdf/canvas-pdf.service.ts`,
 * que es el servicio que atiende las dos rutas.
 */
export const formulariosDocumentoPdfAPI = {
	async renderizar(payload: { html: string; css: string; filename: string }): Promise<Blob> {
		const response = await apiClient.post('/api/formularios/documento/pdf', payload, {
			responseType: 'blob',
			/// Un preoperacional de 131 ítems con sus fotos tarda más que el timeout
			/// por defecto: el coste no está en la red sino en el layout de Chromium
			/// y en descargar las imágenes de S3.
			timeout: 120_000
		});
		return response.data as Blob;
	}
};
