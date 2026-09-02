/**
 * Puente con el backend NestJS para la recuperación de contraseña.
 *
 * El magic link lo emite y valida este repo (ver `token.ts`), pero la
 * contraseña vive en la base de datos del backend y solo él puede reescribirla.
 * Son las dos únicas llamadas que necesita el flujo, y ambas van autenticadas
 * con un secreto de servicio —no con la sesión del usuario, que por definición
 * no tiene quien está recuperando su acceso—.
 *
 * El contrato exacto de esos dos endpoints está en
 * README-RECUPERACION-PASSWORD.md, en la raíz del repo.
 */

import { tokenServicio, urlBackend } from './config';

const TIMEOUT_MS = 10_000;

async function pedir(
	ruta: string,
	secreto: string,
	cuerpo: unknown
): Promise<{ ok: boolean; status: number; datos: any; detalle?: string }> {
	const controlador = new AbortController();
	const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

	try {
		const respuesta = await fetch(`${urlBackend()}${ruta}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				// Cabecera de servicio: identifica al frontend como emisor
				// autorizado del magic link. El backend debe rechazar la
				// petición si no coincide con su propia variable.
				'x-recovery-token': secreto
			},
			body: JSON.stringify(cuerpo),
			signal: controlador.signal
		});

		const datos = await respuesta.json().catch(() => null);
		return { ok: respuesta.ok, status: respuesta.status, datos };
	} catch (error) {
		const detalle =
			error instanceof Error && error.name === 'AbortError'
				? `El backend no respondió en ${TIMEOUT_MS} ms`
				: error instanceof Error
					? error.message
					: 'Error desconocido al contactar el backend';
		return { ok: false, status: 0, datos: null, detalle };
	} finally {
		clearTimeout(corte);
	}
}

export type ResultadoBusqueda =
	| { estado: 'existe'; nombre: string | null }
	| { estado: 'no-existe' }
	/** El backend no expone la consulta o no respondió: no se puede afirmar nada. */
	| { estado: 'indeterminado'; detalle: string };

/**
 * Comprueba si el correo corresponde a una cuenta activa.
 *
 * Cuando no se puede saber —el backend aún no tiene el endpoint, está caído o
 * falta el secreto— se devuelve `indeterminado` en vez de `no-existe`. La
 * diferencia importa: tratar la duda como «no existe» dejaría la recuperación
 * silenciosamente muerta el día que el backend falle, y nadie se enteraría
 * porque al usuario se le responde siempre lo mismo para no filtrar qué
 * correos están registrados.
 */
export async function buscarUsuario(correo: string): Promise<ResultadoBusqueda> {
	const secreto = tokenServicio();
	if (!secreto) {
		return { estado: 'indeterminado', detalle: 'PASSWORD_RECOVERY_SERVICE_TOKEN no configurado' };
	}

	const res = await pedir('/api/auth/recuperacion/lookup', secreto, { correo });

	if (res.ok && res.datos && typeof res.datos.existe === 'boolean') {
		return res.datos.existe
			? { estado: 'existe', nombre: typeof res.datos.nombre === 'string' ? res.datos.nombre : null }
			: { estado: 'no-existe' };
	}

	return {
		estado: 'indeterminado',
		detalle: res.detalle ?? `El backend respondió ${res.status} en /api/auth/recuperacion/lookup`
	};
}

export type ResultadoCambio =
	| { ok: true }
	/** Falta configuración en el frontend: no se llegó a llamar al backend. */
	| { ok: false; estado: 'no-configurado'; mensaje: string; detalle: string }
	/** El backend recibió la petición y la rechazó (enlace ya usado, cuenta inactiva…). */
	| { ok: false; estado: 'rechazado'; mensaje: string; detalle: string }
	/** No hubo respuesta útil del backend. */
	| { ok: false; estado: 'inalcanzable'; mensaje: string; detalle: string };

const MENSAJE_GENERICO =
	'No pudimos guardar la nueva contraseña. Inténtalo de nuevo en unos minutos o comunícate con soporte.';

/**
 * Aplica la nueva contraseña.
 *
 * Se manda el `jti` del enlace para que el backend lo marque como consumido:
 * ese es el único punto donde el uso único se puede garantizar de verdad. La
 * memoria del frontend (`fueConsumido`) solo cubre la instancia que atendió la
 * petición, y en Vercel hay varias.
 */
export async function aplicarNuevaPassword(args: {
	correo: string;
	password: string;
	jti: string;
	emitidoEn: number;
}): Promise<ResultadoCambio> {
	const secreto = tokenServicio();
	if (!secreto) {
		return {
			ok: false,
			estado: 'no-configurado',
			mensaje:
				'La recuperación de contraseña no está habilitada en este entorno. Comunícate con soporte.',
			detalle: 'PASSWORD_RECOVERY_SERVICE_TOKEN no configurado'
		};
	}

	const res = await pedir('/api/auth/recuperacion/aplicar', secreto, {
		correo: args.correo,
		password: args.password,
		tokenId: args.jti,
		emitidoEn: new Date(args.emitidoEn).toISOString()
	});

	if (res.ok) return { ok: true };

	// 4xx = el backend entendió y dijo que no; ahí su mensaje es más preciso
	// que cualquiera que inventemos aquí (enlace ya usado, cuenta desactivada).
	if (res.status >= 400 && res.status < 500) {
		const delBackend =
			(typeof res.datos?.error === 'string' && res.datos.error) ||
			(typeof res.datos?.message === 'string' && res.datos.message) ||
			null;
		return {
			ok: false,
			estado: 'rechazado',
			mensaje: delBackend ?? MENSAJE_GENERICO,
			detalle: `El backend respondió ${res.status}`
		};
	}

	return {
		ok: false,
		estado: 'inalcanzable',
		mensaje: MENSAJE_GENERICO,
		detalle: res.detalle ?? `El backend respondió ${res.status}`
	};
}
