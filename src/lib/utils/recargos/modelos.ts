export type Franja = 'DIURNA' | 'NOCTURNA';
export type TipoSegmento = 'ORDINARIO' | 'EXTRA';
export type CodigoRecargo = 'HED' | 'HEN' | 'HEFD' | 'HEFN' | 'RN' | 'RD' | 'RNDF';

export interface JornadaCalculada {
	inicio: number;
	fin: number;
	horasTotales: number;
	jornadaNormal: number;
	jornadaFestiva: number;
	inicioExtras: number;
	esFestivo: boolean;
	esDomingo: boolean;
}

export interface Segmento {
	inicio: number;
	fin: number;
	tipo: TipoSegmento;
}

export interface Tramo {
	inicio: number;
	fin: number;
	tipo: TipoSegmento;
	franja: Franja;
}

export interface RecargosResultado {
	HED: number;
	HEN: number;
	HEFD: number;
	HEFN: number;
	RN: number;
	RD: number;
	RNDF: number;
}

export interface RecargosDiaResultado extends RecargosResultado {
	totalHoras: number;
	esDomingo: boolean;
	esFestivo: boolean;
	esDomingoOFestivo: boolean;
}

export interface TurnoContexto {
	turnoInicio: number;
	turnoFin: number;
	limiteInferior: number;
	limiteSuperior: number;
	puntoCorte: number;
	esContinuacion: boolean;
	diaAnterior: { dia: number; horaInicio: number; horaFin: number; esFestivo: boolean; esDomingo: boolean } | null;
	diaSiguiente: { dia: number; horaInicio: number; horaFin: number; esFestivo: boolean; esDomingo: boolean } | null;
}

export interface DiaLaboralRecargo {
	id: string;
	dia: string;
	mes: string;
	año: string;
	hora_inicio: string;
	hora_fin: string;
	kilometraje_inicial: string | null;
	kilometraje_final: string | null;
	es_domingo: boolean;
	es_festivo: boolean;
	pernocte: boolean;
	disponibilidad: boolean;
	continua_siguiente_dia: boolean;
}

export type ResolverConfigParaFecha = (fecha: Date) => {
	jornadaNormal: number;
	jornadaFestiva: number;
} | null;
