import { apiClient } from './apiClient';

export interface AdminNitInfo {
	nit: string;
	total: number;
	anios: string[];
}

export interface ImportZipResumen {
	jobId: string;
	anio: number;
	total: number;
	exitosos: number;
	fallidos: number;
	omitidos: number;
	errores: { archivo: string; motivo: string }[];
	detalle: { nit: string; tipo: string; archivo: string; key: string }[];
}

	export const certificadosAdminAPI = {
	listarNits: () =>
		apiClient.get<{ success: boolean; nits: AdminNitInfo[]; total: number }>(
			'/api/certificados-tributarios/nits'
		),

	listarPorNit: (nit: string) =>
		apiClient.get<{
			success: boolean;
			nit: string;
			total: number;
			carpetas: Record<string, any[]>;
		}>(`/api/certificados-tributarios/list?nit=${nit}`),

	uploadPdf: (file: File, data: { nit?: string; anio: number; tipo?: string }) => {
		const formData = new FormData();
		formData.append('file', file);
		if (data.nit) formData.append('nit', data.nit);
		formData.append('anio', String(data.anio));
		if (data.tipo) formData.append('tipo', data.tipo);
		return apiClient.post('/api/certificados-tributarios/upload', formData);
	},

	importZip: (file: File, anio: number) => {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('anio', String(anio));
		return apiClient.post<{ success: boolean; resumen: ImportZipResumen }>(
			'/api/certificados-tributarios/import-zip',
			formData,
			{ headers: { 'Content-Type': 'multipart/form-data' } }
		);
	},

	syncS3: () =>
		apiClient.post<{ success: boolean; created: number; skipped: number; linked: number; errors: number }>(
			'/api/certificados-tributarios/sync-s3'
		)
};
