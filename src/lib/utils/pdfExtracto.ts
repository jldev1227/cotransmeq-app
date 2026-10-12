/**
 * PDF del extracto de contrato (FUEC, formato OP-FR-04) en el navegador.
 *
 * La hoja la describe `pdfExtractoDoc.ts`, que es espejo exacto del módulo
 * homónimo del backend: la app del conductor recibe del servidor el mismo
 * documento que aquí se descarga. Este archivo solo pone lo que depende del
 * navegador: convertir las imágenes a PNG con un canvas, dibujar el QR y
 * entregar el archivo.
 */
import QRCode from 'qrcode';
import { urlPublicaExtracto, type EmpresaFuec, type SnapshotExtracto } from '$lib/api/extractos';
import { blobDePdf, cargarPdfMake } from '$lib/utils/pdfmake-cargar';
import { logoPngDataUrl } from '$lib/utils/pdfControlDias';
import {
	OPCIONES_QR_EXTRACTO,
	docExtracto,
	nombreArchivoExtracto,
	type ImagenesDocExtracto
} from '$lib/utils/pdfExtractoDoc';

export { nombreArchivoExtracto };

export interface OpcionesPdfExtracto {
	empresa: EmpresaFuec;
	/** Logo de la empresa (webp/png) para la cabecera. */
	logo: string;
	/** Firma del gerente (png). */
	firma: string;
	codigo_verificacion: string | null;
	huella: string | null;
	/** «Copia» en los importados del libro, sin firma del sistema. */
	marca?: string | null;
}

async function cargarImagenes(o: OpcionesPdfExtracto): Promise<ImagenesDocExtracto> {
	const [logo, firma, mintransporte, supertransporte, qr] = await Promise.all([
		logoPngDataUrl(o.logo).catch(() => null),
		logoPngDataUrl(o.firma).catch(() => null),
		logoPngDataUrl('/assets/la_movilidad_es_de_todos.png').catch(() => null),
		logoPngDataUrl('/assets/super_transporte.png').catch(() => null),
		o.codigo_verificacion
			? QRCode.toDataURL(urlPublicaExtracto(o.codigo_verificacion), {
					...OPCIONES_QR_EXTRACTO
				}).catch(() => null)
			: Promise.resolve(null)
	]);
	return { logo, firma, mintransporte, supertransporte, qr };
}

export async function blobExtracto(s: SnapshotExtracto, o: OpcionesPdfExtracto): Promise<Blob> {
	const [pdfMake, imagenes] = await Promise.all([cargarPdfMake(), cargarImagenes(o)]);
	const urlPublica = o.codigo_verificacion ? urlPublicaExtracto(o.codigo_verificacion) : null;
	return blobDePdf(pdfMake, docExtracto(s, { ...o, url_publica: urlPublica }, imagenes));
}

/** Descarga el extracto como PDF; devuelve el nombre del archivo. */
export async function descargarExtracto(
	s: SnapshotExtracto,
	o: OpcionesPdfExtracto
): Promise<string> {
	const blob = await blobExtracto(s, o);
	const nombre = nombreArchivoExtracto(s);
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombre;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
	return nombre;
}
