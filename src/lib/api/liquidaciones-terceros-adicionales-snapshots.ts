import { apiClient } from './apiClient';

/**
 * Snapshots por PERIODO de los adicionales de cierres finales.
 *
 * A diferencia de los del ocasional, no cuelgan de una cabecera: los
 * adicionales de un mes pertenecen a N cierres finales, así que la identidad
 * es `(anio, mes, version)`.
 */

export interface SnapshotResumen {
	id: string;
	version: number;
	rama: string;
	/** `manual` | `auto` (cron) | `revert` */
	origen: string;
	revertido_de_id: string | null;
	usuario: { id: string; nombre: string; correo: string } | null;
	created_at: string;
	diff: Array<{ path: string; anterior: any; nuevo: any }> | null;
	meta: { capturado_en: string; capturado_por: string; version_origen: number } | null;
	totales: { filas: number; cierres: number; suma_valor_liquidar: number } | null;
}

export interface SnapshotDiff {
	fields: Array<{ path: string; anterior: any; nuevo: any }>;
}

export interface RevertirResultado {
	id: string;
	version: number;
	restauradas: number;
	cierres_afectados: number;
	/** Cierres que NO se tocaron por estar APROBADA/FACTURADA/ANULADA. */
	cierres_omitidos: Array<{ id: string; consecutivo: string; estado: string }>;
}

const BASE = '/api/liquidaciones-terceros-adicionales/snapshots';

export const adicionalesSnapshotsAPI = {
	async listar(anio: number, mes: number): Promise<SnapshotResumen[]> {
		const r = await apiClient.get(BASE, { params: { anio, mes } });
		return Array.isArray(r.data?.snapshots) ? r.data.snapshots : [];
	},

	async capturar(anio: number, mes: number): Promise<SnapshotResumen> {
		const r = await apiClient.post(BASE, { anio, mes });
		return r.data;
	},

	/// Diff contra `vs`, o contra la versión inmediatamente anterior.
	async diff(id: string, vs?: string): Promise<SnapshotDiff> {
		const r = await apiClient.get(`${BASE}/${id}/diff`, {
			params: vs ? { vs } : undefined
		});
		return r.data;
	},

	async revertir(id: string): Promise<RevertirResultado> {
		const r = await apiClient.post(`${BASE}/${id}/revertir`);
		return r.data;
	}
};
