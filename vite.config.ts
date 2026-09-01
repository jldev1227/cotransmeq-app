import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	worker: {
		// OBLIGATORIO para `src/lib/editor/univer/formula.worker.ts`.
		//
		// Ese worker se instancia con `new Worker(url, { type: 'module' })` y
		// dentro importa `@univerjs/presets`, que hace code-splitting. El
		// default de Vite es `'iife'`, y rollup rechaza IIFE/UMD en cuanto hay
		// más de un chunk:
		//   Invalid value "iife" for option "worker.format" — UMD and IIFE
		//   output formats are not supported for code-splitting builds.
		//
		// En `dev` no se nota porque Vite sirve los módulos sin bundlear; el
		// fallo solo aparece en `vite build`.
		format: 'es'
	},
	resolve: {
		// Univer y nuestros componentes comparten @wendellhu/redi como dependencia
		// transitiva. Sin dedupe Vite bundlea dos copias y el motor protesta:
		//   "[redi]: You are loading scripts of redi more than once!"
		dedupe: [
			'@wendellhu/redi',
			'rxjs',
			'@univerjs/core',
			'@univerjs/ui',
			'@univerjs/sheets',
			'@univerjs/sheets-ui',
			'@univerjs/themes',
			'@univerjs/design',
			'@univerjs/engine-formula',
			'@univerjs/engine-render',
			'@univerjs/protocol',
			'@univerjs/icons',
			'@univerjs/docs',
			'@univerjs/docs-ui'
		]
	},
	optimizeDeps: {
		// Estos paquetes se importan como side-effect (registran mixins) y
		// Vite los pre-bundlea para evitar problemas de orden.
		include: [
			'@univerjs/core',
			'@univerjs/core/facade',
			'@univerjs/ui',
			'@univerjs/ui/facade',
			'@univerjs/sheets',
			'@univerjs/sheets/facade',
			'@univerjs/sheets-ui',
			'@univerjs/sheets-ui/facade',
			'@univerjs/docs',
			'@univerjs/docs-ui',
			'@univerjs/themes',
			'@univerjs/design',
			'@wendellhu/redi'
		]
	}
});
