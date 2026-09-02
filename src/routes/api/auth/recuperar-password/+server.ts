// src/routes/api/auth/recuperar-password/+server.ts
//
// Paso 1 del flujo: alguien dice «olvidé mi contraseña» y se le manda el
// magic link por correo.
//
// Esta ruta es PÚBLICA por definición —quien la usa no tiene sesión—, así que
// va con freno de intentos y responde siempre lo mismo pase lo que pase con la
// búsqueda del usuario: si dijera «ese correo no existe» sería un directorio
// gratuito de quién trabaja en la empresa.
import { json, type RequestHandler } from '@sveltejs/kit';
import { configCorreo, origenPublico, secretoFirma } from '$lib/server/recuperacion/config';
import { buscarUsuario } from '$lib/server/recuperacion/backend';
import { enviarCorreoRecuperacion } from '$lib/server/recuperacion/correo';
import { firmarToken, normalizarCorreo } from '$lib/server/recuperacion/token';
import {
	LIMITE_SOLICITUD,
	LIMITE_SOLICITUD_IP,
	permitir
} from '$lib/server/recuperacion/limite';

/**
 * Misma frase para «te lo mandamos» y «ese correo no está registrado».
 * Es la respuesta que ve el usuario en los dos casos.
 */
const RESPUESTA_NEUTRA = {
	ok: true,
	mensaje:
		'Si el correo corresponde a una cuenta activa, en unos segundos llegará un enlace para restablecer la contraseña.'
};

/** Validación deliberadamente laxa: el correo real lo confirma el backend. */
const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Body inválido (se esperaba JSON)' }, { status: 400 });
	}

	const correo = normalizarCorreo(String(body?.correo ?? ''));
	if (!correo || !FORMATO_CORREO.test(correo) || correo.length > 254) {
		return json({ error: 'Ingresa un correo electrónico válido.' }, { status: 400 });
	}

	let ip = 'desconocida';
	try {
		ip = getClientAddress();
	} catch {
		// adapter sin dirección disponible: el freno por correo sigue en pie.
	}

	// El `&&` corta antes de contar la IP cuando el correo ya se pasó: no tiene
	// sentido castigar además a toda la oficina que sale por esa dirección.
	const dentroDelLimite =
		permitir(`solicitud:${correo}`, LIMITE_SOLICITUD) &&
		permitir(`ip:${ip}`, LIMITE_SOLICITUD_IP);

	if (!dentroDelLimite) {
		return json(
			{
				error:
					'Ya pediste varios enlaces en los últimos minutos. Revisa tu bandeja —incluida la carpeta de spam— antes de volver a intentarlo.'
			},
			{ status: 429 }
		);
	}

	const secreto = secretoFirma();
	const emisor = configCorreo();
	if (!secreto || !emisor) {
		// Fallar a la vista es mejor que devolver la respuesta neutra: si no,
		// un entorno mal configurado se ve exactamente igual que uno sano y
		// nadie descubre el problema hasta que un usuario se queda fuera.
		console.error(
			'[recuperacion] Falta configuración:',
			!secreto ? 'PASSWORD_RECOVERY_SECRET' : '',
			!emisor ? 'RESEND_API_KEY / RESEND_FROM' : ''
		);
		return json(
			{
				error:
					'La recuperación de contraseña no está configurada en este entorno. Comunícate con soporte.'
			},
			{ status: 503 }
		);
	}

	const usuario = await buscarUsuario(correo);

	if (usuario.estado === 'no-existe') {
		// Sin correo enviado y sin pistas para quien pregunta.
		return json(RESPUESTA_NEUTRA);
	}

	if (usuario.estado === 'indeterminado') {
		/// Se sigue adelante a propósito: el enlace no sirve de nada para quien
		/// no tiene cuenta (el backend rechaza el cambio al final), y cortar
		/// aquí dejaría la recuperación caída cada vez que el backend tosa.
		console.warn('[recuperacion] No se pudo verificar la cuenta:', usuario.detalle);
	}

	const { token, datos } = firmarToken(correo, secreto);
	const enlace = `${origenPublico(url.origin)}/recuperar-password/${token}`;

	const envio = await enviarCorreoRecuperacion(
		emisor,
		correo,
		enlace,
		usuario.estado === 'existe' ? usuario.nombre : null
	);

	if (!envio.enviado) {
		console.error('[recuperacion] Resend falló:', envio.detalle);
		return json(
			{
				error:
					'No pudimos enviar el correo en este momento. Inténtalo de nuevo en unos minutos o comunícate con soporte.'
			},
			{ status: 502 }
		);
	}

	console.info(`[recuperacion] Enlace emitido para ${correo} (jti ${datos.jti})`);
	return json(RESPUESTA_NEUTRA);
};
