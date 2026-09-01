/**
 * Formateo de dominio COP. Cero dependencias.
 */

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const COP_PLAIN = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function fmtCOP(value: number | string | null | undefined): string {
  const n = parseFloat(String(value ?? 0)) || 0;
  return COP.format(n);
}

export function fmtCOPNegativo(value: number | string | null | undefined): string {
  return '- ' + fmtCOP(value);
}

export function fmtCOPInput(value: number | string | null | undefined): string {
  const n = parseFloat(String(value ?? 0)) || 0;
  if (n === 0) return '';
  return '$ ' + COP_PLAIN.format(n);
}

export function parseCOP(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const cleaned = String(raw)
    .replace(/[^0-9,.\-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(cleaned) || 0;
}

export function fmtPlaca(p: string | null | undefined): string {
  const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : s || '—';
}
