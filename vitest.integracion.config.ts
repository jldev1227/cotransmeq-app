/**
 * Suite de integración del cliente de socket.
 *
 * Separada de `vitest.config.ts` porque estos tests levantan un socket.io de
 * verdad y mantienen el servidor caído más de veinte segundos: es exactamente
 * lo que hace que demuestren algo (la configuración anterior se rendía a los
 * ~15 s) y también lo que los hace inaceptables en la suite que se corre en
 * cada guardado.
 *
 *   npm run test:reconexion
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$app/environment': fileURLToPath(
				new URL('./tests/dobles/app-environment.ts', import.meta.url)
			)
		}
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/integracion/**/*.test.ts'],
		setupFiles: ['./tests/dobles/almacenamiento.ts'],
		// Los tests atan un puerto fijo y se pisarían entre sí en paralelo.
		pool: 'threads',
		maxWorkers: 1,
		minWorkers: 1,
		fileParallelism: false,
		testTimeout: 90_000,
		hookTimeout: 30_000
	}
});
