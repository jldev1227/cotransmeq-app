import { writable, derived } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';

// Tipos
interface Conductor {
	id: string;
	nombre: string;
	apellido: string;
	telefono?: string;
	tipo_identificacion?: string;
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
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, conductores: true },
			error: { ...state.error, conductores: null }
		}));

		try {
			const response = await apiClient.get('/api/servicios/filtros/conductores');
			console.log(response)
			// Extraer datos de la respuesta
			let conductoresData: Conductor[] = [];
			if (Array.isArray(response.data)) {
				conductoresData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				conductoresData = response.data.data;
			}

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
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, vehiculos: true },
			error: { ...state.error, vehiculos: null }
		}));

		try {
			const response = await apiClient.get('/api/servicios/filtros/vehiculos');

			let vehiculosData: Vehiculo[] = [];
			if (Array.isArray(response.data)) {
				vehiculosData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				vehiculosData = response.data.data;
			}

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
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, clientes: true },
			error: { ...state.error, clientes: null }
		}));

		try {
			const response = await apiClient.get('/api/servicios/filtros/clientes');

			let clientesData: Cliente[] = [];
			if (Array.isArray(response.data)) {
				clientesData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				clientesData = response.data.data;
			}

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
			return;
		}

		recursosStore.update((state) => ({
			...state,
			loading: { ...state.loading, municipios: true },
			error: { ...state.error, municipios: null }
		}));

		try {
			const response = await apiClient.get('/api/municipios');

			let municipiosData: Municipio[] = [];
			if (Array.isArray(response.data)) {
				municipiosData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				municipiosData = response.data.data;
			}

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
		await Promise.all([
			recursos.cargarConductores(force),
			recursos.cargarVehiculos(force),
			recursos.cargarClientes(force),
			recursos.cargarMunicipios(force)
		]);
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
	return $recursos.conductores.map((c) => {
		const nombre = c.nombre?.trim() || '';
		const apellido = c.apellido?.trim() || '';
		const telefono = c.telefono?.trim() || '';
		const tipoDoc = c.tipo_identificacion?.trim().toUpperCase() || '';
		const numeroDoc = c.numero_identificacion?.trim() || '';

		const docLabel = tipoDoc && numeroDoc
			? `${tipoDoc} ${numeroDoc}`
			: tipoDoc
				? `${tipoDoc} sin número`
				: numeroDoc
					? `Doc. ${numeroDoc}`
					: '';

		let labelPrincipal: string;
		let labelSecundario: string;

		if (nombre || apellido) {
			labelPrincipal = `${nombre} ${apellido}`.trim();
			if (docLabel) {
				labelSecundario = docLabel;
			} else if (telefono) {
				labelSecundario = `Tel. ${telefono}`;
			} else {
				labelSecundario = 'Sin identificación';
			}
		} else if (docLabel) {
			labelPrincipal = docLabel;
			labelSecundario = telefono
				? `Tel. ${telefono} · Conductor sin nombre`
				: 'Conductor sin nombre';
		} else if (telefono) {
			labelPrincipal = `Tel. ${telefono}`;
			labelSecundario = 'Conductor sin nombre';
		} else {
			labelPrincipal = `Conductor ${c.id.slice(0, 8)}`;
			labelSecundario = 'Sin datos';
		}

		return {
			value: c.id,
			label: labelPrincipal,
			labelSecundario,
			searchLabel: `${labelPrincipal} ${labelSecundario}`.toLowerCase()
		};
	});
});

export const vehiculosOptions = derived(recursosStore, ($recursos) =>
	$recursos.vehiculos.map((v) => {
		const placa = v.placa?.trim() || '';
		const marca = v.marca?.trim() || '';
		const modelo = v.modelo?.trim() || '';
		const linea = v.linea?.trim() || '';

		const detalle = [marca, modelo, linea].filter(Boolean).join(' ').trim();

		let labelPrincipal: string;
		let labelSecundario: string;

		if (placa) {
			labelPrincipal = placa;
			labelSecundario = detalle || 'Vehículo sin detalles';
		} else if (detalle) {
			labelPrincipal = detalle;
			labelSecundario = 'Sin placa';
		} else {
			labelPrincipal = `Vehículo ${v.id.slice(0, 8)}`;
			labelSecundario = 'Sin datos';
		}

		return {
			value: v.id,
			label: labelPrincipal,
			labelSecundario,
			searchLabel: `${labelPrincipal} ${labelSecundario}`.toLowerCase()
		};
	})
);

export const clientesOptions = derived(recursosStore, ($recursos) =>
	$recursos.clientes.map((c) => {
		const nombre = c.nombre?.trim() || '';
		const nit = c.nit?.trim() || '';

		let labelPrincipal: string;
		let labelSecundario: string;

		if (nombre && nit) {
			labelPrincipal = nombre;
			labelSecundario = `NIT ${nit}`;
		} else if (nombre) {
			labelPrincipal = nombre;
			labelSecundario = 'Sin NIT';
		} else if (nit) {
			labelPrincipal = `NIT ${nit}`;
			labelSecundario = 'Cliente sin nombre';
		} else {
			labelPrincipal = `Cliente ${c.id.slice(0, 8)}`;
			labelSecundario = 'Sin datos';
		}

		return {
			value: c.id,
			label: labelPrincipal,
			labelSecundario,
			searchLabel: `${labelPrincipal} ${labelSecundario}`.toLowerCase()
		};
	})
);

export const municipiosOptions = derived(recursosStore, ($recursos) =>
	$recursos.municipios.map((m) => ({
		value: m.id,
		label: `${m.nombre_municipio}, ${m.nombre_departamento}`
	}))
);
