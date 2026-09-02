/**
 * Envío del magic link por Resend.
 *
 * Se usa la API HTTP directamente en vez del SDK `resend`: es una sola
 * petición POST y evita añadir una dependencia (y su árbol) al bundle del
 * servidor para eso.
 *
 * La plantilla es HTML de tabla, con estilos en línea y sin webfonts, porque
 * Outlook y Gmail ignoran `<style>` externo, flexbox y grid. La estética sigue
 * la de las pantallas de acceso: carbón `#0f172a`, crema `#fcfcfb` y el acento
 * esmeralda de la marca.
 */

import type { ConfigCorreo } from './config';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Corte de la petición a Resend: el usuario espera en el formulario. */
const TIMEOUT_MS = 10_000;

function escaparHtml(valor: string): string {
	return valor
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface ResultadoEnvio {
	enviado: boolean;
	/** Detalle para el log del servidor; nunca se devuelve al navegador. */
	detalle?: string;
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
	const saludo = escaparHtml(nombre?.trim() || correo);
	const enlaceSeguro = escaparHtml(enlace);

	const html = plantilla(saludo, enlaceSeguro);
	const texto = [
		`Hola ${nombre?.trim() || correo},`,
		'',
		'Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema de Cotransmeq S.A.S.',
		'',
		'Abre este enlace para elegir una nueva contraseña (vence en 30 minutos):',
		enlace,
		'',
		'Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue siendo válida.',
		'',
		'Cotransmeq S.A.S · Yopal, Casanare · Colombia'
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
				subject: 'Restablece tu contraseña · Cotransmeq S.A.S',
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

function plantilla(saludo: string, enlace: string): string {
	return `<!doctype html>
<html lang="es">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Restablece tu contraseña</title>
	</head>
	<body style="margin:0;padding:0;background-color:#fcfcfb;">
		<!-- Preheader: lo que se lee en la bandeja antes de abrir. -->
		<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
			Enlace para elegir una nueva contraseña. Vence en 30 minutos.
		</div>
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fcfcfb;padding:32px 16px;">
			<tr>
				<td align="center">
					<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:20px;overflow:hidden;">
						<tr>
							<td style="background-color:#0f172a;padding:28px 32px;">
								<p style="margin:0;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#f97316;">
									Cotransmeq S.A.S
								</p>
								<p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:#f0ede6;">
									Restablece tu contraseña
								</p>
							</td>
						</tr>
						<tr>
							<td style="padding:32px;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
								<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hola ${saludo},</p>
								<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a4a;">
									Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema de gestión.
									Usa el botón para elegir una nueva.
								</p>
								<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
									<tr>
										<td align="center" bgcolor="#ea580c" style="border-radius:12px;">
											<a href="${enlace}" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">
												Elegir nueva contraseña
											</a>
										</td>
									</tr>
								</table>
								<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#4a4a4a;">
									El enlace vence en <strong>30 minutos</strong> y solo puede usarse una vez.
								</p>
								<p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#4a4a4a;">
									Si el botón no funciona, copia esta dirección en tu navegador:<br />
									<a href="${enlace}" style="color:#ea580c;word-break:break-all;">${enlace}</a>
								</p>
								<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
									<tr><td style="border-top:1px solid rgba(0,0,0,0.08);padding-top:20px;">
										<p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b6b;">
											Si no pediste este cambio, ignora este mensaje: tu contraseña actual sigue siendo válida
											y nadie puede cambiarla sin este enlace.
										</p>
									</td></tr>
								</table>
							</td>
						</tr>
						<tr>
							<td style="background-color:#fcfcfb;padding:18px 32px;border-top:1px solid rgba(0,0,0,0.06);">
								<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#9a9a9a;">
									Cotransmeq S.A.S · Yopal, Casanare · Colombia<br />
									Este es un mensaje automático, no respondas a este correo.
								</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;
}
