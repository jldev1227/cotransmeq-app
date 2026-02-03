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
			limit: 50,
			total: 0,
			totalPages: 0
		},
		selectedMes: new Date().getMonth() + 1,
		selectedAño: new Date().getFullYear()
	};

	const { subscribe, set, update } = writable<RecargosState>(initialState);

	return {
		subscribe,

		/**
		 * Obtener recargos con filtros actuales
		 */
		async fetchRecargos(filtrosCustom?: RecargoPlanillaFiltros) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const state = get({ subscribe });
				const filtros = filtrosCustom || {
					...state.filtros,
					mes: state.selectedMes,
					año: state.selectedAño,
					page: state.pagination.page,
					limit: state.pagination.limit
				};

				const response = await recargosApi.obtenerParaCanvas(filtros);

				update((s) => ({
					...s,
					recargos: response.data,
					pagination: response.pagination || s.pagination,
					loading: false
				}));
			} catch (error: any) {
				const errorMsg = error.response?.data?.message || 'Error cargando recargos';
				update((s) => ({ ...s, error: errorMsg, loading: false }));
				toast.error(errorMsg);
			}
		},

		/**
		 * Cambiar mes y recargar datos
		 */
		async setMes(mes: number) {
			update((s) => ({ ...s, selectedMes: mes }));
			await this.fetchRecargos();
		},

		/**
		 * Cambiar año y recargar datos
		 */
		async setAño(año: number) {
			update((s) => ({ ...s, selectedAño: año }));
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
			set(initialState);
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
