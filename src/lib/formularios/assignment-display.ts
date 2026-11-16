const asignacionDeImportacion = /^Importado\s+(?:TRANSMERALDA|COTRANSMEQ)\s*·/i;

/** Las asignaciones técnicas de importación no son nombres visibles para usuarios. */
export function esAsignacionDeImportacion(nombre?: string | null): boolean {
	return asignacionDeImportacion.test(nombre?.trim() ?? '');
}

export function nombreAsignacionVisible(nombre?: string | null): string | null {
	const limpio = nombre?.trim();
	return limpio && !esAsignacionDeImportacion(limpio) ? limpio : null;
}
