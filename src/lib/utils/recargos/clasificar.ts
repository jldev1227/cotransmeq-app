import type { Tramo, CodigoRecargo, RecargosResultado } from './modelos';

export function clasificarTramo(tramo: Tramo, esFestivo: boolean): Partial<RecargosResultado> {
	const resultado: Partial<RecargosResultado> = {};
	const duracion = tramo.fin - tramo.inicio;
	if (duracion <= 0.001) return resultado;

	const codigo = obtenerCodigo(tramo.tipo, tramo.franja, esFestivo);
	if (codigo) {
		(resultado as any)[codigo] = duracion;
	}

	return resultado;
}

function obtenerCodigo(
	tipo: 'ORDINARIO' | 'EXTRA',
	franja: 'DIURNA' | 'NOCTURNA',
	esFestivo: boolean
): CodigoRecargo | null {
	if (tipo === 'ORDINARIO') {
		if (esFestivo) {
			return franja === 'NOCTURNA' ? 'RNDF' : 'RD';
		} else {
			return franja === 'NOCTURNA' ? 'RN' : null;
		}
	} else {
		if (esFestivo) {
			return franja === 'NOCTURNA' ? 'HEFN' : 'HEFD';
		} else {
			return franja === 'NOCTURNA' ? 'HEN' : 'HED';
		}
	}
}

export function sumarResultados(resultados: Partial<RecargosResultado>[]): RecargosResultado {
	const total: RecargosResultado = {
		HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0, RNDF: 0
	};

	for (const r of resultados) {
		total.HED += r.HED || 0;
		total.HEN += r.HEN || 0;
		total.HEFD += r.HEFD || 0;
		total.HEFN += r.HEFN || 0;
		total.RN += r.RN || 0;
		total.RD += r.RD || 0;
		total.RNDF += r.RNDF || 0;
	}

	return total;
}
