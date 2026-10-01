import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

const STORAGE_KEY = 'cotransmeq_portal_token';

/** Login del portal del conductor: destino de TODO cierre de sesión del portal. */
export const PORTAL_LOGIN = '/public/portal';

/**
 * Marca «en este dispositivo entra un conductor».
 *
 * Se escribe al iniciar sesión en el portal y sobrevive al logout y a la
 * caducidad del token: es lo que permite que `/` y `/login` devuelvan al
 * conductor a SU login cuando un fallo de la API o del frontend lo saca del
 * portal. Solo la borra un login administrativo, porque ese sí prueba que el
 * dispositivo no es (solo) de un conductor.
 */
const HOME_KEY = 'cotransmeq_portal_home';

export interface PortalSession {
	token: string;
	conductor: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
		email?: string;
	};
	expiresAt: string; // ISO date
}

function createPortalStore() {
	// Restore from localStorage
	let initial: PortalSession | null = null;
	if (browser) {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as PortalSession;
				if (new Date(parsed.expiresAt) > new Date()) {
					initial = parsed;
				} else {
					localStorage.removeItem(STORAGE_KEY);
				}
			}
		} catch {
			localStorage.removeItem(STORAGE_KEY);
		}
	}

	const { subscribe, set, update } = writable<PortalSession | null>(initial);

	return {
		subscribe,
		login(session: PortalSession) {
			if (browser) {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
				localStorage.setItem(HOME_KEY, '1');
			}
			set(session);
		},
		logout() {
			if (browser) localStorage.removeItem(STORAGE_KEY);
			set(null);
		},
		set,
		update
	};
}

export const portalSession = createPortalStore();

export const isAuthenticated = derived(portalSession, ($s) => !!$s);

export function esDispositivoDelPortal(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(HOME_KEY) === '1';
	} catch {
		return false;
	}
}

/** La llama el login administrativo: ese dispositivo ya no se trata como de conductor. */
export function olvidarDispositivoDelPortal(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(HOME_KEY);
	} catch {
		/* sin almacenamiento no hay marca que borrar */
	}
}

/**
 * `true` si la persona ESCRIBIÓ `/` o `/login` en la barra (o abrió un
 * marcador), y no llegó ahí empujada por la propia app.
 *
 * La marca del dispositivo existe para que un fallo de sesión no deje al
 * conductor en el login administrativo: un logout, un 401 que recarga
 * `/login` o el acceso directo de la PWA (`start_url: "/"`). Pero también
 * atrapaba a quien entró UNA vez a un enlace del portal y luego quiere el
 * login administrativo a propósito —una administradora que abrió el enlace
 * mágico de un conductor quedó sin poder entrar a su cuenta—, y la marca
 * solo la borra ese login que ya no podía ver.
 *
 * Se mira el DOCUMENTO con que arrancó la pestaña, no la ruta actual: `/`
 * pasa a `/login` con `goto`, y eso no crea una navegación nueva. Cuenta como
 * entrada directa si ese documento fue `/` o `/login`, sin referrer del mismo
 * origen (las redirecciones internas por `location.href` sí lo llevan) y
 * fuera de la PWA instalada.
 */
export function entradaDirectaAlLogin(): boolean {
	if (!browser) return false;
	try {
		if (window.matchMedia?.('(display-mode: standalone)').matches) return false;
		const nav = performance.getEntriesByType('navigation')[0] as
			| PerformanceNavigationTiming
			| undefined;
		if (!nav) return false;
		const ruta = new URL(nav.name).pathname.replace(/\/+$/, '') || '/';
		if (ruta !== '/' && ruta !== '/login') return false;
		if (document.referrer && new URL(document.referrer).origin === location.origin) return false;
		return true;
	} catch {
		return false;
	}
}

/**
 * Cierra la sesión del portal y lleva a su login. Nunca a `/login`.
 *
 * `replaceState` para que «atrás» no devuelva a la pantalla que acaba de
 * rechazar la sesión.
 */
export function expirarSesionPortal(): Promise<void> {
	portalSession.logout();
	return goto(PORTAL_LOGIN, { replaceState: true });
}

export const conductorNombre = derived(portalSession, ($s) =>
	$s ? `${$s.conductor.nombre} ${$s.conductor.apellido}` : ''
);

export const conductorCedula = derived(portalSession, ($s) =>
	$s ? $s.conductor.numero_identificacion : ''
);

export const diasRestantes = derived(portalSession, ($s) => {
	if (!$s) return 0;
	return Math.max(0, Math.ceil((new Date($s.expiresAt).getTime() - Date.now()) / 86400000));
});

/** Helper para obtener API base URL */
export function getApiBase(): string {
	if (!browser) return '';
	const API = (import.meta.env.VITE_API_URL as string) || '';
	return API.endsWith('/') ? API.slice(0, -1) : API;
}

/** Helper para hacer fetch autenticado */
export async function portalFetch(path: string, options: RequestInit = {}) {
	const session = get(portalSession);
	const token = session?.token || '';

	const base = getApiBase();
	const res = await fetch(`${base}/api${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(options.headers || {})
		}
	});

	const json = await res.json();
	if (!res.ok) throw { status: res.status, ...json };
	return json;
}

/** Descarga binarios autenticados del portal (PDF, imágenes, etc.). */
export async function portalFetchBlob(path: string, options: RequestInit = {}): Promise<Blob> {
	const session = get(portalSession);
	const token = session?.token || '';
	const base = getApiBase();
	const res = await fetch(`${base}/api${path}`, {
		...options,
		headers: {
			Accept: 'application/pdf',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(options.headers || {})
		}
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw { status: res.status, ...body };
	}
	return res.blob();
}
