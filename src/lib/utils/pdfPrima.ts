/**
 * Generador de PDF Desprendible/Liquidación de Prima usando pdfmake
 * Replica el formato físico de referencia: encabezado con logo + código/versión/fecha,
 * datos del conductor, tiempo trabajado, tabla de valores base, valor prima, firma y
 * cuadro de elaborado/aprobado.
 *
 * Ambientado a COTRANSMEQ (paleta naranja, empresa y NIT corporativos).
 *
 * Reutiliza la firma del desprendible de nómina (firmas con presignedUrl).
 */
import type { Prima, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64, imageToBase64Url } from '$lib/utils/pdfUtils';

function safeValue<T>(val: T | null | undefined, def: T): T {
	return val !== undefined && val !== null ? val : def;
}

function formatCurrencyPlain(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}

function formatDateDDMMYYYY(value: string | Date | null | undefined): string {
	if (!value) return '';
	const d = value instanceof Date ? value : new Date(value);
	if (isNaN(d.getTime())) return '';
	const day = String(d.getDate()).padStart(2, '0');
	const month = String(d.getMonth() + 1).padStart(2, '0');
	return `${day}/${month}/${d.getFullYear()}`;
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

function formatDateLong(value: string | Date | null | undefined): string {
	if (!value) return '';
	const d = value instanceof Date ? value : new Date(value);
	if (isNaN(d.getTime())) return '';
	const day = String(d.getDate()).padStart(2, '0');
	const month = String(d.getMonth() + 1).padStart(2, '0');
	return `${day}/${month}/${d.getFullYear()}`;
}

function computePeriodoFechas(mes: number, anio: number): { inicio: string; fin: string } {
	const inicio = new Date(anio, mes - 1, 1);
	const fin = new Date(anio, mes, 0);
	return {
		inicio: formatDateLong(inicio),
		fin: formatDateLong(fin)
	};
}

function getNombreCompleto(prima: Prima): string {
	// Acepta `conductor` (singular, usado en dashboard) y `conductores` (plural, devuelto por Prisma include)
	const c: any = (prima as any).conductor || (prima as any).conductores;
	if (!c) return 'N/A';
	return `${safeValue(c.nombre, '')} ${safeValue(c.apellido, '')}`.trim() || 'N/A';
}

function getCedulaConductor(prima: Prima): string {
	const c: any = (prima as any).conductor || (prima as any).conductores;
	return safeValue(c?.numero_identificacion || c?.cedula, '');
}

function getElaboradoPor(prima: Prima): string {
	const u: any = (prima as any).creado_por;
	if (!u) return '';
	return `${safeValue(u.nombre, '')} ${safeValue(u.apellido, '')}`.trim();
}

function getAprobadoPor(prima: Prima): string {
	const u: any = (prima as any).actualizado_por;
	if (!u) return '';
	return `${safeValue(u.nombre, '')} ${safeValue(u.apellido, '')}`.trim();
}

export async function generarPdfPrima(
	prima: Prima,
	firmas: FirmaConUrl[] = []
): Promise<void> {
	const pdfMake = (await import('pdfmake/build/pdfmake')).default;
	const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
	pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

	const esCotransmeq = true;
	const color = esCotransmeq ? '#FF9500' : '#2E8B57';

	let logoBase64: string | null = null;
	try {
		logoBase64 = await obtenerLogoBase64(esCotransmeq);
	} catch (e) {
		console.warn('[pdfPrima] No se pudo cargar el logo de Cotransmeq:', e);
	}

	const codigoFormato = 'RH-FR-30';
	const versionFormato = '1';
	const fechaFormato = '19/09/2025';

	const conductorNombre = getNombreCompleto(prima);
	const conductorCedula = getCedulaConductor(prima);

	const mes = Number(prima.mes) || 0;
	const anio = Number(prima.anio) || new Date().getFullYear();
	const fechaLiquidacion = formatDateDDMMYYYY(
		prima.created_at ? new Date(prima.created_at) : new Date(anio, mes, 0)
	);
	const { inicio: periodoInicio, fin: periodoFin } = computePeriodoFechas(mes, anio);

	const tiempoTrabajadoDias = Number(safeValue(prima.tiempo_trabajado_dias, 0));
	const sueldoBasico = Number(safeValue(prima.sueldo_basico, 0));
	const auxilioTransporte = Number(safeValue(prima.auxilio_transporte, 0));
	const sueldoVariable = Number(safeValue(prima.sueldo_variable, 0));
	const totalBaseLiquidacion = Number(safeValue(sueldoBasico + auxilioTransporte, 0));

	const valorPrimaPagado = Number(safeValue(prima.prima, 0));
	const valorPrimaPendiente = Number(safeValue(prima.prima_pendiente, 0));
	const valorPrimaServicio = valorPrimaPagado + valorPrimaPendiente;

	const elaboradoPor = getElaboradoPor(prima);
	const aprobadoPor = getAprobadoPor(prima);

	const firmaInput = firmas && firmas[0];
	// Preferir base64 que ya viene del backend (evita fetch al presignedUrl,
	// que puede fallar por CORS cuando el portal corre en otro origen).
	const hasFirmaBase64 = !!(firmaInput?.base64);
	const hasFirmaPresignedUrl = !!(firmaInput?.presignedUrl);

	let firmaBase64: string | null = null;
	if (hasFirmaBase64) {
		firmaBase64 = firmaInput!.base64!;
	} else if (hasFirmaPresignedUrl) {
		try {
			firmaBase64 = await imageToBase64Url(firmaInput!.presignedUrl!);
		} catch (e) {
			console.error('[pdfPrima] Error al procesar la firma:', e);
			firmaBase64 = null;
		}
	}

	const content: any[] = [
		// ============================================================
		// ENCABEZADO: Logo | Título | Caja Código/Versión/Fecha
		// ============================================================
		{
			table: {
				widths: ['25%', '50%', '25%'],
				body: [
					[
						...(logoBase64
							? [
									{
										image: 'logo',
										width: 110,
										height: 40,
										alignment: 'left' as const,
										margin: [0, 5, 0, 0]
									}
								]
							: [{ text: '' }]),
						{
							text: 'LIQUIDACIÓN PRIMA DE SERVICIO',
							bold: true,
							fontSize: 13,
							alignment: 'center' as const,
							margin: [0, 18, 0, 0]
						},
						{
							table: {
								widths: ['*', '*'],
								body: [
									[
										{ text: 'Código:', fontSize: 8, bold: true },
										{ text: codigoFormato, fontSize: 8, alignment: 'right' as const }
									],
									[
										{ text: 'Versión:', fontSize: 8, bold: true },
										{ text: versionFormato, fontSize: 8, alignment: 'right' as const }
									],
									[
										{ text: 'Fecha:', fontSize: 8, bold: true },
										{ text: fechaFormato, fontSize: 8, alignment: 'right' as const }
									]
								]
							},
							layout: {
								hLineWidth: () => 0.5,
								vLineWidth: () => 0.5,
								hLineColor: () => '#000000',
								vLineColor: () => '#000000',
								paddingLeft: () => 4,
								paddingRight: () => 4,
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
				{ text: fechaLiquidacion }
			],
			fontSize: 10,
			margin: [0, 0, 0, 8]
		},

		// ============================================================
		// NOMBRE / C.C. / PERIODO
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
										{ text: conductorNombre, fontSize: 10 }
									]
								},
								{
									columns: [
										{ text: 'C.C.:', bold: true, fontSize: 10, width: 100 },
										{ text: conductorCedula, fontSize: 10 }
									],
									margin: [0, 4, 0, 0]
								},
								{
									columns: [
										{ text: 'PERIODO:', bold: true, fontSize: 10, width: 100 },
										{
											text: `${periodoInicio}    a    ${periodoFin}`,
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
									text: `${tiempoTrabajadoDias}    DIAS`,
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
						{
							text: formatCurrencyPlain(sueldoBasico),
							fontSize: 10,
							alignment: 'right' as const
						}
					],
					[
						{ text: 'AUXILIO DE TRANSPORTE', fontSize: 10 },
						{
							text: formatCurrencyPlain(auxilioTransporte),
							fontSize: 10,
							alignment: 'right' as const
						}
					],
					[
						{ text: 'SUELDO VARIABLE', fontSize: 10 },
						{
							text: sueldoVariable > 0 ? formatCurrencyPlain(sueldoVariable) : '-',
							fontSize: 10,
							alignment: 'right' as const
						}
					],
					[
						{ text: 'TOTAL BASE DE LIQUIDACION', fontSize: 10, bold: true },
						{
							text: formatCurrencyPlain(totalBaseLiquidacion),
							fontSize: 10,
							alignment: 'right' as const,
							bold: true
						}
					],
					[{ text: '' }, { text: '' }],
					[
						{
							text: 'VALOR PRIMA DE SERVICIO',
							fontSize: 10,
							bold: true,
							color
						},
						{
							text: formatCurrencyPlain(valorPrimaServicio),
							fontSize: 10,
							alignment: 'right' as const,
							bold: true,
							color
						}
					]
				]
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === node.table.body.length ? 0.5 : 0.3,
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
								{
									text: 'RECIBI DE CONFORMIDAD:',
									bold: true,
									fontSize: 10,
									margin: [0, 0, 0, 4]
								},
								...(firmaBase64
									? [
											{
												image: 'firma',
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
						{ text: elaboradoPor || ' ', fontSize: 10, margin: [0, 25, 0, 0] },
						{ text: aprobadoPor || ' ', fontSize: 10, margin: [0, 25, 0, 0] }
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

	const images: Record<string, string> = {};
	if (logoBase64) images['logo'] = logoBase64;
	if (firmaBase64) images['firma'] = firmaBase64;

	const docDefinition: any = {
		pageSize: 'A4',
		pageMargins: [40, 30, 40, 30],
		content,
		images,
		defaultStyle: { fontSize: 11 }
	};

	pdfMake.createPdf(docDefinition).open();
}
