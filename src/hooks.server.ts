import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies } = event;

	// Obtener token de las cookies o headers
	const token =
		cookies.get('transmeralda_token') ||
		event.request.headers.get('authorization')?.replace('Bearer ', '');

	// Rutas protegidas que requieren autenticación
	const protectedRoutes = ['/dashboard'];

	// Verificar si la ruta actual está protegida
	const isProtectedRoute = protectedRoutes.some((route) => url.pathname.startsWith(route));

	// Si es una ruta protegida y no hay token, redirigir al login
	if (isProtectedRoute && !token) {
		// Guardar la ruta original como parámetro de búsqueda
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	// Si está en login y ya tiene token, verificar si hay redirect
	if (url.pathname === '/login' && token) {
		const redirectTo = url.searchParams.get('redirect') || '/dashboard';
		throw redirect(302, redirectTo);
	}

	// Agregar el token al locals para uso en el servidor
	event.locals.token = token;

	return await resolve(event);
};
