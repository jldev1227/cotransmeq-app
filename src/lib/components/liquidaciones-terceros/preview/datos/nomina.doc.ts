/**
 * Vista de nómina para el export a EXCEL. **No es el desprendible.**
 *
 * ⚠️ EL DESPRENDIBLE ES `$lib/utils/pdfDesprendible.ts`, Y SOLO ESE. La vista
 * previa del canvas, el PDF suelto, el ZIP, el portal del conductor y la
 * descarga del dashboard salen todos de allí. Este adaptador NO se usa para
 * ningún PDF: si se enchufa a uno, el mismo mes acaba con dos documentos
 * distintos según por dónde se imprima, que es justo lo que se quiere evitar.
 *
 * Lo que sí hace es traducir una hoja del libro al modelo de `tipos.ts` para
 * que `exportar-excel.ts` produzca el XLSX — una hoja de cálculo con una
 * pestaña por conductor, que es una herramienta de trabajo interna y no el
 * comprobante que recibe el conductor.
 *
 * Los importes se toman de la hoja tal y como está en pantalla, no del último
 * guardado: si alguien acaba de corregir los días trabajados, el Excel tiene
 * que decir lo mismo que la pantalla.
 */

import type { HojaNominaDTO, PeriodoNominaDTO } from '$lib/editor/builders/nomina.builder';
import { COP, enRojo, nombreMes } from '../formato';
import type {
	BloquePreview,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	LineaResumen,
	SeccionPreview
} from '../tipos';
import { TITULO_SCOPE } from '../columnas';

const COLS_CONCEPTOS = ['concepto', 'cantidad', 'devengado', 'deducido', 'origen'];

/** Columnas del bloque de desglose por empresa. Son de ese bloque, no del documento. */
const COLS_EMPRESA: ColumnaPreview[] = [
	{ key: 'recargo', label: 'RECARGO', tipo: 'texto', peso: 4 },
	{ key: 'horas', label: 'HORAS', tipo: 'numero', peso: 1 },
	{ key: 'valor', label: 'VALOR', tipo: 'moneda', peso: 2 }
];

/** Columnas del bloque de acumulado por tipo de recargo. */
const COLS_TARIFA: ColumnaPreview[] = [
	{ key: 'recargo', label: 'RECARGO', tipo: 'texto', peso: 4 },
	{ key: 'pct', label: '%', tipo: 'porcentaje', peso: 1 },
	{ key: 'valorHora', label: 'V/HORA', tipo: 'moneda', peso: 2 },
	{ key: 'horas', label: 'HORAS', tipo: 'numero', peso: 1 },
	{ key: 'valor', label: 'VALOR', tipo: 'moneda', peso: 2 }
];

const redondear = (n: number) => Math.round((n ?? 0) * 100) / 100;

export function documentoNomina(o: {
	hoja: HojaNominaDTO;
	periodo: PeriodoNominaDTO;
}): DocumentoPreview {
	const { hoja, periodo } = o;
	const t = hoja.totales ?? {};

	// ── Tabla principal: los conceptos del desprendible ──────────────────
	const filas: FilaPreview[] = [
		...hoja.devengos.map((c) => ({
			celdas: {
				concepto: c.nombre,
				cantidad: c.cantidad,
				devengado: c.valor,
				deducido: null,
				// Decir de dónde sale cada cifra es lo que evita que alguien
				// intente corregir un recargo en el desprendible.
				origen: c.editable ? 'manual' : 'planillas'
			}
		})),
		...hoja.deducciones.map((c) => ({
			celdas: {
				concepto: c.nombre,
				cantidad: c.cantidad,
				devengado: null,
				deducido: enRojo(c.valor),
				origen: c.editable ? 'manual' : 'calculado'
			}
		}))
	];

	const totalDevengado = hoja.devengos.reduce((s, c) => s + (c.valor ?? 0), 0);
	const totalDeducido = hoja.deducciones.reduce((s, c) => s + (c.valor ?? 0), 0);

	// ── Bloque: acumulado por tipo de recargo ───────────────────────────
	const bloqueTarifas: BloquePreview = {
		id: 'tarifas',
		titulo: 'RECARGOS Y HORAS EXTRAS DEL PERIODO',
		subtitulo: `Valor hora ${COP(hoja.valorHora)} · ${hoja.horasMensualesBase} h/mes`,
		columnas: COLS_TARIFA,
		filas: hoja.tarifas
			.filter((x) => x.horas > 0)
			.map((x) => ({
				celdas: {
					recargo: x.nombre,
					pct: x.porcentaje,
					valorHora: x.valorHora,
					horas: redondear(x.horas),
					valor: x.valor
				}
			})),
		pie: {
			label: 'TOTAL RECARGOS',
			valor: hoja.tarifas.reduce((s, x) => s + x.valor, 0)
		},
		vacio: 'Sin recargos en el periodo.',
		ancho: 'completo'
	};

	// ── Bloques: uno por empresa y mes ──────────────────────────────────
	// Es el desglose que pide contabilidad para saber a qué cliente imputar
	// cada hora. Van con los días en texto, como en el Excel.
	const bloquesEmpresa: BloquePreview[] = hoja.bloquesEmpresa.map((b) => ({
		id: `empresa-${b.empresaId}-${b.anio}-${b.mes}`,
		titulo: b.empresa,
		subtitulo: b.textoDias,
		etiqueta: `${redondear(b.totalHoras)} h`,
		columnas: COLS_EMPRESA,
		filas: b.lineas
			.filter((l) => l.horas > 0)
			.map((l) => ({
				celdas: { recargo: l.nombre, horas: redondear(l.horas), valor: l.valor }
			})),
		pie: { label: 'TOTAL', valor: b.totalValor },
		vacio: 'Sin recargos.',
		variante: 'neutro'
	}));

	// ── Resumen final ───────────────────────────────────────────────────
	const resumen: LineaResumen[] = [
		{ label: 'Total devengado', valor: totalDevengado },
		{ label: 'Total deducciones', valor: enRojo(totalDeducido), descuento: true },
		{ label: 'Base prestacional', valor: t.baseCalculo ?? 0 },
		{ label: 'NETO A PAGAR', valor: totalDevengado - totalDeducido, fuerte: true }
	];

	const secciones: SeccionPreview[] = [
		{
			id: 'conceptos',
			titulo: 'DEVENGOS Y DEDUCCIONES',
			nota: `${hoja.dias.length} día(s) con planilla · ${redondear(hoja.totalHorasMes)} h`,
			columnas: COLS_CONCEPTOS,
			filas,
			totalesLabel: 'TOTALES',
			totales: { devengado: totalDevengado, deducido: enRojo(totalDeducido) },
			resumen,
			bloques: [bloqueTarifas, ...bloquesEmpresa],
			bloquesPorFila: 2,
			vacio: 'Este conductor no tiene conceptos en el periodo.'
		}
	];

	return {
		titulo: TITULO_SCOPE.nomina,
		meta: [
			{ label: 'Código', valor: 'NOM-DES-01' },
			{ label: 'Versión', valor: '2' },
			{ label: 'Fecha', valor: new Date().toLocaleDateString('en-CA') }
		],
		periodo: [
			{ label: 'Periodo', valor: `${nombreMes(periodo.mes)} ${periodo.anio}` },
			{ label: 'Del', valor: periodo.etiqueta },
			{ label: 'Empleado', valor: hoja.nombre },
			{ label: 'Cédula', valor: hoja.cedula ?? '—' },
			{ label: 'Cargo', valor: hoja.cargo },
			{ label: 'Estado', valor: hoja.estado }
		],
		secciones,
		firmas: true,
		// El sello se estampa cuando el desprendible ya no es un borrador, el
		// mismo criterio que en terceros: un documento en borrador no lleva
		// sello porque todavía puede cambiar.
		sello: hoja.estado !== 'BORRADOR',
		nombreArchivo: nombreArchivoDesprendible(hoja, periodo)
	};
}

/** `Desprendible_DAYRO-RODRIGUEZ_2026-08`. Sin tildes ni espacios. */
export function nombreArchivoDesprendible(
	hoja: HojaNominaDTO,
	periodo: PeriodoNominaDTO
): string {
	const nombre = hoja.nombre
		.normalize('NFD')
		// Rango de marcas combinantes, escrito con escapes: los caracteres
		// literales son invisibles en el editor y el primero que reformatee el
		// archivo se los lleva por delante sin enterarse.
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.toUpperCase();
	return `Desprendible_${nombre}_${periodo.anio}-${String(periodo.mes).padStart(2, '0')}`;
}
