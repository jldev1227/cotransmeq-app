import { writable, derived } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';

// Tipos
export interface Municipio {
	id: string;
	codigo_municipio: number;
	nombre_municipio: string;
	nombre_departamento: string;
	codigo_departamento: number;
	tipo?: string;
	latitud?: number;
	longitud?: number;
}

interface MunicipiosState {
	municipios: Municipio[];
	municipiosPorDepartamento: Record<number, Municipio[]>;
	loading: boolean;
	error: string | null;
	lastFetch: number | null;
}

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutos (municipios cambian raramente)

// Estado inicial
const initialState: MunicipiosState = {
	municipios: [],
	municipiosPorDepartamento: {},
	loading: false,
	error: null,
	lastFetch: null
};

// Store principal
const municipiosStore = writable<MunicipiosState>(initialState);

// Función auxiliar para verificar cache
function isCacheValid(lastFetch: number | null): boolean {
	if (!lastFetch) return false;
	return Date.now() - lastFetch < CACHE_DURATION;
}

// Acciones del store
export const municipios = {
	subscribe: municipiosStore.subscribe,

	// Cargar todos los municipios
	async cargarTodos(force = false) {
		const currentState = await new Promise<MunicipiosState>((resolve) => {
			municipiosStore.subscribe((state) => resolve(state))();
		});

		if (!force && isCacheValid(currentState.lastFetch)) {
			return;
		}

		municipiosStore.update((state) => ({
			...state,
			loading: true,
			error: null
		}));

		try {
			const response = await apiClient.get('/api/municipios');

			let municipiosData: Municipio[] = [];
			if (Array.isArray(response.data)) {
				municipiosData = response.data;
			} else if (response.data?.data && Array.isArray(response.data.data)) {
				municipiosData = response.data.data;
			}

			// Agrupar por departamento
			const porDepartamento = municipiosData.reduce(
				(acc, municipio) => {
					const codigo = municipio.codigo_departamento;
					if (!acc[codigo]) {
						acc[codigo] = [];
					}
					acc[codigo].push(municipio);
					return acc;
				},
				{} as Record<number, Municipio[]>
			);

			municipiosStore.update((state) => ({
				...state,
				municipios: municipiosData,
				municipiosPorDepartamento: porDepartamento,
				loading: false,
				lastFetch: Date.now()
			}));
		} catch (error) {
			console.error('❌ Error cargando municipios:', error);
			municipiosStore.update((state) => ({
				...state,
				loading: false,
				error: error instanceof Error ? error.message : 'Error desconocido'
			}));
		}
	},

	// Cargar municipios de un departamento específico
	async cargarPorDepartamento(codigoDepartamento: number) {
		try {
			const response = await apiClient.get(`/api/municipios/departamento/${codigoDepartamento}`);

			let municipiosData: Municipio[] = [];
			if (Array.isArray(response.data)) {
				municipiosData = response.data;
			}

			municipiosStore.update((state) => ({
				...state,
				municipiosPorDepartamento: {
					...state.municipiosPorDepartamento,
					[codigoDepartamento]: municipiosData
				}
			}));

			return municipiosData;
		} catch (error) {
			console.error(`❌ Error cargando municipios del departamento ${codigoDepartamento}:`, error);
			throw error;
		}
	},

	// Buscar municipios con filtros
	async buscar(filtros: {
		nombre?: string;
		departamento?: string;
		tipo?: string;
		codigo_departamento?: number;
		page?: number;
		limit?: number;
	}) {
		try {
			const params = new URLSearchParams();

			Object.entries(filtros).forEach(([key, value]) => {
				if (value !== undefined && value !== null && value !== '') {
					params.append(key, value.toString());
				}
			});

			const response = await apiClient.get(`/api/municipios/buscar?${params.toString()}`);
			return response.data;
		} catch (error) {
			console.error('❌ Error buscando municipios:', error);
			throw error;
		}
	},

	// Obtener municipio por ID
	async obtenerPorId(id: string) {
		try {
			const response = await apiClient.get(`/api/municipios/${id}`);
			return response.data;
		} catch (error) {
			console.error(`❌ Error obteniendo municipio ${id}:`, error);
			throw error;
		}
	},

	// Limpiar datos
	limpiar() {
		municipiosStore.set(initialState);
	}
};

// Derived stores para opciones de select
export const municipiosOptions = derived(municipiosStore, ($municipios) =>
	$municipios.municipios.map((m) => ({
		value: m.id,
		label: `${m.nombre_municipio}, ${m.nombre_departamento}`
	}))
);

// Array de municipios para uso directo
export const municipiosArray = derived(municipiosStore, ($municipios) => $municipios.municipios);

// Obtener lista de departamentos únicos
export const departamentos = derived(municipiosStore, ($municipios) => {
	const deptMap = new Map<number, { codigo: number; nombre: string }>();

	$municipios.municipios.forEach((m) => {
		if (!deptMap.has(m.codigo_departamento)) {
			deptMap.set(m.codigo_departamento, {
				codigo: m.codigo_departamento,
				nombre: m.nombre_departamento
			});
		}
	});

	return Array.from(deptMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
});

// Opciones de departamentos para select
export const departamentosOptions = derived(departamentos, ($departamentos) =>
	$departamentos.map((d) => ({
		value: d.codigo,
		label: d.nombre
	}))
);

// Función helper para obtener municipios de un departamento específico
export function getMunicipiosPorDepartamento(codigoDepartamento: number) {
	return derived(
		municipiosStore,
		($municipios) => $municipios.municipiosPorDepartamento[codigoDepartamento] || []
	);
}
