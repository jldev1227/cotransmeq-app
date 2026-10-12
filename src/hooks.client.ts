import { dev } from '$app/environment';
import { env as envPublico } from '$env/dynamic/public';
import type { HandleClientError } from '@sveltejs/kit';

// Build marker — bumped to invalidate stale immutable CSS/JS bundles cached
// in the browser from previous deploys (Vercel edge cold cache + max-age).
const BUILD_MARKER = '2026-07-01-cache-bust-v1';

const RELOAD_KEY = 'chunk_reload_until';
const MAX_RELOADS_PER_SESSION = 1;

if (typeof window !== 'undefined') {
	window.addEventListener(
		'error',
		(event) => {
			if (dev) return;
			const msg = event?.message || '';
			if (!/Failed to fetch dynamically imported module/i.test(msg)) return;
			handleChunkError();
		},
		true
	);

	window.addEventListener('unhandledrejection', (event) => {
		if (dev) return;
		const reason: any = event?.reason;
		const msg = reason?.message || String(reason || '');
		if (!/Failed to fetch dynamically imported module/i.test(msg)) return;
		handleChunkError();
	});
}

function handleChunkError() {
	try {
		const now = Date.now();
		const until = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
		const reloads = Number(sessionStorage.getItem('chunk_reload_count') || 0);

		if (reloads >= MAX_RELOADS_PER_SESSION) {
			console.warn('[chunk-recovery] Max reloads reached, aborting');
			return;
		}

		sessionStorage.setItem(RELOAD_KEY, String(now + 60_000));
		sessionStorage.setItem('chunk_reload_count', String(reloads + 1));

		const url = new URL(window.location.href);
		url.searchParams.set('_r', String(Date.now()));
		window.location.replace(url.toString());
	} catch {
		/* noop */
	}
}

// ── Rastreo de errores (Sentry), OPCIONAL ──
//
// Solo se activa con `PUBLIC_SENTRY_DSN` en el entorno del servidor. Se lee en
// tiempo de ejecución (`$env/dynamic/public`), así que encenderlo o apagarlo no
// exige recompilar la imagen. Sin DSN no se descarga ni el SDK: el import es
// dinámico y el navegador nunca pide ese chunk.
const dsnSentry = envPublico.PUBLIC_SENTRY_DSN?.trim();
let sentry: typeof import('@sentry/sveltekit') | null = null;

if (dsnSentry && typeof window !== 'undefined') {
	import('@sentry/sveltekit')
		.then((S) => {
			S.init({
				dsn: dsnSentry,
				environment: envPublico.PUBLIC_SENTRY_ENVIRONMENT || (dev ? 'development' : 'production'),
				/// Los chunks viejos tras un despliegue ya se recuperan arriba con
				/// una recarga; reportarlos solo llenaría Sentry de ruido.
				ignoreErrors: [/Failed to fetch dynamically imported module/i],
				/// Nada de cuerpos, cabeceras ni query: llevan el token y datos
				/// personales (cédulas, salarios).
				dataCollection: {
					userInfo: false,
					cookies: false,
					httpHeaders: false,
					httpBodies: [],
					urlQueryParams: false
				}
			});
			sentry = S;
		})
		.catch(() => {
			// Sin Sentry la app funciona igual.
		});
}

export const handleError: HandleClientError = ({ error, event, status }) => {
	// Lo que hace SvelteKit cuando no hay hook: dejar el error en la consola.
	console.error(error);
	// Un 404 no es un fallo de la app.
	if (status < 500) return;
	sentry?.captureException(error, { tags: { ruta: event.route.id ?? event.url.pathname } });
};
