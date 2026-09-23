/**
 * Cómo se escribe el desfase de días de un tramo.
 *
 * Antes en pantalla salía «+1» y nadie sabía qué significaba: ¿una hora más?
 * ¿un día? ¿el día anterior? Aquí se dice con palabras y, cuando se conoce la
 * fecha del día laborado, con la fecha concreta — que es lo único que resuelve
 * la duda de verdad.
 *
 * Vive aparte del componente porque lo usan el selector de hora, el resumen del
 * tramo y la tabla del administrador, y las tres tienen que leerse igual.
 */

/** Tope de desfase admitido. Igual que `MAX_OFFSET_DIAS` del backend. */
export const MAX_OFFSET_DIAS = 2;

/** `2026-09-23` → `mié 23 sep`. Cadena vacía si la fecha no se entiende. */
export function fechaCorta(fechaYmd: string | null | undefined): string {
	if (!fechaYmd) return '';
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaYmd);
	if (!m) return '';
	/// Se construye en UTC y se formatea en UTC: con `new Date('2026-09-23')` y
	/// un formateo local, en Colombia (UTC-5) el día se corre al 22.
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	if (Number.isNaN(d.getTime())) return '';
	/// Se arma por partes y no con la cadena que devuelve `toLocaleDateString`:
	/// en es-CO esa sale como «jue, 24 de sept», y aquí se lee a un metro de
	/// distancia y en una celda estrecha. «jue 24 sep» dice lo mismo.
	const partes = new Intl.DateTimeFormat('es-CO', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).formatToParts(d);
	const parte = (tipo: string) =>
		(partes.find((p) => p.type === tipo)?.value ?? '').replace(/\.$/, '');
	return `${parte('weekday')} ${parte('day')} ${parte('month')}`.trim();
}

/** La fecha del día laborado más `dias`. `2026-09-23` +1 → `2026-09-24`. */
export function fechaConOffset(fechaYmd: string | null | undefined, dias: number): string {
	if (!fechaYmd) return '';
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaYmd);
	if (!m) return '';
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	if (Number.isNaN(d.getTime())) return '';
	d.setUTCDate(d.getUTCDate() + (Number(dias) || 0));
	return d.toISOString().slice(0, 10);
}

/**
 * «mismo día», «día siguiente», «2 días después».
 *
 * Sin fecha base se queda en la forma relativa; con ella se prefiere la fecha,
 * que es más corta de leer y no obliga a contar.
 */
export function etiquetaOffsetDias(
	dias: number | null | undefined,
	fechaBase?: string | null
): string {
	const n = Math.max(0, Math.trunc(Number(dias) || 0));
	if (n === 0) return 'mismo día';
	const fecha = fechaCorta(fechaConOffset(fechaBase, n));
	const relativo = n === 1 ? 'día siguiente' : `${n} días después`;
	return fecha ? `${relativo} (${fecha})` : relativo;
}

/** `06:00` + desfase → `06:00 · día siguiente (jue 24 sep)`. */
export function horaConOffset(
	hora: string | null | undefined,
	dias: number | null | undefined,
	fechaBase?: string | null
): string {
	if (!hora) return '';
	const n = Math.max(0, Math.trunc(Number(dias) || 0));
	if (n === 0) return hora;
	return `${hora} · ${etiquetaOffsetDias(n, fechaBase)}`;
}
