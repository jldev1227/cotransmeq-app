/**
 * Template del content de pdfmake para el Desprendible/Liquidación de Prima
 * replicando el formato físico de la imagen de referencia:
 * - Encabezado con logo + título + caja Código/Versión/Fecha
 * - FECHA
 * - NOMBRE / PERIODO
 * - TIEMPO TRABAJADO
 * - Tabla de valores (Sueldo básico, Aux. transporte, Sueldo variable, Total base, Valor prima)
 * - RECIBI DE CONFORMIDAD (firma)
 * - ELABORÓ / APROBÓ
 *
 * Reemplaza las variables marcadas con // <-- VAR por tus valores reales.
 */

const content: any[] = [
	// ============================================================
	// ENCABEZADO: Logo | Título | Caja Código/Versión/Fecha
	// ============================================================
	{
		table: {
			widths: ['25%', '50%', '25%'],
			body: [
				[
					// Logo
					{
						image: logoBase64, // <-- VAR: logoBase64
						width: 90,
						height: 55,
						alignment: 'left' as const,
						margin: [0, 5, 0, 0]
					},
					// Título centrado
					{
						text: 'LIQUIDACIÓN PRIMA DE SERVICIO',
						bold: true,
						fontSize: 13,
						alignment: 'center' as const,
						margin: [0, 18, 0, 0]
					},
					// Caja Código/Versión/Fecha (sub-tabla)
					{
						table: {
							widths: ['50%', '50%'],
							body: [
								[
									{ text: 'Código:', fontSize: 8, bold: true },
									{ text: codigoFormato, fontSize: 8 } // <-- VAR: ej. 'RH-FR-30'
								],
								[
									{ text: 'Versión:', fontSize: 8, bold: true },
									{ text: versionFormato, fontSize: 8 } // <-- VAR: ej. '1'
								],
								[
									{ text: 'Fecha:', fontSize: 8, bold: true },
									{ text: fechaFormato, fontSize: 8 } // <-- VAR: ej. '23/04/2024'
								]
							]
						},
						layout: {
							hLineWidth: () => 0.5,
							vLineWidth: () => 0.5,
							hLineColor: () => '#000000',
							vLineColor: () => '#000000',
							paddingLeft: () => 3,
							paddingRight: () => 3,
							paddingTop: () => 2,
							paddingBottom: () => 2
						}
					}
				]
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000'
		}
	},

	{ text: '', margin: [0, 10, 0, 0] },

	// ============================================================
	// FECHA
	// ============================================================
	{
		text: [
			{ text: 'FECHA:        ', bold: true },
			{ text: fechaLiquidacion } // <-- VAR: ej. '30/12/2025'
		],
		fontSize: 10,
		margin: [0, 0, 0, 8]
	},

	// ============================================================
	// NOMBRE / PERIODO
	// ============================================================
	{
		table: {
			widths: ['*'],
			body: [
				[
					{
						stack: [
							{
								columns: [
									{ text: 'NOMBRE:', bold: true, fontSize: 10, width: 100 },
									{ text: nombreCompleto, fontSize: 10 } // <-- VAR: nombre + apellido
								]
							},
							{
								columns: [
									{ text: 'PERIODO:', bold: true, fontSize: 10, width: 100 },
									{
										text: `${periodoInicio}    a    ${periodoFin}`, // <-- VAR
										fontSize: 10
									}
								],
								margin: [0, 4, 0, 0]
							}
						]
					}
				]
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000',
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 6,
			paddingBottom: () => 6
		}
	},

	{ text: '', margin: [0, 8, 0, 0] },

	// ============================================================
	// TIEMPO TRABAJADO
	// ============================================================
	{
		table: {
			widths: ['*'],
			body: [
				[
					{
						columns: [
							{ text: 'TIEMPO TRABAJADO', bold: true, fontSize: 10 },
							{
								text: `${tiempoTrabajadoDias}    DIAS`, // <-- VAR
								fontSize: 10,
								alignment: 'right' as const
							}
						]
					}
				]
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000',
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 8,
			paddingBottom: () => 8
		}
	},

	{ text: '', margin: [0, 8, 0, 0] },

	// ============================================================
	// TABLA DE VALORES
	// ============================================================
	{
		table: {
			widths: ['*', 'auto'],
			body: [
				[
					{ text: 'SUELDO BASICO:', fontSize: 10 },
					{ text: formatCurrencyPlain(sueldoBasico), fontSize: 10, alignment: 'right' as const }
				],
				[
					{ text: 'AUXILIO DE TRANSPORTE', fontSize: 10 },
					{ text: formatCurrencyPlain(auxilioTransporte), fontSize: 10, alignment: 'right' as const }
				],
				[
					{ text: 'SUELDO VARIABLE', fontSize: 10 },
					{ text: sueldoVariable > 0 ? formatCurrencyPlain(sueldoVariable) : '-', fontSize: 10, alignment: 'right' as const }
				],
				[
					{ text: 'TOTAL BASE DE LIQUIDACION', fontSize: 10, bold: true },
					{ text: formatCurrencyPlain(totalBaseLiquidacion), fontSize: 10, alignment: 'right' as const, bold: true }
				],
				[
					{ text: '' },
					{ text: '' }
				],
				[
					{ text: 'VALOR PRIMA DE SERVICIO', fontSize: 10, bold: true },
					{ text: formatCurrencyPlain(valorPrimaServicio), fontSize: 10, alignment: 'right' as const, bold: true }
				]
			]
		},
		layout: {
			hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.5 : 0.3),
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000',
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 5,
			paddingBottom: () => 5
		}
	},

	{ text: '', margin: [0, 10, 0, 0] },

	// ============================================================
	// RECIBI DE CONFORMIDAD (firma)
	// ============================================================
	{
		table: {
			widths: ['*'],
			body: [
				[
					{
						stack: [
							{ text: 'RECIBI DE CONFORMIDAD:', bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
							...(firmaBase64 // <-- VAR: base64 de la firma (await imageToBase64Url)
								? [
										{
											image: firmaBase64,
											width: 160,
											height: 45,
											alignment: 'left' as const,
											margin: [0, 6, 0, 0]
										}
									]
								: [{ text: ' ', margin: [0, 30, 0, 0] }])
						]
					}
				]
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000',
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 6,
			paddingBottom: () => 6
		}
	},

	{ text: '', margin: [0, 8, 0, 0] },

	// ============================================================
	// ELABORÓ / APROBÓ
	// ============================================================
	{
		table: {
			widths: ['50%', '50%'],
			body: [
				[
					{ text: 'ELABORÓ:', bold: true, fontSize: 10 },
					{ text: 'APROBÓ:', bold: true, fontSize: 10 }
				],
				[
					{ text: elaboradoPor || ' ', fontSize: 10, margin: [0, 25, 0, 0] }, // <-- VAR opcional
					{ text: aprobadoPor || ' ', fontSize: 10, margin: [0, 25, 0, 0] } // <-- VAR opcional
				]
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => '#000000',
			vLineColor: () => '#000000',
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 6,
			paddingBottom: () => 6
		}
	}
];

// Helper que necesitas agregar (formato "2.080.538" sin símbolo $):
function formatCurrencyPlain(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}
