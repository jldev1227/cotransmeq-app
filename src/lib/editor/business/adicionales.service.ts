/**
 * Lógica de adicionales Cotransmeq. Cálculo de vLiqNeto, CRUD y sync.
 * No conoce a Univer ni a Svelte. Recibe dependencias por parámetro.
 */

import type { AdicionalTransmeralda } from '$lib/api/liquidaciones-terceros-descuentos';

const toNum = (v: any) => Number(v) || 0;

export function adicionalVLiqNeto(adc: AdicionalTransmeralda): number {
  const vLiqGross = toNum(adc?.valor_unitario) * toNum(adc?.cantidad);
  const pctAdmin = toNum(adc?.porcentaje_admin);
  const vAdmin = Math.round((vLiqGross * pctAdmin) / 100);
  return vLiqGross - vAdmin;
}

export function adicionalVAdmin(adc: AdicionalTransmeralda): number {
  const vLiqGross = toNum(adc.valor_unitario) * toNum(adc.cantidad);
  const pctAdmin = toNum(adc.porcentaje_admin);
  return Math.round((vLiqGross * pctAdmin) / 100);
}

export function normalizeAdicional(adc: AdicionalTransmeralda): AdicionalTransmeralda {
  return { ...adc, valor_liquidar: adicionalVLiqNeto(adc) };
}

export interface AdicionalMutator {
  apply(adc: AdicionalTransmeralda): void;
  notify(adcList: AdicionalTransmeralda[]): void;
}

/** Crea un adicional nuevo en blanco. */
export function makeBlankAdicional(placa: string, terceroNombre: string): AdicionalTransmeralda {
  return {
    cliente: '',
    placa,
    tercero_nombre: terceroNombre,
    recorrido: '',
    fechas: '',
    valor_unitario: 0,
    cantidad: 1,
    valor_liquidar: 0,
    porcentaje_admin: 0,
    aplica_impuestos: true
  };
}

/** Aplica un cambio de campo y recalcula derivados si corresponde. */
export function applyAdicionalFieldChange(
  adc: AdicionalTransmeralda,
  field: keyof AdicionalTransmeralda,
  value: any
): AdicionalTransmeralda {
  const next: any = { ...adc, [field]: value };
  if (field === 'valor_unitario' || field === 'cantidad' || field === 'porcentaje_admin') {
    next.valor_liquidar = adicionalVLiqNeto(next);
  }
  return next;
}

/**
 * Suma el valor BRUTO (precio × cantidad) de los adicionales.
 * Usado como base del cálculo automático de GASTOS_DIVERSOS.
 */
export function sumAdicionalesBruto(adicionales: AdicionalTransmeralda[]): number {
  return adicionales.reduce(
    (s, a) => s + toNum(a.valor_unitario) * toNum(a.cantidad),
    0
  );
}
