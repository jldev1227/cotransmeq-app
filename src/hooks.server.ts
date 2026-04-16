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

	if (isProtectedRoute && !token) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	if (url.pathname === '/login' && token) {
		let redirectTo = url.searchParams.get('redirect') || '/dashboard/servicios';
		if (redirectTo.startsWith('/dashboard/nomina')) redirectTo = '/dashboard/servicios';
		throw redirect(302, redirectTo);
	}

	if (isProtectedRoute && token) {
		const payload = decodeJwtPayload(token);
		if (!payload) {
			cookies.delete('transmeralda_token', { path: '/' });
			throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
		}

		const moduleId = getModuleFromPath(url.pathname);
		if (moduleId) {
			const { allowed } = checkAccess(payload.role, payload.area, moduleId);
			if (!allowed) {
				throw redirect(302, '/dashboard/servicios?denied=1');
			}
		}

		event.locals.token = token;
		event.locals.userRole = payload.role;
		event.locals.userArea = payload.area;
	} else {
		event.locals.token = token;
	}

	return await resolve(event);
};
