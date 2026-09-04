/**
 * Vitest del frontend.
 *
 * Aparte de `vite.config.ts` a propósito: aquel arranca el plugin de
 * SvelteKit, que exige el runtime de `$app/*` y un servidor de desarrollo.
 * Lo que se prueba aquí son los BUILDERS del canvas —funciones puras que
 * producen el snapshot de un workbook de Univer— y no necesitan navegador ni
 * enrutador. Por eso `environment: 'node'`.
 *
 * El alias `$lib` se declara a mano por lo mismo: sin el plugin de SvelteKit
 * nadie lo resuelve.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// Sin el plugin de SvelteKit nadie resuelve `$app/*`. Se apunta a un
			// doble mínimo para poder probar módulos de `$lib` que lo importan
			// —el cliente de socket, sin ir más lejos— en vez de dejarlos sin
			// test por una cuestión de fontanería.
			'$app/environment': fileURLToPath(new URL('./tests/dobles/app-environment.ts', import.meta.url))
		}
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		// Los módulos del portal se importan como si estuvieran en el navegador
		// (`browser: true` en el doble de `$app/environment`) y algunos leen
		// `localStorage` al cargarse. Sin este doble, importarlos falla.
		setupFiles: ['./tests/dobles/almacenamiento.ts'],
		// Univer y ExcelJS son pesados de cargar; el arranque de un worker por
		// archivo cuesta más que ejecutar toda la suite en uno.
		pool: 'threads',
		maxWorkers: 1,
		minWorkers: 1
	}
});
