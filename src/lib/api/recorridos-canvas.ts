import { apiClient } from './apiClient';
import type { RecorridosPeriodoDTO, BonoColumna } from '$lib/editor/builders/recorridos.builder';

/**
 * Canvas de recorridos.
 *
 * Solo LECTURA: las escrituras del canvas viajan por socket (`sheet:patch`),
 * donde el backend vuelve a comprobar el área. Aquí quedan el libro del
 * periodo, las columnas de bono y los snapshots.
 */
export const recorridosCanvasAPI = {
	/**
	 * El libro completo de un CORTE.
	 *
	 * Sin fechas, el servidor sirve el corte 21→20 vivo, que es lo que
	 * Operaciones está trabajando.
	 */
	async periodo(params: {
		desde?: string;
		hasta?: string;
		conductores?: string[];
	}): Promise<RecorridosPeriodoDTO> {
		const { data } = await apiClient.get('/api/recorridos/canvas', {
			params: {
				...(params.desde ? { desde: params.desde } : {}),
				...(params.hasta ? { hasta: params.hasta } : {}),
				...(params.conductores?.length ? { conductores: params.conductores.join(',') } : {})
			}
		});
		return data as RecorridosPeriodoDTO;
	},

	/**
	 * Columnas de bono del año.
	 *
	 * Se pide aparte del libro para que el modal de configuración pueda saber
	 * qué cambió sin recargar el periodo entero.
	 */
	async bonos(anio: number): Promise<{ anio: number; bonos: BonoColumna[] }> {
		const { data } = await apiClient.get('/api/recorridos/canvas/bonos', { params: { anio } });
		return data as { anio: number; bonos: BonoColumna[] };
	}
};

export interface SnapshotRecorridos {
	id: string;
	anio: number;
	mes: number;
	rama: string;
	version: number;
	origen: string;
	revertido_de_id: string | null;
	usuario_id: string | null;
	created_at: string;
	usuario?: { id: string; nombre: string | null; correo: string | null } | null;
}

export const recorridosSnapshotsAPI = {
	async listar(anio: number, mes: number): Promise<SnapshotRecorridos[]> {
		const { data } = await apiClient.get('/api/recorridos/snapshots', { params: { anio, mes } });
		return data as SnapshotRecorridos[];
	},

	/** Devuelve `{ sinCambios: true }` cuando no había nada nuevo que guardar. */
	async capturar(anio: number, mes: number) {
		const { data } = await apiClient.post('/api/recorridos/snapshots', null, {
			params: { anio, mes }
		});
		return data as SnapshotRecorridos | { sinCambios: true };
	},

	async obtener(id: string) {
		const { data } = await apiClient.get(`/api/recorridos/snapshots/${id}`);
		return data;
	},

	async diff(id: string, vs?: string) {
		const { data } = await apiClient.get(`/api/recorridos/snapshots/${id}/diff`, {
			params: vs ? { vs } : {}
		});
		return data as {
			contra: { id: string; version: number } | null;
			cambios: Array<Record<string, unknown>>;
			truncado: boolean;
		};
	},

	async revertir(id: string) {
		const { data } = await apiClient.post(`/api/recorridos/snapshots/${id}/revertir`);
		return data as {
			filasRestauradas: number;
			fallidas: Array<{ conductor_id: string; error: string }>;
		};
	}
};
