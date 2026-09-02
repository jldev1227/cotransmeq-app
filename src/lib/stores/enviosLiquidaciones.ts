/**
 * Estado del job de envíos por correo de liquidaciones de terceros.
 *
 * Mismo diseño que `borradorQueue`: el job vive en el SERVIDOR y aquí solo
 * se refleja lo que llega por socket al room del usuario. El modal puede
 * cerrarse y reabrirse sin perder el progreso, y si la página se recarga se
 * puede consultar `status(jobId)` — el resultado queda además en la tabla
 * `liquidacion_tercero_envio`, que es la constancia de verdad.
 */

import { writable } from 'svelte/store';
import { socketUtils } from '$lib/socket';
import {
	liquidacionesTercerosEnviosAPI,
	type EnvioLotePayload
} from '$lib/api/liquidaciones-terceros-envios';

export interface EnvioItemResultado {
	cierre_id: string | null;
	origen_id?: string | null;
	placa: string;
	to: string;
	estado: 'ENVIADO' | 'ERROR';
	error?: string;
	enviado_at?: string;
}

export interface EnvioLiqJob {
	jobId: string;
	status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'locked';
	progress: number;
	currentStep: string;
	processed: number;
	total: number;
	resultados: EnvioItemResultado[];
	error?: string;
	lockedBy?: {
		userName: string;
		anio: number;
		mes: number;
	};
}

export const enviosLiqStore = writable<EnvioLiqJob | null>(null);

export const enviosLiqQueue = {
	async start(payload: EnvioLotePayload) {
		enviosLiqStore.set({
			jobId: '',
			status: 'queued',
			progress: 0,
			currentStep: 'Enviando el lote al servidor…',
			processed: 0,
			total: payload.items.length,
			resultados: []
		});
		try {
			const r = await liquidacionesTercerosEnviosAPI.encolarLote(payload);
			if (r.status === 'locked') {
				enviosLiqStore.set({
					jobId: r.locked_by?.jobId ?? '',
					status: 'locked',
					progress: r.locked_by?.progress ?? 0,
					currentStep: r.locked_by?.currentStep ?? '',
					processed: 0,
					total: 0,
					resultados: [],
					lockedBy: {
						userName: r.locked_by?.userName ?? 'Otro usuario',
						anio: r.locked_by?.anio,
						mes: r.locked_by?.mes
					}
				});
				return r;
			}
			enviosLiqStore.update((j) => (j ? { ...j, jobId: r.job_id, currentStep: 'En cola…' } : j));
			return r;
		} catch (e: any) {
			const msg = e?.response?.data?.error || e?.message || 'Error al encolar los envíos';
			enviosLiqStore.set({
				jobId: '',
				status: 'error',
				progress: 0,
				currentStep: 'Error',
				processed: 0,
				total: 0,
				resultados: [],
				error: msg
			});
			throw new Error(msg);
		}
	},

	async cancel(jobId: string) {
		try {
			await liquidacionesTercerosEnviosAPI.cancelar(jobId);
		} catch {
			/* si el job ya terminó, el 404 no es un error para el usuario */
		}
	},

	dismiss() {
		enviosLiqStore.set(null);
	}
};

// ── Socket listeners (una sola vez a nivel de módulo) ──

socketUtils.on('envio-liq:queued', (d: any) => {
	enviosLiqStore.update((j) =>
		j ? { ...j, jobId: d.job_id, status: 'queued', total: d.total ?? j.total } : j
	);
});

socketUtils.on('envio-liq:start', (d: any) => {
	enviosLiqStore.update((j) =>
		j && j.jobId === d.job_id
			? { ...j, status: 'running', currentStep: 'Iniciando envíos…', total: d.total ?? j.total }
			: j
	);
});

socketUtils.on('envio-liq:progress', (d: any) => {
	enviosLiqStore.update((j) =>
		j && j.jobId === d.job_id
			? {
					...j,
					status: 'running',
					progress: d.progress,
					currentStep: d.current_step,
					processed: d.processed,
					total: d.total
				}
			: j
	);
});

socketUtils.on('envio-liq:item', (d: any) => {
	enviosLiqStore.update((j) => {
		if (!j || j.jobId !== d.job_id) return j;
		return {
			...j,
			resultados: [
				...j.resultados,
				{
					cierre_id: d.cierre_id,
					placa: d.placa,
					to: d.to,
					estado: d.estado,
					error: d.error,
					enviado_at: d.enviado_at
				}
			]
		};
	});
});

socketUtils.on('envio-liq:complete', (d: any) => {
	enviosLiqStore.update((j) =>
		j && j.jobId === d.job_id
			? {
					...j,
					status: 'complete',
					progress: 100,
					currentStep: 'Completado',
					resultados: d.resultados ?? j.resultados
				}
			: j
	);
});

socketUtils.on('envio-liq:error', (d: any) => {
	enviosLiqStore.update((j) =>
		j && j.jobId === d.job_id
			? { ...j, status: 'error', error: d.error, resultados: d.resultados ?? j.resultados }
			: j
	);
});

socketUtils.on('envio-liq:cancelled', (d: any) => {
	enviosLiqStore.update((j) =>
		j && j.jobId === d.job_id
			? {
					...j,
					status: 'cancelled',
					currentStep: 'Cancelado',
					resultados: d.resultados ?? j.resultados
				}
			: j
	);
});
