import { apiClient } from './apiClient';

const BASE = '/api/liquidaciones-terceros-ingresos/snapshots';

export const ingresosSnapshotsAPI = {
	async listar(anio: number, mes: number) {
		const { data } = await apiClient.get(BASE, { params: { anio, mes } });
		return data as Array<{
			id: string;
			version: number;
			origen: string;
			created_at: string;
			usuario: { id: string; nombre: string } | null;
			diff: any[];
		}>;
	},
	async capturar(anio: number, mes: number) {
		const { data } = await apiClient.post(BASE, { anio, mes });
		return data;
	},
	async obtener(id: string) {
		const { data } = await apiClient.get(`${BASE}/${id}`);
		return data as {
			payload: {
				periodo: { anio: number; mes: number };
				filas: any[];
				estado: any;
				anotaciones: any[];
			};
		};
	},
	async diff(id: string, vs?: string) {
		const { data } = await apiClient.get(`${BASE}/${id}/diff`, { params: vs ? { vs } : undefined });
		return data as { fields: Array<{ path: string; anterior: any; nuevo: any }> };
	},
	async revertir(id: string, placa?: string | null) {
		const { data } = await apiClient.post(`${BASE}/${id}/revertir`, placa ? { placa } : {});
		return data as { restauradas: number; nuevoSnapshot: { id: string; version: number } };
	}
};
