/**
 * `localStorage` mínimo para la suite.
 *
 * Los módulos del portal se compilan con `browser: true` (ver
 * `dobles/app-environment.ts`) y algunos leen `localStorage` al IMPORTARSE:
 * `portalStore` recupera de ahí la sesión del magic link. En Node esa global no
 * existe, así que sin este doble el simple `import` de cualquier módulo que
 * dependa del store revienta antes de ejecutar un solo test.
 *
 * En memoria y sin persistencia entre archivos: no se prueba el almacenamiento,
 * solo se evita que su ausencia impida cargar el módulo.
 */

class AlmacenamientoEnMemoria implements Storage {
	#datos = new Map<string, string>();

	get length() {
		return this.#datos.size;
	}

	key(indice: number) {
		return [...this.#datos.keys()][indice] ?? null;
	}

	getItem(clave: string) {
		return this.#datos.get(clave) ?? null;
	}

	setItem(clave: string, valor: string) {
		this.#datos.set(clave, String(valor));
	}

	removeItem(clave: string) {
		this.#datos.delete(clave);
	}

	clear() {
		this.#datos.clear();
	}
}

if (typeof globalThis.localStorage === 'undefined') {
	Object.defineProperty(globalThis, 'localStorage', {
		value: new AlmacenamientoEnMemoria(),
		configurable: true
	});
}
