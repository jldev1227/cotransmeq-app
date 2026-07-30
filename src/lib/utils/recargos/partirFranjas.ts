import type { Segmento, Tramo, Franja } from './modelos';
import { franjaDeHora, FIN_NOCTURNA, INICIO_NOCTURNA } from './franjas';
import { aplicarSkipATramos, resolverSkipFlags, type SkipFlags } from './skips';

export function partirSegmento(segmento: Segmento, esFestivo: boolean, flags: SkipFlags): Tramo[] {
	const tramosSinSkip = aplicarSkipATramos(
		[{ ...segmento, franja: franjaDeHora(segmento.inicio) }],
		esFestivo,
		flags
	);

	const resultado: Tramo[] = [];

	for (const tramo of tramosSinSkip) {
		const tramosPorFranja = partirPorFranja(tramo);
		resultado.push(...tramosPorFranja);
	}

	return resultado;
}

function partirPorFranja(tramo: Tramo): Tramo[] {
	const resultado: Tramo[] = [];
	let actualInicio = tramo.inicio;

	while (actualInicio < tramo.fin - 0.001) {
		const franjaActual = franjaDeHora(actualInicio);
		const hNorm = actualInicio % 24;

		let finFranja: number;
		if (franjaActual === 'NOCTURNA') {
			if (hNorm >= INICIO_NOCTURNA) {
				finFranja = Math.min(actualInicio + (24 - hNorm), tramo.fin);
			} else {
				finFranja = Math.min(actualInicio + (FIN_NOCTURNA - hNorm), tramo.fin);
			}
		} else {
			if (hNorm >= FIN_NOCTURNA && hNorm < INICIO_NOCTURNA) {
				finFranja = Math.min(actualInicio + (INICIO_NOCTURNA - hNorm), tramo.fin);
			} else {
				finFranja = tramo.fin;
			}
		}

		const finReal = Math.min(finFranja, tramo.fin);
		if (finReal > actualInicio + 0.001) {
			resultado.push({
				inicio: actualInicio,
				fin: finReal,
				tipo: tramo.tipo,
				franja: franjaActual
			});
		}

		actualInicio = finReal;
	}

	return resultado;
}

export function partirTodosLosSegmentos(
	segmentos: Segmento[],
	esFestivo: boolean,
	flags: SkipFlags
): Tramo[] {
	const todos: Tramo[] = [];
	for (const seg of segmentos) {
		todos.push(...partirSegmento(seg, esFestivo, flags));
	}
	return todos;
}
