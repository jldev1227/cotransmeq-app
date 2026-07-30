import type { RecargosResultado } from './modelos';

export interface PostProcesoParams {
	resultado: RecargosResultado;
	jornadaFestiva: number;
	esFestivo: boolean;
	excluirRNDF: boolean;
}

export function postProceso(params: PostProcesoParams): RecargosResultado {
	const { resultado, jornadaFestiva, esFestivo, excluirRNDF } = params;

	if (!esFestivo) {
		if (excluirRNDF) {
			const r = { ...resultado };
			r.RD += r.RNDF;
			r.RNDF = 0;
			return redondearResultado(r);
		}
		return redondearResultado(resultado);
	}

	const { HED, HEN, HEFD, HEFN, RN, RD, RNDF } = resultado;

	if (excluirRNDF) {
		const totalOrdinarias = RD + RNDF;
		const rdCapped = Math.min(totalOrdinarias, jornadaFestiva);
		return redondearResultado({
			HED, HEN, HEFD, HEFN, RN, RD: rdCapped, RNDF: 0
		});
	}

	const capRdFestivo = Math.max(0, jornadaFestiva - RNDF);

	const shortfall = capRdFestivo - RD;
	if (shortfall > 0 && HEFD > 0) {
		const move = Math.min(shortfall, HEFD);
		return redondearResultado({
			HED, HEN, HEFD: HEFD - move, HEFN, RN, RD: RD + move, RNDF
		});
	}

	const rdFinal = Math.min(RD, capRdFestivo);

	return redondearResultado({
		HED, HEN, HEFD, HEFN, RN, RD: rdFinal, RNDF
	});
}

function redondearResultado(r: RecargosResultado): RecargosResultado {
	return {
		HED: parseFloat(r.HED.toFixed(2)),
		HEN: parseFloat(r.HEN.toFixed(2)),
		HEFD: parseFloat(r.HEFD.toFixed(2)),
		HEFN: parseFloat(r.HEFN.toFixed(2)),
		RN: parseFloat(r.RN.toFixed(2)),
		RD: parseFloat(r.RD.toFixed(2)),
		RNDF: parseFloat(r.RNDF.toFixed(2))
	};
}
