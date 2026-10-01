/**
 * Etiquetas humanas del propósito de un servicio.
 *
 * El backend guarda el enum de Prisma `enum_servicio_proposito_servicio`,
 * cuyos valores llegan con guion bajo (`personal_y_herramienta`), mientras
 * que el formulario de servicios todavía envía la variante con espacios
 * (`personal y herramienta`) que el backend normaliza. Hasta ahora cada
 * pantalla mostraba el valor crudo o lo "arreglaba" a su manera con
 * `replace(/_/g, ' ')` y `capitalize`; este es el único sitio que decide
 * cómo se lee cada propósito.
 *
 * Cubre todos los valores del enum de `prisma/schema.prisma` y los valores
 * históricos que aún circulan por algunos stores (`ocasional`, `empresarial`,
 * `comercial`). Un valor desconocido se humaniza (guiones a espacios y
 * mayúscula inicial) en vez de salir crudo.
 */
export const PROPOSITO_SERVICIO_LABELS: Record<string, string> = {
	personal: 'Personal',
	personal_y_herramienta: 'Personal y herramienta',
	'personal y herramienta': 'Personal y herramienta',
	ocasional: 'Ocasional',
	empresarial: 'Empresarial',
	comercial: 'Comercial'
};

/** `personal_y_herramienta` → `Personal y herramienta`. */
export function labelPropositoServicio(valor: string | null | undefined): string {
	if (!valor) return '—';
	const conocido = PROPOSITO_SERVICIO_LABELS[valor];
	if (conocido) return conocido;
	const texto = valor.replace(/_/g, ' ').trim();
	return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Valor canónico del enum (con guion bajo) a partir de cualquiera de las dos
 * variantes, para comparar sin preocuparse de cuál llegó.
 */
export function normalizarPropositoServicio(valor: string | null | undefined): string {
	return (valor ?? '').trim().replace(/\s+/g, '_');
}
