import { writable, derived } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';

// Tipos
interface Conductor {
	id: string;
	nombre: string;
	apellido: string;
	numero_identificacion?: string;
}

interface Vehiculo {
	id: string;
	placa: string;
	marca?: string;
	modelo?: string;
	linea?: string;
}

interface Cliente {
	id: string;
	nombre: string;
	nit?: string;
}

interface Municipio {
	id: string;
	codigo_municipio: number;
	nombre_municipio: string;
	nombre_departamento: string;
}

interface RecursosState {
	conductores: Conductor[];
	vehiculos: Vehiculo[];
	clientes: Cliente[];
	municipios: Municipio[];
	loading: {
		conductores: boolean;
		vehiculos: boolean;
		clientes: boolean;
		municipios: boolean;
	};
	error: {
		conductores: string | null;
		vehiculos: string | null;
		clientes: string | null;
		municipios: string | null;
	};
	lastFetch: {
		conductores: number | null;
		vehiculos: number | null;
		clientes: number | null;
		municipios: number | null;
	};
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Estado inicial
const initialState: RecursosState = {
	conductores: [],
	vehiculos: [],
	clientes: [],
	municipios: [],
	loading: {
		conductores: false,
		vehiculos: false,
		clientes: false,
		municipios: false
	},
	error: {
		conductores: null,
		vehiculos: null,
		clientes: null,
		municipios: null
	},
	lastFetch: {
		conductores: null,
		vehiculos: null,
		clientes: null,
		municipios: null
	}
};

// Store principal
const recursosStore = writable<RecursosState>(initialState);

// Función auxiliar para verificar si el cache es válido
function isCacheValid(lastFetch: number | null): boolean {
	if (!lastFetch) return false;
	return Date.now() - lastFetch < CACHE_DURATION;
}

// Acciones del store
export const recursos = {
	subscribe: recursosStore.subscribe,

	// Cargar conductores
	async cargarConductores(force = false) {
		const currentState = await new Promise<RecursosState>((resolve) => {
			recursosStore.subscribe((state) => resolve(state))();
		});

		// Si no es forzado y el cache es válido, no recargar
		if (!force && isCacheValid(currentState.lastFetch.conductores)) {
			console.log('✅ Conductores en cache, usando datos existentes');
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, conductores: true },
			error: { ...state.error, conductores: null }
		}));

		try {
			console.log('🔄 Cargando conductores desde API...');
			const response = await apiClient.get('/api/servicios/filtros/conductores');

			// Extraer datos de la respuesta
			let conductoresData: Conductor[] = [];
			if (Array.isArray(response.data)) {
				conductoresData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				conductoresData = response.data.data;
			}

			console.log('✅ Conductores cargados:', conductoresData.length);

			recursosStore.update((state) => ({
				...state,
				conductores: conductoresData,
				loading: { ...state.loading, conductores: false },
				lastFetch: { ...state.lastFetch, conductores: Date.now() }
			}));
		} catch (error) {
			console.error('❌ Error cargando conductores:', error);
			recursosStore.update((state) => ({
				...state,
				loading: { ...state.loading, conductores: false },
				error: {
					...state.error,
					conductores: error instanceof Error ? error.message : 'Error desconocido'
				}
			}));
		}
	},

	// Cargar vehículos
	async cargarVehiculos(force = false) {
		const currentState = await new Promise<RecursosState>((resolve) => {
			recursosStore.subscribe((state) => resolve(state))();
		});

		if (!force && isCacheValid(currentState.lastFetch.vehiculos)) {
			console.log('✅ Vehículos en cache, usando datos existentes');
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, vehiculos: true },
			error: { ...state.error, vehiculos: null }
		}));

		try {
			console.log('🔄 Cargando vehículos desde API...');
			const response = await apiClient.get('/api/servicios/filtros/vehiculos');

			let vehiculosData: Vehiculo[] = [];
			if (Array.isArray(response.data)) {
				vehiculosData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				vehiculosData = response.data.data;
			}

			console.log('✅ Vehículos cargados:', vehiculosData.length);

			recursosStore.update((state) => ({
				...state,
				vehiculos: vehiculosData,
				loading: { ...state.loading, vehiculos: false },
				lastFetch: { ...state.lastFetch, vehiculos: Date.now() }
			}));
		} catch (error) {
			console.error('❌ Error cargando vehículos:', error);
			recursosStore.update((state) => ({
				...state,
				loading: { ...state.loading, vehiculos: false },
				error: {
					...state.error,
					vehiculos: error instanceof Error ? error.message : 'Error desconocido'
				}
			}));
		}
	},

	// Cargar clientes
	async cargarClientes(force = false) {
		const currentState = await new Promise<RecursosState>((resolve) => {
			recursosStore.subscribe((state) => resolve(state))();
		});

		if (!force && isCacheValid(currentState.lastFetch.clientes)) {
			console.log('✅ Clientes en cache, usando datos existentes');
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, clientes: true },
			error: { ...state.error, clientes: null }
		}));

		try {
			console.log('🔄 Cargando clientes desde API...');
			const response = await apiClient.get('/api/servicios/filtros/clientes');

			let clientesData: Cliente[] = [];
			if (Array.isArray(response.data)) {
				clientesData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				clientesData = response.data.data;
			}

			console.log('✅ Clientes cargados:', clientesData.length);

			recursosStore.update((state) => ({
				...state,
				clientes: clientesData,
				loading: { ...state.loading, clientes: false },
				lastFetch: { ...state.lastFetch, clientes: Date.now() }
			}));
		} catch (error) {
			console.error('❌ Error cargando clientes:', error);
			recursosStore.update((state) => ({
				...state,
				loading: { ...state.loading, clientes: false },
				error: {
					...state.error,
					clientes: error instanceof Error ? error.message : 'Error desconocido'
				}
			}));
		}
	},

	// Cargar municipios
	async cargarMunicipios(force = false) {
		const currentState = await new Promise<RecursosState>((resolve) => {
			recursosStore.subscribe((state) => resolve(state))();
		});

		if (!force && isCacheValid(currentState.lastFetch.municipios)) {
			console.log('✅ Municipios en cache, usando datos existentes');
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, municipios: true },
			error: { ...state.error, municipios: null }
		}));

		try {
			console.log('🔄 Cargando municipios desde API...');
			const response = await apiClient.get('/api/municipios');

			let municipiosData: Municipio[] = [];
			if (Array.isArray(response.data)) {
				municipiosData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				municipiosData = response.data.data;
			}

			console.log('✅ Municipios cargados:', municipiosData.length);

			recursosStore.update((state) => ({
				...state,
				municipios: municipiosData,
				loading: { ...state.loading, municipios: false },
				lastFetch: { ...state.lastFetch, municipios: Date.now() }
			}));
		} catch (error) {
			console.error('❌ Error cargando municipios:', error);
			recursosStore.update((state) => ({
				...state,
				loading: { ...state.loading, municipios: false },
				error: {
					...state.error,
					municipios: error instanceof Error ? error.message : 'Error desconocido'
				}
			}));
		}
	},

	// Cargar todos los recursos
	async cargarTodos(force = false) {
		console.log('📦 [RECURSOS] Iniciando carga de todos los recursos...', { force });

		await Promise.all([
			recursos.cargarConductores(force),
			recursos.cargarVehiculos(force),
			recursos.cargarClientes(force),
			recursos.cargarMunicipios(force)
		]);

		console.log('✅ [RECURSOS] Todos los recursos cargados');
	},

	// Agregar un nuevo conductor (después de crear)
	agregarConductor(conductor: Conductor) {
		recursosStore.update((state) => ({
			...state,
			conductores: [...state.conductores, conductor]
		}));
	},

	// Agregar un nuevo vehículo (después de crear)
	agregarVehiculo(vehiculo: Vehiculo) {
		recursosStore.update((state) => ({
			...state,
			vehiculos: [...state.vehiculos, vehiculo]
		}));
	},

	// Agregar un nuevo cliente (después de crear)
	agregarCliente(cliente: Cliente) {
		recursosStore.update((state) => ({
			...state,
			clientes: [...state.clientes, cliente]
		}));
	},

	// Limpiar todos los datos
	limpiar() {
		recursosStore.set(initialState);
	}
};

// Derived stores para opciones de svelte-select
export const conductoresOptions = derived(recursosStore, ($recursos) => {
	return $recursos.conductores.map((c) => ({
		value: c.id,
		label: `${c.nombre || ''} ${c.apellido || ''}`.trim() || `Conductor ${c.id}`
	}));
});

export const vehiculosOptions = derived(recursosStore, ($recursos) =>
	$recursos.vehiculos.map((v) => ({
		value: v.id,
		label:
			`${v.placa || 'Sin placa'}${v.marca ? ' - ' + v.marca : ''}${v.modelo ? ' ' + v.modelo : ''}`.trim()
	}))
);

export const clientesOptions = derived(recursosStore, ($recursos) =>
	$recursos.clientes.map((c) => ({
		value: c.id,
		label: c.nombre || `Cliente ${c.id}`
	}))
);

export const municipiosOptions = derived(recursosStore, ($recursos) =>
	$recursos.municipios.map((m) => ({
		value: m.id,
		label: `${m.nombre_municipio}, ${m.nombre_departamento}`
	}))
);
