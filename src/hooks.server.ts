import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies } = event;

	console.log('🔍 [HOOKS] Ruta solicitada:', url.pathname);

	// Obtener token de las cookies o headers
	const token =
		cookies.get('transmeralda_token') ||
		event.request.headers.get('authorization')?.replace('Bearer ', '');

	console.log(
		'🔑 [HOOKS] Token encontrado:',
		token ? `${token.substring(0, 20)}...` : 'NO HAY TOKEN'
	);

	// Rutas protegidas que requieren autenticación
	const protectedRoutes = ['/dashboard'];

	// Verificar si la ruta actual está protegida
	const isProtectedRoute = protectedRoutes.some((route) => url.pathname.startsWith(route));

	console.log('🛡️ [HOOKS] Es ruta protegida:', isProtectedRoute);

	// Si es una ruta protegida y no hay token, redirigir al login
	if (isProtectedRoute && !token) {
		console.log('❌ [HOOKS] No hay token, redirigiendo a /login');
		console.log('📍 [HOOKS] Guardando ruta original:', url.pathname);
		// Guardar la ruta original como parámetro de búsqueda
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	// Si está en login y ya tiene token, verificar si hay redirect
	if (url.pathname === '/login' && token) {
		const redirectTo = url.searchParams.get('redirect') || '/dashboard';
		console.log('✅ [HOOKS] Ya tiene token en /login, redirigiendo a:', redirectTo);
		throw redirect(302, redirectTo);
	}

	console.log('✅ [HOOKS] Permitiendo acceso a:', url.pathname);

	// Agregar el token al locals para uso en el servidor
	event.locals.token = token;

	return await resolve(event);
};
