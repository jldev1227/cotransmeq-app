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
const localConnections =
	process.env.NODE_ENV === 'production' || process.env.DEPLOY_TARGET === 'node'
		? []
		: ['http://localhost:4000', 'ws://localhost:4000'];

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		adapter,
	}
};

export default config;
