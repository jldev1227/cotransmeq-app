import type { ItemOcasional } from '$lib/api/liquidaciones-terceros-ocasional';

const comparador = new Intl.Collator('es-CO', { numeric: true, sensitivity: 'base' });

/** Orden visible del canvas ocasional y sus exportaciones. */
export function compararItemsOcasionalesPorFactura(a: ItemOcasional, b: ItemOcasional): number {
	const facturaA = String(a.numero_factura ?? '').trim();
	const facturaB = String(b.numero_factura ?? '').trim();
	if (!facturaA) return facturaB ? 1 : compararDesempate(a, b);
	if (!facturaB) return -1;
	const porFactura = comparador.compare(facturaA, facturaB);
	return porFactura || compararDesempate(a, b);
}

function compararDesempate(a: ItemOcasional, b: ItemOcasional): number {
	return (
		comparador.compare(a.consecutivo || '', b.consecutivo || '') ||
		comparador.compare(a.placa || '', b.placa || '') ||
		(Number(a.orden) || 0) - (Number(b.orden) || 0) ||
		comparador.compare(a.id, b.id)
	);
}
