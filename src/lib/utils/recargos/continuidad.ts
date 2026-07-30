import type { TurnoContexto, DiaLaboralRecargo } from './modelos';

interface ParseDiaParams {
	dia: DiaLaboralRecargo;
	diasLaborales: DiaLaboralRecargo[];
}

export function resolverTurnoContinuo(params: ParseDiaParams): TurnoContexto {
	const { dia, diasLaborales } = params;

	const horaInicio = typeof dia.hora_inicio === 'string'
		? parseFloat(dia.hora_inicio) : dia.hora_inicio || 0;
	const horaFin = typeof dia.hora_fin === 'string'
		? parseFloat(dia.hora_fin) : dia.hora_fin || 0;

	const currentIdx = diasLaborales.findIndex(d => d.id === dia.id);

	let turnoInicio = horaInicio;
	let turnoFin = horaFin;
	let limiteInferior = horaInicio;
	let limiteSuperior = horaFin;
	let diaAnterior: TurnoContexto['diaAnterior'] = null;
	let diaSiguiente: TurnoContexto['diaSiguiente'] = null;
	let esContinuacion = false;

	if (currentIdx > 0) {
		const prev = diasLaborales[currentIdx - 1];
		if (prev.continua_siguiente_dia) {
			esContinuacion = true;
			const prevInicio = typeof prev.hora_inicio === 'string'
				? parseFloat(prev.hora_inicio) : prev.hora_inicio || 0;
			const prevFin = typeof prev.hora_fin === 'string'
				? parseFloat(prev.hora_fin) : prev.hora_fin || 0;
			const horasNextDia = Math.abs(horaFin - horaInicio);
			turnoInicio = prevInicio;
			turnoFin = prevFin + horasNextDia;
			limiteInferior = prevFin;
			limiteSuperior = turnoFin;
			diaAnterior = {
				dia: Number(prev.dia),
				horaInicio: prevInicio,
				horaFin: prevFin,
				esFestivo: prev.es_festivo,
				esDomingo: prev.es_domingo
			};
		}
	}

	if (!esContinuacion && dia.continua_siguiente_dia) {
		if (currentIdx >= 0 && currentIdx < diasLaborales.length - 1) {
			const next = diasLaborales[currentIdx + 1];
			if (next.hora_inicio && next.hora_fin) {
				const ni = typeof next.hora_inicio === 'string'
					? parseFloat(next.hora_inicio) : next.hora_inicio || 0;
				const nf = typeof next.hora_fin === 'string'
					? parseFloat(next.hora_fin) : next.hora_fin || 0;
				const nextHorasUI = Math.abs(nf - ni);
				if (nextHorasUI > 0) {
					turnoFin = horaFin + nextHorasUI;
					limiteSuperior = turnoFin;
				}
				diaSiguiente = {
					dia: Number(next.dia),
					horaInicio: ni,
					horaFin: nf,
					esFestivo: next.es_festivo,
					esDomingo: next.es_domingo
				};
			}
		}
	}

	const puntoCorte = esContinuacion && diaAnterior
		? diaAnterior.horaFin
		: horaFin;

	return {
		turnoInicio,
		turnoFin,
		limiteInferior,
		limiteSuperior,
		puntoCorte,
		esContinuacion,
		diaAnterior,
		diaSiguiente
	};
}
