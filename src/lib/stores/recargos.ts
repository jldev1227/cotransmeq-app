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
	/**
	 * Agregaciones globales devueltas por el backend en cada `list`.
	 * Incluyen TODOS los recargos que matchean el filtro, NO solo la
	 * página actual (cap a `limit`). Se usan para los stat cards que
	 * necesitan un valor "all" en lugar de "página actual".
	 */
	meta: {
		/** Suma de `valor_calculado` de todos los detalles de las planillas que matchean el filtro. */
		total_valor_pagar: number;
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
		meta: {
			total_valor_pagar: 0
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

	// Watchdog: si `loading` queda en true más de 30s sin un request
	// en vuelo, forzar `loading: false`. Cubre el caso de un fetch que
	// se "cuelga" sin abortar (ej: el server se cae mid-response, o un
	// edge case donde el apiClient retry se queda atascado). Sin esto,
	// el usuario ve el spinner para siempre sin forma de salir.
	let loadingWatchdog: ReturnType<typeof setTimeout> | null = null;
	const LOADING_WATCHDOG_MS = 30_000;

	function armLoadingWatchdog() {
		disarmLoadingWatchdog();
		loadingWatchdog = setTimeout(() => {
			const curr = get({ subscribe });
			if (curr.loading && !inflightController) {
				console.warn(
					'[recargosStore] Watchdog: loading=true hace ' +
						LOADING_WATCHDOG_MS +
						'ms sin request en vuelo. Forzando loading=false.'
				);
				update((s) => ({
					...s,
					loading: false,
					error: 'La carga tardó demasiado. Reintentá.'
				}));
			}
		}, LOADING_WATCHDOG_MS);
	}

	function disarmLoadingWatchdog() {
		if (loadingWatchdog) {
			clearTimeout(loadingWatchdog);
			loadingWatchdog = null;
		}
	}

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
			armLoadingWatchdog();

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
					meta: response.meta
						? {
								total_valor_pagar: Number(response.meta.total_valor_pagar) || 0
							}
						: s.meta,
					loading: false
				}));
			} catch (error: any) {
				// Request cancelado a propósito → no es un error real
				if (isCanceledError(error)) return;

				const errorMsg = error.response?.data?.message || 'Error cargando recargos';
				update((s) => ({ ...s, error: errorMsg, loading: false }));
				toast.error(errorMsg);
			} finally {
				disarmLoadingWatchdog();
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
				const { recargo, valor_pagar } = await recargosApi.crear(data);
				// Inyectar el `valor_pagar` que ya viene calculado en la
				// respuesta HTTP. Así la columna "Valor a Pagar" del canvas
				// se pinta al instante, sin esperar al socket ni al re-fetch.
				valoresPagarByRecargoStore.set(recargo.id, valor_pagar);
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
				const { recargo, valor_pagar } = await recargosApi.actualizar(id, data);
				valoresPagarByRecargoStore.set(recargo.id, valor_pagar);
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
			disarmLoadingWatchdog();
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
			disarmLoadingWatchdog();
		}
	};
}

export const recargosStore = createRecargosStore();

/**
 * Mapa `recargoId → valor_pagar` (COP).
 *
 * Separado del store principal porque:
 *   1. El backend lo devuelve en la respuesta HTTP de create/update (y
 *      también en el payload de los sockets `recargo-creado` /
 *      `recargo-actualizado` / `recargo-recalculado`), no como parte
 *      del objeto recargo que devuelve `list` / `findById`. Tener un
 *      store dedicado evita tener que mergear el campo en cada recargo
 *      del array.
 *   2. El canvas de recargos (`/dashboard/recargos`) y el modal de
 *      edición lo actualizan desde dos lados: el preview endpoint
 *      (`obtenerPreviewValorRecargo`) y la respuesta del create/update.
 *      Centralizar acá evita race conditions entre ambos.
 *
 * Métodos:
 *   - `set(recargoId, valor)`   → asigna/sobrescribe
 *   - `unset(recargoId)`         → borra la entrada
 *   - `apply(map)`               → mergea un `Record<string, number>`
 *   - `clear()`                  → vacía todo (al cambiar de mes/año)
 *   - `get(recargoId)`           → lee el valor actual (snapshot, no
 *                                  reactivo — usar `$valoresPagarByRecargoStore[id]`
 *                                  en componentes)
 */
function createValoresPagarStore() {
	const { subscribe, set, update } = writable<Record<string, number>>({});
	return {
		subscribe,
		set(recargoId: string, valor: number) {
			update((m) => ({ ...m, [recargoId]: valor }));
		},
		unset(recargoId: string) {
			update((m) => {
				if (!(recargoId in m)) return m;
				const next = { ...m };
				delete next[recargoId];
				return next;
			});
		},
		apply(map: Record<string, number>) {
			update((m) => ({ ...m, ...map }));
		},
		clear() {
			set({});
		}
	};
}

export const valoresPagarByRecargoStore = createValoresPagarStore();

/**
 * Store del batch de recálculo bulk activo (single-active: solo puede
 * haber un bulk recalc a la vez por pestaña/usuario; si se intenta
 * lanzar otro, el `iniciar` rechaza).
 *
 * Persiste en `localStorage` la entrada mínima necesaria (batchId +
 * ids + total + startedAt) para que, si el usuario recarga la página
 * mientras el batch está corriendo, podamos:
 *   1. Re-consultar el estado al server con `GET /recalcular-bulk/:id`
 *   2. Reanudar la UI de progress y el pulse de filas.
 *
 * El estado completo (results, status, processed) NO se persiste: la
 * fuente de verdad es el server. Solo persistimos lo necesario para
 * re-conectarnos al batchId correcto.
 */
const BULK_RECALC_LS_KEY = 'recargos.bulkRecalc.v1';

export interface BulkRecalcState {
	batchId: string;
	ids: string[];
	total: number;
	processed: number;
	status: 'running' | 'completed' | 'failed';
	/** Ids que ya terminaron (para limpiar el pulse de fila). */
	completedIds: Set<string>;
	/** Ids que fallaron (para mostrar badge rojo al terminar). */
	failedIds: Set<string>;
	/** Timestamp del último progress event (para timeout de socket). */
	lastUpdateAt: number;
	startedAt: string;
}

function createBulkRecalcStore() {
	const initial: BulkRecalcState | null = null;
	const { subscribe, set, update } = writable<BulkRecalcState | null>(initial);

	// Cargar desde localStorage al instanciar (solo en el browser).
	if (typeof window !== 'undefined') {
		try {
			const raw = window.localStorage.getItem(BULK_RECALC_LS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed?.batchId) {
					// Reconstruir como 'running' (el server confirma al
					// consultar el status). Los sets se vacían porque
					// los ids completados los re-sincronizamos al
					// recibir el primer status del server.
					set({
						batchId: parsed.batchId,
						ids: Array.isArray(parsed.ids) ? parsed.ids : [],
						total: Number(parsed.total) || 0,
						processed: 0,
						status: 'running',
						completedIds: new Set(),
						failedIds: new Set(),
						lastUpdateAt: 0,
						startedAt: parsed.startedAt || new Date().toISOString()
					});
				}
			}
		} catch (e) {
			console.warn('[bulkRecalcStore] No se pudo leer localStorage:', e);
		}
	}

	function persistLocal(state: BulkRecalcState | null) {
		if (typeof window === 'undefined') return;
		try {
			if (!state) {
				window.localStorage.removeItem(BULK_RECALC_LS_KEY);
				return;
			}
			// Solo persistimos lo mínimo necesario para re-conectarnos
			// al batch. NO los sets ni el processed (esos los re-sync
			// del server al primer GET status).
			const minimal = {
				batchId: state.batchId,
				ids: state.ids,
				total: state.total,
				startedAt: state.startedAt
			};
			window.localStorage.setItem(BULK_RECALC_LS_KEY, JSON.stringify(minimal));
		} catch (e) {
			console.warn('[bulkRecalcStore] No se pudo escribir localStorage:', e);
		}
	}

	return {
		subscribe,
		/**
		 * Inicia un nuevo batch. Si ya hay uno activo, retorna `false`
		 * para que la UI no dispare otro request.
		 *
		 * Acepta un `batchId` tentativo (`'__pending__'`) que se
		 * reemplazará con el real cuando llegue del server vía
		 * `setBatchId()`. Esto es necesario para que la UI pueda
		 * mostrar el estado "iniciando..." antes de que el HTTP
		 * responda con el batchId real.
		 */
		iniciar(batchId: string, ids: string[]): boolean {
			let started = false;
			update((curr) => {
				if (curr && curr.status === 'running') return curr; // ya hay uno
				started = true;
				return {
					batchId,
					ids,
					total: ids.length,
					processed: 0,
					status: 'running',
					completedIds: new Set(),
					failedIds: new Set(),
					lastUpdateAt: Date.now(),
					startedAt: new Date().toISOString()
				};
			});
			if (started) {
				update((s) => {
					persistLocal(s);
					return s;
				});
			}
			return started;
		},
		/**
		 * Reemplaza el `batchId` actual por el real que devolvió el
		 * server. Usado después del POST inicial: el flujo es
		 *   1. `iniciar('__pending__', ids)` → muestra el spinner
		 *   2. POST /recalcular-bulk → `{ batchId, total }`
		 *   3. `setBatchId(batchId)` → a partir de acá los progress
		 *      events matchean y se aplican
		 *
		 * Solo aplica si el batch está `running` y el batchId actual
		 * es el tentativo (`'__pending__'` o cualquier otro). Si ya
		 * hay un batchId real, lo deja (no pisamos uno en curso).
		 */
		setBatchId(realBatchId: string): boolean {
			let updated = false;
			update((curr) => {
				if (!curr || curr.status !== 'running') return curr;
				if (curr.batchId === realBatchId) return curr; // ya coincide
				const next: BulkRecalcState = {
					...curr,
					batchId: realBatchId,
					lastUpdateAt: Date.now()
				};
				updated = true;
				return next;
			});
			if (updated) {
				update((s) => {
					persistLocal(s);
					return s;
				});
			}
			return updated;
		},
		/**
		 * Aplica un progress event del server. Marca el id actual como
		 * completado o fallido y actualiza el contador.
		 */
		aplicarProgress(payload: {
			batchId: string;
			processed: number;
			total: number;
			currentId: string;
			ok: boolean;
		}) {
			update((curr) => {
				if (!curr || curr.batchId !== payload.batchId) return curr;
				const completedIds = new Set(curr.completedIds);
				const failedIds = new Set(curr.failedIds);
				if (payload.ok) {
					completedIds.add(payload.currentId);
					failedIds.delete(payload.currentId);
				} else {
					failedIds.add(payload.currentId);
					completedIds.delete(payload.currentId);
				}
				const next: BulkRecalcState = {
					...curr,
					processed: payload.processed,
					total: payload.total,
					completedIds,
					failedIds,
					lastUpdateAt: Date.now()
				};
				return next;
			});
		},
		/**
		 * Aplica el done event del server. Marca el batch como
		 * `completed` o `failed` y limpia el localStorage (el batch ya
		 * terminó; no hay nada que reanudar).
		 */
		aplicarDone(payload: { batchId: string; status: 'completed' | 'failed' }) {
			update((curr) => {
				if (!curr || curr.batchId !== payload.batchId) return curr;
				const next: BulkRecalcState = {
					...curr,
					status: payload.status,
					processed: curr.total,
					lastUpdateAt: Date.now()
				};
				// No limpiamos el localStorage aún: el `limpiar()` lo
				// hace el componente después de mostrar el toast.
				return next;
			});
		},
		/**
		 * Re-sincroniza el estado desde el server (usado al recargar
		 * la página). Marca ids completados/fallidos según el `results`
		 * que devuelve el server.
		 */
		hidratarDesdeStatus(payload: {
			batchId: string;
			status: 'pending' | 'running' | 'completed' | 'failed';
			processed: number;
			total: number;
			results: Array<{ id: string; ok: boolean }>;
		}) {
			update((curr) => {
				if (!curr || curr.batchId !== payload.batchId) return curr;
				const completedIds = new Set<string>();
				const failedIds = new Set<string>();
				for (const r of payload.results) {
					if (r.ok) completedIds.add(r.id);
					else failedIds.add(r.id);
				}
				return {
					...curr,
					status: payload.status === 'pending' ? 'running' : payload.status,
					processed: payload.processed,
					total: payload.total,
					completedIds,
					failedIds,
					lastUpdateAt: Date.now()
				};
			});
		},
		/**
		 * Marca el batch como perdido por timeout de socket. El
		 * procesamiento en el server continúa; el usuario puede
		 * re-consultar el status manualmente si quiere.
		 */
		marcarConexionPerdida() {
			update((curr) => {
				if (!curr || curr.status !== 'running') return curr;
				return { ...curr, status: 'failed' };
			});
		},
		/**
		 * Limpia el store y el localStorage. Llamado por el componente
		 * después de mostrar el toast final (éxito, fallo o cancelación).
		 */
		limpiar() {
			set(null);
			persistLocal(null);
		},
		/**
		 * Solo limpia el state en memoria (mantiene localStorage).
		 * Útil cuando el componente se destruye y queremos que el
		 * siguiente mount rehidrate.
		 */
		resetMemoria() {
			set(null);
		}
	};
}

export const bulkRecalcStore = createBulkRecalcStore();

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
