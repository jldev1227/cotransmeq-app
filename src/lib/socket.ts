import { io, type Socket } from 'socket.io-client';
import { browser } from '$app/environment';
import { authStore } from '$lib/stores/auth';
import { writable } from 'svelte/store';

/**
 * En qué punto está la conexión en tiempo real.
 *
 * Existe porque «no hay conexión» y «se está reconectando» son dos cosas
 * distintas y hasta ahora se pintaban igual: el aviso del layout solo miraba
 * `connected`, así que un corte de dos segundos y un cliente muerto para
 * siempre se veían exactamente igual.
 *
 * - `inactivo`     no hay sesión; no se intenta conectar
 * - `conectando`   primer intento de esta sesión
 * - `conectado`    hay canal
 * - `reconectando` se perdió el canal y se está reintentando (sigue solo)
 * - `rechazado`    el servidor rechazó el handshake; reintentar NO arregla nada
 */
export type EstadoSocket = 'inactivo' | 'conectando' | 'conectado' | 'reconectando' | 'rechazado';

export interface SocketState {
	/** Se mantiene por compatibilidad: media aplicación lo consume. */
	connected: boolean;
	error: string | null;
	estado: EstadoSocket;
	/** Reintentos consecutivos desde la última conexión buena. */
	intentos: number;
	/** `Date.now()` de la última conexión establecida, o `null` si nunca hubo. */
	ultimaConexion: number | null;
}

const ESTADO_INICIAL: SocketState = {
	connected: false,
	error: null,
	estado: 'inactivo',
	intentos: 0,
	ultimaConexion: null
};

// Estado del socket
export const socketStore = writable<SocketState>({ ...ESTADO_INICIAL });

/** Primer escalón del backoff. */
const RECONEXION_DELAY = 1_000;

/**
 * Techo del backoff.
 *
 * Con el valor por defecto (5 s) y reintentos infinitos, cien pestañas
 * abiertas martillean el backend cada cinco segundos mientras esté caído.
 * Diez segundos con jitter reparte esos intentos y sigue siendo lo bastante
 * rápido para que la vuelta se note al instante.
 */
const RECONEXION_DELAY_MAX = 10_000;

/**
 * Cuánto se espera a que el handshake responda.
 *
 * El defecto son 20 s. Con la red caída —no rechazada: caída, sin RST— cada
 * ciclo de reintento se comía esos 20 s antes de darse por perdido, así que
 * el backoff avanzaba a paso de tortuga justo cuando más falta hacía.
 */
const HANDSHAKE_TIMEOUT = 10_000;

/** El servidor rechaza el handshake con este texto cuando el token no vale. */
const RECHAZO_AUTH = /unauthorized/i;

class SocketManager {
	private socket: Socket | null = null;
	// Listeners externos registrados vía socketUtils.on() — se re-registran al (re)crear el socket
	private externalListeners: Map<string, Set<(data: any) => void>> = new Map();
	/** Callbacks a avisar cuando la conexión VUELVE tras haberse perdido. */
	private listenersReconexion: Set<() => void> = new Set();
	/** ¿Hubo ya una conexión buena con este socket? Distingue conectar de RE-conectar. */
	private huboConexion = false;
	/** El servidor rechazó el handshake: reintentar con lo mismo no sirve de nada. */
	private rechazadoPorAuth = false;
	/** Reintento propio para los casos en que socket.io no reintenta solo. */
	private reintentoManual: ReturnType<typeof setTimeout> | null = null;
	/** Token con el que se hizo el handshake vigente. */
	private tokenEnUso: string | null = null;
	private despertadoresInstalados = false;

	constructor() {
		if (!browser) return;

		// Suscribirse a cambios en el estado de autenticación
		authStore.subscribe((authState) => {
			if (authState.token && authState.user) {
				/// Si el token cambió (renovación, o login de otro usuario en esta
				/// misma pestaña) el handshake anterior ya no representa a nadie.
				/// Antes esto pasaba desapercibido: `auth` se fijaba al crear el
				/// socket y los reintentos seguían mandando el token viejo.
				const tokenCambio = this.tokenEnUso !== null && this.tokenEnUso !== authState.token;
				this.tokenEnUso = authState.token;

				if (tokenCambio) {
					this.rechazadoPorAuth = false;
					this.reconectar();
					return;
				}

				this.connect();
				// Re-emitir join-dashboard cada vez que el user cambia o se reconecta
				if (this.socket?.connected) {
					console.log('[socket] emit join-dashboard', authState.user.id);
					this.socket.emit('join-dashboard', authState.user.id);
				}
			} else {
				this.tokenEnUso = null;
				this.disconnect();
			}
		});

		this.instalarDespertadores();
	}

	/**
	 * Reintenta en cuanto el equipo vuelve a estar en condiciones de conectar.
	 *
	 * El backoff de socket.io es un `setTimeout`, y los navegadores CONGELAN
	 * los temporizadores de las pestañas en segundo plano. Un portátil que se
	 * suspende con el dashboard abierto despierta con el socket muerto y el
	 * siguiente intento pendiente de un temporizador que lleva horas parado.
	 * Estos eventos son la señal de «ahora sí, prueba ya».
	 */
	private instalarDespertadores() {
		if (this.despertadoresInstalados) return;
		// `browser` puede ser cierto sin haber DOM: la suite corre estos módulos
		// en Node con `$app/environment` doblado.
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		this.despertadoresInstalados = true;

		const despertar = () => this.revisarConexion();

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') despertar();
		});
		window.addEventListener('online', despertar);
		window.addEventListener('focus', despertar);
		// Vuelta desde el bfcache (atrás/adelante del navegador): la página se
		// restaura entera, socket incluido, pero la conexión TCP ya no existe.
		window.addEventListener('pageshow', despertar);

		window.addEventListener('offline', () => {
			socketStore.update((state) => ({
				...state,
				connected: false,
				estado: state.estado === 'inactivo' ? 'inactivo' : 'reconectando'
			}));
		});
	}

	/**
	 * Comprueba el estado real de la conexión y actúa: reintenta ya si hace
	 * falta, o corrige el estado si resulta que no hacía falta.
	 *
	 * Es lo que disparan los despertadores, y es pública para poder llamarla
	 * desde una pantalla que sospeche que está desincronizada.
	 */
	revisarConexion() {
		if (!browser || !this.tokenEnUso) return;
		if (this.rechazadoPorAuth) return;
		if (!this.socket) {
			this.connect();
			return;
		}
		if (this.socket.connected) {
			/// El canal nunca llegó a caerse: el navegador avisó de `offline` pero
			/// el socket aguantó (una wifi que parpadea, un cambio de red que no
			/// llega a cortar). El estado se puso en `reconectando` por
			/// precaución y nadie lo iba a devolver a su sitio, porque no habrá
			/// ningún `connect` que lo haga: el indicador se quedaba avisando de
			/// un problema inexistente hasta la siguiente caída de verdad.
			socketStore.update((state) =>
				state.estado === 'conectado'
					? state
					: { ...state, connected: true, estado: 'conectado', intentos: 0, error: null }
			);
			return;
		}
		// Si el manager está dormido entre intentos, esto lo despierta; si ya
		// está intentando, socket.io lo ignora.
		this.socket.connect();
	}

	connect() {
		if (!browser) return;
		// Si ya hay un socket conectado, no crear otro
		if (this.socket?.connected) return;
		/// El servidor ya dijo que este token no vale. Insistir solo añade ruido
		/// y carga; se sale de aquí cambiando la sesión o con `reconectar()`,
		/// que es quien baja la bandera.
		if (this.rechazadoPorAuth) return;

		/// Un socket que existe pero está reintentando NO se destruye.
		///
		/// Antes sí: `if (this.socket) { disconnect(); this.socket = null }`.
		/// Como `connect()` se llama desde la suscripción al authStore, CUALQUIER
		/// cambio de estado de sesión mientras el socket reintentaba lo mataba a
		/// medio backoff y arrancaba otro desde cero, perdiendo por el camino la
		/// cuenta de intentos y la posibilidad de recuperar los eventos perdidos.
		if (this.socket) {
			this.socket.connect();
			return;
		}

		try {
			socketStore.update((state) => ({
				...state,
				estado: state.ultimaConexion ? 'reconectando' : 'conectando',
				error: null
			}));

			this.socket = io(import.meta.env.VITE_API_URL, {
				autoConnect: true,
				reconnection: true,
				/// Antes eran 5.
				///
				/// Con `reconnectionDelay` de 1 s y el techo por defecto de 5 s,
				/// los cinco intentos se agotaban en unos 15 segundos. Cualquier
				/// parada del backend más larga que eso —un deploy, el `tsx watch`
				/// recompilando, el contenedor rearrancando, un `pg` que tarda en
				/// aceptar conexiones— dejaba al cliente desconectado PARA SIEMPRE:
				/// socket.io emitía `reconnect_failed` y no volvía a intentarlo
				/// nunca más. El backend volvía a estar arriba, el rótulo seguía
				/// diciendo «Sin conexión» y la única salida era recargar la
				/// página. Ese es exactamente el fallo que se reportaba.
				reconnectionAttempts: Infinity,
				reconnectionDelay: RECONEXION_DELAY,
				reconnectionDelayMax: RECONEXION_DELAY_MAX,
				// Jitter: sin él todos los clientes reintentan en el mismo
				// milisegundo y le caen encima al backend justo al arrancar.
				randomizationFactor: 0.5,
				timeout: HANDSHAKE_TIMEOUT,
				/// Función, NO objeto: socket.io la vuelve a invocar en cada
				/// intento. Con `auth: { token: authStore.getToken() }` el token
				/// quedaba congelado en el momento de crear el socket, así que
				/// tras renovar la sesión todos los reintentos viajaban con el
				/// token viejo — y con `SOCKET_AUTH_MODE=enforce` eso es un bucle
				/// de rechazos del que no se sale solo.
				auth: (cb: (datos: Record<string, unknown>) => void) => {
					cb({ token: authStore.getToken() ?? undefined });
				}
			});

			this.setupEventListeners();
			// Re-registrar listeners externos que se hayan registrado antes de que el socket existiera
			this.reregisterExternalListeners();
		} catch (error) {
			console.error('Error connecting to socket:', error);
			socketStore.update((state) => ({
				...state,
				error: 'Error de conexión al servidor'
			}));
		}
	}

	private reregisterExternalListeners() {
		if (!this.socket) return;
		for (const [event, callbacks] of this.externalListeners.entries()) {
			for (const cb of callbacks) {
				this.socket.on(event, cb);
			}
		}
		console.log(
			`[socket] re-registrados ${this.externalListeners.size} eventos con ` +
			`${[...this.externalListeners.values()].reduce((s, set) => s + set.size, 0)} listeners ` +
			`(socket.connected=${this.socket.connected}, id=${this.socket.id})`
		);
	}

	disconnect() {
		this.cancelarReintentoManual();
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.huboConexion = false;
		this.rechazadoPorAuth = false;
		socketStore.set({ ...ESTADO_INICIAL });
	}

	/**
	 * Tira la conexión actual y levanta una nueva desde cero.
	 *
	 * Es el martillo: reinicia el backoff, rehace el handshake con el token de
	 * ahora y vuelve a registrar todos los listeners. Se usa cuando cambia la
	 * sesión y cuando el usuario pulsa «Reintentar» en el aviso de conexión.
	 */
	reconectar() {
		if (!browser) return;
		this.cancelarReintentoManual();
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.huboConexion = false;
		this.rechazadoPorAuth = false;
		// Conexión nueva, cuenta nueva: el contador de intentos y el error de la
		// tanda anterior ya no describen lo que está pasando.
		socketStore.update((state) => ({
			...state,
			connected: false,
			intentos: 0,
			error: null
		}));
		this.connect();
	}

	private cancelarReintentoManual() {
		if (this.reintentoManual) {
			clearTimeout(this.reintentoManual);
			this.reintentoManual = null;
		}
	}

	/**
	 * Reintento propio para los dos casos en que socket.io NO reintenta solo:
	 * cuando el cierre lo ordena el servidor y cuando se agotó su contador.
	 */
	private programarReintentoManual(retraso = RECONEXION_DELAY) {
		if (this.reintentoManual) return;
		this.reintentoManual = setTimeout(() => {
			this.reintentoManual = null;
			if (this.rechazadoPorAuth) return;
			if (this.socket && !this.socket.connected) this.socket.connect();
			else if (!this.socket) this.connect();
		}, retraso);
	}

	private avisarReconexion() {
		for (const cb of this.listenersReconexion) {
			try {
				cb();
			} catch (error) {
				// Un suscriptor que revienta no puede dejar sin avisar a los demás.
				console.error('[socket] error en un listener de reconexión:', error);
			}
		}
	}

	private setupEventListeners() {
		const socket = this.socket;
		if (!socket) return;

		// Eventos de conexión
		socket.on('connect', () => {
			const esReconexion = this.huboConexion;
			this.huboConexion = true;
			this.rechazadoPorAuth = false;
			this.cancelarReintentoManual();

			socketStore.set({
				connected: true,
				error: null,
				estado: 'conectado',
				intentos: 0,
				ultimaConexion: Date.now()
			});

			// Unirse al room personal del usuario para recibir eventos dirigidos
			const userId = authStore.getUser()?.id;
			if (userId) {
				console.log('[socket] connected, emit join-dashboard', userId);
				socket.emit('join-dashboard', userId);
			} else {
				console.warn('[socket] connected but no userId available for join-dashboard');
			}

			/// Volver a tener canal NO significa estar al día: todo lo que el
			/// backend emitió mientras no había conexión se perdió, salvo lo que
			/// alcance a recuperar `connectionStateRecovery` del servidor. Quien
			/// mantenga listas vivas tiene que releerlas.
			if (esReconexion) {
				console.log('[socket] reconectado — avisando para resincronizar');
				this.avisarReconexion();
			}
		});

		socket.on('disconnect', (reason) => {
			socketStore.update((state) => ({
				...state,
				connected: false,
				// `io client disconnect` es una desconexión que pedimos nosotros;
				// las demás son una caída y socket.io ya está reintentando.
				estado: reason === 'io client disconnect' ? 'inactivo' : 'reconectando'
			}));

			/// socket.io reconecta solo en TODOS los casos menos uno: cuando el
			/// cierre lo ordena el servidor (`socket.disconnect()` desde el
			/// backend, o el proceso cerrando conexiones al pararse). En ese caso
			/// hay que volver a llamar a `connect()` a mano, y no hacerlo era otra
			/// forma de quedarse colgado con el backend ya levantado.
			if (reason === 'io server disconnect') {
				console.warn('[socket] cierre ordenado por el servidor; reintentando a mano');
				this.programarReintentoManual();
			}
		});

		socket.on('connect_error', (error) => {
			console.error('Error de conexión socket:', error.message);

			/// Un handshake rechazado por identidad no se arregla repitiéndolo.
			/// Con `SOCKET_AUTH_MODE=enforce` y reintentos infinitos, insistir
			/// sería martillear el backend con un token que ya sabemos que no
			/// vale. Se para y se espera a que cambie la sesión (la suscripción
			/// al authStore rearranca) o a que el usuario pulse «Reintentar».
			if (RECHAZO_AUTH.test(error.message)) {
				this.rechazadoPorAuth = true;
				this.cancelarReintentoManual();
				socket.io.reconnection(false);
				socketStore.update((state) => ({
					...state,
					connected: false,
					estado: 'rechazado',
					error: 'Sesión no válida para la conexión en tiempo real'
				}));
				return;
			}

			socketStore.update((state) => ({
				...state,
				connected: false,
				estado: 'reconectando',
				intentos: state.intentos + 1,
				// El aviso solo se enciende cuando ya se ha insistido un poco:
				// un corte de un segundo no tiene por qué alarmar a nadie.
				error: state.intentos + 1 >= 3 ? 'No se pudo conectar al servidor' : state.error
			}));
		});

		/// El backoff vive en el Manager, no en el Socket: `socket.io` es donde
		/// se anuncian los intentos. Sirve para que la UI pueda decir «intento
		/// 4» en vez de un «Sin conexión» mudo.
		socket.io.on('reconnect_attempt', (intento: number) => {
			socketStore.update((state) => ({ ...state, estado: 'reconectando', intentos: intento }));
		});

		/// Con `reconnectionAttempts: Infinity` esto no debería dispararse nunca.
		/// Se maneja igual: si algún día alguien vuelve a poner un número, el
		/// cliente no se queda muerto en silencio como estaba.
		socket.io.on('reconnect_failed', () => {
			console.error('[socket] socket.io agotó sus reintentos; se sigue por nuestra cuenta');
			this.programarReintentoManual(RECONEXION_DELAY_MAX);
		});

		/// Aquí había un listener de `unauthorized` que llamaba a
		/// `authStore.logout()`. El backend NO emite ese evento nunca: cuando
		/// rechaza un handshake lo hace con un error del middleware, que llega
		/// como `connect_error` — el de arriba. Así que era código muerto, y de
		/// los peligrosos: cualquier evento de dominio que llegara a llamarse
		/// `unauthorized` habría cerrado la sesión de todo el mundo.
		///
		/// Con `SOCKET_AUTH_MODE=enforce` el rechazo por token inválido llega por
		/// `connect_error` con el mensaje «unauthorized: token inválido», y lo
		/// que se hace es dejar de reintentar y marcar el estado `rechazado`. No
		/// se cierra la sesión: el resto de la aplicación funciona por HTTP y
		/// quien decide cerrar sesión es el interceptor del apiClient.

		// Eventos globales de la aplicación
		this.setupApplicationEvents();
	}

	private setupApplicationEvents() {
		/// Vacío a propósito.
		///
		/// Aquí había doce listeners permanentes que solo hacían `console.log`.
		/// Seis de ellos —`servicio-actualizado`, `servicio-creado`,
		/// `vehiculo-ubicacion`, `vehiculo-estado`, `conductor-estado` y
		/// `notificacion`— escuchaban eventos que el backend NUNCA ha emitido:
		/// los nombres reales son otros. Los otros seis duplicaban lo que ya
		/// hacen los stores y las páginas, y como nunca se daban de baja
		/// registraban cada evento del sistema en la consola de todos.
		///
		/// Quien necesite reaccionar a un evento lo hace desde su store o su
		/// página, con su propio alta y baja. El contrato de eventos
		/// (`tests/contrato-eventos`) impide que vuelvan a aparecer listeners
		/// de eventos inexistentes sin que nadie se entere.
	}

	// Métodos públicos para emitir eventos
	emit(event: string, data?: any) {
		if (this.socket?.connected) {
			this.socket.emit(event, data);
		} else {
			console.warn('[socket] no conectado, no se puede emitir:', event);
		}
	}

	/**
	 * Escucha un evento y **devuelve la función para dejar de escucharlo**.
	 *
	 * Usar esa función es la forma fiable de darse de baja:
	 *
	 * ```ts
	 * $effect(() => socketUtils.on('servicio:creado', alCrear))
	 * ```
	 *
	 * Antes el callback se envolvía en otro que hacía `console.log` y era el
	 * ENVUELTO el que se registraba y se guardaba, mientras `off(evento, cb)`
	 * intentaba borrar el original. Ni el `Set.delete` ni el `socket.off`
	 * encontraban nada, así que **ningún `off` daba de baja nada**: las quince
	 * páginas que llamaban a `off` en su `onDestroy` parecían correctas y
	 * acumulaban un listener más en cada visita. Tras N visitas a una página,
	 * su handler corría N veces por evento.
	 *
	 * Se registra el callback tal cual. El log por evento se retiró: escribía
	 * en consola CADA evento del sistema, y para diagnosticar ya está
	 * `stores/socketEventLog.ts`.
	 */
	on(event: string, callback: (data: any) => void): () => void {
		if (!this.externalListeners.has(event)) {
			this.externalListeners.set(event, new Set());
		}
		// Se guarda para poder re-registrarlo si el socket se (re)crea.
		this.externalListeners.get(event)!.add(callback);
		this.socket?.on(event, callback);

		return () => this.off(event, callback);
	}

	/**
	 * Avisa cada vez que la conexión VUELVE tras haberse caído.
	 *
	 * No se dispara en la primera conexión: solo cuando ya hubo canal, se
	 * perdió y se recuperó. Es justo el momento en que los datos en pantalla
	 * pueden estar desfasados, porque todo lo que el backend emitió durante el
	 * corte no llegó a nadie.
	 *
	 * Devuelve la función de baja, igual que `on()`:
	 *
	 * ```ts
	 * bajas.push(socketUtils.onReconnect(() => store.recargar()));
	 * ```
	 */
	onReconnect(callback: () => void): () => void {
		this.listenersReconexion.add(callback);
		return () => {
			this.listenersReconexion.delete(callback);
		};
	}

	/**
	 * Deja de escuchar.
	 *
	 * Sin `callback` quita TODOS los listeners de ese evento, incluidos los de
	 * otros módulos que comparten este socket. Eso ya causó un fallo real:
	 * salir de `/dashboard/conductores` mataba el listener de
	 * `dias-laborados:registro-actualizado` que necesitaba
	 * `TablaDiasLaborados.svelte`, y la tabla dejaba de actualizarse sin que
	 * nada avisara. Por eso ahora deja rastro en consola: pásale el callback,
	 * o mejor usa la función que devuelve `on()`.
	 */
	off(event: string, callback?: (data: any) => void) {
		if (callback) {
			this.externalListeners.get(event)?.delete(callback);
			this.socket?.off(event, callback);
			return;
		}

		console.warn(
			`[socket] off('${event}') sin handler: se dan de baja TODOS los ` +
				`listeners de ese evento, incluidos los de otros módulos. ` +
				`Pasa el callback o usa la función que devuelve on().`
		);
		this.externalListeners.delete(event);
		this.socket?.off(event);
	}

	// Método para obtener el estado de conexión
	isConnected(): boolean {
		return this.socket?.connected || false;
	}

	/**
	 * Id de la conexión actual, o `null` si no hay ninguna.
	 *
	 * Hace falta para las operaciones cuyo progreso el backend manda a un
	 * socket concreto en vez de a un room —la generación del ZIP de
	 * desprendibles es el caso—: el cliente tiene que decir a qué conexión
	 * quiere que le hablen. Cambia en cada reconexión, así que se pide en el
	 * momento de lanzar la operación y no se guarda.
	 */
	getSocketId(): string | null {
		return this.socket?.id ?? null;
	}
}

// Crear instancia global del socket manager
export const socketManager = new SocketManager();

// Funciones de conveniencia para usar en componentes
export const socketUtils = {
	emit: (event: string, data?: any) => socketManager.emit(event, data),
	/** Devuelve la función de baja; úsala en vez de `off`. */
	on: (event: string, callback: (data: any) => void): (() => void) =>
		socketManager.on(event, callback),
	off: (event: string, callback?: (data: any) => void) => socketManager.off(event, callback),
	/** Devuelve la función de baja. Ver `SocketManager.onReconnect`. */
	onReconnect: (callback: () => void): (() => void) => socketManager.onReconnect(callback),
	isConnected: () => socketManager.isConnected(),
	getSocketId: () => socketManager.getSocketId(),
	/** Comprueba el estado real y lo corrige o reintenta. Ver `revisarConexion`. */
	revisarConexion: () => socketManager.revisarConexion(),
	/** Tira la conexión y levanta otra desde cero. Para el botón «Reintentar». */
	reconectar: () => socketManager.reconectar()
};
