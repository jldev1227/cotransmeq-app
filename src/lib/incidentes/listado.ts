import { memoriaListado } from '$lib/stores/volverListado';

/**
 * Última URL del listado de incidentes, con sus filtros: el «Volver» del
 * detalle regresa ahí en vez de a la lista pelada.
 */
export const listadoIncidentes = memoriaListado('/dashboard/incidentes');
