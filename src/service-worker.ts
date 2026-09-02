/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Service worker del portal del conductor.
 *
 * Lo que hace y —más importante— lo que NO hace:
 *
 *  - **No intercepta mutaciones.** Ningún `POST`, `PUT` o `DELETE` pasa por aquí.
 *    Simular un éxito offline haría que el conductor viera «enviado» algo que no
 *    salió del teléfono. Los envíos los gobierna la outbox de IndexedDB, que sí
 *    sabe reintentar de forma idempotente.
 *
 *  - **No cachea respuestas con datos personales.** Las listas y los envíos del
 *    conductor viven en IndexedDB, que es por origen y por dispositivo. Cache
 *    Storage es compartida entre pestañas y sobrevive al logout: dejar ahí el
 *    preoperacional de un conductor lo expondría al siguiente que use el mismo
 *    teléfono.
 *
 *  - **No cachea URLs firmadas de S3 ni nada con token en el query string.** Una
 *    URL firmada caduca; servirla desde caché devolvería un 403 confuso, y
 *    guardarla deja una credencial en disco.
 *
 * Estrategias, según el documento:
 *
 *  - assets del build y estáticos versionados → cache-first (son inmutables:
 *    llevan el hash en el nombre);
 *  - shell de navegación → stale-while-revalidate (abre al instante y se
 *    actualiza por detrás);
 *  - todo lo demás → red, sin caché.
 */

import { build, files, version } from '$service-worker';

/// El nombre incluye la versión del build: al desplegar, las cachés viejas se
/// vuelven inalcanzables y se borran en `activate`.
const CACHE_ASSETS = `cotransmeq-assets-${version}`;
const CACHE_SHELL = `cotransmeq-shell-${version}`;

/**
 * Assets inmutables. `build` trae los chunks con hash y `files` lo estático de
 * `/static`.
 *
 * Se filtran los mapas de fuentes: no sirven de nada al conductor y ocupan
 * megabytes de la cuota que la evidencia necesita.
 */
const PRECACHE = [...build, ...files].filter((ruta) => !ruta.endsWith('.map'));

/** Rutas del portal que deben abrir sin red. */
const SHELL_PATHS = [
	'/public/portal',
	'/public/portal/formularios',
	'/public/portal/desprendibles',
	'/public/portal/servicios',
	'/public/portal/dias-laborados'
];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_ASSETS);
			/// `addAll` falla en bloque si un solo recurso falla. Se añaden de uno en
			/// uno para que un asset ausente no impida instalar el worker entero.
			await Promise.all(
				PRECACHE.map(async (ruta) => {
					try {
						await cache.add(new Request(ruta, { cache: 'reload' }));
					} catch {
						/// Un asset que no se pudo precachear se pedirá por red.
					}
				})
			);
			/// `skipWaiting` para que un despliegue nuevo se active sin esperar a que
			/// el conductor cierre todas las pestañas: en un teléfono, esa pestaña
			/// puede quedar abierta semanas.
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const vigentes = new Set([CACHE_ASSETS, CACHE_SHELL]);
			for (const nombre of await caches.keys()) {
				/// Solo se borran las cachés de este proyecto: otras aplicaciones
				/// pueden compartir origen en desarrollo.
				if (nombre.startsWith('cotransmeq-') && !vigentes.has(nombre)) {
					await caches.delete(nombre);
				}
			}
			await sw.clients.claim();
		})()
	);
});

/** ¿Es un asset inmutable del build? */
function esAssetPrecacheado(url: URL): boolean {
	return PRECACHE.includes(url.pathname);
}

/** ¿Es una navegación a una pantalla del portal? */
function esShellDelPortal(request: Request, url: URL): boolean {
	if (request.mode !== 'navigate') return false;
	return SHELL_PATHS.some((base) => url.pathname === base || url.pathname.startsWith(`${base}/`));
}

/**
 * ¿Debe quedar completamente fuera del service worker?
 *
 * Se excluye todo lo que sea API, subida a S3, o traiga credenciales en la URL.
 */
function esIntocable(request: Request, url: URL): boolean {
	if (request.method !== 'GET') return true;
	if (url.origin !== sw.location.origin) return true;
	if (url.pathname.startsWith('/api/')) return true;
	/// `token` en el query string es el magic link; `X-Amz-` marca una URL firmada.
	if (url.searchParams.has('token')) return true;
	for (const clave of url.searchParams.keys()) {
		if (clave.startsWith('X-Amz-')) return true;
	}
	return false;
}

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);

	if (esIntocable(request, url)) return;

	if (esAssetPrecacheado(url)) {
		/// Cache-first: el nombre lleva hash, así que el contenido no puede cambiar
		/// sin cambiar la URL. Ir a la red sería gastar datos por nada.
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_ASSETS);
				const cacheada = await cache.match(request);
				if (cacheada) return cacheada;
				const respuesta = await fetch(request);
				if (respuesta.ok) cache.put(request, respuesta.clone());
				return respuesta;
			})()
		);
		return;
	}

	if (esShellDelPortal(request, url)) {
		/// Stale-while-revalidate: se sirve lo cacheado de inmediato y se actualiza
		/// por detrás. Es lo que hace que el portal abra al instante en modo avión.
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_SHELL);
				const cacheada = await cache.match(request);

				const red = fetch(request)
					.then((respuesta) => {
						/// Solo se cachea el shell renderizado, no un error ni una
						/// redirección al login.
						if (respuesta.ok && respuesta.type === 'basic') {
							cache.put(request, respuesta.clone());
						}
						return respuesta;
					})
					.catch(() => null);

				if (cacheada) {
					/// `waitUntil` mantiene vivo el worker hasta que la revalidación
					/// termine, aunque la respuesta ya se haya entregado.
					event.waitUntil(red.then(() => undefined));
					return cacheada;
				}

				const respuesta = await red;
				if (respuesta) return respuesta;

				/// Sin caché y sin red: se devuelve el shell de la raíz del portal si
				/// está, y si no una página mínima. Un error de red crudo en una
				/// navegación deja al conductor con la pantalla del navegador.
				const fallback = await cache.match('/public/portal/formularios');
				if (fallback) return fallback;
				return new Response(
					'<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
						'<body style="font-family:system-ui;padding:2rem;text-align:center">' +
						'<h1>Sin conexión</h1>' +
						'<p>Abre la aplicación una vez con señal para poder usarla sin conexión.</p>',
					{ status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
				);
			})()
		);
	}
});

/**
 * Mensajes desde la aplicación.
 *
 * `SKIP_WAITING` permite que la UI ofrezca «actualizar ahora» cuando detecta un
 * worker nuevo esperando, en vez de forzar la recarga a mitad de una inspección.
 */
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});
