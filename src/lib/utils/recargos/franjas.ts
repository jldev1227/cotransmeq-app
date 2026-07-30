import type { Franja } from './modelos';

export const INICIO_DIURNA = 5;
export const INICIO_NOCTURNA = 19;
export const FIN_NOCTURNA = 6;

export function esNocturna(hora: number): boolean {
	const h = hora % 24;
	return h >= INICIO_NOCTURNA || h < FIN_NOCTURNA;
}

export function franjaDeHora(hora: number): Franja {
	return esNocturna(hora) ? 'NOCTURNA' : 'DIURNA';
}

export function limitesFranja(franja: Franja, horaInicio: number, horaFin: number): [number, number][] {
	const intervalos: [number, number][] = [];
	let h = Math.ceil(horaInicio);
	const fin = Math.floor(horaFin);

	if (h >= fin) {
		if (horaInicio < horaFin) {
			intervalos.push([horaInicio, horaFin]);
		}
		return intervalos;
	}

	for (let i = h; i < fin; i++) {
		const segInicio = i;
		const segFin = i + 1;
		const hNorm = i % 24;
		const esNoct = hNorm >= INICIO_NOCTURNA || hNorm < FIN_NOCTURNA;
		const segFranja: Franja = esNoct ? 'NOCTURNA' : 'DIURNA';
		if (segFranja === franja) {
			intervalos.push([segInicio, segFin]);
		}
	}

	return intervalos;
}
