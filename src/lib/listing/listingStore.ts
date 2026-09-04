/**
 * Caché de una lista, con revalidación en segundo plano.
 *
 * Generaliza `stores/liquidacionesServiciosCache.ts`, que es el único store del
 * proyecto que separa el estado de la caché de la lógica de fetch y el único
 * que invalida por firma de filtros. Aquello estaba cableado a los cuatro tabs
 * de liquidaciones (`TabId`); aquí la clave es libre, así que sirve para una
 * página con pestañas, para una sola lista, o para varias listas
 * independientes.
 *
 * MODELO
 *
 *   entrar        → ¿fresco y limpio? → pintar de caché, cero peticiones
 *                   ¿viejo o sucio?   → pintar caché + revalidar de fondo
 *   evento socket → marcar sucio (y contar si la lista no se está viendo)
 *   cambiar filtro→ la firma cambia, la caché deja de aplicar
 *
 * Lo importante es la firma: si el usuario cambia un filtro, el dato guardado
 * ya no describe lo que se está pidiendo aunque tenga dos segundos de vida.
 * Servir cincuenta filas de otro filtro es peor que un spinner.
 *
 * Es un `writable` clásico y no runes, por el mismo motivo que su antecesor:
 * la mayoría de las páginas de lista siguen en modo legacy —`conductores`,
 * `flota` y `clientes` no tienen un solo rune— y un `$state` de un `.svelte.ts`
 * no dispararía sus bloques `$:`. Con un store funciona en los dos modos, que
 * es lo que permite migrarlas una a una en vez de todas a la vez.
 */

import { get, writable } from 'svelte/store'

/** Ventana de frescura por defecto. Pasada, se repinta pero se revalida. */
export const TTL_POR_DEFECTO = 60_000

export interface EstadoLista<T> {
	/** Última carga correcta. `null` mientras no haya habido ninguna. */
	items: T[] | null
	/** Firma de los filtros con la que se trajeron `items`. */
	firma: string
	/** Epoch ms de la última carga correcta. `0` si nunca. */
	traidoEn: number
	/** Un evento de socket tocó esta lista desde la última carga. */
	sucio: boolean
	/** Hay una petición en vuelo. */
	cargando: boolean
	/** Mensaje del último fallo, o cadena vacía. */
	error: string
	/** Total de registros en el servidor, para la paginación. */
	total: number
	/** Eventos recibidos mientras la lista no estaba visible. Alimenta el badge. */
	pendientes: number
}

function listaVacia<T>(): EstadoLista<T> {
	return {
		items: null,
		firma: '',
		traidoEn: 0,
		sucio: false,
		cargando: false,
		error: '',
		total: 0,
		pendientes: 0
	}
}

export interface OpcionesLista {
	/** Milisegundos que el dato se considera fresco. */
	ttl?: number
}

/**
 * Crea una caché para una o varias listas identificadas por clave.
 *
 * `clave` distingue listas independientes dentro de la misma página —las
 * pestañas de liquidaciones, por ejemplo—. Una página con una sola lista puede
 * ignorarla y usar la de por defecto.
 */
export function crearListingStore<T>(opciones: OpcionesLista = {}) {
	const ttl = opciones.ttl ?? TTL_POR_DEFECTO
	const store = writable<Record<string, EstadoLista<T>>>({})

	/** Peticiones en vuelo por clave+firma, para no lanzar dos veces la misma. */
	const enVuelo = new Map<string, Promise<void>>()

	const CLAVE_UNICA = '_'

	function estadoDe(clave: string): EstadoLista<T> {
		return get(store)[clave] ?? listaVacia<T>()
	}

	function mutar(clave: string, parche: Partial<EstadoLista<T>>) {
		store.update((s) => ({ ...s, [clave]: { ...(s[clave] ?? listaVacia<T>()), ...parche } }))
	}

	return {
		subscribe: store.subscribe,

		/** Estado actual de una lista; útil fuera de un contexto reactivo. */
		estado(clave = CLAVE_UNICA): EstadoLista<T> {
			return estadoDe(clave)
		},

		/**
		 * ¿Se puede pintar algo ya, sin spinner?
		 *
		 * Cierto cuando hay dato de ESTA misma firma, aunque esté viejo o sucio.
		 * Es lo que permite mostrar la tabla al instante al volver a una página
		 * y actualizarla sola cuando llegue la respuesta.
		 */
		puedePintar(firma: string, clave = CLAVE_UNICA): boolean {
			const e = estadoDe(clave)
			return !!e.items && e.firma === firma
		},

		/** ¿Hay que ir al servidor? */
		necesitaFetch(firma: string, clave = CLAVE_UNICA): boolean {
			const e = estadoDe(clave)
			if (!e.items) return true
			if (e.firma !== firma) return true
			if (e.sucio) return true
			return Date.now() - e.traidoEn > ttl
		},

		/**
		 * Carga si hace falta, evitando peticiones duplicadas.
		 *
		 * Si ya hay una petición en vuelo para la misma clave y firma, se
		 * devuelve esa en vez de lanzar otra: sin esto, dos componentes que
		 * pidan la misma lista a la vez —o un `$effect` que se dispare dos
		 * veces— provocan dos peticiones idénticas.
		 */
		async cargar(
			firma: string,
			traer: () => Promise<{ items: T[]; total?: number }>,
			clave = CLAVE_UNICA
		): Promise<void> {
			if (!this.necesitaFetch(firma, clave)) return

			const claveVuelo = `${clave}::${firma}`
			const yaEnVuelo = enVuelo.get(claveVuelo)
			if (yaEnVuelo) return yaEnVuelo

			mutar(clave, { cargando: true, error: '' })

			const promesa = traer()
				.then(({ items, total }) => {
					mutar(clave, {
						items,
						firma,
						total: total ?? items.length,
						traidoEn: Date.now(),
						sucio: false,
						cargando: false,
						error: '',
						pendientes: 0
					})
				})
				.catch((e: unknown) => {
					// `items` se deja intacto a propósito: vaciar una tabla ya
					// pintada por un fallo de red deja al usuario peor que
					// dejarle el último dato bueno junto al aviso.
					mutar(clave, {
						cargando: false,
						error: e instanceof Error ? e.message : 'No se pudo cargar la lista'
					})
				})
				.finally(() => {
					enVuelo.delete(claveVuelo)
				})

			enVuelo.set(claveVuelo, promesa)
			return promesa
		},

		/**
		 * Marca la lista como desactualizada por un evento de socket.
		 *
		 * `visible` distingue los dos casos: si el usuario está viendo la lista,
		 * quien llama va a revalidar ya y no hay que contar; si no la está
		 * viendo, se acumula el contador que alimenta el badge.
		 */
		ensuciar(clave = CLAVE_UNICA, visible = true) {
			const e = estadoDe(clave)
			mutar(clave, { sucio: true, pendientes: visible ? 0 : e.pendientes + 1 })
		},

		/**
		 * Aplica un cambio puntual sobre un elemento ya cargado.
		 *
		 * Es el parche por id: ante `servicio:actualizado` se puede reemplazar
		 * esa fila sin volver a pedir la lista entera. Las páginas que hoy
		 * refrescan todo con cada evento hacen una petición completa por cada
		 * cambio de cualquier usuario.
		 */
		parchear(fn: (items: T[]) => T[], clave = CLAVE_UNICA) {
			const e = estadoDe(clave)
			if (!e.items) return
			mutar(clave, { items: fn(e.items) })
		},

		/** Al entrar a una lista: apaga su badge. La suciedad la resuelve el fetch. */
		ver(clave = CLAVE_UNICA) {
			mutar(clave, { pendientes: 0 })
		},

		/** Fuerza que la próxima comprobación pida al servidor. */
		invalidar(clave?: string) {
			if (clave) {
				mutar(clave, { sucio: true })
				return
			}
			store.update((s) => {
				const siguiente: Record<string, EstadoLista<T>> = {}
				for (const k of Object.keys(s)) siguiente[k] = { ...s[k], sucio: true }
				return siguiente
			})
		},

		/** Estado inicial limpio. Para el `onDestroy` de la página. */
		reiniciar() {
			enVuelo.clear()
			store.set({})
		}
	}
}
