import FingerprintJS from '@fingerprintjs/fingerprintjs';

let fpPromise: Promise<any> | null = null;

/**
 * Obtener el fingerprint único del dispositivo
 */
export async function getDeviceFingerprint(): Promise<string> {
	try {
		// Inicializar solo una vez
		if (!fpPromise) {
			fpPromise = FingerprintJS.load();
		}

		const fp = await fpPromise;
		const result = await fp.get();

		return result.visitorId;
	} catch (error) {
		console.error('Error al obtener fingerprint:', error);
		// Fallback: generar un ID basado en características del navegador
		return generateFallbackFingerprint();
	}
}

/**
 * Generar un fingerprint fallback si FingerprintJS falla
 */
function generateFallbackFingerprint(): string {
	const nav = window.navigator;
	const screen = window.screen;

	const data = [
		nav.userAgent,
		nav.language,
		screen.colorDepth,
		screen.width,
		screen.height,
		new Date().getTimezoneOffset(),
		nav.hardwareConcurrency || 'unknown',
		nav.platform
	].join('|');

	// Simple hash
	let hash = 0;
	for (let i = 0; i < data.length; i++) {
		const char = data.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}

	return `fallback_${Math.abs(hash).toString(36)}`;
}
