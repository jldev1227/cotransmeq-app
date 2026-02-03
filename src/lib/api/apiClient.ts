import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { authStore } from '$lib/stores/auth';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

// Crear instancia de Axios
const apiClient: AxiosInstance = axios.create({
	baseURL: browser ? import.meta.env.VITE_API_URL : 'http://midominio.local:5000',
	timeout: 10000,
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
	(error) => {
		return Promise.reject(error);
	}
);

// Interceptor de response para manejar errores globales
apiClient.interceptors.response.use(
	(response: AxiosResponse) => {
		return response;
	},
	async (error) => {
		const originalRequest = error.config;

		// Si recibimos un 401, significa que el token expiró o es inválido
		if (error.response?.status === 401 && !originalRequest._retry) {
			originalRequest._retry = true;

			// Limpiar autenticación y redirigir al login
			if (browser) {
				authStore.logout();
			}

			return Promise.reject(error);
		}

		// Manejar otros errores comunes
		if (error.response?.status === 403) {
			console.error('Acceso prohibido');
		} else if (error.response?.status === 500) {
			console.error('Error interno del servidor');
		} else if (!error.response) {
			console.error('Error de conexión');
		}

		return Promise.reject(error);
	}
);

// Funciones de API específicas para autenticación
export const authAPI = {
	login: (correo: string, password: string) =>
		apiClient.post('/api/auth/login', { correo, password }),

	logout: () => apiClient.post('/api/auth/logout'),

	refreshToken: () => apiClient.post('/api/auth/refresh'),

	getProfile: () => apiClient.get('/api/auth/profile')
};

// Cliente público (sin autenticación)
export const publicApiClient: AxiosInstance = axios.create({
	baseURL: browser ? import.meta.env.VITE_API_URL : 'http://midominio.local:5000',
	timeout: 10000,
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
	getAll: () => apiClient.get('/api/conductores'),
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
	deleteFoto: (id: string) => apiClient.delete(`/api/conductores/${id}/foto`)
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

export { apiClient };
