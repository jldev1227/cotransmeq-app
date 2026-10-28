import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env as envPrivado } from '$env/dynamic/private';

/// Rastreo de errores (Sentry), OPCIONAL: solo con `SENTRY_DSN` en el entorno
/// del servidor (el del navegador va aparte, con `PUBLIC_SENTRY_DSN`, en
/// `hooks.client.ts`). Sin DSN el SDK ni se carga.
const dsnServidor = envPrivado.SENTRY_DSN?.trim();
const sentryServidor = dsnServidor
	? import('@sentry/sveltekit')
			.then((S) => {
				S.init({
					dsn: dsnServidor,
					environment: envPrivado.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
					/// Las peticiones llevan la cookie del token y los formularios
					/// datos personales: no sale nada de eso.
					dataCollection: {
						userInfo: false,
						cookies: false,
						httpHeaders: false,
						httpBodies: [],
						urlQueryParams: false
					}
				});
				return S;
			})
			.catch(() => null)
	: Promise.resolve(null);

export const handleError: HandleServerError = async ({ error, event, status }) => {
	// Lo que hace SvelteKit cuando no hay hook: dejar el error en el log.
	console.error(error);
	if (status < 500) return;
	const S = await sentryServidor;
	S?.captureException(error, { tags: { ruta: event.route.id ?? event.url.pathname } });
};

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
			throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
		}

		const userArea = payload.area;
		const userRole = payload.role ?? 'usuario';
		/// La whitelist no va en el JWT para que sus recortes apliquen sin renovar
		/// sesión. La API consulta la lista vigente y el layout muestra su 404 visual.

		event.locals.token = token;
		event.locals.userRole = userRole;
		event.locals.userArea = userArea;
	} else {
		event.locals.token = token ?? undefined;
	}

	return await resolve(event);
};
