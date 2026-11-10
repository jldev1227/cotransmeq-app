import { apiClient } from './apiClient';

export type DestinatarioRol = 'RESPONSABLE' | 'COLABORADOR' | 'SUPLENTE';
const ruta = (path = '') => `/api/plan-trabajo${path}`;

export const planTrabajoApi = {
	async listar() {
		const { data } = await apiClient.get(ruta());
		return data.data as any[];
	},
	async gestion(planId: string) {
		const { data } = await apiClient.get(ruta(`/${encodeURIComponent(planId)}/gestion`));
		return data.data as any;
	},
	async indicadores(planId: string, trimestre?: number) {
		const periodo = trimestre ? `?trimestre=${trimestre}` : '';
		const { data } = await apiClient.get(
			ruta(`/${encodeURIComponent(planId)}/indicadores${periodo}`)
		);
		return data.data as any[];
	},
	async guardarBandas(
		planId: string,
		numero: number,
		bandas_referencia: { adecuado: string; riesgo: string; critico: string }
	) {
		const { data } = await apiClient.put(
			ruta(`/${encodeURIComponent(planId)}/indicadores/${numero}/bandas`),
			{ bandas_referencia }
		);
		return data.data;
	},
	async asignarCargo(
		planId: string,
		cargo: string,
		area: string | null,
		asignaciones: { usuario_id: string; rol: DestinatarioRol }[]
	) {
		await apiClient.put(ruta(`/${encodeURIComponent(planId)}/cargos`), {
			cargo,
			area,
			asignaciones
		});
	},
	async activar(planId: string) {
		await apiClient.post(ruta(`/${encodeURIComponent(planId)}/activar`));
	},
	async clonar(planId: string, anio: number) {
		const { data } = await apiClient.post(ruta(`/${encodeURIComponent(planId)}/clonar`), { anio });
		return data.data;
	},
	async asignarConductores(
		ocurrenciaId: string,
		asignaciones: { conductor_id: string; rol: DestinatarioRol }[]
	) {
		await apiClient.put(ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/conductores`), {
			asignaciones
		});
	},
	async completar(ocurrenciaId: string) {
		await apiClient.patch(ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/completar`));
	},
	async marcarNoAplica(ocurrenciaId: string, motivo: string) {
		await apiClient.patch(ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/no-aplica`), {
			motivo
		});
	},
	async requiereEvidencia(actividadId: string, requiere_evidencia: boolean) {
		await apiClient.patch(
			ruta(`/actividades/${encodeURIComponent(actividadId)}/evidencia-requerida`),
			{ requiere_evidencia }
		);
	},
	async subirEvidenciaOcurrencia(ocurrenciaId: string, archivo: File) {
		const form = new FormData();
		form.append('archivo', archivo);
		const { data } = await apiClient.post(
			ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/evidencias`),
			form
		);
		return data.data;
	},
	async guardarIndicador(
		planId: string,
		numero: number,
		body: { cumple: boolean; observacion?: string }
	) {
		const { data } = await apiClient.put(
			ruta(`/${encodeURIComponent(planId)}/indicadores/${numero}`),
			body
		);
		return data.data;
	},
	async subirEvidenciaIndicador(indicadorId: string, archivo: File) {
		const form = new FormData();
		form.append('archivo', archivo);
		const { data } = await apiClient.post(
			ruta(`/indicadores/${encodeURIComponent(indicadorId)}/evidencias`),
			form
		);
		return data.data;
	},
	async urlEvidencia(evidenciaId: string) {
		const { data } = await apiClient.get(
			ruta(`/evidencias/${encodeURIComponent(evidenciaId)}/url`)
		);
		return data.data as { url: string; nombre_archivo: string };
	}
};
