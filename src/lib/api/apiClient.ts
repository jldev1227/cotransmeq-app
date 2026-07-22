import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { authStore } from '$lib/stores/auth';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

// Resolver el baseURL en runtime: variable de entorno en el navegador,
// fallback sensato a localhost:4000 (no usar dominios ficticios como
// 'midominio.local' que causarían errores de DNS y loading infinito).
const API_BASE = browser
	? (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
	: 'http://localhost:4000';

// Crear instancia de Axios
const apiClient: AxiosInstance = axios.create({
	baseURL: API_BASE,
	timeout: 15000,
	headers: {
		'Content-Type': 'application/json'
	}
});

// Interceptor de request para agregar token de autorización
apiClient.interceptors.request.use(
	(config: InternalAxiosRequestConfig) => {
		if (browser) {
			const token = localStorage.getItem('transmeralda_token');
			if (token) {
				config.headers.Authorization = `Bearer ${token}`;
			}
		}

		// Si el body es FormData, eliminar el Content-Type para que axios lo configure automáticamente
		if (config.data instanceof FormData) {
			delete config.headers['Content-Type'];
		}

		return config;
	},
	(error) => Promise.reject(error)
);

// Interceptor de response para manejar errores globales
apiClient.interceptors.response.use(
	(response: AxiosResponse) => response,
	async (error) => {
		const originalRequest = error.config;

		// Si recibimos un 401, significa que el token expiró o es inválido
		// Excepción: requests marcadas con _silent401 (endpoints del portal-conductor
		// que se llaman legítimamente con token de admin y pueden devolver 401/403
		// si el conductor aún no ha firmado). No deben disparar logout global.
		if (
			error.response?.status === 401 &&
			!originalRequest._retry &&
			!originalRequest._silent401
		) {
			originalRequest._retry = true;

			// Limpiar autenticación y forzar recarga completa para que el hook server-side vea los cookies limpios
			if (browser) {
				localStorage.removeItem('transmeralda_token');
				localStorage.removeItem('transmeralda_user');
				document.cookie = 'transmeralda_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
				window.location.href = '/login';
			}

			return Promise.reject(error);
		}

		return Promise.reject(error);
	}
);

// Funciones de API específicas para autenticación
export const authAPI = {
	login: (correo: string, password: string, rememberMe?: boolean) =>
		apiClient.post('/api/auth/login', { correo, password, rememberMe }),

	logout: () => apiClient.post('/api/auth/logout'),

	refreshToken: () => apiClient.post('/api/auth/refresh'),

	getProfile: () => apiClient.get('/api/auth/profile'),

	changePassword: (currentPassword: string, newPassword: string) =>
		apiClient.put('/api/auth/change-password', { currentPassword, newPassword }),

	updateProfile: (data: { nombre?: string; telefono?: string }) =>
		apiClient.put('/api/auth/update-profile', data),

	getMySession: () => apiClient.get('/api/auth/my-session'),

	getMyFirma: () => apiClient.get('/api/auth/my-firma'),

	uploadMyFirma: (file: File) => {
		const formData = new FormData();
		formData.append('file', file);
		return apiClient.post('/api/auth/my-firma', formData, {
			headers: { 'Content-Type': 'multipart/form-data' }
		});
	},

	deleteMyFirma: () => apiClient.delete('/api/auth/my-firma')
};

// Cliente público (sin autenticación)
export const publicApiClient: AxiosInstance = axios.create({
	baseURL: API_BASE,
	timeout: 15000,
	headers: {
		'Content-Type': 'application/json'
	}
});

// Funciones de API para otros módulos
export const vehiculosAPI = {
	getAll: () => apiClient.get('/api/vehiculos'),
	getById: (id: string) => apiClient.get(`/api/vehiculos/${id}`),
	create: (data: any) => apiClient.post('/api/vehiculos', data),
	update: (id: string, data: any) => apiClient.put(`/api/vehiculos/${id}`, data),
	delete: (id: string) => apiClient.delete(`/api/vehiculos/${id}`),
	getDeleted: () => apiClient.get('/api/vehiculos/deleted/list'),
	restore: (id: string) => apiClient.post(`/api/vehiculos/${id}/restore`)
};

export const conductoresAPI = {
	getAll: (params?: any) => apiClient.get('/api/conductores', { params }),
	getById: (id: string) => apiClient.get(`/api/conductores/${id}`),
	create: (data: any) => apiClient.post('/api/conductores', data),
	update: (id: string, data: any) => apiClient.put(`/api/conductores/${id}`, data),
	updateEstado: (id: string, estado: string) =>
		apiClient.patch(`/api/conductores/${id}/estado`, { estado }),
	delete: (id: string) => apiClient.delete(`/api/conductores/${id}`),
	uploadFoto: (id: string, file: File) => {
		const formData = new FormData();
		formData.append('file', file);
		return apiClient.post(`/api/conductores/${id}/foto`, formData);
	},
	deleteFoto: (id: string) => apiClient.delete(`/api/conductores/${id}/foto`),
	// Nuevos endpoints
	getOcultos: (params?: any) => apiClient.get('/api/conductores/ocultos', { params }),
	getPapelera: (params?: any) => apiClient.get('/api/conductores/papelera', { params }),
	ocultar: (id: string, oculto: boolean) =>
		apiClient.patch(`/api/conductores/${id}/ocultar`, { oculto }),
	restaurar: (id: string) => apiClient.patch(`/api/conductores/${id}/restaurar`),
	eliminarPermanente: (id: string, forzar: boolean = false) =>
		apiClient.delete(`/api/conductores/${id}/permanente`, { data: { forzar } }),
	getRelaciones: (id: string) => apiClient.get(`/api/conductores/${id}/relaciones`),
	masivo: (ids: string[], accion: 'ocultar' | 'mostrar' | 'eliminar' | 'restaurar') =>
		apiClient.post('/api/conductores/masivo', { ids, accion })
};

export const serviciosAPI = {
	getAll: () => apiClient.get('/api/servicios'),
	getById: (id: string) => apiClient.get(`/api/servicios/${id}`),
	create: (data: any) => apiClient.post('/api/servicios', data),
	update: (id: string, data: any) => apiClient.put(`/api/servicios/${id}`, data),
	updateEstado: (id: string, estado: string) =>
		apiClient.patch(`/api/servicios/${id}/estado`, { estado }),
	delete: (id: string) => apiClient.delete(`/api/servicios/${id}`),
	generateShareToken: (id: string) => apiClient.post(`/api/servicios/${id}/compartir`),
	getByShareToken: (token: string) => publicApiClient.get(`/api/servicios/public/${token}`)
};

export const clientesAPI = {
	getAll: (params?: any) => apiClient.get('/api/clientes', { params }),
	getById: (id: string) => apiClient.get(`/api/clientes/${id}`),
	create: (data: any) => apiClient.post('/api/clientes', data),
	update: (id: string, data: any) => apiClient.put(`/api/clientes/${id}`, data),
	delete: (id: string) => apiClient.delete(`/api/clientes/${id}`),
	updateTipo: (id: string, tipo: string) => apiClient.patch(`/api/clientes/${id}/tipo`, { tipo })
};

export const extractosAPI = {
	getAll: (params?: any) => apiClient.get('/api/extractos', { params }),
	getMatches: () => apiClient.get('/api/extractos/matches'),
	getContratantes: () => apiClient.get('/api/extractos/contratantes'),
	syncToDatabase: () => apiClient.post('/api/extractos/sync'),
	getNextConsecutivo: () => apiClient.get('/api/extractos/next-consecutivo'),
	create: (data: any) => apiClient.post('/api/extractos', data),
	deleteAll: () => apiClient.delete('/api/extractos/all'),
	delete: (consecutivo: string) => apiClient.delete(`/api/extractos/${consecutivo}`)
};

// ═════════════════════════════════════════════════════
//  Configuraciones de liquidación (fuente de verdad para
//  pintar columnas de bonos en la planilla de días laborados)
// ═════════════════════════════════════════════════════
export interface ConfiguracionLiquidacion {
	id: string;
	nombre: string;
	valor: number;
	tipo: 'VALOR_NUMERICO' | string;
	activo: boolean;
	anio: number | null;
	created_at: string;
	updated_at: string;
}

export const configuracionesLiquidacionAPI = {
	/**
	 * Lista las configuraciones ACTIVAS de un año (default = año actual).
	 * El frontend lo usa para pintar 1 columna de checkbox por cada config
	 * activa en la tabla de recorridos / bonos.
	 */
	activas: (anio?: number) => {
		const params: Record<string, number> = {};
		if (anio !== undefined) params.anio = anio;
		return apiClient.get<{ success: boolean; data: ConfiguracionLiquidacion[] }>(
			'/api/configuraciones-liquidacion/activas',
			{ params }
		);
	},
	todas: (anio?: number) => {
		const params: Record<string, number> = {};
		if (anio !== undefined) params.anio = anio;
		return apiClient.get('/api/configuraciones-liquidacion', { params });
	}
};

// ═════════════════════════════════════════════════════
//  Bonos de planilla de días laborados
//  Cada bono referencia una `configuraciones_liquidacion` activa
//  (FK `config_liquidacion_id`). El valor monetario SIEMPRE se
//  lee de la config vigente (lectura en vivo).
// ═════════════════════════════════════════════════════
export interface BonoPlanilla {
	id: string;
	registro_dia_id: string;
	segmento_id: string | null;
	config_liquidacion_id: string;
	valor: number | null;
	creado_por_id: string | null;
	observaciones: string | null;
	created_at: string;
	updated_at: string;
	config_liquidacion: Pick<
		ConfiguracionLiquidacion,
		'id' | 'nombre' | 'valor' | 'anio' | 'activo'
	> | null;
	// Aplanados desde el join del backend (registro_dia + segmento)
	// para que el frontend pueda agregar por (config, vehiculo, mes)
	// sin tener que hacer otra llamada.
	fecha: string | null;
	conductor_id: string | null;
	vehiculo_id: string | null;
	vehiculo_placa: string | null;
}

export const bonosAPI = {
	listar: (params: { desde: string; hasta: string; conductor_id?: string }) =>
		apiClient.get<{ success: boolean; data: BonoPlanilla[]; count: number }>(
			'/api/dias-laborados/bonos',
			{ params }
		),
	sincronizar: (data: {
		crear: Array<{
			registro_dia_id: string;
			segmento_id?: string | null;
			config_liquidacion_id: string;
			valor?: number | null;
			observaciones?: string | null;
		}>;
		eliminar: string[];
	}) => apiClient.post('/api/dias-laborados/bonos/sync', data),
	crear: (data: {
		registro_dia_id: string;
		segmento_id?: string | null;
		config_liquidacion_id: string;
		valor?: number | null;
		observaciones?: string | null;
	}) => apiClient.post('/api/dias-laborados/bonos', data),
	eliminar: (id: string) => apiClient.delete(`/api/dias-laborados/bonos/${id}`)
};

// ═════════════════════════════════════════════════════
//  Visibilidad de bonos — qué configuraciones de
//  liquidación se exponen como columna en la pestaña
//  de Recorridos. Decisión global y por año.
// ═════════════════════════════════════════════════════
export interface BonoConfigVisualItem {
	id: string;
	nombre: string;
	valor: number;
	tipo: string;
	anio: number | null;
	activo: boolean;
	visible: boolean;
}

export const bonoConfigVisualAPI = {
	/**
	 * Lista las configs activas del año con su flag `visible` resuelto.
	 * Si una config no tiene registro, se considera visible (default).
	 */
	listar: (anio: number) =>
		apiClient.get<{ success: boolean; data: BonoConfigVisualItem[] }>(
			'/api/dias-laborados/bonos-config-visual',
			{ params: { anio } }
		),
	/**
	 * Reemplaza en bloque la selección de visibilidad para un año.
	 * `visibles` es la lista de IDs que el usuario quiere VER como columna.
	 * Las demás se marcan como ocultas.
	 */
	guardar: (anio: number, visibles: string[]) =>
		apiClient.put<{ success: boolean; message: string; data: BonoConfigVisualItem[] }>(
			'/api/dias-laborados/bonos-config-visual',
			{ anio, visibles }
		)
};

export { apiClient };
