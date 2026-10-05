/**
 * Tipos de evento de un formulario de asistencia, con su etiqueta visible.
 *
 * La lista y la etiqueta estaban copiadas en el listado, en la página de
 * respuestas y en el modal; al añadir un tipo había que acordarse de tres
 * sitios.
 */
import type { TipoEvento } from '$lib/api/asistencias';

export const TIPOS_EVENTO: ReadonlyArray<{ value: TipoEvento; label: string }> = [
	{ value: 'capacitacion', label: 'Capacitación' },
	{ value: 'asesoria', label: 'Asesoría' },
	{ value: 'charla', label: 'Charla' },
	{ value: 'induccion', label: 'Inducción' },
	{ value: 'reunion', label: 'Reunión' },
	{ value: 'divulgacion', label: 'Divulgación' },
	{ value: 'otro', label: 'Otro' }
];

/** «Capacitación», o el texto libre cuando el tipo es «otro». */
export function etiquetaTipoEvento(tipo: string, otro?: string | null): string {
	if (tipo === 'otro') return otro?.trim() || 'Otro';
	return TIPOS_EVENTO.find((t) => t.value === tipo)?.label ?? tipo;
}

/**
 * Fecha de un formulario como la escribió quien lo creó. Viene como ISO a
 * medianoche UTC; leerla en hora local la corría un día hacia atrás en
 * Colombia, así que se toman las partes UTC.
 */
export function fechaEvento(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).toLocaleDateString('es-CO', opts);
}

/** «2h 30m» a partir de minutos; vacío si no hay duración. */
export function duracionLegible(minutos?: number | null): string {
	if (!minutos || minutos <= 0) return '';
	const h = Math.floor(minutos / 60);
	const m = minutos % 60;
	return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
}
