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
	const path = url.pathname;

	// Dejar pasar assets, API, archivos estáticos
	if (
		path.startsWith('/_app/') ||
		path.startsWith('/api/') ||
		path.startsWith('/assets/') ||
		path.startsWith('/favicon') ||
		path.endsWith('.js') ||
		path.endsWith('.css') ||
		path.endsWith('.png') ||
		path.endsWith('.svg') ||
		path.endsWith('.ico') ||
		path.endsWith('.json') ||
		path.endsWith('.woff') ||
		path.endsWith('.woff2') ||
		path.endsWith('.ttf')
	) {
		return await resolve(event);
	}

	// Forzar re-login: cualquier página que NO sea /login redirige a /login y limpia cookie
	if (path !== '/login') {
		const token = cookies.get('transmeralda_token');
		if (token) {
			cookies.delete('transmeralda_token', { path: '/' });
		}
		throw redirect(302, '/login');
	}

	return await resolve(event);
};
