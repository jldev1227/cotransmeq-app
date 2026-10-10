/**
 * Última URL del listado de liquidaciones de servicios, con sus filtros.
 *
 * El listado ya escribe búsqueda, filtros, orden y página en la URL; pero el
 * «Volver» del detalle y del editor navegaba a la ruta pelada y el usuario
 * tenía que buscar otra vez el mismo cliente cada vez que entraba y salía.
 * Va en sessionStorage para que sobreviva a recargar el detalle y no se
 * cruce entre pestañas del navegador.
 */
const BASE = '/dashboard/liquidaciones-servicios';
const CLAVE = 'liquidaciones-servicios:listado';

export function recordarListado(url: string): void {
	if (!url.startsWith(BASE)) return;
	try {
		sessionStorage.setItem(CLAVE, url);
	} catch {
		/* modo privado o storage bloqueado: se vuelve al listado sin filtros */
	}
}

export function urlListado(): string {
	try {
		const url = sessionStorage.getItem(CLAVE);
		if (url && (url === BASE || url.startsWith(BASE + '?'))) return url;
	} catch {
		/* idem */
	}
	return BASE;
}
