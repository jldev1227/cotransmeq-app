/**
 * Última URL del listado de liquidaciones de servicios, con sus filtros.
 * Ver `volverListado.ts`: es la misma memoria que usan los demás listados.
 */
import { memoriaListado } from './volverListado';

const memoria = memoriaListado('/dashboard/liquidaciones-servicios');

export const recordarListado = (url: string): void => memoria.recordar(url);
export const urlListado = (): string => memoria.url();
