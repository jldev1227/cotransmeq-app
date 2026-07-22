export interface DocumentoTributario {
	id: string;
	nombre: string;
	url: string;
	tamaño: number;
	tipo: string;
	fecha_creacion?: string;
	carpeta: string;
}

export interface CarpetaTributaria {
	nombre: string;
	cantidad: number;
}

export interface RespuestaCertificados {
	success: boolean;
	nit: string;
	documentos: DocumentoTributario[];
	carpetas: CarpetaTributaria[];
	total: number;
	mensaje?: string;
}

export type CodigoError =
	| 'invalid_nit'
	| 'not_found'
	| 'unauthorized'
	| 'forbidden'
	| 'not_configured'
	| 'rate_limited'
	| 'service_unavailable'
	| 'config_error'
	| 'server_error';

export interface ErrorCertificados {
	code: CodigoError;
	message: string;
	details?: string;
}

export interface ImportZipResumen {
	anio: number;
	total: number;
	exitosos: number;
	fallidos: number;
	omitidos: number;
	errores: { archivo: string; motivo: string }[];
	detalle: { nit: string; tipo: string; archivo: string; key: string }[];
}
