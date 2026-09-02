/**
 * Tipos compartidos por la capa de dominio y la capa Univer.
 * Ningún import de @univerjs/* aquí. Pure TS.
 */

import type { ConceptoDescuento, AdicionalTransmeralda } from '$lib/api/liquidaciones-terceros-descuentos';

export type ConceptoTipo = 'COSTO_LABORAL' | 'GASTO_OPERATIVO' | 'IMPUESTO' | 'ANTICIPO';

export interface ConductorRef {
  id: string;
  nombre: string;
  apellido: string;
  numero_identificacion: string;
}

export interface ItemPivote {
  pivoteId: string;
  liquidacion_servicio_id: string;
  liquidacion_servicio_consecutivo: string;
  cliente_nombre: string;
  placa: string;
  tercero_nombre: string;
  recorrido: string;
  fechas: string;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin: number;
  valor_admin: number;
  total_facturado: number;
  valor_liquidar: number;
  numero_planilla: string;
  ingreso_extra_global: number;
  ingresos_extra_aval: number;
  ingreso_empresa: number;
  numero_factura: string;
  facturas: string;
  aplica_impuestos: boolean;
  excluido: boolean;
  /// Recargos cobrados al cliente en la liquidación de servicio asociada
  /// al item (provistos por el backend en `item.liquidacion_servicio.valor_recargos`).
  valor_recargos: number;
}

export interface PlacaModel {
  placa: string;
  tercero_nombre: string;
  conceptos: ConceptoDescuento[];
  adicionales: AdicionalTransmeralda[];
  items: ItemPivote[];
  itemsIncluidos: ItemPivote[];
  totales: {
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
  };
  propietario_overrides: Record<string, boolean>;
}

export interface CierreModel {
  id: string;
  placa: string;
  estado: 'BORRADOR' | string;
  liquidacion_servicio: {
    id: string;
    consecutivo: string;
    mes: number;
    anio: number;
    cliente: { id: string; nombre: string; nit: string } | null;
    facturas: string;
  };
  vehiculo?: {
    id: string;
    placa: string;
    propietario_identificacion?: string;
    propietario_nombre?: string;
  };
  tercero?: {
    id: string;
    nombre_completo: string;
    identificacion: string;
  };
  totales: PlacaModel['totales'];
  adicionales: AdicionalTransmeralda[];
}

/** Mapea una celda del workbook a un concepto del dominio. */
export interface CellAddress {
  row: number;
  col: number;
}

/** Una sección lógica del workbook (corresponde a un bloque de filas). */
export type SheetSection =
  | 'items'
  | 'conductor-header'
  | 'salarios'
  | 'prestaciones'
  | 'seguridad-social'
  | 'gastos'
  | 'anticipos'
  | 'impuestos'
  | 'totales';

export interface SectionRange {
  section: SheetSection;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}
