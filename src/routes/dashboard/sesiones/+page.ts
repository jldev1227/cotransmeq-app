import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/dashboard/sesiones` es ahora la pestaña Sesiones de `/dashboard/usuarios`.
 *
 * La pantalla vivía por duplicado: aquí como tabla de once columnas en Tailwind
 * sobre `bg-gray-50`, y allí como sección con el lenguaje visual del resto del
 * dashboard. Dos maquetaciones distintas del mismo dato, con `parseBrowser`,
 * `parseOS` y `formatDate` copiados literalmente en los dos archivos: cualquier
 * arreglo había que hacerlo dos veces y solo se hacía en uno.
 *
 * Se traducen los filtros en vez de redirigir a secas, porque un enlace ya
 * repartido —«mira las sesiones cerradas de Julián»— aterrizaría si no en la
 * lista por defecto, que es justo lo que no decía el enlace.
 *
 * No hay pérdida de acceso: `permissions.ts` exige el área `administracion`
 * tanto para `sesiones` como para `usuarios`.
 */
export const load: PageLoad = ({ url }) => {
	const destino = new URLSearchParams({ tab: 'sesiones' });

	const q = url.searchParams.get('q');
	if (q) destino.set('qSesion', q);

	/// `activas` es el valor por defecto en las dos pantallas, y los valores
	/// por defecto no se escriben en la URL.
	const estado = url.searchParams.get('estado');
	if (estado && estado !== 'activas') destino.set('sesion', estado);

	redirect(307, `/dashboard/usuarios?${destino}`);
};
