/**
 * Generador de PDF Desprendible de Nómina usando pdfmake
 * Portado de pdfMaker.tsx (@react-pdf/renderer) a pdfmake
 */
import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64 } from '$lib/utils/pdfUtils';

const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';

function formatCurrency(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return 'Sin fecha';
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) return 'Sin fecha';
	return date.toLocaleDateString('es-CO', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

function monthAndYear(dateStr: string | null | undefined): string {
	if (!dateStr) return '';
	const date = new Date(dateStr + 'T00:00:00');
	if (isNaN(date.getTime())) return '';
	return date
		.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
		.toUpperCase();
}

function safeValue(val: any, def: any = '') {
	return val !== undefined && val !== null ? val : def;
}

function parseValues(values: any): any[] {
	if (Array.isArray(values)) return values;
	if (typeof values === 'string') {
		try {
			const parsed = JSON.parse(values);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

export async function generarPdfDesprendible(
	item: Liquidacion,
	firmas: FirmaConUrl[] = []
): Promise<void> {
	// Importar pdfmake dinámicamente (solo en el cliente)
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

	// Recargos PAREX
	const recargosParex = item.recargos?.filter((r) => r.empresa_id === PAREX_EMPRESA_ID) || [];
	const totalRecargosParex = recargosParex.reduce((s, r) => s + Number(r.valor || 0), 0);
	const totalRecargosNormal = Number(item.total_recargos || 0) - totalRecargosParex;

	// Bonificaciones agrupadas
	const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> = {};
	if (item.bonificaciones && item.bonificaciones.length > 0) {
		item.bonificaciones.forEach((b) => {
			const qty = parseValues(b.values).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
			if (bonosAgrupados[b.name]) {
				bonosAgrupados[b.name].quantity += qty;
				bonosAgrupados[b.name].totalValue += qty * Number(b.value);
			} else {
				bonosAgrupados[b.name] = { name: b.name, quantity: qty, totalValue: qty * Number(b.value) };
			}
		});
	}

	const bonosFilas = Object.values(bonosAgrupados)
		.filter((b) => b.quantity > 0)
		.map((b) => [b.name, '', String(b.quantity), formatCurrency(b.totalValue)]);

	// Cantidad pernotes
	const cantidadPernotes =
		item.pernotes?.reduce((t, p) => t + (p.fechas ? p.fechas.length : 0), 0) || 0;

	// Tabla de conceptos adicionales
	const conceptosBody = [
		[
			{ text: 'CONCEPTO', style: 'tableHeader', color },
			{ text: 'OBSERVACIÓN', style: 'tableHeader', color },
			{ text: 'CANTIDAD', style: 'tableHeader', alignment: 'center' as const, color },
			{ text: 'VALOR', style: 'tableHeader', alignment: 'center' as const, color }
		],
		...bonosFilas.map((f) => [
			f[0],
			f[1],
			{ text: f[2], alignment: 'center' as const },
			{ text: f[3], alignment: 'right' as const }
		]),
		[
			'Recargos',
			{ text: 'Ver recargos detallados', fontSize: 9, color: '#666' },
			{ text: '', alignment: 'center' as const },
			{ text: formatCurrency(totalRecargosNormal), alignment: 'right' as const }
		],
		...(recargosParex.length > 0
			? [
					[
						'Recargos PAREX',
						{ text: 'Ver recargos detallados', fontSize: 9, color: '#666' },
						{ text: '', alignment: 'center' as const },
						{ text: formatCurrency(totalRecargosParex), alignment: 'right' as const }
					]
				]
			: []),
		[
			'Pernotes',
			{ text: '', fontSize: 9 },
			{ text: String(cantidadPernotes), alignment: 'center' as const },
			{ text: formatCurrency(item.total_pernotes || 0), alignment: 'right' as const }
		]
	];

	// Conceptos adicionales
	const conceptosAdicionalesBody = parseValues(item.conceptos_adicionales).map((c: any) => [
		'Ajuste adicional',
		{ text: c.observaciones || c.concepto || '', fontSize: 9 },
		{ text: '1', alignment: 'center' as const },
		{
			text: `${Number(c.valor) < 0 ? '' : '+'}${formatCurrency(c.valor)}`,
			alignment: 'right' as const,
			color: Number(c.valor) < 0 ? '#e60f0f' : '#2E8B57'
		}
	]);

	// Sueldo total ajustado
	const sueldoBase = Number(safeValue(item.sueldo_total, 0));
	const intereses = Number(safeValue(item.interes_cesantias, 0));
	const primaPend = Number(safeValue(item.prima_pendiente, 0));
	const sueldoAjustado = sueldoBase - intereses - primaPend;

	// Construir contenido
	const content: any[] = [
		// Header
		{
			columns: [
				{
					stack: [
						{ text: empresa, style: 'header', color },
						{ text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
						{
							text: `COMPROBANTE DE NOMINA - ${monthAndYear(item.periodo_fin)}`,
							fontSize: 10,
							color,
							bold: true,
							margin: [0, 8, 0, 0]
						},
						{
							text: `BÁSICO CORRESPONDIENTE AL MES DE ${monthAndYear(item.periodo_fin)}`,
							fontSize: 10,
							color,
							bold: true,
							margin: [0, 2, 0, 0]
						}
					],
					width: '*'
				},
				...(logoBase64
					? [{ image: logoBase64, width: 175, height: 100, alignment: 'right' as const, margin: [0, -15, -30, 0] }]
					: [])
			]
		},

		// Datos del empleado
		{ text: '', margin: [0, -10, 0, 0] },
		{
			table: {
				widths: ['*', '*'],
				body: [
					[
						{ text: 'Nombre', bold: false },
						{ text: conductorNombre, alignment: 'right' as const }
					],
					[
						{ text: 'C.C.', bold: false },
						{ text: conductorCedula, alignment: 'right' as const }
					],
					[
						{ text: 'Días laborados', bold: false },
						{
							text: String(safeValue(item.dias_laborados, 0)),
							alignment: 'right' as const
						}
					],
					[
						{ text: 'Salario devengado', bold: false },
						{
							text: formatCurrency(item.salario_devengado),
							color: '#007AFF',
							alignment: 'right' as const
						}
					],
					[
						{ text: 'Auxilio de transporte', bold: false },
						{
							text: formatCurrency(item.auxilio_transporte),
							color: '#666',
							alignment: 'right' as const
						}
					],
					...(Number(safeValue(item.valor_incapacidad, 0)) > 0
						? [
								[
									{ text: 'Remuneración por incapacidad', bold: false },
									{
										text: formatCurrency(item.valor_incapacidad),
										color,
										alignment: 'right' as const
									}
								]
							]
						: []),
					[
						{ text: 'Ajuste villanueva', bold: false },
						{
							columns: [
								{
									text: `${safeValue(item.dias_laborados_villanueva, 0)} días`,
									width: 'auto'
								},
								{
									text: formatCurrency(item.ajuste_salarial || 0),
									color: '#FF9500',
									alignment: 'right' as const,
									width: '*'
								}
							]
						}
					]
				]
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.body.length ? 1 : 0.5,
				vLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.widths.length ? 1 : 0,
				hLineColor: () => '#E0E0E0',
				vLineColor: () => '#E0E0E0',
				paddingLeft: () => 5,
				paddingRight: () => 5,
				paddingTop: () => 4,
				paddingBottom: () => 4
			}
		},

		// Título ADICIONALES
        {
            text: `ADICIONALES ${formatDate(item.periodo_inicio)} - ${formatDate(item.periodo_fin)}`.toUpperCase(),
            alignment: 'center' as const,
            bold: true,
            color,
            fontSize: 12,
            margin: [0, 15, 0, 10]
        },

		// Tabla de conceptos
		{
			table: {
				headerRows: 1,
				widths: ['30%', '40%', '15%', '15%'],
				body: conceptosBody
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
				paddingBottom: () => 4,
				fillColor: (row: number) => (row === 0 ? `${color}10` : null)
			}
		}
	];

	// Conceptos adicionales
	if (conceptosAdicionalesBody.length > 0) {
		content.push(
			{ text: 'CONCEPTOS ADICIONALES', bold: true, color, fontSize: 11, margin: [0, 12, 0, 6] },
			{
				table: {
					widths: ['30%', '40%', '15%', '15%'],
					body: conceptosAdicionalesBody
				},
				layout: {
					hLineWidth: () => 0.5,
					vLineWidth: () => 1,
					hLineColor: () => '#E0E0E0',
					vLineColor: () => '#E0E0E0',
					paddingLeft: () => 5,
					paddingRight: () => 5,
					paddingTop: () => 4,
					paddingBottom: () => 4
				}
			}
		);
	}

	// Deducciones
	const deduccionesBody: any[][] = [
		[
			{ text: 'Salud' },
			{ text: formatCurrency(item.salud), color: '#e60f0f', alignment: 'right' as const }
		],
		[
			{ text: 'Pensión' },
			{ text: formatCurrency(item.pension), color: '#e60f0f', alignment: 'right' as const }
		]
	];
	if (item.anticipos && item.anticipos.length > 0) {
		deduccionesBody.push([
			{ text: 'Anticipos' },
			{
				text: formatCurrency(item.total_anticipos),
				color: '#e60f0f',
				alignment: 'right' as const
			}
		]);
	}

	content.push(
		{ text: 'DEDUCCIONES', bold: true, color, fontSize: 11, margin: [0, 12, 0, 6] },
		{
			table: {
				widths: ['*', '*'],
				body: deduccionesBody
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.body.length ? 1 : 0.5,
				vLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.widths.length ? 1 : 0,
				hLineColor: () => '#E0E0E0',
				vLineColor: () => '#E0E0E0',
				paddingLeft: () => 5,
				paddingRight: () => 5,
				paddingTop: () => 4,
				paddingBottom: () => 4
			}
		}
	);

	// Resumen final
	const resumenBody: any[][] = [];
	if (Number(safeValue(item.total_vacaciones, 0)) > 0) {
		resumenBody.push([
			{ text: 'Vacaciones' },
			{
				text: formatCurrency(item.total_vacaciones),
				color: '#FF9500',
				alignment: 'right' as const
			}
		]);
	}
	resumenBody.push([
		{ text: 'Salario total', bold: true },
		{
			text: formatCurrency(sueldoAjustado),
			bold: true,
			color,
			alignment: 'right' as const
		}
	]);

	content.push(
		{ text: 'RESUMEN FINAL', bold: true, color, fontSize: 11, margin: [0, 12, 0, 6] },
		{
			table: {
				widths: ['*', '*'],
				body: resumenBody
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.body.length ? 1 : 0.5,
				vLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.widths.length ? 1 : 0,
				hLineColor: () => '#E0E0E0',
				vLineColor: () => '#E0E0E0',
				paddingLeft: () => 5,
				paddingRight: () => 5,
				paddingTop: () => 4,
				paddingBottom: () => 4
			}
		}
	);

	// Footer
	content.push({
		text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
		fontSize: 9,
		color: '#9E9E9E',
		alignment: 'center' as const,
		margin: [0, 30, 0, 0]
	});

	const docDefinition: any = {
		pageSize: 'A4',
		pageMargins: [40, 30, 40, 30],
		content,
		styles: {
			header: {
				fontSize: 13,
				bold: true,
				margin: [0, 0, 0, 2]
			},
			tableHeader: {
				bold: true,
				fontSize: 10
			}
		},
		defaultStyle: {
			fontSize: 11
		}
	};

	pdfMake.createPdf(docDefinition).open();
}
