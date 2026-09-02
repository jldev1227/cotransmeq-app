import type { ItemOcasional, ConceptoOcasional } from '$lib/api/liquidaciones-terceros-ocasional';
import { uuidDeterminista } from './id-sintetico';

const IMPUESTO_STANDARDS: Array<{ concepto: string; porcentaje: number }> = [
	{ concepto: 'RETENCION_ICA', porcentaje: 1.0 },
	{ concepto: 'AVISOS_TABLEROS', porcentaje: 15.0 },
	{ concepto: 'SOBRETASA_BOMBERIL', porcentaje: 21.0 },
	{ concepto: 'RETENCION_FUENTE', porcentaje: 3.5 }
];

/**
 * Garantiza que los 4 conceptos estándar de impuestos existan en el
 * array. Si alguno falta, crea una entrada sintética con porcentajes
 * default y un ID con forma de UUID derivado del nombre para que
 * el cell-binding registry del canvas pueda registrar bindings
 * editables aunque el backend aún no los haya persistido.
 *
 * `alcance` (ver `alcanceOcasional`) separa los ids por periodo: sin él los
 * doce meses compartían fila en la base.
 */
export function ensureImpuestos(
	conceptos: ConceptoOcasional[],
	alcance: string
): ConceptoOcasional[] {
	const out = [...conceptos];
	for (const std of IMPUESTO_STANDARDS) {
		const exists = out.some(
			(c) => c.tipo === 'IMPUESTO' && c.concepto === std.concepto
		);
		if (!exists) {
			out.push({
				// UUID estable: la columna es `@db.Uuid`. Con el id legible que había
				// antes, el autoguardado moría en cuanto uno de estos conceptos
				// llegaba al payload.
				id: uuidDeterminista(`impuesto:${alcance}:${std.concepto}`),
				tipo: 'IMPUESTO',
				concepto: std.concepto,
				porcentaje: std.porcentaje,
				valor_total: 0,
				base_calculo: 0,
				calculado: true,
				conductor_id: null,
				placa_aplicada: null,
				dias: null,
				valor_unitario: 0
			} satisfies ConceptoOcasional);
		}
	}
	return out;
}

/**
 * Recalcula los valores de los conceptos de tipo IMPUESTO en base a la
 * sumatoria de `valor_liquidar` de los items que entran en la base gravable.
 *
 * Un item entra si tiene `aplica_impuestos`. Antes se miraba también
 * `excluido`, columna que ya no existe: lo que no cuenta se borra. La de
 * APLICA IMP. sí sigue viva, y antes no movía ni un
 * peso — el mismo criterio que ya usa el canvas de cierres en
 * `totales.service.ts`.
 *
 * Reglas de negocio:
 *   Retención ICA          = 1.00% del V/LIQUIDAR total (base imponible)
 *   Avisos y Tableros      = 15.00% de la Retención ICA
 *   Sobretasa Bomberil     = 21.00% de la Retención ICA
 *   Retención en la Fuente = 3.50% del V/LIQUIDAR total (base imponible)
 *
 * Los porcentajes se toman del `porcentaje` almacenado en el concepto
 * si existe; si no, se aplican los defaults definidos arriba.
 */
export function recomputeTaxes(
	items: ItemOcasional[],
	conceptos: ConceptoOcasional[]
): ConceptoOcasional[] {
	const itemsActivos = items.filter((i) => i.aplica_impuestos !== false);
	const baseImponible = itemsActivos.reduce(
		(s, it) => s + (Number(it.valor_liquidar) || 0),
		0
	);

	const retencionIca = conceptos.find(
		(c) => c.tipo === 'IMPUESTO' && c.concepto === 'RETENCION_ICA'
	);
	const icaValor = baseImponible * (Number(retencionIca?.porcentaje) || 1) / 100;

	return conceptos.map((c) => {
		if (c.tipo !== 'IMPUESTO') return c;
		switch (c.concepto) {
			case 'RETENCION_ICA':
				return {
					...c,
					base_calculo: baseImponible,
					valor_total: icaValor
				};
			case 'AVISOS_TABLEROS':
				return {
					...c,
					base_calculo: icaValor,
					valor_total: icaValor * (Number(c.porcentaje) || 15) / 100
				};
			case 'SOBRETASA_BOMBERIL':
				return {
					...c,
					base_calculo: icaValor,
					valor_total: icaValor * (Number(c.porcentaje) || 21) / 100
				};
			case 'RETENCION_FUENTE':
				return {
					...c,
					base_calculo: baseImponible,
					valor_total:
						baseImponible * (Number(c.porcentaje) || 3.5) / 100
				};
			default:
				return c;
		}
	});
}
