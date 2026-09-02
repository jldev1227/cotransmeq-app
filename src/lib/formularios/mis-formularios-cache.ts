/**
 * Caché de la lista de «Mis formularios».
 *
 * `GET /api/mis-formularios` no pagina ni acepta filtros: devuelve TODAS las
 * asignaciones que alcanzan al usuario, con sus borradores. Eso fija dos cosas
 * del diseño de la pantalla:
 *
 *  - **El filtrado y la búsqueda son en cliente.** Ya está todo en memoria;
 *    pedirle al servidor que filtre sería una petición por pulsación para
 *    reordenar un array que ya tenemos.
 *  - **Merece la pena cachear la respuesta.** Es una sola consulta, la misma
 *    para toda la sesión, y el ir y venir entre la lista y el runner
 *    (`/dashboard/mis-formularios/<id>`) la repetía en cada vuelta dejando la
 *    pantalla en «Cargando…» medio segundo cada vez.
 *
 * ── El contrato: stale-while-revalidate ─────────────────────────────────────
 *
 * `cargarLista()` responde de la caché si está fresca y no toca la red. Pasado
 * el TTL sigue devolviendo lo viejo al instante para pintar, y quien llama
 * decide si revalida en segundo plano (`revalidar()`), que es lo que hace la
 * pantalla: enseña lo de antes y se actualiza sola cuando llega la respuesta.
 *
 * ── Por qué en memoria y no en `sessionStorage` ─────────────────────────────
 *
 * Porque la caché tiene que morir con la sesión de JS. `sessionStorage`
 * sobrevive a la navegación del login dentro de la misma pestaña, y ahí un
 * segundo usuario vería, aunque fuera un instante, las asignaciones del
 * anterior. Una variable de módulo no puede: el login recarga el documento y se
 * la lleva por delante.
 */

import { misFormulariosAPI } from '$lib/api/mis-formularios';
import type { PortalAssignmentCard, PortalListMeta } from '$lib/api/formularios-portal';

export interface ListaMisFormularios {
	data: PortalAssignmentCard[];
	meta: PortalListMeta | null;
	/** Momento en que respondió el servidor, en epoch ms. */
	at: number;
}

/**
 * 15 s.
 *
 * Cubre el rebote lista → formulario → atrás, que es donde duele, sin llegar a
 * ocultar una asignación recién creada por HSEQ: pasado el TTL la pantalla
 * sigue pintando lo viejo y revalida por detrás, así que el techo real de
 * desactualización no es el TTL sino lo que tarde esa petición.
 */
const TTL_MS = 15_000;

let cache: ListaMisFormularios | null = null;
let enVuelo: Promise<ListaMisFormularios> | null = null;

/** Lo cacheado, fresco o no. `null` si nunca se cargó. */
export function listaCacheada(): ListaMisFormularios | null {
	return cache;
}

export function estaFresca(lista: ListaMisFormularios | null): boolean {
	return lista !== null && Date.now() - lista.at < TTL_MS;
}

/**
 * Invalida la caché tras una operación que cambia la lista.
 *
 * La llaman el guardado de borrador y el envío: los dos alteran las tarjetas
 * (aparece un borrador, o la asignación pasa a «completada»), y volver a la
 * lista dentro del TTL enseñaría el estado anterior sin ni siquiera revalidar.
 */
export function invalidarMisFormularios(): void {
	cache = null;
}

/**
 * Trae la lista, de la caché si está fresca.
 *
 * Las peticiones simultáneas comparten una sola: la pestaña de
 * `/dashboard/formularios` y la ruta propia montan el mismo componente, y el
 * refresco por `visibilitychange` puede coincidir con la carga inicial.
 *
 * No acepta `AbortSignal` a propósito. Al compartirse la petición, un `abort`
 * de quien se desmonta rechazaría también la de quien sigue en pantalla; el
 * componente descarta el resultado tardío con su propio testigo, que es lo
 * mismo para una respuesta de este tamaño.
 */
export function cargarLista({ forzar = false } = {}): Promise<ListaMisFormularios> {
	if (!forzar && estaFresca(cache)) return Promise.resolve(cache!);
	if (enVuelo) return enVuelo;

	const peticion = misFormulariosAPI.listar().then(({ data, meta }) => {
		cache = { data, meta: meta ?? null, at: Date.now() };
		return cache;
	});
	enVuelo = peticion;
	/// El `catch` vacío es solo para que este eslabón no cuente como rechazo sin
	/// manejar; quien llamó sigue recibiendo `peticion` con su error intacto.
	peticion.catch(() => {}).finally(() => {
		if (enVuelo === peticion) enVuelo = null;
	});
	return peticion;
}
