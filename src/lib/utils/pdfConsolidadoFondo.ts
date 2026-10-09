/**
 * PDF del consolidado del saldo del área de operaciones en un periodo.
 *
 * Una fila por movimiento del fondo: cuándo, qué fue (saldo recibido, anticipo,
 * gasto, corrección, cierre), cuánto entró o salió y cuál era el saldo justo
 * después. Los cierres van resaltados con cuánto quedó. Arriba, el resumen del
 * periodo: con cuánto arrancó, cuánto entró, cuánto salió y con cuánto terminó.
 *
 * Se genera en el navegador con pdfmake, como los desprendibles.
 */
import { TIPO_MOVIMIENTO_LABELS, moneda, type ConsolidadoFondo } from '$lib/api/viaticos';
import { blobDePdf, cargarPdfMake } from '$lib/utils/pdfmake-cargar';
import { logoPngDataUrl } from '$lib/utils/pdfControlDias';

export interface OpcionesConsolidado {
	empresa: string;
	/** Ruta del logo (webp o png); se convierte a PNG para pdfmake. */
	logo: string;
	generadoPor: string | null;
	/** «Semana 40 · 28 sep – 4 oct 2026», «Septiembre de 2026»… */
	etiquetaPeriodo: string;
}

const VERDE = '#014339';
const ROJO = '#b42318';
const GRIS = '#66756f';
const FONDO_CIERRE = '#e6f4ee';

function fechaHora(iso: string): { fecha: string; hora: string } {
	const d = new Date(iso);
	return {
		fecha: d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
		hora: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
	};
}

function fechaLarga(ymd: string): string {
	const [a, m, d] = ymd.split('-').map(Number);
	return new Date(a, m - 1, d).toLocaleDateString('es-CO', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

export function docConsolidadoFondo(
	c: ConsolidadoFondo,
	o: OpcionesConsolidado,
	logoDataUrl: string | null
) {
	const salidas = c.totales.anticipos + c.totales.gastos;
	const correcciones = c.totales.ajustes + c.totales.reversos;
	const generado = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

	const filas = c.movimientos.map((m) => {
		const { fecha, hora } = fechaHora(m.fecha);
		const esCierre = m.tipo === 'CIERRE';
		const fill = esCierre ? FONDO_CIERRE : undefined;
		const detalle = esCierre
			? [
					{
						text: `Cierre de corte: quedaron ${moneda(m.saldo_despues)} que pasan al siguiente`,
						bold: true,
						color: VERDE
					},
					m.observaciones && !m.observaciones.startsWith('Cierre de corte')
						? { text: m.observaciones, color: GRIS, fontSize: 7.5 }
						: ''
				]
			: [
					m.detalle || '—',
					m.registrado_por
						? { text: `Registró ${m.registrado_por}`, color: GRIS, fontSize: 7.5 }
						: ''
				];
		return [
			{ text: `${fecha}\n${hora}`, fillColor: fill, fontSize: 8 },
			{
				text: TIPO_MOVIMIENTO_LABELS[m.tipo],
				fillColor: fill,
				bold: true,
				color:
					m.tipo === 'RECARGA'
						? VERDE
						: m.tipo === 'ANTICIPO' || m.tipo === 'GASTO_EMPRESA'
							? ROJO
							: undefined
			},
			{ stack: detalle, fillColor: fill },
			{ text: m.entra ? moneda(m.entra) : '', alignment: 'right', fillColor: fill, color: VERDE },
			{ text: m.sale ? moneda(m.sale) : '', alignment: 'right', fillColor: fill, color: ROJO },
			{ text: moneda(m.saldo_antes), alignment: 'right', fillColor: fill, color: GRIS },
			{ text: moneda(m.saldo_despues), alignment: 'right', fillColor: fill, bold: true }
		];
	});

	const resumen = [
		['Saldo al inicio del periodo', moneda(c.saldo_inicial)],
		['Saldo recibido', `+ ${moneda(c.totales.recibido)}`],
		['Anticipos entregados', `− ${moneda(c.totales.anticipos)}`],
		['Gastos de la empresa', `− ${moneda(c.totales.gastos)}`],
		[
			'Correcciones y reversos',
			`${correcciones < 0 ? '−' : '+'} ${moneda(Math.abs(correcciones))}`
		],
		['Total que salió', `− ${moneda(salidas)}`],
		['Saldo al final del periodo', moneda(c.saldo_final)]
	];

	return {
		pageSize: 'A4',
		pageOrientation: 'landscape',
		pageMargins: [28, 90, 28, 44],
		defaultStyle: { font: 'Roboto', fontSize: 8.5, color: '#17201d' },
		images: logoDataUrl ? { logo: logoDataUrl } : {},
		header: {
			margin: [28, 22, 28, 0],
			columns: [
				logoDataUrl
					? { image: 'logo', fit: [120, 40] }
					: { text: o.empresa, fontSize: 14, bold: true, color: VERDE },
				{
					stack: [
						{
							text: 'Consolidado del saldo del área de operaciones',
							fontSize: 13,
							bold: true,
							alignment: 'right'
						},
						{
							text: `Viáticos · ${o.etiquetaPeriodo} (${fechaLarga(c.desde)} – ${fechaLarga(c.hasta)})`,
							alignment: 'right',
							color: GRIS
						},
						{
							text: `${o.empresa} · generado el ${generado}${o.generadoPor ? ` por ${o.generadoPor}` : ''}`,
							alignment: 'right',
							color: GRIS,
							fontSize: 7.5
						}
					]
				}
			]
		},
		footer: (actual: number, total: number) => ({
			margin: [28, 12, 28, 0],
			columns: [
				{
					text: 'El saldo de cada fila es el que quedaba en el área justo después de ese movimiento. Un cierre no mueve plata: lo que queda pasa al corte siguiente.',
					color: GRIS,
					fontSize: 7
				},
				{ text: `Página ${actual} de ${total}`, alignment: 'right', color: GRIS, fontSize: 7.5 }
			]
		}),
		content: [
			{
				columns: [
					{
						width: '42%',
						table: {
							widths: ['*', 'auto'],
							body: resumen.map(([k, v], i) => [
								{
									text: k,
									bold: i === 0 || i === resumen.length - 1,
									fillColor: i === resumen.length - 1 ? FONDO_CIERRE : undefined
								},
								{
									text: v,
									alignment: 'right',
									bold: i === 0 || i === resumen.length - 1,
									fillColor: i === resumen.length - 1 ? FONDO_CIERRE : undefined
								}
							])
						},
						layout: 'lightHorizontalLines'
					},
					{ width: 16, text: '' },
					{
						width: '*',
						stack: [
							{
								text: `Cortes cerrados en el periodo: ${c.cierres.length}`,
								bold: true,
								margin: [0, 0, 0, 4]
							},
							c.cierres.length
								? {
										table: {
											widths: ['auto', '*', 'auto', 'auto'],
											body: [
												[
													{ text: 'Fecha', bold: true, color: GRIS },
													{ text: 'Nota', bold: true, color: GRIS },
													{ text: 'Cerró', bold: true, color: GRIS },
													{ text: 'Quedó', bold: true, color: GRIS, alignment: 'right' }
												],
												...c.cierres.map((k) => [
													fechaHora(k.fecha).fecha,
													k.observaciones ?? '',
													k.por ?? '—',
													{ text: moneda(k.restante), alignment: 'right', bold: true }
												])
											]
										},
										layout: 'lightHorizontalLines'
									}
								: {
										text: 'Ningún corte se cerró en este periodo; el saldo final sigue abierto.',
										color: GRIS
									},
							{
								text: `${c.movimientos.length} movimientos en el periodo`,
								color: GRIS,
								margin: [0, 8, 0, 0]
							}
						]
					}
				]
			},
			{ text: 'Movimientos del saldo', bold: true, fontSize: 10.5, margin: [0, 14, 0, 6] },
			c.movimientos.length
				? {
						table: {
							headerRows: 1,
							widths: [52, 64, '*', 62, 62, 66, 66],
							body: [
								[
									'Fecha',
									'Movimiento',
									'Detalle',
									'Entró',
									'Salió',
									'Saldo antes',
									'Saldo después'
								].map((t, i) => ({
									text: t,
									bold: true,
									color: '#ffffff',
									fillColor: VERDE,
									alignment: i >= 3 ? 'right' : 'left'
								})),
								...filas
							]
						},
						layout: {
							hLineWidth: () => 0.4,
							vLineWidth: () => 0,
							hLineColor: () => '#d9e3df',
							paddingTop: () => 4,
							paddingBottom: () => 4
						}
					}
				: { text: 'No hubo movimientos del saldo en este periodo.', color: GRIS }
		]
	};
}

/** Descarga el consolidado como PDF; devuelve el nombre del archivo. */
export async function descargarConsolidadoFondo(
	c: ConsolidadoFondo,
	o: OpcionesConsolidado
): Promise<string> {
	const [pdfMake, logo] = await Promise.all([
		cargarPdfMake(),
		logoPngDataUrl(o.logo).catch(() => null)
	]);
	const blob = await blobDePdf(pdfMake, docConsolidadoFondo(c, o, logo));
	const nombre = `consolidado-saldo-operaciones_${c.desde}_a_${c.hasta}.pdf`;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombre;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
	return nombre;
}
