/**
 * Página «CONTROL DÍAS LABORADOS PERSONAL» (OP-FR-03) dentro del desprendible.
 *
 * Es la planilla que exporta el canvas de recorridos
 * (`preview/datos/recorridos.doc.ts`), recortada a lo que el desprendible
 * necesita: fecha, día, tipo de día (laboró / descanso…), hora de inicio y fin
 * y cliente. Fuera la placa, la descripción del recorrido, el pernocte y los
 * bonos: el desprendible ya paga los bonos en su página 1, y repetirlos aquí
 * daba dos cifras que cuadrar.
 *
 * Va en pdfmake y no por el export de Chromium del canvas de recorridos porque
 * el desprendible entero es pdfmake (ver `pdfDesprendible.ts`): mezclar dos
 * PDF obligaría a pasar cada desprendible por el servidor. Se calca el
 * encabezado —logo, razón social, título y la cajita de código / versión /
 * fecha—, la fila «Nombre conductor · C.C. · Corte» y los 31 renglones del
 * formato, con la firma del conductor al pie.
 */
import type { RecorridosPeriodoDTO } from '$lib/editor/builders/recorridos.builder';

/** Lo mínimo de una fila de recorrido que la página imprime. */
export interface FilaControlDias {
	fecha: string;
	tipo_dia: string;
	hora_inicio: string | null;
	hora_fin: string | null;
	cliente_nombre: string | null;
}

export interface ControlDias {
	etiqueta: string;
	filas: FilaControlDias[];
}

/** Los mismos metadatos que el export del canvas de recorridos. */
const FORMATO = {
	titulo: 'CONTROL DÍAS LABORADOS PERSONAL',
	codigo: 'OP-FR-03',
	version: '3',
	fecha: '2025-01-09'
} as const;

/** El formato impreso es un mes: 31 renglones, los que sobran en blanco. */
const RENGLONES_MINIMOS = 31;

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

/** `2026-08-21` → `21/08/26`, como en el export de recorridos. */
function fechaCorta(iso: string): string {
	const [a, m, d] = iso.split('-');
	return a && m && d ? `${d}/${m}/${a.slice(2)}` : iso;
}

function diaSemana(iso: string): string {
	const [a, m, d] = iso.split('-').map(Number);
	if (!a || !m || !d) return '';
	return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * Logo de la marca en PNG, para el encabezado de esta página.
 *
 * Es el mismo archivo del export de recorridos, pero en WebP, y pdfmake no lo
 * lee: se transcodifica con un <canvas>. Si falla, la casilla queda vacía en
 * vez de caer en otro logo.
 */
export async function logoPngDataUrl(url: string): Promise<string | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(String(res.status));
		const bitmap = await createImageBitmap(await res.blob());
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Sin contexto 2D');
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		return canvas.toDataURL('image/png');
	} catch {
		return null;
	}
}

/** La hoja de UN conductor del libro de recorridos, ya en la forma de la página. */
export function controlDiasDesdeRecorridos(
	dto: RecorridosPeriodoDTO | null | undefined,
	conductorId: string
): ControlDias | null {
	const hoja = dto?.hojas?.find((h) => h.conductor_id === conductorId);
	if (!dto || !hoja || hoja.filas.length === 0) return null;
	return {
		etiqueta: dto.etiqueta,
		filas: hoja.filas.map((f) => ({
			fecha: f.fecha,
			tipo_dia: f.tipo_dia,
			hora_inicio: f.hora_inicio,
			hora_fin: f.hora_fin,
			cliente_nombre: f.cliente_nombre
		}))
	};
}

/** Contenido pdfmake de la página, desde su salto de página hasta la firma. */
export function paginaControlDias(o: {
	control: ControlDias;
	color: string;
	colorBg: string;
	razonSocial: string;
	logo: string | null;
	conductorNombre: string;
	conductorCedula: string;
	/** Firma del conductor en data-URL; sin ella queda la línea para firmar a mano. */
	firma: string | null;
}): any[] {
	const { control, color, colorBg } = o;
	const borde = '#BDBDBD';

	const encabezado = {
		table: {
			widths: [100, '*', 120],
			body: [
				[
					// Centrado también en vertical: la celda la estira el bloque del título.
					o.logo
						? {
								image: o.logo,
								fit: [90, 50],
								alignment: 'center' as const,
								verticalAlignment: 'middle' as const
							}
						: { text: '' },
					{
						stack: [
							{ text: o.razonSocial, fontSize: 9, bold: true, color: '#333333' },
							{
								text: FORMATO.titulo,
								fontSize: 12,
								bold: true,
								color,
								margin: [0, 4, 0, 0]
							}
						],
						alignment: 'center' as const,
						margin: [0, 8, 0, 0]
					},
					{
						table: {
							widths: [45, '*'],
							body: [
								['Código', FORMATO.codigo],
								['Versión', FORMATO.version],
								['Fecha', FORMATO.fecha]
							].map(([l, v]) => [
								{ text: l, fontSize: 8, bold: true, color, fillColor: colorBg },
								{ text: v, fontSize: 8 }
							])
						},
						layout: {
							hLineColor: () => borde,
							vLineColor: () => borde,
							hLineWidth: () => 0.5,
							vLineWidth: () => 0.5
						},
						margin: [0, 6, 0, 0]
					}
				]
			]
		},
		layout: {
			hLineColor: () => borde,
			vLineColor: () => borde,
			hLineWidth: () => 1,
			vLineWidth: () => 1
		},
		margin: [0, 0, 0, 8]
	};

	const nombre = o.conductorNombre.replace(/\s+/g, ' ').trim();
	const cabeceraBloque = {
		table: {
			widths: ['*'],
			body: [
				[
					{
						columns: [
							{ text: `Nombre conductor: ${nombre}`, bold: true, fontSize: 9, width: '*' },
							{ text: `C.C.: ${o.conductorCedula}`, fontSize: 9, width: 'auto' },
							{
								text: `Corte: ${control.etiqueta}`,
								fontSize: 9,
								bold: true,
								width: 'auto',
								margin: [12, 0, 0, 0]
							}
						],
						fillColor: colorBg,
						color: '#333333',
						margin: [4, 4, 4, 4]
					}
				]
			]
		},
		layout: {
			hLineColor: () => borde,
			vLineColor: () => borde,
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			paddingLeft: () => 0,
			paddingRight: () => 0,
			paddingTop: () => 0,
			paddingBottom: () => 0
		}
	};

	const th = (text: string, alignment: 'left' | 'center' = 'center') => ({
		text,
		bold: true,
		fontSize: 8,
		color,
		fillColor: colorBg,
		alignment,
		margin: [0, 3, 0, 3]
	});
	const td = (text: string, alignment: 'left' | 'center' = 'center', bold = false) => ({
		text,
		bold,
		fontSize: 8,
		color: '#333333',
		alignment,
		margin: [0, 2, 0, 2]
	});

	const filas: any[][] = control.filas.map((f) => [
		td(fechaCorta(f.fecha), 'center', true),
		td(diaSemana(f.fecha)),
		// Entero: con seis columnas en vertical sobra ancho para «MANTENIMIENTO».
		td(f.tipo_dia ?? ''),
		td(f.hora_inicio ?? ''),
		td(f.hora_fin ?? ''),
		td(f.cliente_nombre ?? '', 'left')
	]);
	/// Relleno hasta el mínimo del formato, sin dato alguno, para que no se
	/// confunda con un día registrado y en blanco.
	while (filas.length < RENGLONES_MINIMOS) filas.push(Array.from({ length: 6 }, () => td(' ')));

	const tabla = {
		table: {
			headerRows: 1,
			dontBreakRows: true,
			widths: [50, 34, 78, 42, 42, '*'],
			body: [
				[th('FECHA'), th('DÍA'), th('TIPO'), th('INICIO'), th('FIN'), th('CLIENTE', 'left')],
				...filas
			]
		},
		layout: {
			hLineWidth: (i: number, node: any) =>
				i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#E0E0E0',
			vLineColor: () => '#E0E0E0',
			paddingLeft: () => 3,
			paddingRight: () => 3,
			paddingTop: () => 1,
			paddingBottom: () => 1,
			fillColor: (i: number) => (i > 0 && i % 2 === 0 ? '#f9f9f9' : null)
		}
	};

	const firma = {
		stack: [
			o.firma
				? { image: o.firma, width: 180, height: 50, alignment: 'center' as const }
				: { text: ' ', margin: [0, 0, 0, 50] },
			{
				canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 1, lineColor: borde }],
				width: 190,
				alignment: 'center' as const,
				margin: [0, 2, 0, 0]
			},
			{
				text: 'Firma del conductor',
				fontSize: 10,
				color,
				bold: true,
				alignment: 'center' as const,
				margin: [0, 4, 0, 0]
			}
		],
		alignment: 'center' as const,
		unbreakable: true,
		margin: [0, 24, 0, 0]
	};

	return [{ text: '', pageBreak: 'before' as const }, encabezado, cabeceraBloque, tabla, firma];
}
