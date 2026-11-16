import { apiClient } from './apiClient';
import type { Area } from '$lib/config/permissions';

export type DestinatarioRol = 'RESPONSABLE' | 'COLABORADOR' | 'SUPLENTE';
export type DestinatarioTipo = 'ADMIN' | 'CONDUCTOR';
const ruta = (path = '') => `/api/plan-trabajo${path}`;

export const planTrabajoApi = {
	async misActividades() {
		const { data } = await apiClient.get(ruta('/mis-actividades'));
		return data.data as any[];
	},
	async participaciones(ocurrenciaId: string) {
		const { data } = await apiClient.get(ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/participaciones`));
		return data.data as any[];
	},
	async configurarParticipacion(id: string, cuota: number, form_assignment_id: string | null) {
		const { data } = await apiClient.patch(ruta(`/participaciones/${encodeURIComponent(id)}`), { cuota, form_assignment_id });
		return data.data;
	},
	async completarPropia(id: string) {
		const { data } = await apiClient.post(ruta(`/participaciones/${encodeURIComponent(id)}/completar`));
		return data.data;
	},
	async subirEvidenciaPropia(id: string, archivo: File) {
		const form = new FormData();
		form.append('archivo', archivo);
		const { data } = await apiClient.post(ruta(`/participaciones/${encodeURIComponent(id)}/evidencias`), form);
		return data.data;
	},
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
	async asignarCargos(
		planId: string,
		configuraciones: {
			cargo: string;
			area: Area | null;
			asignaciones: { usuario_id: string; rol: Exclude<DestinatarioRol, 'RESPONSABLE'> }[];
		}[]
	) {
		await apiClient.put(ruta(`/${encodeURIComponent(planId)}/cargos/lote`), {
			configuraciones
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
	async asignarDestinatarios(
		ocurrenciaId: string,
		asignaciones: { destinatario_tipo: DestinatarioTipo; destinatario_id: string; rol: DestinatarioRol }[]
	) {
		const { data } = await apiClient.put(
			ruta(`/ocurrencias/${encodeURIComponent(ocurrenciaId)}/asignaciones`),
			{ asignaciones }
		);
		return data.data as {
			asignados: number;
			asignaciones: number;
			administradoresNotificados: number;
			conductoresNotificados: number;
			notificados: number;
		};
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
