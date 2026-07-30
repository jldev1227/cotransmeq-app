import type { Tramo } from './modelos';

export const ANTES_INICIO = 6;
export const ANTES_FIN = 7;
export const ALMUERZO_INICIO = 12;
export const ALMUERZO_FIN = 13;
export const DESPUES_INICIO = 17;
export const DESPUES_FIN = 18;

export interface SkipFlags {
	skipAlmuerzo: boolean;
	skipDespues1: boolean;
	phantomAntes: number;
	phantomStart: number;
}

export function resolverSkipFlags(
	inicioTurno: number,
	finTurno: number,
	jornadaFestiva: number,
): SkipFlags {
	const inicioNorm = inicioTurno % 24;
	const finNorm = finTurno % 24;
	const totalTrabajadas =
		finNorm > inicioNorm
			? finNorm - inicioNorm
			: 24 - inicioNorm + finNorm;

	const antesSkipped = inicioNorm < 8 ? 1 : 0;
	const lunchSkippedBase = inicioNorm < 13 && finNorm > 12 ? 1 : 0;
	const skipAlmuerzo = totalTrabajadas - antesSkipped > jornadaFestiva;
	const lunchSkipped = skipAlmuerzo ? lunchSkippedBase : 0;
	const skipDespues1 = false;

	const antesOverlap = inicioNorm < 8
		? Math.max(0, Math.min(ANTES_FIN, finTurno) - Math.max(ANTES_INICIO, inicioTurno))
		: 0;
	const phantomAntes = Math.max(0, 1 - antesOverlap);
	const phantomStart = inicioNorm < 8 ? Math.max(inicioTurno, ANTES_FIN) : 0;

	return { skipAlmuerzo, skipDespues1, phantomAntes, phantomStart };
}

function esAntesJornadaFestiva(hora: number, esFestivo: boolean): boolean {
	if (!esFestivo) return false;
	const h = hora % 24;
	return h >= ANTES_INICIO && h < ANTES_FIN;
}

function esDespuesJornadaFestiva(hora: number, esFestivo: boolean, skipDespues1: boolean): boolean {
	if (!esFestivo) return false;
	const h = hora % 24;
	if (h >= DESPUES_INICIO && h < DESPUES_FIN) {
		return skipDespues1;
	}
	return false;
}

function esHoraAlmuerzo(hora: number, skipAlmuerzo: boolean): boolean {
	if (!skipAlmuerzo) return false;
	const h = hora % 24;
	return h >= ALMUERZO_INICIO && h < ALMUERZO_FIN;
}

export function esHoraSkip(hora: number, esFestivo: boolean, flags: SkipFlags): boolean {
	return (
		esAntesJornadaFestiva(hora, esFestivo) ||
		esDespuesJornadaFestiva(hora, esFestivo, flags.skipDespues1) ||
		esHoraAlmuerzo(hora, flags.skipAlmuerzo)
	);
}

export function aplicarSkipATramos(tramos: Tramo[], esFestivo: boolean, flags: SkipFlags): Tramo[] {
	const resultado: Tramo[] = [];

	for (const tramo of tramos) {
		const sinSkip = quitarZonasSkip(tramo, esFestivo, flags);
		resultado.push(...sinSkip);
	}

	return resultado;
}

function quitarZonasSkip(tramo: Tramo, esFestivo: boolean, flags: SkipFlags): Tramo[] {
	const zonas: { inicio: number; fin: number }[] = [];
	const hStart = Math.floor(tramo.inicio);
	const hEnd = Math.ceil(tramo.fin);

	for (let h = hStart; h < hEnd; h++) {
		if (esHoraSkip(h, esFestivo, flags)) {
			zonas.push({ inicio: h, fin: h + 1 });
		}
	}

	if (esFestivo && flags.phantomAntes > 0.001) {
		const pStart = flags.phantomStart;
		const pEnd = pStart + flags.phantomAntes;
		const overlapWithTramo = pEnd > tramo.inicio + 0.001 && pStart < tramo.fin - 0.001;
		if (overlapWithTramo) {
			zonas.push({ inicio: pStart, fin: pEnd });
		}
	}

	if (zonas.length === 0) {
		return [tramo];
	}

	zonas.sort((a, b) => a.inicio - b.inicio);

	const resultado: Tramo[] = [];
	let actualInicio = tramo.inicio;

	for (const zona of zonas) {
		const overlapInicio = Math.max(zona.inicio, actualInicio);
		const overlapFin = Math.min(zona.fin, tramo.fin);

		if (overlapFin > overlapInicio + 0.001) {
			if (overlapInicio > actualInicio + 0.001) {
				resultado.push({
					...tramo,
					inicio: actualInicio,
					fin: overlapInicio
				});
			}
			actualInicio = overlapFin;
		}
	}

	if (actualInicio < tramo.fin - 0.001) {
		resultado.push({
			...tramo,
			inicio: actualInicio,
			fin: tramo.fin
		});
	}

	return resultado.filter(t => t.fin - t.inicio > 0.001);
}
