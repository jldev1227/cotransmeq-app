import { resolverTurnoContinuo } from './continuidad';
import { crearJornada } from './crearJornada';
import { dividirSegmentos } from './dividirSegmentos';
import { resolverSkipFlags, type SkipFlags } from './skips';
import { partirTodosLosSegmentos } from './partirFranjas';
import { clasificarTramo, sumarResultados } from './clasificar';
import { postProceso } from './postproceso';
import type { DiaLaboralRecargo, ResolverConfigParaFecha, RecargosDiaResultado } from './modelos';

const JORNADA_NORMAL_DEFECTO = 10.33;
const JORNADA_FESTIVA_DEFECTO = 7.33;

export interface CalcularRecargosParams {
	dia: DiaLaboralRecargo;
	diasLaborales: DiaLaboralRecargo[];
	mes: number;
	año: number;
	getConfigParaFecha: ResolverConfigParaFecha;
	excluirRNDF?: boolean;
}

export function calcularRecargosConContinuacion(params: CalcularRecargosParams): RecargosDiaResultado {
	const { dia, diasLaborales, mes, año, getConfigParaFecha, excluirRNDF = false } = params;

	const horaInicio = typeof dia.hora_inicio === 'string'
		? parseFloat(dia.hora_inicio) : dia.hora_inicio || 0;
	const horaFin = typeof dia.hora_fin === 'string'
		? parseFloat(dia.hora_fin) : dia.hora_fin || 0;

	const totalHorasUI = (() => {
		if (!dia.hora_inicio || !dia.hora_fin) return 0;
		const inicio = typeof dia.hora_inicio === 'string' ? parseFloat(dia.hora_inicio) : dia.hora_inicio;
		const fin = typeof dia.hora_fin === 'string' ? parseFloat(dia.hora_fin) : dia.hora_fin;
		if (isNaN(inicio) || isNaN(fin)) return 0;
		return Math.abs(fin - inicio);
	})();

	if (
		!dia.dia ||
		!dia.hora_inicio ||
		!dia.hora_fin ||
		totalHorasUI <= 0 ||
		isNaN(horaInicio) ||
		isNaN(horaFin)
	) {
		return {
			HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0, RNDF: 0,
			totalHoras: 0, esDomingo: false, esFestivo: false, esDomingoOFestivo: false
		};
	}

	const turnoCtx = resolverTurnoContinuo({ dia, diasLaborales });
	const { turnoInicio, turnoFin, limiteInferior, limiteSuperior, esContinuacion, diaAnterior } = turnoCtx;

	const esFestivo = dia.es_festivo || dia.es_domingo;

	const fechaDia = new Date(Date.UTC(año, mes - 1, Number(dia.dia)));
	const config = getConfigParaFecha(fechaDia);
	const jornadaNormal = config?.jornadaNormal ?? JORNADA_NORMAL_DEFECTO;
	const jornadaFestiva = config?.jornadaFestiva ?? JORNADA_FESTIVA_DEFECTO;

	const jornada = crearJornada({
		inicio: limiteInferior,
		fin: limiteSuperior,
		jornadaNormal,
		jornadaFestiva,
		esFestivo,
		esDomingo: dia.es_domingo
	});

	if (jornada.fin - jornada.inicio <= 0.001) {
		return {
			HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0, RNDF: 0,
			totalHoras: totalHorasUI, esDomingo: dia.es_domingo, esFestivo: dia.es_festivo,
			esDomingoOFestivo: !!(dia.es_domingo || dia.es_festivo)
		};
	}

	const segmentos = dividirSegmentos(jornada);

	const capParaSkips = esFestivo ? jornadaFestiva : jornadaNormal;
	const flags: SkipFlags = resolverSkipFlags(turnoInicio, turnoFin, capParaSkips);

	const tramos = partirTodosLosSegmentos(segmentos, esFestivo, flags);

	const resultados = tramos.map(t => clasificarTramo(t, esFestivo));
	const resultado = sumarResultados(resultados);

	const final = postProceso({
		resultado,
		jornadaFestiva,
		esFestivo,
		excluirRNDF
	});

	return {
		...final,
		totalHoras: totalHorasUI,
		esDomingo: dia.es_domingo,
		esFestivo: dia.es_festivo,
		esDomingoOFestivo: !!(dia.es_domingo || dia.es_festivo)
	};
}
