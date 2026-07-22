import { apiClient } from './apiClient';

/**
 * Procesar conciliación de facturas con terceros
 * Envía 2 archivos CSV/Excel y retorna el resultado de la conciliación
 */
export async function procesarConciliacion(contableFile: File, liquidacionesFile: File) {
	const formData = new FormData();
	formData.append('contable', contableFile);
	formData.append('liquidaciones', liquidacionesFile);

	const response = await apiClient.post('/api/contabilidad/conciliacion-terceros', formData);
	return response.data;
}

/**
 * Descargar Excel de conciliación
 * Envía los mismos archivos y retorna el blob del Excel
 */
export async function descargarExcelConciliacion(contableFile: File, liquidacionesFile: File): Promise<Blob> {
	const formData = new FormData();
	formData.append('contable', contableFile);
	formData.append('liquidaciones', liquidacionesFile);

	const response = await apiClient.post('/api/contabilidad/conciliacion-terceros/excel', formData, {
		responseType: 'blob'
	});
	return response.data;
}
