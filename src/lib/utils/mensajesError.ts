/**
 * Traducción de errores de la API a mensajes que un usuario pueda leer.
 *
 * El problema que resuelve: confiar en el `message` de la respuesta es lo más
 * preciso cuando el backend lo escribió pensando en la persona que lo va a
 * leer, pero NestJS y Prisma rellenan ese mismo campo con sus textos por
 * defecto en inglés (`Invalid credentials`, `Unauthorized`, `Internal server
 * error`, `Unique constraint failed on the fields: (...)`). Mostrarlos tal cual
 * deja al usuario con un mensaje que no entiende y que además no le dice qué
 * hacer.
 *
 * La regla aquí es: el texto del backend se muestra solo si supera un filtro.
 *   1. Si es un mensaje conocido del framework → se sustituye por su
 *      equivalente en español (`DICCIONARIO`).
 *   2. Si huele a interno —traza, código de Prisma, SQL, error de JS— se
 *      descarta y se cae al mensaje por código de estado.
 *   3. Si parece inglés y no tiene ninguna marca de español, se descarta por lo
 *      mismo.
 *   4. Solo entonces se muestra literal.
 *
 * Descartar de más no es grave: el usuario ve un mensaje en español correcto,
 * aunque más general. Descartar de menos sí lo es: vuelve a salir el inglés.
 *
 * Este módulo no importa nada de `$app/*` ni de Svelte a propósito, para que
 * pueda probarse con Vitest en entorno `node`.
 */

/** Mensajes por código de estado HTTP. */
export type MensajesPorEstado = Record<number, string>;

export interface DescribirErrorOpciones {
	/**
	 * Textos por código de estado propios del flujo. Se fusionan sobre
	 * `MENSAJES_POR_ESTADO`, así que solo hace falta declarar los que cambian
	 * (en login un 401 es «credenciales incorrectas», no «sesión expirada»).
	 */
	porEstado?: MensajesPorEstado;
	/** Último recurso cuando no se puede decir nada más concreto. */
	generico?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  1) Diccionario de mensajes conocidos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Textos que NestJS, Passport, Prisma o `jsonwebtoken` devuelven literalmente.
 * La clave está normalizada (minúsculas, sin acentos, sin puntuación final);
 * ver `normalizar`.
 */
const DICCIONARIO: Record<string, string> = {
	// ─── Autenticación ───────────────────────────────────────────────────────
	'invalid credentials': 'Correo o contraseña incorrectos.',
	'invalid credential': 'Correo o contraseña incorrectos.',
	'bad credentials': 'Correo o contraseña incorrectos.',
	'incorrect password': 'La contraseña no es correcta.',
	'wrong password': 'La contraseña no es correcta.',
	'invalid email or password': 'Correo o contraseña incorrectos.',
	'invalid username or password': 'Correo o contraseña incorrectos.',
	'user not found': 'No encontramos una cuenta registrada con ese correo.',
	'email not found': 'No encontramos una cuenta registrada con ese correo.',
	'user does not exist': 'No encontramos una cuenta registrada con ese correo.',
	unauthorized: 'Correo o contraseña incorrectos.',
	'unauthorized exception': 'Correo o contraseña incorrectos.',
	'user is inactive': 'Tu usuario está inactivo. Contacta al administrador.',
	'inactive user': 'Tu usuario está inactivo. Contacta al administrador.',
	'user is disabled': 'Tu usuario está deshabilitado. Contacta al administrador.',
	'account is locked': 'Tu cuenta está bloqueada. Contacta al administrador.',
	'account locked': 'Tu cuenta está bloqueada. Contacta al administrador.',
	'email not verified': 'Tu correo aún no ha sido verificado.',

	// ─── Sesión / token ──────────────────────────────────────────────────────
	'jwt expired': 'Tu sesión expiró. Vuelve a iniciar sesión.',
	'token expired': 'Tu sesión expiró. Vuelve a iniciar sesión.',
	'token has expired': 'Tu sesión expiró. Vuelve a iniciar sesión.',
	'jwt malformed': 'Tu sesión no es válida. Vuelve a iniciar sesión.',
	'invalid token': 'El enlace o la sesión no son válidos. Vuelve a iniciar sesión.',
	'invalid signature': 'Tu sesión no es válida. Vuelve a iniciar sesión.',
	'no token provided': 'Tu sesión no es válida. Vuelve a iniciar sesión.',
	'missing token': 'Tu sesión no es válida. Vuelve a iniciar sesión.',

	// ─── Permisos ────────────────────────────────────────────────────────────
	forbidden: 'No tienes permiso para realizar esta acción.',
	'forbidden resource': 'No tienes permiso para realizar esta acción.',
	'access denied': 'No tienes permiso para realizar esta acción.',
	'insufficient permissions': 'No tienes permiso para realizar esta acción.',

	// ─── Genéricos de NestJS ─────────────────────────────────────────────────
	'bad request': 'Revisa los datos ingresados e inténtalo de nuevo.',
	'validation failed': 'Revisa los datos ingresados e inténtalo de nuevo.',
	'unprocessable entity': 'Revisa los datos ingresados e inténtalo de nuevo.',
	'not found': 'No encontramos lo que buscabas.',
	'internal server error': 'Error interno del servidor. Inténtalo de nuevo en unos minutos.',
	'service unavailable': 'El servicio no está disponible en este momento. Inténtalo más tarde.',
	'gateway timeout': 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
	'request timeout': 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
	'too many requests': 'Demasiados intentos. Espera unos minutos antes de reintentar.',

	// ─── Red ─────────────────────────────────────────────────────────────────
	'network error': 'No se pudo conectar con el servidor. Verifica tu conexión.',
	'failed to fetch': 'No se pudo conectar con el servidor. Verifica tu conexión.',

	// ─── Registro / duplicados ───────────────────────────────────────────────
	'email already exists': 'Ya existe una cuenta registrada con ese correo.',
	'user already exists': 'Ya existe una cuenta registrada con ese correo.',
	'email already in use': 'Ya existe una cuenta registrada con ese correo.'
};

/**
 * Entradas del diccionario que no son un diagnóstico sino la frase del estado
 * HTTP. NestJS las pone siempre en `error` (`{ statusCode: 400, message: 'La
 * contraseña debe tener al menos 6 caracteres', error: 'Bad Request' }`), así
 * que tomarlas taparía el mensaje útil que viaja en `message`.
 *
 * `describirErrorApi` las salta y deja que responda la tabla por estado, que
 * además conoce el flujo (en login un 401 no es «sesión expirada»).
 */
const GENERICOS_DE_ESTADO = new Set([
	'unauthorized',
	'unauthorized exception',
	'forbidden',
	'forbidden resource',
	'bad request',
	'not found',
	'internal server error',
	'unprocessable entity',
	'service unavailable',
	'gateway timeout',
	'request timeout',
	'too many requests',
	'validation failed'
]);

// ═══════════════════════════════════════════════════════════════════════════
//  2) Detección de texto interno
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Marcas de que el texto es diagnóstico y no un mensaje para el usuario:
 * trazas de pila, códigos de Prisma, SQL crudo, errores de runtime de JS y los
 * textos que axios genera a partir del estado HTTP.
 */
const PATRONES_TECNICOS: RegExp[] = [
	/\bprisma\b/i,
	/PrismaClient/i,
	/\bP\d{4}\b/, // P2002, P2025… códigos de Prisma
	/unique constraint/i,
	/foreign key constraint/i,
	/constraint failed/i,
	/\bSQLSTATE\b/i,
	/duplicate key value/i,
	/violates .*constraint/i,
	/column .* does not exist/i,
	/relation .* does not exist/i,
	/\bselect\b.*\bfrom\b/i,
	/request failed with status code/i,
	/\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/,
	/cannot read propert/i,
	/is not a function\b/i,
	/of undefined\b/i,
	/\b(undefined|null) is not\b/i,
	/\b(ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)\b/,
	/\bat \w+.*\(.*:\d+:\d+\)/, // línea de traza de pila
	/\n\s+at /, // traza de pila multilínea
	/\bJsonWebTokenError\b|\bTokenExpiredError\b/,
	/\bException\b/, // NotFoundException, BadRequestException…
	/\bnode_modules\b/,
	/\bstack\b.*:\s*Error/i,
	/^\s*<!DOCTYPE/i, // página de error HTML servida como cuerpo
	/^\s*</
];

/**
 * Construcciones que solo existen en inglés. Mandan sobre cualquier señal de
 * español porque class-validator mezcla los dos idiomas: la plantilla es
 * inglesa y el nombre del campo viene del DTO, que aquí está en español
 * («correo must be an email»). Sin esta lista, el «correo» del principio
 * bastaría para dar la frase por legible.
 */
const INGLES_INEQUIVOCO =
	/\b(must be|must not|should be|should not|is not|are not|was not|were not|does not|do not|did not|has been|have been|will be|cannot|can't|doesn't|don't|isn't|aren't|didn't|the|please|already|instead|either|neither|whether|unless|therefore|because of)\b/i;

/**
 * Palabras que en español no se usan. Se excluyen a propósito las que
 * comparten forma o préstamo con el español (`error`, `token`, `email`,
 * `no`, `total`), que darían falsos positivos.
 */
const PALABRAS_INGLES =
	/\b(the|and|is|are|was|were|not|invalid|credentials?|failed|failure|must|cannot|can't|does|doesn't|don't|exists?|already|required|missing|unauthorized|forbidden|unexpected|internal|server|request|response|password|username|expired|please|try|again|wrong|incorrect|denied|found|allowed|provided|field|value|with|from|this|that|your|you|has|have|been|such|only|unable|while|during|given|empty|there|which|should|would|could|user)\b/i;

/**
 * Señales de que el texto sí está en español: caracteres propios del idioma o
 * vocabulario frecuente en los mensajes del backend. Basta una para conservar
 * el texto, de modo que un mensaje en español que cite un campo en inglés
 * («El campo password es obligatorio») no se descarte por esa palabra.
 */
const PALABRAS_ESPANOL =
	/[áéíóúüñ¿¡]|\b(el|la|los|las|un|una|de|del|al|y|o|es|son|está|estan|debe|deben|tiene|tienen|existe|existen|ya|no|para|con|sin|su|tu|este|esta|por|favor|correo|contraseña|contrasena|usuario|usuarios|cuenta|credenciales|sesion|sesión|acceso|permiso|permisos|inténtalo|intentalo|intenta|revisa|ingresa|vuelve|incorrecto|incorrecta|incorrectos|incorrectas|invalido|inválido|invalida|inválida|obligatorio|obligatoria|requerido|requerida|campo|datos|nombre|registro|registrado|encontramos|válido|valido)\b/i;

/** Un mensaje más largo que esto casi seguro es una traza o un volcado. */
const LARGO_MAXIMO = 220;

/** Minúsculas, sin acentos, sin puntuación final y con espacios colapsados. */
function normalizar(texto: string): string {
	return texto
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // marcas diacríticas sueltas tras el NFD
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/[.!:;]+$/, '')
		.trim();
}

/** `true` si el texto es diagnóstico interno y no debe llegar al usuario. */
export function esMensajeTecnico(texto: string): boolean {
	const limpio = texto.trim();
	if (!limpio) return true;
	if (limpio.length > LARGO_MAXIMO) return true;
	return PATRONES_TECNICOS.some((patron) => patron.test(limpio));
}

/**
 * Convierte el texto crudo del backend en un mensaje presentable, o devuelve
 * `null` si no hay forma de mostrarlo (interno o en inglés). El `null` es la
 * señal para que quien llama caiga en el mensaje por código de estado.
 */
export function traducirMensajeApi(texto: unknown): string | null {
	if (typeof texto !== 'string') return null;

	const limpio = texto.replace(/\s+/g, ' ').trim();
	if (!limpio) return null;

	// 1) Coincidencia exacta con un texto conocido del framework.
	//    `hasOwnProperty` y no `DICCIONARIO[clave]` a secas: un backend que
	//    devolviera «constructor» o «toString» sacaría un miembro del prototipo
	//    de Object, que además no es un string.
	const clave = normalizar(limpio);
	if (Object.prototype.hasOwnProperty.call(DICCIONARIO, clave)) return DICCIONARIO[clave];

	// 2) Diagnóstico interno: nunca se muestra.
	if (esMensajeTecnico(limpio)) return null;

	// 3) Construcción inequívocamente inglesa: tampoco, aunque haya palabras
	//    en español (los mensajes de class-validator mezclan los dos idiomas).
	if (INGLES_INEQUIVOCO.test(limpio)) return null;

	// 4) Inglés sin ninguna marca de español: tampoco.
	if (PALABRAS_INGLES.test(limpio) && !PALABRAS_ESPANOL.test(limpio)) return null;

	// 5) Redactado para el usuario: se muestra tal cual.
	return limpio;
}

/** `true` si el texto es solo la frase del estado HTTP (`Bad Request`…). */
function esGenericoDeEstado(texto: string): boolean {
	return GENERICOS_DE_ESTADO.has(normalizar(texto));
}

// ═══════════════════════════════════════════════════════════════════════════
//  3) Extracción del mensaje de la respuesta
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reúne los textos candidatos del cuerpo de la respuesta, en orden de
 * preferencia. NestJS usa `message` (string o `string[]` cuando falla
 * class-validator); el backend propio usa `error` o `mensaje`.
 */
function candidatos(data: any): string[] {
	if (data == null) return [];
	if (typeof data === 'string') return [data];

	const salida: string[] = [];
	const empujar = (valor: unknown) => {
		if (typeof valor === 'string') {
			salida.push(valor);
		} else if (Array.isArray(valor)) {
			for (const item of valor) {
				if (typeof item === 'string') salida.push(item);
				else if (item && typeof item === 'object') {
					empujar((item as any).msg ?? (item as any).message ?? (item as any).mensaje);
				}
			}
		}
	};

	// `message` antes que `error`: en NestJS el segundo es la frase del estado
	// y el primero el detalle real.
	empujar(data.mensaje);
	empujar(data.message);
	empujar(data.error);
	empujar(data.msg);
	empujar(data.detail);
	empujar(data.errors);

	return salida.filter((t) => typeof t === 'string' && t.trim());
}

// ═══════════════════════════════════════════════════════════════════════════
//  4) Mensajes por código de estado
// ═══════════════════════════════════════════════════════════════════════════

/** Respaldo cuando el cuerpo no aporta un texto presentable. */
export const MENSAJES_POR_ESTADO: MensajesPorEstado = {
	400: 'Revisa los datos ingresados e inténtalo de nuevo.',
	401: 'Tu sesión no es válida o expiró. Vuelve a iniciar sesión.',
	403: 'No tienes permiso para realizar esta acción.',
	404: 'No encontramos lo que buscabas.',
	408: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
	409: 'La operación choca con datos que ya existen. Revisa la información.',
	413: 'El archivo es demasiado grande.',
	422: 'Revisa los datos ingresados e inténtalo de nuevo.',
	429: 'Demasiados intentos. Espera unos minutos antes de reintentar.',
	500: 'Error interno del servidor. Inténtalo de nuevo en unos minutos.',
	502: 'El servidor no está respondiendo. Inténtalo de nuevo en unos minutos.',
	503: 'El servicio no está disponible en este momento. Inténtalo más tarde.',
	504: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.'
};

const GENERICO = 'No se pudo completar la operación. Inténtalo de nuevo.';

/** Mensaje para los fallos que ocurren sin respuesta del servidor. */
function describirFalloDeRed(error: any): string {
	const codigo = error?.code;
	if (codigo === 'ECONNABORTED' || codigo === 'ETIMEDOUT') {
		return 'El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.';
	}
	return 'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.';
}

/**
 * Punto de entrada: traduce cualquier error de axios a un mensaje en español.
 *
 * Prioridad: texto presentable del backend → mensaje por código de estado →
 * genérico. El orden importa: el backend es quien mejor sabe qué pasó, pero
 * solo mientras lo diga en un idioma que el usuario lea.
 */
export function describirErrorApi(error: any, opciones: DescribirErrorOpciones = {}): string {
	const data = error?.response?.data;

	for (const bruto of candidatos(data)) {
		if (esGenericoDeEstado(bruto)) continue;
		const traducido = traducirMensajeApi(bruto);
		if (traducido) return traducido;
	}

	if (!error?.response) return describirFalloDeRed(error);

	const estado: number = error.response.status;
	const porEstado = { ...MENSAJES_POR_ESTADO, ...(opciones.porEstado ?? {}) };
	if (porEstado[estado]) return porEstado[estado];

	if (estado >= 500) return MENSAJES_POR_ESTADO[500];
	if (estado >= 400) return MENSAJES_POR_ESTADO[400];

	return opciones.generico ?? GENERICO;
}
