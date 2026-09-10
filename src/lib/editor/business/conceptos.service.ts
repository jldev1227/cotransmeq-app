/**
 * Reglas de negocio sobre ConceptoDescuento: orden canónico, gastos
 * automáticos, bases de prestaciones/SS, totales de placa.
 *
 * Mantiene exactamente la misma semántica que el código legacy de
 * `+page.svelte` (líneas 873–1116), pero:
 *  - recibe `propietarios: Record<string, boolean>` como parámetro
 *    (no lee del closure de la página);
 *  - es 100% puro y testeable;
 *  - no conoce Univer ni Svelte.
 */

import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import { sumAdicionalesBruto } from './adicionales.service';

// ─── Constantes de dominio ───────────────────────────────────────────

export const ORDEN_GASTOS_CANONICO: Record<string, number> = {
  DOTACION: 1,
  EXAMEN_MEDICO: 2,
  COMBUSTIBLE: 3,
  PAPELERIA: 4,
  GASTOS_DIVERSOS: 5
};

export const CONCEPTOS_CALCULADOS_AUTO = new Set([
  'DOTACION',
  'EXAMEN_MEDICO',
  'GASTOS_DIVERSOS',
  // PAPELERIA entró aquí cuando dejó de ser una tarifa única: ahora depende
  // del `valor_liquidar` del cierre y de la config del periodo. Estar en este
  // Set es lo que hace que teclear encima la desenganche del recálculo.
  'PAPELERIA'
]);

/**
 * Valores de partida de los gastos calculados de UN periodo.
 *
 * ESPEJO de `ConfigGastosPeriodo` en
 * `backend-nest/src/modules/liquidaciones-terceros-descuentos/reglas-conceptos.ts`.
 * Duplicado a propósito —dos builds, sin paquete compartido—: si los dos
 * cálculos divergen, el usuario ve un número en el canvas y otro en el PDF.
 */
export interface ConfigGastosPeriodo {
  /** Puntos porcentuales: 0.4 es 0,4 %. */
  pct_gastos_diversos: number;
  fijo_gastos_diversos: number;
  papeleria_alta: number;
  papeleria_baja: number;
  papeleria_umbral: number;
}

export const VALOR_DOTACION = 3985;
export const VALOR_EXAMEN_MEDICO = 2882;
export const TARIFA_FIJA_GASTOS_DIVERSOS = 20000;
export const PORCENTAJE_GASTO_POR_ITEM = 0.004;

/** Lo que rigió antes de que la config por periodo existiera. */
export const CONFIG_GASTOS_FALLBACK: ConfigGastosPeriodo = {
  pct_gastos_diversos: PORCENTAJE_GASTO_POR_ITEM * 100,
  fijo_gastos_diversos: TARIFA_FIJA_GASTOS_DIVERSOS,
  papeleria_alta: 25000,
  papeleria_baja: 20000,
  papeleria_umbral: 1000000
};

/**
 * GASTOS_DIVERSOS = fijo + pct % × (Σ TOTAL items + Σ bruto adicionales).
 *
 * El porcentaje se redondea ANTES de sumar el fijo, como en el cálculo de
 * siempre: moverlo al final cambiaría en un peso importes ya liquidados.
 */
export function importeGastosDiversos(
  config: ConfigGastosPeriodo,
  baseFacturada: number
): number {
  return (
    config.fijo_gastos_diversos +
    Math.round((baseFacturada * config.pct_gastos_diversos) / 100)
  );
}

/**
 * PAPELERIA es una tarifa por tramo, no una fórmula.
 *
 * El umbral mira `valor_liquidar` —la suma de los items, ANTES de descuentos—
 * y no el total a pagar: papelería es ella misma un descuento, así que sobre
 * el total oscilaría sin llegar a un valor estable.
 *
 * Estrictamente MAYOR que el umbral: «más de un millón» deja fuera el millón
 * exacto.
 */
export function importePapeleria(
  config: ConfigGastosPeriodo,
  valorLiquidar: number
): number {
  return valorLiquidar > config.papeleria_umbral
    ? config.papeleria_alta
    : config.papeleria_baja;
}

export const ORDEN_BASE_GASTO = 5000;
export const ORDEN_BASE_GASTO_NO_CANONICO =
  ORDEN_BASE_GASTO + Object.keys(ORDEN_GASTOS_CANONICO).length;
export const ORDEN_BASE_IMPUESTO = 7000;

export const ORDEN_IMPUESTOS: Record<string, number> = {
  RETENCION_ICA: 1,
  AVISOS_TABLEROS: 2,
  SOBRETASA_BOMBERIL: 3,
  RETENCION_FUENTE: 4
};

// ─── Helpers internos ───────────────────────────────────────────────

function getConductorKey(conductorId: string | null | undefined): string {
  return `0::${conductorId || 'sin-conductor'}`;
}

function sumDiasSalario(
  conceptos: ConceptoDescuento[],
  propietarios: Record<string, boolean>
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL' || c.concepto !== 'SALARIO') continue;
    const key = getConductorKey(c.conductor_id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (propietarios[key]) continue;
    total += Number(c.dias) || 0;
  }
  return total;
}

function sumTotalFacturadoItems(
  items: Array<{ total_facturado: number }>
): number {
  return items.reduce((s, i) => s + (i.total_facturado || 0), 0);
}

// ─── API pública ────────────────────────────────────────────────────

/**
 * Asegura la presencia de los 4 gastos operativos por defecto y los pone
 * en orden canónico. Crea los que falten.
 */
export function ensureDefaultGastosOperativos(
  conceptos: ConceptoDescuento[],
  items: Array<{ total_facturado: number }>,
  adicionalesBruto: number
): ConceptoDescuento[] {
  const presentes = new Set(
    conceptos.filter((c) => c.tipo === 'GASTO_OPERATIVO').map((c) => c.concepto)
  );
  const out = [...conceptos];

  for (const nombre of Object.keys(ORDEN_GASTOS_CANONICO)) {
    if (presentes.has(nombre)) continue;
    out.push({
      tipo: 'GASTO_OPERATIVO',
      concepto: nombre,
      conductor_id: null,
      conductor: null,
      dias: nombre === 'GASTOS_DIVERSOS' ? 1 : 0,
      valor_unitario: 0,
      valor_total: 0,
      calculado: CONCEPTOS_CALCULADOS_AUTO.has(nombre),
      orden: ORDEN_BASE_GASTO + (ORDEN_GASTOS_CANONICO[nombre] ?? 0) - 1
    });
  }

  return applyGastosOrdenCanonico(out, items, adicionalesBruto);
}

/**
 * Recalcula los gastos automáticos respetando el override manual.
 *
 * `config` y `valorLiquidar` son opcionales: sin ellos se usa el fallback y
 * PAPELERIA se queda como esté, que es como se comportaba antes de que la
 * tarifa dependiera del periodo.
 */
export function recalcularGastosOperativosAutomaticos(
  conceptos: ConceptoDescuento[],
  items: Array<{ total_facturado: number }>,
  adicionales: Array<{ valor_unitario: number; cantidad: number }>,
  propietarios: Record<string, boolean>,
  config: ConfigGastosPeriodo = CONFIG_GASTOS_FALLBACK,
  valorLiquidar?: number
): ConceptoDescuento[] {
  const adicionalesBruto = sumAdicionalesBruto(adicionales as any);
  const totalDias = sumDiasSalario(conceptos, propietarios);
  const totalItems = sumTotalFacturadoItems(items) + adicionalesBruto;
  const unitDiversos = importeGastosDiversos(config, totalItems);

  return conceptos.map((c) => {
    if (c.tipo !== 'GASTO_OPERATIVO') return c;
    if (c.calculado === false) return c; // override manual del usuario
    if (c.concepto === 'DOTACION') {
      return {
        ...c,
        dias: totalDias,
        valor_unitario: VALOR_DOTACION,
        valor_total: totalDias * VALOR_DOTACION,
        calculado: true
      };
    }
    if (c.concepto === 'EXAMEN_MEDICO') {
      return {
        ...c,
        dias: totalDias,
        valor_unitario: VALOR_EXAMEN_MEDICO,
        valor_total: totalDias * VALOR_EXAMEN_MEDICO,
        calculado: true
      };
    }
    if (c.concepto === 'GASTOS_DIVERSOS') {
      return {
        ...c,
        dias: 1,
        valor_unitario: unitDiversos,
        valor_total: unitDiversos,
        calculado: true
      };
    }
    if (c.concepto === 'PAPELERIA') {
      // Sin `valorLiquidar` no hay forma de decidir el tramo, y elegir uno al
      // azar sería peor que dejarlo: se respeta el valor vigente.
      if (valorLiquidar == null) return c;
      const unit = importePapeleria(config, valorLiquidar);
      return { ...c, dias: 1, valor_unitario: unit, valor_total: unit, calculado: true };
    }
    return c;
  });
}

/** Re-ordena gastos al canónico (DOTACION → EXAMEN_MEDICO → …). */
export function applyGastosOrdenCanonico(
  conceptos: ConceptoDescuento[],
  _items: Array<{ total_facturado: number }>,
  _adicionalesBruto: number
): ConceptoDescuento[] {
  let nextOrden = ORDEN_BASE_GASTO_NO_CANONICO;
  return conceptos.map((c) => {
    if (c.tipo !== 'GASTO_OPERATIVO') return c;
    const canon = ORDEN_GASTOS_CANONICO[c.concepto];
    if (canon !== undefined) {
      return { ...c, orden: ORDEN_BASE_GASTO + canon - 1 };
    }
    const newOrden = Math.max(c.orden || 0, nextOrden);
    nextOrden = newOrden + 1;
    return { ...c, orden: newOrden };
  });
}

/** Re-ordena impuestos (ICA → AVISOS_TABLEROS → SOBRETASA → RETENCION). */
export function applyImpuestosOrdenCanonico(
  conceptos: ConceptoDescuento[]
): ConceptoDescuento[] {
  let nextOrden = ORDEN_BASE_IMPUESTO;
  return conceptos.map((c) => {
    if (c.tipo !== 'IMPUESTO') return c;
    const canon = ORDEN_IMPUESTOS[c.concepto];
    const newOrden = canon ? ORDEN_BASE_IMPUESTO + canon - 1 : nextOrden++;
    return { ...c, orden: newOrden };
  });
}

/**
 * Recalcula bases de prestaciones sociales y seguridad social para cada
 * conductor. Mantiene la regla legacy: prestaciones con_aux usan
 * SALARIO+AUX+RECARGOS; prestaciones sin_aux y SS usan SALARIO+RECARGOS.
 */
export function recalcularBasesPrestacionesSS(
  conceptos: ConceptoDescuento[]
): ConceptoDescuento[] {
  const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
  const PRESTACIONES_SIN_AUX = ['VACACIONES'];
  const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

  const bases = new Map<string, { basePrest: number; baseSinAux: number }>();
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL') continue;
    const key = getConductorKey(c.conductor_id);
    if (!bases.has(key)) bases.set(key, { basePrest: 0, baseSinAux: 0 });
    const b = bases.get(key)!;
    if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto))
      b.basePrest += c.valor_total || 0;
    if (['SALARIO', 'RECARGOS'].includes(c.concepto)) b.baseSinAux += c.valor_total || 0;
  }
  return conceptos.map((c) => {
    if (c.tipo !== 'COSTO_LABORAL') return c;
    const b = bases.get(getConductorKey(c.conductor_id));
    if (!b) return c;
    if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
      return {
        ...c,
        base_calculo: b.basePrest,
        valor_total: b.basePrest * ((c.porcentaje || 0) / 100)
      };
    }
    if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
      return {
        ...c,
        base_calculo: b.baseSinAux,
        valor_total: b.baseSinAux * ((c.porcentaje || 0) / 100)
      };
    }
    return c;
  });
}

/** Suma los días de SALARIO de conductores NO propietarios. */
export function totalDiasNoPropietarios(
  conceptos: ConceptoDescuento[],
  propietarios: Record<string, boolean>
): number {
  return sumDiasSalario(conceptos, propietarios);
}
