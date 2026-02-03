import { writable, derived } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';

/**
 * Store para manejar ubicaciones frecuentes (pozos, campamentos, etc.)
 * Este es un store preparatorio para una futura implementación completa
 * con backend y base de datos.
 */

export interface UbicacionFrecuente {
	id: string;
	nombre: string;
	tipo: 'pozo' | 'campamento' | 'planta' | 'oficina' | 'otro';
	direccion: string;
	latitud: number;
	longitud: number;
	municipio_id?: string;
	cliente_id?: string;
	uso_count: number;
	ultima_vez_usada?: string;
	activo: boolean;
	created_at?: string;
	updated_at?: string;
}

interface UbicacionesState {
	ubicaciones: UbicacionFrecuente[];
	loading: boolean;
	error: string | null;
	lastFetch: Date | null;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

function createUbicacionesStore() {
	const { subscribe, set, update } = writable<UbicacionesState>({
		ubicaciones: [],
		loading: false,
		error: null,
		lastFetch: null
	});

	return {
		subscribe,

		/**
		 * Cargar todas las ubicaciones frecuentes
		 * TODO: Implementar endpoint en el backend
		 */
		async cargarTodas(force = false) {
			const state = await new Promise<UbicacionesState>((resolve) => {
				const unsubscribe = subscribe((s) => {
					resolve(s);
					unsubscribe();
				});
			});

			// Check cache
			if (!force && state.lastFetch && Date.now() - state.lastFetch.getTime() < CACHE_DURATION) {
				return;
			}

			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// TODO: Descomentar cuando el endpoint esté listo
				// const response = await apiClient.get('/ubicaciones-frecuentes');
				// const ubicaciones = response.data;

				// Datos de prueba mientras se implementa el backend
				const ubicaciones: UbicacionFrecuente[] = [];

				update((state) => ({
					...state,
					ubicaciones,
					loading: false,
					lastFetch: new Date()
				}));
			} catch (error: any) {
				console.error('Error al cargar ubicaciones frecuentes:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.message || 'Error al cargar ubicaciones frecuentes'
				}));
			}
		},

		/**
		 * Buscar ubicaciones por nombre o tipo
		 * TODO: Implementar búsqueda en el backend
		 */
		async buscar(query: string) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// TODO: Descomentar cuando el endpoint esté listo
				// const response = await apiClient.get('/ubicaciones-frecuentes/buscar', {
				// 	params: { q: query }
				// });
				// return response.data;

				// Datos de prueba
				return [];
			} catch (error: any) {
				console.error('Error al buscar ubicaciones:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.message || 'Error al buscar ubicaciones'
				}));
				return [];
			}
		},

		/**
		 * Crear nueva ubicación frecuente
		 * TODO: Implementar endpoint en el backend
		 */
		async crear(
			ubicacion: Omit<UbicacionFrecuente, 'id' | 'uso_count' | 'created_at' | 'updated_at'>
		) {
			try {
				// TODO: Descomentar cuando el endpoint esté listo
				// const response = await apiClient.post('/ubicaciones-frecuentes', ubicacion);
				// const nuevaUbicacion = response.data;

				// update((state) => ({
				// 	...state,
				// 	ubicaciones: [...state.ubicaciones, nuevaUbicacion]
				// }));

				// return nuevaUbicacion;
				return null;
			} catch (error: any) {
				console.error('Error al crear ubicación:', error);
				throw error;
			}
		},

		/**
		 * Incrementar contador de uso de una ubicación
		 * TODO: Implementar endpoint en el backend
		 */
		async incrementarUso(ubicacionId: string) {
			try {
				// TODO: Descomentar cuando el endpoint esté listo
				// await apiClient.patch(`/ubicaciones-frecuentes/${ubicacionId}/incrementar-uso`);

				update((state) => ({
					...state,
					ubicaciones: state.ubicaciones.map((u) =>
						u.id === ubicacionId
							? { ...u, uso_count: u.uso_count + 1, ultima_vez_usada: new Date().toISOString() }
							: u
					)
				}));
			} catch (error: any) {
				console.error('Error al incrementar uso:', error);
			}
		},

		/**
		 * Limpiar el store
		 */
		clear() {
			set({
				ubicaciones: [],
				loading: false,
				error: null,
				lastFetch: null
			});
		}
	};
}

export const ubicacionesFrecuentes = createUbicacionesStore();

/**
 * Store derivado con ubicaciones ordenadas por uso
 */
export const ubicacionesMasFrecuentes = derived(ubicacionesFrecuentes, ($ubicaciones) => {
	return [...$ubicaciones.ubicaciones]
		.filter((u) => u.activo)
		.sort((a, b) => b.uso_count - a.uso_count)
		.slice(0, 10);
});

/**
 * Store derivado con opciones para select
 */
export const ubicacionesOptions = derived(ubicacionesFrecuentes, ($ubicaciones) => {
	return $ubicaciones.ubicaciones
		.filter((u) => u.activo)
		.map((u) => ({
			value: u.id,
			label: `${u.nombre} (${u.tipo})`,
			group: u.tipo
		}));
});

/**
 * Store derivado con ubicaciones por tipo
 */
export const ubicacionesPorTipo = derived(ubicacionesFrecuentes, ($ubicaciones) => {
	return $ubicaciones.ubicaciones
		.filter((u) => u.activo)
		.reduce(
			(acc, ubicacion) => {
				if (!acc[ubicacion.tipo]) {
					acc[ubicacion.tipo] = [];
				}
				acc[ubicacion.tipo].push(ubicacion);
				return acc;
			},
			{} as Record<string, UbicacionFrecuente[]>
		);
});
