<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import {
		vehiculosAPI,
		conductoresAPI,
		clientesAPI,
		extractosAPI
	} from '$lib/api/apiClient';
	import { toast } from 'svelte-sonner';

	// =====================
	// INTERFACES
	// =====================
	interface Cliente {
		id: string;
		nit: string;
		nombre: string;
		representante: string | null;
		cedula: string | null;
		telefono: string;
		direccion: string;
	}

	interface Vehiculo {
		id: string;
		placa: string;
		modelo: string | null;
		marca: string | null;
		linea: string | null;
		clase_vehiculo: string;
		color: string | null;
	}

	interface Conductor {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
		categoria_licencia: string | null;
		vencimiento_licencia: string | null;
	}

	interface ExtractoConductor {
		nombre: string;
		cedula: string;
		licencia_conduccion: string;
		vigencia_licencia: string;
	}

	interface ExtractoData {
		numero_contrato: string;
		numero_extracto: string;
		codigo_formato: string;
		version_formato: string;
		contratante_nombre: string;
		contratante_nit: string;
		objeto_contrato: string;
		origen: string;
		destino: string;
		fecha_inicial: string;
		fecha_vencimiento: string;
		placa: string;
		modelo_vehiculo: string;
		marca_vehiculo: string;
		clase_vehiculo: string;
		numero_tarjeta_operacion: string;
		numero_interno: string;
		conductores: ExtractoConductor[];
		responsable_nombre: string;
		responsable_cedula: string;
		responsable_telefono: string;
		responsable_direccion: string;
	}

	interface ExtractoHistorico {
		consecutivo: string;
		contratante: string;
		origen_destino: string;
		fecha_inicial: string;
		fecha_final: string;
		placa: string;
		num_interno: string;
		num_tarjeta_operacion: string;
		conductor_1: string;
		vigencia_pase_1: string;
		conductor_2: string;
		vigencia_pase_2: string;
		conductor_3: string;
		vigencia_pase_3: string;
	}

	interface MatchesData {
		placaMap: Record<string, string>;
		clienteMap: Record<string, string>;
		conductorMap: Record<string, string>;
		stats: {
			totalExtractos: number;
			uniquePlacas: number;
			uniqueContratantes: number;
			uniqueConductores: number;
			matchedPlacas: number;
			matchedContratantes: number;
			matchedConductores: number;
		};
	}

	// =====================
	// TABS
	// =====================
	type TabId = 'historial' | 'crear';
	let activeTab: TabId = 'historial';

	// =====================
	// STATE - HISTORIAL
	// =====================
	let extractosHistoricos: ExtractoHistorico[] = [];
	let matches: MatchesData | null = null;
	let loadingHistorial = false;
	let loadingMatches = false;
	let syncing = false;
	let pagination = {
		page: 1,
		limit: 50,
		total: 0,
		pages: 0,
		hasNext: false,
		hasPrev: false
	};

	// Filters
	let searchTerm = '';
	let filterContratante = '';
	let filterPlaca = '';
	let filterConductor = '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	// =====================
	// STATE - CREAR
	// =====================
	let generatingPdf = false;

	let extracto: ExtractoData = {
		numero_contrato: '',
		numero_extracto: '',
		codigo_formato: 'OP-FR-04',
		version_formato: '5',
		contratante_nombre: '',
		contratante_nit: '',
		objeto_contrato: 'CONTRATO PARA TRANSPORTE DE PERSONAL',
		origen: '',
		destino: '',
		fecha_inicial: '',
		fecha_vencimiento: '',
		placa: '',
		modelo_vehiculo: '',
		marca_vehiculo: '',
		clase_vehiculo: '',
		numero_tarjeta_operacion: '',
		numero_interno: '',
		conductores: [
			{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' },
			{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' },
			{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' }
		],
		responsable_nombre: '',
		responsable_cedula: '',
		responsable_telefono: '',
		responsable_direccion: ''
	};

	let clientes: Cliente[] = [];
	let vehiculos: Vehiculo[] = [];
	let conductoresList: Conductor[] = [];

	let clienteSearch = '';
	let vehiculoSearch = '';
	let conductorSearch: string[] = ['', '', ''];
	let showClienteDropdown = false;
	let showVehiculoDropdown = false;
	let showConductorDropdown: boolean[] = [false, false, false];

	let extractosGenerados: {
		fecha: string;
		contrato: string;
		contratante: string;
		placa: string;
	}[] = [];

	let showPdfModal = false;

	// =====================
	// COMPUTED
	// =====================
	$: clientesFiltrados = clientes.filter(
		(c) =>
			c.nombre?.toLowerCase().includes(clienteSearch.toLowerCase()) ||
			c.nit?.toLowerCase().includes(clienteSearch.toLowerCase())
	);

	$: vehiculosFiltrados = vehiculos.filter(
		(v) =>
			v.placa?.toLowerCase().includes(vehiculoSearch.toLowerCase()) ||
			v.marca?.toLowerCase().includes(vehiculoSearch.toLowerCase()) ||
			v.linea?.toLowerCase().includes(vehiculoSearch.toLowerCase())
	);

	$: conductoresFiltradosPor = (index: number) =>
		conductoresList.filter(
			(c) =>
				`${c.nombre} ${c.apellido}`
					.toLowerCase()
					.includes(conductorSearch[index]?.toLowerCase() || '') ||
				c.numero_identificacion?.includes(conductorSearch[index] || '')
		);

	$: formValid =
		extracto.numero_contrato.trim() !== '' &&
		extracto.contratante_nombre.trim() !== '' &&
		extracto.placa.trim() !== '' &&
		extracto.conductores[0].nombre.trim() !== '';

	// =====================
	// MATCHING HELPERS
	// =====================
	function normalizeStr(str: string): string {
		return str
			.toUpperCase()
			.trim()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, ' ');
	}

	function isPlacaMatched(placa: string): boolean {
		if (!matches || !placa) return false;
		return !!matches.placaMap[placa.toUpperCase().trim()];
	}

	function getPlacaId(placa: string): string {
		if (!matches || !placa) return '';
		return matches.placaMap[placa.toUpperCase().trim()] || '';
	}

	function isContratanteMatched(contratante: string): boolean {
		if (!matches || !contratante) return false;
		return !!matches.clienteMap[normalizeStr(contratante)];
	}

	function getContratanteId(contratante: string): string {
		if (!matches || !contratante) return '';
		return matches.clienteMap[normalizeStr(contratante)] || '';
	}

	function isConductorMatched(conductor: string): boolean {
		if (!matches || !conductor) return false;
		return !!matches.conductorMap[normalizeStr(conductor)];
	}

	function getConductorId(conductor: string): string {
		if (!matches || !conductor) return '';
		return matches.conductorMap[normalizeStr(conductor)] || '';
	}

	function shortUUID(uuid: string): string {
		if (!uuid) return '';
		return uuid.substring(0, 8);
	}

	// =====================
	// LIFECYCLE
	// =====================
	onMount(async () => {
		await Promise.all([loadHistorial(), syncAndLoadMatches(), loadFormData(), loadNextConsecutivo()]);
	});

	// =====================
	// DATA LOADING
	// =====================
	let nextConsecutivo: number | null = null;

	async function loadNextConsecutivo() {
		try {
			const res = await extractosAPI.getNextConsecutivo();
			nextConsecutivo = res.data?.consecutivo || null;
			if (nextConsecutivo && !extracto.numero_contrato) {
				extracto.numero_contrato = nextConsecutivo.toString();
			}
		} catch (err: any) {
			console.error('Error cargando siguiente consecutivo:', err);
		}
	}

	async function loadHistorial(page = 1) {
		loadingHistorial = true;
		try {
			const params: Record<string, any> = { page, limit: pagination.limit };
			if (searchTerm) params.search = searchTerm;
			if (filterContratante) params.contratante = filterContratante;
			if (filterPlaca) params.placa = filterPlaca;
			if (filterConductor) params.conductor = filterConductor;

			const res = await extractosAPI.getAll(params);
			extractosHistoricos = res.data?.data || [];
			if (res.data?.pagination) {
				pagination = res.data.pagination;
			}
		} catch (err: any) {
			console.error('Error cargando historial:', err);
			toast.error('Error cargando extractos históricos');
		} finally {
			loadingHistorial = false;
		}
	}

	async function syncAndLoadMatches() {
		loadingMatches = true;
		syncing = true;
		try {
			const res = await extractosAPI.syncToDatabase();
			matches = res.data || null;
			if (res.data?.created) {
				const c = res.data.created;
				const total = c.clientes + c.vehiculos + c.conductores;
				if (total > 0) {
					toast.success(
						`Sincronizado: ${c.clientes} contratantes, ${c.vehiculos} vehículos, ${c.conductores} conductores creados`
					);
					await loadFormData();
				}
			}
		} catch (err: any) {
			console.error('Error sincronizando:', err);
			try {
				const res = await extractosAPI.getMatches();
				matches = res.data || null;
			} catch {
				console.error('Error cargando matches fallback');
			}
		} finally {
			loadingMatches = false;
			syncing = false;
		}
	}

	async function loadFormData() {
		try {
			const [clientesRes, vehiculosRes, conductoresRes] = await Promise.all([
				clientesAPI.getAll({ limit: 1000 }),
				vehiculosAPI.getAll(),
				conductoresAPI.getAll({ limit: 1000 })
			]);
			clientes = clientesRes.data?.data || clientesRes.data || [];
			vehiculos = vehiculosRes.data?.data || vehiculosRes.data || [];
			const allConductores: Conductor[] = conductoresRes.data?.data || conductoresRes.data || [];
			conductoresList = allConductores.filter(
				(c) => !c.numero_identificacion?.startsWith('EXT-')
			);
		} catch (err: any) {
			console.error('Error cargando datos del formulario:', err);
		}
	}

	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			loadHistorial(1);
		}, 400);
	}

	function clearFilters() {
		searchTerm = '';
		filterContratante = '';
		filterPlaca = '';
		filterConductor = '';
		loadHistorial(1);
	}

	// =====================
	// TABLE ACTIONS
	// =====================
	function fillFromHistorical(ext: ExtractoHistorico) {
		const od = ext.origen_destino || '';
		const cleaned = od.replace(/\(VICEVERSA\)/gi, '').trim();
		const dashParts = cleaned.split(' - ');
		let origen = '';
		let destino = '';
		if (dashParts.length >= 4) {
			origen = `${dashParts[0].trim()} - ${dashParts[1].trim()}`;
			destino = dashParts.slice(2).join(' - ').trim();
		} else if (dashParts.length >= 2) {
			origen = dashParts[0].trim();
			destino = dashParts.slice(1).join(' - ').trim();
		} else {
			origen = cleaned;
		}

		const parseDate = (d: string) => {
			if (!d) return '';
			const p = d.split('/');
			if (p.length === 3) {
				const day = p[0].padStart(2, '0');
				const month = p[1].padStart(2, '0');
				let year = p[2];
				if (year.length === 2) year = (parseInt(year) > 50 ? '19' : '20') + year;
				return `${year}-${month}-${day}`;
			}
			return '';
		};

		let contratanteNombre = ext.contratante;

		extracto = {
			numero_contrato: ext.consecutivo,
			numero_extracto: '',
			codigo_formato: 'OP-FR-04',
			version_formato: '5',
			contratante_nombre: contratanteNombre,
			contratante_nit: '',
			objeto_contrato: 'CONTRATO PARA TRANSPORTE DE PERSONAL',
			origen,
			destino,
			fecha_inicial: parseDate(ext.fecha_inicial),
			fecha_vencimiento: parseDate(ext.fecha_final),
			placa: ext.placa,
			modelo_vehiculo: '',
			marca_vehiculo: '',
			clase_vehiculo: '',
			numero_tarjeta_operacion: ext.num_tarjeta_operacion,
			numero_interno: ext.num_interno,
			conductores: [
				{
					nombre: ext.conductor_1 || '',
					cedula: '',
					licencia_conduccion: '',
					vigencia_licencia: ext.vigencia_pase_1 || ''
				},
				{
					nombre: ext.conductor_2 || '',
					cedula: '',
					licencia_conduccion: '',
					vigencia_licencia: ext.vigencia_pase_2 || ''
				},
				{
					nombre: ext.conductor_3 || '',
					cedula: '',
					licencia_conduccion: '',
					vigencia_licencia: ext.vigencia_pase_3 || ''
				}
			],
			responsable_nombre: '',
			responsable_cedula: '',
			responsable_telefono: '',
			responsable_direccion: ''
		};

		// Auto-fill from DB - Vehicle
		const matchedVehiculo = vehiculos.find(
			(v) => v.placa.toUpperCase() === ext.placa.toUpperCase()
		);
		if (matchedVehiculo) {
			extracto.modelo_vehiculo = matchedVehiculo.modelo || '';
			extracto.marca_vehiculo = matchedVehiculo.marca || '';
			extracto.clase_vehiculo = matchedVehiculo.clase_vehiculo || '';
			vehiculoSearch = matchedVehiculo.placa;
		} else {
			vehiculoSearch = ext.placa;
		}

		// Auto-fill from DB - Cliente
		const matchedCliente = clientes.find((c) => {
			const n = normalizeStr(c.nombre || '');
			return (
				n === normalizeStr(contratanteNombre) ||
				n === normalizeStr(ext.contratante)
			);
		});
		if (matchedCliente) {
			extracto.contratante_nombre = matchedCliente.nombre || contratanteNombre;
			extracto.contratante_nit = matchedCliente.nit || '';
			extracto.responsable_nombre = matchedCliente.representante || '';
			extracto.responsable_cedula = matchedCliente.cedula || '';
			extracto.responsable_telefono = matchedCliente.telefono || '';
			extracto.responsable_direccion = matchedCliente.direccion || '';
			clienteSearch = matchedCliente.nombre || '';
		} else {
			clienteSearch = contratanteNombre;
		}

		// Auto-fill from DB - Conductores
		for (let i = 0; i < 3; i++) {
			const condName = extracto.conductores[i].nombre;
			if (condName) {
				const normalizedName = normalizeStr(condName);
				const extWords = normalizedName.split(' ').filter(Boolean);
				let matchedCond = conductoresList.find(
					(c) => normalizeStr(`${c.nombre} ${c.apellido}`) === normalizedName
				);
				if (!matchedCond) {
					const sortedExt = [...extWords].sort().join(' ');
					matchedCond = conductoresList.find((c) => {
						const dbWords = normalizeStr(`${c.nombre} ${c.apellido}`).split(' ').filter(Boolean).sort().join(' ');
						return dbWords === sortedExt;
					});
				}
				if (!matchedCond && extWords.length >= 2) {
					matchedCond = conductoresList.find((c) => {
						const fullName = normalizeStr(`${c.nombre} ${c.apellido}`);
						return extWords.every((w) => fullName.includes(w));
					});
				}
				if (matchedCond) {
					extracto.conductores[i].cedula = matchedCond.numero_identificacion;
					extracto.conductores[i].licencia_conduccion =
						matchedCond.categoria_licencia || '';
				}
				conductorSearch[i] = condName;
			} else {
				conductorSearch[i] = '';
			}
		}

		activeTab = 'crear';
		toast.success(`Extracto ${ext.consecutivo} cargado en el formulario`);
	}

	// =====================
	// AUTOCOMPLETE HANDLERS
	// =====================
	function selectCliente(cliente: Cliente) {
		extracto.contratante_nombre = cliente.nombre || '';
		extracto.contratante_nit = cliente.nit || '';
		extracto.responsable_nombre = cliente.representante || '';
		extracto.responsable_cedula = cliente.cedula || '';
		extracto.responsable_telefono = cliente.telefono || '';
		extracto.responsable_direccion = cliente.direccion || '';
		clienteSearch = cliente.nombre || '';
		showClienteDropdown = false;
	}

	function selectVehiculo(vehiculo: Vehiculo) {
		extracto.placa = vehiculo.placa || '';
		extracto.modelo_vehiculo = vehiculo.modelo || '';
		extracto.marca_vehiculo = vehiculo.marca || '';
		extracto.clase_vehiculo = vehiculo.clase_vehiculo || '';
		vehiculoSearch = vehiculo.placa || '';
		showVehiculoDropdown = false;
	}

	function selectConductor(conductor: Conductor, index: number) {
		extracto.conductores[index] = {
			nombre: `${conductor.nombre} ${conductor.apellido}`,
			cedula: conductor.numero_identificacion,
			licencia_conduccion: conductor.categoria_licencia || '',
			vigencia_licencia: conductor.vencimiento_licencia
				? new Date(conductor.vencimiento_licencia).toLocaleDateString('es-CO')
				: ''
		};
		conductorSearch[index] = `${conductor.nombre} ${conductor.apellido}`;
		showConductorDropdown[index] = false;
		showConductorDropdown = [...showConductorDropdown];
	}

	function clearConductor(index: number) {
		extracto.conductores[index] = {
			nombre: '',
			cedula: '',
			licencia_conduccion: '',
			vigencia_licencia: ''
		};
		conductorSearch[index] = '';
	}

	// =====================
	// PDF GENERATION
	// =====================
	async function generatePDF() {
		if (!formValid) {
			toast.error(
				'Complete los campos obligatorios: Nº Contrato, Contratante, Placa y al menos un conductor'
			);
			return;
		}

		generatingPdf = true;

		try {
			const pdfMake = (await import('pdfmake/build/pdfmake')).default;
			const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
			(pdfMake as any).vfs = pdfFonts.pdfMake
				? pdfFonts.pdfMake.vfs
				: pdfFonts.vfs || pdfFonts;

			let logoBase64 = '';
			try {
				const response = await fetch('/assets/logo.png');
				const blob = await response.blob();
				logoBase64 = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(blob);
				});
			} catch {
				console.warn('No se pudo cargar el logo');
			}

			const formatDateForDoc = (dateStr: string) => {
				if (!dateStr) return { dia: '___', mes: '___', anio: '___' };
				const d = new Date(dateStr + 'T00:00:00');
				return {
					dia: String(d.getDate()).padStart(2, '0'),
					mes: String(d.getMonth() + 1).padStart(2, '0'),
					anio: String(d.getFullYear())
				};
			};

			const fechaIni = formatDateForDoc(extracto.fecha_inicial);
			const fechaVen = formatDateForDoc(extracto.fecha_vencimiento);

			const conductorRows: any[] = [];
			for (let i = 0; i < 3; i++) {
				const c = extracto.conductores[i];
				conductorRows.push([
					{
						text: `CONDUCTOR ${i + 1}`,
						style: 'labelCell',
						fillColor: '#FFF3E0',
						colSpan: 2
					},
					{},
					{ text: c.nombre || '', style: 'valueCell', colSpan: 6 },
					{},
					{},
					{},
					{},
					{}
				]);
				conductorRows.push([
					{ text: 'CÉDULA', style: 'labelCell', fillColor: '#FFF3E0' },
					{ text: c.cedula || '', style: 'valueCell' },
					{
						text: 'LICENCIA CONDUCCIÓN',
						style: 'labelCell',
						fillColor: '#FFF3E0',
						colSpan: 2
					},
					{},
					{ text: c.licencia_conduccion || '', style: 'valueCell', colSpan: 2 },
					{},
					{ text: 'VIGENCIA', style: 'labelCell', fillColor: '#FFF3E0' },
					{ text: c.vigencia_licencia || '', style: 'valueCell' }
				]);
			}

			const docDefinition: any = {
				pageSize: 'LETTER',
				pageMargins: [30, 30, 30, 60],
				content: [
					{
						table: {
							widths: [80, '*', 130],
							body: [
								[
									logoBase64
										? {
												image: logoBase64,
												width: 65,
												height: 50,
												rowSpan: 3,
												alignment: 'center',
												margin: [0, 5, 0, 5]
											}
										: {
												text: 'COTRANSMEQ',
												bold: true,
												fontSize: 8,
												rowSpan: 3,
												alignment: 'center',
												margin: [0, 15, 0, 0]
											},
									{
										text: 'MINISTERIO DE TRANSPORTE',
										style: 'headerTitle',
										alignment: 'center',
										margin: [0, 2, 0, 0]
									},
									{
										text: `Código: ${extracto.codigo_formato}`,
										style: 'headerMeta',
										alignment: 'center',
										margin: [0, 2, 0, 0]
									}
								],
								[
									{},
									{
										text: 'FORMATO ÚNICO DE EXTRACTO\nDEL CONTRATO',
										style: 'headerSubtitle',
										alignment: 'center',
										bold: true
									},
									{
										text: `Versión: ${extracto.version_formato}`,
										style: 'headerMeta',
										alignment: 'center'
									}
								],
								[
									{},
									{
										text: 'COTRANSMEQ S.A.S.',
										style: 'headerCompany',
										alignment: 'center',
										bold: true,
										margin: [0, 0, 0, 2]
									},
									{
										text: 'Página: 1 de 1',
										style: 'headerMeta',
										alignment: 'center'
									}
								]
							]
						},
						layout: {
							hLineWidth: () => 0.8,
							vLineWidth: () => 0.8,
							hLineColor: () => '#E65100',
							vLineColor: () => '#E65100'
						}
					},
					{ text: '', margin: [0, 6, 0, 0] },
					{
						table: {
							widths: ['*'],
							body: [
								[
									{
										text: [
											{ text: 'EXTRACTO DEL CONTRATO Nº ', bold: true, fontSize: 11 },
											{
												text: extracto.numero_contrato || '________',
												bold: true,
												fontSize: 11,
												color: '#E65100'
											}
										],
										alignment: 'center',
										fillColor: '#FFF3E0',
										margin: [0, 4, 0, 4]
									}
								]
							]
						},
						layout: {
							hLineWidth: () => 0.8,
							vLineWidth: () => 0.8,
							hLineColor: () => '#E65100',
							vLineColor: () => '#E65100'
						}
					},
					{ text: '', margin: [0, 4, 0, 0] },
					{
						table: {
							widths: [75, 90, 50, 55, 60, 55, 50, '*'],
							body: [
								[
									{
										text: 'CONTRATANTE',
										style: 'labelCell',
										fillColor: '#FFF3E0',
										colSpan: 2
									},
									{},
									{
										text: extracto.contratante_nombre || '',
										style: 'valueCell',
										colSpan: 4
									},
									{},
									{},
									{},
									{ text: 'NIT', style: 'labelCell', fillColor: '#FFF3E0' },
									{ text: extracto.contratante_nit || '', style: 'valueCell' }
								],
								[
									{
										text: 'OBJETO DEL CONTRATO',
										style: 'labelCell',
										fillColor: '#FFF3E0',
										colSpan: 2
									},
									{},
									{
										text: extracto.objeto_contrato || '',
										style: 'valueCell',
										colSpan: 6
									},
									{},
									{},
									{},
									{},
									{}
								],
								[
									{ text: 'ORIGEN', style: 'labelCell', fillColor: '#FFF3E0' },
									{
										text: extracto.origen || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{},
									{ text: 'DESTINO', style: 'labelCell', fillColor: '#FFF3E0' },
									{
										text: extracto.destino || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{}
								],
								[
									{
										text: 'VIGENCIA DEL CONTRATO',
										style: 'labelCell',
										fillColor: '#FFE0B2',
										colSpan: 8,
										alignment: 'center',
										bold: true
									},
									{},
									{},
									{},
									{},
									{},
									{},
									{}
								],
								[
									{
										text: 'FECHA INICIAL',
										style: 'labelCell',
										fillColor: '#FFF3E0'
									},
									{
										text: `DÍA: ${fechaIni.dia}`,
										style: 'valueCell',
										alignment: 'center'
									},
									{
										text: `MES: ${fechaIni.mes}`,
										style: 'valueCell',
										alignment: 'center'
									},
									{
										text: `AÑO: ${fechaIni.anio}`,
										style: 'valueCell',
										alignment: 'center'
									},
									{
										text: 'FECHA VENCIMIENTO',
										style: 'labelCell',
										fillColor: '#FFF3E0'
									},
									{
										text: `DÍA: ${fechaVen.dia}`,
										style: 'valueCell',
										alignment: 'center'
									},
									{
										text: `MES: ${fechaVen.mes}`,
										style: 'valueCell',
										alignment: 'center'
									},
									{
										text: `AÑO: ${fechaVen.anio}`,
										style: 'valueCell',
										alignment: 'center'
									}
								],
								[
									{
										text: 'DATOS DEL VEHÍCULO',
										style: 'labelCell',
										fillColor: '#FFE0B2',
										colSpan: 8,
										alignment: 'center',
										bold: true
									},
									{},
									{},
									{},
									{},
									{},
									{},
									{}
								],
								[
									{ text: 'PLACA', style: 'labelCell', fillColor: '#FFF3E0' },
									{
										text: extracto.placa || '',
										style: 'valueCell',
										bold: true,
										fontSize: 10
									},
									{ text: 'MODELO', style: 'labelCell', fillColor: '#FFF3E0' },
									{ text: extracto.modelo_vehiculo || '', style: 'valueCell' },
									{ text: 'MARCA', style: 'labelCell', fillColor: '#FFF3E0' },
									{ text: extracto.marca_vehiculo || '', style: 'valueCell' },
									{ text: 'CLASE', style: 'labelCell', fillColor: '#FFF3E0' },
									{ text: extracto.clase_vehiculo || '', style: 'valueCell' }
								],
								[
									{
										text: 'TARJETA DE OPERACIÓN',
										style: 'labelCell',
										fillColor: '#FFF3E0',
										colSpan: 2
									},
									{},
									{
										text: extracto.numero_tarjeta_operacion || '',
										style: 'valueCell',
										colSpan: 2
									},
									{},
									{
										text: 'Nº INTERNO',
										style: 'labelCell',
										fillColor: '#FFF3E0',
										colSpan: 2
									},
									{},
									{
										text: extracto.numero_interno || '',
										style: 'valueCell',
										colSpan: 2
									},
									{}
								],
								[
									{
										text: 'DATOS DE LOS CONDUCTORES',
										style: 'labelCell',
										fillColor: '#FFE0B2',
										colSpan: 8,
										alignment: 'center',
										bold: true
									},
									{},
									{},
									{},
									{},
									{},
									{},
									{}
								],
								...conductorRows,
								[
									{
										text: 'RESPONSABLE DEL CONTRATANTE',
										style: 'labelCell',
										fillColor: '#FFE0B2',
										colSpan: 8,
										alignment: 'center',
										bold: true
									},
									{},
									{},
									{},
									{},
									{},
									{},
									{}
								],
								[
									{ text: 'NOMBRE', style: 'labelCell', fillColor: '#FFF3E0' },
									{
										text: extracto.responsable_nombre || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{},
									{ text: 'CÉDULA', style: 'labelCell', fillColor: '#FFF3E0' },
									{
										text: extracto.responsable_cedula || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{}
								],
								[
									{
										text: 'TELÉFONO',
										style: 'labelCell',
										fillColor: '#FFF3E0'
									},
									{
										text: extracto.responsable_telefono || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{},
									{
										text: 'DIRECCIÓN',
										style: 'labelCell',
										fillColor: '#FFF3E0'
									},
									{
										text: extracto.responsable_direccion || '',
										style: 'valueCell',
										colSpan: 3
									},
									{},
									{}
								]
							]
						},
						layout: {
							hLineWidth: () => 0.6,
							vLineWidth: () => 0.6,
							hLineColor: () => '#E65100',
							vLineColor: () => '#E65100',
							paddingLeft: () => 4,
							paddingRight: () => 4,
							paddingTop: () => 3,
							paddingBottom: () => 3
						}
					},
					{ text: '', margin: [0, 8, 0, 0] },
					{
						table: {
							widths: ['*'],
							body: [
								[
									{
										text: [
											{ text: 'Nº DE EXTRACTO: ', bold: true, fontSize: 9 },
											{
												text:
													extracto.numero_extracto || '________________________',
												fontSize: 9,
												color: '#E65100'
											}
										],
										alignment: 'center',
										margin: [0, 3, 0, 3],
										fillColor: '#FFF8E1'
									}
								]
							]
						},
						layout: {
							hLineWidth: () => 0.6,
							vLineWidth: () => 0.6,
							hLineColor: () => '#E65100',
							vLineColor: () => '#E65100'
						}
					},
					{ text: '', margin: [0, 15, 0, 0] },
					{
						columns: [
							{ width: '*', text: '' },
							{
								width: 250,
								stack: [
									{
										canvas: [
											{
												type: 'line',
												x1: 0,
												y1: 0,
												x2: 220,
												y2: 0,
												lineWidth: 0.8,
												lineColor: '#333'
											}
										]
									},
									{
										text: 'COTRANSMEQ S.A.S.',
										bold: true,
										fontSize: 9,
										alignment: 'center',
										margin: [0, 3, 0, 0]
									},
									{
										text: 'COOPERATIVA DE TRANSPORTADORES DE MAQUINARIA Y EQUIPO',
										fontSize: 7,
										alignment: 'center',
										color: '#666',
										margin: [0, 2, 0, 0]
									}
								]
							},
							{ width: '*', text: '' }
						]
					}
				],
				styles: {
					headerTitle: { fontSize: 8, bold: true, color: '#E65100' },
					headerSubtitle: { fontSize: 10, bold: true, color: '#E65100' },
					headerCompany: { fontSize: 9, bold: true, color: '#F57C00' },
					headerMeta: { fontSize: 8, color: '#555' },
					labelCell: { fontSize: 7.5, bold: true, color: '#E65100' },
					valueCell: { fontSize: 8.5 }
				},
				defaultStyle: { font: 'Roboto' }
			};

			pdfMake
				.createPdf(docDefinition)
				.download(
					`Extracto_Contrato_${extracto.numero_contrato || 'SN'}_${extracto.placa || 'SN'}.pdf`
				);

			// Save to backend
			try {
				const formatDateToFile = (dateStr: string) => {
					if (!dateStr) return '';
					const parts = dateStr.split('-');
					if (parts.length === 3) {
						return `${parts[2]}/${parts[1]}/${parts[0]}`;
					}
					return dateStr;
				};

				const origenDestino = [extracto.origen, extracto.destino]
					.filter(Boolean)
					.join(' - ');

				await extractosAPI.create({
					contratante: extracto.contratante_nombre,
					origen_destino: origenDestino || '',
					fecha_inicial: formatDateToFile(extracto.fecha_inicial),
					fecha_final: formatDateToFile(extracto.fecha_vencimiento),
					placa: extracto.placa,
					num_interno: extracto.numero_interno,
					num_tarjeta_operacion: extracto.numero_tarjeta_operacion,
					conductor_1: extracto.conductores[0]?.nombre || '',
					vigencia_pase_1: extracto.conductores[0]?.vigencia_licencia || '',
					conductor_2: extracto.conductores[1]?.nombre || '',
					vigencia_pase_2: extracto.conductores[1]?.vigencia_licencia || '',
					conductor_3: extracto.conductores[2]?.nombre || '',
					vigencia_pase_3: extracto.conductores[2]?.vigencia_licencia || ''
				});

				await loadNextConsecutivo();
				await loadHistorial(1);
			} catch (saveErr: any) {
				console.error('Error guardando extracto:', saveErr);
				toast.error('PDF generado pero error al guardar en historial');
			}

			extractosGenerados = [
				{
					fecha: new Date().toLocaleString('es-CO'),
					contrato: extracto.numero_contrato,
					contratante: extracto.contratante_nombre,
					placa: extracto.placa
				},
				...extractosGenerados
			];

			toast.success('PDF generado y extracto guardado exitosamente');
		} catch (err: any) {
			console.error('Error generando PDF:', err);
			toast.error('Error generando PDF: ' + (err.message || 'Error desconocido'));
		} finally {
			generatingPdf = false;
		}
	}

	// =====================
	// UTILS
	// =====================
	function resetForm() {
		loadNextConsecutivo();
		extracto = {
			numero_contrato: nextConsecutivo ? nextConsecutivo.toString() : '',
			numero_extracto: '',
			codigo_formato: 'OP-FR-04',
			version_formato: '5',
			contratante_nombre: '',
			contratante_nit: '',
			objeto_contrato: 'CONTRATO PARA TRANSPORTE DE PERSONAL',
			origen: '',
			destino: '',
			fecha_inicial: '',
			fecha_vencimiento: '',
			placa: '',
			modelo_vehiculo: '',
			marca_vehiculo: '',
			clase_vehiculo: '',
			numero_tarjeta_operacion: '',
			numero_interno: '',
			conductores: [
				{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' },
				{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' },
				{ nombre: '', cedula: '', licencia_conduccion: '', vigencia_licencia: '' }
			],
			responsable_nombre: '',
			responsable_cedula: '',
			responsable_telefono: '',
			responsable_direccion: ''
		};
		clienteSearch = '';
		vehiculoSearch = '';
		conductorSearch = ['', '', ''];
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.autocomplete-wrapper')) {
			showClienteDropdown = false;
			showVehiculoDropdown = false;
			showConductorDropdown = [false, false, false];
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div
	class="min-h-screen p-4 lg:p-6"
	in:fade={{ duration: 300 }}
>
	<!-- Header -->
	<div class="glass mb-5 rounded-2xl border border-gray-200/50 p-6" in:fly={{ y: -20, duration: 400 }}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-2xl font-bold text-gray-900 lg:text-3xl">
					Extractos de Contrato
				</h1>
				<p class="mt-1 text-sm text-gray-500">
					Formato Único — Ministerio de Transporte ·
					{matches?.stats?.totalExtractos?.toLocaleString() || '...'} registros históricos
					{#if syncing}
						<span class="ml-2 inline-flex items-center gap-1 text-amber-600">
							<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"/>
								<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"/>
							</svg>
							sincronizando con BD…
						</span>
					{/if}
				</p>
			</div>

			<!-- Tabs -->
			<div class="flex rounded-xl border border-gray-200 bg-gray-100 p-1">
				<button
					type="button"
					class="rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab ===
					'historial'
						? 'bg-white text-orange-700 shadow-sm'
						: 'text-gray-500 hover:text-gray-700'}"
					on:click={() => (activeTab = 'historial')}
				>
					<svg
						class="mr-1.5 inline h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 10h16M4 14h16M4 18h16"
						/>
					</svg>
					Historial
				</button>
				<button
					type="button"
					class="rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab ===
					'crear'
						? 'bg-white text-orange-700 shadow-sm'
						: 'text-gray-500 hover:text-gray-700'}"
					on:click={() => (activeTab = 'crear')}
				>
					<svg
						class="mr-1.5 inline h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Crear / Editar
				</button>
			</div>
		</div>
	</div>

	<!-- STATS BAR -->
	{#if matches?.stats}
		<div
			class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
			in:fly={{ y: 10, duration: 300, delay: 100 }}
		>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-gray-900">
					{matches.stats.totalExtractos.toLocaleString()}
				</div>
				<div class="text-[10px] text-gray-500">Extractos</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-gray-900">{matches.stats.uniquePlacas}</div>
				<div class="text-[10px] text-gray-500">Placas únicas</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-orange-600">{matches.stats.matchedPlacas}</div>
				<div class="text-[10px] text-gray-500">Placas en BD</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-gray-900">{matches.stats.uniqueContratantes}</div>
				<div class="text-[10px] text-gray-500">Contratantes</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-orange-600">
					{matches.stats.matchedContratantes}
				</div>
				<div class="text-[10px] text-gray-500">Clientes en BD</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-gray-900">{matches.stats.uniqueConductores}</div>
				<div class="text-[10px] text-gray-500">Conductores</div>
			</div>
			<div class="glass rounded-xl border border-gray-200/50 px-3 py-2.5 text-center">
				<div class="text-lg font-bold text-orange-600">
					{matches.stats.matchedConductores}
				</div>
				<div class="text-[10px] text-gray-500">Conductores en BD</div>
			</div>
		</div>
	{/if}

	<!-- ================= TAB: HISTORIAL ================= -->
	{#if activeTab === 'historial'}
		<div in:fade={{ duration: 200 }}>
			<!-- Filters -->
			<div class="glass mb-4 rounded-2xl border border-gray-200/50 p-4">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
					<div class="lg:col-span-2">
						<label
							for="search"
							class="mb-1 block text-[10px] font-medium uppercase text-gray-500"
							>Buscar</label
						>
						<input
							id="search"
							type="text"
							bind:value={searchTerm}
							on:input={handleSearch}
							placeholder="Nº, contratante, placa, conductor, ruta..."
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
						/>
					</div>
					<div>
						<label
							for="f_contratante"
							class="mb-1 block text-[10px] font-medium uppercase text-gray-500"
							>Contratante</label
						>
						<input
							id="f_contratante"
							type="text"
							bind:value={filterContratante}
							on:input={handleSearch}
							placeholder="Nombre empresa..."
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
						/>
					</div>
					<div>
						<label
							for="f_placa"
							class="mb-1 block text-[10px] font-medium uppercase text-gray-500"
							>Placa</label
						>
						<input
							id="f_placa"
							type="text"
							bind:value={filterPlaca}
							on:input={handleSearch}
							placeholder="ABC123"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm uppercase text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
						/>
					</div>
					<div>
						<label
							for="f_conductor"
							class="mb-1 block text-[10px] font-medium uppercase text-gray-500"
							>Conductor</label
						>
						<div class="flex gap-2">
							<input
								id="f_conductor"
								type="text"
								bind:value={filterConductor}
								on:input={handleSearch}
								placeholder="Nombre..."
								class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
							/>
							{#if searchTerm || filterContratante || filterPlaca || filterConductor}
								<button
									type="button"
									class="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
									on:click={clearFilters}
									title="Limpiar filtros"
								>
									✕
								</button>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Table -->
			<div
				class="glass overflow-hidden rounded-2xl border border-gray-200/50"
			>
				{#if loadingHistorial}
					<div class="flex h-48 items-center justify-center">
						<div
							class="h-8 w-8 animate-spin rounded-full border-[3px] border-orange-200 border-t-orange-600"
						></div>
					</div>
				{:else if extractosHistoricos.length === 0}
					<div class="flex h-48 flex-col items-center justify-center text-gray-400">
						<svg
							class="mb-2 h-10 w-10"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						<p class="text-sm">No se encontraron extractos</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[1200px] text-left text-sm">
							<thead>
								<tr class="border-b border-gray-200 bg-gray-50">
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Nº</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Contratante</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Origen - Destino</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Fechas</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Placa</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Int.</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Conductor 1</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Conductor 2</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600">Conductor 3</th>
									<th class="px-3 py-3 text-[10px] font-semibold uppercase text-gray-600"></th>
								</tr>
							</thead>
							<tbody>
								{#each extractosHistoricos as ext, idx (ext.consecutivo + '-' + idx)}
									<tr
										class="border-b border-gray-100 transition-colors hover:bg-orange-50/50 {idx %
											2 ===
										0
											? 'bg-white'
											: 'bg-gray-50/50'}"
									>
										<td class="px-3 py-2.5 font-mono text-xs font-bold text-orange-600">
											{ext.consecutivo}
										</td>
										<td class="max-w-[180px] px-3 py-2.5">
											<div class="flex items-center gap-1.5">
												{#if isContratanteMatched(ext.contratante)}
													<span
														class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500"
														title="Registrado en BD"
													></span>
												{:else}
													<span
														class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400"
														title="No encontrado en BD"
													></span>
												{/if}
												<span
													class="truncate text-xs text-gray-700"
													title={ext.contratante}
												>
													{ext.contratante}
												</span>
											</div>
											{#if getContratanteId(ext.contratante)}
												<div
													class="mt-0.5 font-mono text-[9px] text-orange-600/50"
													title={getContratanteId(ext.contratante)}
												>
													{shortUUID(getContratanteId(ext.contratante))}…
												</div>
											{/if}
										</td>
										<td class="max-w-[220px] px-3 py-2.5">
											<span
												class="line-clamp-2 text-[11px] text-gray-500"
												title={ext.origen_destino}
											>
												{ext.origen_destino}
											</span>
										</td>
										<td class="px-3 py-2.5 text-[11px] text-gray-500">
											<div>{ext.fecha_inicial}</div>
											<div class="text-gray-400">{ext.fecha_final}</div>
										</td>
										<td class="px-3 py-2.5">
											<span
												class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold {isPlacaMatched(
													ext.placa
												)
													? 'bg-orange-100 text-orange-700'
													: 'bg-gray-100 text-gray-500'}"
											>
												{#if isPlacaMatched(ext.placa)}
													<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
												{/if}
												{ext.placa}
											</span>
											{#if getPlacaId(ext.placa)}
												<div
													class="mt-0.5 font-mono text-[9px] text-orange-600/50"
													title={getPlacaId(ext.placa)}
												>
													{shortUUID(getPlacaId(ext.placa))}…
												</div>
											{/if}
										</td>
										<td class="px-3 py-2.5 text-xs text-gray-400">{ext.num_interno}</td>
										<td class="max-w-[160px] px-3 py-2.5">
											{#if ext.conductor_1}
												<div class="flex items-center gap-1">
													{#if isConductorMatched(ext.conductor_1)}
														<span
															class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500"
															title="Registrado en BD"
														></span>
													{/if}
													<span
														class="truncate text-[11px] text-gray-700"
														title={ext.conductor_1}>{ext.conductor_1}</span
													>
												</div>
												{#if getConductorId(ext.conductor_1)}
													<div
														class="font-mono text-[9px] text-orange-600/50"
														title={getConductorId(ext.conductor_1)}
													>
														{shortUUID(getConductorId(ext.conductor_1))}…
													</div>
												{/if}
												<div class="text-[10px] text-gray-400">
													{ext.vigencia_pase_1}
												</div>
											{/if}
										</td>
										<td class="max-w-[160px] px-3 py-2.5">
											{#if ext.conductor_2}
												<div class="flex items-center gap-1">
													{#if isConductorMatched(ext.conductor_2)}
														<span
															class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500"
															title="Registrado en BD"
														></span>
													{/if}
													<span
														class="truncate text-[11px] text-gray-700"
														title={ext.conductor_2}>{ext.conductor_2}</span
													>
												</div>
												{#if getConductorId(ext.conductor_2)}
													<div
														class="font-mono text-[9px] text-orange-600/50"
														title={getConductorId(ext.conductor_2)}
													>
														{shortUUID(getConductorId(ext.conductor_2))}…
													</div>
												{/if}
												<div class="text-[10px] text-gray-400">
													{ext.vigencia_pase_2}
												</div>
											{/if}
										</td>
										<td class="max-w-[160px] px-3 py-2.5">
											{#if ext.conductor_3}
												<div class="flex items-center gap-1">
													{#if isConductorMatched(ext.conductor_3)}
														<span
															class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500"
															title="Registrado en BD"
														></span>
													{/if}
													<span
														class="truncate text-[11px] text-gray-700"
														title={ext.conductor_3}>{ext.conductor_3}</span
													>
												</div>
												{#if getConductorId(ext.conductor_3)}
													<div
														class="font-mono text-[9px] text-orange-600/50"
														title={getConductorId(ext.conductor_3)}
													>
														{shortUUID(getConductorId(ext.conductor_3))}…
													</div>
												{/if}
												<div class="text-[10px] text-gray-400">
													{ext.vigencia_pase_3}
												</div>
											{/if}
										</td>
										<td class="px-3 py-2.5">
											<button
												type="button"
												class="rounded-lg bg-orange-50 p-1.5 text-orange-600 transition hover:bg-orange-100 hover:text-orange-700"
												title="Cargar en formulario y generar PDF"
												on:click={() => fillFromHistorical(ext)}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
													/>
												</svg>
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Pagination -->
					<div
						class="flex items-center justify-between border-t border-gray-200 px-4 py-3"
					>
						<div class="text-xs text-gray-500">
							Mostrando {(pagination.page - 1) * pagination.limit + 1} - {Math.min(
								pagination.page * pagination.limit,
								pagination.total
							)} de {pagination.total.toLocaleString()}
						</div>
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
								disabled={!pagination.hasPrev}
								on:click={() => loadHistorial(pagination.page - 1)}
							>
								← Anterior
							</button>
							<span
								class="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-medium text-orange-700"
							>
								{pagination.page} / {pagination.pages}
							</span>
							<button
								type="button"
								class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
								disabled={!pagination.hasNext}
								on:click={() => loadHistorial(pagination.page + 1)}
							>
								Siguiente →
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Legend -->
			<div class="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-gray-400">
				<span class="flex items-center gap-1">
					<span class="h-2 w-2 rounded-full bg-orange-500"></span>
					Registrado en base de datos
				</span>
				<span class="flex items-center gap-1">
					<span class="h-2 w-2 rounded-full bg-amber-400"></span>
					No encontrado en base de datos
				</span>
			</div>
		</div>
	{/if}

	<!-- ================= TAB: CREAR ================= -->
	{#if activeTab === 'crear'}
		<div in:fade={{ duration: 200 }}>
			<!-- Action Bar -->
			<div class="mb-5 flex items-center justify-end gap-3">
				<button
					type="button"
					class="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
					on:click={resetForm}
				>
					<svg
						class="mr-2 inline h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
					Limpiar
				</button>
				<button
					type="button"
					class="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
					on:click={generatePDF}
					disabled={!formValid || generatingPdf}
				>
					{#if generatingPdf}
						<svg class="mr-2 inline h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
							/>
						</svg>
						Generando...
					{:else}
						<svg
							class="mr-2 inline h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						Generar PDF
					{/if}
				</button>
			</div>

			<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<!-- LEFT: FORM -->
				<div class="space-y-5 xl:col-span-2">
					<!-- Datos del Contrato -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
							Datos del Contrato
						</h2>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<div>
								<label
									for="numero_contrato"
									class="mb-1 block text-xs font-medium text-gray-600"
									>Nº Contrato <span class="text-orange-500">(auto)</span></label
								>
								<input
									id="numero_contrato"
									type="text"
									bind:value={extracto.numero_contrato}
									readonly
									class="w-full rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 transition cursor-not-allowed"
								/>
							</div>
							<div>
								<label
									for="numero_extracto"
									class="mb-1 block text-xs font-medium text-gray-600"
									>Nº Extracto</label
								>
								<input
									id="numero_extracto"
									type="text"
									bind:value={extracto.numero_extracto}
									placeholder="Ej: 415464522202600533892"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label
									for="objeto_contrato"
									class="mb-1 block text-xs font-medium text-gray-600"
									>Objeto del Contrato</label
								>
								<input
									id="objeto_contrato"
									type="text"
									bind:value={extracto.objeto_contrato}
									placeholder="Ej: CONTRATO PARA TRANSPORTE DE PERSONAL"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
						</div>
					</div>

					<!-- Contratante -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
								/>
							</svg>
							Contratante
						</h2>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="autocomplete-wrapper relative">
								<label
									for="cliente_search"
									class="mb-1 block text-xs font-medium text-gray-600"
									>Buscar Cliente *</label
								>
								<input
									id="cliente_search"
									type="text"
									bind:value={clienteSearch}
									on:focus={() => (showClienteDropdown = true)}
									on:input={() => (showClienteDropdown = true)}
									placeholder="Escriba nombre o NIT..."
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
									autocomplete="off"
								/>
								{#if showClienteDropdown && clientesFiltrados.length > 0}
									<div
										class="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl"
										transition:fly={{ y: -5, duration: 150 }}
									>
										{#each clientesFiltrados.slice(0, 15) as cliente}
											<button
												type="button"
												class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-orange-50 hover:text-gray-900"
												on:click|stopPropagation={() => selectCliente(cliente)}
											>
												<span class="truncate font-medium">{cliente.nombre}</span>
												<span class="ml-auto text-xs text-gray-400">{cliente.nit || ''}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
							<div>
								<label
									for="contratante_nit"
									class="mb-1 block text-xs font-medium text-gray-600">NIT</label
								>
								<input
									id="contratante_nit"
									type="text"
									bind:value={extracto.contratante_nit}
									placeholder="NIT del contratante"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div class="sm:col-span-2">
								<label
									for="contratante_nombre"
									class="mb-1 block text-xs font-medium text-gray-600"
									>Nombre Contratante</label
								>
								<input
									id="contratante_nombre"
									type="text"
									bind:value={extracto.contratante_nombre}
									placeholder="Nombre del contratante"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
						</div>
					</div>

					<!-- Ruta y Vigencia -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
							Ruta y Vigencia
						</h2>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div>
								<label for="origen" class="mb-1 block text-xs font-medium text-gray-600">Origen</label>
								<input
									id="origen"
									type="text"
									bind:value={extracto.origen}
									placeholder="Ciudad de origen"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="destino" class="mb-1 block text-xs font-medium text-gray-600">Destino</label>
								<input
									id="destino"
									type="text"
									bind:value={extracto.destino}
									placeholder="Ciudad de destino"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="fecha_inicial" class="mb-1 block text-xs font-medium text-gray-600">Fecha Inicial</label>
								<input
									id="fecha_inicial"
									type="date"
									bind:value={extracto.fecha_inicial}
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="fecha_vencimiento" class="mb-1 block text-xs font-medium text-gray-600">Fecha Vencimiento</label>
								<input
									id="fecha_vencimiento"
									type="date"
									bind:value={extracto.fecha_vencimiento}
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
						</div>
					</div>

					<!-- Vehículo -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 002 12v4c0 .6.4 1 1 1h2"
									stroke="currentColor"
									stroke-width="2"
									fill="none"
								/>
								<circle cx="7" cy="17" r="2" stroke="currentColor" stroke-width="2" fill="none" />
								<circle cx="17" cy="17" r="2" stroke="currentColor" stroke-width="2" fill="none" />
							</svg>
							Vehículo
						</h2>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<div class="autocomplete-wrapper relative">
								<label for="vehiculo_search" class="mb-1 block text-xs font-medium text-gray-600">Buscar Vehículo *</label>
								<input
									id="vehiculo_search"
									type="text"
									bind:value={vehiculoSearch}
									on:focus={() => (showVehiculoDropdown = true)}
									on:input={() => (showVehiculoDropdown = true)}
									placeholder="Escriba placa o marca..."
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
									autocomplete="off"
								/>
								{#if showVehiculoDropdown && vehiculosFiltrados.length > 0}
									<div
										class="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl"
										transition:fly={{ y: -5, duration: 150 }}
									>
										{#each vehiculosFiltrados.slice(0, 15) as vehiculo}
											<button
												type="button"
												class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-orange-50 hover:text-gray-900"
												on:click|stopPropagation={() => selectVehiculo(vehiculo)}
											>
												<span class="font-mono font-bold text-orange-600">{vehiculo.placa}</span>
												<span class="text-gray-300">·</span>
												<span class="truncate">{vehiculo.marca || ''} {vehiculo.linea || ''}</span>
												<span class="ml-auto text-xs text-gray-400">{vehiculo.modelo || ''}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
							<div>
								<label for="marca_vehiculo" class="mb-1 block text-xs font-medium text-gray-600">Marca</label>
								<input
									id="marca_vehiculo"
									type="text"
									bind:value={extracto.marca_vehiculo}
									placeholder="Marca"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="modelo_vehiculo" class="mb-1 block text-xs font-medium text-gray-600">Modelo (Año)</label>
								<input
									id="modelo_vehiculo"
									type="text"
									bind:value={extracto.modelo_vehiculo}
									placeholder="Año"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="clase_vehiculo" class="mb-1 block text-xs font-medium text-gray-600">Clase</label>
								<input
									id="clase_vehiculo"
									type="text"
									bind:value={extracto.clase_vehiculo}
									placeholder="Ej: CAMIONETA"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="tarjeta_op" class="mb-1 block text-xs font-medium text-gray-600">Tarjeta de Operación</label>
								<input
									id="tarjeta_op"
									type="text"
									bind:value={extracto.numero_tarjeta_operacion}
									placeholder="Nº Tarjeta"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="numero_interno" class="mb-1 block text-xs font-medium text-gray-600">Nº Interno</label>
								<input
									id="numero_interno"
									type="text"
									bind:value={extracto.numero_interno}
									placeholder="Nº Interno"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
						</div>
					</div>

					<!-- Conductores -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
								/>
							</svg>
							Conductores
							<span class="ml-2 text-xs font-normal text-gray-400">(hasta 3)</span>
						</h2>

						{#each [0, 1, 2] as i}
							<div
								class="rounded-xl border border-gray-100 bg-gray-50/50 p-4 {i > 0
									? 'mt-3'
									: ''}"
							>
								<div class="mb-3 flex items-center justify-between">
									<span class="text-xs font-semibold text-orange-500"
										>Conductor {i + 1}
										{i === 0 ? '*' : '(Opcional)'}</span
									>
									{#if extracto.conductores[i].nombre}
										<button
											type="button"
											class="text-xs text-red-400/60 transition hover:text-red-400"
											on:click={() => clearConductor(i)}>Limpiar</button
										>
									{/if}
								</div>
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
									<div class="autocomplete-wrapper relative sm:col-span-2">
										<label
											for="conductor_{i}"
											class="mb-1 block text-xs font-medium text-gray-600"
											>Buscar Conductor</label
										>
										<input
											id="conductor_{i}"
											type="text"
											bind:value={conductorSearch[i]}
											on:focus={() => {
												showConductorDropdown[i] = true;
												showConductorDropdown = [...showConductorDropdown];
											}}
											on:input={() => {
												showConductorDropdown[i] = true;
												showConductorDropdown = [...showConductorDropdown];
											}}
											placeholder="Nombre o cédula..."
											class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
											autocomplete="off"
										/>
										{#if showConductorDropdown[i] && conductoresFiltradosPor(i).length > 0}
											<div
												class="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl"
												transition:fly={{ y: -5, duration: 150 }}
											>
												{#each conductoresFiltradosPor(i).slice(0, 10) as conductor}
													<button
														type="button"
														class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-orange-50 hover:text-gray-900"
														on:click|stopPropagation={() =>
															selectConductor(conductor, i)}
													>
														<span class="truncate font-medium"
															>{conductor.nombre} {conductor.apellido}</span
														>
														<span class="ml-auto text-xs text-gray-400"
															>{conductor.numero_identificacion}</span
														>
													</button>
												{/each}
											</div>
										{/if}
									</div>
									<div>
										<label
											for="cedula_{i}"
											class="mb-1 block text-xs font-medium text-gray-600"
											>Cédula</label
										>
										<input
											id="cedula_{i}"
											type="text"
											bind:value={extracto.conductores[i].cedula}
											placeholder="Cédula"
											class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
										/>
									</div>
									<div>
										<label
											for="licencia_{i}"
											class="mb-1 block text-xs font-medium text-gray-600"
											>Licencia</label
										>
										<input
											id="licencia_{i}"
											type="text"
											bind:value={extracto.conductores[i].licencia_conduccion}
											placeholder="Categoría"
											class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
										/>
									</div>
								</div>
								{#if extracto.conductores[i].nombre}
									<div class="mt-2 flex items-center gap-4 text-xs">
										<span class="text-gray-500">
											<span class="text-gray-400">Nombre:</span>
											<span class="font-medium text-orange-600"
												>{extracto.conductores[i].nombre}</span
											>
										</span>
										{#if extracto.conductores[i].vigencia_licencia}
											<span class="text-gray-500">
												<span class="text-gray-400">Vigencia Lic:</span>
												<span class="text-gray-600"
													>{extracto.conductores[i].vigencia_licencia}</span
												>
											</span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Responsable -->
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							Responsable del Contratante
						</h2>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label for="resp_nombre" class="mb-1 block text-xs font-medium text-gray-600">Nombre</label>
								<input
									id="resp_nombre"
									type="text"
									bind:value={extracto.responsable_nombre}
									placeholder="Nombre del responsable"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="resp_cedula" class="mb-1 block text-xs font-medium text-gray-600">Cédula</label>
								<input
									id="resp_cedula"
									type="text"
									bind:value={extracto.responsable_cedula}
									placeholder="Cédula del responsable"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="resp_telefono" class="mb-1 block text-xs font-medium text-gray-600">Teléfono</label>
								<input
									id="resp_telefono"
									type="text"
									bind:value={extracto.responsable_telefono}
									placeholder="Teléfono"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
							<div>
								<label for="resp_direccion" class="mb-1 block text-xs font-medium text-gray-600">Dirección</label>
								<input
									id="resp_direccion"
									type="text"
									bind:value={extracto.responsable_direccion}
									placeholder="Dirección"
									class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
								/>
							</div>
						</div>
					</div>
				</div>

				<!-- RIGHT: PREVIEW BUTTON -->
				<div class="space-y-5">
					<div class="glass rounded-2xl border border-gray-200/50 p-5">
						<h2
							class="mb-4 flex items-center text-sm font-semibold uppercase tracking-wide text-orange-700"
						>
							<svg
								class="mr-2 h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
							Vista Previa
						</h2>

						<!-- Mini thumbnail preview -->
						<div class="mb-4 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
							<div class="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
								<img src="/assets/logo.png" alt="Cotransmeq" class="h-4 object-contain" />
								<div class="text-[6px] text-gray-500">Extracto</div>
							</div>
							<div class="space-y-1">
								<div class="flex justify-between text-[6px]">
									<span class="text-gray-500">Contrato:</span>
									<span class="font-semibold text-gray-800">{extracto.numero_contrato || '—'}</span>
								</div>
								<div class="flex justify-between text-[6px]">
									<span class="text-gray-500">Placa:</span>
									<span class="font-bold text-orange-700">{extracto.placa || '—'}</span>
								</div>
								<div class="flex justify-between text-[6px]">
									<span class="text-gray-500">Contratante:</span>
									<span class="text-gray-800 truncate ml-1">{extracto.contratante_nombre || '—'}</span>
								</div>
								<div class="flex justify-between text-[6px]">
									<span class="text-gray-500">Vigencia:</span>
									<span class="text-gray-800">
										{#if extracto.fecha_inicial && extracto.fecha_vencimiento}
											{extracto.fecha_inicial} → {extracto.fecha_vencimiento}
										{:else}
											—
										{/if}
									</span>
								</div>
							</div>
						</div>

						<button
							type="button"
							on:click={() => (showPdfModal = true)}
							class="w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-orange-700 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
							Ver Vista Previa PDF
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- MODAL: Vista Previa PDF -->
{#if showPdfModal}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		on:click|self={() => (showPdfModal = false)}
		transition:fade={{ duration: 200 }}
	>
		<div
			class="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
			in:fly={{ y: 40, duration: 250 }}
		>
			<!-- Modal Header -->
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 rounded-t-2xl">
				<h2 class="flex items-center gap-2 text-lg font-bold text-gray-800">
					<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
					Vista Previa — Extracto
				</h2>
				<button
					type="button"
					on:click={() => (showPdfModal = false)}
					class="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
					aria-label="Cerrar vista previa"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal Body: PDF Document -->
			<div class="p-6">
				<div class="mx-auto max-w-2xl rounded-lg border border-gray-300 bg-white shadow-lg" style="font-family: Arial, sans-serif;">
					<!-- Header Row: Logo + Title -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse" style="table-layout: fixed;">
							<tbody>
								<tr>
									<td class="w-[25%] border-r border-gray-400 p-2 text-center align-middle">
										<img src="/assets/logo.png" alt="Cotransmeq" class="mx-auto h-10 object-contain" />
									</td>
									<td class="w-[50%] border-r border-gray-400 p-3 text-center align-middle">
										<div class="text-[10px] font-bold text-gray-800 leading-tight">
											FORMATO ÚNICO DE EXTRACTO DEL CONTRATO DEL SERVICIO PÚBLICO DE TRANSPORTE TERRESTRE AUTOMOTOR ESPECIAL
										</div>
									</td>
									<td class="w-[25%] p-2 text-center align-middle">
										<div class="text-[10px] font-bold text-orange-700">COTRANSMEQ</div>
										<div class="text-[8px] text-gray-500">S.A.S.</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Code / Version / Date Row -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse" style="table-layout: fixed;">
							<tbody>
								<tr>
									<td class="w-1/3 border-r border-gray-400 px-3 py-1.5 text-[10px] text-gray-600">
										Código: <span class="font-semibold text-gray-800">{extracto.codigo_formato}</span>
									</td>
									<td class="w-1/3 border-r border-gray-400 px-3 py-1.5 text-[10px] text-gray-600">
										Versión: <span class="font-semibold text-gray-800">{extracto.version_formato}</span>
									</td>
									<td class="w-1/3 px-3 py-1.5 text-[10px] text-gray-600">
										Fecha: <span class="font-semibold text-gray-800">{new Date().toLocaleDateString('es-CO')}</span>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- No. Extracto -->
					<div class="border-b border-gray-400 px-3 py-2 text-center">
						<div class="text-xs font-bold text-gray-800">
							No. {extracto.numero_extracto || '________________________'}
						</div>
					</div>

					<!-- Company Info -->
					<div class="border-b border-gray-400 px-3 py-1.5 text-center">
						<div class="text-[11px] font-bold text-gray-800">COTRANSMEQ S.A.S.</div>
						<div class="text-[10px] text-gray-600">COOPERATIVA DE TRANSPORTADORES DE MAQUINARIA Y EQUIPO</div>
					</div>

					<!-- Contrato No + Contratante + NIT -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse" style="table-layout: fixed;">
							<tbody>
								<tr>
									<td class="w-[20%] border-r border-gray-400 bg-gray-50 px-2 py-1.5 text-[10px] font-bold text-gray-700">CONTRATO No.</td>
									<td class="w-[15%] border-r border-gray-400 px-2 py-1.5 text-xs font-bold text-center text-gray-900">
										{extracto.numero_contrato || '____'}
									</td>
									<td class="w-[18%] border-r border-gray-400 bg-gray-50 px-2 py-1.5 text-[10px] font-bold text-gray-700">CONTRATANTE:</td>
									<td class="w-[27%] border-r border-gray-400 px-2 py-1.5 text-[10px] text-gray-800 truncate">
										{extracto.contratante_nombre || '—'}
									</td>
									<td class="w-[6%] bg-gray-50 px-1 py-1.5 text-[10px] font-bold text-gray-700">NIT:</td>
									<td class="w-[14%] px-2 py-1.5 text-[10px] text-gray-800">
										{extracto.contratante_nit || '—'}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Objeto del Contrato -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr>
									<td class="bg-gray-50 px-3 py-1.5 text-center text-[10px] font-bold text-gray-700 border-b border-gray-300">
										OBJETO DEL CONTRATO:
									</td>
								</tr>
								<tr>
									<td class="px-3 py-1.5 text-center text-[10px] text-gray-800">
										{extracto.objeto_contrato || 'CONTRATO PARA TRANSPORTE DE PERSONAL'}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Origen - Destino -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr>
									<td class="w-[22%] bg-gray-50 px-3 py-1.5 text-[10px] font-bold text-gray-700 border-r border-gray-400">ORIGEN - DESTINO</td>
									<td class="px-3 py-1.5 text-[10px] text-gray-800 text-center">
										{#if extracto.origen || extracto.destino}
											{extracto.origen || '—'} - {extracto.destino || '—'} (VICEVERSA)
										{:else}
											—
										{/if}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Vigencia del Contrato -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr>
									<td colspan="2" class="bg-gray-50 px-3 py-1.5 text-center text-[10px] font-bold text-gray-700 border-b border-gray-400">
										VIGENCIA DEL CONTRATO
									</td>
								</tr>
								<tr class="border-b border-gray-300">
									<td class="w-[30%] bg-gray-50 px-3 py-1.5 text-[10px] font-bold text-gray-700 border-r border-gray-400">FECHA INICIAL</td>
									<td class="px-3 py-1.5 text-[11px] text-center text-gray-800">
										{#if extracto.fecha_inicial}
											{(() => { const d = new Date(extracto.fecha_inicial + 'T12:00:00'); return `${d.getDate().toString().padStart(2,'0')} / ${(d.getMonth()+1).toString().padStart(2,'0')} / ${d.getFullYear()}`; })()}
										{:else}
											__ / __ / ____
										{/if}
									</td>
								</tr>
								<tr>
									<td class="bg-gray-50 px-3 py-1.5 text-[10px] font-bold text-gray-700 border-r border-gray-400">FECHA VENCIMIENTO</td>
									<td class="px-3 py-1.5 text-[11px] text-center text-gray-800">
										{#if extracto.fecha_vencimiento}
											{(() => { const d = new Date(extracto.fecha_vencimiento + 'T12:00:00'); return `${d.getDate().toString().padStart(2,'0')} / ${(d.getMonth()+1).toString().padStart(2,'0')} / ${d.getFullYear()}`; })()}
										{:else}
											__ / __ / ____
										{/if}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Características del Vehículo -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr>
									<td colspan="4" class="bg-gray-50 px-3 py-1.5 text-center text-[10px] font-bold text-gray-700 border-b border-gray-400">
										CARACTERÍSTICAS DEL VEHÍCULO
									</td>
								</tr>
								<tr class="bg-gray-50">
									<td class="w-1/4 border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-gray-600 text-center">PLACA</td>
									<td class="w-1/4 border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-gray-600 text-center">MODELO</td>
									<td class="w-1/4 border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-gray-600 text-center">MARCA</td>
									<td class="w-1/4 px-2 py-1 text-[9px] font-bold text-gray-600 text-center">CLASE</td>
								</tr>
								<tr>
									<td class="border-r border-gray-400 px-2 py-1.5 text-xs font-bold text-center text-gray-900">{extracto.placa || '—'}</td>
									<td class="border-r border-gray-400 px-2 py-1.5 text-[11px] text-center text-gray-800">{extracto.modelo_vehiculo || '—'}</td>
									<td class="border-r border-gray-400 px-2 py-1.5 text-[11px] text-center text-gray-800">{extracto.marca_vehiculo || '—'}</td>
									<td class="px-2 py-1.5 text-[11px] text-center text-gray-800">{extracto.clase_vehiculo || '—'}</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Tarjeta Operación -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr>
									<td class="w-1/2 border-r border-gray-400 px-3 py-1.5 text-[10px] text-center text-gray-800">
										<span class="font-semibold">{extracto.numero_interno || '—'}</span>
									</td>
									<td class="w-1/2 px-3 py-1.5 text-[10px] text-center">
										<span class="text-gray-600">No. TARJETA DE OPERACIÓN: </span>
										<span class="font-semibold text-gray-800">{extracto.numero_tarjeta_operacion || '—'}</span>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Conductores -->
					{#each extracto.conductores as cond, idx}
						<div class="border-b border-gray-400">
							<table class="w-full border-collapse">
								<tbody>
									<tr class="bg-gray-50">
										<td class="w-[18%] border-r border-gray-400 px-2 py-1.5 text-[9px] font-bold text-gray-700">
											DATOS DEL<br/>CONDUCTOR {idx + 1}
										</td>
										<td class="w-[32%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">NOMBRES Y APELLIDOS</td>
										<td class="w-[15%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">No. CÉDULA</td>
										<td class="w-[18%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">LICENCIA COND.</td>
										<td class="w-[17%] px-2 py-1 text-[9px] font-bold text-center text-gray-600">VIGENCIA</td>
									</tr>
									<tr>
										<td class="border-r border-gray-400"></td>
										<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800 truncate">{cond.nombre || '—'}</td>
										<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800">{cond.cedula || '—'}</td>
										<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800">{cond.licencia_conduccion || cond.cedula || '—'}</td>
										<td class="px-2 py-1.5 text-[10px] text-center text-gray-800">{cond.vigencia_licencia || '—'}</td>
									</tr>
								</tbody>
							</table>
						</div>
					{/each}

					<!-- Responsable -->
					<div class="border-b border-gray-400">
						<table class="w-full border-collapse">
							<tbody>
								<tr class="bg-gray-50">
									<td class="w-[18%] border-r border-gray-400 px-2 py-1.5 text-[9px] font-bold text-gray-700">
										RESPONSABLE DEL<br/>CONTRATANTE
									</td>
									<td class="w-[32%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">NOMBRES Y APELLIDOS</td>
									<td class="w-[15%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">No. CÉDULA</td>
									<td class="w-[18%] border-r border-gray-400 px-2 py-1 text-[9px] font-bold text-center text-gray-600">TELÉFONO</td>
									<td class="w-[17%] px-2 py-1 text-[9px] font-bold text-center text-gray-600">DIRECCIÓN</td>
								</tr>
								<tr>
									<td class="border-r border-gray-400"></td>
									<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800 truncate">{extracto.responsable_nombre || '—'}</td>
									<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800">{extracto.responsable_cedula || '—'}</td>
									<td class="border-r border-gray-400 px-2 py-1.5 text-[10px] text-center text-gray-800">{extracto.responsable_telefono || '—'}</td>
									<td class="px-2 py-1.5 text-[10px] text-center text-gray-800 truncate">{extracto.responsable_direccion || '—'}</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Footer -->
					<div class="px-3 py-3">
						<div class="flex items-center justify-between">
							<div class="text-[9px] text-gray-500">
								<div class="font-bold text-gray-700">COTRANSMEQ S.A.S.</div>
								<div>Cooperativa de Transportadores</div>
								<div>de Maquinaria y Equipo</div>
							</div>
							<div class="text-center">
								<img src="/assets/logo.png" alt="Cotransmeq" class="h-7 object-contain" />
							</div>
							<div class="text-right text-[9px] text-gray-500">
								<div class="font-bold text-gray-700">GERENCIA</div>
								<div class="text-gray-500">COTRANSMEQ</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3 rounded-b-2xl">
				<button
					type="button"
					on:click={() => (showPdfModal = false)}
					class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
				>
					Cerrar
				</button>
			</div>
		</div>
	</div>
{/if}
