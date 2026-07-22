import { apiClient, publicApiClient } from './apiClient';

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

export interface TerceroWithCerts {
	id: string;
	nombre_completo: string;
	identificacion: string | null;
	correo: string | null;
	telefono: string | null;
	tipo_persona: string;
	activo: boolean;
	certificados_archivo: Array<{
		id: string;
		nit: string;
		anio: number;
		tipo: string;
		filename: string;
		s3_key: string;
		url: string | null;
		tipo_certificado: { nombre: string; codigo: string } | null;
	}>;
	_count: { certificados_archivo: number };
}

export interface CertificacionEnvio {
	id: string;
	tercero_id: string;
	certificado_id: string | null;
	token_acceso: string;
	email_destino: string;
	tipo_envio: 'individual' | 'masivo';
	emitido_at: string;
	created_at: string;
	tercero?: { nombre_completo: string; identificacion: string | null; correo: string | null };
	certificado?: { filename: string; nit: string; anio: number; tipo: string };
}

export interface TipoCertificado {
	id: string;
	nombre: string;
	descripcion: string | null;
	codigo: string;
	activo: boolean;
}

export const certificadosAdminAPI = {
	listarNits: () =>
		apiClient.get<{ success: boolean; nits: AdminNitInfo[]; total: number }>(
			'/api/certificados-tributarios/nits'
		),

	listarPorNit: (nit: string) =>
		apiClient.get<{ success: boolean; nit: string; total: number; carpetas: Record<string, any[]> }>(
			`/api/certificados-tributarios/list?nit=${nit}`
		),

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
		),

	getArchivos: (params: { search?: string; page?: number; limit?: number }) =>
		apiClient.get<{ success: boolean; archivos: any[]; total: number; page: number; totalPages: number }>(
			'/api/certificados-tributarios/archivos',
			{ params }
		),

	getPorNit: (nit: string) =>
		apiClient.get<{ success: boolean; nit: string; archivos: any[]; total: number }>(
			`/api/certificados-tributarios/por-nit/${nit}`
		),

	linkCertificado: (certificadoId: string, terceroId: string) =>
		apiClient.post('/api/certificados-tributarios/link', { certificado_id: certificadoId, tercero_id: terceroId }),

	deleteCertificado: (id: string) =>
		apiClient.delete(`/api/certificados-tributarios/archivo/${id}`)
};

export const certificadosTerceroAPI = {
	getTercerosWithCertificados: (params: { search?: string; page?: number; limit?: number }) =>
		apiClient.get<{ success: boolean; terceros: TerceroWithCerts[]; total: number; page: number; totalPages: number }>(
			'/api/certificados-tributarios/terceros-con-certificados',
			{ params }
		),

	getCertificadosByTercero: (terceroId: string) =>
		apiClient.get<{ success: boolean; certificados: any[] }>(
			`/api/certificados-tributarios/tercero/${terceroId}`
		),

	enviarEmail: (data: { tercero_id: string; certificado_ids: string[]; email_destino: string; mensaje_personalizado?: string }) =>
		apiClient.post('/api/certificados-tributarios/enviar-email', data),

	enviarMasivo: (data: { tercero_ids: string[]; mensaje_personalizado?: string }) =>
		apiClient.post('/api/certificados-tributarios/enviar-masivo', data),

	getEnvios: (params: { page?: number; limit?: number }) =>
		apiClient.get<{ success: boolean; envios: CertificacionEnvio[]; total: number; page: number; totalPages: number }>(
			'/api/certificados-tributarios/envios',
			{ params }
		),

	getEnviosByTercero: (terceroId: string) =>
		apiClient.get<{ success: boolean; envios: CertificacionEnvio[] }>(
			`/api/certificados-tributarios/envios/tercero/${terceroId}`
		)
};

export const tiposCertificadoAPI = {
	list: () =>
		apiClient.get<{ success: boolean; tipos: TipoCertificado[] }>('/api/tipos-certificado'),

	create: (data: { nombre: string; descripcion?: string; codigo: string }) =>
		apiClient.post('/api/tipos-certificado', data),

	update: (id: string, data: { nombre?: string; descripcion?: string; codigo?: string; activo?: boolean }) =>
		apiClient.put(`/api/tipos-certificado/${id}`, data),

	delete: (id: string) =>
		apiClient.delete(`/api/tipos-certificado/${id}`)
};

export const certificadosPublicTerceroAPI = {
	solicitarAcceso: (identificacion: string) =>
		publicApiClient.post('/api/public/certificados-tercero/solicitar-acceso', { identificacion }),

	verificarToken: (token: string) =>
		publicApiClient.get<{ success: boolean; tercero: any; certificados: any[]; expires_at: string }>(
			`/api/public/certificados-tercero/verificar-token?token=${encodeURIComponent(token)}`
		)
};
