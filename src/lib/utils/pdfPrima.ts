/**
 * Generador de PDF Desprendible de Prima usando pdfmake
 * Portado de pdfMakerPrima.tsx
 */
import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64 } from '$lib/utils/pdfUtils';

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

export async function generarPdfPrima(
	item: Liquidacion,
	firmas: FirmaConUrl[] = []
): Promise<void> {
	const pdfMake = (await import('pdfmake/build/pdfmake')).default;
	const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
	pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

	const esCotransmeq = item.es_cotransmeq || false;
	const color = esCotransmeq ? '#FF9500' : '#2E8B57';
	const empresa = esCotransmeq
		? 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S'
		: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S';
	const nit = esCotransmeq ? '901983227' : '901528440-3';

	const conductorNombre = `${safeValue(item.conductor?.nombre, 'N/A')}`;
	const conductorCedula = safeValue((item.conductor as any)?.cedula, 'N/A');

	// Cargar logo
	const logoBase64 = await obtenerLogoBase64(esCotransmeq);

	const prima = Number(safeValue(item.prima, 0));
	const primaPendiente = Number(safeValue(item.prima_pendiente, 0));

	// Filas de detalle de prima
	const detalleBody: any[][] = [];
	if (prima > 0) {
		detalleBody.push([
			{
				stack: [
					{ text: 'Prima diciembre 2025' },
					{
						text: 'Valor pagado en periodo anterior',
						fontSize: 8,
						color: '#666',
						italics: true
					}
				]
			},
			{ text: formatCurrency(prima), color, alignment: 'right' as const, bold: true }
		]);
	}
	if (primaPendiente > 0) {
		detalleBody.push([
			{
				stack: [
					{ text: 'Ajuste prima diciembre 2025 (Parex)' },
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

	const content: any[] = [
		// Header
		{
			columns: [
				{
					stack: [
						{ text: empresa, style: 'header', color },
						{ text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
						{
							text: 'DESPRENDIBLE DE PRIMA - DICIEMBRE 2025',
							fontSize: 10,
							color,
							bold: true,
							margin: [0, 8, 0, 0]
						}
					],
					width: '*'
				},
				...(logoBase64
					? [{ image: logoBase64, width: 175, height: 100, alignment: 'right' as const, margin: [0, -15, -30, 0] }]
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
					[{ text: 'Periodo' }, { text: 'Diciembre 2025', alignment: 'right' as const }]
				]
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.body.length ? 1 : 0.5,
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
									text: 'Este desprendible corresponde al pago de la prima de servicios del segundo semestre del año 2025. Los valores que se detallan a continuación fueron cancelados en el mes de diciembre de 2025, dentro de los términos legales establecidos, y se presentan en este documento únicamente para su información y registro.',
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

		// Footer
		{
			text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
			fontSize: 9,
			color: '#9E9E9E',
			alignment: 'center' as const,
			margin: [0, 40, 0, 0]
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
