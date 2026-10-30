import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env as envPrivado } from '$env/dynamic/private';
import {
	checkAccess,
	getAccessibleModules,
	type Area,
	type RutasOverride
} from '$lib/config/permissions';

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

interface JwtPayload {
	exp?: number;
	id?: string;
	area?: unknown;
	role?: string;
	permisos_rutas?: RutasOverride;
}

function decodeJwtPayload(token: string): JwtPayload | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as JwtPayload;
		// Check expiry
		if (payload.exp && payload.exp * 1000 < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

/** Extraer el moduleId de una ruta /dashboard/xxx */
function getModuleFromPath(pathname: string): string | null {
	if (/^\/dashboard\/conductores\/rastreo(?:\/|$)/.test(pathname)) return 'rastreo_servicios';
	if (/^\/dashboard\/rastreo-servicios(?:\/|$)/.test(pathname)) return 'rastreo_servicios';
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
function landingRoute(userArea: Area[], userId: string | undefined, userRutas: RutasOverride | null): string {
	const accesibles = getAccessibleModules(userArea, userId, userRutas);
	const prioridad = ['servicios', 'personal', 'capacitaciones', 'rastreo_servicios', 'flota', 'conductores'];
	const modulo = prioridad.find((id) => accesibles[id]);
	if (modulo === 'rastreo_servicios') return '/dashboard/conductores/rastreo';
	if (modulo) return `/dashboard/${modulo}`;
	return accesibles.dashboard ? '/dashboard' : '/dashboard/perfil';
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

		const userArea = payload.area as Area[];
		const userRole = payload.role ?? 'usuario';
		// La lista blanca viaja en el token cuando el backend la firma; si no
		// llega, `undefined` deja mandar a las reglas por área (comportamiento
		// anterior). La API vuelve a comprobarlo en cada ruta de todas formas.
		const userRutas = payload.permisos_rutas ?? null;

		const moduleId = getModuleFromPath(url.pathname);
		if (moduleId && userArea.length === 0 && moduleId !== 'perfil') {
			throw redirect(302, '/dashboard/perfil?denied=1');
		}
		if (moduleId && userArea.length > 0) {
			const { allowed } = checkAccess(userArea, moduleId, payload.id, userRutas);
			if (!allowed) {
				const destino = landingRoute(userArea, payload.id, userRutas);
				// Sin este corte, un usuario cuya lista blanca no incluye el
				// destino entraría en un bucle de redirecciones contra sí mismo.
				if (destino !== url.pathname) {
					throw redirect(302, `${destino}?denied=1`);
				}
			}
		}

		const rutaGestionCapacitaciones = /^\/dashboard\/capacitaciones\/(gestion|nuevo)(\/|$)/.test(url.pathname);
		const permisoGestionCapacitaciones = checkAccess(userArea, 'capacitaciones-gestion', payload.id, userRutas);
		const puedeGestionarCapacitaciones = permisoGestionCapacitaciones.allowed && permisoGestionCapacitaciones.level === 'full';
		if (rutaGestionCapacitaciones && !puedeGestionarCapacitaciones) {
			throw redirect(302, '/dashboard/capacitaciones?denied=1');
		}

		event.locals.token = token;
		event.locals.userRole = userRole;
		event.locals.userArea = userArea;
	} else {
		event.locals.token = token ?? undefined;
	}

	const response = await resolve(event);
	response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(self), geolocation=(self), microphone=(), payment=()'
	);
	return response;
};
