/**
 * Magic link de recuperación de contraseña: firma y verificación.
 *
 * El token es autocontenido (correo + caducidad + identificador) y va firmado
 * con HMAC-SHA256. No se guarda en base de datos porque este repo no tiene
 * acceso a ella: el frontend emite y valida, y el backend NestJS solo recibe
 * el cambio ya autorizado (ver `backend.ts`).
 *
 * Las funciones son puras y reciben el secreto por parámetro —nunca leen
 * `$env`— para que se puedan probar sin el runtime de SvelteKit.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/** Versión del formato. Cambiarla invalida de golpe los enlaces en circulación. */
const VERSION = 'v1';

/**
 * Media hora: suficiente para abrir el correo en el teléfono y volver al
 * computador, corto para que un enlace filtrado (historial del navegador,
 * reenvío del correo) deje de servir pronto.
 */
export const VIGENCIA_MS = 30 * 60 * 1000;

export interface DatosToken {
	/** Correo del usuario que pidió la recuperación, normalizado en minúsculas. */
	correo: string;
	/** Identificador único del enlace. El backend lo usa para consumirlo una sola vez. */
	jti: string;
	/** Emisión y caducidad en milisegundos epoch. */
	iat: number;
	exp: number;
}

export type MotivoInvalidez = 'formato' | 'firma' | 'expirado';

export type ResultadoVerificacion =
	| { valido: true; datos: DatosToken }
	| { valido: false; motivo: MotivoInvalidez };

/** Mensaje que ve el usuario para cada forma de fallar. */
export const MENSAJE_INVALIDEZ: Record<MotivoInvalidez, string> = {
	formato: 'El enlace de recuperación no es válido. Solicita uno nuevo para continuar.',
	firma: 'El enlace de recuperación no es válido o fue alterado. Solicita uno nuevo para continuar.',
	expirado: 'El enlace de recuperación expiró. Los enlaces duran 30 minutos; solicita uno nuevo.'
};

function b64urlEncode(valor: string): string {
	return Buffer.from(valor, 'utf-8').toString('base64url');
}

function b64urlDecode(valor: string): string {
	return Buffer.from(valor, 'base64url').toString('utf-8');
}

function firmar(cuerpo: string, secreto: string): string {
	return createHmac('sha256', secreto).update(cuerpo).digest('base64url');
}

/** Normaliza el correo para que la firma no dependa de mayúsculas ni espacios. */
export function normalizarCorreo(correo: string): string {
	return correo.trim().toLowerCase();
}

/**
 * Emite un enlace firmado para `correo`.
 *
 * @param ahora Instante de emisión; parámetro explícito para que los tests
 *              puedan fabricar tokens ya vencidos sin tocar el reloj global.
 */
export function firmarToken(
	correo: string,
	secreto: string,
	ahora: number = Date.now()
): { token: string; datos: DatosToken } {
	const datos: DatosToken = {
		correo: normalizarCorreo(correo),
		jti: randomUUID(),
		iat: ahora,
		exp: ahora + VIGENCIA_MS
	};

	const cuerpo = `${VERSION}.${b64urlEncode(JSON.stringify(datos))}`;
	return { token: `${cuerpo}.${firmar(cuerpo, secreto)}`, datos };
}

/**
 * Verifica un enlace.
 *
 * Distingue el motivo del rechazo a propósito: «expiró» y «no es válido» le
 * dicen cosas distintas al usuario —el primero se resuelve pidiendo otro
 * enlace, el segundo suele ser un correo viejo o un copiado a medias— y la
 * página de recuperación muestra el mensaje que corresponde.
 */
export function verificarToken(
	token: string,
	secreto: string,
	ahora: number = Date.now()
): ResultadoVerificacion {
	if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
		return { valido: false, motivo: 'formato' };
	}

	const partes = token.split('.');
	if (partes.length !== 3) return { valido: false, motivo: 'formato' };

	const [version, payload, firma] = partes;
	if (version !== VERSION || !payload || !firma) return { valido: false, motivo: 'formato' };

	// La comparación es de tiempo constante, pero `timingSafeEqual` lanza si
	// los buffers miden distinto: la longitud se compara antes, y no filtra
	// nada porque el HMAC siempre produce el mismo tamaño.
	const esperada = Buffer.from(firmar(`${version}.${payload}`, secreto), 'base64url');
	const recibida = Buffer.from(firma, 'base64url');
	if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
		return { valido: false, motivo: 'firma' };
	}

	let datos: DatosToken;
	try {
		datos = JSON.parse(b64urlDecode(payload));
	} catch {
		return { valido: false, motivo: 'formato' };
	}

	if (
		!datos ||
		typeof datos.correo !== 'string' ||
		typeof datos.jti !== 'string' ||
		typeof datos.exp !== 'number' ||
		typeof datos.iat !== 'number'
	) {
		return { valido: false, motivo: 'formato' };
	}

	if (datos.exp <= ahora) return { valido: false, motivo: 'expirado' };

	return { valido: true, datos };
}

/**
 * Enlaces ya usados en esta instancia.
 *
 * Es una defensa de mejor esfuerzo: en Vercel cada instancia tiene su propio
 * mapa, así que un token consumido aquí puede seguir vivo en otra. El corte
 * definitivo lo hace el backend, que recibe el `jti` y lo marca en base de
 * datos (ver el contrato en README-RECUPERACION-PASSWORD.md).
 */
const consumidos = new Map<string, number>();

export function marcarConsumido(jti: string, exp: number): void {
	consumidos.set(jti, exp);
	// Limpieza oportunista: sin esto el mapa crece con cada recuperación
	// mientras la instancia siga viva.
	const ahora = Date.now();
	for (const [id, caduca] of consumidos) {
		if (caduca <= ahora) consumidos.delete(id);
	}
}

export function fueConsumido(jti: string): boolean {
	const caduca = consumidos.get(jti);
	if (caduca === undefined) return false;
	if (caduca <= Date.now()) {
		consumidos.delete(jti);
		return false;
	}
	return true;
}
