import { writable } from 'svelte/store';
import type { FormularioAsistencia } from '$lib/api/asistencias';

export type FormularioStatus = 'created' | 'updated' | 'disabled' | null;

export interface FormularioWithStatus extends FormularioAsistencia {
	_status?: FormularioStatus;
	_statusTimestamp?: number;
	_newResponsesCount?: number; // Nueva propiedad para contar respuestas nuevas
}

function createAsistenciasStore() {
	const { subscribe, set, update } = writable<FormularioWithStatus[]>([]);

	// Tiempo que dura el indicador visual (5 segundos)
	const STATUS_DURATION = 5000;
	const NEW_RESPONSE_BADGE_DURATION = 10000; // 10 segundos para el badge de nueva respuesta

	function addFormulario(formulario: FormularioAsistencia, status: FormularioStatus) {
		console.log('🏪 [Store] addFormulario called:', { formulario, status });
		update((formularios) => {
			const withStatus: FormularioWithStatus = {
				...formulario,
				_status: status,
				_statusTimestamp: Date.now()
			};

			// Agregar al principio del array
			const newFormularios = [withStatus, ...formularios];
			console.log('🏪 [Store] Formulario agregado. Total formularios:', newFormularios.length);

			// Limpiar el status después de 5 segundos
			setTimeout(() => {
				clearStatus(formulario.id);
			}, STATUS_DURATION);

			return newFormularios;
		});
	}

	function updateFormulario(formulario: FormularioAsistencia, status: FormularioStatus) {
		console.log('🏪 [Store] updateFormulario called:', { formularioId: formulario.id, status });
		update((formularios) => {
			const index = formularios.findIndex((f) => f.id === formulario.id);

			if (index !== -1) {
				formularios[index] = {
					...formulario,
					_status: status,
					_statusTimestamp: Date.now()
				};

				// Limpiar el status después de 5 segundos
				setTimeout(() => {
					clearStatus(formulario.id);
				}, STATUS_DURATION);

				return [...formularios];
			}

			return formularios;
		});
	}

	function clearStatus(formularioId: string) {
		update((formularios) => {
			const formulario = formularios.find((f) => f.id === formularioId);
			if (formulario) {
				delete formulario._status;
				delete formulario._statusTimestamp;
			}
			return [...formularios];
		});
	}

	function incrementResponseCount(formularioId: string) {
		update((formularios) => {
			const index = formularios.findIndex((f) => f.id === formularioId);

			if (index !== -1) {
				const formulario = formularios[index];

				// Incrementar contador de respuestas
				if (formulario._count) {
					formulario._count.respuestas = (formulario._count.respuestas || 0) + 1;
				}

				// Incrementar badge de nuevas respuestas
				formulario._newResponsesCount = (formulario._newResponsesCount || 0) + 1;

				// Limpiar el badge después de 10 segundos
				setTimeout(() => {
					clearNewResponsesBadge(formularioId);
				}, NEW_RESPONSE_BADGE_DURATION);

				return [...formularios];
			}

			return formularios;
		});
	}

	function clearNewResponsesBadge(formularioId: string) {
		update((formularios) => {
			const formulario = formularios.find((f) => f.id === formularioId);
			if (formulario) {
				delete formulario._newResponsesCount;
			}
			return [...formularios];
		});
	}

	return {
		subscribe,
		set,
		update,
		addFormulario,
		updateFormulario,
		clearStatus,
		incrementResponseCount,
		clearNewResponsesBadge
	};
}

export const asistenciasStore = createAsistenciasStore();
