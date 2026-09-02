/**
 * Configuración server-only de la recuperación de contraseña.
 *
 * Todo se lee de `$env/dynamic/private` (nunca `VITE_`): la clave de Resend y
 * el secreto de firma no pueden acabar en el bundle del navegador. Se lee en
 * cada petición, no al importar el módulo, porque en Vercel las variables
 * llegan en runtime y un valor cacheado al arrancar obligaría a redesplegar
 * para cambiarlas.
 */

import { env } from '$env/dynamic/private';

/** Secreto con el que se firman los magic links. Sin él no se emite ninguno. */
export function secretoFirma(): string | null {
	const valor = env.PASSWORD_RECOVERY_SECRET?.trim();
	// Un secreto corto no es un secreto: 32 caracteres es el mínimo que
	// aceptamos para no firmar enlaces con una clave adivinable.
	return valor && valor.length >= 32 ? valor : null;
}

export interface ConfigCorreo {
	apiKey: string;
	remitente: string;
}

/** Credenciales de Resend. `null` si falta cualquiera de las dos. */
export function configCorreo(): ConfigCorreo | null {
	const apiKey = env.RESEND_API_KEY?.trim();
	const remitente = env.RESEND_FROM?.trim();
	if (!apiKey || !remitente) return null;
	return { apiKey, remitente };
}

/** URL del backend NestJS que aplica el cambio de contraseña. */
export function urlBackend(): string {
	return (env.BACKEND_INTERNAL_URL || 'http://localhost:4000').replace(/\/+$/, '');
}

/**
 * Secreto compartido con el backend para la ruta de servicio que cambia la
 * contraseña sin sesión del usuario. Sin él no se intenta el cambio: mejor un
 * error explícito que una petición que el backend rechazará igualmente.
 */
export function tokenServicio(): string | null {
	return env.PASSWORD_RECOVERY_SERVICE_TOKEN?.trim() || null;
}

/**
 * Origen público con el que se arma el enlace del correo.
 *
 * Por defecto se usa el origen de la petición, que es correcto en Vercel y en
 * desarrollo. `APP_PUBLIC_URL` existe para cuando la app va detrás de un proxy
 * que reescribe el host y el enlace saldría apuntando a la red interna.
 */
export function origenPublico(origenPeticion: string): string {
	const configurado = env.APP_PUBLIC_URL?.trim();
	return (configurado || origenPeticion).replace(/\/+$/, '');
}
