import { apiClient } from './apiClient';

export type TipoEntidadAnalitica = 'conductor' | 'vehiculo' | 'cliente' | 'tercero';

export interface AnaliticaIndividual {
	periodo: { desde: string; hasta: string };
	resumen: Record<string, number>;
	faltantes?: string[];
	sede?: { municipio?: string | null; departamento?: string | null };
	detalle?: Record<string, any>;
	extracto?: Record<string, any> | null;
	fuecs_vigentes?: Array<{ id: string; numero_completo: string; vigencia_hasta: string; vehiculo_placa: string | null }>;
	fuecs_recientes?: Array<{ id: string; numero_completo: string; vigencia_hasta: string; vehiculo_placa: string | null }>;
	fuecs_vencidos_periodo?: Array<{ id: string; numero_completo: string; vigencia_hasta: string; vehiculo_placa: string | null }>;
	zonas?: Array<{ nombre: string; departamento?: string | null; servicios: number; latitud?: number | null; longitud?: number | null }>;
	zonas_historicas?: Array<{ nombre: string; departamento?: string | null; servicios: number; latitud?: number | null; longitud?: number | null }>;
	rutas?: Array<{
		servicio_id: string;
		origen: { nombre?: string | null; latitud: number | string; longitud: number | string };
		destino: { nombre?: string | null; latitud: number | string; longitud: number | string };
	}>;
	vehiculos?: Array<Record<string, any>>;
	liquidaciones?: Array<Record<string, any>>;
	notas?: string | null;
}

export async function obtenerAnaliticaIndividual(
	tipo: TipoEntidadAnalitica,
	id: string,
	desde: string,
	hasta: string,
	historico = false
) {
	const respuesta = await apiClient.get(`/api/analitica-individual/${tipo}/${id}`, {
		params: { desde, hasta, ...(historico && { historico: '1' }) }
	});
	return respuesta.data.data as AnaliticaIndividual;
}
