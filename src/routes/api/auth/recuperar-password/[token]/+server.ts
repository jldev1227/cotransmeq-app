// src/routes/api/auth/recuperar-password/[token]/+server.ts
//
// Paso 2 del flujo: la página de recuperación pregunta si el enlace sirve
// (GET) y, si el usuario elige una contraseña, la manda a guardar (POST).
//
// La validación del token se hace en el servidor y no en el navegador porque
// la firma se comprueba con un secreto que el cliente no puede tener. La
// página solo pinta el veredicto.
import { json, type RequestHandler } from '@sveltejs/kit';
import { secretoFirma } from '$lib/server/recuperacion/config';
import { aplicarNuevaPassword } from '$lib/server/recuperacion/backend';
import {
	MENSAJE_INVALIDEZ,
	fueConsumido,
	marcarConsumido,
	verificarToken,
	type DatosToken
} from '$lib/server/recuperacion/token';
import { LIMITE_VERIFICACION, permitir } from '$lib/server/recuperacion/limite';
import { validarPassword } from '$lib/recuperacion/password';

/** Mensaje único para el enlace ya usado, en GET y en POST. */
const YA_USADO =
	'Este enlace ya se utilizó para cambiar la contraseña. Solicita uno nuevo si necesitas volver a cambiarla.';

/**
 * `juan.perez@cotransmeq.com` → `ju•••••@cotransmeq.com`.
 *
 * Se enmascara aunque quien abre el enlace normalmente sea el dueño del
 * correo: el enlace puede acabar reenviado o en un historial compartido, y ahí
 * la dirección completa es dato de más.
 */
function enmascararCorreo(correo: string): string {
	const [usuario, dominio] = correo.split('@');
	if (!dominio) return '•••';
	const visible = usuario.slice(0, 2);
	return `${visible}${'•'.repeat(Math.max(3, usuario.length - 2))}@${dominio}`;
}

type Revision = { ok: true; datos: DatosToken } | { ok: false; mensaje: string };

/** Comprueba firma, caducidad y uso previo. Común a GET y POST. */
function revisarEnlace(token: string, secreto: string): Revision {
	const resultado = verificarToken(token, secreto);
	if (!resultado.valido) return { ok: false, mensaje: MENSAJE_INVALIDEZ[resultado.motivo] };
	if (fueConsumido(resultado.datos.jti)) return { ok: false, mensaje: YA_USADO };
	return { ok: true, datos: resultado.datos };
}

function faltaConfiguracion() {
	console.error('[recuperacion] PASSWORD_RECOVERY_SECRET no configurado');
	return json(
		{
			valido: false,
			error:
				'La recuperación de contraseña no está configurada en este entorno. Comunícate con soporte.'
		},
		{ status: 503 }
	);
}

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	let ip = 'desconocida';
	try {
		ip = getClientAddress();
	} catch {
		// Sin IP el freno no aplica; la firma sigue siendo la defensa real.
	}

	if (!permitir(`verificacion:${ip}`, LIMITE_VERIFICACION)) {
		return json(
			{ valido: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
			{ status: 429 }
		);
	}

	const secreto = secretoFirma();
	if (!secreto) return faltaConfiguracion();

	const revision = revisarEnlace(params.token ?? '', secreto);
	if (!revision.ok) return json({ valido: false, error: revision.mensaje }, { status: 400 });

	return json({
		valido: true,
		correo: enmascararCorreo(revision.datos.correo),
		expiraEn: new Date(revision.datos.exp).toISOString()
	});
};

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	let ip = 'desconocida';
	try {
		ip = getClientAddress();
	} catch {
		// idem GET
	}

	if (!permitir(`verificacion:${ip}`, LIMITE_VERIFICACION)) {
		return json(
			{ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
			{ status: 429 }
		);
	}

	const secreto = secretoFirma();
	if (!secreto) return faltaConfiguracion();

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Body inválido (se esperaba JSON)' }, { status: 400 });
	}

	// El enlace se revisa ANTES que la contraseña: si ya venció, no tiene
	// sentido hacerle corregir la contraseña para después decirle que el
	// enlace no servía.
	const revision = revisarEnlace(params.token ?? '', secreto);
	if (!revision.ok) {
		// `enlaceInvalido` le dice a la página que cambie de pantalla en vez de
		// pintar el error sobre unos campos que ya no llevan a ninguna parte.
		return json({ error: revision.mensaje, enlaceInvalido: true }, { status: 400 });
	}

	const password = String(body?.password ?? '');
	const confirmacion = body?.confirmacion === undefined ? undefined : String(body.confirmacion);
	const problema = validarPassword(password, confirmacion);
	if (problema) return json({ error: problema }, { status: 400 });

	const resultado = await aplicarNuevaPassword({
		correo: revision.datos.correo,
		password,
		jti: revision.datos.jti,
		emitidoEn: revision.datos.iat
	});

	if (!resultado.ok) {
		console.error(`[recuperacion] Cambio rechazado (${resultado.estado}):`, resultado.detalle);
		// 409 cuando el backend dijo que no (enlace ya usado, cuenta inactiva),
		// 503 si falta configurar el puente y 502 si no hubo respuesta: el
		// código distingue en los logs lo que el mensaje no puede.
		const status =
			resultado.estado === 'rechazado' ? 409 : resultado.estado === 'no-configurado' ? 503 : 502;
		return json({ error: resultado.mensaje }, { status });
	}

	// Solo se quema el enlace cuando el cambio quedó guardado: si el backend
	// falló, el usuario debe poder reintentar con el mismo correo en la mano.
	marcarConsumido(revision.datos.jti, revision.datos.exp);
	console.info(`[recuperacion] Contraseña actualizada (jti ${revision.datos.jti})`);

	return json({
		ok: true,
		mensaje: 'Tu contraseña se actualizó. Ya puedes iniciar sesión con la nueva.'
	});
};
