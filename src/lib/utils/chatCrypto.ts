/**
 * Web Crypto helpers para cifrado E2E del chat.
 *
 * En MVP los mensajes NO se cifran en el cliente; el backend se encarga
 * de AES-256-GCM con HKDF. Estos helpers quedan preparados para cuando
 * se active cifrado E2E real.
 *
 * Contrato esperado con backend:
 *   - Algoritmo: AES-256-GCM
 *   - Key derivada: HKDF-SHA256(MASTER_KEY, salt=liquidacionId, info='liq-chat-v1', length=32)
 *   - Nonce: 12 bytes aleatorios por mensaje
 *   - AAD: liquidacion_tercero_id (previene reordenamiento entre salas)
 *   - Formato guardado: { contenido_cifrado: base64(ciphertext), nonce: base64(iv) }
 */

export async function generateKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKey(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importKey(raw: string): Promise<CryptoKey> {
	const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
}

export async function encrypt(
	plainText: string,
	key: CryptoKey
): Promise<{ ciphertext: string; nonce: string }> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plainText);
	const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
	return {
		ciphertext: btoa(String.fromCharCode(...new Uint8Array(buf))),
		nonce: btoa(String.fromCharCode(...iv))
	};
}

export async function decrypt(ciphertext: string, nonce: string, key: CryptoKey): Promise<string> {
	const iv = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
	const data = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
	const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
	return new TextDecoder().decode(buf);
}

export function hashForLog(text: string): string {
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (h << 5) - h + text.charCodeAt(i);
		h |= 0;
	}
	return h.toString(16);
}
