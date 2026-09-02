/**
 * Reglas de la contraseña nueva.
 *
 * Vive fuera de `$lib/server` a propósito: la página la usa para avisar
 * mientras se escribe y la ruta de API la vuelve a aplicar antes de mandar
 * nada al backend. Una sola definición evita el clásico «el formulario la
 * aceptó y el servidor la rechazó».
 */

export const LARGO_MINIMO = 8;

/**
 * Tope de bcrypt: ignora en silencio lo que pase de 72 bytes, así que una
 * contraseña más larga daría la falsa impresión de que el final cuenta.
 */
export const LARGO_MAXIMO = 72;

export const REQUISITOS = [
	`Mínimo ${LARGO_MINIMO} caracteres`,
	'Al menos una letra y un número'
] as const;

/**
 * @returns El motivo del rechazo, o `null` si la contraseña sirve.
 */
export function validarPassword(password: string, confirmacion?: string): string | null {
	if (!password) return 'Escribe una contraseña nueva.';
	if (password.length < LARGO_MINIMO) {
		return `La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`;
	}
	if (password.length > LARGO_MAXIMO) {
		return `La contraseña no puede superar los ${LARGO_MAXIMO} caracteres.`;
	}
	if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) || !/\d/.test(password)) {
		return 'La contraseña debe combinar al menos una letra y un número.';
	}
	if (confirmacion !== undefined && password !== confirmacion) {
		return 'Las contraseñas no coinciden.';
	}
	return null;
}
