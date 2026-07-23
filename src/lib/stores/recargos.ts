// src/lib/stores/recargos.ts

import { writable, derived, get } from 'svelte/store';
import { recargosApi } from '$lib/api/recargos';
import type {
	CanvasRecargo,
	RecargoPlanilla,
	RecargoPlanillaFiltros,
	CrearRecargoPlanillaDTO,
	ActualizarRecargoPlanillaDTO
} from '$lib/types/recargos';
import { toast } from 'svelte-sonner';

interface RecargosState {
	eliminados: boolean | undefined;
	recargos: CanvasRecargo[];
	loading: boolean;
	error: string | null;
	filtros: RecargoPlanillaFiltros;
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
	selectedMes: number;
	selectedAño: number;
}

function createRecargosStore() {
	const initialState: RecargosState = {
		recargos: [],
		loading: false,
		error: null,
		filtros: {},
		pagination: {
			page: 1,
			// Cap máximo: el backend rechaza más de 200. Pedir más acá era el
			// origen de los requests de 7-23s.
			limit: 200,
			total: 0,
			totalPages: 0
		},
		eliminados: false,
		selectedMes: new Date().getMonth() + 1,
		selectedAño: new Date().getFullYear()
	};

	const { subscribe, set, update } = writable<RecargosState>(initialState);

	// Track del request en vuelo para cancelarlo cuando llega uno nuevo.
	// Sin esto, navegar de julio→enero con 6 clicks dispara 6 requests
	// secuenciales que llegan en orden inverso y compiten entre sí.
	let inflightController: AbortController | null = null;

	function isCanceledError(error: any): boolean {
		return (
			error?.name === 'CanceledError' ||
			error?.name === 'AbortError' ||
			error?.code === 'ERR_CANCELED'
		);
	}

	return {
		subscribe,

		/**
		 * Obtener recargos con filtros actuales.
		 * Aborta automáticamente cualquier fetch previo en vuelo.
		 */
		async fetchRecargos(filtrosCustom?: RecargoPlanillaFiltros) {
			// 1) Cancelar el fetch anterior (si lo hay)
			if (inflightController) {
				inflightController.abort();
			}
			const controller = new AbortController();
			inflightController = controller;

			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const state = get({ subscribe });
				const filtros = filtrosCustom || {
					...state.filtros,
					mes: state.selectedMes,
					año: state.selectedAño,
					page: state.pagination.page,
					limit: state.pagination.limit,
					eliminados: state.eliminados
				};

				const response = await recargosApi.obtenerParaCanvas(filtros, {
					signal: controller.signal
				});

				// Si entre tanto llegó otro fetch, descartamos silenciosamente
				if (controller.signal.aborted) return;

				update((s) => ({
					...s,
					recargos: response.data,
					pagination: response.pagination || s.pagination,
					loading: false
				}));
			} catch (error: any) {
				// Request cancelado a propósito → no es un error real
				if (isCanceledError(error)) return;

				const errorMsg = error.response?.data?.message || 'Error cargando recargos';
				update((s) => ({ ...s, error: errorMsg, loading: false }));
				toast.error(errorMsg);
			} finally {
				if (inflightController === controller) {
					inflightController = null;
				}
			}
		},

		/**
		 * Obtener recargos eliminados
		 */
		async fetchEliminados() {
			update((s) => ({ ...s, eliminados: true }));
			await this.fetchRecargos();
		},

		/**
		 * Obtener recargos activos
		 */
		async fetchActivos() {
			update((s) => ({ ...s, eliminados: false }));
			await this.fetchRecargos();
		},

		// En el store
		async setMesYAño(mes: number, año: number) {
			// Cambiar mes/año reinicia a la página 1 (el conteo cambia,
			// la página anterior puede no existir).
			update((s) => ({
				...s,
				selectedMes: mes,
				selectedAño: año,
				pagination: { ...s.pagination, page: 1 }
			}));
			await this.fetchRecargos(); // Solo 1 fetch
		},

		/**
		 * Cambiar la cantidad de items por página (50/100/200).
		 * Resetea a página 1.
		 */
		async setLimit(limit: number) {
			update((s) => ({
				...s,
				pagination: { ...s.pagination, limit, page: 1 }
			}));
			await this.fetchRecargos();
		},

		/**
		 * Cambiar la página actual.
		 */
		async setPage(page: number) {
			update((s) => ({
				...s,
				pagination: { ...s.pagination, page }
			}));
			await this.fetchRecargos();
		},

		/**
		 * Aplicar filtros
		 */
		async aplicarFiltros(filtros: RecargoPlanillaFiltros) {
			update((s) => ({ ...s, filtros, pagination: { ...s.pagination, page: 1 } }));
			await this.fetchRecargos();
		},

		/**
		 * Limpiar filtros
		 */
		async limpiarFiltros() {
			update((s) => ({ ...s, filtros: {} }));
			await this.fetchRecargos();
		},

		/**
		 * Cambiar página
		 */
		async cambiarPagina(page: number) {
			update((s) => ({ ...s, pagination: { ...s.pagination, page } }));
			await this.fetchRecargos();
		},

		/**
		 * Crear nuevo recargo
		 */
		async crearRecargo(data: CrearRecargoPlanillaDTO): Promise<RecargoPlanilla | null> {
			try {
				const recargo = await recargosApi.crear(data);
				toast.success('Recargo creado exitosamente');
				await this.fetchRecargos(); // Recargar lista
				return recargo;
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error creando recargo';
				toast.error(errorMsg);
				return null;
			}
		},

		/**
		 * Actualizar recargo
		 */
		async actualizarRecargo(
			id: string,
			data: ActualizarRecargoPlanillaDTO
		): Promise<RecargoPlanilla | null> {
			try {
				const recargo = await recargosApi.actualizar(id, data);
				toast.success('Recargo actualizado exitosamente');
				await this.fetchRecargos();
				return recargo;
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error actualizando recargo';
				toast.error(errorMsg);
				return null;
			}
		},

		/**
		 * Eliminar recargo
		 */
		async eliminarRecargo(id: string): Promise<boolean> {
			try {
				await recargosApi.eliminar(id);
				toast.success('Recargo eliminado exitosamente');
				await this.fetchRecargos();
				return true;
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error eliminando recargo';
				toast.error(errorMsg);
				return false;
			}
		},

		/**
		 * Liquidar recargo
		 */
		async liquidarRecargo(id: string): Promise<boolean> {
			try {
				await recargosApi.liquidar(id);
				toast.success('Recargo liquidado exitosamente');
				await this.fetchRecargos();
				return true;
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error liquidando recargo';
				toast.error(errorMsg);
				return false;
			}
		},

		/**
		 * Duplicar recargo
		 */
		async duplicarRecargo(id: string): Promise<RecargoPlanilla | null> {
			try {
				const recargo = await recargosApi.duplicar(id);
				toast.success('Recargo duplicado exitosamente');
				await this.fetchRecargos();
				return recargo;
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error duplicando recargo';
				toast.error(errorMsg);
				return null;
			}
		},

		/**
		 * Resetear store
		 */
		reset() {
			if (inflightController) {
				inflightController.abort();
				inflightController = null;
			}
			set(initialState);
		},

		/**
		 * Cancelar cualquier fetch en vuelo sin resetear el estado.
		 * Útil en onDestroy de las páginas para no leakear requests.
		 */
		abortInflight() {
			if (inflightController) {
				inflightController.abort();
				inflightController = null;
			}
		}
	};
}

export const recargosStore = createRecargosStore();

// Derived stores útiles
export const recargosActivos = derived(recargosStore, ($store) =>
	$store.recargos.filter((r) => r.estado !== 'cancelada')
);

export const recargosPendientes = derived(recargosStore, ($store) =>
	$store.recargos.filter((r) => r.estado === 'pendiente')
);

export const recargosLiquidadas = derived(recargosStore, ($store) =>
	$store.recargos.filter((r) => r.estado === 'liquidada')
);
