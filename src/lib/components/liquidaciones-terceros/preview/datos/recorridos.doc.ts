/**
 * Adaptador de preview del canvas de RECORRIDOS.
 *
 * Dos diferencias deliberadas respecto a lo que se ve en el canvas:
 *
 *  · En pantalla, un bono es una CASILLA (SÍ/NO). En el papel se imprime su
 *    IMPORTE. El documento existe para contabilizar: una columna de «SÍ» no se
 *    suma, y quien recibe el PDF necesita saber cuánto se pagó, no solo que se
 *    pagó.
 *
 *  · Al pie va un RESUMEN por placa y mes con el número de bonos de cada tipo
 *    —«FST006 · Agosto · 6 de alimentación, 2 de día doble»—, que es la
 *    pregunta que de verdad se le hace a esta hoja y que en la tabla de
 *    recorridos habría que contar a mano fila por fila.
 *
 * Todo va como BLOQUE y no como sección con `columnas`: las columnas de bono
 * dependen de `bono_config_visual` del año, y el catálogo del preview es
 * estático.
 */

import type {
	BloquePreview,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	SeccionPreview
} from '../tipos';
import { COP, nombreMes } from '../formato';
import type {
	BonoColumna,
	FilaRecorrido,
	HojaRecorridos,
	RecorridosPeriodoDTO
} from '$lib/editor/builders/recorridos.builder';

/** Columnas fijas de la tabla de recorridos, antes de las de bono. */
/**
 * Columnas del formato OP-FR-03, en su orden y con sus rótulos.
 *
 * Los pesos siguen la proporción de los anchos del Excel: la descripción de la
 * labor es con diferencia la más ancha (61 unidades frente a 12-21 del resto),
 * porque es donde se escribe el recorrido completo.
 */
function columnasBase(): ColumnaPreview[] {
	return [
		{ key: 'n', label: 'Item', tipo: 'numero', peso: 2, fija: true },
		{ key: 'fecha', label: 'Fecha', tipo: 'texto', peso: 6, fija: true },
		{ key: 'dia', label: 'Día', tipo: 'texto', peso: 3 },
		{ key: 'tipo', label: 'Tipo de día', tipo: 'texto', peso: 6 },
		{ key: 'placa', label: 'Placa vehículo', tipo: 'placa', peso: 6 },
		{
			key: 'descripcion',
			label: 'Descripción de la Labor / Recorrido',
			tipo: 'texto',
			peso: 20
		},
		{ key: 'hora_ini', label: 'Hora inicial', tipo: 'texto', peso: 5 },
		{ key: 'hora_fin', label: 'Hora final', tipo: 'texto', peso: 5 },
		{
			key: 'horas',
			label: 'Tiempo Total de Conducción en la Jornada',
			tipo: 'numero',
			peso: 7
		},
		{ key: 'pernocte', label: 'Pernote SI / NO', tipo: 'texto', peso: 5 },
		{ key: 'cliente', label: 'Cliente', tipo: 'texto', peso: 12 }
	];
}

function columnasDeBono(bonos: BonoColumna[]): ColumnaPreview[] {
	return bonos.map((b) => ({
		key: `bono_${b.config_id}`,
		label: b.nombre,
		tipo: 'moneda' as const,
		peso: 7
	}));
}

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

function diaSemana(iso: string): string {
	const [a, m, d] = iso.split('-').map(Number);
	if (!a || !m || !d) return '';
	return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/** Valor total de los bonos marcados en una fila. */
function totalFila(f: FilaRecorrido, bonos: BonoColumna[]): number {
	let t = 0;
	for (const b of bonos) if (f.bonos?.[b.config_id]) t += b.valor;
	return t;
}

/** Tabla de recorridos de un conductor. */
function bloqueRecorridos(hoja: HojaRecorridos, bonos: BonoColumna[]): BloquePreview {
	const columnas = [
		...columnasBase(),
		...columnasDeBono(bonos),
		{ key: 'total', label: 'Valor a pagar', tipo: 'moneda' as const, peso: 7 },
		// Va en blanco a propósito: es la casilla del formato impreso donde
		// Operaciones firma el papel una vez exportado.
		{ key: 'firma', label: 'Firma Operaciones', tipo: 'texto' as const, peso: 8 }
	];

	const filas: FilaPreview[] = hoja.filas.map((f, i) => {
		const celdas: Record<string, unknown> = {
			n: i + 1,
			fecha: f.fecha,
			dia: diaSemana(f.fecha),
			tipo: f.tipo_dia,
			placa: f.vehiculo_placa ?? '',
			// «Descripción de la Labor / Recorrido» del formato: es la
			// observación del tramo, que es donde se escribe a mano el recorrido.
			descripcion: f.observaciones ?? '',
			cliente: f.cliente_nombre ?? '',
			hora_ini: f.hora_inicio ?? '',
			hora_fin: f.hora_fin ?? '',
			horas: f.horas_conducidas || '',
			pernocte: f.pernocte ? 'SÍ' : 'NO'
		};
		for (const b of bonos) {
			// El IMPORTE, no la casilla: es lo que hace contabilizable el papel.
			// Vacío —y no cero— cuando no se otorgó: una columna llena de «$ 0»
			// esconde los importes que sí están.
			celdas[`bono_${b.config_id}`] = f.bonos?.[b.config_id] ? b.valor : '';
		}
		celdas.total = totalFila(f, bonos) || '';
		celdas.firma = '';
		return { celdas } as FilaPreview;
	});

	const total = hoja.filas.reduce((n, f) => n + totalFila(f, bonos), 0);

	return {
		id: `recorridos-${hoja.conductor_id}`,
		// Los mismos rótulos del formato, y el APELLIDO primero: es como se
		// busca a una persona en una lista de cuarenta.
		titulo: `Nombre Conductor: ${`${hoja.apellido} ${hoja.nombre}`.replace(/\s+/g, ' ').trim()}`,
		subtitulo: `C.C.: ${hoja.numero_identificacion ?? '________________'}`,
		columnas,
		filas,
		pie: { label: 'Total en bonos', valor: total },
		variante: 'neutro',
		ancho: 'completo',
		vacio: 'Sin recorridos en el periodo.'
	};
}

interface ClaveResumen {
	placa: string;
	mes: number;
}

/**
 * Resumen por PLACA y MES.
 *
 * Se agrupa por la placa del recorrido y no por la del conductor porque un
 * conductor puede cambiar de vehículo dentro del mes, y el conteo que se
 * factura es el del carro.
 *
 * Los recorridos sin placa se agrupan bajo «(sin placa)» en vez de
 * descartarse: si un bono se otorgó sobre una fila sin vehículo, esconderlo
 * haría que el resumen no cuadre con la tabla de arriba y nadie sabría por qué.
 */
function bloqueResumen(dto: RecorridosPeriodoDTO, hojas: HojaRecorridos[]): BloquePreview {
	const bonos = dto.bonos;
	const acumulado = new Map<string, { clave: ClaveResumen; counts: Record<string, number> }>();

	for (const hoja of hojas) {
		for (const f of hoja.filas) {
			const placa = f.vehiculo_placa?.trim() || '(sin placa)';
			const mesFila = Number(f.fecha.slice(5, 7)) || dto.mes;
			const k = `${placa}|${mesFila}`;
			let entrada = acumulado.get(k);
			if (!entrada) {
				entrada = { clave: { placa, mes: mesFila }, counts: {} };
				acumulado.set(k, entrada);
			}
			for (const b of bonos) {
				if (f.bonos?.[b.config_id]) {
					entrada.counts[b.config_id] = (entrada.counts[b.config_id] ?? 0) + 1;
				}
			}
		}
	}

	const columnas: ColumnaPreview[] = [
		{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 8, fija: true },
		{ key: 'mes', label: 'Mes', tipo: 'texto', peso: 8, fija: true },
		...bonos.map((b) => ({
			key: `n_${b.config_id}`,
			label: b.nombre,
			tipo: 'numero' as const,
			peso: 9
		})),
		{ key: 'total_bonos', label: 'Total bonos', tipo: 'numero' as const, peso: 7 },
		{ key: 'valor', label: 'Valor', tipo: 'moneda' as const, peso: 10 }
	];

	const filas: FilaPreview[] = [...acumulado.values()]
		// Placa y luego mes: el lector busca primero su carro.
		.sort(
			(a, b) =>
				a.clave.placa.localeCompare(b.clave.placa, 'es') || a.clave.mes - b.clave.mes
		)
		// Una placa sin ningún bono en el mes no aporta nada al resumen.
		.filter((e) => Object.values(e.counts).some((n) => n > 0))
		.map((e) => {
			const celdas: Record<string, unknown> = {
				placa: e.clave.placa,
				mes: nombreMes(e.clave.mes).toUpperCase()
			};
			let total = 0;
			let valor = 0;
			for (const b of bonos) {
				const n = e.counts[b.config_id] ?? 0;
				celdas[`n_${b.config_id}`] = n || '';
				total += n;
				valor += n * b.valor;
			}
			celdas.total_bonos = total;
			celdas.valor = valor;
			return { celdas } as FilaPreview;
		});

	const valorTotal = filas.reduce((n, f) => n + Number((f.celdas as any).valor || 0), 0);

	return {
		id: 'resumen-bonos',
		titulo: 'Resumen de bonos por placa y mes',
		columnas,
		filas,
		pie: { label: 'Total del periodo', valor: valorTotal },
		variante: 'concepto',
		ancho: 'completo',
		vacio: 'No se otorgaron bonos en el periodo.'
	};
}

function meta(dto: RecorridosPeriodoDTO) {
	return {
		// Los del formato oficial OP-FR-03 v3, para que el PDF sea el mismo
		// documento que se venía llenando a mano.
		titulo: 'CONTROL DÍAS LABORADOS PERSONAL',
		meta: [
			{ label: 'Código', valor: 'OP-FR-03' },
			{ label: 'Versión', valor: '3' },
			{ label: 'Fecha', valor: '2025-01-09' }
		],
		// El corte, no el mes: es el periodo que de verdad se está liquidando.
		periodo: [
			{ label: 'Corte', valor: dto.etiqueta.toUpperCase() },
			{ label: 'Desde', valor: dto.desde },
			{ label: 'Hasta', valor: dto.hasta }
		]
	};
}

/**
 * Documento del preview.
 *
 * Con `conductorId` sale la hoja de esa persona; sin él, el periodo entero.
 * Debajo va siempre el resumen de bonos, calculado sobre las mismas hojas que
 * se están imprimiendo — si no, el resumen contaría bonos que no aparecen en la
 * tabla de arriba.
 */
export function documentoRecorridos(
	dto: RecorridosPeriodoDTO,
	conductorId?: string | null
): DocumentoPreview {
	const hojas = conductorId
		? dto.hojas.filter((h) => h.conductor_id === conductorId)
		: dto.hojas;

	const secciones: SeccionPreview[] = [
		{
			id: 'recorridos',
			titulo: 'Recorridos del periodo',
			nota:
				'Una fila por recorrido. Un día con varios recorridos ocupa varias filas, ' +
				'en orden cronológico.',
			columnas: [],
			filas: [],
			bloques: hojas.map((h) => bloqueRecorridos(h, dto.bonos)),
			bloquesPorFila: 1
		},
		{
			id: 'resumen',
			titulo: 'Resumen',
			columnas: [],
			filas: [],
			bloques: [bloqueResumen(dto, hojas)],
			bloquesPorFila: 1
		}
	];

	// APELLIDO primero, igual que en la pestaña y en la cabecera de la hoja.
	const nombre = conductorId
		? `${hojas[0]?.apellido ?? ''} ${hojas[0]?.nombre ?? ''}`.replace(/\s+/g, ' ').trim()
		: 'PERIODO';

	return {
		...meta(dto),
		secciones,
		// El formato lleva firma al pie, y la columna «Firma Operaciones» de
		// cada fila es para el visto bueno tramo a tramo.
		firmas: true,
		sello: false,
		nombreArchivo: `OP-FR-03 ${nombre} ${dto.desde} a ${dto.hasta}`
			.replace(/\s+/g, ' ')
			.trim()
	} as DocumentoPreview;
}

/** Un documento por conductor, para el ZIP. */
export function hojasParaZip(dto: RecorridosPeriodoDTO) {
	return dto.hojas.map((h) => ({
		documento: documentoRecorridos(dto, h.conductor_id),
		nombreArchivo: `${h.apellido} ${h.nombre} ${dto.desde} a ${dto.hasta}`
			.replace(/\s+/g, ' ')
			.trim()
	}));
}

export { COP };
