/**
 * MARCAS POR DÍA DEL DESPRENDIBLE (`liquidaciones.marcas_dias`).
 *
 * Gemelo de `backend-nest/src/modules/nomina-canvas/marcas-dias.ts`: la clave
 * y su significado TIENEN que coincidir o el PDF escondería días distintos de
 * los que el canvas dejó de pagar.
 *
 *   · `ocultar` — el día no aparece en las tablas de recargos.
 *   · `noSumar` — el día aparece, pero no entra en los totales ni se paga.
 *
 * Clave: `AAAA-MM-DD|empresa_id`.
 */
export interface MarcaDia {
	ocultar: boolean;
	noSumar: boolean;
}

export type MarcasDias = Record<string, MarcaDia>;

export const claveMarcaDia = (fecha: string, empresaId: string | null | undefined): string =>
	`${fecha.slice(0, 10)}|${empresaId ?? ''}`;

/** Lo guardado, tolerando `null`, texto JSON o basura: nunca lanza. */
export function leerMarcasDias(valor: unknown): MarcasDias {
	let v = valor;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return {};
		}
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
	const out: MarcasDias = {};
	for (const [clave, m] of Object.entries(v as Record<string, any>)) {
		if (!m || typeof m !== 'object') continue;
		const marca = { ocultar: m.ocultar === true, noSumar: m.noSumar === true };
		if (marca.ocultar || marca.noSumar) out[clave] = marca;
	}
	return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Aplica las marcas a las «planillas» que pinta el detalle del PDF.
 *
 * Sirve para las dos formas en que llegan —el preview de planillas del portal
 * y el enlace firmado, y las que arma el canvas desde su hoja—, que comparten
 * `planillas[].{año, mes, empresa.id, dias[].{dia, recargos[]}}`.
 *
 * Los días ocultos se quitan; los que no suman se dejan con `no_suma: true` y
 * su valor sale de `total_valor`. Idempotente: aplicar dos veces da lo mismo.
 */
export function aplicarMarcasDias<P extends Record<string, any>>(
	planillas: P[],
	marcas: MarcasDias
): P[] {
	if (!Object.keys(marcas).length) return planillas;
	return planillas.map((p) => {
		const empresaId = p?.empresa?.id ?? p?.empresa_id ?? null;
		const anio = Number(p?.año ?? p?.anio);
		const mes = Number(p?.mes);
		let restar = 0;
		const dias = (p?.dias ?? [])
			.map((d: any) => {
				const m = marcas[claveMarcaDia(`${anio}-${pad(mes)}-${pad(Number(d?.dia))}`, empresaId)];
				if (!m) return d;
				if (m.ocultar) {
					if (!d.disponibilidad && !d.no_suma) restar += valorDia(d);
					return null;
				}
				if (m.noSumar && !d.no_suma) {
					if (!d.disponibilidad) restar += valorDia(d);
					return { ...d, no_suma: true };
				}
				return d;
			})
			.filter(Boolean);
		/// `ocultar` sin `noSumar` NO resta dinero de la página 1, pero sí de la
		/// tabla: el total de la tabla tiene que cuadrar con sus filas.
		return {
			...p,
			dias,
			total_valor: Math.max(0, Number(p?.total_valor ?? 0) - restar)
		};
	});
}

function valorDia(d: any): number {
	return (d?.recargos ?? []).reduce((s: number, r: any) => s + Number(r?.valor_total ?? 0), 0);
}
