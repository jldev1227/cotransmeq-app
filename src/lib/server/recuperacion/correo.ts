/**
 * Envío del magic link por Resend.
 *
 * Se usa la API HTTP directamente en vez del SDK `resend`: es una sola
 * petición POST y evita añadir una dependencia (y su árbol) al bundle del
 * servidor para eso.
 *
 * El HTML sale de `$lib/server/correo-plantilla`, el espejo de la plantilla
 * de correos del backend: así este correo se ve igual que los demás que
 * manda el sistema (mascota, hero verde, botón de la app), en vez de
 * conservar la estética carbón y crema de las pantallas de acceso antiguas.
 */

import type { ConfigCorreo } from './config';
import { escaparHtml, renderCorreo } from '$lib/server/correo-plantilla';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Corte de la petición a Resend: el usuario espera en el formulario. */
const TIMEOUT_MS = 10_000;

const EMPRESA = 'Cotransmeq S.A.S';
const MINUTOS_VIGENCIA = 30;

export interface ResultadoEnvio {
	enviado: boolean;
	/** Detalle para el log del servidor; nunca se devuelve al navegador. */
	detalle?: string;
}

/**
 * HTML del correo de recuperación. Separado del envío para poder verlo
 * renderizado sin pasar por Resend.
 *
 * @param enlace URL absoluta con el token ya incrustado; de ella sale también
 *               el origen desde el que se sirve la mascota.
 */
export function htmlRecuperacion(enlace: string, nombre?: string | null, logoUrl?: string | null): string {
	const saludo = escaparHtml(nombre?.trim() || '');
	return renderCorreo({
		origen: new URL(enlace).origin,
		logoUrl,
		preheader: `Enlace para elegir una nueva contraseña. Vence en ${MINUTOS_VIGENCIA} minutos.`,
		eyebrow: 'Tu cuenta',
		titulo: 'Restablece tu contraseña',
		subtitulo: 'Un enlace de un solo uso para elegir una nueva.',
		mascota: 'saludando',
		saludo: saludo ? `Hola, <strong>${saludo}</strong>.` : 'Hola.',
		parrafos: [
			`Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema de gestión de ${EMPRESA}. Usa el botón para elegir una nueva.`
		],
		boton: { texto: 'Elegir nueva contraseña', url: enlace },
		notas: [
			{
				html: `El enlace vence en <strong>${MINUTOS_VIGENCIA} minutos</strong> y solo puede usarse una vez.`
			},
			{
				tono: 'neutro',
				html: 'Si no pediste este cambio, ignora este mensaje: tu contraseña actual sigue siendo válida y nadie puede cambiarla sin este enlace.'
			}
		],
		enlaceRespaldo: enlace,
		pie: [`${EMPRESA} · Yopal, Casanare · Colombia`, 'Este es un mensaje automático, no respondas a este correo.']
	});
}

/**
 * Manda el correo de recuperación.
 *
 * @param enlace URL absoluta con el token ya incrustado.
 * @param nombre Nombre del usuario si el backend lo conoce; se saluda con el
 *               correo cuando no.
 */
export async function enviarCorreoRecuperacion(
	config: ConfigCorreo,
	correo: string,
	enlace: string,
	nombre?: string | null
): Promise<ResultadoEnvio> {
	const html = htmlRecuperacion(enlace, nombre?.trim() || correo, config.logoUrl);
	const texto = [
		`Hola ${nombre?.trim() || correo},`,
		'',
		`Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema de ${EMPRESA}.`,
		'',
		`Abre este enlace para elegir una nueva contraseña (vence en ${MINUTOS_VIGENCIA} minutos):`,
		enlace,
		'',
		'Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue siendo válida.',
		'',
		`${EMPRESA} · Yopal, Casanare · Colombia`
	].join('\n');

	const controlador = new AbortController();
	const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

	try {
		const respuesta = await fetch(RESEND_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: config.remitente,
				to: [correo],
				subject: `Restablece tu contraseña · ${EMPRESA}`,
				html,
				text: texto
			}),
			signal: controlador.signal
		});

		if (!respuesta.ok) {
			const cuerpo = await respuesta.text().catch(() => '');
			return { enviado: false, detalle: `Resend respondió ${respuesta.status}: ${cuerpo}` };
		}

		return { enviado: true };
	} catch (error) {
		const detalle =
			error instanceof Error && error.name === 'AbortError'
				? `Resend no respondió en ${TIMEOUT_MS} ms`
				: error instanceof Error
					? error.message
					: 'Error desconocido al contactar Resend';
		return { enviado: false, detalle };
	} finally {
		clearTimeout(corte);
	}
}
