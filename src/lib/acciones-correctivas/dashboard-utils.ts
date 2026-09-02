import type { AccionCorrectivaPreventiva } from '$lib/api/acciones-correctivas';
import { INTERVALO_SEGUIMIENTO_DIAS, addDays } from '$lib/acciones-correctivas/constants';

export function formatDate(dateStr: string): string {
	if (!dateStr || dateStr === 'undefined' || dateStr === 'null') return '';
	const [y, m, d] = dateStr.split('-');
	if (!y || !m || !d) return '';
	return `${d}/${y.slice(2)}`;
}

export function isUrgent(dateStr: string): boolean {
	const d = new Date(dateStr);
	const now = new Date();
	return d < now || d.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
}

export function getInitials(name: string): string {
	return name
		.split(' ')
		.slice(0, 2)
		.map((n) => n[0])
		.join('')
		.toUpperCase();
}

/**
 * Estados posibles de la "próxima revisión" de una acción.
 *
 * - `vencida`     : la última actividad tiene más de 15 días → se debió haber revisado antes de hoy
 * - `hoy`         : la revisión cae exactamente hoy
 * - `proxima`     : la revisión cae en los próximos 7 días
 * - `al-dia`      : la revisión aún está lejos (> 7 días)
 * - `cerrada`     : la acción está cerrada eficazmente, no requiere revisión
 * - `sin-actividad`: nunca se ha registrado ningún seguimiento/corrección
 */
export type EstadoRevision =
	| 'vencida'
	| 'hoy'
	| 'proxima'
	| 'al-dia'
	| 'cerrada'
	| 'sin-actividad';

export interface ResumenRevision {
	/** ISO YYYY-MM-DD de la última actividad registrada (causa/seguimiento/implementación) */
	ultimaFecha: string | null;
	/** ISO YYYY-MM-DD calculada como ultimaFecha + INTERVALO_SEGUIMIENTO_DIAS */
	proximaFecha: string | null;
	/** Días desde hoy hasta la próxima revisión (negativo si está vencida) */
	diasHasta: number | null;
	estado: EstadoRevision;
}

function toIsoDate(value: string | Date | null | undefined): string | null {
	if (!value) return null;
	if (value instanceof Date) {
		const y = value.getFullYear();
		const m = String(value.getMonth() + 1).padStart(2, '0');
		const d = String(value.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.split('T')[0];
}

function toDate(iso: string): Date | null {
	if (!iso) return null;
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return null;
	return new Date(y, m - 1, d);
}

export function isoHoy(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function diasEntre(desdeIso: string, hastaIso: string): number {
	const a = toDate(desdeIso);
	const b = toDate(hastaIso);
	if (!a || !b) return 0;
	const ms = b.getTime() - a.getTime();
	return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Devuelve la fecha (ISO) más reciente en la que hubo alguna actividad
 * sobre la acción: seguimiento de causa, seguimiento de corrección inmediata,
 * fecha de seguimiento a nivel acción, fecha de implementación, o en último
 * caso la fecha de identificación del hallazgo.
 */
export function fechaMasRecienteActividad(accion: AccionCorrectivaPreventiva): string | null {
	const fechas: string[] = [];
	const add = (f: string | Date | null | undefined) => {
		const iso = toIsoDate(f);
		if (iso) fechas.push(iso);
	};

	// 1. Causas: cada causa mantiene su propio fecha_seguimiento que se actualiza
	// al registrar un seguimiento (ver service.crearSeguimientoCausa).
	accion.causas?.forEach((c) => {
		if (c.fecha_seguimiento) add(c.fecha_seguimiento);
	});

	// 2. Seguimientos de corrección inmediata (el listar los devuelve en DESC,
	// por lo que el primero es el más reciente).
	accion.seguimientos_correccion?.forEach((s) => {
		if (s.fecha_seguimiento) add(s.fecha_seguimiento);
	});

	// 3. Campos a nivel acción
	add(accion.fecha_seguimiento);
	add(accion.fecha_implementacion);

	// 4. Fallback: si nunca hubo actividad, usamos la fecha de identificación
	// del hallazgo para no devolver null en acciones recién creadas.
	if (!fechas.length) {
		add(accion.fecha_identificacion_hallazgo);
	}

	if (!fechas.length) return null;
	return fechas.sort().at(-1) ?? null;
}

export function accionCerrada(accion: AccionCorrectivaPreventiva): boolean {
	if (accion.estado_global === 'CUMPLIDA') return true;
	if (accion.evaluacion_cierre_eficaz === 'EFICAZ' && accion.fecha_cierre_definitivo) return true;
	return false;
}

/**
 * Resumen completo de la próxima revisión de una acción.
 * Replica la lógica ya existente en constants.ts (calcularProximoSeguimiento)
 * pero aplicable al shape de fila que devuelve el endpoint de listado.
 */
export function resumenRevision(accion: AccionCorrectivaPreventiva): ResumenRevision {
	if (accionCerrada(accion)) {
		return { ultimaFecha: null, proximaFecha: null, diasHasta: null, estado: 'cerrada' };
	}

	const ultima = fechaMasRecienteActividad(accion);
	if (!ultima) {
		return { ultimaFecha: null, proximaFecha: null, diasHasta: null, estado: 'sin-actividad' };
	}

	const proximaFecha = addDays(ultima, INTERVALO_SEGUIMIENTO_DIAS);
	const diasHasta = diasEntre(isoHoy(), proximaFecha);

	let estado: EstadoRevision;
	if (diasHasta < 0) estado = 'vencida';
	else if (diasHasta === 0) estado = 'hoy';
	else if (diasHasta <= 7) estado = 'proxima';
	else estado = 'al-dia';

	return { ultimaFecha: ultima, proximaFecha, diasHasta, estado };
}

/**
 * Etiqueta humana corta para los días hasta la revisión.
 *   -3 → "Vencida hace 3d"
 *    0 → "Hoy"
 *    1 → "Mañana"
 *    5 → "En 5d"
 */
export function formatearDiasRelativo(dias: number | null): string {
	if (dias === null || dias === undefined) return '';
	if (dias === 0) return 'Hoy';
	if (dias < 0) return `Vencida hace ${Math.abs(dias)}d`;
	if (dias === 1) return 'Mañana';
	return `En ${dias}d`;
}
