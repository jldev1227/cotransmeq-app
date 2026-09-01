/**
 * Generador de PDF Desprendible de Nómina usando pdfmake
 * Portado de pdfMaker.tsx (@react-pdf/renderer) a pdfmake - IGUALADO
 */
import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
import { obtenerLogoBase64 } from '$lib/utils/pdfUtils';

const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
const GEOPARK_EMPRESA_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';

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
	return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();
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
 * Calcula la diferencia en días entre dos fechas (inclusiva: cuenta ambos extremos)
 * Ej: del 1 al 5 = 5 días (1, 2, 3, 4, 5)
 */
function obtenerDiferenciaDias(startStr: string, endStr: string): number {
	try {
		const start = new Date(startStr + 'T00:00:00');
		const end = new Date(endStr + 'T00:00:00');
		if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
		return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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

	const color = '#EA580C';
	const colorBg = '#FFF7ED';
	const empresa = 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S';
	const nit = '901983227';

	const conductorNombre = `${safeValue(item.conductor?.nombre, 'N/A')}`;
	const conductorCedula = safeValue(
		(item.conductor as any)?.cedula || (item.conductor as any)?.numero_identificacion,
		'N/A'
	);

	// Cargar logo
	const logoBase64 = await obtenerLogoBase64(false);

	// Disponibilidad (viene separada de item.total_recargos en el payload)
	const disponibilidadVal = Number(safeValue(item.disponibilidad, 0));

	// Recargos agrupados por empresa.
	// Fuente ÚNICA: item.recargos (tabla `recargos` con ediciones manuales
	// aplicadas). Deduplicamos por `id` porque el include de Prisma en la
	// query de la liquidación arrastra joins 1:N (dias_laborales_planillas /
	// detalles_recargos_dias) que multiplican las filas del recargo.
	//
	// IMPORTANTE: NO hay fallback a recargosData.planillas. Ese fallback
	// existía para liquidaciones muy viejas donde los recargos automáticos
	// aún no se persistían en la tabla `recargos`, pero hoy siempre se
	// guardan (via `recargos_preview` en `crear` y `actualizar` del backend).
	// El fallback era la raíz de un bug crítico: cuando el usuario desmarcaba
	// todos los recargos del preview y guardaba, `item.recargos` quedaba
	// vacío y el fallback sumaba TODAS las planillas del live preview
	// (incluyendo las desmarcadas) → aparecían en la sumatoria de "OTROS"
	// del PDF. Coincide con la liquidación de Transmeralda donde el
	// `total_recargos` correcto (0) se duplicaba con recargos desmarcados.
	let totalRecargosParex = 0;
	let totalRecargosGeopark = 0;
	let totalRecargosOtros = 0;
	let dedupDebug = { total: 0, unicos: 0 };

	if (item.recargos && item.recargos.length > 0) {
		const unicos = new Map<string, any>();
		for (const r of item.recargos) {
			dedupDebug.total += 1;
			if (!r?.id) continue;
			if (unicos.has(r.id)) continue;
			unicos.set(r.id, r);
		}
		dedupDebug.unicos = unicos.size;

		for (const r of unicos.values()) {
			const valor = Number(r.valor || 0);
			// Respetar la marca "incluir" del preview: si el usuario desmarcó
			// el recargo en la UI (incluir === false), excluirlo de la
			// sumatoria de "OTROS" / PAREX / GEOPARK del desprendible. Sin
			// este filtro, los recargos que el usuario decidió NO incluir
			// en la liquidación seguirían apareciendo en el PDF.
			if (r.incluir === false) continue;
			if (r.empresa_id === PAREX_EMPRESA_ID) {
				totalRecargosParex += valor;
			} else if (r.empresa_id === GEOPARK_EMPRESA_ID) {
				totalRecargosGeopark += valor;
			} else {
				totalRecargosOtros += valor;
			}
		}
	}
	const hayRecargosParex = totalRecargosParex > 0;
	const hayRecargosGeopark = totalRecargosGeopark > 0;

	// Restar disponibilidad del valor MAYOR entre Otros, PAREX y GEOPARK.
	// Si la disponibilidad excede al mayor, el remanente baja al siguiente mayor.
	if (disponibilidadVal > 0) {
		const categorias = [
			{ key: 'otros', valor: totalRecargosOtros },
			{ key: 'parex', valor: totalRecargosParex },
			{ key: 'geopark', valor: totalRecargosGeopark }
		].sort((a, b) => b.valor - a.valor);

		let restante = disponibilidadVal;
		for (const cat of categorias) {
			if (restante <= 0) break;
			if (cat.valor <= 0) continue;
			const descuento = Math.min(cat.valor, restante);
			cat.valor -= descuento;
			restante -= descuento;
		}

		totalRecargosOtros = categorias.find((c) => c.key === 'otros')!.valor;
		totalRecargosParex = categorias.find((c) => c.key === 'parex')!.valor;
		totalRecargosGeopark = categorias.find((c) => c.key === 'geopark')!.valor;
	}

	console.log('DEBUG RECARGOS', {
		disponibilidadVal,
		totalRecargosParex,
		totalRecargosGeopark,
		totalRecargosOtros,
		recargosRecibidos: dedupDebug.total,
		recargosUnicos: dedupDebug.unicos,
		fuente: item.recargos?.length ? 'item.recargos (tabla)' : 'planillas (fallback)'
	});

	// Bonificaciones agrupadas
	const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> = {};
	if (item.bonificaciones && item.bonificaciones.length > 0) {
		item.bonificaciones.forEach((b) => {
			const qty = parseValues(b.values).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
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

	// Cantidad y valor de pernoctes salen SIEMPRE de las filas de la tabla
	// `pernotes` (cantidad x valor registrado en cada fila). NO se usa el
	// agregado `item.total_pernotes` de la liquidacion: ese campo se calcula
	// con el valor de pernote vigente en la configuracion al momento de
	// guardar, y deja de coincidir con lo registrado si esa configuracion
	// cambia despues (o si la fila se corrigio a mano).
	// Deduplicamos por `id` por si el include de Prisma repite filas.
	const pernotesUnicos: any[] = [];
	if (item.pernotes && item.pernotes.length > 0) {
		const vistosPernotes = new Set<string>();
		(item.pernotes as any[]).forEach((p, idx) => {
			const key = p?.id ?? `sin-id-${idx}`;
			if (vistosPernotes.has(key)) return;
			vistosPernotes.add(key);
			pernotesUnicos.push(p);
		});
	}

	// `cantidad` y `fechas` deberian ir sincronizados; si falta uno usamos el otro.
	const diasDePernote = (p: any): number => {
		const fechas = parseFechas(p.fechas);
		return fechas.length > 0 ? fechas.length : Number(p.cantidad) || 0;
	};

	const cantidadPernotes = pernotesUnicos.reduce((t, p) => t + diasDePernote(p), 0);

	// Fallback al agregado almacenado solo si el payload no trae las filas.
	const totalPernotes =
		pernotesUnicos.length > 0
			? pernotesUnicos.reduce((t, p) => t + diasDePernote(p) * (Number(p.valor) || 0), 0)
			: Number(safeValue(item.total_pernotes, 0));

	let pernoteFechasTexto = '';
	if (pernotesUnicos.length > 0) {
		try {
			const todasLasFechas: string[] = [];
			pernotesUnicos.forEach((pernote) => {
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
		// Recargos (llamado "Otros" como en pdfMaker) - suma de recargos que no son PAREX ni GEOPARK
		[
			{ text: 'Otros', style: 'valueText' },
			{ text: 'Ver recargos detallados más adelante', fontSize: 10, color: '#666' },
			{ text: ' ', alignment: 'center' as const },
			{
				text: formatCurrency(totalRecargosOtros),
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
							text: formatCurrency(totalRecargosParex),
							alignment: 'center' as const,
							style: 'valueText'
						}
					]
				]
			: []),
		// Recargos Geopark (si hay — manuales + planillas)
		...(hayRecargosGeopark
			? [
					[
						{ text: 'Recargos GEOPARK', style: 'valueText' },
						{
							text: 'Ver recargos detallados más adelante',
							fontSize: 10,
							color: '#666'
						},
						{ text: ' ', alignment: 'center' as const },
						{
							text: formatCurrency(totalRecargosGeopark),
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
				text: formatCurrency(totalPernotes),
				alignment: 'center' as const,
				style: 'valueText'
			}
		]
	];

	// ============================================================
	// DATOS DEL EMPLEADO (tabla label-value con colores iguales a pdfMaker)
	// ============================================================
	const empleadoBody: any[][] = [
		[{ text: 'Nombre' }, { text: conductorNombre, alignment: 'right' as const }],
		[{ text: 'C.C.' }, { text: conductorCedula, alignment: 'right' as const }],
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

	// Ajuste salarial (siempre se muestra en Transmeralda)
	empleadoBody.push([
		{ text: 'Bono Nivelación de Salario' },
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
								alignment: 'left' as const,
								margin: [0, -15, 0, 0]
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
				hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
				vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
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
				hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
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
					widths: ['40%', '15%', '30%'],
					body: conceptosAdicionalesBody
				},
				layout: {
					hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
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
					hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
					vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
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
				color: '#e60f0f',
				alignment: 'right' as const
			}
		],
		[
			{ text: 'Pensión' },
			{
				text: formatCurrency(item.pension),
				color: '#e60f0f',
				alignment: 'right' as const
			}
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

		item.anticipos.forEach((a) => {
			const conceptoTexto = a.concepto || a.observaciones || '';
			deduccionesBody.push([
				{
					text: [
						{ text: '  • ', color: '#9E9E9E' },
						{ text: conceptoTexto, fontSize: 10, color: '#555' }
					],
					colSpan: 2
				},
				{}
			]);
		});
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
				hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
				vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
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
				? obtenerDiferenciaDias(item.periodo_vacaciones_inicio, item.periodo_vacaciones_fin)
				: item.periodo_start_vacaciones && item.periodo_end_vacaciones
					? obtenerDiferenciaDias(item.periodo_start_vacaciones, item.periodo_end_vacaciones)
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
	const sueldoAjustado = sueldoBase - intereses;

	// Si hay vacaciones, usar 3 columnas para alinear
	if (resumenBody.length > 0) {
		resumenBody.push([
			{ text: 'Salario total', bold: true },
			{ text: '' },
			{
				text: formatCurrency(sueldoAjustado),
				bold: true,
				color: '#007AFF',
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
					hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
					vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
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
								color: '#007AFF',
								alignment: 'right' as const
							}
						]
					]
				},
				layout: {
					hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
					vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
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
		// No descartamos planillas sin `dias`: el modal puede enviar
		// planillas sintéticas (total_valor > 0 pero sin desglose por
		// día) para que el TOTAL del PDF cuadre con el del preview.
		const planillas: any[] = recargosData.planillas;

		// Paleta de colores según la categoría de la planilla:
		//  - 'pagar'       → naranja (color principal de la marca).
		//  - 'bono_aparte' → azul (GEOLAB, RED SALUD, etc.; se
		//                    reconoce como bono aparte, no como recargo).
		//  - 'no_pagar'    → gris (caso b: días con recorrido sin
		//                    recardo, o solo disponibilidad).
		const COLOR_BONO_APARTE = '#1D4ED8'; // blue-700
		const COLOR_BONO_APARTE_BG = '#DBEAFE'; // blue-100
		const COLOR_NO_PAGAR = '#6B7280'; // gray-500
		const COLOR_NO_PAGAR_BG = '#F3F4F6'; // gray-100

		for (const planilla of planillas) {
			const categoria: string = planilla._categoria || 'pagar';
			const isBonoAparte = categoria === 'bono_aparte';
			const isNoPagar = categoria === 'no_pagar';

			const headerColor = isBonoAparte
				? COLOR_BONO_APARTE
				: isNoPagar
					? COLOR_NO_PAGAR
					: color;
			const headerBg = isBonoAparte
				? COLOR_BONO_APARTE
				: isNoPagar
					? COLOR_NO_PAGAR
					: color;
			// Una planilla 'no_pagar' puede llegar con valor (tiene recargos
			// generados pero no está anclada a un recargo de la liquidación) o
			// sin él (días de disponibilidad, o recorrido sin recargo). El
			// título debe distinguirlos: decir "sin recargo generado" sobre una
			// planilla que sí los tiene es engañoso.
			const tieneValorPlanilla = Number(planilla.total_valor || 0) > 0;
			const sectionTitle = isBonoAparte
				? 'BONO APARTE (no remunerado como recargo)'
				: isNoPagar
					? tieneValorPlanilla
						? 'DÍAS LABORALES (no incluidos en esta liquidación)'
						: 'DÍAS LABORALES (sin recargo generado)'
					: 'HORAS EXTRAS Y RECARGOS';

			// Page break before each planilla group
			content.push({ text: '', pageBreak: 'before' as const });

			// Title
			content.push({
				text: sectionTitle,
				bold: true,
				color: headerColor,
				fontSize: 13,
				alignment: 'center' as const,
				margin: [0, 0, 0, 10]
			});

			// Avisos
			const hayFestivosODomingos = planilla.dias?.some((d: any) => d.es_festivo || d.es_domingo);
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
			if (hayDisponibles && !isBonoAparte) {
				content.push({
					text: 'Aviso: Los días marcados como disponibilidad no son reconocidos. Se muestran en rojo y no suman a los totales.',
					fontSize: 9,
					color: '#B91C1C',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}

			// Header verde con info del vehículo/conductor/periodo
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

			content.push({
				stack: headerRows,
				fillColor: headerBg,
				margin: [0, 5, 0, 0]
				// Wrap in a table to get the green background
			});

			// Use a table to achieve the green header background
			content.pop(); // Remove the stack we just added
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								stack: headerRows,
								fillColor: headerBg,
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
											{ text: planilla.empresa?.nombre || 'N/A', fontSize: 10 },
											...(isBonoAparte
												? [
														{
															text: '  [BONO APARTE]',
															bold: true,
															fontSize: 9,
															color: '#FFFFFF',
															// Lo pintamos luego con un stack badge
														}
													]
												: [])
										]
									},
									{
										text: isBonoAparte
											? `Reconocido como bono aparte — valor/hora base no aplica a esta planilla en el desprendible.`
											: `Valor/Hora Base: ${formatCurrency(valorHoraBase)}`,
										fontSize: 10,
										color: isBonoAparte ? COLOR_BONO_APARTE : '#666',
										margin: [0, 2, 0, 0]
									}
								],
								fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : '#f9f9f9',
								margin: [4, 4, 4, 4]
							}
						]
					]
				},
				layout: {
					hLineWidth: (i: number, node: any) => (i === node.table.body.length ? 1 : 0),
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
			// Para planillas de "bono aparte" mostramos solo 3 columnas
			// (DÍA, HORARIO, HORAS) — sin desglose HED/RN/HEN/etc.
			const allHeaders = ['DÍA', 'HORARIO', 'HORAS', 'HED', 'RN', 'HEN', 'RD', 'RNDF', 'HEFD', 'HEFN'];
			const headers = isBonoAparte ? allHeaders.slice(0, 3) : allHeaders;
			const tableWidths = isBonoAparte
				? Array(3).fill('*')
				: Array(allHeaders.length).fill('*');
			const headerRow = headers.map((h) => ({
				text: h,
				bold: true,
				fontSize: 8,
				color: headerColor,
				alignment: 'center' as const,
				margin: [0, 3, 0, 3]
			}));

			const diasRows = dias.map((dia: any, idx: number) => {
				const esDisponible = dia.disponibilidad;
				const esEspecial = dia.es_festivo || dia.es_domingo;
				// Para "bono aparte" usamos un fondo azul claro para todas
				// las filas, manteniendo la legibilidad pero reforzando
				// visualmente que NO es un recargo a pagar.
				const bgColor = isBonoAparte
					? COLOR_BONO_APARTE_BG
					: esDisponible
						? '#FEE2E2'
						: esEspecial
							? '#FEF3C7'
							: idx % 2 === 0
								? '#ffffff'
								: '#f9f9f9';
				const textColor = isBonoAparte
					? '#1E3A8A' // blue-900
					: esDisponible
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

				const baseCols = [
					{ text: dia.dia, ...cellStyle },
					{
						text: `${formatHora(dia.hora_inicio)}-${formatHora(dia.hora_fin)}`,
						...cellStyle
					},
					{ text: Number(dia.total_horas || 0).toFixed(2), ...cellStyle }
				];

				if (isBonoAparte) return baseCols;

				return [
					...baseCols,
					{ text: fmtVal(hed), ...cellStyle },
					{ text: fmtVal(rn), ...cellStyle },
					{ text: fmtVal(hen), ...cellStyle },
					{ text: fmtVal(rd), ...cellStyle },
					{ text: fmtVal(rndf), ...cellStyle },
					{ text: fmtVal(hefd), ...cellStyle },
					{ text: fmtVal(hefn), ...cellStyle }
				];
			});

			// Totals row. Para planillas "bono aparte" o "no pagar" (caso
			// informativo: días con disponibilidad o recorrido sin
			// recargo) el total refleja TODO el trabajo realizado
			// (incluyendo días con disponibilidad), porque la planilla es
			// informativa y el usuario quiere ver el total real. Solo
			// para 'pagar' (recargos efectivamente remunerados)
			// excluimos la disponibilidad del total — mismo criterio que
			// el cálculo de recargos monetarios.
			const excluirDisponibilidadDelTotal =
				!isBonoAparte && !isNoPagar;
			const diasParaTotal = excluirDisponibilidadDelTotal
				? dias.filter((d: any) => !d.disponibilidad)
				: dias;
			const totHoras = diasParaTotal.reduce(
				(s: number, d: any) => s + (d.total_horas || 0),
				0
			);
			const totDias = diasParaTotal.length;

			const getTotal = (codigo: string) => {
				return dias
					.filter((d: any) => !d.disponibilidad)
					.reduce((s: number, d: any) => {
						const r = d.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
						return s + (r ? r.horas : 0);
					}, 0);
			};

			const totalesRowBase = [
				{
					text: totDias.toString(),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: '-',
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: totHoras.toFixed(2),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				}
			];
			const totalesRowRecargos = [
				getTotal('HED'),
				getTotal('RN'),
				getTotal('HEN'),
				getTotal('RD'),
					getTotal('RNDF'),
					getTotal('HEFD'),
					getTotal('HEFN'),
				].map((v) => ({
					text: v ? v.toFixed(2) : '0.00',
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				}));

			const totalesRow = isBonoAparte
				? totalesRowBase
				: [...totalesRowBase, ...totalesRowRecargos];

			content.push({
				table: {
					headerRows: 1,
					widths: tableWidths,
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

			// Para planillas "bono aparte" omitimos el desglose por tipo
			// y la barra TOTAL: el valor monetario se reconoce como bono
			// aparte, no como recargo dentro de esta planilla.
			if (isBonoAparte) {
				content.push({
					table: {
						widths: ['*'],
						body: [
							[
								{
									text: [
										{
											text: `${totDias} día(s) trabajado(s) · ${totHoras.toFixed(2)} horas  `,
											bold: true,
											fontSize: 10,
											color: COLOR_BONO_APARTE
										},
										{
											text: 'Reconocido como bono aparte (no remunerado como recargo en este desprendible).',
											fontSize: 9,
											color: '#1E3A8A'
										}
									],
									fillColor: COLOR_BONO_APARTE_BG,
									margin: [6, 6, 6, 6]
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
					margin: [0, 6, 0, 0]
				});
				continue; // saltamos el desglose por tipo y la barra TOTAL
			}

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

			const tiposConsolidados = Object.values(tiposMap).sort((a, b) => a.porcentaje - b.porcentaje);

			// Mostramos el desglose por tipo SOLO si hay tipos. Para
			// planillas sintéticas (sin días) tiposConsolidados viene
			// vacío, pero igual necesitamos mostrar el TOTAL del recargo
			// para que cuadre con el total del preview.
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
			}

			// TOTAL bar: se muestra SIEMPRE que el planilla tenga un
			// total_valor > 0 (incluso si no hay tipos consolidados,
			// p. ej. planillas sintéticas sin desglose por día).
			const totalValor = Number(planilla.total_valor || 0);
			if (totalValor > 0) {
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
									fillColor: headerColor,
									margin: [4, 4, 0, 4]
								},
								{
									text: formatCurrency(totalValor),
									color: 'white',
									bold: true,
									fontSize: 10,
									fillColor: headerColor,
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
			} else {
				// Planilla con días pero `total_valor = 0`. Hay dos casos
				// que debemos explicar al usuario para que la sección
				// "TOTALES CONSOLIDADOS" no quede vacía:
				//
				//   a) Todos los días están marcados como disponibilidad.
				//      Por política no se reconocen y no suman a los
				//      recargos.
				//
				//   b) Hay días con recorrido (total_horas > 0) pero sin
				//      detalles de recargo generados (p. ej. porque se
				//      eliminaron manualmente o el cálculo automático no
				//      detectó horas extras). El conductor SÍ trabajó pero
				//      el valor monetario del día es $0.
				const diasDisponibles = (dias || []).filter((d: any) => d.disponibilidad)
					.length;
				const diasConRecorridoSinRecargo = (dias || []).filter(
					(d: any) =>
						!d.disponibilidad &&
						Number(d.total_horas) > 0 &&
						(!Array.isArray(d.recargos) || d.recargos.length === 0)
				).length;

				if (diasDisponibles > 0 || diasConRecorridoSinRecargo > 0) {
					const partes: any[] = [
						{ text: 'TOTAL: $0  ', bold: true, fontSize: 10, color: '#B91C1C' }
					];
					if (diasDisponibles > 0) {
						partes.push({
							text: `${diasDisponibles} día(s) marcado(s) como disponibilidad (no reconocidos). `,
							fontSize: 9,
							color: '#7F1D1D'
						});
					}
					if (diasConRecorridoSinRecargo > 0) {
						partes.push({
							text: `${diasConRecorridoSinRecargo} día(s) con recorrido pero sin recargo generado ($0). `,
							fontSize: 9,
							color: '#7F1D1D'
						});
					}
					content.push({
						table: {
							widths: ['*'],
							body: [
								[
									{
										text: partes,
										fillColor: '#FEE2E2',
										margin: [6, 6, 6, 6]
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
