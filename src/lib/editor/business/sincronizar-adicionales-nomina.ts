import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import { esConceptoConductorDinamico } from './conductor-grupos.service';

/**
 * Actualiza el bloque fijo de nómina sin pisar los conceptos individuales
 * que ya se corrigieron en este cierre. La clave incluye al conductor porque
 * un mismo concepto puede pertenecer a varios en la misma placa.
 */
export function conceptosParaSincronizar(
	nuevos: ConceptoDescuento[],
	actuales: ConceptoDescuento[]
): ConceptoDescuento[] {
	const resultado = new Map<string, ConceptoDescuento>();
	const clave = (c: ConceptoDescuento) =>
		[c.tipo, c.concepto, c.conductor_id ?? '', c.propietario_id ?? ''].join('|');
	for (const concepto of nuevos) resultado.set(clave(concepto), concepto);
	for (const concepto of actuales) {
		if (concepto.tipo !== 'COSTO_LABORAL' || esConceptoConductorDinamico(concepto)) {
			resultado.set(clave(concepto), concepto);
		}
	}
	return [...resultado.values()];
}
