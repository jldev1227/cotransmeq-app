import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { checkAccess, getAccessibleModules } from '$lib/config/permissions';

function decodeJwtPayload(token: string): any | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
		// Check expiry
		if (payload.exp && payload.exp * 1000 < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

/** Extraer el moduleId de una ruta /dashboard/xxx */
function getModuleFromPath(pathname: string): string | null {
	const match = pathname.match(/^\/dashboard\/([^/]+)/);
	return match ? match[1] : null;
}

/**
 * Ruta a la que mandar a quien no puede entrar donde pidió.
 *
 * Antes era siempre `/dashboard/servicios`, que valía porque servicios lo tenía
 * casi todo el mundo. Con `permisos_rutas` deja de ser cierto: un usuario de
 * mantenimiento con lista blanca puede no tenerlo, y aterrizaría en otra pantalla
 * denegada. `perfil` es el último recurso porque `checkAccess` lo concede siempre.
 */
function landingRoute(
	userRole: string,
	userArea: string[],
	userRutas: Record<string, any> | null
): string {
	const accesibles = getAccessibleModules(userRole, userArea as any, userRutas);
	if (accesibles['servicios']) return '/dashboard/servicios';
	const primero = Object.keys(accesibles).find((m) => m !== 'perfil');
	return primero ? `/dashboard/${primero}` : '/dashboard/perfil';
}

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies } = event;

	const token =
		cookies.get('transmeralda_token') ||
		event.request.headers.get('authorization')?.replace('Bearer ', '');

	const protectedRoutes = ['/dashboard'];
	const isProtectedRoute = protectedRoutes.some((route) => url.pathname.startsWith(route));

	if (isProtectedRoute) {
		if (!token) {
			/// Se conserva la cadena de consulta, no solo la ruta.
			///
			/// Con `url.pathname` a secas, cualquier enlace con filtros
			/// —`/dashboard/flota?q=renault`— perdía el `?q=` al pasar por el
			/// login, y quien lo abría sin sesión caliente aterrizaba en la
			/// lista completa sin saber por qué. Justo el caso para el que se
			/// puso todo el estado en la URL.
			throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
		}

		const payload = decodeJwtPayload(token);

		// Token inválido, expirado o formato viejo (sin area) → limpiar y mandar a login
		if (!payload || !Array.isArray(payload.area)) {
			cookies.delete('transmeralda_token', { path: '/' });
			throw redirect(302, '/login');
		}

		const userArea = payload.area;
		const userRole = payload.role ?? 'usuario';
		// La lista blanca viaja en el token cuando el backend la firma; si no
		// llega, `undefined` deja mandar a las reglas por área (comportamiento
		// anterior). La API vuelve a comprobarlo en cada ruta de todas formas.
		const userRutas = payload.permisos_rutas ?? null;

		const moduleId = getModuleFromPath(url.pathname);
		if (moduleId && userArea.length > 0) {
			const { allowed } = checkAccess(userRole, userArea, moduleId, userRutas);
			if (!allowed) {
				const destino = landingRoute(userRole, userArea, userRutas);
				// Sin este corte, un usuario cuya lista blanca no incluye el
				// destino entraría en un bucle de redirecciones contra sí mismo.
				if (destino !== url.pathname) {
					throw redirect(302, `${destino}?denied=1`);
				}
			}
		}

		event.locals.token = token;
		event.locals.userRole = userRole;
		event.locals.userArea = userArea;
	} else {
		event.locals.token = token ?? undefined;
	}

	return await resolve(event);
};

