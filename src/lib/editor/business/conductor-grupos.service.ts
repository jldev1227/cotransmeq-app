/**
 * Agrupa ConceptoDescuento por conductor, separando en
 * salarios / prestaciones / seguridadSocial.
 *
 * Idéntica semántica al legacy `getConductorGrupos`.
 */

import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';

/**
 * Conceptos que van en el recuadro de DEVENGADOS del conductor.
 *
 * Esta lista es CLASIFICACIÓN, no presentación: `totalConductor` suma todos
 * los COSTO_LABORAL del conductor, pero solo se PINTAN los que caen en uno de
 * los tres grupos. Un concepto que falte aquí y no esté en prestaciones ni en
 * seguridad social suma al total y no aparece en ninguna fila: dinero
 * invisible. Por eso BONIFICACION_TURNO_DOBLE entra aquí a la vez que se
 * empieza a generar en el servidor.
 */
const SALARIOS = [
  'SALARIO',
  'AUXILIO_TRANSPORTE',
  'BONIFICACION',
  'BONIFICACION_TURNO_DOBLE',
  'OTROS_AUXILIOS',
  'RECARGOS'
];
const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
const PRESTACIONES_SIN_AUX = ['VACACIONES'];
const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

export interface ConductorGrupo {
  conductorId: string | null;
  nombre: string;
  conceptos: ConceptoDescuento[];
  salarios: ConceptoDescuento[];
  prestaciones: ConceptoDescuento[];
  seguridadSocial: ConceptoDescuento[];
  totalConductor: number;
}

export function getConductorGrupos(conceptos: ConceptoDescuento[]): ConductorGrupo[] {
  // Calcular bases por conductor.
  const bases = new Map<string, { basePrest: number; baseSinAux: number }>();
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL') continue;
    const key = c.conductor_id || 'sin-conductor';
    if (!bases.has(key)) bases.set(key, { basePrest: 0, baseSinAux: 0 });
    const b = bases.get(key)!;
    if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto))
      b.basePrest += c.valor_total || 0;
    if (['SALARIO', 'RECARGOS'].includes(c.concepto)) b.baseSinAux += c.valor_total || 0;
  }
  // Aplicar bases a prestaciones/SS.
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL') continue;
    const b = bases.get(c.conductor_id || 'sin-conductor');
    if (!b) continue;
    if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
      c.base_calculo = b.basePrest;
      c.valor_total = b.basePrest * ((c.porcentaje || 0) / 100);
    } else if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
      c.base_calculo = b.baseSinAux;
      c.valor_total = b.baseSinAux * ((c.porcentaje || 0) / 100);
    }
  }
  // Agrupar.
  const map = new Map<string, ConductorGrupo>();
  for (const c of conceptos.filter((c) => c.tipo === 'COSTO_LABORAL')) {
    const key = c.conductor_id || 'sin-conductor';
    const nombre = c.conductor
      ? `${c.conductor.nombre} ${c.conductor.apellido}`.trim()
      : 'General / Consolidado';
    if (!map.has(key)) {
      map.set(key, {
        conductorId: c.conductor_id || null,
        nombre,
        conceptos: [],
        salarios: [],
        prestaciones: [],
        seguridadSocial: [],
        totalConductor: 0
      });
    }
    const g = map.get(key)!;
    g.conceptos.push(c);
    g.totalConductor += c.valor_total || 0;
    if (SALARIOS.includes(c.concepto)) g.salarios.push(c);
    else if (
      PRESTACIONES_CON_AUX.includes(c.concepto) ||
      PRESTACIONES_SIN_AUX.includes(c.concepto)
    )
      g.prestaciones.push(c);
    else if (SEGURIDAD.includes(c.concepto)) g.seguridadSocial.push(c);
  }
  return Array.from(map.values());
}
