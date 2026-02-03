import { writable } from 'svelte/store';

interface Vehiculo {
	id: string;
	placa: string;
	marca: string;
	modelo: string;
	linea?: string;
	color?: string;
	ano?: number;
	estado: string;
	clase_vehiculo?: string;
	tipo_carroceria?: string;
	combustible?: string;
	capacidad_pasajeros?: number;
	kilometraje?: number;
	conductor_id?: string | null;
	conductores?: {
		id: string;
		nombre: string;
		apellido: string;
	} | null;
	created_at?: string;
	isNew?: boolean; // Flag para marcar vehículos recién agregados
}

interface FlotaState {
	vehiculos: Vehiculo[];
	loading: boolean;
	error: string | null;
}

function createFlotaStore() {
	const { subscribe, set, update } = writable<FlotaState>({
		vehiculos: [],
		loading: false,
		error: null
	});

	return {
		subscribe,
		set,
		update,

		// Agregar un nuevo vehículo al inicio del array con flag isNew
		addVehiculo: (vehiculo: Vehiculo) => {
			update((state) => ({
				...state,
				vehiculos: [{ ...vehiculo, isNew: true }, ...state.vehiculos]
			}));

			// Remover el flag isNew después de 5 segundos
			setTimeout(() => {
				update((state) => ({
					...state,
					vehiculos: state.vehiculos.map((v) => (v.id === vehiculo.id ? { ...v, isNew: false } : v))
				}));
			}, 5000);
		},

		// Actualizar un vehículo existente
		updateVehiculo: (vehiculoId: string, updates: Partial<Vehiculo>) => {
			update((state) => ({
				...state,
				vehiculos: state.vehiculos.map((v) => (v.id === vehiculoId ? { ...v, ...updates } : v))
			}));
		},

		// Eliminar un vehículo
		removeVehiculo: (vehiculoId: string) => {
			update((state) => ({
				...state,
				vehiculos: state.vehiculos.filter((v) => v.id !== vehiculoId)
			}));
		},

		// Establecer todos los vehículos
		setVehiculos: (vehiculos: Vehiculo[]) => {
			update((state) => ({
				...state,
				vehiculos,
				loading: false,
				error: null
			}));
		},

		// Establecer estado de carga
		setLoading: (loading: boolean) => {
			update((state) => ({ ...state, loading }));
		},

		// Establecer error
		setError: (error: string | null) => {
			update((state) => ({ ...state, error, loading: false }));
		},

		// Limpiar store
		clear: () => {
			set({
				vehiculos: [],
				loading: false,
				error: null
			});
		}
	};
}

export const flotaStore = createFlotaStore();
