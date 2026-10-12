/**
 * `fetch` con la sesión del equipo, para los clientes que no pasan por
 * `apiClient` (descargas de blob, subidas multipart, streams, `keepalive`).
 *
 * Hace tres cosas, las mismas que `apiClient` con axios:
 *
 *  1. Compone la URL con la misma base (`VITE_API_URL` y el mismo respaldo).
 *     Cada cliente la calculaba a su manera con `import.meta.env.VITE_API_URL`
 *     a secas y, sin la variable, pedía a `undefined/api/...`.
 *  2. Pone `Authorization: Bearer <token>` si quien llama no la puso ya.
 *  3. Ante un 401 cierra la sesión local y lleva al login conservando la ruta
 *     (`sesionVencida`). Antes esos clientes tragaban el 401 como un error
 *     cualquiera: la pantalla decía «Error al obtener…» y el usuario seguía
 *     dentro con un token que el backend ya no aceptaba.
 *
 * La `Response` se devuelve tal cual —también la del 401—, así que quien llama
 * sigue leyendo `ok`, `json()` o `blob()` como antes.
 *
 * **Solo para pantallas con sesión del equipo.** Las públicas (asistencias,
 * evaluaciones, inducciones por enlace) y el portal del conductor usan `fetch`
 * a secas con `API_BASE`: un 401 ahí no significa que la sesión del dashboard
 * venció, y mandarlos al login del equipo los sacaría de su pantalla.
 */
import { browser } from '$app/environment';

/**
 * Base de la API. Es la misma que usa `apiClient`, que la importa de aquí.
 *
 * Respaldo a `localhost:4000` y no a un dominio ficticio: uno inventado da
 * error de DNS y deja las pantallas cargando para siempre.
 */
export const API_BASE: string = browser
	? (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
	: 'http://localhost:4000';

const CLAVE_TOKEN = 'transmeralda_token';
const CLAVE_USUARIO = 'transmeralda_user';

/** El JWT del dashboard, o `null` fuera del navegador o sin sesión. */
export function tokenDeSesion(): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(CLAVE_TOKEN);
	} catch {
		return null;
	}
}

/** `'/api/...'` → URL completa. Una URL absoluta pasa sin tocar. */
export function urlApi(ruta: string): string {
	return /^https?:\/\//i.test(ruta) ? ruta : `${API_BASE}${ruta}`;
}

/// Varias peticiones fallan a la vez con la misma sesión vencida; basta con una
/// redirección. La recarga completa reinicia la bandera.
let redirigiendo = false;

/**
 * La sesión del equipo ya no vale (el backend respondió 401).
 *
 * Borra el token —`localStorage` y la cookie que leen las rutas de servidor— y
 * hace una carga completa de `/login?redirect=<ruta + consulta>`, para volver al
 * mismo sitio, filtros incluidos, después de entrar. No llama a
 * `POST /api/auth/logout`: con la sesión ya inválida respondería otro 401.
 *
 * En `/public/*` no hace nada: el portal del conductor no tiene sesión de
 * dashboard y su 401 lo maneja quien llamó.
 */
export function sesionVencida(): void {
	if (!browser || redirigiendo) return;
	const { pathname, search } = window.location;
	if (pathname.startsWith('/public/')) return;
	redirigiendo = true;

	localStorage.removeItem(CLAVE_TOKEN);
	localStorage.removeItem(CLAVE_USUARIO);
	document.cookie = `${CLAVE_TOKEN}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`;

	window.location.href =
		pathname === '/login' ? '/login' : `/login?redirect=${encodeURIComponent(pathname + search)}`;
}

export interface OpcionesFetchConSesion extends RequestInit {
	/**
	 * No tratar el 401 como sesión vencida. Para las peticiones que salen
	 * mientras la sesión se cierra a propósito: si el backend ya la cerró, el
	 * 401 es lo esperado y no hay que redirigir otra vez.
	 */
	ignorar401?: boolean;
}

/**
 * `fetch` contra la API con el token del dashboard. `ruta` es `'/api/...'` (o
 * una URL absoluta). Ver la cabecera del módulo.
 */
export async function fetchConSesion(
	ruta: string,
	opciones: OpcionesFetchConSesion = {}
): Promise<Response> {
	const { ignorar401, ...init } = opciones;
	/// `Headers` acepta objeto, array o `Headers`; así se respeta lo que traiga
	/// quien llama. No se toca `Content-Type`: con `FormData` lo pone el
	/// navegador, con su `boundary`.
	const headers = new Headers(init.headers);
	const token = tokenDeSesion();
	if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

	const res = await fetch(urlApi(ruta), { ...init, headers });
	if (res.status === 401 && !ignorar401) sesionVencida();
	return res;
}
