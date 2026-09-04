import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/dashboard/nomina` es ahora el canvas de liquidaciones.
 *
 * El listado general con sus tres pestañas desapareció: liquidaciones, primas
 * y análisis viven cada una en su canvas, y se navega entre ellos con el
 * «Ir a…» del toolbar. La ruta se conserva como redirección y no se borra
 * porque hay enlaces repartidos —correos, marcadores, el propio historial del
 * navegador— que apuntan aquí.
 *
 * El periodo viaja si venía en la URL: un enlace a un mes concreto no puede
 * aterrizar en el mes en curso solo por pasar por la redirección.
 */
export const load: PageLoad = ({ url }) => {
	const destino = new URLSearchParams();
	for (const clave of ['anio', 'mes', 'desde'] as const) {
		const valor = url.searchParams.get(clave);
		if (valor) destino.set(clave, valor);
	}
	const consulta = destino.toString();
	redirect(307, consulta ? `/dashboard/nomina/canvas?${consulta}` : '/dashboard/nomina/canvas');
};
