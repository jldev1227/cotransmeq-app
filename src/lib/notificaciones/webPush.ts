/**
 * Avisos del navegador (Web Push) para la campana del dashboard.
 *
 * Flujo:
 *  1. El usuario pulsa «Activar» → el navegador pide permiso (solo se puede
 *     pedir tras un clic; Chrome bloquea las peticiones espontáneas).
 *  2. Con permiso, `PushManager.subscribe` crea la suscripción con la clave
 *     VAPID pública del backend y se guarda en `usuario_web_push`.
 *  3. Cada notificación nueva sale también por push; el service worker la
 *     muestra como aviso del sistema si el usuario no está mirando la app.
 *
 * El permiso es del navegador, no del usuario: si en este equipo inicia sesión
 * otra persona, `sincronizarWebPush` reasigna la suscripción a quien tiene la
 * sesión, y `desuscribirAlCerrarSesion` la desactiva al salir.
 */
import { browser } from '$app/environment';
import { fetchConSesion } from '$lib/api/fetchConSesion';

const BASE = '/api/notificaciones/web-push';

export type EstadoWebPush =
	/** Navegador sin Service Worker / Push (Safari antiguo, http sin localhost…). */
	| 'no-soportado'
	/** El backend no tiene claves VAPID. */
	| 'no-configurado'
	/** El usuario bloqueó las notificaciones para este sitio. */
	| 'bloqueado'
	| 'inactivo'
	| 'activo';

function token(): string | null {
	return browser ? localStorage.getItem('transmeralda_token') : null;
}

function headers(): Record<string, string> {
	const h: Record<string, string> = { 'Content-Type': 'application/json' };
	const t = token();
	if (t) h.Authorization = `Bearer ${t}`;
	return h;
}

export function webPushSoportado(): boolean {
	return (
		browser &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

let clavePromesa: Promise<string | null> | null = null;
function clavePublica(): Promise<string | null> {
	clavePromesa ??= fetchConSesion(`${BASE}/clave`, { headers: headers() })
		.then((r) => (r.ok ? r.json() : { clave: null }))
		.then((d: { clave: string | null }) => d.clave)
		.catch(() => {
			clavePromesa = null;
			return null;
		});
	return clavePromesa;
}

/** La clave VAPID llega en base64url; `subscribe` la quiere en bytes. */
function bytesDeBase64Url(b64: string): Uint8Array<ArrayBuffer> {
	const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
	const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
	for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
	return bytes;
}

async function registro(): Promise<ServiceWorkerRegistration> {
	return navigator.serviceWorker.ready;
}

async function guardar(sub: PushSubscription): Promise<void> {
	const res = await fetchConSesion(`${BASE}/suscripcion`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify(sub.toJSON())
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.error ?? 'No se pudo registrar este navegador');
	}
}

export async function estadoWebPush(): Promise<EstadoWebPush> {
	if (!webPushSoportado()) return 'no-soportado';
	if (Notification.permission === 'denied') return 'bloqueado';
	if (!(await clavePublica())) return 'no-configurado';
	if (Notification.permission !== 'granted') return 'inactivo';
	const sub = await (await registro()).pushManager.getSubscription();
	return sub ? 'activo' : 'inactivo';
}

/** Debe llamarse desde un clic: pide permiso y suscribe este navegador. */
export async function activarWebPush(): Promise<EstadoWebPush> {
	if (!webPushSoportado()) return 'no-soportado';
	const clave = await clavePublica();
	if (!clave) return 'no-configurado';
	const permiso = await Notification.requestPermission();
	if (permiso === 'denied') return 'bloqueado';
	if (permiso !== 'granted') return 'inactivo';

	const reg = await registro();
	let sub = await reg.pushManager.getSubscription();
	/// Una suscripción hecha con otra clave (se rotó VAPID) no sirve: el
	/// servicio de push rechazaría todo lo que firme el backend.
	const actual = sub?.options.applicationServerKey;
	if (sub && actual && !mismaClave(new Uint8Array(actual), bytesDeBase64Url(clave))) {
		await sub.unsubscribe();
		sub = null;
	}
	sub ??= await reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: bytesDeBase64Url(clave)
	});
	await guardar(sub);
	return 'activo';
}

export async function desactivarWebPush(): Promise<EstadoWebPush> {
	if (!webPushSoportado()) return 'no-soportado';
	const sub = await (await registro()).pushManager.getSubscription();
	if (sub) {
		await fetchConSesion(`${BASE}/desuscribir`, {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ endpoint: sub.endpoint })
		}).catch(() => {});
		await sub.unsubscribe();
	}
	return 'inactivo';
}

/**
 * Al entrar al dashboard: si el permiso ya está concedido, vuelve a registrar
 * la suscripción con el usuario de la sesión actual. No pide permiso nunca.
 */
export async function sincronizarWebPush(): Promise<void> {
	try {
		if (!webPushSoportado() || Notification.permission !== 'granted' || !token()) return;
		if (!(await clavePublica())) return;
		await activarWebPush();
	} catch {
		/// Es un extra: un fallo aquí no debe molestar al entrar.
	}
}

const PLAZO_DESUSCRIBIR_MS = 2_000;

/**
 * Antes de borrar el token: que el siguiente usuario de este equipo no reciba
 * los avisos del anterior. `keepalive` deja salir la petición aunque la
 * página navegue a `/login` enseguida.
 *
 * Devuelve una promesa para que el cierre de sesión la espere ANTES de cerrar
 * la sesión en el backend: después, la desuscripción volvería con 401 y el
 * navegador seguiría recibiendo avisos del usuario que salió. Nunca falla y
 * nunca tarda más de `PLAZO_DESUSCRIBIR_MS`: `serviceWorker.ready` no se
 * resuelve jamás si no hay service worker registrado.
 */
export function desuscribirAlCerrarSesion(): Promise<void> {
	if (!webPushSoportado() || Notification.permission !== 'granted') return Promise.resolve();
	const h = headers();
	const desuscribir = navigator.serviceWorker.ready
		.then((reg) => reg.pushManager.getSubscription())
		.then(async (sub) => {
			if (!sub) return;
			/// `ignorar401`: si la sesión ya no vale, quien está saliendo no
			/// necesita que lo manden al login por esto.
			await fetchConSesion(`${BASE}/desuscribir`, {
				method: 'POST',
				headers: h,
				body: JSON.stringify({ endpoint: sub.endpoint }),
				keepalive: true,
				ignorar401: true
			});
		})
		.catch(() => {});
	const plazo = new Promise<void>((r) => setTimeout(r, PLAZO_DESUSCRIBIR_MS));
	return Promise.race([desuscribir, plazo]);
}

/** Reenvía mi última notificación como aviso, para comprobar que llega. */
export async function probarWebPush(): Promise<{ enviados: number; fallidos: number }> {
	const res = await fetchConSesion(`${BASE}/prueba`, {
		method: 'POST',
		headers: headers(),
		body: '{}'
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body?.error ?? 'No se pudo enviar la prueba');
	return body;
}

function mismaClave(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
