import { apiClient } from './apiClient';

export interface CambioCanvas {
	id: string;
	scope: string;
	sheet_key: string | null;
	entity_type: string;
	entity_id: string;
	field: string;
	valor_anterior: unknown;
	valor_nuevo: unknown;
	usuario_nombre: string;
	created_at: string;
}

export const canvasCambiosAPI = {
	async listar(params: { scope: string; anio: number; mes: number; sheet_key?: string | null }) {
		const { data } = await apiClient.get('/api/canvas-cambios', { params });
		return (data?.cambios ?? []) as CambioCanvas[];
	}
};
