/**
 * Página principal del desprendible con el DISEÑO 2 (pdfmake).
 *
 * Es la maquetación aprobada en septiembre de 2026 —cabecera clara con logo,
 * franja de identidad, tarjetas «Información básica», «Adicionales»,
 * «Novedades», «Deducciones», «Resumen de pago» y firmas con el sello— llevada
 * al MISMO generador del desprendible (`pdfDesprendible.ts`). No es otro
 * documento: canvas, dashboard, enlace firmado, portal, ZIP y app móvil siguen
 * saliendo de `construirDocDefinition()`, que arma los datos y llama aquí solo
 * para pintar la primera página. Las páginas de recargos, días sin recargo y
 * control de días siguen igual.
 *
 * Aquí NO se calcula nada: recibe las líneas ya resueltas (valores, días,
 * fechas de pernocte, signo de los conceptos adicionales…) para que el diseño
 * no pueda cambiar una cifra. Idéntico en los dos repos: lo que cambia por
 * empresa llega en `MarcaDesprendible`.
 */

export interface MarcaDesprendible {
	razonSocial: string;
	nit: string;
	/** Nombre corto para el pie («Transmeralda»). */
	nombre: string;
	/** Fondo de la cabecera y títulos de tabla. */
	oscuro: string;
	/** Fondo de las cabeceras de columna. */
	suave: string;
	/** Fondo de la fila del neto. */
	acento: string;
	/** Bordes de las tarjetas. */
	borde: string;
	/** Fondo de la franja de identidad. */
	fondoSuave: string;
	/** Logo a color, PNG en data-URL (pdfmake no lee WebP). */
	logo: string | null;
	sello: string | null;
}

export interface LineaDiseno {
	concepto: string;
	/** Texto pequeño bajo el concepto (fechas de pernocte, «ver detalle…»). */
	detalle?: string;
	cantidad?: string;
	valor: string;
	/** Color del valor (rojo para deducciones o conceptos negativos). */
	colorValor?: string;
	/** Fila de detalle colgada de la anterior (anticipos): sin valor, sangrada. */
	hija?: boolean;
}

export interface ModeloDesprendibleDiseno {
	nombre: string;
	cedula: string;
	diasLaborados: string;
	cargo: string;
	/** «SEPTIEMBRE DE 2026». */
	mes: string;
	/** «Periodo del 21 de agosto de 2026 al 20 de septiembre de 2026». */
	periodo: string;
	basicos: LineaDiseno[];
	tituloAdicionales: string;
	adicionales: LineaDiseno[];
	novedades: LineaDiseno[];
	deducciones: LineaDiseno[];
	totalIngresos: string;
	totalDeducciones: string;
	neto: string;
	/** Firma del conductor en data-URL; sin ella queda la línea para firmar. */
	firma: string | null;
	fechaGeneracion: string;
}

const ROJO = '#B42318';
const TEXTO = '#17201D';
const GRIS = '#66756F';
const LINEA = '#EDF3F0';
const ANCHO = 515; // A4 (595 pt) menos los márgenes de 40 pt del documento.

function encabezadoColumnas(marca: MarcaDesprendible) {
	const h = (text: string, alignment: 'left' | 'center' | 'right' = 'left') => ({
		text,
		bold: true,
		fontSize: 6.5,
		characterSpacing: 0.6,
		color: marca.oscuro,
		fillColor: marca.suave,
		alignment,
		margin: [2, 2, 2, 2]
	});
	return [h('CONCEPTO'), h('CANT.', 'center'), h('VALOR', 'right')];
}

function filaLinea(l: LineaDiseno) {
	if (l.hija) {
		return [
			{
				text: [
					{ text: '•  ', color: '#9E9E9E' },
					{ text: l.concepto, color: '#555555' }
				],
				fontSize: 7.5,
				margin: [10, 1, 2, 1],
				colSpan: 3
			},
			{},
			{}
		];
	}
	return [
		{
			stack: [
				{ text: l.concepto, fontSize: 8.5, color: TEXTO },
				...(l.detalle ? [{ text: l.detalle, fontSize: 6.8, color: GRIS, margin: [0, 1, 0, 0] }] : [])
			],
			margin: [2, 2, 2, 2]
		},
		{ text: l.cantidad ?? '', fontSize: 8.5, alignment: 'center', margin: [2, 2, 2, 2] },
		{
			text: l.valor,
			fontSize: 8.5,
			alignment: 'right',
			color: l.colorValor ?? TEXTO,
			margin: [2, 2, 2, 2]
		}
	];
}

/** Tarjeta con título, subtítulo y tabla CONCEPTO / CANT. / VALOR. */
function tarjeta(
	marca: MarcaDesprendible,
	titulo: string,
	subtitulo: string,
	lineas: LineaDiseno[],
	colorValor?: string
) {
	const cuerpo = lineas.length
		? lineas.map((l) => filaLinea(colorValor && !l.colorValor ? { ...l, colorValor } : l))
		: [
				[
					{ text: 'Sin conceptos.', italics: true, color: '#94A3B8', fontSize: 8, alignment: 'center', colSpan: 3, margin: [0, 4, 0, 4] },
					{},
					{}
				]
			];
	return {
		table: {
			widths: ['*', 42, 72],
			dontBreakRows: true,
			body: [
				[
					{
						stack: [
							{ text: titulo, bold: true, fontSize: 9.5, color: TEXTO },
							{ text: subtitulo, fontSize: 6.5, color: GRIS, margin: [0, 1, 0, 0] }
						],
						colSpan: 3,
						margin: [4, 4, 4, 3]
					},
					{},
					{}
				],
				encabezadoColumnas(marca),
				...cuerpo
			]
		},
		layout: {
			hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.6 : i <= 2 ? 0 : 0.5),
			vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
			hLineColor: (i: number, node: any) => (i === 0 || i === node.table.body.length ? marca.borde : LINEA),
			vLineColor: () => marca.borde,
			paddingLeft: () => 4,
			paddingRight: () => 4,
			paddingTop: () => 1,
			paddingBottom: () => 1
		}
	};
}

function cabecera(marca: MarcaDesprendible, m: ModeloDesprendibleDiseno) {
	const empresa = {
		width: '*',
		stack: [
			{ text: marca.razonSocial, bold: true, fontSize: 11.5, color: TEXTO },
			{ text: `NIT ${marca.nit}`, fontSize: 9, color: GRIS, margin: [0, 3, 0, 0] }
		]
	};
	const logo = marca.logo
		? { image: marca.logo, fit: [112, 44], width: 112, alignment: 'right' as const }
		: { text: marca.nombre.toUpperCase(), bold: true, fontSize: 9, color: marca.oscuro, alignment: 'right' as const };
	return [
		{
			columns: [empresa, logo],
			columnGap: 12,
			margin: [0, 0, 0, 10]
		},
		{ text: 'COMPROBANTE DIGITAL', bold: true, fontSize: 7.2, characterSpacing: 1, color: marca.acento, margin: [0, 0, 0, 3] },
		{ text: `Desprendible de nómina · ${m.mes.toLowerCase()}`, bold: true, fontSize: 16, color: marca.oscuro },
		{ text: m.periodo, bold: true, fontSize: 11.5, color: TEXTO, margin: [0, 4, 0, 0] },
		{
			canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: 0.8, lineColor: marca.borde }],
			margin: [0, 10, 0, 14]
		}
	];
}

function identidad(marca: MarcaDesprendible, m: ModeloDesprendibleDiseno) {
	const celda = (etiqueta: string, valor: string) => ({
		stack: [
			{ text: etiqueta, bold: true, fontSize: 5.8, characterSpacing: 0.9, color: GRIS },
			{ text: valor || '—', bold: true, fontSize: 8, color: TEXTO, margin: [0, 2, 0, 0] }
		],
		fillColor: marca.fondoSuave,
		margin: [4, 5, 4, 5]
	});
	return [
		celda('NOMBRE', m.nombre),
		celda('C.C.', m.cedula),
		celda('DÍAS LABORADOS', m.diasLaborados),
		celda('CARGO', m.cargo)
	];
}

/** Tarjeta de información básica, con la franja de identidad arriba. */
function tarjetaBasica(marca: MarcaDesprendible, m: ModeloDesprendibleDiseno) {
	const cuerpo = m.basicos.map(filaLinea);
	return {
		table: {
			widths: ['*', 42, 72],
			dontBreakRows: true,
			body: [
				[
					{
						table: { widths: [180, 95, 80, '*'], body: [identidad(marca, m)] },
						layout: 'noBorders',
						colSpan: 3,
						margin: [-4, -1, -4, 0]
					},
					{},
					{}
				],
				[
					{
						stack: [
							{ text: 'Información básica', bold: true, fontSize: 9.5, color: TEXTO },
							{ text: 'Salario y conceptos ordinarios', fontSize: 6.5, color: GRIS, margin: [0, 1, 0, 0] }
						],
						colSpan: 3,
						margin: [4, 5, 4, 3]
					},
					{},
					{}
				],
				encabezadoColumnas(marca),
				...cuerpo
			]
		},
		layout: {
			hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.6 : i === 1 ? 0.6 : i <= 3 ? 0 : 0.5),
			vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
			hLineColor: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? marca.borde : LINEA),
			vLineColor: () => marca.borde,
			paddingLeft: () => 4,
			paddingRight: () => 4,
			paddingTop: () => 1,
			paddingBottom: () => 1
		}
	};
}

function tarjetaResumen(marca: MarcaDesprendible, m: ModeloDesprendibleDiseno) {
	const fila = (texto: string, valor: string, color = TEXTO) => [
		{ text: texto, fontSize: 8.5, color: TEXTO, margin: [2, 3, 2, 3] },
		{ text: valor, fontSize: 8.5, alignment: 'right', color, margin: [2, 3, 2, 3] }
	];
	return {
		table: {
			widths: ['*', 'auto'],
			dontBreakRows: true,
			body: [
				[
					{
						stack: [
							{ text: 'Resumen de pago', bold: true, fontSize: 9.5, color: TEXTO },
							{ text: 'Valor final del periodo', fontSize: 6.5, color: GRIS, margin: [0, 1, 0, 0] }
						],
						colSpan: 2,
						margin: [4, 4, 4, 3]
					},
					{}
				],
				fila('Total ingresos', m.totalIngresos),
				fila('Total deducciones', m.totalDeducciones, ROJO),
				[
					{ text: 'NETO A PAGAR', bold: true, fontSize: 10, color: '#FFFFFF', fillColor: marca.acento, margin: [4, 5, 2, 5] },
					{ text: m.neto, bold: true, fontSize: 10, alignment: 'right', color: '#FFFFFF', fillColor: marca.acento, margin: [2, 5, 4, 5] }
				]
			]
		},
		layout: {
			hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.6 : i === 1 ? 0 : 0.5),
			vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
			hLineColor: (i: number, node: any) => (i === 0 || i === node.table.body.length ? marca.borde : LINEA),
			vLineColor: () => marca.borde,
			paddingLeft: () => 4,
			paddingRight: () => 4,
			paddingTop: () => 1,
			paddingBottom: () => 1
		}
	};
}

function firmas(marca: MarcaDesprendible, m: ModeloDesprendibleDiseno) {
	/// La imagen va en una celda de alto fijo para que las dos firmas queden a
	/// la misma altura, haya o no imagen; la línea es el borde superior de la
	/// celda del nombre (un `canvas` no se puede centrar en pdfmake).
	const bloque = (imagen: string | null, fit: [number, number], titulo: string, pie: string) => ({
		table: {
			widths: ['*'],
			heights: [52, 'auto'],
			body: [
				[imagen ? { image: imagen, fit, alignment: 'center', margin: [0, 52 - fit[1], 0, 0] } : { text: '' }],
				[
					{
						stack: [
							{ text: titulo, bold: true, fontSize: 8, color: marca.oscuro, alignment: 'center' },
							{ text: pie, fontSize: 6.5, color: GRIS, alignment: 'center', margin: [0, 1, 0, 0] }
						],
						margin: [0, 3, 0, 0]
					}
				]
			]
		},
		layout: {
			hLineWidth: (i: number) => (i === 1 ? 0.75 : 0),
			vLineWidth: () => 0,
			hLineColor: () => '#9EB0A8',
			paddingLeft: () => 18,
			paddingRight: () => 18
		}
	});
	return {
		table: {
			widths: ['*', '*'],
			dontBreakRows: true,
			body: [
				[
					{ ...bloque(m.firma, [190, 46], m.nombre, `C.C. ${m.cedula} · Firma de recibido`), margin: [6, 8, 6, 8] },
					{ ...bloque(marca.sello, [170, 50], marca.razonSocial, 'Empleador'), margin: [6, 8, 6, 8] }
				]
			]
		},
		layout: {
			hLineWidth: () => 0.6,
			vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
			hLineColor: () => marca.borde,
			vLineColor: () => marca.borde
		}
	};
}

/** Contenido de la primera página del desprendible con el diseño 2. */
export function paginaPrincipalDiseno2(m: ModeloDesprendibleDiseno, marca: MarcaDesprendible): any[] {
	return [
		...cabecera(marca, m),
		{ ...tarjetaBasica(marca, m), margin: [0, 8, 0, 0] },
		{
			columns: [
				tarjeta(marca, m.tituloAdicionales, 'Bonos, recargos OTROS, PAREX y GEOPARK, pernoctes y disponibilidad', m.adicionales),
				tarjeta(marca, 'Novedades y otros conceptos', 'Vacaciones y conceptos adicionales', m.novedades)
			],
			columnGap: 8,
			margin: [0, 8, 0, 0]
		},
		{
			columns: [
				tarjeta(marca, 'Deducciones', 'Descuentos aplicados al periodo', m.deducciones, ROJO),
				tarjetaResumen(marca, m)
			],
			columnGap: 8,
			margin: [0, 8, 0, 0]
		},
		{ ...firmas(marca, m), margin: [0, 10, 0, 0] },
		pieDocumento(marca, m.fechaGeneracion)
	];
}

// ─── Piezas para las páginas de detalle (recargos, días sin recargo) ─────

/**
 * Cabecera ligera de las páginas de detalle, con datos legibles también al
 * imprimir en blanco y negro.
 */
export function cabeceraSeccion(
	marca: MarcaDesprendible,
	o: { titulo: string; subtitulo?: string; datos: [string, string][] }
): any[] {
	const dato = ([etiqueta, valor]: [string, string]) => ({
		stack: [
			{ text: etiqueta, bold: true, fontSize: 5.8, characterSpacing: 0.7, color: GRIS },
			{ text: valor || '—', bold: true, fontSize: 7.8, color: TEXTO, margin: [0, 1, 0, 0] }
		],
		margin: [0, 0, 0, 4]
	});
	const mitad = Math.ceil(o.datos.length / 2);
	return [
		{
			columns: [
				{
					width: '*',
					stack: [
						{ text: marca.nombre.toUpperCase(), bold: true, fontSize: 6.3, characterSpacing: 1, color: marca.acento },
						{ text: o.titulo, bold: true, fontSize: 13, color: TEXTO, margin: [0, 3, 0, 0] },
						...(o.subtitulo ? [{ text: o.subtitulo, fontSize: 8.5, color: GRIS, margin: [0, 3, 0, 0] }] : [])
					],
					margin: [0, 0, 0, 0]
				},
				{ width: 120, stack: o.datos.slice(0, mitad).map(dato) },
				{ width: 110, stack: o.datos.slice(mitad).map(dato) }
			],
			columnGap: 8,
			margin: [0, 0, 0, 8]
		},
		{
			canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: 0.7, lineColor: marca.borde }],
			margin: [0, 0, 0, 12]
		}
	];
}

/** Firma del conductor al pie de una página de detalle. */
export function firmaConductor(marca: MarcaDesprendible, firma: string, nombre: string, cedula: string): any {
	return {
		table: {
			widths: [230],
			heights: [52, 'auto'],
			body: [
				[{ image: firma, fit: [190, 46], alignment: 'center', margin: [0, 6, 0, 0] }],
				[
					{
						stack: [
							{ text: nombre, bold: true, fontSize: 8, color: marca.oscuro, alignment: 'center' },
							{ text: `C.C. ${cedula} · Firma de recibido`, fontSize: 6.5, color: GRIS, alignment: 'center', margin: [0, 1, 0, 0] }
						],
						margin: [0, 3, 0, 0]
					}
				]
			]
		},
		layout: {
			hLineWidth: (i: number) => (i === 1 ? 0.75 : 0),
			vLineWidth: () => 0,
			hLineColor: () => '#9EB0A8'
		},
		margin: [142, 24, 0, 0]
	};
}

/** Pie de las páginas del desprendible. */
export function pieDocumento(marca: MarcaDesprendible, fecha: string): any {
	return {
		text: `Documento generado electrónicamente por ${marca.nombre} el ${fecha} · Conserva este comprobante para tu archivo.`,
		fontSize: 6.5,
		color: GRIS,
		alignment: 'center',
		margin: [0, 10, 0, 0]
	};
}
