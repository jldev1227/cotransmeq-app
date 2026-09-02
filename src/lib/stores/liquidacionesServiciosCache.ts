import { writable, get } from 'svelte/store';

/**
 * Caché por tab de `/dashboard/liquidaciones-servicios`.
 *
 * PROBLEMA QUE RESUELVE: la página cargaba SOLO el tab activo en `onMount`
 * y cada cambio de tab volvía a pedir al servidor. Si recargabas estando en
 * Facturas y luego ibas a Terceros, Terceros salía vacío hasta que su
 * reactivo disparaba otro fetch. Ir y volver entre tabs eran dos peticiones
 * más, siempre.
 *
 * MODELO:
 *
 *   entrar al tab → ¿fresco (<TTL) y limpio? → pintar de caché, 0 peticiones
 *                   ¿sucio o viejo?          → pintar caché + refetch de fondo
 *   socket del tab visible                   → refetch inmediato
 *   socket de tab oculto                     → marcar sucio + badge en el tab
 *
 * La clave de esto es `key`: la firma de los filtros + página con la que se
 * trajo el dato. Si el usuario cambia un filtro, la `key` deja de casar y la
 * caché no aplica aunque el dato sea reciente — servir 50 registros de otro
 * filtro sería peor que un spinner.
 *
 * Es un `writable` clásico y NO runes: `+page.svelte` está en modo legacy
 * (27 reactivos `$:`, cero runes) y un `$state` de un `.svelte.ts` no
 * dispararía sus bloques reactivos. Con `$cacheLiquidaciones` funciona en
 * los dos modos.
 */

export type TabId = 'liquidaciones' | 'facturas' | 'terceros' | 'configuracion';

export const TABS: TabId[] = ['liquidaciones', 'facturas', 'terceros', 'configuracion'];

/** Ventana de frescura por defecto. Pasada, el dato se repinta pero se revalida. */
export const TTL_MS = 60_000;

export interface EstadoTab<T = unknown> {
	/** Última carga correcta. `null` mientras no haya habido ninguna. */
	data: T | null;
	/** Firma de filtros+página con la que se trajo `data`. */
	key: string;
	/** Epoch ms de la última carga correcta. `0` si nunca. */
	fetchedAt: number;
	/** Un socket tocó este tab desde la última carga. */
	dirty: boolean;
	/** Hay una petición en vuelo. */
	loading: boolean;
	/** Mensaje del último fallo, o cadena vacía. */
	error: string;
	/**
	 * Nº de eventos de socket recibidos mientras el tab NO estaba visible.
	 * Alimenta el badge de la pestaña; se pone a cero al entrar.
	 */
	pendientes: number;
}

function tabVacio(): EstadoTab {
	return {
		data: null,
		key: '',
		fetchedAt: 0,
		dirty: false,
		loading: false,
		error: '',
		pendientes: 0
	};
}

function estadoInicial(): Record<TabId, EstadoTab> {
	return {
		liquidaciones: tabVacio(),
		facturas: tabVacio(),
		terceros: tabVacio(),
		configuracion: tabVacio()
	};
}

const store = writable<Record<TabId, EstadoTab>>(estadoInicial());

/** Store para `$cacheLiquidaciones` en los componentes. */
export const cacheLiquidaciones = { subscribe: store.subscribe };

function mutar(tab: TabId, patch: Partial<EstadoTab>) {
	store.update((s) => ({ ...s, [tab]: { ...s[tab], ...patch } }));
}

/** Snapshot del estado de un tab, sin suscribirse. */
export function leerTab<T = unknown>(tab: TabId): EstadoTab<T> {
	return get(store)[tab] as EstadoTab<T>;
}

/**
 * ¿Hay que ir al servidor?
 *
 * Sí cuando: no hay dato, la `key` cambió (otros filtros), un socket lo
 * ensució, o pasó el TTL.
 */
export function necesitaFetch(tab: TabId, key: string, ttl = TTL_MS): boolean {
	const t = get(store)[tab];
	if (!t.data) return true;
	if (t.key !== key) return true;
	if (t.dirty) return true;
	return Date.now() - t.fetchedAt > ttl;
}

/**
 * ¿Se puede pintar algo ya, sin spinner?
 *
 * True cuando hay dato de ESTA misma `key`, aunque esté viejo o sucio. Es lo
 * que permite el "pintar caché + refetch de fondo": el usuario ve la tabla
 * al instante y los datos se actualizan solos cuando llega la respuesta.
 */
export function puedePintar(tab: TabId, key: string): boolean {
	const t = get(store)[tab];
	return !!t.data && t.key === key;
}

export function comenzarFetch(tab: TabId) {
	mutar(tab, { loading: true, error: '' });
}

export function guardarDatos<T>(tab: TabId, key: string, data: T) {
	mutar(tab, {
		data,
		key,
		fetchedAt: Date.now(),
		dirty: false,
		loading: false,
		error: '',
		pendientes: 0
	});
}

export function fallarFetch(tab: TabId, error: string) {
	// `data` se deja intacto a propósito: si ya había una tabla pintada,
	// vaciarla por un fallo de red deja al usuario peor que dejarle el
	// último dato bueno con un aviso.
	mutar(tab, { loading: false, error });
}

/**
 * Marca un tab como desactualizado por un evento de socket.
 *
 * `visible` distingue los dos comportamientos: si el usuario está viendo el
 * tab, quien llama va a refetchear ya y no hay que contar pendientes; si no
 * lo está viendo, se acumula el contador que pinta el badge de la pestaña.
 */
export function ensuciar(tab: TabId, visible: boolean) {
	store.update((s) => ({
		...s,
		[tab]: {
			...s[tab],
			dirty: true,
			pendientes: visible ? 0 : s[tab].pendientes + 1
		}
	}));
}

/** Al entrar a un tab: apaga su badge. La suciedad la resuelve el fetch. */
export function verTab(tab: TabId) {
	mutar(tab, { pendientes: 0 });
}

/** Fuerza que el próximo `necesitaFetch` de todos los tabs dé true. */
export function invalidarTodo() {
	store.update((s) => {
		const next = { ...s };
		for (const t of TABS) next[t] = { ...next[t], dirty: true };
		return next;
	});
}

/** Estado inicial limpio. Para `onDestroy` de la página. */
export function resetCache() {
	store.set(estadoInicial());
}
