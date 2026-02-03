import { writable } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';
import type { ServicioConRelaciones } from '$lib/types/servicios';

interface ServicioDetalleState {
	servicio: ServicioConRelaciones | null;
	loading: boolean;
	error: string | null;
}

function createServicioDetalleStore() {
	const { subscribe, set, update } = writable<ServicioDetalleState>({
		servicio: null,
		loading: false,
		error: null
	});

	return {
		subscribe,

		// Obtener un servicio por ID
		async obtenerServicio(id: string) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const response = await apiClient.get(`/api/servicios/${id}`);
				const servicio = response.data?.data || response.data; // Manejar ambos formatos

				// Si el servicio está vacío o es null
				if (!servicio || (typeof servicio === 'object' && Object.keys(servicio).length === 0)) {
					update((state) => ({
						...state,
						servicio: null,
						loading: false,
						error: 'Servicio no encontrado'
					}));
					return null;
				}

				update((state) => ({
					...state,
					servicio,
					loading: false,
					error: null
				}));

				return servicio;
			} catch (error: any) {
				const errorMessage = error?.response?.data?.message || 'Error al cargar el servicio';
				update((state) => ({
					...state,
					servicio: null,
					loading: false,
					error: errorMessage
				}));
				throw error;
			}
		},

		// Limpiar el store
		limpiar() {
			set({
				servicio: null,
				loading: false,
				error: null
			});
		},

		// Resetear solo el error
		limpiarError() {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const servicioDetalleStore = createServicioDetalleStore();
