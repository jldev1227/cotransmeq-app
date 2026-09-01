/**
 * Cálculo de totales de una placa y del cierre. Funciones PURAS.
 * La fuente de verdad para valor_liquidar, total_pagar, base imponible, etc.
 */

import type { ConceptoDescuento, AdicionalTransmeralda } from '$lib/api/liquidaciones-terceros-descuentos';
import { adicionalVLiqNeto } from './adicionales.service';
import { AUTOSAVE_ENABLED } from '../config/flags';

export interface Totales {
  totalValorLiquidar: number;
  totalAdicionales: number;
  totalServicio: number;
  totalCostosLaborales: number;
  totalGastosOperativos: number;
  totalImpuestos: number;
  totalAnticipos: number;
  totalDescuentos: number;
  totalPagar: number;
  baseImpuestos: number;
  baseRetencionFuente: number;
}

const toNum = (v: any) => Number(v) || 0;

export function calcularTotalesPlaca(params: {
  items: Array<{ valor_liquidar: number; aplica_impuestos: boolean }>;
  adicionales: AdicionalTransmeralda[];
  conceptos: ConceptoDescuento[];
}): Totales {
  const { items, adicionales, conceptos } = params;

  const totalValorLiquidar = items.reduce((s, i) => s + toNum(i.valor_liquidar), 0);
  const totalAdicionales = adicionales.reduce(
    (s, a) => s + adicionalVLiqNeto(a),
    0
  );
  const totalServicio = totalValorLiquidar + totalAdicionales;

  const totalCostosLaborales = conceptos
    .filter((c) => c.tipo === 'COSTO_LABORAL')
    .reduce((s, c) => s + toNum(c.valor_total), 0);
  const totalGastosOperativos = conceptos
    .filter((c) => c.tipo === 'GASTO_OPERATIVO')
    .reduce((s, c) => s + toNum(c.valor_total), 0);
  const totalImpuestos = conceptos
    .filter((c) => c.tipo === 'IMPUESTO')
    .reduce((s, c) => s + toNum(c.valor_total), 0);
  const totalAnticipos = conceptos
    .filter((c) => c.tipo === 'ANTICIPO')
    .reduce((s, c) => s + toNum(c.valor_total), 0);
  const totalDescuentos =
    totalCostosLaborales + totalGastosOperativos + totalImpuestos + totalAnticipos;
  const totalPagar = totalServicio - totalDescuentos;

  // Base de impuestos: items con aplica_impuestos + adicionales gravados.
  const baseImpuestos =
    items
      .filter((i) => i.aplica_impuestos)
      .reduce((s, i) => s + toNum(i.valor_liquidar), 0) +
    adicionales
      .filter((a) => a.aplica_impuestos !== false)
      .reduce((s, a) => s + adicionalVLiqNeto(a), 0);

  // Base de retención en la fuente: todos los items + adicionales gravados.
  const baseRetencionFuente =
    items.reduce((s, i) => s + toNum(i.valor_liquidar), 0) +
    adicionales
      .filter((a) => a.aplica_impuestos !== false)
      .reduce((s, a) => s + adicionalVLiqNeto(a), 0);

  return {
    totalValorLiquidar,
    totalAdicionales,
    totalServicio,
    totalCostosLaborales,
    totalGastosOperativos,
    totalImpuestos,
    totalAnticipos,
    totalDescuentos,
    totalPagar,
    baseImpuestos,
    baseRetencionFuente
  };
}

/** Persiste los totales en el cierre (cola de realtime collab). */
export function enqueueTotalesCierre(totales: Totales): void {
  if (!AUTOSAVE_ENABLED) return;
  // Import dinámico para evitar ciclos en tests.
  void import('$lib/stores/realtimeCollab').then((m) => {
    m.enqueueCierreChanges({
      valor_liquidar: totales.totalServicio,
      total_costos_laborales: totales.totalCostosLaborales,
      total_gastos_operativos: totales.totalGastosOperativos,
      total_impuestos: totales.totalImpuestos,
      total_anticipos: totales.totalAnticipos,
      total_descuentos: totales.totalDescuentos,
      total_pagar: totales.totalPagar
    });
  });
}
