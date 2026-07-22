import { dev } from '$app/environment';

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
