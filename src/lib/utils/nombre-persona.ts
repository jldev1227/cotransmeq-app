/**
 * Normalización del nombre y el apellido de una persona.
 *
 * ESPEJO de `backend-nest/src/modules/conductores/nombre-persona.ts`. Está
 * duplicado a propósito (dos builds, sin paquete compartido): el servidor es
 * quien manda, y esto solo evita que el usuario guarde algo y vea aparecer un
 * valor distinto del que acaba de teclear.
 *
 * La regla es MAYÚSCULAS —como se escriben los nombres en los formatos de la
 * empresa— y sin espacios de más. Se conservan tildes y Ñ: quitarlas cambiaría
 * el nombre de la persona, no lo limpiaría.
 */

/**
 * Se permiten letras (con diacríticos), espacios, apóstrofo y guion: hay
 * apellidos como «D'ANGELO» o «PEREZ-GOMEZ». Se quitan dígitos y puntuación,
 * que en este campo siempre han sido erratas.
 */
const NO_ES_NOMBRE = /[^\p{L}\s'’-]/gu;

export function normalizarNombrePersona(valor: string | null | undefined): string {
	if (valor === null || valor === undefined) return '';
	return String(valor)
		.replace(NO_ES_NOMBRE, ' ')
		// Colapsa cualquier racha de espacios (incluido el no separable que
		// llega al pegar desde Word o Excel) en uno solo.
		.replace(/[\s ]+/g, ' ')
		.trim()
		.toLocaleUpperCase('es-CO');
}
