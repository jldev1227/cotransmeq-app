import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/// Vercel sigue siendo el destino predeterminado para conservar el rollback.
/// La imagen de Proxmox selecciona Node de forma explícita durante el build.
const adapter = process.env.DEPLOY_TARGET === 'node' ? nodeAdapter() : vercelAdapter();

function origenDe(value, fallback) {
	try {
		return new URL(value || fallback).origin;
	} catch {
		return new URL(fallback).origin;
	}
}

const apiOrigin = origenDe(process.env.VITE_API_URL, 'https://api-cotransmeq.transmeralda.com');
const socketOrigin = origenDe(process.env.VITE_SOCKET_URL, apiOrigin);
const socketWebOrigin = socketOrigin.replace(/^https?/, (protocol) =>
	protocol === 'https' ? 'wss' : 'ws'
);
/** En desarrollo CSP compara el host literal; cada nombre de loopback necesita su entrada. */
const localConnections =
	process.env.NODE_ENV === 'production' || process.env.DEPLOY_TARGET === 'node'
		? []
		: [
				'http://localhost:4000',
				'ws://localhost:4000',
				'http://127.0.0.1:4000',
				'ws://127.0.0.1:4000'
			];

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'form-action': ['self'],
				'frame-ancestors': ['self'],
				'script-src': ['self', 'wasm-unsafe-eval', 'https://static.cloudflareinsights.com'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com', 'https://api.mapbox.com'],
				'connect-src': [
					'self',
					apiOrigin,
					socketOrigin,
					socketWebOrigin,
					'https://api.iconify.design',
					'https://api.mapbox.com',
					'https://events.mapbox.com',
					'https://*.tiles.mapbox.com',
					'https://*.blob.core.windows.net',
					'https://autocomplete.search.hereapi.com',
					'https://lookup.search.hereapi.com',
					'https://atlas.microsoft.com',
					'https://overpass-api.de',
					'https://geoportal.sgc.gov.co',
					'https://cloudflareinsights.com',
					...localConnections
				],
				'media-src': ['self', 'data:', 'blob:', 'https:'],
				'frame-src': ['self', 'blob:', 'data:'],
				'worker-src': ['self', 'blob:'],
				'child-src': ['self', 'blob:'],
				'manifest-src': ['self'],
				'upgrade-insecure-requests': true
			}
		}
	}
};

export default config;
