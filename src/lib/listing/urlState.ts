/**
 * La URL como fuente de verdad del estado de una lista.
 *
 * Con esto, una vista filtrada se puede pegar en un chat y el compañero ve lo
 * mismo; el botón de atrás deshace el último filtro en vez de sacarte de la
 * página; y recargar no pierde nada. Hoy solo 8 de 23 páginas sincronizan algo
 * —tres de ellas nada más que la pestaña— y **ninguna** guarda la página, así
 * que compartir un enlace siempre devolvía a la primera.
 *
 * Se escribe SIEMPRE con `goto`, nunca con `history.replaceState` a pelo. La
 * diferencia no es de estilo: `history.replaceState` cambia la barra de
 * direcciones pero NO el store `page` de SvelteKit, así que `$page.url` se
 * queda con lo anterior. `/dashboard/conductores` hacía eso y su
 * `cambiarVista()` tomaba decisiones comparando contra una URL obsoleta.
 */

import { goto } from '$app/navigation'
import { browser } from '$app/environment'
import { aParams, leerDeParams, type DefinicionesFiltros } from './filtros'

export interface OpcionesUrl {
	/**
	 * `true` (por defecto) reemplaza la entrada del historial en vez de añadir
	 * una. Teclear en el buscador no debe dejar una entrada por letra: con
	 * `push` harían falta once «atrás» para salir de una página tras escribir
	 * «villanueva».
	 */
	reemplazar?: boolean
	/** Conserva parámetros ajenos a los filtros (tokens de un enlace, etc.). */
	conservarAjenos?: boolean
}

/**
 * Une los parámetros de los filtros con los que ya había y no nos pertenecen.
 *
 * Sin esto, aplicar un filtro borraría de la URL cualquier parámetro que la
 * página no declare —el `?conductor=<id>` que abre un detalle, por ejemplo—.
 */
function combinar(
	actuales: URLSearchParams,
	nuevos: URLSearchParams,
	propios: string[],
	conservarAjenos: boolean
): URLSearchParams {
	const salida = new URLSearchParams()

	if (conservarAjenos) {
		for (const [k, v] of actuales.entries()) {
			if (!propios.includes(k)) salida.set(k, v)
		}
	}
	for (const [k, v] of nuevos.entries()) salida.set(k, v)

	return salida
}

/**
 * Crea el puente entre unos filtros declarados y la barra de direcciones.
 *
 * ```ts
 * const url = crearEstadoUrl(DEFS)
 * let filtros = $state(url.leerInicial())
 * $effect(() => url.escribir(page.url, filtros))
 * ```
 */
export function crearEstadoUrl<F>(defs: DefinicionesFiltros<F>, opciones: OpcionesUrl = {}) {
	const { reemplazar = true, conservarAjenos = true } = opciones
	const propios = Object.keys(defs)

	return {
		/** Estado que describe esta URL. Lo ausente toma su valor por defecto. */
		leer(url: URL): F {
			return leerDeParams(defs, url.searchParams)
		},

		/**
		 * Estado inicial, leído de la barra de direcciones REAL.
		 *
		 * Existe porque `leer(page.url)` en la inicialización del componente no
		 * es de fiar: durante la hidratación `page` puede no reflejar todavía la
		 * URL con la que se abrió la pestaña, así que los filtros nacían vacíos
		 * y el efecto que escribe la URL los borraba de la barra antes de que
		 * nadie los leyera. Abrir un enlace filtrado mostraba la lista completa.
		 *
		 * `window.location` sí está poblado en ese momento. En el servidor no
		 * hay ninguno de los dos: allí se devuelven los valores por defecto y la
		 * hidratación en el cliente pone lo que toca.
		 */
		leerInicial(): F {
			if (!browser) return leerDeParams(defs, new URLSearchParams(''))
			return leerDeParams(defs, new URLSearchParams(window.location.search))
		},

		/**
		 * Lleva los filtros a la URL.
		 *
		 * No navega si la cadena resultante es idéntica a la actual: sin esa
		 * comprobación, un `$effect` que escribe y lee la misma URL se
		 * realimenta y entra en bucle.
		 */
		escribir(urlActual: URL, valores: F): void {
			const combinados = combinar(
				urlActual.searchParams,
				aParams(defs, valores),
				propios,
				conservarAjenos
			)

			const consulta = combinados.toString()
			const destino = consulta ? `${urlActual.pathname}?${consulta}` : urlActual.pathname
			const actual = urlActual.search
				? `${urlActual.pathname}${urlActual.search}`
				: urlActual.pathname

			if (destino === actual) return

			void goto(destino, {
				replaceState: reemplazar,
				// La lista no debe saltar al principio al filtrar…
				noScroll: true,
				// …ni robarle el foco al input mientras se escribe.
				keepFocus: true,
				// Sin esto SvelteKit reejecutaría los `load`, y estas páginas
				// cargan sus datos por su cuenta: sería una petición de más.
				invalidateAll: false
			})
		},

		/** Parámetros propios, por si la página necesita construir un enlace. */
		aParams(valores: F): URLSearchParams {
			return aParams(defs, valores)
		}
	}
}
