import { apiClient } from '$lib/api/apiClient';

export interface Recordatorio {
	id: string;
	liquidacion_origen_id: string;
	placa: string;
	mes: number;
	anio: number;
	descripcion: string;
	nonce: string;
	monto?: number;
	moneda: 'COP';
	estado: 'PENDIENTE' | 'APLICADO' | 'CANCELADO' | 'VENCIDO';
	prioridad: 'BAJA' | 'MEDIA' | 'ALTA';
	creado_por_usuario_id: string;
	creado_por_nombre: string;
	aplicado_en_liquidacion_id?: string;
	created_at: string;
	aplica_en?: string;
}

export const liquidacionesRecordatoriosAPI = {
	async listar(liquidacionId: string) {
		const res = await apiClient.get(`/api/liquidaciones-terceros/${liquidacionId}/recordatorios`);
		return res.data as Recordatorio[];
	},

	async crear(
		liquidacionId: string,
		data: {
			placa: string;
			mes: number;
			anio: number;
			descripcion: string;
			monto?: number;
			prioridad: 'BAJA' | 'MEDIA' | 'ALTA';
			aplica_en?: string;
		}
	) {
		const res = await apiClient.post(
			`/api/liquidaciones-terceros/${liquidacionId}/recordatorios`,
			data
		);
		return res.data as Recordatorio;
	},

	async cambiarEstado(
		recordatorioId: string,
		estado: 'PENDIENTE' | 'APLICADO' | 'CANCELADO' | 'VENCIDO',
		liquidacion_aplicada_id?: string
	) {
		const res = await apiClient.patch(
			`/api/liquidaciones-terceros/recordatorios/${recordatorioId}/estado`,
			{ estado, liquidacion_aplicada_id }
		);
		return res.data as Recordatorio;
	},

	async pendientesPorPlaca(placa: string, mes: number, anio: number) {
		const res = await apiClient.get('/api/recordatorios/pendientes', {
			params: { placa, mes, anio }
		});
		return res.data as Recordatorio[];
	}
};
