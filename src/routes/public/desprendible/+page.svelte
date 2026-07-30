<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { obtenerLogoBase64 } from '$lib/utils/pdfUtils';

	let estado: 'cargando' | 'error' | 'generando' | 'listo' = 'cargando';
	let errorMsg = '';

	// ==================== HELPERS ====================
	function fmt(value: any): string {
		const num = Number(value) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(num);
	}

	function safe(val: any, def: any = '') {
		return val !== undefined && val !== null ? val : def;
	}

	function parseArr(values: any): any[] {
		if (Array.isArray(values)) return values;
		if (typeof values === 'string') {
			try {
				const p = JSON.parse(values);
				return Array.isArray(p) ? p : [];
			} catch {
				return [];
			}
		}
		return [];
	}

	function monthYear(dateStr: string | null | undefined): string {
		if (!dateStr) return '';
		const d = new Date(dateStr + 'T00:00:00');
		if (isNaN(d.getTime())) return '';
		return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();
	}

	function fmtDate(dateStr: string | null | undefined): string {
		if (!dateStr) return 'Sin fecha';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return 'Sin fecha';
		return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
	}

	// ==================== PDF GENERATION ====================
	async function generarPdf(item: any) {
		estado = 'generando';

		const pdfMake = (await import('pdfmake/build/pdfmake')).default;
		const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
		pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

		const esCotransmeq = item.es_cotransmeq || false;
		const color = '#EA580C';
		const colorBg = '#FFF7ED';
		const empresa = esCotransmeq
			? 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S'
			: 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S';
		const nit = esCotransmeq ? '901983227' : '901528440-3';

		const conductorNombre = `${safe(item.conductor?.nombre, 'N/A')}`;
		const conductorCedula = safe(item.conductor?.cedula || item.conductor?.numero_identificacion, 'N/A');

		const logoBase64 = await obtenerLogoBase64(esCotransmeq);

		// Periodo
		const periodoFin = item.periodo_fin || item.periodo_end || '';
		const periodoInicio = item.periodo_inicio || item.periodo_start || '';

		// Recargos con Ajuste (flexible — antes era solo PAREX)
		const ajusteConfig = item.ajuste_recargos_config ? (typeof item.ajuste_recargos_config === 'string' ? JSON.parse(item.ajuste_recargos_config) : item.ajuste_recargos_config) : null;
		const PAREX_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
		
		let recargosAjuste: any[] = [];
		let totalRecargosAjuste = 0;
		let totalRecargosNormal = Number(item.total_recargos || 0);
		let ajusteLabel = 'Recargos Ajuste';

		if (ajusteConfig && ajusteConfig.mode) {
			if (ajusteConfig.mode === 'total') {
				recargosAjuste = item.recargos || [];
				totalRecargosAjuste = Number(item.total_recargos || 0);
				totalRecargosNormal = 0;
				ajusteLabel = `Recargos con Ajuste (${ajusteConfig.porcentaje || 8}%)`;
			} else if (ajusteConfig.mode === 'empresas' && ajusteConfig.empresa_ids?.length > 0) {
				const idsSet = new Set(ajusteConfig.empresa_ids);
				recargosAjuste = (item.recargos || []).filter((r: any) => idsSet.has(r.empresa_id));
				totalRecargosAjuste = recargosAjuste.reduce((s: number, r: any) => s + Number(r.valor || 0), 0);
				totalRecargosNormal = Number(item.total_recargos || 0) - totalRecargosAjuste;
				ajusteLabel = `Recargos Ajuste (${ajusteConfig.porcentaje || 8}%)`;
			}
		} else if (Number(item.ajuste_parex_valor || 0) > 0) {
			// Backward compat: legacy PAREX
			recargosAjuste = (item.recargos || []).filter((r: any) => r.empresa_id === PAREX_ID);
			totalRecargosAjuste = recargosAjuste.reduce((s: number, r: any) => s + Number(r.valor || 0), 0);
			totalRecargosNormal = Number(item.total_recargos || 0) - totalRecargosAjuste;
			ajusteLabel = 'Recargos PAREX';
		}

		// Bonificaciones agrupadas
		const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> = {};
		if (item.bonificaciones && item.bonificaciones.length > 0) {
			item.bonificaciones.forEach((b: any) => {
				const qty = parseArr(b.values).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
				if (qty <= 0) return;
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
			.map((b) => [b.name, '', String(b.quantity), fmt(b.totalValue)]);

		// Pernotes - parsear fechas defensivamente (puede venir como JSON string)
		const parsePernFechas = (fechas: any): string[] => {
			if (Array.isArray(fechas)) return fechas;
			if (typeof fechas === 'string') {
				try { const p = JSON.parse(fechas); return Array.isArray(p) ? p : []; } catch { return []; }
			}
			return [];
		};
		const cantidadPernotes = (item.pernotes || []).reduce(
			(t: number, p: any) => t + parsePernFechas(p.fechas).length,
			0
		);

		// ==================== TABLA ADICIONALES ====================
		const conceptosBody: any[][] = [
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
				{ text: fmt(totalRecargosNormal), alignment: 'right' as const }
			],
			...(recargosAjuste.length > 0
				? [[
						ajusteLabel,
						{ text: 'Ver recargos detallados', fontSize: 9, color: '#666' },
						{ text: '', alignment: 'center' as const },
						{ text: fmt(totalRecargosAjuste), alignment: 'right' as const }
					]]
				: []),
			[
				'Pernotes',
				{ text: '', fontSize: 9 },
				{ text: String(cantidadPernotes), alignment: 'center' as const },
				{ text: fmt(item.total_pernotes || 0), alignment: 'right' as const }
			]
		];

		// Conceptos adicionales
		const conceptosAdicionalesBody = parseArr(item.conceptos_adicionales).map((c: any) => [
			'Ajuste adicional',
			{ text: c.observaciones || c.concepto || '', fontSize: 9 },
			{ text: '1', alignment: 'center' as const },
			{
				text: `${Number(c.valor) < 0 ? '' : '+'}${fmt(c.valor)}`,
				alignment: 'right' as const,
				color: Number(c.valor) < 0 ? '#e60f0f' : color
			}
		]);

		// Sueldo ajustado
		const sueldoBase = Number(safe(item.sueldo_total, 0));
		const intereses = Number(safe(item.interes_cesantias, 0));
		const primaPend = Number(safe(item.prima_pendiente, 0));
		const sueldoAjustado = sueldoBase - intereses - primaPend;

		// ==================== BUILD CONTENT ====================
		const content: any[] = [
			// HEADER
			{
				columns: [
					{
						stack: [
							{ text: empresa, style: 'header', color },
							{ text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
							{
								text: `COMPROBANTE DE NOMINA - ${monthYear(periodoFin)}`,
								fontSize: 10,
								color,
								bold: true,
								margin: [0, 8, 0, 0]
							},
							{
								text: `BÁSICO CORRESPONDIENTE AL MES DE ${monthYear(periodoFin)}`,
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
				]
			},

			// DATOS EMPLEADO
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
								text: String(safe(item.dias_laborados, 0)),
								alignment: 'right' as const
							}
						],
						[
							{ text: 'Salario devengado', bold: false },
							{
								text: fmt(item.salario_devengado),
								color: '#007AFF',
								alignment: 'right' as const
							}
						],
						[
							{ text: 'Auxilio de transporte', bold: false },
							{
								text: fmt(item.auxilio_transporte),
								color: '#666',
								alignment: 'right' as const
							}
						],
						...(Number(safe(item.valor_incapacidad, 0)) > 0
							? [
									[
										{ text: 'Remuneración por incapacidad', bold: false },
										{
											text: fmt(item.valor_incapacidad),
											color,
											alignment: 'right' as const
										}
									]
								]
							: []),
						[
							{ text: 'Ajuste Salarial', bold: false },
							{
								columns: [
									{
										text: `${safe(item.dias_laborados_villanueva, 0)} días`,
										width: 'auto'
									},
									{
										text: fmt(item.ajuste_salarial || 0),
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

			// TÍTULO ADICIONALES
			{
				text: `ADICIONALES ${fmtDate(periodoInicio)} - ${fmtDate(periodoFin)}`.toUpperCase(),
				alignment: 'center' as const,
				bold: true,
				color,
				fontSize: 12,
				margin: [0, 15, 0, 10]
			},

			// TABLA CONCEPTOS
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

		// CONCEPTOS ADICIONALES
		if (conceptosAdicionalesBody.length > 0) {
			content.push(
				{
					text: 'CONCEPTOS ADICIONALES',
					bold: true,
					color,
					fontSize: 11,
					margin: [0, 12, 0, 6]
				},
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

		// DISPONIBILIDAD (solo si tiene valor > 0)
		const disponibilidadVal = Number(item.disponibilidad || 0);
		if (disponibilidadVal > 0) {
			content.push(
				{ text: 'DISPONIBILIDAD', bold: true, color, fontSize: 11, margin: [0, 12, 0, 6] },
				{
					table: {
						widths: ['*', '*'],
						body: [
							[
								{ text: 'Disponibilidad' },
								{
									text: fmt(disponibilidadVal),
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

		// DEDUCCIONES
		const deduccionesBody: any[][] = [
			[
				{ text: 'Salud' },
				{ text: fmt(item.salud), color: '#e60f0f', alignment: 'right' as const }
			],
			[
				{ text: 'Pensión' },
				{ text: fmt(item.pension), color: '#e60f0f', alignment: 'right' as const }
			]
		];
		if (item.anticipos && item.anticipos.length > 0) {
			deduccionesBody.push([
				{ text: 'Anticipos' },
				{
					text: fmt(item.total_anticipos),
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

		// RESUMEN FINAL
		const resumenBody: any[][] = [];
		if (Number(safe(item.total_vacaciones, 0)) > 0) {
			resumenBody.push([
				{ text: 'Vacaciones' },
				{
					text: fmt(item.total_vacaciones),
					color: '#FF9500',
					alignment: 'right' as const
				}
			]);
		}
		resumenBody.push([
			{ text: 'Salario total', bold: true },
			{
				text: fmt(sueldoAjustado),
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

		// FOOTER
		content.push({
			text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
			fontSize: 9,
			color: '#9E9E9E',
			alignment: 'center' as const,
			margin: [0, 30, 0, 0]
		});

		// ==================== CREATE PDF ====================
		const docDefinition: any = {
			pageSize: 'A4',
			pageMargins: [40, 30, 40, 30],
			content,
			styles: {
				header: { fontSize: 13, bold: true, margin: [0, 0, 0, 2] },
				tableHeader: { bold: true, fontSize: 10 }
			},
			defaultStyle: { fontSize: 11 }
		};

		pdfMake.createPdf(docDefinition).open();
		estado = 'listo';
	}

	// ==================== MOUNT ====================
	onMount(() => {
		try {
			const dataParam = $page.url.searchParams.get('data');
			if (!dataParam) {
				errorMsg = 'No se proporcionó el parámetro "data" en la URL.\n\nUso: /public/desprendible?data=BASE64_JSON';
				estado = 'error';
				return;
			}

			const jsonStr = atob(dataParam);
			const item = JSON.parse(jsonStr);

			if (!item || typeof item !== 'object') {
				errorMsg = 'Los datos proporcionados no son un objeto JSON válido.';
				estado = 'error';
				return;
			}

			generarPdf(item);
		} catch (e: any) {
			errorMsg = `Error al procesar los datos: ${e.message}`;
			estado = 'error';
		}
	});
</script>

<svelte:head>
	<title>Desprendible de Nómina</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-900 via-orange-800 to-slate-900 p-4">
	<div class="w-full max-w-md rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
		{#if estado === 'cargando'}
			<div class="flex flex-col items-center gap-4">
				<svg class="h-10 w-10 animate-spin text-orange-400" viewBox="0 0 24 24" fill="none">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<p class="text-lg text-orange-200">Procesando datos...</p>
			</div>
		{:else if estado === 'generando'}
			<div class="flex flex-col items-center gap-4">
				<svg class="h-10 w-10 animate-spin text-orange-400" viewBox="0 0 24 24" fill="none">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<p class="text-lg text-orange-200">Generando PDF...</p>
				<p class="text-sm text-orange-300/60">El documento se abrirá automáticamente</p>
			</div>
		{:else if estado === 'listo'}
			<div class="flex flex-col items-center gap-4">
				<svg class="h-12 w-12 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="text-lg font-semibold text-orange-200">PDF generado exitosamente</p>
				<p class="text-sm text-orange-300/60">El documento se abrió en una nueva pestaña</p>
			</div>
		{:else if estado === 'error'}
			<div class="flex flex-col items-center gap-4">
				<svg class="h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.832c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
				</svg>
				<p class="text-lg font-semibold text-red-300">Error</p>
				<p class="whitespace-pre-line text-sm text-red-200/80">{errorMsg}</p>
			</div>
		{/if}
	</div>
</div>
