/**
 * Generador de PDF Desprendible de Nómina usando pdfmake
 * COTRANSMEQ - Replicado de Cotransmeq con branding Cotransmeq
 */
import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64 } from '$lib/utils/pdfUtils';

const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
const EMPRESA = 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S';
const NIT = '901983227';
const COLOR = '#EA580C';
const COLOR_BG = '#FFF7ED';

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
	// Agregar T12:00:00Z para evitar desfase de -1 día por timezone
	const safe = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00Z';
	const date = new Date(safe);
	if (isNaN(date.getTime())) return 'Sin fecha';
	return date.toLocaleDateString('es-CO', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
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

/**
 * Agrupa fechas consecutivas en rangos legibles
 * Ej: ["2024-01-01","2024-01-02","2024-01-03","2024-01-10"] → ["1-3 ene", "10 ene"]
 */
function agruparFechasConsecutivas(fechas: string[]): string[] {
	if (!fechas || fechas.length === 0) return [];

	const sorted = [...fechas].sort();
	const rangos: string[] = [];
	let inicio = sorted[0];
	let fin = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		const current = new Date(sorted[i] + 'T00:00:00');
		const prev = new Date(fin + 'T00:00:00');
		const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		if (diff === 1) {
			fin = sorted[i];
		} else {
			rangos.push(formatearRango(inicio, fin));
			inicio = sorted[i];
			fin = sorted[i];
		}
	}
	rangos.push(formatearRango(inicio, fin));

	return rangos;
}

function formatearRango(inicio: string, fin: string): string {
	const dInicio = new Date(inicio + 'T00:00:00');
	const dFin = new Date(fin + 'T00:00:00');
	const mesInicio = dInicio.toLocaleDateString('es-CO', { month: 'short' });

	if (inicio === fin) {
		return `${dInicio.getDate()} ${mesInicio}`;
	}

	const mesFin = dFin.toLocaleDateString('es-CO', { month: 'short' });
	if (mesInicio === mesFin) {
		return `${dInicio.getDate()}-${dFin.getDate()} ${mesInicio}`;
	}
	return `${dInicio.getDate()} ${mesInicio} - ${dFin.getDate()} ${mesFin}`;
}

/**
 * Calcula la diferencia en días entre dos fechas
 */
function obtenerDiferenciaDias(startStr: string, endStr: string): number {
	try {
		const start = new Date(startStr + 'T00:00:00');
		const end = new Date(endStr + 'T00:00:00');
		if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
		return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
	} catch {
		return 0;
	}
}

/**
 * Convierte una URL de imagen a base64 data URL
 */
async function imageToBase64Url(url: string): Promise<string> {
	// Si ya es un data URL base64, retornarlo directamente
	if (url.startsWith('data:')) {
		return url;
	}
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

export async function generarPdfDesprendible(
	item: Liquidacion,
	firmas: FirmaConUrl[] = [],
	recargosData: any = null
): Promise<void> {
	// Importar pdfmake dinámicamente (solo en el cliente)
	const pdfMake = (await import('pdfmake/build/pdfmake')).default;
	const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
	pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

	const color = COLOR;
	const colorBg = COLOR_BG;
	const empresa = EMPRESA;
	const nit = NIT;

	const conductorNombre = `${safeValue(item.conductor?.nombre, 'N/A')}`;
	const conductorCedula = safeValue(
		(item.conductor as any)?.cedula || (item.conductor as any)?.numero_identificacion,
		'N/A'
	);

	// Cargar logo
	const logoBase64 = await obtenerLogoBase64();

	// Recargos PAREX: sumar todos los recargos (manuales + automáticos) guardados con empresa PAREX
	// item.recargos ya contiene ambos tipos (es_automatico=false y es_automatico=true)
	// NO sumar desde recargosData.planillas porque eso duplicaría los automáticos
	const recargosParex = item.recargos?.filter((r) => r.empresa_id === PAREX_EMPRESA_ID) || [];
	const totalRecargosParex = recargosParex.reduce((s, r) => s + Number(r.valor || 0), 0);
	const hayRecargosParex = totalRecargosParex > 0;

	const disponibilidadVal = Number(safeValue(item.disponibilidad, 0));
	
	// Total final después de disponibilidad
	const totalRecargos = Number(item.total_recargos || 0);
	const totalRecargosFinal = Math.max(0, totalRecargos - disponibilidadVal);
	
	// Separaciones
	const totalRecargosNoParex = totalRecargos - totalRecargosParex;

	// Separar "Otros" (no-PAREX) y restar disponibilidad
	// Si "Otros" tiene suficiente, se resta de ahí. Si no alcanza, el sobrante se resta de PAREX.
	const recargosNoParex = Number(item.total_recargos || 0) - totalRecargosParex;
	const otrosMenosDisp = recargosNoParex - disponibilidadVal;
	const totalRecargosNormal = Math.max(0, otrosMenosDisp);
	// Si "Otros" no alcanzó para absorber toda la disponibilidad, el resto se resta de PAREX
	const disponibilidadSobrante = otrosMenosDisp < 0 ? Math.abs(otrosMenosDisp) : 0;
	const totalRecargosParexFinal = totalRecargosParex - disponibilidadSobrante;


	// Bonificaciones agrupadas
	const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> =
		{};
	if (item.bonificaciones && item.bonificaciones.length > 0) {
		item.bonificaciones.forEach((b) => {
			const qty = parseValues(b.values).reduce(
				(s: number, v: any) => s + (v.quantity || 0),
				0
			);
			if (bonosAgrupados[b.name]) {
				bonosAgrupados[b.name].quantity += qty;
				bonosAgrupados[b.name].totalValue += qty * Number(b.value);
			} else {
				bonosAgrupados[b.name] = {
					name: b.name,
					quantity: qty,
					totalValue: qty * Number(b.value)
				};
			}
		});
	}

	const bonosFilas = Object.values(bonosAgrupados)
		.filter((b) => b.quantity > 0)
		.map((b) => [
			{ text: b.name || '', style: 'valueText' },
			{ text: '', style: 'valueText' },
			{ text: String(b.quantity), alignment: 'center' as const, style: 'valueText' },
			{ text: formatCurrency(b.totalValue), alignment: 'center' as const, style: 'valueText' }
		]);

	// Pernotes - fechas agrupadas (igual que pdfMaker)
	// Parsear fechas defensivamente: puede venir como string JSON o como array
	const parseFechas = (fechas: any): string[] => {
		if (Array.isArray(fechas)) return fechas;
		if (typeof fechas === 'string') {
			try {
				const parsed = JSON.parse(fechas);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}
		return [];
	};

	const cantidadPernotes =
		item.pernotes?.reduce((t, p) => t + parseFechas(p.fechas).length, 0) || 0;

	let pernoteFechasTexto = '';
	if (item.pernotes && item.pernotes.length > 0) {
		try {
			const todasLasFechas: string[] = [];
			item.pernotes.forEach((pernote) => {
				const fechas = parseFechas(pernote.fechas);
				if (fechas.length > 0) {
					todasLasFechas.push(...fechas);
				}
			});
			const rangos = agruparFechasConsecutivas(todasLasFechas);
			pernoteFechasTexto = rangos.join(', ');
		} catch (error: any) {
			pernoteFechasTexto = error.message || 'Error al recolectar fechas pernoctes';
		}
	}

	// ============================================================
	// TABLA DE CONCEPTOS (4 columnas: 30%, 40%, 15%, 15%)
	// ============================================================
	const conceptosBody: any[][] = [
		// Header
		[
			{ text: 'CONCEPTO', bold: true, fontSize: 10, color },
			{ text: 'OBSERVACIÓN', bold: true, fontSize: 10, color },
			{ text: 'CANTIDAD', bold: true, fontSize: 10, color, alignment: 'center' as const },
			{ text: 'VALOR', bold: true, fontSize: 10, color, alignment: 'center' as const }
		],
		// Bonificaciones
		...bonosFilas,
		// Recargos (llamado "Otros" como en pdfMaker)
		[
			{ text: 'Otros', style: 'valueText' },
			{ text: 'Ver recargos detallados más adelante', fontSize: 10, color: '#666' },
			{ text: ' ', alignment: 'center' as const },
			{
				text: formatCurrency(totalRecargosNormal),
				alignment: 'center' as const,
				style: 'valueText'
			}
		],
		// Recargos PAREX (si hay — manuales + planillas)
		...(hayRecargosParex
			? [
					[
						{ text: 'Recargos PAREX', style: 'valueText' },
						{
							text: 'Ver recargos detallados más adelante',
							fontSize: 10,
							color: '#666'
						},
						{ text: ' ', alignment: 'center' as const },
						{
							text: formatCurrency(totalRecargosParexFinal),
							alignment: 'center' as const,
							style: 'valueText'
						}
					]
				]
			: []),
		// Pernotes con fechas agrupadas
		[
			{ text: 'Pernoctes', style: 'valueText' },
			{ text: pernoteFechasTexto, fontSize: 10, color: '#666' },
			{
				text: String(cantidadPernotes),
				alignment: 'center' as const,
				style: 'valueText'
			},
			{
				text: formatCurrency(item.total_pernotes || 0),
				alignment: 'center' as const,
				style: 'valueText'
			}
		]
	];

	// ============================================================
	// DATOS DEL EMPLEADO (tabla label-value con colores iguales a pdfMaker)
	// ============================================================
	const empleadoBody: any[][] = [
		[
			{ text: 'Nombre' },
			{ text: conductorNombre, alignment: 'right' as const }
		],
		[
			{ text: 'C.C.' },
			{ text: conductorCedula, alignment: 'right' as const }
		],
		[
			{ text: 'Días laborados' },
			{
				text: String(safeValue(item.dias_laborados, 0)),
				alignment: 'right' as const
			}
		],
		[
			{ text: 'Salario devengado' },
			{
				text: formatCurrency(item.salario_devengado),
				color: '#007AFF',
				alignment: 'right' as const
			}
		],
		[
			{ text: 'Auxilio de transporte' },
			{
				text: formatCurrency(item.auxilio_transporte),
				color: '#00000074',
				alignment: 'right' as const
			}
		]
	];

	// Incapacidad (si > 0) - con días y valor en color verde
	if (Number(safeValue(item.valor_incapacidad, 0)) > 0) {
		const diasIncapacidad =
			item.periodo_incapacidad_inicio && item.periodo_incapacidad_fin
				? `${obtenerDiferenciaDias(item.periodo_incapacidad_inicio, item.periodo_incapacidad_fin)} días`
				: item.periodo_start_incapacidad && item.periodo_end_incapacidad
					? `${obtenerDiferenciaDias(item.periodo_start_incapacidad, item.periodo_end_incapacidad)} días`
					: '-';
		empleadoBody.push([
			{ text: 'Remuneración por incapacidad' },
			{
				columns: [
					{ text: diasIncapacidad, width: 'auto' },
					{
						text: formatCurrency(item.valor_incapacidad),
						color,
						alignment: 'right' as const,
						width: '*'
					}
				]
			}
		]);
	}

	// Ajuste salarial (siempre se muestra)
	empleadoBody.push([
		{ text: 'Ajuste salarial' },
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
	]);

	// ============================================================
	// CONSTRUIR CONTENIDO
	// ============================================================
	const content: any[] = [
		// Header
		{
			columns: [
				{
					stack: [
						{
							text: empresa,
							style: 'header',
							color,
							bold: true,
							fontSize: 13,
							maxWidth: 300
						},
						{ text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
						{
							text: `COMPROBANTE DE NOMINA - ${monthAndYear(item.periodo_fin)}`,
							fontSize: 10,
							color,
							bold: true,
							margin: [0, 10, 0, 0]
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
					? [
							{
								image: logoBase64,
								width: 175,
								height: 100,
								alignment: 'right' as const,
								margin: [0, -15, -20, 0]
							}
						]
					: [])
			],
			margin: [0, 0, 0, 20]
		},

		// Datos del empleado
		{
			table: {
				widths: ['*', '*'],
				body: empleadoBody
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
			margin: [0, 12, 0, 12]
		},

		// Tabla de conceptos (4 columnas: 30%, 40%, 15%, 15%)
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
				paddingTop: () => 5,
				paddingBottom: () => 5,
				fillColor: (row: number) => (row === 0 ? colorBg : null)
			}
		}
	];

	// ============================================================
	// CONCEPTOS ADICIONALES (si hay) - layout igual a pdfMaker
	// ============================================================
	const conceptosAdicionales = parseValues(item.conceptos_adicionales);
	if (conceptosAdicionales.length > 0) {
		const conceptosAdicionalesBody = conceptosAdicionales.map((c: any) => {
			const isNegative = Number(c.valor) < 0;
			return [
				{ text: c.observaciones || c.concepto || '', fontSize: 10 },
				{ text: '1', alignment: 'center' as const },
				{
					text: `${isNegative ? '' : '+'}${formatCurrency(c.valor)}`,
					alignment: 'center' as const,
					color: isNegative ? '#e60f0f' : color
				}
			];
		});

		content.push(
			{
				text: 'CONCEPTOS ADICIONALES',
				bold: true,
				color,
				fontSize: 11,
				margin: [0, 15, 0, 6]
			},
			{
				table: {
					widths: ['40%', '15%', '15%'],
					body: conceptosAdicionalesBody
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
		);
	}

	// ============================================================
	// DISPONIBILIDAD (solo si tiene valor > 0)
	// ============================================================
	if (disponibilidadVal > 0) {
		content.push(
			{
				text: 'DISPONIBILIDAD',
				bold: true,
				color,
				fontSize: 11,
				margin: [0, 15, 0, 6]
			},
			{
				table: {
					widths: ['*', '*'],
					body: [
						[
							{ text: 'Disponibilidad' },
							{
								text: formatCurrency(disponibilidadVal),
								alignment: 'right' as const,
								color
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
			}
		);
	}

	// ============================================================
	// DEDUCCIONES
	// ============================================================
	const deduccionesBody: any[][] = [
		[
			{ text: 'Salud' },
			{
				text: formatCurrency(item.salud),
				color: '#1e40af',
				alignment: 'right' as const
			}
		],
		[
			{ text: 'Pensión' },
			{
				text: formatCurrency(item.pension),
				color: '#1e40af',
				alignment: 'right' as const
			}
		]
	];

	if (item.anticipos && item.anticipos.length > 0) {
		deduccionesBody.push([
			{ text: 'Anticipos' },
			{
				text: formatCurrency(item.total_anticipos),
				color: '#1e40af',
				alignment: 'right' as const
			}
		]);
	}

	content.push(
		{
			text: 'DEDUCCIONES',
			bold: true,
			color,
			fontSize: 11,
			margin: [0, 15, 0, 6]
		},
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

	// ============================================================
	// RESUMEN FINAL
	// ============================================================
	const resumenBody: any[][] = [];

	// Vacaciones con días (igual que pdfMaker)
	if (Number(safeValue(item.total_vacaciones, 0)) > 0) {
		const diasVacaciones =
			item.periodo_vacaciones_inicio && item.periodo_vacaciones_fin
				? obtenerDiferenciaDias(
						item.periodo_vacaciones_inicio,
						item.periodo_vacaciones_fin
					)
				: item.periodo_start_vacaciones && item.periodo_end_vacaciones
					? obtenerDiferenciaDias(
							item.periodo_start_vacaciones,
							item.periodo_end_vacaciones
						)
					: 0;

		resumenBody.push([
			{ text: 'Vacaciones' },
			{ text: `${diasVacaciones} días` },
			{
				text: formatCurrency(item.total_vacaciones),
				color: '#FF9500',
				alignment: 'right' as const
			}
		]);
	}

	// Sueldo total ajustado
	const sueldoBase = Number(safeValue(item.sueldo_total, 0));
	const intereses = Number(safeValue(item.interes_cesantias, 0));
	const primaPend = Number(safeValue(item.prima_pendiente, 0));
	const sueldoAjustado = sueldoBase - intereses - primaPend;

	// Si hay vacaciones, usar 3 columnas para alinear
	if (resumenBody.length > 0) {
		resumenBody.push([
			{ text: 'Salario total', bold: true },
			{ text: '' },
			{
				text: formatCurrency(sueldoAjustado),
				bold: true,
				color,
				alignment: 'right' as const
			}
		]);

		content.push(
			{
				text: 'RESUMEN FINAL',
				bold: true,
				color,
				fontSize: 11,
				margin: [0, 15, 0, 6]
			},
			{
				table: {
					widths: ['*', 'auto', 'auto'],
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
	} else {
		// Sin vacaciones: 2 columnas
		content.push(
			{
				text: 'RESUMEN FINAL',
				bold: true,
				color,
				fontSize: 11,
				margin: [0, 15, 0, 6]
			},
			{
				table: {
					widths: ['*', '*'],
					body: [
						[
							{ text: 'Salario total', bold: true },
							{
								text: formatCurrency(sueldoAjustado),
								bold: true,
								color,
								alignment: 'right' as const
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
			}
		);
	}

	// ============================================================
	// FOOTER CON FIRMA (igual que pdfMaker)
	// ============================================================
	if (firmas && firmas[0]?.presignedUrl) {
		try {
			const firmaBase64 = await imageToBase64Url(firmas[0].presignedUrl);
			content.push({
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
						color,
						alignment: 'center' as const,
						bold: true,
						margin: [0, 4, 0, 7]
					}
				],
				alignment: 'center' as const
			});
		} catch {
			// Si falla la carga de la firma, no mostrarla
		}
	}

	content.push({
		text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
		fontSize: 9,
		color: '#9E9E9E',
		alignment: 'center' as const,
		margin: [0, 20, 0, 0]
	});

	// ============================================================
	// PÁGINA 2+: HORAS EXTRAS Y RECARGOS (si hay recargos planilla)
	// ============================================================
	if (recargosData?.planillas && recargosData.planillas.length > 0 && item.mostrar_recargos) {
		const planillas: any[] = recargosData.planillas.filter(
			(p: any) => p.dias && p.dias.length > 0
		);

		for (const planilla of planillas) {
			// Page break before each planilla group
			content.push({ text: '', pageBreak: 'before' as const });

			// Title
			content.push({
				text: 'HORAS EXTRAS Y RECARGOS',
				bold: true,
				color,
				fontSize: 13,
				alignment: 'center' as const,
				margin: [0, 0, 0, 10]
			});

			// Avisos
			const hayFestivosODomingos = planilla.dias?.some(
				(d: any) => d.es_festivo || d.es_domingo
			);
			const hayDisponibles = planilla.dias?.some((d: any) => d.disponibilidad);

			if (hayFestivosODomingos) {
				content.push({
					text: 'Aviso: Los días dominicales o festivos se resaltan en naranja.',
					fontSize: 9,
					color: '#92400E',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}
			if (hayDisponibles) {
				content.push({
					text: 'Aviso: Los días marcados como disponibilidad no son reconocidos. Se muestran en rojo y no suman a los totales.',
					fontSize: 9,
					color: '#B91C1C',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}

			// Header azul con info del vehículo/conductor/periodo
			const mesNombre = new Date(planilla.año, planilla.mes - 1)
				.toLocaleString('es-CO', { month: 'long' })
				.toUpperCase();

			const headerRows: any[] = [];
			// Conductor info
			headerRows.push({
				columns: [
					{
						text: `CONDUCTOR: ${conductorNombre}`,
						color: 'white',
						bold: true,
						fontSize: 9
					},
					{
						text: `C.C.: ${conductorCedula}`,
						color: 'white',
						fontSize: 9,
						alignment: 'right' as const
					}
				],
				margin: [0, 0, 0, 2]
			});
			// Vehículo y periodo
			headerRows.push({
				columns: [
					{
						text: `VEHÍCULO: ${planilla.vehiculo?.placa || 'N/A'}`,
						color: 'white',
						bold: true,
						fontSize: 10
					},
					{
						text: `MES: ${mesNombre} ${planilla.año}`,
						color: 'white',
						bold: true,
						fontSize: 10,
						alignment: 'right' as const
					}
				]
			});

			// Header background table
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								stack: headerRows,
								fillColor: color,
								margin: [4, 4, 4, 4]
							}
						]
					]
				},
				layout: {
					hLineWidth: () => 0,
					vLineWidth: () => 0,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 0,
					paddingBottom: () => 0
				},
				margin: [0, 5, 0, 0]
			});

			// Empresa info
			const valorHoraBase = planilla.configuracion_salarial?.valor_hora_trabajador || 0;
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								stack: [
									{
										text: [
											{ text: 'EMPRESA: ', bold: true, fontSize: 10 },
											{ text: planilla.empresa?.nombre || 'N/A', fontSize: 10 }
										]
									},
									{
										text: `Valor/Hora Base: ${formatCurrency(valorHoraBase)}`,
										fontSize: 10,
										color: '#666',
										margin: [0, 2, 0, 0]
									}
								],
								fillColor: '#f9f9f9',
								margin: [4, 4, 4, 4]
							}
						]
					]
				},
				layout: {
					hLineWidth: (i: number, node: any) =>
						i === node.table.body.length ? 1 : 0,
					vLineWidth: () => 0,
					hLineColor: () => '#E0E0E0',
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 0,
					paddingBottom: () => 0
				}
			});

			// Días laborales table
			const dias: any[] = planilla.dias || [];
			const headers = ['DÍA', 'HORARIO', 'HORAS', 'HED', 'RN', 'HEN', 'RD', 'RNDF', 'HEFD', 'HEFN'];
			const headerRow = headers.map((h) => ({
				text: h,
				bold: true,
				fontSize: 8,
				color,
				alignment: 'center' as const,
				margin: [0, 3, 0, 3]
			}));

			const diasRows = dias.map((dia: any, idx: number) => {
				const esDisponible = dia.disponibilidad;
				const esEspecial = dia.es_festivo || dia.es_domingo;
				const bgColor = esDisponible
					? '#FEE2E2'
					: esEspecial
						? '#FEF3C7'
						: idx % 2 === 0
							? '#ffffff'
							: '#f9f9f9';
				const textColor = esDisponible
					? '#B91C1C'
					: esEspecial
						? '#92400E'
						: '#333333';

				// Extract recargos values from dia.recargos array
				const getRecargo = (codigo: string) => {
					const r = dia.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
					return r ? r.horas : 0;
				};

				const hed = getRecargo('HED');
				const rn = getRecargo('RN');
				const hen = getRecargo('HEN');
				const rd = getRecargo('RD');
				const rndf = getRecargo('RNDF');
				const hefd = getRecargo('HEFD');
				const hefn = getRecargo('HEFN');

				const formatHora = (h: any) => {
					if (!h && h !== 0) return '-';
					const num = Number(h);
					const hh = Math.floor(num).toString().padStart(2, '0');
					const mm = Math.round((num % 1) * 60)
						.toString()
						.padStart(2, '0');
					return `${hh}:${mm}`;
				};

				const cellStyle = {
					fontSize: 8,
					alignment: 'center' as const,
					color: textColor,
					fillColor: bgColor,
					margin: [0, 2, 0, 2]
				};

				const fmtVal = (v: number) => (v !== 0 ? Number(v).toFixed(2) : '-');

				return [
					{ text: dia.dia, ...cellStyle },
					{
						text: `${formatHora(dia.hora_inicio)}-${formatHora(dia.hora_fin)}`,
						...cellStyle
					},
					{ text: Number(dia.total_horas || 0).toFixed(2), ...cellStyle },
					{ text: fmtVal(hed), ...cellStyle },
					{ text: fmtVal(rn), ...cellStyle },
					{ text: fmtVal(hen), ...cellStyle },
					{ text: fmtVal(rd), ...cellStyle },
					{ text: fmtVal(rndf), ...cellStyle },
					{ text: fmtVal(hefd), ...cellStyle },
					{ text: fmtVal(hefn), ...cellStyle }
				];
			});

			// Totals row
			const totHoras = dias
				.filter((d: any) => !d.disponibilidad)
				.reduce((s: number, d: any) => s + (d.total_horas || 0), 0);
			const totDias = dias.filter((d: any) => !d.disponibilidad).length;

			const getTotal = (codigo: string) => {
				return dias
					.filter((d: any) => !d.disponibilidad)
					.reduce((s: number, d: any) => {
						const r = d.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
						return s + (r ? r.horas : 0);
					}, 0);
			};

			const totalesRow = [
				{
					text: totDias.toString(),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: '-',
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: totHoras.toFixed(2),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				},
				...[
					getTotal('HED'),
					getTotal('RN'),
					getTotal('HEN'),
					getTotal('RD'),
					getTotal('RNDF'),
					getTotal('HEFD'),
					getTotal('HEFN')
				].map((v) => ({
					text: v ? v.toFixed(2) : '0.00',
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				}))
			];

			content.push({
				table: {
					headerRows: 1,
					widths: Array(10).fill('*'),
					body: [headerRow, ...diasRows, totalesRow]
				},
				layout: {
					hLineWidth: (i: number, node: any) =>
						i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
					vLineWidth: () => 0.5,
					hLineColor: () => '#E0E0E0',
					vLineColor: () => '#E0E0E0',
					paddingLeft: () => 2,
					paddingRight: () => 2,
					paddingTop: () => 1,
					paddingBottom: () => 1
				}
			});

			// TOTALES CONSOLIDADOS header
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								text: 'TOTALES CONSOLIDADOS',
								bold: true,
								fontSize: 11,
								color,
								alignment: 'center' as const,
								fillColor: colorBg,
								margin: [0, 3, 0, 3]
							}
						]
					]
				},
				layout: {
					hLineWidth: () => 0,
					vLineWidth: () => 0,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 0,
					paddingBottom: () => 0
				}
			});

			// Tipos de recargos consolidados table
			// Aggregate from dias.recargos
			const tiposMap: Record<
				string,
				{
					codigo: string;
					nombre: string;
					porcentaje: number;
					horas: number;
					valor_hora_base: number;
					valor_hora_calculada: number;
					valor_total: number;
					adicional: boolean;
				}
			> = {};

			for (const dia of dias) {
				if (dia.disponibilidad) continue;
				for (const rec of dia.recargos || []) {
					if (!tiposMap[rec.tipo_codigo]) {
						tiposMap[rec.tipo_codigo] = {
							codigo: rec.tipo_codigo,
							nombre: rec.tipo_nombre,
							porcentaje: rec.porcentaje,
							horas: 0,
							valor_hora_base: rec.valor_hora_base,
							valor_hora_calculada: rec.valor_hora_calculada,
							adicional: rec.adicional || rec.es_hora_extra,
							valor_total: 0
						};
					}
					tiposMap[rec.tipo_codigo].horas += rec.horas;
					tiposMap[rec.tipo_codigo].valor_total += rec.valor_total;
				}
			}

			const tiposConsolidados = Object.values(tiposMap).sort(
				(a, b) => a.porcentaje - b.porcentaje
			);

			if (tiposConsolidados.length > 0) {
				const recargoHeaderRow = [
					{
						text: 'TIPO RECARGO',
						bold: true,
						fontSize: 8,
						color,
						margin: [2, 3, 0, 3]
					},
					{
						text: '%',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'V/BASE',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'V/+ %',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'CANTIDAD',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'TOTAL',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					}
				];

				const recargoRows = tiposConsolidados.map((tipo) => [
					{
						text: [
							{ text: tipo.nombre.toUpperCase(), fontSize: 9 },
							{ text: ` - ${tipo.codigo}`, fontSize: 9, color: '#007AFF' }
						],
						margin: [2, 2, 0, 2]
					},
					{
						text: `${tipo.porcentaje}%`,
						fontSize: 9,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_hora_base),
						fontSize: 9,
						color: '#666',
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_hora_calculada),
						fontSize: 9,
						bold: true,
						color,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: tipo.horas.toFixed(2),
						fontSize: 9,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_total),
						fontSize: 9,
						bold: true,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					}
				]);

				content.push({
					table: {
						headerRows: 1,
						widths: ['35%', '10%', '13%', '13%', '13%', '16%'],
						body: [recargoHeaderRow, ...recargoRows]
					},
					layout: {
						hLineWidth: (i: number, node: any) =>
							i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
						vLineWidth: () => 0.5,
						hLineColor: () => '#E0E0E0',
						vLineColor: () => '#E0E0E0',
						paddingLeft: () => 2,
						paddingRight: () => 2,
						paddingTop: () => 1,
						paddingBottom: () => 1,
						fillColor: (rowIndex: number) => (rowIndex === 0 ? colorBg : null)
					}
				});

				// SUBTOTAL / TOTAL bar
				const totalValor = planilla.total_valor || 0;
				content.push({
					table: {
						widths: ['*', 'auto'],
						body: [
							[
								{
									text: 'TOTAL',
									color: 'white',
									bold: true,
									fontSize: 10,
									fillColor: color,
									margin: [4, 4, 0, 4]
								},
								{
									text: formatCurrency(totalValor),
									color: 'white',
									bold: true,
									fontSize: 10,
									fillColor: color,
									alignment: 'right' as const,
									margin: [0, 4, 15, 4]
								}
							]
						]
					},
					layout: {
						hLineWidth: () => 0,
						vLineWidth: () => 0,
						paddingLeft: () => 0,
						paddingRight: () => 0,
						paddingTop: () => 0,
						paddingBottom: () => 0
					}
				});
			}

			// Firma on recargos page
			if (firmas && firmas[0]?.presignedUrl) {
				try {
					const firmaBase64 = await imageToBase64Url(firmas[0].presignedUrl);
					content.push({
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
								color,
								alignment: 'center' as const,
								bold: true,
								margin: [0, 4, 0, 7]
							}
						],
						alignment: 'center' as const
					});
				} catch {
					// Silently skip if firma fails
				}
			}

			content.push({
				text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
				fontSize: 9,
				color: '#9E9E9E',
				alignment: 'center' as const,
				margin: [0, 10, 0, 0]
			});
		}
	}

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
			},
			valueText: {
				fontSize: 12
			}
		},
		defaultStyle: {
			fontSize: 12
		}
	};

	pdfMake.createPdf(docDefinition).open();
}
