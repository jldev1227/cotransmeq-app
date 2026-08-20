/**
 * Preparación de evidencia en el dispositivo: comprimir, hashear y medir cuota.
 *
 * Todo ocurre ANTES de guardar en IndexedDB, y por una razón muy concreta: una
 * foto de un móvil actual pesa entre 3 y 8 MB. Diez fotos sin comprimir en un
 * preoperacional son 50 MB de IndexedDB y 50 MB de datos móviles del conductor
 * para subirlas. Comprimida a 1920 px de lado mayor y JPEG de calidad 0,82, la
 * misma foto ronda 300–600 KB y sigue sirviendo para documentar una fuga o una
 * llanta lisa.
 *
 * El `sha256` se calcula sobre el binario FINAL (el comprimido). Es el que se
 * declara al servidor y el que este verifica contra el objeto de S3: hashear el
 * original haría que la verificación fallara siempre.
 */

import { browser } from '$app/environment';
import { ATTACHMENT_LIMITS } from '$lib/formularios/types';

export interface PreparedMedia {
	blob: Blob;
	mimeType: string;
	byteSize: number;
	sha256: string;
	originalName: string | null;
	/** Bytes del archivo original, para poder informar cuánto se ahorró. */
	originalBytes: number;
	width?: number;
	height?: number;
}

/** Error con causa legible, para mostrarlo tal cual en el runner. */
export class MediaError extends Error {
	readonly code:
		| 'TOO_LARGE'
		| 'TYPE_NOT_ALLOWED'
		| 'DECODE_FAILED'
		| 'QUOTA'
		| 'UNSUPPORTED';

	constructor(code: MediaError['code'], message: string) {
		super(message);
		this.name = 'MediaError';
		this.code = code;
	}
}

/**
 * SHA-256 en hexadecimal minúscula.
 *
 * `crypto.subtle` requiere contexto seguro (HTTPS o localhost). El portal ya lo
 * exige por el service worker, así que si falta es un error de despliegue y no
 * algo que se pueda degradar: sin hash el servidor no puede verificar la subida.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
	if (!browser || !crypto?.subtle) {
		throw new MediaError('UNSUPPORTED', 'El navegador no expone crypto.subtle (requiere HTTPS).');
	}
	const buffer = await blob.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Comprime una imagen a JPEG con el lado mayor acotado.
 *
 * Usa `createImageBitmap` cuando existe porque respeta la orientación EXIF
 * (`imageOrientation: 'from-image'`): sin eso, una foto tomada en vertical con
 * ciertos teléfonos se guarda girada 90°, y una llanta fotografiada de lado es
 * inservible como evidencia. El fallback con `<img>` mantiene la orientación en
 * los navegadores modernos, que ya la aplican al decodificar.
 */
async function comprimirImagen(
	file: Blob,
	maxEdge: number,
	quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
	let ancho = 0;
	let alto = 0;
	let fuente: ImageBitmap | HTMLImageElement;

	if (typeof createImageBitmap === 'function') {
		try {
			fuente = await createImageBitmap(file, { imageOrientation: 'from-image' });
			ancho = fuente.width;
			alto = fuente.height;
		} catch {
			throw new MediaError('DECODE_FAILED', 'No se pudo leer la imagen.');
		}
	} else {
		fuente = await new Promise<HTMLImageElement>((resolve, reject) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve(img);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new MediaError('DECODE_FAILED', 'No se pudo leer la imagen.'));
			};
			img.src = url;
		});
		ancho = (fuente as HTMLImageElement).naturalWidth;
		alto = (fuente as HTMLImageElement).naturalHeight;
	}

	/// Solo se reduce; nunca se amplía. Ampliar una foto pequeña no añade
	/// información y multiplica el peso.
	const escala = Math.min(1, maxEdge / Math.max(ancho, alto));
	const destinoAncho = Math.max(1, Math.round(ancho * escala));
	const destinoAlto = Math.max(1, Math.round(alto * escala));

	const canvas = document.createElement('canvas');
	canvas.width = destinoAncho;
	canvas.height = destinoAlto;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new MediaError('UNSUPPORTED', 'El navegador no soporta canvas 2D.');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(fuente as CanvasImageSource, 0, 0, destinoAncho, destinoAlto);
	if ('close' in fuente && typeof fuente.close === 'function') fuente.close();

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', quality)
	);
	if (!blob) throw new MediaError('DECODE_FAILED', 'No se pudo comprimir la imagen.');

	return { blob, width: destinoAncho, height: destinoAlto };
}

/**
 * Prepara una FOTO para guardarla localmente.
 *
 * El límite de 10 MB se aplica al ORIGINAL: un archivo mayor probablemente no es
 * una foto de cámara sino un vídeo o un PDF mal elegido, y decodificarlo en
 * canvas agotaría la memoria del teléfono antes de fallar.
 */
export async function prepararFoto(file: File): Promise<PreparedMedia> {
	if (!file.type.startsWith('image/')) {
		throw new MediaError('TYPE_NOT_ALLOWED', 'Selecciona una imagen.');
	}
	if (file.size > ATTACHMENT_LIMITS.maxPhotoBytes) {
		throw new MediaError(
			'TOO_LARGE',
			`La imagen supera ${Math.round(ATTACHMENT_LIMITS.maxPhotoBytes / 1024 / 1024)} MB.`
		);
	}

	const { blob, width, height } = await comprimirImagen(
		file,
		ATTACHMENT_LIMITS.photoMaxEdge,
		ATTACHMENT_LIMITS.photoQuality
	);

	/// Si comprimir salió PEOR que el original (pasa con PNG pequeños o capturas
	/// de pantalla), se guarda el original: reencodear a JPEG habría añadido peso
	/// y artefactos por nada.
	const usarOriginal =
		blob.size >= file.size && (ATTACHMENT_LIMITS.allowedPhotoMime as readonly string[]).includes(file.type);
	const final = usarOriginal ? file : blob;
	const mimeType = usarOriginal ? file.type : 'image/jpeg';

	return {
		blob: final,
		mimeType,
		byteSize: final.size,
		sha256: await sha256Hex(final),
		originalName: file.name || null,
		originalBytes: file.size,
		width,
		height
	};
}

/** Prepara un ARCHIVO (PDF o imagen). No se comprime: puede ser un documento. */
export async function prepararArchivo(file: File): Promise<PreparedMedia> {
	if (!(ATTACHMENT_LIMITS.allowedFileMime as readonly string[]).includes(file.type)) {
		throw new MediaError('TYPE_NOT_ALLOWED', `Tipo no permitido: ${file.type || 'desconocido'}.`);
	}
	if (file.size > ATTACHMENT_LIMITS.maxFileBytes) {
		throw new MediaError(
			'TOO_LARGE',
			`El archivo supera ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB.`
		);
	}
	return {
		blob: file,
		mimeType: file.type,
		byteSize: file.size,
		sha256: await sha256Hex(file),
		originalName: file.name || null,
		originalBytes: file.size
	};
}

/**
 * Convierte un canvas de firma en PNG listo para guardar.
 *
 * PNG y no JPEG: una firma es un trazo negro sobre blanco, y JPEG produce halos
 * alrededor de las líneas finas que la vuelven ilegible al ampliarla en un
 * informe. El PNG de una firma pesa unas decenas de KB.
 */
export async function prepararFirma(canvas: HTMLCanvasElement): Promise<PreparedMedia> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new MediaError('DECODE_FAILED', 'No se pudo capturar la firma.');
	if (blob.size > ATTACHMENT_LIMITS.maxSignatureBytes) {
		throw new MediaError('TOO_LARGE', 'La firma resultó demasiado grande.');
	}
	return {
		blob,
		mimeType: 'image/png',
		byteSize: blob.size,
		sha256: await sha256Hex(blob),
		originalName: 'firma.png',
		originalBytes: blob.size
	};
}

/**
 * ¿Está el canvas de firma en blanco?
 *
 * Se comprueba el canal alfa de todos los píxeles. Sin esto, tocar el área de
 * firma sin dibujar nada guardaría un PNG vacío que pasaría la validación de
 * «tiene evidencia» y dejaría un acta firmada en blanco.
 */
export function canvasEstaVacio(canvas: HTMLCanvasElement): boolean {
	const ctx = canvas.getContext('2d');
	if (!ctx) return true;
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 0) return false;
	}
	return true;
}

/** Tamaño legible, para los mensajes de la UI. */
export function bytesLegibles(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
