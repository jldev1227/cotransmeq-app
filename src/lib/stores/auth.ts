import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

export interface User {
	id: string;
	nombre: string;
	correo: string;
	rol?: string;
	role?: string;
	avatar?: string;
	permisos?: Record<string, boolean>;
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

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	return {
		subscribe,

		// Hidratar el estado desde localStorage o cookies al inicializar
		init() {
			if (browser) {
				let token = localStorage.getItem('transmeralda_token');
				const userData = localStorage.getItem('transmeralda_user');

				// Si no hay token en localStorage, intentar leer de cookies
				if (!token) {
					const cookies = document.cookie.split(';');
					const tokenCookie = cookies.find((c) => c.trim().startsWith('transmeralda_token='));
					if (tokenCookie) {
						token = tokenCookie.split('=')[1];
					}
				}

				if (token && userData) {
					try {
						const user = JSON.parse(userData);
						update((state) => ({
							...state,
							token,
							user
						}));
					} catch (error) {
						console.error('❌ [AUTH] Error parsing user data:', error);
						this.logout();
					}
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

				// Validar que recibimos los datos necesarios
				if (!token || !user) {
					throw new Error('Respuesta del servidor incompleta');
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

				let errorMessage = 'Error al iniciar sesión';

				if (error.response?.data?.message) {
					errorMessage = error.response.data.message;
				} else if (error.response?.status === 401) {
					errorMessage = 'Credenciales incorrectas';
				} else if (error.response?.status === 500) {
					errorMessage = 'Error interno del servidor';
				} else if (!error.response) {
					errorMessage = 'No se pudo conectar con el servidor';
				}

				update((state) => ({
					...state,
					isLoading: false,
					error: errorMessage
				}));

				return false;
			}
		},

		// Función de logout
		logout(redirectToLogin: boolean = true) {
			if (browser) {
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

		// Limpiar errores
		clearError() {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const authStore = createAuthStore();
