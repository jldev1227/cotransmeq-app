import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { authStore } from '$lib/stores/auth';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
// Imports de Node.js con prefijo `node:` para que Vite los tree-shakee
// del bundle del cliente (en el browser nunca se referencian gracias al
// guard `if (!browser)` más abajo). Usar `require()` rompe porque
// SvelteKit corre en ESM puro donde `require` no existe.
import http from 'node:http';
import https from 'node:https';

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

/**
 * Detecta si un error de axios proviene de un `AbortController`
 * (cancelación intencional del caller, ej: cambio de mes/año o
 * búsqueda). En ese caso NO se debe reintentar: el caller ya no
 * quiere la respuesta.
 *
 * Sin este check, el interceptor de retry veía `error.response`
 * undefined (típico de CanceledError) y reintentaba 3 veces con
 * backoff (800 + 1600 + 3200 = 5.6s), dejando el `loading: true`
 * colgado en la UI después de cada cancelación.
 */
function isCanceledError(error: any): boolean {
	return (
		error?.name === 'CanceledError' ||
		error?.name === 'AbortError' ||
		error?.code === 'ERR_CANCELED' ||
		error?.code === 'ERR_CANCELLED'
	);
}

// Crear instancia de Axios
const apiClient: AxiosInstance = axios.create({
	baseURL: API_BASE,
	timeout: DEFAULT_TIMEOUT,
	headers: {
		'Content-Type': 'application/json',
		'X-Client': 'transmeralda-web'
	},
	// keep-alive: se configura abajo para Node (SSR). En el navegador el navegador
	// ya reutiliza conexiones por origen — Vercel → Internet → Red corporativa.
	httpAgent: undefined,
	httpsAgent: undefined
});

// Configurar keep-alive en Node (cuando se ejecute en SSR/server)
if (!browser) {
	(apiClient.defaults as any).httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
	(apiClient.defaults as any).httpsAgent = new https.Agent({
		keepAlive: true,
		maxSockets: 50
	});
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

		// ───────── 0) Request cancelado a propósito → NO reintentar ─────────
		// Si el caller abortó el fetch (cambio de mes/año, búsqueda rápida,
		// navegación a otra ruta), el caller ya no quiere la respuesta.
		// Reintentar 3 veces con backoff solo serviría para dejar el
		// `loading: true` colgado ~5.6s después de cada cancelación, y
		// si el usuario sigue tecleando, el ciclo se repite → "se queda
		// cargando infinitamente".
		if (isCanceledError(error)) {
			return Promise.reject(error);
		}

		// ───────── 1) Manejo de 401 (token expirado) ─────────
		if (error.response?.status === 401 && !originalRequest._retry && !originalRequest._silent401) {
			originalRequest._retry = true;

			/**
			 * El portal del conductor (`/public/*`) no tiene sesión de dashboard.
			 *
			 * Se autentica con el token del magic link, así que cualquier petición
			 * que se escape por este cliente sale sin `Authorization` y vuelve con
			 * 401. Redirigir ahí sacaría al conductor del formulario que está
			 * diligenciando por algo tan menor como un desplegable que no cargó.
			 * El 401 se propaga y lo maneja quien llamó.
			 */
			const enPortalPublico = browser && window.location.pathname.startsWith('/public/');

			if (browser && !enPortalPublico) {
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
	/**
	 * Un 401 aquí significa "credenciales incorrectas", NO "sesión expirada".
	 *
	 * Sin `silent401()` el interceptor de respuesta trataba el rechazo del
	 * login como token vencido: borraba localStorage y hacía
	 * `window.location.href = '/login'`. Esa recarga completa destruía el
	 * mensaje de error antes de que el usuario alcanzara a leerlo y dejaba
	 * el formulario en blanco. El error se propaga al store, que lo traduce.
	 */
	login: (correo: string, password: string, rememberMe?: boolean) =>
		apiClient.post('/api/auth/login', { correo, password, rememberMe }, silent401()),

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
		'X-Client': 'transmeralda-web'
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
	/**
	 * Vehículos ocultos.
	 *
	 * La página de flota llamaba a este endpoint con un `fetch` crudo y
	 * `localStorage.getItem('token')`, saltándose `apiClient` —y con él el
	 * reintento, la deduplicación de peticiones y el manejo del 401— además de
	 * usar una clave de token distinta a la del resto de la aplicación.
	 */
	getOcultos: () => apiClient.get('/api/vehiculos/ocultos'),
	/**
	 * Acciones sobre varios vehículos a la vez.
	 *
	 * La página lo llamaba con `fetch` y `localStorage.getItem('token')`, pero
	 * la clave real es `transmeralda_token`: ese `getItem` devolvía `null` y la
	 * petición salía con `Authorization: Bearer null`.
	 */
	operacionesMasivas: (ids: string[], accion: string) =>
		apiClient.post('/api/vehiculos/masivo', { ids, accion }),
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
	generateShareToken: (id: string) => apiClient.post(`/api/servicios/${id}/compartir`)
};

/**
 * Superficie pública de servicios: solo el enlace compartido.
 *
 * Vive fuera de `serviciosAPI` a propósito. Las rutas bajo `/public/*` no
 * tienen sesión de dashboard, y mientras el único método público colgara del
 * mismo objeto que `getAll`, `update` o `delete`, bastaba con que alguien
 * escribiera `serviciosAPI.` y aceptara el autocompletado para sacar una
 * petición autenticada desde una página que nunca tendrá token. Separarlos
 * hace que el error no se pueda escribir, en vez de confiar en que nadie lo
 * escriba.
 *
 * Va por `publicApiClient`: sin cabecera `Authorization` y sin el interceptor
 * de 401 que redirige a `/login`. El token de compartir viaja en la URL y es
 * lo único que autoriza la lectura.
 */
export const serviciosPublicAPI = {
	getByShareToken: (token: string) => publicApiClient.get(`/api/servicios/public/${token}`)
};

export const clientesAPI = {
	getAll: (params?: any) => apiClient.get('/api/clientes', { params }),
	getById: (id: string) => apiClient.get(`/api/clientes/${id}`),
	create: (data: any) => apiClient.post('/api/clientes', data),
	update: (id: string, data: any) => apiClient.put(`/api/clientes/${id}`, data),
	delete: (id: string) => apiClient.delete(`/api/clientes/${id}`),
	updateTipo: (id: string, tipo: string) => apiClient.patch(`/api/clientes/${id}/tipo`, { tipo }),
	/**
	 * Clientes ocultos.
	 *
	 * Igual que en vehículos, la página lo pedía con `fetch` crudo y
	 * `localStorage.getItem('token')`, saltándose `apiClient` y perdiendo por
	 * el camino la búsqueda, el tipo y la paginación.
	 */
	getOcultos: (params?: any) => apiClient.get('/api/clientes/ocultos', { params }),
	/** Ver la nota de `vehiculosAPI.operacionesMasivas`: mismo fallo de token. */
	operacionesMasivas: (ids: string[], accion: string) =>
		apiClient.post('/api/clientes/masivo', { ids, accion })
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

// ═══════════════════════════════════════════════════════════════════
//  Días Laborados — endpoints administrativos
//
//  El operador autenticado usa estos endpoints para registrar
//  recorridos de un conductor directamente desde el dashboard
//  (sin pasar por el portal público del conductor).
// ═══════════════════════════════════════════════════════════════════

/** Tipos de día que puede representar un patrón. */
export type TipoDia = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

export interface SegmentoPatron {
	cliente_id?: string | null;
	cliente_nombre?: string | null;
	vehiculo_id?: string | null;
	vehiculo_placa?: string | null;
	hora_inicio?: string | null;
	hora_fin?: string | null;
	horas_conducidas?: number | null;
	km_inicial?: number | null;
	km_final?: number | null;
	pernocte?: boolean;
	observaciones?: string | null;
}

export interface PatronRecorrido {
	/** Tipo de día. Default 'LABORADO' si no se envía (compatibilidad). */
	tipo?: TipoDia;
	fechas: string[];
	/**
	 * Segmento/horario. Requerido cuando tipo=LABORADO o DISPONIBLE.
	 * Opcional para DESCANSO/MANTENIMIENTO.
	 */
	segmento?: SegmentoPatron;
	/**
	 * Vehículo intervenido. OBLIGATORIO cuando tipo=MANTENIMIENTO; el backend
	 * rechaza el patrón sin placa. No va dentro de `segmento` porque un día de
	 * mantenimiento no genera tramo (sin cliente, horario ni horas).
	 */
	mantenimiento_vehiculo_id?: string | null;
	mantenimiento_vehiculo_placa?: string | null;
	observaciones?: string | null;
}

export interface GuardarRegistrosMasivosBody {
	conductor_id: string;
	mes: number;
	anio: number;
	patrones: PatronRecorrido[];
}

export interface ResumenRegistrosMasivos {
	conductor_id: string;
	conductor_nombre: string;
	mes: number;
	anio: number;
	patrones_procesados: number;
	registros_laborado_creados: number;
	registros_descanso_creados: number;
	registros_mantenimiento_creados: number;
	registros_disponible_creados: number;
	total_creados: number;
}

export interface GuardarRegistrosMasivosResponse {
	success: boolean;
	message: string;
	resumen: ResumenRegistrosMasivos;
	ids: Array<{ id: string; fecha: string; tipo: string }>;
}

export const diasLaboradosAPI = {
	/**
	 * Guardar recorridos de un mes completo para un conductor.
	 * Pensado para el flujo administrativo: el operador define
	 * patrones (placa+cliente+horario) y les asigna fechas.
	 */
	registrosMasivos: (body: GuardarRegistrosMasivosBody) =>
		apiClient.post<GuardarRegistrosMasivosResponse>(
			'/api/dias-laborados/admin/registros-masivos',
			body
		),

	/** Listar clientes (sin paginación) para los selects del modal. */
	listarClientes: () =>
		apiClient.get<{ success: boolean; data: any[]; count: number }>(
			'/api/dias-laborados/clientes'
		),

	/** Listar vehículos (sin paginación) para los selects del modal. */
	listarVehiculos: () =>
		apiClient.get<{ success: boolean; data: any[]; count: number }>(
			'/api/dias-laborados/vehiculos'
		),

	/**
	 * Editar un segmento (tramo) específico.
	 * Solo envía los campos que se quieren modificar.
	 */
	editarSegmento: (
		segmentoId: string,
		cambios: Partial<{
			cliente_id: string | null;
			cliente_nombre: string | null;
			vehiculo_id: string | null;
			vehiculo_placa: string | null;
			hora_inicio: string | null;
			hora_fin: string | null;
			horas_conducidas: number | null;
			km_inicial: number | null;
			km_final: number | null;
			pernocte: boolean;
			observaciones: string | null;
		}>
	) =>
		apiClient.put<{ success: boolean; message: string; data: any }>(
			`/api/dias-laborados/admin/segmento/${segmentoId}`,
			cambios
		),

	/**
	 * Soft delete de un segmento.
	 * Marca `deleted_at`; el segmento deja de aparecer en `calendar`.
	 * Idempotente.
	 */
	eliminarSegmento: (segmentoId: string) =>
		apiClient.delete<{ success: boolean; message: string; id: string }>(
			`/api/dias-laborados/admin/segmento/${segmentoId}`
		),

	/**
	 * Editar metadata de un registro (día): tipo + observaciones.
	 * Si se envía `segmento` y el tipo final es LABORADO/DISPONIBLE,
	 * el backend crea o actualiza el primer segmento del día.
	 * Si el tipo final es DESCANSO/MANTENIMIENTO, los segmentos
	 * activos del día se soft-eliminan.
	 * Si el tipo final es MANTENIMIENTO se exige la placa: mándala en
	 * `mantenimiento_vehiculo_placa` o el backend responde 400.
	 */
	editarRegistro: (
		registroId: string,
		cambios: {
			tipo?: 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';
			observaciones?: string | null;
			mantenimiento_vehiculo_id?: string | null;
			mantenimiento_vehiculo_placa?: string | null;
			segmento?: {
				cliente_id?: string | null;
				cliente_nombre?: string | null;
				vehiculo_id?: string | null;
				vehiculo_placa?: string | null;
				hora_inicio?: string | null;
				hora_fin?: string | null;
				horas_conducidas?: number | null;
				km_inicial?: number | null;
				km_final?: number | null;
				pernocte?: boolean;
				observaciones?: string | null;
			} | null;
		}
	) =>
		apiClient.put<{ success: boolean; message: string; data: any }>(
			`/api/dias-laborados/admin/registro/${registroId}`,
			cambios
		),

	/**
	 * Soft delete de un registro (día completo).
	 * Marca `deleted_at` en el padre y en cascada en sus segmentos activos.
	 * Cubre el caso de días sin tramos (DESCANSO / MANTENIMIENTO).
	 * Idempotente.
	 */
	eliminarRegistro: (registroId: string) =>
		apiClient.delete<{ success: boolean; message: string; id: string }>(
			`/api/dias-laborados/admin/registro/${registroId}`
		)
};

// Listado liviano de conductores para alimentar <select>.
// Devuelve SOLO activos + no ocultos, sin fotos ni joins pesados.
export interface ConductorSelectItem {
	id: string;
	nombre: string;
	apellido: string;
	numero_identificacion: string | null;
	estado: string;
}

export const conductoresSelectAPI = {
	listar: () =>
		apiClient.get<{ success: boolean; data: ConductorSelectItem[]; count: number }>(
			'/api/conductores/select-list'
		)
};
