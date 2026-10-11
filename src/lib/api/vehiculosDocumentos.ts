import { apiClient } from './apiClient';

/**
 * Documentos de la hoja de vida del vehículo (SOAT, pólizas, tecnomecánica…).
 * El catálogo de categorías llega con el listado: vive solo en el backend.
 */

export type EstadoVigencia =
	'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha' | 'no_aplica' | 'faltante' | 'cargado';

export interface DocumentoVehiculo {
	id: string;
	categoria: string;
	nombre: string;
	mimetype: string;
	size: number;
	estado: string;
	tiene_archivo: boolean;
	fecha_vencimiento: string | null;
	fecha_expedicion: string | null;
	numero: string | null;
	emisor: string | null;
	origen: string;
	creado: string;
}

export interface CategoriaDocumentos {
	clave: string;
	etiqueta: string;
	grupo: 'vigencias' | 'legales' | 'operacion';
	vence: boolean;
	puedeNoAplicar?: boolean;
	cicloMeses?: number;
	paraConductor?: boolean;
	actual: DocumentoVehiculo | null;
	estado: EstadoVigencia;
	dias: number | null;
	historial: DocumentoVehiculo[];
}

export interface DocumentosVehiculoRespuesta {
	hoy: string;
	categorias: CategoriaDocumentos[];
	resumen: {
		vencidos: number;
		por_vencer: number;
		faltantes: number;
		al_dia: number;
		total: number;
	};
}

export const vehiculosDocumentosAPI = {
	listar: async (vehiculoId: string) =>
		(await apiClient.get(`/api/vehiculos/${vehiculoId}/documentos`)).data
			.data as DocumentosVehiculoRespuesta,

	subir: async (
		vehiculoId: string,
		datos: {
			categoria: string;
			archivo?: File | null;
			fecha_vencimiento?: string | null;
			no_aplica?: boolean;
		}
	) => {
		// Los campos van ANTES del archivo: el backend los lee en orden.
		const fd = new FormData();
		fd.append('categoria', datos.categoria);
		if (datos.fecha_vencimiento) fd.append('fecha_vencimiento', datos.fecha_vencimiento);
		if (datos.no_aplica) fd.append('no_aplica', 'true');
		if (datos.archivo) fd.append('archivo', datos.archivo);
		return (await apiClient.post(`/api/vehiculos/${vehiculoId}/documentos`, fd)).data
			.data as DocumentoVehiculo;
	},

	actualizar: async (
		vehiculoId: string,
		docId: string,
		datos: { fecha_vencimiento?: string | null }
	) =>
		(await apiClient.patch(`/api/vehiculos/${vehiculoId}/documentos/${docId}`, datos)).data
			.data as DocumentoVehiculo,

	eliminar: (vehiculoId: string, docId: string) =>
		apiClient.delete(`/api/vehiculos/${vehiculoId}/documentos/${docId}`),

	url: async (vehiculoId: string, docId: string) =>
		(await apiClient.get(`/api/vehiculos/${vehiculoId}/documentos/${docId}/url`)).data.data
			.url as string
};
