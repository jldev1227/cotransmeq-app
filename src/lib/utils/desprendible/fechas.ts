/**
 * Utilidades de fechas para el desprendible.
 */

export function obtenerDiferenciaDias(startStr: string, endStr: string): number {
	try {
		const start = new Date(startStr + 'T00:00:00');
		const end = new Date(endStr + 'T00:00:00');
		if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
		return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
	} catch {
		return 0;
	}
}

function formatearRango(inicio: string, fin: string): string {
	const dInicio = new Date(inicio + 'T00:00:00');
	const dFin = new Date(fin + 'T00:00:00');
	const mesInicio = dInicio.toLocaleDateString('es-CO', { month: 'short' });

	if (inicio === fin) {
		return `${dInicio.getDate()} ${mesInicio}`;
	}

	const mesFin = dFin.toLocaleDateString('es-CO', { month: 'short' });
	if (mesInicio === mesFin) {
		return `${dInicio.getDate()}-${dFin.getDate()} ${mesInicio}`;
	}
	return `${dInicio.getDate()} ${mesInicio} - ${dFin.getDate()} ${mesFin}`;
}

/**
 * Agrupa fechas consecutivas en rangos legibles.
 * Ej: ["2024-01-01","2024-01-02","2024-01-03","2024-01-10"] → ["1-3 ene", "10 ene"]
 */
export function agruparFechasConsecutivas(fechas: string[]): string[] {
	if (!fechas || fechas.length === 0) return [];

	const sorted = [...fechas].sort();
	const rangos: string[] = [];
	let inicio = sorted[0];
	let fin = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		const current = new Date(sorted[i] + 'T00:00:00');
		const prev = new Date(fin + 'T00:00:00');
		const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		if (diff === 1) {
			fin = sorted[i];
		} else {
			rangos.push(formatearRango(inicio, fin));
			inicio = sorted[i];
			fin = sorted[i];
		}
	}
	rangos.push(formatearRango(inicio, fin));

	return rangos;
}

/**
 * Formatea un número de horas decimales como "HH:MM".
 */
export function formatHora(h: number | string | null | undefined): string {
	if (!h && h !== 0) return '-';
	const num = Number(h);
	const hh = Math.floor(num).toString().padStart(2, '0');
	const mm = Math.round((num % 1) * 60)
		.toString()
		.padStart(2, '0');
	return `${hh}:${mm}`;
}
