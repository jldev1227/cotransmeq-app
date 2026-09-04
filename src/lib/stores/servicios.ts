import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore } from './auth';
import { socketUtils } from '$lib/socket';
import type {
	ServicioConRelaciones,
	CreateServicioDTO,
	UpdateServicioDTO,
	Municipio,
	Conductor,
	Vehiculo,
	Cliente,
	ServiciosStats,
	PaginationMeta,
	BuscarServiciosParams,
	EstadoServicio
} from '$lib/types/servicios';

// ==================== ESTADO DEL STORE ====================

export interface ServiciosState {
	servicios: ServicioConRelaciones[];
	servicioSeleccionado: ServicioConRelaciones | null;
	municipios: Municipio[];
	conductores: Conductor[];
	vehiculos: Vehiculo[];
	empresas: Cliente[];
	stats: ServiciosStats | null;
	pagination: PaginationMeta;
	loading: boolean;
	error: string | null;
	cacheTimestamp: number | null;
	isInitialized: boolean;
}

const initialState: ServiciosState = {
	servicios: [],
	servicioSeleccionado: null,
	municipios: [],
	conductores: [],
	vehiculos: [],
	empresas: [],
	stats: null,
	pagination: {
		page: 1,
		limit: 20,
		total: 0,
		totalPages: 0,
		count: 0
	},
	loading: false,
	error: null,
	cacheTimestamp: null,
	isInitialized: false
};

// Tiempo de expiración del caché (5 minutos)
const CACHE_DURATION = 5 * 60 * 1000;

// ==================== STORE PRINCIPAL ====================

function createServiciosStore() {
	const { subscribe, set, update } = writable<ServiciosState>(initialState);

	/// Funciones de baja de los listeners de socket, en el orden en que se
	/// dieron de alta. Guardarlas es lo que permite quitar EXACTAMENTE los
	/// nuestros: `socketUtils.off('evento')` sin handler se llevaba por
	/// delante los de cualquier otro módulo suscrito al mismo evento.
	let bajasSocket: Array<() => void> = [];

	return {
		subscribe,

		// ==================== MÉTODOS CRUD ====================

		// Obtener servicios con paginación y filtros
		async obtenerServicios(params?: BuscarServiciosParams, forceRefresh = false): Promise<void> {
			// SIEMPRE hacer el request cuando cambian los parámetros (incluyendo la página)
			// El caché no debe bloquear las peticiones con diferentes parámetros

			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/servicios', { params });

				if (response.data.success) {
					update((state) => ({
						...state,
						servicios: response.data.data || [],
						stats: response.data.stats || state.stats, // Actualizar stats desde la respuesta
						pagination: response.data.pagination || state.pagination,
						loading: false,
						cacheTimestamp: Date.now(),
						isInitialized: true
					}));
				} else {
					throw new Error(response.data.message || 'Error al obtener servicios');
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo servicios:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al cargar servicios'
				}));
			}
		},

		// Obtener estadísticas de servicios
		async obtenerStats(): Promise<void> {
			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/servicios/stats');

				if (response.data.success) {
					update((state) => ({
						...state,
						stats: response.data.data
					}));
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo estadísticas:', error);
			}
		},

		// Obtener un servicio específico por ID
		async obtenerServicio(id: string): Promise<ServicioConRelaciones | null> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get(`/api/servicios/${id}`);

				if (response.data.success) {
					const servicio = response.data.data;
					update((state) => ({
						...state,
						servicioSeleccionado: servicio,
						loading: false
					}));
					return servicio;
				} else {
					throw new Error(response.data.message || 'Error al obtener el servicio');
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo servicio:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al cargar el servicio'
				}));
				return null;
			}
		},

		// Crear un nuevo servicio
		async crearServicio(datos: CreateServicioDTO): Promise<ServicioConRelaciones | null> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.post('/api/servicios', datos);

				if (response.data.success) {
					const nuevoServicio = response.data.data;

					// Agregar a la lista local
					update((state) => ({
						...state,
						servicios: [nuevoServicio, ...state.servicios],
						loading: false
					}));

					return nuevoServicio;
				} else {
					throw new Error(response.data.message || 'Error al crear el servicio');
				}
			} catch (error: any) {
				console.error('❌ Error creando servicio:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al crear el servicio'
				}));
				return null;
			}
		},

		// Actualizar un servicio existente
		async actualizarServicio(
			id: string,
			datos: UpdateServicioDTO
		): Promise<ServicioConRelaciones | null> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.put(`/api/servicios/${id}`, datos);

				if (response.data.success) {
					const servicioActualizado = response.data.data;

					// Actualizar en la lista local
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === id ? servicioActualizado : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === id
								? servicioActualizado
								: state.servicioSeleccionado,
						loading: false
					}));

					return servicioActualizado;
				} else {
					throw new Error(response.data.message || 'Error al actualizar el servicio');
				}
			} catch (error: any) {
				console.error('❌ Error actualizando servicio:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al actualizar el servicio'
				}));
				return null;
			}
		},

		// Actualizar estado de un servicio
		async actualizarEstado(id: string, estado: EstadoServicio): Promise<boolean> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.patch(`/api/servicios/${id}/estado`, { estado });

				if (response.data.success) {
					const servicioActualizado = response.data.data;

					// Actualizar en la lista local
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === id ? servicioActualizado : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === id
								? servicioActualizado
								: state.servicioSeleccionado,
						loading: false
					}));

					return true;
				} else {
					throw new Error(response.data.message || 'Error al actualizar el estado');
				}
			} catch (error: any) {
				console.error('❌ Error actualizando estado:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al actualizar el estado'
				}));
				return false;
			}
		},

		// Eliminar un servicio
		async eliminar(id: string): Promise<boolean> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.delete(`/api/servicios/${id}`);

				if (response.data.success) {
					// Remover de la lista local
					update((state) => ({
						...state,
						servicios: state.servicios.filter((s) => s.id !== id),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === id ? null : state.servicioSeleccionado,
						loading: false
					}));

					return true;
				} else {
					throw new Error(response.data.message || 'Error al eliminar el servicio');
				}
			} catch (error: any) {
				console.error('❌ Error eliminando servicio:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al eliminar el servicio'
				}));
				return false;
			}
		},

		// Asignar planilla a un servicio
		async asignarPlanilla(id: string, numeroPlanilla: string): Promise<boolean> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.patch(`/api/servicios/${id}/planilla`, {
					numero_planilla: numeroPlanilla
				});

				if (response.data.success) {
					const servicioActualizado = response.data.data;

					// Actualizar en la lista local
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === id ? servicioActualizado : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === id
								? servicioActualizado
								: state.servicioSeleccionado,
						loading: false
					}));

					return true;
				} else {
					throw new Error(response.data.message || 'Error al asignar planilla');
				}
			} catch (error: any) {
				console.error('❌ Error asignando planilla:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al asignar planilla'
				}));
				return false;
			}
		},

		// Generar token de compartir público
		async generarShareToken(id: string): Promise<string | null> {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const { serviciosAPI } = await import('$lib/api/apiClient');

				const response = await serviciosAPI.generateShareToken(id);

				if (response.data.success) {
					const token = response.data.data.share_token;

					// Actualizar servicio en la lista local
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === id ? { ...s, share_token: token } : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === id
								? { ...state.servicioSeleccionado, share_token: token }
								: state.servicioSeleccionado,
						loading: false
					}));

					return token;
				} else {
					throw new Error(response.data.message || 'Error al generar token');
				}
			} catch (error: any) {
				console.error('❌ Error generando token de compartir:', error);
				update((state) => ({
					...state,
					loading: false,
					error: error.response?.data?.message || error.message || 'Error al generar token'
				}));
				return null;
			}
		},

		// ==================== CATÁLOGOS ====================

		// Obtener municipios
		async obtenerMunicipios(): Promise<void> {
			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/municipios');

				if (response.data.success) {
					update((state) => ({
						...state,
						municipios: response.data.data || []
					}));
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo municipios:', error);
			}
		},

		// Obtener conductores
		async obtenerConductores(): Promise<void> {
			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/conductores/basicos');

				if (response.data.success) {
					update((state) => ({
						...state,
						conductores: response.data.data || []
					}));
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo conductores:', error);
			}
		},

		// Obtener vehículos
		async obtenerVehiculos(): Promise<void> {
			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/flota/basicos');

				if (response.data.success) {
					update((state) => ({
						...state,
						vehiculos: response.data.data || []
					}));
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo vehículos:', error);
			}
		},

		// Obtener empresas
		async obtenerEmpresas(): Promise<void> {
			try {
				const { apiClient } = await import('$lib/api/apiClient');

				const response = await apiClient.get('/api/empresas/basicos');

				if (response.data.success) {
					update((state) => ({
						...state,
						empresas: response.data.data || []
					}));
				}
			} catch (error: any) {
				console.error('❌ Error obteniendo empresas:', error);
			}
		},

		// ==================== UTILIDADES ====================

		// Seleccionar un servicio
		seleccionarServicio(servicio: ServicioConRelaciones | null): void {
			update((state) => ({
				...state,
				servicioSeleccionado: servicio
			}));
		},

		// Limpiar selección
		limpiarSeleccion(): void {
			update((state) => ({
				...state,
				servicioSeleccionado: null
			}));
		},

		// Cambiar página
		cambiarPagina(page: number): void {
			update((state) => ({
				...state,
				pagination: { ...state.pagination, page }
			}));
		},

		// Cambiar límite
		cambiarLimite(limit: number): void {
			update((state) => ({
				...state,
				pagination: { ...state.pagination, limit, page: 1 }
			}));
		},

		// Limpiar error
		limpiarError(): void {
			update((state) => ({
				...state,
				error: null
			}));
		},

		// ==================== SOCKET.IO ====================

		// Configurar listeners de Socket.IO para actualizaciones en tiempo real
		configurarSocket(): void {
			if (!browser) return;

			/// Idempotente: sin esto, dos llamadas seguidas (una navegación de
			/// ida y vuelta, por ejemplo) dejaban los listeners duplicados y
			/// cada evento aplicaba el parche dos veces.
			this.limpiarSocket();

			// Servicio creado
			bajasSocket.push(socketUtils.on('servicio:creado', (data: ServicioConRelaciones) => {
				update((state) => ({
					...state,
					servicios: [data, ...state.servicios],
					cacheTimestamp: Date.now() // Actualizar timestamp del caché
				}));
			}));

			// Servicio actualizado
			bajasSocket.push(socketUtils.on('servicio:actualizado', (data: ServicioConRelaciones) => {
				update((state) => ({
					...state,
					servicios: state.servicios.map((s) => (s.id === data.id ? data : s)),
					servicioSeleccionado:
						state.servicioSeleccionado?.id === data.id ? data : state.servicioSeleccionado,
					cacheTimestamp: Date.now() // Actualizar timestamp del caché
				}));
			}));

			// Estado actualizado
			bajasSocket.push(socketUtils.on(
				'servicio:estado-actualizado',
				(data: { servicio: ServicioConRelaciones; estadoAnterior: EstadoServicio }) => {
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === data.servicio.id ? data.servicio : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === data.servicio.id
								? data.servicio
								: state.servicioSeleccionado,
						cacheTimestamp: Date.now() // Actualizar timestamp del caché
					}));
				}
			));

			// Planilla asignada
			bajasSocket.push(socketUtils.on(
				'servicio:numero-planilla-actualizado',
				(data: { id: string; servicio: ServicioConRelaciones }) => {
					update((state) => ({
						...state,
						servicios: state.servicios.map((s) => (s.id === data.id ? data.servicio : s)),
						servicioSeleccionado:
							state.servicioSeleccionado?.id === data.id
								? data.servicio
								: state.servicioSeleccionado,
						cacheTimestamp: Date.now() // Actualizar timestamp del caché
					}));
				}
			));

			// Servicio cancelado
			bajasSocket.push(socketUtils.on('servicio:cancelado', (data: ServicioConRelaciones) => {
				update((state) => ({
					...state,
					servicios: state.servicios.filter((s) => s.id !== data.id),
					cacheTimestamp: Date.now() // Actualizar timestamp del caché
				}));
			}));

			// Servicio eliminado
			bajasSocket.push(socketUtils.on('servicio:eliminado', (data: { id: string }) => {
				update((state) => ({
					...state,
					servicios: state.servicios.filter((s) => s.id !== data.id),
					servicioSeleccionado:
						state.servicioSeleccionado?.id === data.id ? null : state.servicioSeleccionado,
					cacheTimestamp: Date.now() // Actualizar timestamp del caché
				}));
			}));
		},

		// Limpiar listeners de Socket.IO
		limpiarSocket(): void {
			if (!browser) return;

			/// Se ejecutan las bajas guardadas al suscribir, que quitan
			/// exactamente nuestros listeners. Antes esto llamaba a
			/// `socketUtils.off('evento')` sin handler, lo que daba de baja
			/// también los de cualquier otro módulo suscrito al mismo evento.
			for (const baja of bajasSocket) baja();
			bajasSocket = [];
		},

		// ==================== INICIALIZACIÓN ====================

		// Inicializar el store (solo configura socket, NO carga datos)
		async inicializar(forceRefresh = false): Promise<void> {
			const state = get({ subscribe });
			const authState = get(authStore);

			if (!authState.user) return;

			// Si ya está inicializado y no es forzado, no reinicializar
			if (!forceRefresh && state.isInitialized) {
				return;
			}

			// Configurar Socket.IO solo si no está configurado
			if (!state.isInitialized) {
				this.configurarSocket();
			}

			// Marcar como inicializado
			update((state) => ({ ...state, isInitialized: true }));
		},

		// Limpiar caché y forzar recarga
		invalidarCache(): void {
			update((state) => ({
				...state,
				cacheTimestamp: null
			}));
		}
	};
}

// ==================== EXPORTAR STORE ====================

export const serviciosStore = createServiciosStore();

// ==================== STORES DERIVADOS ====================

// Servicios filtrados por estado
export const serviciosPorEstado = derived(serviciosStore, ($servicios) => {
	const porEstado: Record<EstadoServicio, ServicioConRelaciones[]> = {
		solicitado: [],
		en_curso: [],
		planificado: [],
		realizado: [],
		cancelado: [],
		liquidado: [],
		planilla_asignada: []
	};

	$servicios.servicios.forEach((servicio) => {
		if (porEstado[servicio.estado]) {
			porEstado[servicio.estado].push(servicio);
		}
	});

	return porEstado;
});

// Total de servicios
export const totalServicios = derived(serviciosStore, ($servicios) => {
	return $servicios.servicios.length;
});

// ¿Hay servicios cargando?
export const cargandoServicios = derived(serviciosStore, ($servicios) => {
	return $servicios.loading;
});
