import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { checkAccess } from '$lib/config/permissions';

function decodeJwtPayload(token: string): any | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
		if (payload.exp && payload.exp * 1000 < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

function getModuleFromPath(pathname: string): string | null {
	const match = pathname.match(/^\/dashboard\/([^/]+)/);
	return match ? match[1] : null;
}

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies } = event;

	const token =
		cookies.get('transmeralda_token') ||
		event.request.headers.get('authorization')?.replace('Bearer ', '');

	const protectedRoutes = ['/dashboard'];
	const isProtectedRoute = protectedRoutes.some((route) => url.pathname.startsWith(route));

	// --- LIMPIAR TOKENS VIEJOS EN CUALQUIER RUTA ---
	// Si hay token pero es inválido/expirado/viejo (sin campo 'area'), eliminarlo
	if (token) {
		const payload = decodeJwtPayload(token);
		if (!payload || !Array.isArray(payload.area)) {
			// Token viejo o inválido — limpiar cookie
			cookies.delete('transmeralda_token', { path: '/' });
			
			if (isProtectedRoute) {
				throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
			}
			// Si está en /login u otra ruta pública, dejar que la página cargue normalmente
			return await resolve(event);
		}
	}

	if (isProtectedRoute && !token) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	if (isProtectedRoute && token) {
		const payload = decodeJwtPayload(token)!; // Ya validado arriba
		const userArea = payload.area;
		const userRole = payload.role ?? 'usuario';

		const moduleId = getModuleFromPath(url.pathname);
		if (moduleId && userArea.length > 0) {
			const { allowed } = checkAccess(userRole, userArea, moduleId);
			if (!allowed && moduleId !== 'servicios') {
				throw redirect(302, '/dashboard/servicios?denied=1');
			}
		}

		event.locals.token = token;
		event.locals.userRole = userRole;
		event.locals.userArea = userArea;
	} else {
		event.locals.token = token;
	}

	return await resolve(event);
};
