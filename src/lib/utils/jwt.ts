/**
 * Decodifica un JWT sin verificar la firma (solo para leer el payload)
 */
export function decodeJWT(token: string): any {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return null;
		}

		const payload = parts[1];
		const decoded = JSON.parse(atob(payload));
		return decoded;
	} catch (error) {
		console.error('Error al decodificar JWT:', error);
		return null;
	}
}

/**
 * Verifica si un JWT está expirado
 * @param token - El token JWT a verificar
 * @returns true si está expirado, false si aún es válido
 */
export function isTokenExpired(token: string): boolean {
	const decoded = decodeJWT(token);
	if (!decoded || !decoded.exp) {
		return true; // Si no se puede decodificar o no tiene exp, considerarlo expirado
	}

	// exp está en segundos, Date.now() está en milisegundos
	const expirationTime = decoded.exp * 1000;
	const currentTime = Date.now();

	return currentTime >= expirationTime;
}

/**
 * Obtiene el tiempo restante hasta la expiración del token en milisegundos
 * @param token - El token JWT
 * @returns milisegundos hasta la expiración, o 0 si ya expiró
 */
export function getTimeUntilExpiration(token: string): number {
	const decoded = decodeJWT(token);
	if (!decoded || !decoded.exp) {
		return 0;
	}

	const expirationTime = decoded.exp * 1000;
	const currentTime = Date.now();
	const timeRemaining = expirationTime - currentTime;

	return Math.max(0, timeRemaining);
}

/**
 * Formatea el tiempo restante en un string legible
 * @param milliseconds - Milisegundos restantes
 * @returns String formateado (ej: "2h 30m")
 */
export function formatTimeRemaining(milliseconds: number): string {
	if (milliseconds <= 0) {
		return 'Expirado';
	}

	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		const remainingHours = hours % 24;
		return `${days}d ${remainingHours}h`;
	} else if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m`;
	} else if (minutes > 0) {
		return `${minutes}m`;
	} else {
		return `${seconds}s`;
	}
}
