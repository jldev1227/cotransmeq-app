import { apiClient } from './apiClient';

/**
 * Documentos de la hoja de vida del conductor (licencia, exámenes, cursos,
 * seguridad social…). El catálogo de categorías llega con el listado: vive
 * solo en el backend.
 */

export type EstadoVigencia =
	'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha' | 'no_aplica' | 'faltante' | 'cargado';

export interface DocumentoConductor {
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
	categoria_licencia: string | null;
	origen: string;
	creado: string;
}

export interface CategoriaDocumentosConductor {
	clave: string;
	etiqueta: string;
	grupo: 'vigencias' | 'identificacion' | 'laboral';
	vence: boolean;
	requerido?: boolean;
	puedeNoAplicar?: boolean;
	cicloMeses?: number;
	diasAviso?: number;
	/** Rótulo de la fecha cuando no «vence» sino que toca repetirla (SIMIT). */
	etiquetaFecha?: string;
	pideCategoriaLicencia?: boolean;
	actual: DocumentoConductor | null;
	estado: EstadoVigencia;
	dias: number | null;
	/** Fecha efectiva; en la licencia puede venir de la ficha sin archivo. */
	vencimiento: string | null;
	historial: DocumentoConductor[];
	/** Solo la licencia: la categoría que tiene la ficha. */
	categoria_licencia?: string | null;
}

export interface DocumentosConductorRespuesta {
	hoy: string;
	categorias: CategoriaDocumentosConductor[];
	resumen: {
		vencidos: number;
		por_vencer: number;
		faltantes: number;
		sin_fecha: number;
		al_dia: number;
		total: number;
	};
}

export const CATEGORIAS_LICENCIA = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'] as const;

export const conductoresDocumentosAPI = {
	listar: async (conductorId: string) =>
		(await apiClient.get(`/api/conductores/${conductorId}/documentos`)).data
			.data as DocumentosConductorRespuesta,

	subir: async (
		conductorId: string,
		datos: {
			categoria: string;
			archivo?: File | null;
			fecha_vencimiento?: string | null;
			categoria_licencia?: string | null;
			no_aplica?: boolean;
		}
	) => {
		// Los campos van ANTES del archivo: el backend los lee en orden.
		const fd = new FormData();
		fd.append('categoria', datos.categoria);
		if (datos.fecha_vencimiento) fd.append('fecha_vencimiento', datos.fecha_vencimiento);
		if (datos.categoria_licencia) fd.append('categoria_licencia', datos.categoria_licencia);
		if (datos.no_aplica) fd.append('no_aplica', 'true');
		if (datos.archivo) fd.append('archivo', datos.archivo);
		return (await apiClient.post(`/api/conductores/${conductorId}/documentos`, fd)).data
			.data as DocumentoConductor;
	},

	actualizar: async (
		conductorId: string,
		docId: string,
		datos: { fecha_vencimiento?: string | null; categoria_licencia?: string | null }
	) =>
		(await apiClient.patch(`/api/conductores/${conductorId}/documentos/${docId}`, datos)).data
			.data as DocumentoConductor,

	eliminar: (conductorId: string, docId: string) =>
		apiClient.delete(`/api/conductores/${conductorId}/documentos/${docId}`),

	url: async (conductorId: string, docId: string) =>
		(await apiClient.get(`/api/conductores/${conductorId}/documentos/${docId}/url`)).data.data
			.url as string
};
