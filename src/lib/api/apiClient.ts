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

// ═══════════════════════════════════════════════════════════════════════════
//  Configuración de resiliencia de red
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT = 30_000; // 30s por defecto (antes 15s, demasiado corto)
const MAX_RETRIES = 2; // 1 intento original + 2 reintentos = 3 intentos totales
const RETRY_BASE_DELAY_MS = 800; // 800ms, 1600ms, 3200ms (backoff exponencial)
const SAFE_METHODS = new Set(['get', 'head', 'options']); // solo métodos idempotentes

// In-flight requests para deduplicación (comparten la misma promesa)
const inflight = new Map<string, Promise<AxiosResponse>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableError(error: any): boolean {
	// Sin respuesta = error de red o timeout → reintentar
	if (!error.response) return true;
	const status: number = error.response.status;
	// Reintentar solo en: 408 (request timeout), 429 (too many requests), 5xx
	return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function shouldRetry(config: any): boolean {
	if (!config) return false;
	const method = (config.method || 'get').toLowerCase();
	if (!SAFE_METHODS.has(method)) return false; // nunca reintentar mutaciones
	if (config._noRetry) return false;
	const retries = config._retryCount || 0;
	return retries < MAX_RETRIES;
}

function dedupKey(config: InternalAxiosRequestConfig): string {
	const method = (config.method || 'get').toLowerCase();
	const url = config.url || '';
	const params = config.params ? JSON.stringify(config.params) : '';
	const data = config.data && !(config.data instanceof FormData) ? JSON.stringify(config.data) : '';
	return `${method}:${url}::${params}::${data}`;
}

// Crear instancia de Axios
const apiClient: AxiosInstance = axios.create({
	baseURL: API_BASE,
	timeout: DEFAULT_TIMEOUT,
	headers: {
		'Content-Type': 'application/json',
		'X-Client': 'cotransmeq-web'
	},
	// keep-alive: se configura abajo para Node (SSR). En el navegador el navegador
	// ya reutiliza conexiones por origen — Vercel → Internet → Red corporativa.
	httpAgent: undefined,
	httpsAgent: undefined
});

// Configurar keep-alive en Node (cuando se ejecute en SSR/server)
if (!browser) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { Agent } = require('http');
	const { Agent: HttpsAgent } = require('https');
	(apiClient.defaults as any).httpAgent = new Agent({ keepAlive: true, maxSockets: 50 });
	(apiClient.defaults as any).httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 50 });
}

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

		// Marcar tiempo de inicio para diagnóstico
		(config as any)._startedAt = Date.now();

		return config;
	},
	(error) => Promise.reject(error)
);

// Interceptor de response: maneja 401 (token expirado) y dispara el retry con backoff
apiClient.interceptors.response.use(
	(response: AxiosResponse) => {
		// Log de latencia para diagnóstico
		if (browser && (response.config as any)._startedAt) {
			const ms = Date.now() - (response.config as any)._startedAt;
			if (ms > 5_000) {
				console.warn(
					`[api] ${(response.config.method || 'get').toUpperCase()} ` +
						`${response.config.url} tardó ${ms}ms`
				);
			}
		}
		return response;
	},
	async (error) => {
		const originalRequest = error.config;

		// ───────── 1) Manejo de 401 (token expirado) ─────────
		if (error.response?.status === 401 && !originalRequest._retry && !originalRequest._silent401) {
			originalRequest._retry = true;

			if (browser) {
				localStorage.removeItem('transmeralda_token');
				localStorage.removeItem('transmeralda_user');
				document.cookie =
					'transmeralda_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
				window.location.href = '/login';
			}

			return Promise.reject(error);
		}

		// ───────── 2) Retry con backoff exponencial ─────────
		if (shouldRetry(originalRequest) && isRetryableError(error)) {
			originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
			const attempt = originalRequest._retryCount;
			const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

			if (browser) {
				const status = error.response?.status ?? 'NETWORK';
				const url = originalRequest?.url ?? '?';
				console.warn(
					`[api] reintento ${attempt}/${MAX_RETRIES} en ${delay}ms ` + `(${status}) → ${url}`
				);
			}

			await sleep(delay);
			return apiClient(originalRequest);
		}

		// Log final del error
		if (browser && originalRequest) {
			const ms = (originalRequest as any)._startedAt
				? Date.now() - (originalRequest as any)._startedAt
				: 0;
			const status = error.response?.status ?? 'TIMEOUT/NETWORK';
			const code = error.code || '';
			console.error(
				`[api] ${(originalRequest.method || 'get').toUpperCase()} ` +
					`${originalRequest.url} falló (${status}${code ? ' / ' + code : ''}) ` +
					`tras ${ms}ms`
			);
		}

		return Promise.reject(error);
	}
);

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers públicos para configurar requests individuales
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Opciones de resilience que se pueden pasar como tercer argumento
 * a apiClient.get/post/put/delete en cualquier llamada del proyecto.
 *
 *   await apiClient.get('/api/servicios', {
 *     params: { page: 1 },
 *     ...withTimeout(60_000),       // 60s para este request puntual
 *     ...withoutRetry(),            // desactivar retry (ej: uploads)
 *     ...withoutDedup(),            // forzar fetch nuevo
 *   })
 */
export const withTimeout = (ms: number) => ({ timeout: ms });
export const withoutRetry = () => ({ _noRetry: true }) as any;
export const withoutDedup = () => ({ _noDedup: true }) as any;
export const silent401 = () => ({ _silent401: true }) as any;

// Patch de los métodos de axios para soportar dedup automática en GETs
// (sin cambiar la firma: acepta los mismos argumentos que axios)
type AxiosMethod = 'get' | 'delete' | 'head' | 'options';

(['get', 'delete', 'head', 'options'] as AxiosMethod[]).forEach((method) => {
	const original = (apiClient as any)[method].bind(apiClient);
	(apiClient as any)[method] = (url: string, config: any = {}) => {
		if (config._noDedup) {
			delete config._noDedup;
			return original(url, config);
		}
		// Construir key estable para dedup
		const fakeConfig: InternalAxiosRequestConfig = {
			...config,
			method,
			url
		} as InternalAxiosRequestConfig;
		const key = dedupKey(fakeConfig);
		const existing = inflight.get(key);
		if (existing) return existing;
		const promise = original(url, config).finally(() => inflight.delete(key));
		inflight.set(key, promise);
		return promise;
	};
});

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

// Cliente público (sin autenticación) — sin retry agresivo para no abusar de endpoints públicos
export const publicApiClient: AxiosInstance = axios.create({
	baseURL: API_BASE,
	timeout: DEFAULT_TIMEOUT,
	headers: {
		'Content-Type': 'application/json',
		'X-Client': 'cotransmeq-web'
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
