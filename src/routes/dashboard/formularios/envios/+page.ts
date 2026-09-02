import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Redirección del listado de envíos, que ya no existe como pantalla propia.
 *
 * El explorador vive dentro de `/dashboard/formularios`, en su pestaña. Esta
 * ruta se queda solo para que los marcadores y los enlaces pegados en correos
 * —que los hay— no caigan en un 404: se traducen a la pestaña equivalente
 * conservando los filtros que trajeran en la query.
 */
export const load: PageLoad = ({ url }) => {
	const params = new URLSearchParams(url.searchParams);
	params.set('vista', 'envios');
	redirect(308, `/dashboard/formularios?${params.toString()}`);
};
