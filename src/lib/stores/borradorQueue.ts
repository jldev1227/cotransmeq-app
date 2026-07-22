import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { socketUtils } from '$lib/socket';
import { apiClient } from '$lib/api/apiClient';
import { toast } from 'svelte-sonner';

export interface BorradorJob {
	jobId: string;
	status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'locked';
	progress: number;
	currentStep: string;
	processed: number;
	total: number;
	result?: any;
	error?: string;
	lockedBy?: {
		userId: string;
		userName: string;
		startedAt: number;
		currentStep: string;
		progress: number;
		jobId: string;
	};
	startedAt?: number;
	finishedAt?: number;
}

const log = (msg: string, data?: any) => {
	if (browser) console.log(`[borrador-queue] ${msg}`, data ?? '');
};

// Store reactivo directo (usar como $borradorQueueStore en el template)
export const borradorQueueStore = writable<BorradorJob | null>(null);

// Log cuando el store cambia
if (browser) {
	borradorQueueStore.subscribe((value) => {
		log('store update', { status: value?.status, progress: value?.progress, currentStep: value?.currentStep });
	});
}

// Callbacks de completación (module-level para acceso desde socket listeners)
// Cada callback está asociado a un jobId específico. Si jobId es null, el callback
// se llama para CUALQUIER job (compatibilidad con uso genérico).
let completeCallbacks: { jobId: string | null; callback: (result: any) => void }[] = [];

class BorradorQueueStore {
	start(payload: { liquidacion_servicio_id?: string; liquidacion_servicio_ids?: string[]; placa?: string }) {
		log('start() llamado', payload);

		// Mostrar el modal INMEDIATAMENTE con estado "iniciando"
		borradorQueueStore.set({
			jobId: '',
			status: 'queued',
			progress: 0,
			currentStep: 'Iniciando generación...',
			processed: 0,
			total: 0,
		} as BorradorJob);

		return apiClient
			.post('/api/liquidaciones-terceros/generar-borrador-async', payload)
			.then(({ data }) => {
				log('HTTP response', data);

				if (data.status === 'locked') {
					borradorQueueStore.set({
						jobId: data.locked_by.jobId,
						status: 'locked',
						progress: data.locked_by.progress,
						currentStep: data.locked_by.currentStep,
						processed: 0,
						total: 0,
						lockedBy: data.locked_by,
					} as BorradorJob);
					return { status: 'locked' as const, lockedBy: data.locked_by };
				}

				borradorQueueStore.set({
					jobId: data.job_id,
					status: 'queued',
					progress: 0,
					currentStep: 'En cola...',
					processed: 0,
					total: 0,
				} as BorradorJob);

				return { status: 'queued' as const, jobId: data.job_id };
			})
			.catch((e: any) => {
				log('HTTP error', e.message);
				toast.error(`Error al iniciar generación: ${e.message}`);
				borradorQueueStore.set({
					jobId: '',
					status: 'error',
					progress: 0,
					currentStep: 'Error',
					processed: 0,
					total: 0,
					error: e.message,
				} as BorradorJob);
				return { status: 'error' as const, error: e.message };
			});
	}

	cancel() {
		log('cancel() llamado');
		const job: BorradorJob | null = get(borradorQueueStore);
		if (!job) {
			log('cancel() abort: no hay job activo');
			return;
		}
		log('cancel() emit', { job_id: job.jobId });
		socketUtils.emit('borrador:cancel', {
			job_id: job.jobId,
			user_id: job.lockedBy?.userId || null,
		});
	}

	// Registrar callback para un jobId específico — solo se llama cuando
	// llega el complete de ESE job, no de otros.
	onComplete(jobIdOrCallback: string | ((result: any) => void), maybeCallback?: (result: any) => void) {
		let jobId: string | null = null;
		let callback: (result: any) => void;
		if (typeof jobIdOrCallback === 'string') {
			jobId = jobIdOrCallback;
			callback = maybeCallback!;
		} else {
			callback = jobIdOrCallback;
		}
		log('onComplete() registrado', { jobId: jobId || 'ANY' });
		completeCallbacks.push({ jobId, callback });
		return () => {
			completeCallbacks = completeCallbacks.filter((cb) => cb.callback !== callback);
		};
	}

	dismiss() {
		log('dismiss()');
		borradorQueueStore.set(null);
	}

	checkStatus(jobId: string) {
		apiClient
			.get(`/api/liquidaciones-terceros/borrador-status/${jobId}`)
			.then(({ data }) => {
				borradorQueueStore.set({
					jobId: data.id,
					status: data.status,
					progress: data.progress,
					currentStep: data.currentStep,
					processed: data.processed,
					total: data.total,
					result: data.result,
					error: data.error,
					startedAt: data.startedAt,
					finishedAt: data.finishedAt,
				} as BorradorJob);
			})
			.catch(() => {});
	}
}

export const borradorQueue = new BorradorQueueStore();

// ── Socket event listeners (registrar una sola vez) ──
log('Registrando socket listeners para borrador:*');

socketUtils.on('borrador:queued', (data: any) => {
	log('socket: borrador:queued', data);
	borradorQueueStore.update((current) => ({
		...(current || {}),
		jobId: data.job_id,
		status: 'queued',
		progress: 0,
		currentStep: 'En cola...',
	} as BorradorJob));
});

socketUtils.on('borrador:locked', (data: any) => {
	log('socket: borrador:locked', data);
	const lb = data.locked_by;
	borradorQueueStore.set({
		jobId: lb.jobId,
		status: 'locked',
		progress: lb.progress,
		currentStep: lb.currentStep,
		processed: 0,
		total: 0,
		lockedBy: lb,
	} as BorradorJob);
	toast.warning(`${lb.userName} está generando un borrador`, {
		description: 'Espera a que termine para evitar saturar el backend.',
		duration: 6000,
	});
});

socketUtils.on('borrador:start', (data: any) => {
	log('socket: borrador:start', data);
	borradorQueueStore.update((current) => ({
		...(current || {}),
		jobId: data.job_id,
		status: 'running',
		progress: 0,
		currentStep: 'Iniciando generación...',
		startedAt: data.started_at,
	} as BorradorJob));
});

socketUtils.on('borrador:progress', (data: any) => {
	log('socket: borrador:progress', data);
	borradorQueueStore.update((current) => {
		if (!current || current.jobId !== data.job_id) return current;
		return {
			...current,
			progress: data.progress,
			currentStep: data.current_step,
			processed: data.processed,
			total: data.total,
		};
	});
});

socketUtils.on('borrador:complete', (data: any) => {
	log('socket: borrador:complete', { job_id: data.job_id, duration_ms: data.duration_ms });
	borradorQueueStore.update((current) => {
		if (!current || current.jobId !== data.job_id) return current;
		return {
			...current,
			status: 'complete',
			progress: 100,
			currentStep: 'Completado',
			result: data.result,
			finishedAt: data.finished_at,
		};
	});
	toast.success('Borrador generado correctamente', {
		description: 'Redirigiendo al editor...',
		duration: 3000,
	});
	// Llamar solo los callbacks asociados a este jobId (o los genéricos con jobId null)
	for (const cb of completeCallbacks) {
		if (cb.jobId === null || cb.jobId === data.job_id) {
			try {
				cb.callback(data.result);
			} catch (e) {
				console.error('[borrador-queue] error en onComplete callback:', e);
			}
		}
	}
});

socketUtils.on('borrador:error', (data: any) => {
	log('socket: borrador:error', data);
	borradorQueueStore.update((current) => {
		if (!current || current.jobId !== data.job_id) return current;
		return {
			...current,
			status: 'error',
			error: data.error,
			currentStep: 'Error',
			finishedAt: data.finished_at,
		};
	});
	toast.error(`Error generando borrador: ${data.error}`);
});

socketUtils.on('borrador:cancelled', (data: any) => {
	log('socket: borrador:cancelled', data);
	borradorQueueStore.update((current) => {
		if (!current || current.jobId !== data.job_id) return current;
		return {
			...current,
			status: 'cancelled',
			currentStep: 'Cancelado',
		};
	});
});
