import type { JornadaCalculada, Segmento } from './modelos';

export function dividirSegmentos(jornada: JornadaCalculada): Segmento[] {
	const segmentos: Segmento[] = [];
	const inicio = jornada.inicio;
	const fin = jornada.fin;
	const inicioExtras = jornada.inicioExtras;

	if (inicioExtras >= fin) {
		segmentos.push({ inicio, fin, tipo: 'ORDINARIO' });
	} else if (inicioExtras <= inicio) {
		segmentos.push({ inicio, fin, tipo: 'EXTRA' });
	} else {
		segmentos.push({ inicio, fin: inicioExtras, tipo: 'ORDINARIO' });
		segmentos.push({ inicio: inicioExtras, fin, tipo: 'EXTRA' });
	}

	return segmentos.filter(s => s.fin - s.inicio > 0.001);
}
