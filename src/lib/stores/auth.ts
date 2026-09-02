import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { checkAccess, type Area, type AccessLevel, type PermisosRutas } from '$lib/config/permissions';
import { describirErrorApi, type MensajesPorEstado } from '$lib/utils/mensajesError';

export interface UserPermisos {
	flota: boolean;
	conductores: boolean;
	servicios: boolean;
	recargos: boolean;
	clientes: boolean;
	asistencias: boolean;
	'acciones-correctivas': boolean;
	evaluaciones: boolean;
	nomina: boolean;
	usuarios: boolean;
	/** Permiso individual: marcar y guardar bonos de planilla de días laborados. */
	'bonos-planilla'?: boolean | undefined;
	[key: string]: boolean | undefined;
}

export interface User {
	id: string;
	nombre: string;
	correo: string;
	rol: string;
	role?: string;
	area?: Area | null;
	cargo?: string;
	telefono?: string;
	ultimo_acceso?: string;
	permisos?: UserPermisos;
	/**
	 * Lista blanca de módulos propia del usuario (`users.permisos_rutas`).
	 * `null`/`{}` deja mandar al área; con claves la sustituye por completo.
	 */
	permisos_rutas?: PermisosRutas;
	avatar?: string;
}

export interface AuthState {
	user: User | null;
	token: string | null;
	isLoading: boolean;
	error: string | null;
}

const initialState: AuthState = {
	user: null,
	token: null,
	isLoading: false,
	error: null
};

/**
 * Textos del login por código de estado. Se separan de los generales porque
 * aquí un 401 significa «las credenciales están mal», no «tu sesión expiró»:
 * el usuario todavía no tenía sesión.
 */
const ESTADOS_LOGIN: MensajesPorEstado = {
	400: 'Revisa el correo y la contraseña ingresados.',
	401: 'Correo o contraseña incorrectos.',
	403: 'Tu usuario no tiene acceso al sistema. Contacta al administrador.',
	404: 'El servicio de autenticación no está disponible. Contacta al administrador.',
	422: 'Revisa el correo y la contraseña ingresados.',
	429: 'Demasiados intentos fallidos. Espera unos minutos antes de reintentar.'
};

/**
 * Traduce un error de la API de login a un mensaje que el usuario pueda leer
 * en el formulario.
 *
 * El texto del backend se sigue prefiriendo —es quien mejor sabe qué falló—
 * pero ahora pasa por el filtro de `describirErrorApi`, porque NestJS y Prisma
 * rellenan ese mismo campo con sus textos por defecto en inglés (`Invalid
 * credentials`, `Unauthorized`, `Internal server error`) y antes salían tal
 * cual en el formulario. Cuando el texto no es presentable se cae a
 * `ESTADOS_LOGIN`.
 */
export function describeLoginError(error: any): string {
	return describirErrorApi(error, {
		porEstado: ESTADOS_LOGIN,
		generico: 'No se pudo iniciar sesión. Inténtalo de nuevo.'
	});
}

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	return {
		subscribe,

		// Hidratar el estado desde localStorage o cookies al inicializar
		async init() {
			if (browser) {
				let token = localStorage.getItem('transmeralda_token');
				const userData = localStorage.getItem('transmeralda_user');

				// Si no hay token en localStorage, intentar leer de cookies
				if (!token) {
					const cookies = document.cookie.split(';');
					const tokenCookie = cookies.find((c) => c.trim().startsWith('transmeralda_token='));
					if (tokenCookie) {
						token = tokenCookie.split('=')[1];
					} else {
						console.log('❌ [AUTH] No hay token en cookies');
					}
				}

				if (token && userData) {
					try {
						// Cargar datos locales inmediatamente para evitar flash
						const user = JSON.parse(userData);
						update((state) => ({
							...state,
							token,
							user,
							isLoading: true
						}));

						// Luego refrescar desde el servidor para tener datos actualizados
						try {
							const { authAPI } = await import('$lib/api/apiClient');
							const response = await authAPI.getProfile();
							const freshUser = response.data;

							if (freshUser && freshUser.id) {
								// Actualizar store y localStorage con datos frescos
								localStorage.setItem('transmeralda_user', JSON.stringify(freshUser));
								update((state) => ({
									...state,
									user: freshUser,
									isLoading: false
								}));
								console.log('✅ [AUTH] Datos de usuario actualizados desde servidor');
							} else {
								update((state) => ({ ...state, isLoading: false }));
							}
						} catch (profileError: any) {
							console.warn('⚠️ [AUTH] No se pudieron refrescar datos:', profileError?.message);
							// Si es 401, el token expiró
							if (profileError?.response?.status === 401) {
								this.logout();
								return;
							}
							// Si falla por red, mantener datos locales
							update((state) => ({ ...state, isLoading: false }));
						}
					} catch (error) {
						console.error('❌ [AUTH] Error parsing user data:', error);
						this.logout();
					}
				} else {
					console.log('⚠️ [AUTH] No hay token o user data, usuario no autenticado');
				}
			}
		},

		// Función de login que conecta con la API
		async login(correo: string, password: string): Promise<boolean> {
			update((state) => ({ ...state, isLoading: true, error: null }));

			try {
				// Importar dinámicamente para evitar problemas SSR
				const { authAPI } = await import('$lib/api/apiClient');

				const response = await authAPI.login(correo, password);

				const { token, user } = response.data;

				// Validar que recibimos los datos necesarios. La respuesta llegó
				// (200) pero viene incompleta: no es un fallo de red, así que se
				// resuelve aquí en vez de caer en el `catch`, que lo describiría
				// como "no se pudo conectar con el servidor".
				if (!token || !user) {
					update((state) => ({
						...state,
						isLoading: false,
						error: 'El servidor respondió sin token de sesión. Inténtalo de nuevo.'
					}));
					return false;
				}

				// Guardar en localStorage y cookies
				if (browser) {
					localStorage.setItem('transmeralda_token', token);
					localStorage.setItem('transmeralda_user', JSON.stringify(user));

					// Guardar también en cookies para que el servidor pueda acceder
					document.cookie = `transmeralda_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Strict`;
				}

				// Actualizar store
				update((state) => ({
					...state,
					token,
					user,
					isLoading: false,
					error: null
				}));

				return true;
			} catch (error: any) {
				console.error('❌ Error en login:', error);

				update((state) => ({
					...state,
					isLoading: false,
					error: describeLoginError(error)
				}));

				return false;
			}
		},

		// Función de logout
		logout(redirectToLogin: boolean = true) {
			if (browser) {
				const currentPath = window.location.pathname;

				localStorage.removeItem('transmeralda_token');
				localStorage.removeItem('transmeralda_user');

				// Eliminar también la cookie
				document.cookie =
					'transmeralda_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
			}

			set(initialState);

			if (redirectToLogin && browser) {
				// Guardar la URL actual para redirigir después del login
				const currentPath = window.location.pathname;
				if (currentPath !== '/login') {
					localStorage.setItem('redirect_after_login', currentPath);
				}
				goto('/login');
			}
		},

		// Verificar si está autenticado
		isAuthenticated: () => {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			return currentState.token !== null && currentState.user !== null;
		},

		// Obtener token actual
		getToken: () => {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			return currentState.token;
		},

		// Obtener usuario actual
		getUser: () => {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			return currentState.user;
		},

		// Limpiar errores
		clearError() {
			update((state) => ({ ...state, error: null }));
		},

		// Verificar si el usuario tiene permiso para una ruta específica
		hasPermission(routeId: string): boolean {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			
			const user = currentState.user;
			if (!user) return false;
			
			const { allowed } = checkAccess(user.role || user.rol, user.area, routeId, user.permisos_rutas);
			return allowed;
		},

		// Obtener el nivel de acceso para un módulo
		getAccessLevel(routeId: string): AccessLevel | null {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			
			const user = currentState.user;
			if (!user) return null;
			
			const { level } = checkAccess(user.role || user.rol, user.area, routeId, user.permisos_rutas);
			return level;
		},

		// Obtener permisos del usuario actual
		getPermisos(): UserPermisos | null {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			return currentState.user?.permisos || null;
		},

		// Verifica si el usuario actual tiene el permiso individual de
		// gestionar bonos de planilla de días laborados. Este permiso
		// es independiente del área y se otorga/revoca por usuario.
		hasBonosPlanilla(): boolean {
			let currentState: AuthState = initialState;
			const unsubscribe = subscribe((state) => (currentState = state));
			unsubscribe();
			return currentState.user?.permisos?.['bonos-planilla'] === true;
		},

		// Actualizar los permisos del usuario en el store (después de un update en el backend)
		updateUserPermisos(permisos: UserPermisos) {
			update((state) => {
				if (state.user) {
					const updatedUser = { ...state.user, permisos };
					if (browser) {
						localStorage.setItem('transmeralda_user', JSON.stringify(updatedUser));
					}
					return { ...state, user: updatedUser };
				}
				return state;
			});
		}
	};
}

export const authStore = createAuthStore();
