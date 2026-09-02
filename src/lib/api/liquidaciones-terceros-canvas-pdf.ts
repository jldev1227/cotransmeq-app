import { apiClient } from './apiClient';

/**
 * PDF de un canvas del módulo de terceros.
 *
 * El cuerpo del documento y su hoja de estilos salen del preview que el
 * usuario tiene en pantalla —incluidas las columnas que dejó activas— y el
 * backend solo añade las fuentes embebidas y pasa por Chromium. Ver
 * `backend-nest/src/modules/liquidaciones-terceros-pdf/canvas-pdf.service.ts`.
 */
export const liquidacionesTercerosCanvasPdfAPI = {
	async renderizar(payload: {
		html: string;
		css: string;
		filename: string;
	}): Promise<Blob> {
		const response = await apiClient.post(
			'/api/liquidaciones-terceros/canvas/pdf',
			payload,
			{
				responseType: 'blob',
				// Un mes lleno puede tardar más que el timeout por defecto: el
				// coste no está en la red sino en el layout de Chromium.
				timeout: 120_000
			}
		);
		return response.data as Blob;
	},

	/**
	 * Un PDF por hoja, empaquetados en un ZIP.
	 *
	 * Timeout mucho mayor que el del PDF suelto: el servidor genera las hojas de
	 * una en una con Chromium, así que un mes de cuarenta placas ronda el minuto
	 * y medio. Cortar antes dejaría el trabajo hecho y la respuesta perdida.
	 */
	async renderizarZip(payload: {
		css: string;
		documentos: Array<{ html: string; filename: string }>;
		zipname: string;
	}): Promise<Blob> {
		const response = await apiClient.post('/api/liquidaciones-terceros/canvas/pdf-zip', payload, {
			responseType: 'blob',
			timeout: 600_000
		});
		return response.data as Blob;
	}
};
