import type { JornadaCalculada } from './modelos';

interface CrearJornadaParams {
	inicio: number;
	fin: number;
	jornadaNormal: number;
	jornadaFestiva: number;
	esFestivo: boolean;
	esDomingo: boolean;
}

export function crearJornada(params: CrearJornadaParams): JornadaCalculada {
	const { inicio, fin, jornadaNormal, jornadaFestiva, esFestivo, esDomingo } = params;

	const horasTotales = fin > inicio ? fin - inicio : 24 - inicio + fin;
	const cap = esFestivo ? jornadaFestiva : jornadaNormal;
	const inicioExtras = inicio + jornadaNormal;

	return {
		inicio,
		fin,
		horasTotales,
		jornadaNormal,
		jornadaFestiva,
		inicioExtras,
		esFestivo,
		esDomingo
	};
}
