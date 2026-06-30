/**
 * Generador de PDF Desprendible de Prima usando pdfmake
 * Entidad independiente: la prima ya no está asociada a una liquidación.
 * Reutiliza la firma del desprendible de nómina (firmas con presignedUrl).
 */
import type { Prima, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64, imageToBase64Url } from '$lib/utils/pdfUtils';

function formatCurrency(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}

function safeValue(val: any, def: any = '') {
	return val !== undefined && val !== null ? val : def;
}

const MESES_NOMBRES = [
	'',
	'Enero',
	'Febrero',
	'Marzo',
	'Abril',
	'Mayo',
	'Junio',
	'Julio',
	'Agosto',
	'Septiembre',
	'Octubre',
	'Noviembre',
	'Diciembre'
];

export async function generarPdfPrima(
	prima: Prima,
	firmas: FirmaConUrl[] = []
): Promise<void> {
	const pdfMake = (await import('pdfmake/build/pdfmake')).default;
	const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
	pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

	const esCotransmeq = !!prima.conductor?.numero_identificacion
		? false
		: false; // Por defecto Transmeralda; se puede derivar del conductor si se requiere
	const color = esCotransmeq ? '#FF9500' : '#2E8B57';
	const empresa = esCotransmeq
		? 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S'
		: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S';
	const nit = esCotransmeq ? '901983227' : '901528440-3';

	const conductorNombre = `${safeValue(prima.conductor?.nombre, 'N/A')} ${safeValue(prima.conductor?.apellido, '')}`.trim();
	const conductorCedula = safeValue(prima.conductor?.numero_identificacion, 'N/A');

	// Cargar logo
	const logoBase64 = await obtenerLogoBase64(esCotransmeq);

	const valorPrima = Number(safeValue(prima.prima, 0));
	const primaPendiente = Number(safeValue(prima.prima_pendiente, 0));

	const mes = Number(prima.mes) || 0;
	const year = Number(prima.anio) || new Date().getFullYear();
	const mesLabel = `${MESES_NOMBRES[mes] || 'Periodo'} ${year}`;

	// Filas de detalle de prima
	const detalleBody: any[][] = [];
	if (valorPrima > 0) {
		detalleBody.push([
			{
				stack: [
					{ text: `Prima ${mesLabel}` },
					{
						text: 'Valor pagado',
						fontSize: 8,
						color: '#666',
						italics: true
					}
				]
			},
			{ text: formatCurrency(valorPrima), color, alignment: 'right' as const, bold: true }
		]);
	}
	if (primaPendiente > 0) {
		detalleBody.push([
			{
				stack: [
					{ text: `Ajuste prima ${mesLabel}` },
					{
						text: 'Valor pendiente adicional',
						fontSize: 8,
						color: '#666',
						italics: true
					}
				]
			},
			{
				text: formatCurrency(primaPendiente),
				color,
				alignment: 'right' as const,
				bold: true
			}
		]);
	}

	// Datos del desprendible (campos manuales)
	const datosManualesBody: any[][] = [];
	const tiempoDias = Number(safeValue(prima.tiempo_trabajado_dias, 0));
	const sueldoBasico = Number(safeValue(prima.sueldo_basico, 0));
	const auxTransporte = Number(safeValue(prima.auxilio_transporte, 0));
	const sueldoVariable = Number(safeValue(prima.sueldo_variable, 0));
	const totalBase = Number(safeValue(prima.total_base_liquidacion, 0));

	if (tiempoDias > 0) {
		datosManualesBody.push([
			{ text: 'Tiempo trabajado', color: '#666' },
			{ text: `${tiempoDias} días`, alignment: 'right' as const, bold: true }
		]);
	}
	if (sueldoBasico > 0) {
		datosManualesBody.push([
			{ text: 'Sueldo básico', color: '#666' },
			{ text: formatCurrency(sueldoBasico), alignment: 'right' as const, bold: true }
		]);
	}
	if (auxTransporte > 0) {
		datosManualesBody.push([
			{ text: 'Auxilio de transporte', color: '#666' },
			{ text: formatCurrency(auxTransporte), alignment: 'right' as const, bold: true }
		]);
	}
	if (sueldoVariable > 0) {
		datosManualesBody.push([
			{ text: 'Sueldo variable', color: '#666' },
			{ text: formatCurrency(sueldoVariable), alignment: 'right' as const, bold: true }
		]);
	}
	if (totalBase > 0) {
		datosManualesBody.push([
			{ text: 'Total base de liquidación', color: '#666' },
			{ text: formatCurrency(totalBase), alignment: 'right' as const, bold: true }
		]);
	}

	const hasFirmaPresignedUrl = !!(firmas && firmas[0]?.presignedUrl);
	console.log('[pdfPrima] Verificando firma. hasPresignedUrl:', hasFirmaPresignedUrl, 'firmasCount:', firmas?.length || 0);

	const content: any[] = [
		// Header
		{
			columns: [
				{
					stack: [
						{ text: empresa, style: 'header', color },
						{ text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
						{
							text: `DESPRENDIBLE DE PRIMA - ${mesLabel.toUpperCase()}`,
							fontSize: 10,
							color,
							bold: true,
							margin: [0, 8, 0, 0]
						}
					],
					width: '*'
				},
				...(logoBase64
					? [
							{
								image: logoBase64,
								width: 175,
								height: 100,
								alignment: 'right' as const,
								margin: [0, -15, -30, 0]
							}
						]
					: [])
			]
		},

		{ text: '', margin: [0, 15, 0, 0] },

		// Datos del empleado
		{
			table: {
				widths: ['*', '*'],
				body: [
					[{ text: 'Nombre' }, { text: conductorNombre, alignment: 'right' as const }],
					[{ text: 'C.C.' }, { text: conductorCedula, alignment: 'right' as const }],
					[{ text: 'Periodo' }, { text: mesLabel, alignment: 'right' as const }]
				]
			},
			layout: {
				hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
				vLineWidth: () => 1,
				hLineColor: () => '#E0E0E0',
				vLineColor: () => '#E0E0E0',
				paddingLeft: () => 5,
				paddingRight: () => 5,
				paddingTop: () => 4,
				paddingBottom: () => 4
			}
		},

		{ text: 'DETALLE DE PRIMA', bold: true, color, fontSize: 11, margin: [0, 15, 0, 6] },

		// Información destacada
		{
			table: {
				widths: ['*'],
				body: [
					[
						{
							stack: [
								{
									text: 'Información importante:',
									fontSize: 10,
									bold: true,
									margin: [0, 0, 0, 4]
								},
								{
									text: `Este desprendible corresponde al pago de la prima de servicios del periodo ${mesLabel}, conforme al registro independiente de primas. Los valores que se detallan a continuación fueron cancelados dentro de los términos legales establecidos, y se presentan en este documento únicamente para su información y registro.`,
									fontSize: 9,
									lineHeight: 1.4
								}
							]
						}
					]
				]
			},
			layout: {
				hLineWidth: () => 1,
				vLineWidth: () => 1,
				hLineColor: () => (esCotransmeq ? '#FFA726' : '#FFD700'),
				vLineColor: () => (esCotransmeq ? '#FFA726' : '#FFD700'),
				fillColor: () => (esCotransmeq ? '#FFF4E6' : '#FFF9E6'),
				paddingLeft: () => 10,
				paddingRight: () => 10,
				paddingTop: () => 8,
				paddingBottom: () => 8
			},
			margin: [0, 0, 0, 10]
		},

		// Detalle de prima
		...(detalleBody.length > 0
			? [
					{
						table: {
							widths: ['*', 'auto'],
							body: detalleBody
						},
						layout: {
							hLineWidth: (i: number, node: any) =>
								i === 0 || i === node.table.body.length ? 1 : 0.5,
							vLineWidth: () => 1,
							hLineColor: () => '#E0E0E0',
							vLineColor: () => '#E0E0E0',
							paddingLeft: () => 5,
							paddingRight: () => 5,
							paddingTop: () => 5,
							paddingBottom: () => 5
						}
					}
				]
			: []),

		// Detalle de datos manuales (si hay)
		...(datosManualesBody.length > 0
			? [
					{ text: 'DETALLE DEL DESPRENDIBLE', bold: true, color, fontSize: 11, margin: [0, 15, 0, 6] },
					{
						table: {
							widths: ['*', 'auto'],
							body: datosManualesBody
						},
						layout: {
							hLineWidth: (i: number, node: any) =>
								i === 0 || i === node.table.body.length ? 1 : 0.5,
							vLineWidth: () => 1,
							hLineColor: () => '#E0E0E0',
							vLineColor: () => '#E0E0E0',
							paddingLeft: () => 5,
							paddingRight: () => 5,
							paddingTop: () => 5,
							paddingBottom: () => 5
						}
					}
				]
			: []),

		// ============================================================
		// FOOTER CON FIRMA (reutilizada del desprendible de nómina)
		// ============================================================
		...(hasFirmaPresignedUrl
			? [
					...(await (async () => {
						try {
							console.log('[pdfPrima] Convirtiendo URL a base64...');
							const firmaBase64 = await imageToBase64Url(firmas[0].presignedUrl!);
							console.log('[pdfPrima] Base64 generado, longitud:', firmaBase64.length, 'starts:', firmaBase64.substring(0, 30));
							return [
								{
									stack: [
										{
											image: firmaBase64,
											width: 180,
											height: 50,
											alignment: 'center' as const,
											margin: [0, 30, 0, 0]
										},
										{
											canvas: [
												{
													type: 'line',
													x1: 0,
													y1: 0,
													x2: 190,
													y2: 0,
													lineWidth: 1,
													lineColor: '#BDBDBD'
												}
											],
											width: 190,
											alignment: 'center' as const,
											margin: [0, 2, 0, 0]
										},
										{
											text: 'Firma de recibido',
											fontSize: 10,
											color: '#2E8B57',
											alignment: 'center' as const,
											bold: true,
											margin: [0, 4, 0, 7]
										}
									],
									alignment: 'center' as const
								}
							];
						} catch (e) {
							console.error('[pdfPrima] Error al procesar la firma:', e);
							return [];
						}
					})())
				]
			: []),

		// Footer fecha
		{
			text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
			fontSize: 9,
			color: '#9E9E9E',
			alignment: 'center' as const,
			margin: [0, 20, 0, 0]
		}
	];

	const docDefinition: any = {
		pageSize: 'A4',
		pageMargins: [40, 30, 40, 30],
		content,
		styles: {
			header: { fontSize: 13, bold: true, margin: [0, 0, 0, 2] }
		},
		defaultStyle: { fontSize: 11 }
	};

	pdfMake.createPdf(docDefinition).open();
}
