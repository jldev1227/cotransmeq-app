import { apiClient } from './apiClient';
import type { CeldaDeCapa } from '$lib/editor/business/zona-libre';

export type ScopeCanvas = 'cierres-finales' | 'ocasional' | 'adicionales' | 'ingresos';

/// `{ [mes]: { [sheet_key]: CeldaDeCapa[] } }`
export type AnotacionesPorMes = Record<number, Record<string, CeldaDeCapa[]>>;

/**
 * Anotaciones libres de un canvas.
 *
 * Solo carga inicial: a partir de ahí se mantienen al día por socket
 * (`sheet:patch` con `entity_type: 'anotacion'`), igual que el resto de
 * celdas, para que el equipo las vea al momento.
 */
export const canvasAnotacionesAPI = {
	async listar(scope: ScopeCanvas, anio: number, mes?: number): Promise<AnotacionesPorMes> {
		const { data } = await apiClient.get('/api/canvas-anotaciones', {
			params: { scope, anio, ...(mes != null ? { mes } : {}) }
		});
		return (data?.porMes ?? {}) as AnotacionesPorMes;
	}
};
