import { apiClient } from '$lib/api/apiClient';

export interface ChatMessage {
	id: string;
	liquidacion_tercero_id: string;
	usuario_id: string;
	usuario_nombre: string;
	contenido: string;
	nonce: string;
	tipo: 'NOTA' | 'RECORDATORIO_REF' | 'SISTEMA';
	recordatorio_id?: string;
	created_at: string;
	edited_at?: string;
}

export const liquidacionesChatAPI = {
	async listar(
		liquidacionId: string,
		{ before, limit = 50 }: { before?: string; limit?: number } = {}
	) {
		const params = new URLSearchParams();
		if (before) params.set('before', before);
		if (limit) params.set('limit', String(limit));

		const res = await apiClient.get(
			`/api/liquidaciones-terceros/${liquidacionId}/chat/mensajes?${params}`
		);
		return res.data as { mensajes: ChatMessage[]; hasMore: boolean };
	},

	async enviar(
		liquidacionId: string,
		data: {
			contenido: string;
			tipo: 'NOTA' | 'RECORDATORIO_REF' | 'SISTEMA';
			recordatorio_id?: string;
		}
	) {
		const res = await apiClient.post(
			`/api/liquidaciones-terceros/${liquidacionId}/chat/mensajes`,
			data
		);
		return res.data as ChatMessage;
	},

	async eliminar(liquidacionId: string, messageId: string) {
		await apiClient.delete(`/api/liquidaciones-terceros/${liquidacionId}/chat/mensajes/${messageId}`);
	}
};
