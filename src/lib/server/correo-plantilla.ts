/**
 * Plantilla de los correos que manda el PROPIO frontend (hoy, solo el de
 * recuperación de contraseña, que sale por Resend desde el servidor de
 * SvelteKit porque el enlace lo firma aquí).
 *
 * Es un espejo recortado de `backend/src/services/email-plantilla.ts`: la
 * misma tarjeta blanca sobre el fondo de marca, el hero verde con eyebrow,
 * título y la mascota a la derecha, y los mismos colores. Si cambia el
 * diseño de los correos del backend, este archivo cambia con él: no hay
 * forma de importarlo desde aquí.
 *
 * Reglas de compatibilidad (Gmail, Outlook, Apple Mail): solo tablas y CSS
 * en línea, ancho fijo de 600 px, `bgcolor` de respaldo en las celdas de
 * color e imágenes por URL pública absoluta. La mascota se sirve como PNG
 * desde esta misma app (`/mascot/png/<reaccion>.png`): el webp no se ve en
 * Outlook ni en varios clientes de escritorio.
 */

export type MascotaReaccion =
	| 'saludando'
	| 'correo-enviado'
	| 'todo-bien'
	| 'celebrando'
	| 'trabajando'
	| 'alerta'
	| 'esperando'
	| 'pensando'
	| 'sin-resultados';

/** Identidad de la marca. Es el único bloque que cambia entre proyectos. */
export const MARCA = {
	nombre: 'Cotransmeq',
	razonSocial: 'Cotransmeq S.A.S.',
	/** Alto del logotipo en el correo; el PNG de cada marca trae márgenes distintos. */
	logoAlto: 56,
	/// `assets/logo.png` es el de Transmeralda; este objeto sí es público.
	logoPorDefecto: 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png',
	oscuro: '#14532d',
	oscuro2: '#166534',
	primario: '#ea580c',
	tinte: '#ffedd5',
	eyebrow: '#fdba74',
	heroTexto: '#ffedd5',
	fondo: '#fff7ed',
	texto: '#0f172a',
	muted: '#64748b',
	borde: '#e2e8f0',
	suave: '#f8fafc',
	peligro: '#b42318',
	peligroSuave: '#fff0ed',
	aviso: '#7a5c00',
	avisoSuave: '#fdf6d8'
} as const;

const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const ALT_MASCOTA: Record<MascotaReaccion, string> = {
	saludando: 'saludando',
	'correo-enviado': 'con un correo enviado',
	'todo-bien': 'confirmando que todo está bien',
	celebrando: 'celebrando',
	trabajando: 'trabajando',
	alerta: 'en alerta',
	esperando: 'esperando',
	pensando: 'pensando',
	'sin-resultados': 'sin resultados'
};

export function escaparHtml(valor: unknown): string {
	return String(valor ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export type TonoNota = 'info' | 'alerta' | 'aviso' | 'neutro';

export interface Nota {
	/** HTML. */
	html: string;
	tono?: TonoNota;
}

export interface CorreoOpciones {
	/** Origen público de la app, para la mascota: `https://app.ejemplo.com`. */
	origen: string;
	/** URL pública del logotipo; sin ella va la de la marca. */
	logoUrl?: string | null;
	/** Texto que muestran las bandejas junto al asunto (oculto en el cuerpo). */
	preheader?: string;
	eyebrow: string;
	titulo: string;
	subtitulo?: string;
	mascota: MascotaReaccion;
	/** «Hola, Nombre». HTML. */
	saludo?: string;
	/** Párrafos del cuerpo. HTML ya escapado. */
	parrafos?: string[];
	boton?: { texto: string; url: string };
	notas?: Nota[];
	/** URL para «Si el botón no funciona…». */
	enlaceRespaldo?: string;
	/** Líneas del pie. HTML. */
	pie?: string[];
}

function bloqueParrafo(html: string): string {
	return `<p style="margin:0 0 16px 0;color:${MARCA.texto};font-family:${FUENTE};font-size:15px;line-height:24px;">${html}</p>`;
}

function bloqueBoton(boton: { texto: string; url: string }): string {
	const url = escaparHtml(boton.url);
	return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:4px 0 20px 0;">
  <tr>
    <td align="center" bgcolor="${MARCA.primario}" style="background-color:${MARCA.primario};border-radius:16px;">
      <a href="${url}" target="_blank" style="display:block;padding:16px 24px;color:#ffffff;font-family:${FUENTE};font-size:16px;font-weight:800;line-height:20px;text-decoration:none;border-radius:16px;">${boton.texto}</a>
    </td>
  </tr>
</table>`;
}

function bloqueNota(nota: Nota): string {
	const tono = nota.tono ?? 'info';
	const estilos: Record<TonoNota, { fondo: string; texto: string; borde: string }> = {
		info: { fondo: MARCA.fondo, texto: MARCA.oscuro, borde: MARCA.tinte },
		alerta: { fondo: MARCA.peligroSuave, texto: MARCA.peligro, borde: '#f6d5cf' },
		aviso: { fondo: MARCA.avisoSuave, texto: MARCA.aviso, borde: '#efe2a8' },
		neutro: { fondo: MARCA.suave, texto: MARCA.muted, borde: MARCA.borde }
	};
	const e = estilos[tono];
	return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 14px 0;">
  <tr>
    <td bgcolor="${e.fondo}" style="background-color:${e.fondo};border:1px solid ${e.borde};border-radius:14px;padding:13px 16px;color:${e.texto};font-family:${FUENTE};font-size:13px;line-height:20px;">${nota.html}</td>
  </tr>
</table>`;
}

function enlaceRespaldoHtml(url: string): string {
	const u = escaparHtml(url);
	return `
<p style="margin:8px 0 0 0;color:${MARCA.muted};font-family:${FUENTE};font-size:12px;line-height:18px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
<p style="margin:4px 0 0 0;font-family:${FUENTE};font-size:12px;line-height:18px;word-break:break-all;"><a href="${u}" style="color:${MARCA.primario};text-decoration:underline;">${u}</a></p>`;
}

/** Arma el correo completo. Devuelve el documento HTML listo para enviar. */
export function renderCorreo(o: CorreoOpciones): string {
	const origen = o.origen.replace(/\/+$/, '');
	const urlMascota = `${origen}/mascot/png/${o.mascota}.png`;
	const urlLogo = o.logoUrl?.trim() || MARCA.logoPorDefecto;

	const cuerpo = [
		o.saludo
			? `<p style="margin:0 0 14px 0;color:${MARCA.texto};font-family:${FUENTE};font-size:16px;line-height:24px;">${o.saludo}</p>`
			: '',
		...(o.parrafos ?? []).map(bloqueParrafo),
		o.boton ? bloqueBoton(o.boton) : '',
		...(o.notas ?? []).map(bloqueNota),
		o.enlaceRespaldo ? enlaceRespaldoHtml(o.enlaceRespaldo) : ''
	].join('');

	const pie = (o.pie && o.pie.length > 0
		? o.pie
		: [`Este correo fue enviado automáticamente por el sistema de ${MARCA.nombre}.`]
	)
		.map(
			(l) =>
				`<p style="margin:0 0 4px 0;color:${MARCA.muted};font-family:${FUENTE};font-size:12px;line-height:18px;">${l}</p>`
		)
		.join('');

	const preheader = o.preheader
		? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${MARCA.fondo};opacity:0;">${escaparHtml(o.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
		: '';

	const subtitulo = o.subtitulo
		? `<p style="margin:8px 0 0 0;color:${MARCA.heroTexto};font-family:${FUENTE};font-size:14px;line-height:20px;">${o.subtitulo}</p>`
		: '';

	return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <title>${escaparHtml(o.titulo)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>table,td{border-collapse:collapse;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${MARCA.fondo};-webkit-text-size-adjust:100%;">
${preheader}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${MARCA.fondo}" style="background-color:${MARCA.fondo};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" bgcolor="#ffffff" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${MARCA.borde};border-radius:24px;">

        <!-- Logo -->
        <tr>
          <td style="padding:22px 28px 6px 28px;">
            <img src="${escaparHtml(urlLogo)}" alt="${MARCA.nombre}" height="${MARCA.logoAlto}" style="display:block;height:${MARCA.logoAlto}px;width:auto;border:0;" />
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="padding:12px 16px 0 16px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${MARCA.oscuro}" style="background-color:${MARCA.oscuro};background-image:linear-gradient(135deg,${MARCA.oscuro2} 0%,${MARCA.oscuro} 100%);border-radius:24px;">
              <tr>
                <td valign="middle" style="padding:30px 8px 30px 28px;">
                  <p style="margin:0 0 10px 0;color:${MARCA.eyebrow};font-family:${FUENTE};font-size:11px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;line-height:14px;">${o.eyebrow}</p>
                  <p style="margin:0;color:#ffffff;font-family:${FUENTE};font-size:26px;font-weight:900;letter-spacing:-0.4px;line-height:31px;">${o.titulo}</p>
                  ${subtitulo}
                </td>
                <td width="150" valign="bottom" align="right" style="width:150px;padding:14px 10px 0 0;">
                  <img src="${escaparHtml(urlMascota)}" alt="Mascota de ${MARCA.nombre} ${ALT_MASCOTA[o.mascota]}" width="140" height="140" style="display:block;width:140px;height:140px;border:0;" />
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:26px 28px 10px 28px;">
            ${cuerpo}
          </td>
        </tr>

        <!-- Pie -->
        <tr>
          <td bgcolor="${MARCA.suave}" style="background-color:${MARCA.suave};border-top:1px solid ${MARCA.borde};border-radius:0 0 24px 24px;padding:18px 28px;text-align:center;">
            ${pie}
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:16px 0 0 0;color:${MARCA.muted};font-family:${FUENTE};font-size:11px;line-height:16px;">${MARCA.razonSocial}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}
