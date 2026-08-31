import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/// Vercel sigue siendo el destino predeterminado para conservar el rollback.
/// La imagen de Proxmox selecciona Node de forma explícita durante el build.
const adapter = process.env.DEPLOY_TARGET === 'node' ? nodeAdapter() : vercelAdapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: { adapter }
};

export default config;
