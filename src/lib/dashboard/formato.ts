/** Formatos del panel: números y pesos colombianos, fechas relativas. */

const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function numero(n: number | null | undefined): string {
	return nf.format(Math.round(n ?? 0));
}

export function pesos(n: number | null | undefined): string {
	return `$ ${nf.format(Math.round(n ?? 0))}`;
}

/** $1,2 M · $350 mil: para ejes y cifras grandes. */
export function pesosCortos(n: number | null | undefined): string {
	const v = n ?? 0;
	if (Math.abs(v) >= 1_000_000_000)
		return `$ ${(v / 1_000_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`;
	if (Math.abs(v) >= 1_000_000)
		return `$ ${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
	if (Math.abs(v) >= 1_000) return `$ ${Math.round(v / 1_000).toLocaleString('es-CO')} mil`;
	return `$ ${Math.round(v)}`;
}

export function horas(n: number | null | undefined): string {
	const v = n ?? 0;
	return `${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} h`;
}

export function porcentaje(parte: number, total: number): string {
	if (!total) return '0 %';
	return `${Math.round((parte / total) * 100)} %`;
}

const MESES_CORTO = [
	'ene',
	'feb',
	'mar',
	'abr',
	'may',
	'jun',
	'jul',
	'ago',
	'sep',
	'oct',
	'nov',
	'dic'
];

/** «8 oct», «8 oct 2025» si no es este año. */
export function fechaCorta(valor: string | Date | null | undefined): string {
	if (!valor) return '—';
	const d = typeof valor === 'string' ? new Date(valor) : valor;
	if (Number.isNaN(d.getTime())) return '—';
	const hoy = new Date();
	const base = `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
	return d.getFullYear() === hoy.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function horaCorta(valor: string | Date): string {
	const d = typeof valor === 'string' ? new Date(valor) : valor;
	return d
		.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
		.replace(/\.\s?/g, '');
}

/** «hace 5 min», «ayer 14:30», «3 oct 09:12». */
export function haceCuanto(valor: string | Date, ahora = Date.now()): string {
	const d = typeof valor === 'string' ? new Date(valor) : valor;
	const dif = Math.max(0, ahora - d.getTime());
	const min = Math.floor(dif / 60000);
	if (min < 1) return 'ahora mismo';
	if (min < 60) return `hace ${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24 && new Date(ahora).getDate() === d.getDate()) return `hace ${h} h`;
	const ayer = new Date(ahora);
	ayer.setDate(ayer.getDate() - 1);
	if (ayer.toDateString() === d.toDateString()) return `ayer ${horaCorta(d)}`;
	return `${fechaCorta(d)} ${horaCorta(d)}`;
}

/** Iniciales para el avatar: «Julian Lopez» → «JL». */
export function iniciales(nombre: string): string {
	return nombre
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join('');
}

/** «06:00» a partir de una hora del día (0-23). */
export function horaDelDia(h: number): string {
	return `${String(h % 24).padStart(2, '0')}:00`;
}
