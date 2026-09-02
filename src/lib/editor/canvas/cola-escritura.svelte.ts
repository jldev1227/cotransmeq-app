/**
 * Cola de escrituras HTTP de un canvas.
 *
 * Existe porque `apiClient` **nunca reintenta mutaciones** (`shouldRetry`
 * solo admite `get/head/options`), y con razón: no puede saber si un POST
 * cualquiera es idempotente. Esta cola sí lo sabe de las suyas, así que
 * puede reintentar.
 *
 * ⚠️ CONTRATO: solo se encolan escrituras IDEMPOTENTES — el mismo cuerpo
 * enviado dos veces produce el mismo resultado. Vale para fijar un color o
 * un flag booleano. NO vale para altas: un reintento duplicaría la fila.
 *
 * Qué resuelve, en orden de importancia:
 *
 *  1. **Coalescing por clave.** Pintar una pestaña cinco veces seguidas
 *     produce UNA escritura con el último valor, no cinco. La clave es
 *     `${tipo}:${id}:${campo}`.
 *  2. **Una en vuelo por clave.** Dos escrituras del mismo campo no pueden
 *     llegar desordenadas al servidor; claves distintas van en paralelo.
 *  3. **Reintento con backoff.** Un corte de red de unos segundos deja de
 *     costar una edición perdida.
 *  4. **Estado observable.** Cuántas hay pendientes y cuántas fallaron, para
 *     que el indicador del header diga la verdad en vez de quedarse en
 *     «Guardando…» para siempre.
 *
 * Lo que NO hace: persistir. La cola vive en memoria; recargar la pestaña
 * pierde lo pendiente. Por eso `hayPendientes()` alimenta un `beforeunload`.
 */

const MAX_INTENTOS = 3;
const BACKOFF_BASE_MS = 800;

/** Trabajo pendiente de una clave. */
interface Entrada {
	clave: string;
	ejecutar: () => Promise<void>;
	/** Texto para el aviso de conflicto o el log. */
	descripcion: string;
	intentos: number;
	/** `true` mientras su promesa está en vuelo. */
	enVuelo: boolean;
	/** `true` si agotó los reintentos. Se conserva para poder reintentar. */
	fallida: boolean;
	ultimoError?: string;
}

export interface ColaEscrituraOpts {
	/** Se llama en cada cambio de estado, para refrescar el indicador. */
	onEstado?: (e: { pendientes: number; fallidas: number; ultimoGuardado: string | null }) => void;
	/** Una escritura agotó sus reintentos. */
	onFallo?: (e: { descripcion: string; error: string }) => void;
}

export interface ColaEscritura {
	/**
	 * Encola (o reemplaza) el trabajo de una clave.
	 *
	 * Si ya había uno pendiente para esa clave **y no está en vuelo**, se
	 * sustituye: solo interesa el último valor. Si está en vuelo, el nuevo
	 * espera a que termine y se ejecuta después.
	 */
	encolar: (clave: string, ejecutar: () => Promise<void>, descripcion?: string) => void;
	readonly pendientes: number;
	readonly fallidas: number;
	readonly ultimoGuardado: string | null;
	hayPendientes: () => boolean;
	/** Reintenta las que agotaron sus intentos. Lo llama el botón del header. */
	reintentarFallidas: () => void;
	/** Espera a que se vacíe. Para `flush` manual o tests. */
	flush: () => Promise<void>;
	dispose: () => void;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function crearColaEscritura(opts: ColaEscrituraOpts = {}): ColaEscritura {
	const entradas = new Map<string, Entrada>();

	let pendientes = $state(0);
	let fallidas = $state(0);
	let ultimoGuardado = $state<string | null>(null);
	let vivo = true;

	function recontar() {
		let p = 0;
		let f = 0;
		for (const e of entradas.values()) {
			if (e.fallida) f++;
			else p++;
		}
		pendientes = p;
		fallidas = f;
		opts.onEstado?.({ pendientes: p, fallidas: f, ultimoGuardado });
	}

	async function procesar(clave: string) {
		const entrada = entradas.get(clave);
		if (!entrada || entrada.enVuelo || entrada.fallida || !vivo) return;

		entrada.enVuelo = true;
		recontar();

		try {
			await entrada.ejecutar();

			// Si mientras corría llegó un valor nuevo para la misma clave, la
			// entrada del mapa ya NO es esta: hay que dejarla y procesarla.
			const actual = entradas.get(clave);
			if (actual && actual !== entrada) {
				actual.enVuelo = false;
				recontar();
				void procesar(clave);
				return;
			}

			entradas.delete(clave);
			ultimoGuardado = new Date().toISOString();
			recontar();
		} catch (e: any) {
			// Si mientras corría llegó un valor nuevo, el que falló ya es
			// irrelevante: reintentarlo escribiría un valor viejo. Se destraba
			// el nuevo y se procesa. Sin esto, la entrada nueva quedaba con
			// `enVuelo: true` para siempre y no se guardaba nunca.
			const actual = entradas.get(clave);
			if (actual && actual !== entrada) {
				actual.enVuelo = false;
				recontar();
				void procesar(clave);
				return;
			}

			entrada.enVuelo = false;
			entrada.intentos++;
			entrada.ultimoError = e?.message || 'Error desconocido';

			if (entrada.intentos >= MAX_INTENTOS) {
				// Se agotaron los intentos. La entrada NO se borra: el valor
				// local se conserva y el usuario puede reintentar desde el
				// header o al recuperar la conexión.
				entrada.fallida = true;
				recontar();
				opts.onFallo?.({
					descripcion: entrada.descripcion,
					error: entrada.ultimoError!
				});
				return;
			}

			recontar();
			await dormir(BACKOFF_BASE_MS * 2 ** (entrada.intentos - 1));
			if (vivo) void procesar(clave);
		}
	}

	return {
		encolar(clave, ejecutar, descripcion = clave) {
			const previa = entradas.get(clave);

			if (previa?.enVuelo) {
				// Hay una petición en vuelo para esta clave. Se guarda el
				// trabajo nuevo para lanzarlo cuando termine — no se cancela la
				// que está corriendo, porque el servidor ya podría haberla
				// aplicado y cancelarla no la desharía.
				entradas.set(clave, {
					clave,
					ejecutar,
					descripcion,
					intentos: 0,
					enVuelo: true, // hereda el flag: se destrabará al terminar la actual
					fallida: false
				});
				return;
			}

			entradas.set(clave, {
				clave,
				ejecutar,
				descripcion,
				intentos: 0,
				enVuelo: false,
				fallida: false
			});
			recontar();
			void procesar(clave);
		},

		get pendientes() {
			return pendientes;
		},
		get fallidas() {
			return fallidas;
		},
		get ultimoGuardado() {
			return ultimoGuardado;
		},

		hayPendientes: () => entradas.size > 0,

		reintentarFallidas() {
			for (const [clave, entrada] of entradas) {
				if (!entrada.fallida) continue;
				entrada.fallida = false;
				entrada.intentos = 0;
				void procesar(clave);
			}
			recontar();
		},

		async flush() {
			// Espera activa sencilla: la cola es pequeña (una entrada por celda
			// tocada) y esto solo se usa al cerrar o en tests.
			while (entradas.size > 0 && vivo) {
				await dormir(50);
			}
		},

		dispose() {
			vivo = false;
			entradas.clear();
			pendientes = 0;
			fallidas = 0;
		}
	};
}
