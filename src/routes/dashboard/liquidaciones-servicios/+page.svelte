<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import MultiSelectFilter from '$lib/components/ui/MultiSelectFilter.svelte';
	import {
		liquidacionesServiciosAPI,
		getMesLabel,
		liquidacionesTercerosAPI,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type ConfigLiquidadorServicio,
		type TerceroItemHistorial,
	} from '$lib/api/liquidaciones-servicios';
	import { facturacionLiquidacionesAPI, type FacturaInfoMap, type FacturaLiquidacion } from '$lib/api/facturacionLiquidaciones';
	import ModalFacturar from '$lib/components/ModalFacturar.svelte';
	import { checkAccess } from '$lib/config/permissions';

	const MESES = [
		'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
		'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
	];
	const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency', currency: 'COP',
			minimumFractionDigits: 0, maximumFractionDigits: 0,
		}).format(parseFloat(String(v)) || 0);

	// --- COP input formatting helpers ---
	const fmtCOP = (v: number) => v ? new Intl.NumberFormat('es-CO').format(v) : '';
	const parseCOP = (s: string) => parseFloat(s.replace(/[.\s]/g, '').replace(',', '.')) || 0;

	function handleCOPFocus(e: FocusEvent) {
		const input = e.target as HTMLInputElement;
		const raw = parseCOP(input.value);
		input.value = raw ? String(raw) : '';
	}
	function handleCOPBlur(e: FocusEvent, field: keyof typeof configForm) {
		const input = e.target as HTMLInputElement;
		const raw = parseCOP(input.value);
		(configForm as any)[field] = raw;
		input.value = fmtCOP(raw);
	}

	let liquidaciones: LiquidacionServicio[] = [];
	let listLoading = false;
	let listError = '';
	let listPage = 1;
	let listTotalPages = 1;
	let listTotal = 0;
	let listBusqueda = '';
	let listEstado: EstadoLiquidacionServicio | '' = '';
	let listMes: number | '' = '';
	let listAnio: number | '' = '';
	let listSortBy = '';
	let listSortDir: 'asc' | 'desc' = 'desc';

	// Column header multi-select filters (server-side, Excel-style)
	let colFilterConsecutivo: string[] = [];
	let colFilterCliente: string[] = [];
	let colFilterPeriodo: string[] = [];
	let colFilterEstado: string[] = [];
	let colFilterFactura: string[] = [];
	let colFilterLiquidador: string[] = [];

	// Unique values for column filters (from ALL records via metadata)
	$: uniqueConsecutivos = listMetadata.consecutivos || [];
	$: uniqueClientes = listMetadata.clientes.map(c => c.nombre);
	$: uniquePeriodos = (listMetadata.periodos || []).map(p => `${getMesLabel(p.mes)} ${p.anio}`);
	$: uniqueEstados = listMetadata.estados || [];
	$: uniqueFacturas = listMetadata.facturas || [];
	$: uniqueLiquidadores = listMetadata.liquidadores.map(l => l.nombre);

	// filteredLiquidaciones = liquidaciones (filtering is now server-side)
	$: filteredLiquidaciones = liquidaciones;

	$: hasColumnFilter = colFilterConsecutivo.length > 0 || colFilterCliente.length > 0 || colFilterPeriodo.length > 0 || colFilterEstado.length > 0 || colFilterFactura.length > 0 || colFilterLiquidador.length > 0;

	// Metadata from API
	let listMetadata: {
		globalTotal: number;
		globalCount: number;
		estadoCounts: Record<string, number>;
		clientes: { id: string; nombre: string }[];
		liquidadores: { id: string; nombre: string }[];
		consecutivos: string[];
		periodos: { mes: number; anio: number }[];
		facturas: string[];
		estados: string[];
	} = { globalTotal: 0, globalCount: 0, estadoCounts: {}, clientes: [], liquidadores: [], consecutivos: [], periodos: [], facturas: [], estados: [] };

	$: hasActiveFilter = !!(listBusqueda || hasColumnFilter);

	let detailModal = false;
	let detailLoading = false;
	let detailLiq: LiquidacionServicio | null = null;

	let deleteModalOpen = false;
	let deleteTargetLiq: LiquidacionServicio | null = null;
	let deleting = false;

	let anularModalOpen = false;
	let anularTargetId = '';
	let anularMotivo = '';
	let estadoChanging = false;

	// Historial
	let historialModalOpen = false;
	let historialLoading = false;
	let historialData: import('$lib/api/liquidaciones-servicios').HistorialEstado[] = [];
	let historialLiqConsecutivo = '';
	let historialExpandedId: string | null = null;

	let facturarModalOpen = false;
	let facturarPreselected: string[] = [];
	let facturaInfoMap: FacturaInfoMap = {};

	let facturasTab: 'liquidaciones' | 'facturas' | 'configuracion' | 'terceros' = 'liquidaciones';

	// Terceros historial
	let tercerosItems: TerceroItemHistorial[] = [];
	let tercerosLoading = false;
	let tercerosPage = 1;
	let tercerosTotalPages = 1;
	let tercerosTotal = 0;
	let tercerosBusqueda = '';
	let tercerosMes: number | '' = '';
	let tercerosAnio: number | '' = new Date().getFullYear();
	let tercerosPlaca = '';
	let facturas: FacturaLiquidacion[] = [];
	let facturasLoading = false;
	let facturasPage = 1;
	let facturasTotalPages = 1;
	let facturasTotal = 0;
	let facturasBusqueda = '';
	let facturasEstado: '' | 'ACTIVA' | 'ANULADA' = '';

	let anularFacturaModalOpen = false;
	let anularFacturaTarget: FacturaLiquidacion | null = null;
	let anularFacturaMotivo = '';
	let eliminarFacturaModalOpen = false;
	let eliminarFacturaTarget: FacturaLiquidacion | null = null;
	let eliminandoFactura = false;
	let anulandoFactura = false;

	let detalleFactura: FacturaLiquidacion | null = null;

	/* ── Config liquidador servicio ── */
	let configLoading = false;
	let configSaving = false;
	let configData: ConfigLiquidadorServicio | null = null;
	let configForm = {
		salario_basico: 0,
		cargo: 'Conductor',
		valor_hora_override: 0,
		conductor_adicional: 0,
		pct_seg_social: 0,
		pct_prestaciones: 0,
		pct_admin: 0,
		prueba_covid: 0,
	};
	$: configValorHoraAuto = configForm.salario_basico > 0
		? +(configForm.salario_basico / 235).toFixed(4)
		: 0;

	async function cargarConfig() {
		configLoading = true;
		try {
			const d = await liquidacionesServiciosAPI.obtenerConfigLiquidador();
			configData = d;
			configForm = {
				salario_basico: d.salario_basico,
				cargo: d.cargo,
				valor_hora_override: d.valor_hora_override,
				conductor_adicional: d.conductor_adicional,
				pct_seg_social: d.pct_seg_social,
				pct_prestaciones: d.pct_prestaciones,
				pct_admin: d.pct_admin,
				prueba_covid: d.prueba_covid,
			};
		} catch (e: any) { alert(e.message || 'Error cargando config'); }
		finally { configLoading = false; }
	}

	async function guardarConfig() {
		configSaving = true;
		try {
			const d = await liquidacionesServiciosAPI.actualizarConfigLiquidador(configForm);
			configData = d;
			alert('✅ Configuracion guardada');
		} catch (e: any) { alert(e.message || 'Error guardando config'); }
		finally { configSaving = false; }
	}

	// ─── Terceros historial ───
	async function cargarTerceros() {
		tercerosLoading = true;
		try {
			const filtros: Record<string, string | number> = { page: tercerosPage, limit: 50 };
			if (tercerosBusqueda) filtros.busqueda = tercerosBusqueda;
			if (tercerosMes !== '') filtros.mes = tercerosMes;
			if (tercerosAnio !== '') filtros.anio = tercerosAnio;
			if (tercerosPlaca) filtros.placa = tercerosPlaca;
			const r = await liquidacionesTercerosAPI.listarHistorial(filtros);
			tercerosItems = r.items;
			tercerosTotal = r.total;
			tercerosTotalPages = r.totalPages;
		} catch (e: any) { alert(e.message || 'Error cargando historial terceros'); }
		finally { tercerosLoading = false; }
	}
	function filtrarTerceros() { tercerosPage = 1; cargarTerceros(); }
	function irPaginaTerceros(p: number) { tercerosPage = p; cargarTerceros(); }

	let highlightedIds: Record<string, 'created' | 'updated'> = {};
	const highlightTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	function addHighlight(id: string, type: 'created' | 'updated') {
		if (highlightTimers[id]) clearTimeout(highlightTimers[id]);
		highlightedIds[id] = type;
		highlightedIds = highlightedIds;
		highlightTimers[id] = setTimeout(() => {
			delete highlightedIds[id];
			highlightedIds = highlightedIds;
			delete highlightTimers[id];
		}, 8000);
	}

	$: accessResult = checkAccess($authStore.user?.role, $authStore.user?.area, 'liquidaciones-servicios');
	$: isFull = accessResult.level === 'full';
	$: isLimited = accessResult.level === 'limited';
	$: userAreas = Array.isArray($authStore.user?.area) ? $authStore.user.area : ($authStore.user?.area ? [$authStore.user.area] : []);
	$: isAdmin = userAreas.includes('administracion');
	$: isFacturacion = userAreas.includes('facturacion');
	$: isOperaciones = userAreas.includes('operaciones');
	$: canLiquidar = isFull; // admin + operaciones: borrador → liquidada
	$: canAprobar = isAdmin; // solo admin: liquidada → aprobada
	$: canAnular = isAdmin; // solo admin: anular liquidaciones
	$: canRevertirABorrador = isFull; // admin + operaciones: liquidada → borrador
	$: canRevertirALiquidada = isAdmin; // solo admin: aprobada → liquidada

	let logoError = false;

	onMount(async () => {
		await cargarListado();
		socketUtils.on('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.on('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.on('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.on('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.on('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.on('facturacion-anulada', handleSocketFacturacionAnulada);
	});

	onDestroy(() => {
		socketUtils.off('liquidacion-servicio-created', handleSocketCreated);
		socketUtils.off('liquidacion-servicio-updated', handleSocketUpdated);
		socketUtils.off('liquidacion-servicio-deleted', handleSocketDeleted);
		socketUtils.off('liquidacion-servicio-facturada', handleSocketFacturada);
		socketUtils.off('facturacion-created', handleSocketFacturacionCreated);
		socketUtils.off('facturacion-anulada', handleSocketFacturacionAnulada);
		Object.values(highlightTimers).forEach(t => clearTimeout(t));
	});

	function handleSocketCreated(data: any) {
		if (!data?.id) return;
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			liquidaciones = [mapped, ...liquidaciones];
			listTotal += 1;
			addHighlight(data.id, 'created');
		}
	}

	function handleSocketUpdated(data: any) {
		if (!data?.id) return;
		const mapped = mapLiquidacionFromSocket(data);
		if (mapped) {
			const idx = liquidaciones.findIndex(l => l.id === data.id);
			if (idx >= 0) {
				liquidaciones[idx] = mapped;
				liquidaciones = [...liquidaciones];
				addHighlight(data.id, 'updated');
			} else {
				cargarListado();
			}
		}
	}

	function handleSocketDeleted(data: any) {
		if (!data?.id) return;
		liquidaciones = liquidaciones.filter(l => l.id !== data.id);
		listTotal = Math.max(0, listTotal - 1);
	}

	function mapLiquidacionFromSocket(d: any): LiquidacionServicio | null {
		if (!d?.id) return null;
		return {
			...d,
			valor_servicios: Number(d.valor_servicios ?? 0),
			valor_recargos: Number(d.valor_recargos ?? 0),
			valor_pernoctes: Number(d.valor_pernoctes ?? 0),
			subtotal: Number(d.subtotal ?? 0),
			porcentaje_iva: Number(d.porcentaje_iva ?? 0),
			valor_iva: Number(d.valor_iva ?? 0),
			total: Number(d.total ?? 0),
			valor_transporte_adicional: Number(d.valor_transporte_adicional ?? 0),
			total_items: d._count?.items ?? d.total_items ?? d.items?.length ?? 0,
		};
	}

	function handleSocketFacturacionCreated(_data: any) {
		if (facturasTab === 'facturas') cargarFacturas();
	}
	function handleSocketFacturacionAnulada(_data: any) {
		if (facturasTab === 'facturas') cargarFacturas();
	}

	function handleSocketFacturada(data: any) {
		if (!data?.id) return;
		const idx = liquidaciones.findIndex(l => l.id === data.id);
		if (idx >= 0) {
			liquidaciones[idx] = { ...liquidaciones[idx], estado: data.estado };
			liquidaciones = [...liquidaciones];
			if (data.numero_factura) {
				facturaInfoMap[data.id] = { factura_id: data.factura_id, numero_factura: data.numero_factura };
				facturaInfoMap = { ...facturaInfoMap };
			} else {
				delete facturaInfoMap[data.id];
				facturaInfoMap = { ...facturaInfoMap };
			}
			addHighlight(data.id, 'updated');
		}
	}

	async function cargarListado() {
		listLoading = true; listError = '';
		try {
			const filtros: Record<string, any> = { page: listPage, limit: 15 };
			if (listBusqueda) filtros.busqueda = listBusqueda;
			if (listMes) filtros.mes = listMes;
			if (listAnio) filtros.anio = listAnio;
			if (listSortBy) { filtros.sortBy = listSortBy; filtros.sortDir = listSortDir; }
			// Column filters (server-side)
			if (colFilterConsecutivo.length) filtros.consecutivos = colFilterConsecutivo.join(',');
			if (colFilterEstado.length) filtros.estados = colFilterEstado.join(',');
			if (colFilterCliente.length) filtros.cliente_nombres = colFilterCliente.join(',');
			if (colFilterLiquidador.length) filtros.liquidador_nombres = colFilterLiquidador.join(',');
			if (colFilterPeriodo.length) {
				// Convert "Enero 2026" -> "1-2026"
				filtros.periodos = colFilterPeriodo.map(p => {
					const parts = p.split(' ');
					const mesLabel = parts[0];
					const anio = parts[1];
					const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
					const mesNum = meses.indexOf(mesLabel) + 1;
					return `${mesNum}-${anio}`;
				}).join(',');
			}
			if (colFilterFactura.length) filtros.facturas = colFilterFactura.join(',');
			const res = await liquidacionesServiciosAPI.listar(filtros);
			liquidaciones = res.liquidaciones;
			listTotal = res.total;
			listTotalPages = res.totalPages;
			listPage = res.page;
			if (res.metadata) listMetadata = { consecutivos: [], periodos: [], facturas: [], estados: [], ...res.metadata };
		} catch (err: any) { listError = err.message || 'Error al cargar liquidaciones'; }
		finally {
			listLoading = false;
			cargarFacturaInfo();
		}
	}

	async function cargarFacturaInfo() {
		const ids = liquidaciones.map(l => l.id);
		if (ids.length === 0) { facturaInfoMap = {}; return; }
		try {
			facturaInfoMap = await facturacionLiquidacionesAPI.batchFacturaInfo(ids);
		} catch { facturaInfoMap = {}; }
	}

	function filtrar() { listPage = 1; cargarListado(); }
	function irPagina(p: number) { listPage = p; cargarListado(); }

	function toggleSort(col: string) {
		if (listSortBy === col) {
			listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
		} else {
			listSortBy = col;
			listSortDir = col === 'fecha' ? 'desc' : 'asc';
		}
		filtrar();
	}

	function sortIcon(col: string) { return listSortBy === col ? (listSortDir === 'asc' ? ' ▲' : ' ▼') : ''; }

	function irNuevaLiquidacion() { goto('/dashboard/liquidaciones-servicios/nueva'); }
	function irEditarLiquidacion(id: string) { goto('/dashboard/liquidaciones-servicios/editar/' + id); }
	function irVerLiquidacion(id: string) { goto('/dashboard/liquidaciones-servicios/' + id + '?mode=view'); }

	async function verDetalle(id: string) {
		detailModal = true;
		detailLoading = true;
		detailLiq = null;
		try {
			detailLiq = await liquidacionesServiciosAPI.obtenerPorId(id);
		} catch (err: any) {
			alert(err.message || 'Error al cargar liquidacion');
			detailModal = false;
		} finally {
			detailLoading = false;
		}
	}
	function cerrarDetalle() { detailModal = false; detailLiq = null; }

	async function eliminarLiq(id: string) {
		deleting = true;
		try { await liquidacionesServiciosAPI.eliminar(id); deleteModalOpen = false; deleteTargetLiq = null; }
		catch (err: any) { alert(err.message || 'Error'); }
		finally { deleting = false; }
	}

	async function cambiarEstado(id: string, estado: EstadoLiquidacionServicio, motivo?: string) {
		try {
			await liquidacionesServiciosAPI.cambiarEstado(id, estado, motivo);
			if (detailLiq?.id === id) detailLiq = { ...detailLiq, estado };
		} catch (err: any) { alert(err.message || 'Error'); }
	}

	async function cambiarEstadoLiq(id: string, nuevoEstado: EstadoLiquidacionServicio, motivo?: string) {
		estadoChanging = true;
		try { await cambiarEstado(id, nuevoEstado, motivo); }
		finally { estadoChanging = false; }
	}

	function abrirAnularModal(id: string) {
		anularTargetId = id; anularMotivo = ''; anularModalOpen = true;
	}

	async function confirmarAnulacion() {
		if (!anularMotivo.trim()) { alert('Debes indicar el motivo de la anulacion'); return; }
		await cambiarEstadoLiq(anularTargetId, 'ANULADA', anularMotivo.trim());
		anularModalOpen = false; anularTargetId = ''; anularMotivo = '';
	}

	async function abrirHistorial(liqId: string, consecutivo: string) {
		historialLiqConsecutivo = consecutivo;
		historialExpandedId = null;
		historialModalOpen = true;
		historialLoading = true;
		try {
			historialData = await liquidacionesServiciosAPI.obtenerHistorial(liqId);
		} catch (e: any) {
			alert(e.message || 'Error cargando historial');
			historialData = [];
		} finally {
			historialLoading = false;
		}
	}

	function getAccionLabel(accion: string | null): { label: string; icon: string; color: string } {
		const map: Record<string, { label: string; icon: string; color: string }> = {
			creacion: { label: 'Creación', icon: '🆕', color: '#16a34a' },
			edicion: { label: 'Edición', icon: '✏️', color: '#2563eb' },
			cambio_estado: { label: 'Cambio de estado', icon: '🔄', color: '#d97706' },
		};
		return map[accion || ''] || map.cambio_estado;
	}

	function getEstadoBadge(estado: EstadoLiquidacionServicio) {
		const map: Record<string, { bg: string; text: string; label: string }> = {
			BORRADOR:  { bg: '#f1f5f9', text: '#64748b', label: 'Borrador' },
			LIQUIDADA: { bg: '#dbeafe', text: '#2563eb', label: 'Liquidada' },
			APROBADA:  { bg: '#dcfce7', text: '#16a34a', label: 'Aprobada' },
			FACTURADA: { bg: '#d1fae5', text: '#059669', label: 'Facturada' },
			ANULADA:   { bg: '#fee2e2', text: '#dc2626', label: 'Anulada' },
		};
		return map[estado] || map.BORRADOR;
	}

	function abrirModalFacturar() { facturarPreselected = []; facturarModalOpen = true; }

	function handleFacturaCreated(_e: CustomEvent<{ factura: any }>) {
		cargarListado(); facturarModalOpen = false;
	}

	async function cargarFacturas() {
		facturasLoading = true;
		try {
			const res = await facturacionLiquidacionesAPI.listar({
				page: facturasPage, limit: 15,
				busqueda: facturasBusqueda || undefined,
				estado: facturasEstado || undefined,
			});
			facturas = res.facturas;
			facturasTotal = res.total;
			facturasTotalPages = res.totalPages;
			facturasPage = res.page;
		} catch { facturas = []; }
		finally { facturasLoading = false; }
	}

	function filtrarFacturas() { facturasPage = 1; cargarFacturas(); }
	function irPaginaFacturas(p: number) { facturasPage = p; cargarFacturas(); }

	async function verDetalleFactura(id: string) {
		detalleFactura = null;
		try { detalleFactura = await facturacionLiquidacionesAPI.obtenerPorId(id); }
		catch (err: any) { alert(err.message || 'Error'); }
	}

	function abrirAnularFactura(fac: FacturaLiquidacion) {
		anularFacturaTarget = fac; anularFacturaMotivo = ''; anularFacturaModalOpen = true;
	}

	async function confirmarAnularFactura() {
		if (!anularFacturaTarget) return;
		anulandoFactura = true;
		try {
			await facturacionLiquidacionesAPI.anular(anularFacturaTarget.id, anularFacturaMotivo);
			anularFacturaModalOpen = false; anularFacturaTarget = null;
			cargarFacturas(); cargarListado();
		} catch (err: any) { alert(err.response?.data?.error || err.message || 'Error'); }
		finally { anulandoFactura = false; }
	}

	function abrirEliminarFactura(fac: FacturaLiquidacion) {
		eliminarFacturaTarget = fac; eliminarFacturaModalOpen = true;
	}

	async function confirmarEliminarFactura() {
		if (!eliminarFacturaTarget) return;
		eliminandoFactura = true;
		try {
			await facturacionLiquidacionesAPI.eliminar(eliminarFacturaTarget.id);
			eliminarFacturaModalOpen = false; eliminarFacturaTarget = null;
			cargarFacturas();
		} catch (err: any) { alert(err.response?.data?.error || err.message || 'Error al eliminar factura'); }
		finally { eliminandoFactura = false; }
	}
</script>

<div class="page-wrap">
	<!-- Sub-tabs -->
	<div class="mb-4 flex gap-1 border-b border-gray-200">
		<button class="px-4 py-2 text-sm font-semibold transition-colors {facturasTab === 'liquidaciones' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}" on:click={() => { facturasTab = 'liquidaciones'; }}>📋 Liquidaciones</button>
		{#if isAdmin || isFacturacion}
		<button class="px-4 py-2 text-sm font-semibold transition-colors {facturasTab === 'facturas' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}" on:click={() => { facturasTab = 'facturas'; cargarFacturas(); }}>🧾 Facturas</button>
		<button class="px-4 py-2 text-sm font-semibold transition-colors {facturasTab === 'terceros' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}" on:click={() => { facturasTab = 'terceros'; cargarTerceros(); }}>👤 Terceros</button>
		{/if}
		{#if isAdmin || isOperaciones}
		<button class="px-4 py-2 text-sm font-semibold transition-colors {facturasTab === 'configuracion' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}" on:click={() => { facturasTab = 'configuracion'; cargarConfig(); }}>⚙️ Configuración</button>
		{/if}
	</div>

	{#if facturasTab === 'liquidaciones'}

	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<h2 class="text-2xl font-bold text-gray-900 md:text-3xl">Liquidaciones Registradas</h2>
			<p class="text-sm text-gray-600">{listTotal} liquidaciones encontradas</p>
		</div>
		<div class="flex items-center gap-2">
			<!-- Mes/Año -->
			<div class="w-96 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
				<select bind:value={listMes} on:change={filtrar} class="h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200">
					<option value="">Todos los meses</option>
					{#each MESES as m}<option value={m}>{m}</option>{/each}
				</select>
				<select bind:value={listAnio} on:change={filtrar} class="h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200">
					<option value="">Año</option>
					{#each YEARS as y}<option value={y}>{y}</option>{/each}
				</select>
			</div>
			{#if (isFull || isLimited) && (isFacturacion || isAdmin)}
				<button class="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white hover:bg-purple-700 transition-colors" on:click={abrirModalFacturar}>🧾 Facturar</button>
			{/if}
			{#if isFull}
				<button class="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-600 transition-colors" on:click={irNuevaLiquidacion}>✏️ Nueva Liquidación</button>
			{/if}
		</div>
	</div>

	<!-- Filtros -->
	<div class="mb-4 flex items-center gap-2">
		<div class="relative flex-1 max-w-sm">
			<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
			<input type="text" bind:value={listBusqueda} on:keydown={(e) => e.key === 'Enter' && filtrar()} placeholder="Buscar por consecutivo, cliente…" class="h-9 w-full rounded-lg border border-gray-300 bg-white py-1.5 pr-3 !pl-9 text-xs focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" />
		</div>
		<button on:click={() => { listBusqueda=''; listMes=''; listAnio=''; listSortBy=''; listSortDir='desc'; colFilterConsecutivo=[]; colFilterCliente=[]; colFilterPeriodo=[]; colFilterEstado=[]; colFilterFactura=[]; colFilterLiquidador=[]; filtrar(); }} class="h-9 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap">✕ Limpiar</button>
	</div>

	<!-- Stats Cards -->
	{#if !listLoading}
		{@const filteredTotal = filteredLiquidaciones.reduce((s, l) => s + (l.total || 0), 0)}
		{@const filteredItems = filteredLiquidaciones.reduce((s, l) => s + (l.total_items || 0), 0)}
		{@const filteredBorrador = filteredLiquidaciones.filter(l => l.estado === 'BORRADOR').length}
		{@const filteredLiquidada = filteredLiquidaciones.filter(l => l.estado === 'LIQUIDADA').length}
		{@const filteredAprobada = filteredLiquidaciones.filter(l => l.estado === 'APROBADA').length}
		{@const filteredFacturada = filteredLiquidaciones.filter(l => l.estado === 'FACTURADA').length}
		{@const m = listMetadata}
		{@const showFiltered = hasActiveFilter}
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" transition:fade={{ duration: 200 }}>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Total Monto</p>
				<p class="text-lg font-bold text-gray-900">{COP(showFiltered ? filteredTotal : m.globalTotal)}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {COP(m.globalTotal)}</p>{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Total Registros</p>
				<p class="text-lg font-bold text-gray-900">{showFiltered ? listTotal : m.globalCount}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {m.globalCount}</p>{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Borrador</p>
				<p class="text-lg font-bold text-gray-500">{showFiltered ? filteredBorrador : (m.estadoCounts['BORRADOR'] || 0)}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {m.estadoCounts['BORRADOR'] || 0}</p>{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Liquidadas</p>
				<p class="text-lg font-bold text-blue-600">{showFiltered ? filteredLiquidada : (m.estadoCounts['LIQUIDADA'] || 0)}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {m.estadoCounts['LIQUIDADA'] || 0}</p>{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Aprobadas</p>
				<p class="text-lg font-bold text-emerald-600">{showFiltered ? filteredAprobada : (m.estadoCounts['APROBADA'] || 0)}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {m.estadoCounts['APROBADA'] || 0}</p>{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Facturadas</p>
				<p class="text-lg font-bold text-purple-600">{showFiltered ? filteredFacturada : (m.estadoCounts['FACTURADA'] || 0)}</p>
				{#if showFiltered}<p class="text-[10px] text-gray-400">General: {m.estadoCounts['FACTURADA'] || 0}</p>{/if}
			</div>
		</div>
	{/if}

	<!-- Canvas Table -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
		{#if listLoading}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-gray-600">Cargando liquidaciones…</p>
				</div>
			</div>
		{:else if listError}
			<div class="flex h-64 items-center justify-center"><p class="text-red-600">{listError}</p></div>
		{:else if liquidaciones.length === 0}
			<div class="flex h-64 items-center justify-center">
				<div class="text-center">
					<div class="text-5xl mb-3">📭</div>
					<p class="text-sm font-semibold text-gray-500">No hay liquidaciones</p>
					<p class="text-xs text-gray-400 mt-1">Crea una nueva haciendo clic en "Nueva Liquidación"</p>
				</div>
			</div>
		{:else}
			<!-- ═══ DESKTOP TABLE (hidden on mobile) ═══ -->
			<div class="hidden md:block overflow-x-auto">
				<table class="w-full border-collapse" style="min-width:1400px">
					<thead class="sticky top-0 z-20 bg-gray-50">
						<tr>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:100px">
								<span class="flex items-center gap-1">
									<button type="button" class="cursor-pointer select-none hover:text-emerald-700" on:click={() => toggleSort('consecutivo')}>Consecutivo{sortIcon('consecutivo')}</button>
									<MultiSelectFilter bind:selected={colFilterConsecutivo} options={uniqueConsecutivos} placeholder="Todos" searchable iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:160px">
								<span class="flex items-center gap-1">
									<button type="button" class="cursor-pointer select-none hover:text-emerald-700" on:click={() => toggleSort('cliente')}>Cliente{sortIcon('cliente')}</button>
									<MultiSelectFilter bind:selected={colFilterCliente} options={uniqueClientes} placeholder="Todos" searchable iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:120px">
								<span class="flex items-center gap-1">
									<button type="button" class="cursor-pointer select-none hover:text-emerald-700" on:click={() => toggleSort('periodo')}>Periodo{sortIcon('periodo')}</button>
									<MultiSelectFilter bind:selected={colFilterPeriodo} options={uniquePeriodos} placeholder="Todos" iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:100px">
								<span class="flex items-center justify-center gap-1">
									<button type="button" class="cursor-pointer select-none hover:text-emerald-700" on:click={() => toggleSort('estado')}>Estado{sortIcon('estado')}</button>
									<MultiSelectFilter bind:selected={colFilterEstado} options={uniqueEstados} placeholder="Todos" labelFn={(e) => getEstadoBadge(e as EstadoLiquidacionServicio).label} iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:110px">
								<span class="flex items-center justify-center gap-1">
									Factura
									<MultiSelectFilter bind:selected={colFilterFactura} options={uniqueFacturas} placeholder="Todas" searchable iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:70px">3° Liq.</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-green-50" style="min-width:120px">
								<button type="button" class="cursor-pointer select-none hover:text-emerald-700 w-full text-right" on:click={() => toggleSort('total')}>Total{sortIcon('total')}</button>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:60px">Items</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:120px">
								<span class="flex items-center gap-1">
									Liquidador
									<MultiSelectFilter bind:selected={colFilterLiquidador} options={uniqueLiquidadores} placeholder="Todos" searchable iconOnly on:change={filtrar} />
								</span>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:130px">
								<button type="button" class="cursor-pointer select-none hover:text-emerald-700" on:click={() => toggleSort('fecha')}>Fecha{sortIcon('fecha')}</button>
							</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:200px">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredLiquidaciones as liq (liq.id)}
							{@const badge = getEstadoBadge(liq.estado)}
							{@const facturaInfo = facturaInfoMap[liq.id]}
							{@const isNew = highlightedIds[liq.id] === 'created'}
							{@const isUpdated = highlightedIds[liq.id] === 'updated'}
							<tr class="border-b border-gray-100 hover:bg-emerald-50 {isNew ? 'border-l-4 border-l-emerald-500 bg-emerald-50/30' : ''} {isUpdated ? 'border-l-4 border-l-blue-500 bg-blue-50/30' : ''}">
								<td class="border border-gray-200 px-2 py-2 text-left text-xs">
									<span class="font-mono font-bold text-emerald-800">{liq.consecutivo}</span>
								</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 truncate max-w-[160px]" title={liq.cliente?.nombre || ''}>{liq.cliente?.nombre || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600">{getMesLabel(liq.mes)} {liq.anio}</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs">
									<span class="inline-block rounded px-2 py-1 text-xs font-medium" style="background:{badge.bg};color:{badge.text}">{liq.estado}</span>
								</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs">
									{#if facturaInfo}
										<span class="inline-block rounded px-2 py-1 text-xs font-bold font-mono bg-purple-100 text-purple-800">🧾 {facturaInfo.numero_factura}</span>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs">
									{#if liq.tercero_liquidado}
										<span class="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ Si</span>
									{:else}
										<span class="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">❌ No</span>
									{/if}
								</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-800">{COP(liq.total || 0)}</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs font-mono">{liq.total_items || 0}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 whitespace-nowrap">{liq.liquidado_por?.nombre || liq.creado_por?.nombre || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 whitespace-nowrap">{liq.created_at ? new Date(liq.created_at).toLocaleDateString('es-CO', { weekday:'short', day:'numeric', month:'short' }) + ' ' + new Date(liq.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-center whitespace-nowrap">
									<div class="flex items-center justify-center gap-1 flex-wrap">
										<button class="rounded p-1 hover:bg-gray-200 text-sm" title="Ver" on:click={() => irVerLiquidacion(liq.id)}>👁</button>
										{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
											<button class="rounded p-1 hover:bg-gray-200 text-sm" title="Editar" on:click={() => irEditarLiquidacion(liq.id)}>✏️</button>
										{/if}
										{#if canLiquidar && liq.estado === 'BORRADOR'}
											<button class="rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-emerald-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>✅ Liquidar</button>
										{/if}
										{#if canAprobar && liq.estado === 'LIQUIDADA'}
											<button class="rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-emerald-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>✅ Aprobar</button>
										{/if}
										{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
											<button class="rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-red-200" disabled={estadoChanging} on:click={() => abrirAnularModal(liq.id)}>🚫 Anular</button>
										{/if}
										{#if isAdmin && liq.estado === 'ANULADA'}
											<button class="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ Revertir</button>
										{/if}
										{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
											<button class="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ Borrador</button>
										{/if}
										{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
											<button class="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>↩️ Liquidada</button>
										{/if}
										{#if isFull && liq.estado === 'BORRADOR'}
											<button class="rounded p-1 hover:bg-red-100 text-sm" title="Eliminar" on:click={() => { deleteTargetLiq = liq; deleteModalOpen = true; }}>🗑</button>
										{/if}
										{#if isAdmin}
											<button class="rounded p-1 hover:bg-gray-200 text-sm" title="Historial" on:click={() => abrirHistorial(liq.id, liq.consecutivo)}>📜</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- ═══ MOBILE CARDS (shown on mobile only) ═══ -->
			<div class="md:hidden flex flex-col gap-3">
				{#each filteredLiquidaciones as liq (liq.id)}
					{@const badge = getEstadoBadge(liq.estado)}
					{@const facturaInfo = facturaInfoMap[liq.id]}
					{@const isNew = highlightedIds[liq.id] === 'created'}
					{@const isUpdated = highlightedIds[liq.id] === 'updated'}
					<div class="rounded-lg border bg-white shadow-sm {isNew ? 'border-l-4 border-l-emerald-500' : isUpdated ? 'border-l-4 border-l-blue-500' : 'border-gray-200'}">
						<!-- Card header -->
						<div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
							<div class="flex items-center gap-2">
								<span class="font-mono text-sm font-bold text-emerald-800">{liq.consecutivo}</span>
								<span class="inline-block rounded px-2 py-0.5 text-[10px] font-medium" style="background:{badge.bg};color:{badge.text}">{liq.estado}</span>
							</div>
							<span class="text-right font-mono text-sm font-bold text-emerald-800">{COP(liq.total || 0)}</span>
						</div>
						<!-- Card body -->
						<div class="px-3 py-2 space-y-1.5">
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Cliente</span>
								<span class="text-xs font-medium text-gray-800 text-right max-w-[60%] truncate">{liq.cliente?.nombre || '—'}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Periodo</span>
								<span class="text-xs text-gray-700">{getMesLabel(liq.mes)} {liq.anio}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Factura</span>
								{#if facturaInfo}
									<span class="rounded px-1.5 py-0.5 text-[10px] font-bold font-mono bg-purple-100 text-purple-800">🧾 {facturaInfo.numero_factura}</span>
								{:else}
									<span class="text-xs text-gray-400">—</span>
								{/if}
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">3° Liq.</span>
								{#if liq.tercero_liquidado}
									<span class="rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ Si</span>
								{:else}
									<span class="rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">❌ No</span>
								{/if}
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Items</span>
								<span class="text-xs font-mono text-gray-700">{liq.total_items || 0}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Liquidador</span>
								<span class="text-xs text-gray-700">{liq.liquidado_por?.nombre || liq.creado_por?.nombre || '—'}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[11px] text-gray-500">Fecha</span>
								<span class="text-xs text-gray-600">{liq.created_at ? new Date(liq.created_at).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) + ' ' + new Date(liq.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—'}</span>
							</div>
						</div>
						<!-- Card actions -->
						<div class="flex flex-wrap items-center gap-1 border-t border-gray-100 px-3 py-2">
							<button class="rounded p-1.5 hover:bg-gray-200 text-sm" title="Ver" on:click={() => irVerLiquidacion(liq.id)}>👁</button>
							{#if isFull && (liq.estado === 'BORRADOR' || (isAdmin && liq.estado === 'LIQUIDADA'))}
								<button class="rounded p-1.5 hover:bg-gray-200 text-sm" title="Editar" on:click={() => irEditarLiquidacion(liq.id)}>✏️</button>
							{/if}
							{#if canLiquidar && liq.estado === 'BORRADOR'}
								<button class="rounded bg-emerald-100 text-emerald-700 px-2 py-1 text-[11px] font-bold hover:bg-emerald-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>✅ Liquidar</button>
							{/if}
							{#if canAprobar && liq.estado === 'LIQUIDADA'}
								<button class="rounded bg-emerald-100 text-emerald-700 px-2 py-1 text-[11px] font-bold hover:bg-emerald-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>✅ Aprobar</button>
							{/if}
							{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
								<button class="rounded bg-red-100 text-red-700 px-2 py-1 text-[11px] font-bold hover:bg-red-200" disabled={estadoChanging} on:click={() => abrirAnularModal(liq.id)}>🚫 Anular</button>
							{/if}
							{#if isAdmin && liq.estado === 'ANULADA'}
								<button class="rounded bg-amber-100 text-amber-700 px-2 py-1 text-[11px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ Revertir</button>
							{/if}
							{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
								<button class="rounded bg-amber-100 text-amber-700 px-2 py-1 text-[11px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ Borrador</button>
							{/if}
							{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
								<button class="rounded bg-amber-100 text-amber-700 px-2 py-1 text-[11px] font-bold hover:bg-amber-200" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>↩️ Liquidada</button>
							{/if}
							{#if isFull && liq.estado === 'BORRADOR'}
								<button class="rounded p-1.5 hover:bg-red-100 text-sm" title="Eliminar" on:click={() => { deleteTargetLiq = liq; deleteModalOpen = true; }}>🗑</button>
							{/if}
							{#if isAdmin}
								<button class="rounded p-1.5 hover:bg-gray-200 text-sm" title="Historial" on:click={() => abrirHistorial(liq.id, liq.consecutivo)}>📜</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Pagination -->
	{#if !listLoading && listTotalPages > 1}
		<div class="mt-4 flex items-center justify-between">
			<div class="text-sm text-gray-600">
				Página {listPage} de {listTotalPages} — {listTotal} registros
			</div>
			<div class="flex gap-2">
				<button disabled={listPage <= 1} on:click={() => irPagina(listPage - 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Anterior</button>
				{#each Array(Math.min(listTotalPages, 10)) as _, i}
					<button class="rounded-lg border px-3 py-1 text-sm {listPage === i + 1 ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:bg-gray-50'}" on:click={() => irPagina(i + 1)}>{i + 1}</button>
				{/each}
				{#if listTotalPages > 10}<span class="text-xs text-gray-400">…{listTotalPages}</span>{/if}
				<button disabled={listPage >= listTotalPages} on:click={() => irPagina(listPage + 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Siguiente</button>
			</div>
		</div>
	{/if}

	{:else if facturasTab === 'facturas'}

	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<h2 class="text-2xl font-bold text-gray-900 md:text-3xl">Facturas de Liquidaciones</h2>
			<p class="text-sm text-gray-600">{facturasTotal} facturas encontradas</p>
		</div>
	</div>

	<!-- Filtros -->
	<div class="mb-4 flex flex-col gap-4 md:flex-row">
		<div class="flex-1">
			<div class="relative">
				<svg class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
				<input type="text" bind:value={facturasBusqueda} on:input={filtrarFacturas} placeholder="Buscar por N° factura, cliente..." class="h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-10 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" style="padding-left: 2.5rem;" />
			</div>
		</div>
		<div class="flex items-center gap-3">
			<select bind:value={facturasEstado} on:change={filtrarFacturas} class="h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200">
				<option value="">Todos los estados</option>
				<option value="ACTIVA">Activa</option>
				<option value="ANULADA">Anulada</option>
			</select>
			<button on:click={() => { facturasBusqueda=''; facturasEstado=''; filtrarFacturas(); }} class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap">✕ Limpiar</button>
		</div>
	</div>

	<!-- Stats Cards -->
	{#if !facturasLoading && facturas.length > 0}
		{@const totalValor = facturas.reduce((s, f) => s + (f.valor_total || 0), 0)}
		{@const countActiva = facturas.filter(f => f.estado === 'ACTIVA').length}
		{@const countAnulada = facturas.filter(f => f.estado === 'ANULADA').length}
		{@const totalLiqs = facturas.reduce((s, f) => s + (f.items?.length || 0), 0)}
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" transition:fade={{ duration: 200 }}>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Total Facturado</p>
				<p class="text-lg font-bold text-gray-900">{COP(totalValor)}</p>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Liquidaciones</p>
				<p class="text-lg font-bold text-gray-900">{totalLiqs}</p>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Activas</p>
				<p class="text-lg font-bold text-emerald-600">{countActiva}</p>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<p class="text-xs text-gray-500">Anuladas</p>
				<p class="text-lg font-bold text-red-600">{countAnulada}</p>
			</div>
		</div>
	{/if}

	<!-- Canvas Table -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
		{#if facturasLoading}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-gray-600">Cargando facturas…</p>
				</div>
			</div>
		{:else if facturas.length === 0}
			<div class="flex h-64 items-center justify-center">
				<div class="text-center">
					<div class="text-5xl mb-3">📭</div>
					<p class="text-sm font-semibold text-gray-500">No se encontraron facturas</p>
				</div>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse" style="min-width:1000px">
					<thead class="sticky top-0 z-20 bg-gray-50">
						<tr>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:110px">No Factura</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:120px">Fecha</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:100px">Liquidaciones</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-green-50" style="min-width:130px">Total</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:90px">Estado</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:120px">Facturado por</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:150px">Observaciones</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:120px">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each facturas as fac (fac.id)}
							<tr class="border-b border-gray-100 hover:bg-emerald-50">
								<td class="border border-gray-200 px-2 py-2 text-left text-xs">
									<span class="font-mono font-bold text-purple-800">{fac.numero_factura}</span>
								</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 whitespace-nowrap">{fac.fecha_facturacion ? new Date(fac.fecha_facturacion).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) : '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs font-mono">{fac.items?.length || 0}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-800">{COP(fac.valor_total || 0)}</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs">
									{#if fac.estado === 'ACTIVA'}
										<span class="inline-block rounded px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800">ACTIVA</span>
									{:else}
										<span class="inline-block rounded px-2 py-1 text-xs font-medium bg-red-100 text-red-800">ANULADA</span>
									{/if}
								</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600">{fac.facturado_por?.nombre || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 truncate max-w-[150px]" title={fac.observaciones || ''}>{fac.observaciones || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-center whitespace-nowrap">
									<div class="flex items-center justify-center gap-1">
										<button class="rounded p-1 hover:bg-gray-200 text-sm" title="Ver detalle" on:click={() => verDetalleFactura(fac.id)}>👁</button>
										{#if fac.estado === 'ACTIVA'}
											<button class="rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold hover:bg-red-200" on:click={() => abrirAnularFactura(fac)}>🚫 Anular</button>
										{/if}
										{#if fac.estado === 'ANULADA' && (isAdmin || isFacturacion)}
											<button class="rounded p-1 hover:bg-red-100 text-sm" title="Eliminar" on:click={() => abrirEliminarFactura(fac)}>🗑</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- Pagination -->
	{#if !facturasLoading && facturasTotalPages > 1}
		<div class="mt-4 flex items-center justify-between">
			<div class="text-sm text-gray-600">
				Página {facturasPage} de {facturasTotalPages} — {facturasTotal} registros
			</div>
			<div class="flex gap-2">
				<button disabled={facturasPage <= 1} on:click={() => irPaginaFacturas(facturasPage - 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Anterior</button>
				{#each Array(Math.min(facturasTotalPages, 10)) as _, i}
					<button class="rounded-lg border px-3 py-1 text-sm {facturasPage === i + 1 ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:bg-gray-50'}" on:click={() => irPaginaFacturas(i + 1)}>{i + 1}</button>
				{/each}
				{#if facturasTotalPages > 10}<span class="text-xs text-gray-400">…{facturasTotalPages}</span>{/if}
				<button disabled={facturasPage >= facturasTotalPages} on:click={() => irPaginaFacturas(facturasPage + 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Siguiente</button>
			</div>
		</div>
	{/if}

	{:else if facturasTab === 'terceros'}
	<!-- TERCEROS HISTORIAL SUB-TAB — Canvas style like Recargos -->

	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<h2 class="text-2xl font-bold text-gray-900 md:text-3xl">Historial Liquidaciones de Terceros</h2>
			<p class="text-sm text-gray-600">{tercerosTotal} registros encontrados</p>
		</div>

		<div class="flex items-center gap-2">
			<!-- Navegación Mes/Año -->
			<div class="w-96 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
				<select value={tercerosMes === '' ? '' : String(tercerosMes)} on:change={(e) => { const v = (e.target as HTMLSelectElement).value; tercerosMes = v === '' ? '' : parseInt(v); filtrarTerceros(); }} class="h-10 w-96 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200">
						<option value="">Todos los meses</option>
						{#each MESES as m, i}<option value={String(i + 1)}>{m}</option>{/each}
					</select>
				<input type="number" bind:value={tercerosAnio} on:change={filtrarTerceros} class="h-10 w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" min="2020" max="2030" />
			</div>
			<!-- Limpiar -->
			<button on:click={() => { tercerosBusqueda=''; tercerosPlaca=''; tercerosMes=''; tercerosAnio=new Date().getFullYear(); filtrarTerceros(); }} class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">✕ Limpiar</button>
		</div>
	</div>

	<!-- Filtros y búsqueda -->
	<div class="mb-4 flex flex-col gap-4 md:flex-row">
		<div class="flex-1">
			<div class="relative">
				<svg class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
				<input type="text" bind:value={tercerosBusqueda} on:keydown={(e) => e.key === 'Enter' && filtrarTerceros()} placeholder="Buscar por consecutivo, tercero, recorrido..." class="h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-10 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" style="padding-left: 2.5rem;" />
			</div>
		</div>
		<div class="flex items-center gap-3">
			<input type="text" bind:value={tercerosPlaca} on:keydown={(e) => e.key === 'Enter' && filtrarTerceros()} placeholder="Placa..." class="h-10 w-28 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" />
		</div>
	</div>

	<!-- Stats Panel Terceros -->
	{#if !tercerosLoading && tercerosItems.length > 0}
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" transition:fade={{ duration: 200 }}>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
						<span class="text-sm">📋</span>
					</div>
					<div>
						<p class="text-xs text-gray-500">Registros</p>
						<p class="text-lg font-bold text-gray-900">{tercerosItems.length}</p>
					</div>
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
						<span class="text-sm">💰</span>
					</div>
					<div>
						<p class="text-xs text-gray-500">Total Facturado</p>
						<p class="text-lg font-bold text-gray-900">{COP(tercerosItems.reduce((s, i) => s + i.total_facturado, 0))}</p>
					</div>
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
						<span class="text-sm">🏢</span>
					</div>
					<div>
						<p class="text-xs text-gray-500">Admon Total</p>
						<p class="text-lg font-bold text-gray-900">{COP(tercerosItems.reduce((s, i) => s + i.valor_admin, 0))}</p>
					</div>
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100">
						<span class="text-sm">👤</span>
					</div>
					<div>
						<p class="text-xs text-gray-500">V/Liquidar</p>
						<p class="text-lg font-bold text-gray-900">{COP(tercerosItems.reduce((s, i) => s + i.valor_liquidar, 0))}</p>
					</div>
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
						<span class="text-sm">🏦</span>
					</div>
					<div>
						<p class="text-xs text-gray-500">Ing. Cotransmeq</p>
						<p class="text-lg font-bold text-gray-900">{COP(tercerosItems.reduce((s, i) => s + i.ingreso_empresa, 0))}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Canvas Table -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
		{#if tercerosLoading}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-gray-600">Cargando terceros...</p>
				</div>
			</div>
		{:else if tercerosItems.length === 0}
			<div class="flex h-64 items-center justify-center">
				<div class="text-center">
					<div class="text-5xl mb-3">👤</div>
					<p class="text-sm font-semibold text-gray-500">No se encontraron items de terceros</p>
					<p class="text-xs text-gray-400 mt-1">Ajusta los filtros o crea liquidaciones con items de terceros</p>
				</div>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse" style="min-width:1600px">
					<thead class="sticky top-0 z-20 bg-gray-50">
						<tr>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:40px">#</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:100px">Consecutivo</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:150px">Cliente</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:90px">Placa</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:110px">N° Planilla</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:180px">Tercero (Propietario)</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:200px">Recorrido</th>
							<th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-700" style="min-width:110px">Fechas</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-gray-50" style="min-width:100px">V/Unidad</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-gray-50" style="min-width:110px">Total Fact.</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-gray-50" style="min-width:100px">Admon $</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-green-50" style="min-width:110px">V/Liquidar</th>
							<th class="border border-gray-200 px-2 py-2 text-right text-xs font-semibold text-gray-700 bg-green-50" style="min-width:120px">Ing. Cotransmeq</th>
							<th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700" style="min-width:110px">N° Factura</th>
						</tr>
					</thead>
					<tbody>
						{#each tercerosItems as item, idx}
							{@const facItem = item.liquidacion?.factura_items?.[0]}
							{@const numFactura = facItem?.factura?.numero_factura || ''}
							<tr class="border-b border-gray-100 hover:bg-emerald-50 {numFactura ? 'bg-emerald-50/30' : ''}">
								<td class="border border-gray-200 px-2 py-2 text-center text-xs text-gray-400">{(tercerosPage - 1) * 50 + idx + 1}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs">
									<span class="font-mono font-bold text-emerald-800">{item.liquidacion?.consecutivo || '—'}</span>
								</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 truncate max-w-[150px]" title={item.liquidacion?.cliente?.nombre || ''}>{item.liquidacion?.cliente?.nombre || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs font-bold text-gray-900">{item.placa}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs font-mono text-gray-600">{item.item?.numero_planilla || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 truncate max-w-[180px]" title={item.tercero?.nombre_completo || ''}>{item.tercero?.nombre_completo || '—'}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 truncate max-w-[200px]" title={item.recorrido}>{item.recorrido}</td>
								<td class="border border-gray-200 px-2 py-2 text-left text-xs text-gray-600 whitespace-nowrap">{item.fechas}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-semibold text-gray-900">{COP(item.valor_unitario)}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-semibold text-gray-900">{COP(item.total_facturado)}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono text-gray-500">{COP(item.valor_admin)}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-800">{COP(item.valor_liquidar)}</td>
								<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-800">{COP(item.ingreso_empresa)}</td>
								<td class="border border-gray-200 px-2 py-2 text-center text-xs">
									{#if numFactura}
										<span class="inline-block rounded px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800">📄 {numFactura}</span>
									{:else}
										<span class="text-gray-400 text-[10px]">Sin factura</span>
									{/if}
								</td>
							</tr>
						{/each}

						<!-- Totals Row -->
						<tr class="sticky bottom-0 bg-emerald-50 font-semibold">
							<td class="border border-gray-200 px-2 py-2" colspan="8">
								<span class="text-xs text-gray-600 uppercase tracking-wide">Totales página</span>
							</td>
							<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-900">{COP(tercerosItems.reduce((s, i) => s + i.valor_unitario, 0))}</td>
							<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-900">{COP(tercerosItems.reduce((s, i) => s + i.total_facturado, 0))}</td>
							<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-900">{COP(tercerosItems.reduce((s, i) => s + i.valor_admin, 0))}</td>
							<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-900">{COP(tercerosItems.reduce((s, i) => s + i.valor_liquidar, 0))}</td>
							<td class="border border-gray-200 px-2 py-2 text-right text-xs font-mono font-bold text-emerald-900">{COP(tercerosItems.reduce((s, i) => s + i.ingreso_empresa, 0))}</td>
							<td class="border border-gray-200 px-2 py-2"></td>
						</tr>
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- Pagination -->
	{#if !tercerosLoading && tercerosTotalPages > 1}
		<div class="mt-4 flex items-center justify-between">
			<div class="text-sm text-gray-600">
				Mostrando {(tercerosPage - 1) * 50 + 1} a {Math.min(tercerosPage * 50, tercerosTotal)} de {tercerosTotal} registros
			</div>
			<div class="flex gap-2">
				<button disabled={tercerosPage <= 1} on:click={() => irPaginaTerceros(tercerosPage - 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Anterior</button>
				{#each Array(Math.min(tercerosTotalPages, 10)) as _, i}
					<button class="rounded-lg border px-3 py-1 text-sm {tercerosPage === i + 1 ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:bg-gray-50'}" on:click={() => irPaginaTerceros(i + 1)}>{i + 1}</button>
				{/each}
				{#if tercerosTotalPages > 10}<span class="text-xs text-gray-400">…{tercerosTotalPages}</span>{/if}
				<button disabled={tercerosPage >= tercerosTotalPages} on:click={() => irPaginaTerceros(tercerosPage + 1)} class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Siguiente</button>
			</div>
		</div>
	{/if}

	{:else if facturasTab === 'configuracion'}
	<!-- CONFIG SUB-TAB -->
	<div class="card">
		<div class="ch">⚙️ Configuracion del Liquidador de Servicios</div>

		{#if configLoading}
			<div class="loading-center"><div class="spinner"></div></div>
		{:else}
			<div class="cfg-grid">
				<div class="cfg-field">
					<label for="cfg-salario-basico">Salario Basico</label>
					<input id="cfg-salario-basico" type="text" value={fmtCOP(configForm.salario_basico)} on:focus={handleCOPFocus} on:blur={(e) => handleCOPBlur(e, 'salario_basico')} inputmode="numeric" />
					<span class="cfg-hint">SMLV vigente</span>
				</div>
				<div class="cfg-field">
					<label for="cfg-cargo">Cargo</label>
					<input id="cfg-cargo" type="text" bind:value={configForm.cargo} />
				</div>
				<div class="cfg-field">
					<label for="cfg-valor-hora">Valor Hora Override</label>
					<input id="cfg-valor-hora" type="text" value={fmtCOP(configForm.valor_hora_override)} on:focus={handleCOPFocus} on:blur={(e) => handleCOPBlur(e, 'valor_hora_override')} inputmode="numeric" />
					<span class="cfg-hint">0 = auto ({COP(configValorHoraAuto)})</span>
				</div>
				<div class="cfg-field">
					<label for="cfg-conductor-adicional">Conductor Adicional</label>
					<input id="cfg-conductor-adicional" type="text" value={fmtCOP(configForm.conductor_adicional)} on:focus={handleCOPFocus} on:blur={(e) => handleCOPBlur(e, 'conductor_adicional')} inputmode="numeric" />
				</div>
				<div class="cfg-field">
					<label for="cfg-pct-seg-social">% Seg. Social</label>
					<input id="cfg-pct-seg-social" type="number" step="0.01" bind:value={configForm.pct_seg_social} />
				</div>
				<div class="cfg-field">
					<label for="cfg-pct-prestaciones">% Prestaciones</label>
					<input id="cfg-pct-prestaciones" type="number" step="0.01" bind:value={configForm.pct_prestaciones} />
				</div>
				<div class="cfg-field">
					<label for="cfg-pct-admin">% Admin</label>
					<input id="cfg-pct-admin" type="number" step="0.01" bind:value={configForm.pct_admin} />
				</div>
				<div class="cfg-field">
					<label for="cfg-prueba-covid">Prueba Covid</label>
					<input id="cfg-prueba-covid" type="text" value={fmtCOP(configForm.prueba_covid)} on:focus={handleCOPFocus} on:blur={(e) => handleCOPBlur(e, 'prueba_covid')} inputmode="numeric" />
					<span class="cfg-hint">0 = sin cobro</span>
				</div>
			</div>

			<div style="margin-top:20px;display:flex;justify-content:flex-end">
				<button class="btn-filtrar" style="padding:10px 32px;font-size:13px"
					on:click={guardarConfig} disabled={configSaving}>
					{configSaving ? 'Guardando...' : '💾 Guardar Configuracion'}
				</button>
			</div>
		{/if}
	</div>
	{/if}

</div>

<!-- DETAIL MODAL -->
{#if detailModal}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={cerrarDetalle}>
	<div class="modal-box">
		<div class="modal-hd">
			<h3>📄 {detailLiq?.consecutivo || 'Detalle'}</h3>
			<div style="display:flex;gap:8px;align-items:center">
				{#if detailLiq && (detailLiq.estado === 'BORRADOR' || (isAdmin && detailLiq.estado === 'LIQUIDADA'))}
					<button class="btn-estado" style="border-color:#2563eb;color:#2563eb;font-size:11px;padding:5px 12px" on:click={() => { cerrarDetalle(); if (detailLiq) irEditarLiquidacion(detailLiq.id); }}>✏️ Editar</button>
				{/if}
				{#if detailLiq}
					<button class="btn-estado" style="border-color:#0f4025;color:#0f4025;font-size:11px;padding:5px 12px" on:click={() => { cerrarDetalle(); if (detailLiq) irVerLiquidacion(detailLiq.id); }}>👁 Ver</button>
				{/if}
				<button class="modal-close" on:click={cerrarDetalle}>✕</button>
			</div>
		</div>
		<div class="modal-body">
			{#if detailLoading}
				<div class="loading-center"><div class="spinner"></div></div>
			{:else if detailLiq}
				<div class="det-grid">
					<div>
						<div class="det-label">Consecutivo</div>
						<div class="det-value" style="font-family:monospace;color:#0f4025">{detailLiq.consecutivo}</div>
					</div>
					<div>
						<div class="det-label">Cliente</div>
						<div class="det-value">{detailLiq.cliente?.nombre || '—'}</div>
					</div>
					<div>
						<div class="det-label">NIT</div>
						<div class="det-value">{detailLiq.cliente?.nit || '—'}</div>
					</div>
					<div>
						<div class="det-label">Periodo</div>
						<div class="det-value">{getMesLabel(detailLiq.mes)} {detailLiq.anio}</div>
					</div>
					<div>
						<div class="det-label">Estado</div>
						<div class="det-value">
							<span class="badge" style="background:{getEstadoBadge(detailLiq.estado).bg};color:{getEstadoBadge(detailLiq.estado).text}">{detailLiq.estado}</span>
						</div>
					</div>
					<div>
						<div class="det-label">Fecha de Creacion</div>
						<div class="det-value">{detailLiq.created_at ? new Date(detailLiq.created_at).toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' }) : '—'}</div>
					</div>
				</div>

				{#if detailLiq.estado === 'ANULADA' && detailLiq.motivo_anulacion}
					<div class="det-anulacion">
						<div class="det-anulacion-hd">🚫 Motivo de Anulacion</div>
						<div class="det-anulacion-body">{detailLiq.motivo_anulacion}</div>
					</div>
				{/if}

				{#if detailLiq.items && detailLiq.items.length > 0}
					<div class="det-tbl-wrap">
						<table class="det-tbl">
							<thead>
								<tr>
									<th>Placa</th>
									<th>F. Inicial</th>
									<th>F. Final</th>
									<th>Recorrido</th>
									<th>Tipo Servicio</th>
									<th style="text-align:center">Cant.</th>
									<th style="text-align:right">Vr. Unit.</th>
									<th style="text-align:right">Subtotal</th>
									<th style="text-align:center">Dcto</th>
									<th style="text-align:right">Vr. Final</th>
								</tr>
							</thead>
							<tbody>
								{#each detailLiq.items as it}
									<tr>
										<td style="font-family:monospace;font-weight:700;color:#0f4025">{it.placa}</td>
										<td>{it.fecha_inicial ? new Date(it.fecha_inicial).toLocaleDateString('es-CO') : '—'}</td>
										<td>{it.fecha_final ? new Date(it.fecha_final).toLocaleDateString('es-CO') : '—'}</td>
										<td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis">{it.recorrido || ''}</td>
										<td style="font-size:11px">{it.tipo_servicio}</td>
										<td style="text-align:center;font-weight:700">{it.cantidad}</td>
										<td class="mc">{COP(it.valor_unitario)}</td>
										<td class="mc">{COP(it.subtotal || it.cantidad * it.valor_unitario)}</td>
										<td style="text-align:center">{it.porcentaje_descuento || 0}%</td>
										<td class="mc" style="font-weight:700;color:#0f4025">{COP(it.valor_final || it.subtotal || it.cantidad * it.valor_unitario)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<div class="det-totals">
					<div class="det-total-row"><span>Servicios</span><span style="font-family:monospace;font-weight:600">{COP(detailLiq.valor_servicios || 0)}</span></div>
					<div class="det-total-row"><span>Recargos</span><span style="font-family:monospace;font-weight:600">{COP(detailLiq.valor_recargos || 0)}</span></div>
					<div class="det-total-row"><span>Subtotal</span><span style="font-family:monospace;font-weight:600">{COP(detailLiq.subtotal || 0)}</span></div>
					<div class="det-total-row"><span>IVA ({detailLiq.porcentaje_iva || 0}%)</span><span style="font-family:monospace;font-weight:600">{COP(detailLiq.valor_iva || 0)}</span></div>
					<div class="det-total-row main"><span>TOTAL</span><span>{COP(detailLiq.total || 0)}</span></div>
				</div>

				<div class="estado-actions">
					{#if canLiquidar && detailLiq.estado === 'BORRADOR'}
						<button class="btn-estado green" on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}>✅ Liquidar</button>
					{/if}
					{#if canAprobar && detailLiq.estado === 'LIQUIDADA'}
						<button class="btn-estado green" on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'APROBADA')}>✅ Aprobar</button>
					{/if}
					{#if canAnular && detailLiq.estado !== 'ANULADA' && detailLiq.estado !== 'FACTURADA'}
						<button class="btn-estado red" on:click={() => detailLiq && abrirAnularModal(detailLiq.id)}>🚫 Anular</button>
					{/if}
					{#if isAdmin && detailLiq.estado === 'ANULADA'}
						<button class="btn-estado amber" on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}>↩️ Revertir</button>
					{/if}
					{#if canRevertirABorrador && detailLiq.estado === 'LIQUIDADA'}
						<button class="btn-estado amber" on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'BORRADOR')}>↩️ A Borrador</button>
					{/if}
					{#if canRevertirALiquidada && detailLiq.estado === 'APROBADA'}
						<button class="btn-estado amber" on:click={() => detailLiq && cambiarEstado(detailLiq.id, 'LIQUIDADA')}>↩️ A Liquidada</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ELIMINAR LIQUIDACION -->
{#if deleteModalOpen && deleteTargetLiq}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>
	<div class="modal-box" style="max-width:440px">
		<div class="modal-hd">
			<h3>🗑 Eliminar Liquidacion</h3>
			<button class="modal-close" on:click={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>✕</button>
		</div>
		<div class="modal-body">
			<div style="text-align:center;margin-bottom:16px">
				<div style="font-size:48px;margin-bottom:8px">⚠️</div>
				<p style="font-size:14px;color:#374151;font-weight:600;margin:0">¿Estas seguro de eliminar esta liquidacion?</p>
			</div>
			<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:16px">
				<div style="display:flex;justify-content:space-between;margin-bottom:6px">
					<span style="font-size:12px;color:#64748b">Consecutivo</span>
					<span style="font-size:12px;font-weight:700;color:#0f172a;font-family:monospace">{deleteTargetLiq.consecutivo}</span>
				</div>
				<div style="display:flex;justify-content:space-between;margin-bottom:6px">
					<span style="font-size:12px;color:#64748b">Cliente</span>
					<span style="font-size:12px;font-weight:600;color:#0f172a">{deleteTargetLiq.cliente?.nombre || '—'}</span>
				</div>
				<div style="display:flex;justify-content:space-between">
					<span style="font-size:12px;color:#64748b">Total</span>
					<span style="font-size:12px;font-weight:700;color:#0f172a">{COP(deleteTargetLiq.total || 0)}</span>
				</div>
			</div>
			<p style="font-size:12px;color:#dc2626;margin:0 0 16px;text-align:center">
				Esta accion es irreversible. Se eliminaran todos los items asociados.
			</p>
			<div style="display:flex;gap:10px;justify-content:flex-end">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>Cancelar</button>
				<button class="btn-estado red" disabled={deleting} on:click={() => deleteTargetLiq && eliminarLiq(deleteTargetLiq.id)}>
					{deleting ? '⏳ Eliminando...' : '🗑 Eliminar'}
				</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ANULAR LIQUIDACION -->
{#if anularModalOpen}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={() => (anularModalOpen = false)}>
	<div class="modal-box" style="max-width:480px">
		<div class="modal-hd">
			<h3>�� Anular Liquidacion</h3>
			<button class="modal-close" on:click={() => (anularModalOpen = false)}>✕</button>
		</div>
		<div class="modal-body">
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">
				Esta accion cambiara el estado a <strong style="color:#dc2626">ANULADA</strong>.
				Indica el motivo de la anulacion para su debida correccion.
			</p>
			<label for="anular-motivo" style="font-weight:600;font-size:12px;color:#374151;display:block;margin-bottom:4px">Motivo de anulacion <span style="color:#dc2626">*</span></label>
			<textarea id="anular-motivo" bind:value={anularMotivo} rows="4"
				placeholder="Ej: Error en valores, datos incorrectos del cliente, duplicidad..."
				style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
			<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => (anularModalOpen = false)}>Cancelar</button>
				<button class="btn-estado red" disabled={!anularMotivo.trim() || estadoChanging} on:click={confirmarAnulacion}>
					{estadoChanging ? '⏳ Anulando...' : '🚫 Confirmar Anulacion'}
				</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: DETALLE FACTURA -->
{#if detalleFactura}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={() => (detalleFactura = null)}>
	<div class="modal-box" style="max-width:640px">
		<div class="modal-hd">
			<h3>🧾 Factura #{detalleFactura.numero_factura}</h3>
			<button class="modal-close" on:click={() => (detalleFactura = null)}>✕</button>
		</div>
		<div class="modal-body">
			<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
				<div>
					<span style="font-size:11px;color:#64748b">No Factura</span>
					<div style="font-weight:700;font-family:monospace">{detalleFactura.numero_factura}</div>
				</div>
				<div>
					<span style="font-size:11px;color:#64748b">Fecha</span>
					<div>{detalleFactura.fecha_facturacion ? new Date(detalleFactura.fecha_facturacion).toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric' }) : '—'}</div>
				</div>
				<div>
					<span style="font-size:11px;color:#64748b">Estado</span>
					<div>
						{#if detalleFactura.estado === 'ACTIVA'}
							<span class="badge" style="background:#d4edda;color:#155724">ACTIVA</span>
						{:else}
							<span class="badge" style="background:#f8d7da;color:#721c24">ANULADA</span>
						{/if}
					</div>
				</div>
				<div>
					<span style="font-size:11px;color:#64748b">Total</span>
					<div style="font-weight:700;color:#0f4025">{COP(detalleFactura.valor_total || 0)}</div>
				</div>
				<div>
					<span style="font-size:11px;color:#64748b">Facturado por</span>
					<div>{detalleFactura.facturado_por?.nombre || '—'}</div>
				</div>
				{#if detalleFactura.anulado_por}
					<div>
						<span style="font-size:11px;color:#64748b">Anulado por</span>
						<div style="color:#dc2626">{detalleFactura.anulado_por?.nombre || '—'}</div>
					</div>
				{/if}
				{#if detalleFactura.observaciones}
					<div style="grid-column:span 2">
						<span style="font-size:11px;color:#64748b">Observaciones</span>
						<div style="font-size:13px">{detalleFactura.observaciones}</div>
					</div>
				{/if}
				{#if detalleFactura.motivo_anulacion}
					<div style="grid-column:span 2">
						<span style="font-size:11px;color:#64748b">Motivo de anulacion</span>
						<div style="font-size:13px;color:#dc2626">{detalleFactura.motivo_anulacion}</div>
					</div>
				{/if}
			</div>

			<h4 style="font-size:13px;margin:12px 0 8px;color:#374151">Liquidaciones asociadas ({detalleFactura.items?.length || 0})</h4>
			<div class="ltbl-wrap" style="max-height:280px;overflow-y:auto">
				<table class="ltbl" style="font-size:12px">
					<thead>
						<tr>
							<th>Consecutivo</th>
							<th>Cliente</th>
							<th>Periodo</th>
							<th style="text-align:right">Valor</th>
						</tr>
					</thead>
					<tbody>
						{#each detalleFactura.items || [] as item}
							<tr>
								<td style="font-family:monospace;font-weight:600">{item.liquidacion?.consecutivo || '—'}</td>
								<td>{item.liquidacion?.cliente?.nombre || '—'}</td>
								<td>{item.liquidacion?.mes || ''} {item.liquidacion?.anio || ''}</td>
								<td style="text-align:right;font-weight:600">{COP(item.valor_liquidacion || 0)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div style="display:flex;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => (detalleFactura = null)}>Cerrar</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ANULAR FACTURA -->
{#if anularFacturaModalOpen && anularFacturaTarget}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={() => { anularFacturaModalOpen = false; anularFacturaTarget = null; }}>
	<div class="modal-box" style="max-width:480px">
		<div class="modal-hd">
			<h3>🚫 Anular Factura</h3>
			<button class="modal-close" on:click={() => { anularFacturaModalOpen = false; anularFacturaTarget = null; }}>✕</button>
		</div>
		<div class="modal-body">
			<div style="text-align:center;margin-bottom:16px">
				<div style="font-size:48px;margin-bottom:8px">⚠️</div>
				<p style="font-size:14px;color:#374151;font-weight:600;margin:0">
					¿Anular la factura <span style="font-family:monospace">#{anularFacturaTarget.numero_factura}</span>?
				</p>
				<p style="font-size:12px;color:#64748b;margin:6px 0 0">
					Las liquidaciones asociadas volveran a estado LIQUIDADA.
				</p>
			</div>
			<label for="anular-factura-motivo" style="font-weight:600;font-size:12px;color:#374151;display:block;margin-bottom:4px">Motivo de anulacion <span style="color:#dc2626">*</span></label>
			<textarea id="anular-factura-motivo" bind:value={anularFacturaMotivo} rows="3"
				placeholder="Ej: Error en numero de factura, liquidaciones incorrectas..."
				style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
			<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => { anularFacturaModalOpen = false; anularFacturaTarget = null; }}>Cancelar</button>
				<button class="btn-estado red" disabled={!anularFacturaMotivo.trim() || anulandoFactura} on:click={confirmarAnularFactura}>
					{anulandoFactura ? '⏳ Anulando...' : '🚫 Confirmar Anulacion'}
				</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ELIMINAR FACTURA -->
{#if eliminarFacturaModalOpen && eliminarFacturaTarget}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-bg" on:click|self={() => { eliminarFacturaModalOpen = false; eliminarFacturaTarget = null; }}>
	<div class="modal-box" style="max-width:440px">
		<div class="modal-hd">
			<h3>🗑 Eliminar Factura</h3>
			<button class="modal-close" on:click={() => { eliminarFacturaModalOpen = false; eliminarFacturaTarget = null; }}>✕</button>
		</div>
		<div class="modal-body">
			<div style="text-align:center;margin-bottom:16px">
				<div style="font-size:48px;margin-bottom:8px">⚠️</div>
				<p style="font-size:14px;color:#374151;font-weight:600;margin:0">
					¿Eliminar permanentemente la factura <span style="font-family:monospace">#{eliminarFacturaTarget.numero_factura}</span>?
				</p>
				<p style="font-size:12px;color:#dc2626;margin:8px 0 0;font-weight:500">
					Esta acción es irreversible. Se eliminarán la factura y todos sus ítems asociados.
				</p>
			</div>
			<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => { eliminarFacturaModalOpen = false; eliminarFacturaTarget = null; }}>Cancelar</button>
				<button class="btn-estado red" disabled={eliminandoFactura} on:click={confirmarEliminarFactura}>
					{eliminandoFactura ? '⏳ Eliminando...' : '🗑 Confirmar Eliminación'}
				</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL FACTURAR -->
<ModalFacturar
	bind:open={facturarModalOpen}
	liquidaciones={liquidaciones}
	preselectedIds={facturarPreselected}
	on:created={handleFacturaCreated}
	on:close={() => (facturarModalOpen = false)}
/>

<!-- MODAL: HISTORIAL DE MODIFICACIONES -->
{#if historialModalOpen}
<div class="modal-bg" on:click|self={() => (historialModalOpen = false)}>
	<div class="modal-box" style="max-width:720px">
		<div class="modal-hd">
			<h3>📜 Historial — Liquidación #{historialLiqConsecutivo}</h3>
			<button class="modal-close" on:click={() => (historialModalOpen = false)}>✕</button>
		</div>
		<div style="padding:20px 24px">
		{#if historialLoading}
			<div style="text-align:center;padding:40px 0;color:#888">Cargando historial...</div>
		{:else if historialData.length === 0}
			<div style="text-align:center;padding:40px 0;color:#888">No hay registros de historial.</div>
		{:else}
			<div class="historial-timeline">
				{#each historialData as entry, i}
					{@const info = getAccionLabel(entry.accion)}
					<div class="historial-entry">
						<div class="historial-dot" style="background:{info.color}">{info.icon}</div>
						<div class="historial-content">
							<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
								<span class="historial-label" style="background:{info.color}15;color:{info.color};border:1px solid {info.color}33">{info.label}</span>
								{#if entry.estado_anterior && entry.estado_nuevo && entry.estado_anterior !== entry.estado_nuevo}
									<span style="font-size:12px;color:#666">{entry.estado_anterior} → <strong>{entry.estado_nuevo}</strong></span>
								{:else if entry.estado_nuevo}
									<span style="font-size:12px;color:#666">Estado: <strong>{entry.estado_nuevo}</strong></span>
								{/if}
							</div>
							<div style="font-size:11.5px;color:#888;margin-top:4px">
								👤 {entry.usuario?.nombre || 'Sistema'} — {new Date(entry.created_at).toLocaleString('es-CO')}
							</div>
							{#if entry.motivo}
								<div style="font-size:12px;color:#b45309;margin-top:4px">💬 {entry.motivo}</div>
							{/if}
							{#if entry.snapshot}
								<button class="btn-snapshot-toggle" on:click={() => (historialExpandedId = historialExpandedId === entry.id ? null : entry.id)}>
									{historialExpandedId === entry.id ? '▼ Ocultar snapshot' : '▶ Ver snapshot'}
								</button>
								{#if historialExpandedId === entry.id}
									<div class="snapshot-box">
										<div class="snapshot-summary">
											<span>📄 Items: <strong>{entry.snapshot.items?.length ?? 0}</strong></span>
											<span>💰 Total: <strong>${(entry.snapshot.valor_total ?? 0).toLocaleString('es-CO')}</strong></span>
											{#if entry.snapshot.empresa}<span>🏢 {entry.snapshot.empresa}</span>{/if}
											{#if entry.snapshot.ruta}<span>🛣 {entry.snapshot.ruta}</span>{/if}
										</div>
										{#if entry.snapshot.items?.length}
											<div style="overflow-x:auto;margin-top:8px">
												<table class="snapshot-table">
													<thead>
														<tr>
															<th>Placa</th>
															<th>Recorrido</th>
															<th>Tipo</th>
															<th>Cant</th>
															<th>Valor</th>
														</tr>
													</thead>
													<tbody>
														{#each entry.snapshot.items as item}
															<tr>
																<td>{item.placa || '-'}</td>
																<td>{item.recorrido || item.nombre_recorrido || '-'}</td>
																<td>{item.tipo_servicio || '-'}</td>
																<td>{item.cantidad ?? '-'}</td>
																<td>${(item.valor_unitario ?? item.valor ?? 0).toLocaleString('es-CO')}</td>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
		</div>
	</div>
</div>
{/if}

<style>
	.page-wrap { padding: 24px 18px 48px; }
	.card { background: #fff; border-radius: 16px; border: 1px solid #dde3eb; padding: 22px 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
	.ch { font-size: 11px; font-weight: 800; color: #0f4025; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
	.ch::before { content: ''; width: 3px; height: 16px; background: linear-gradient(180deg, #1b6b3a, #5cb87a); border-radius: 2px; display: block; }
	label { display: block; font-size: 10.5px; font-weight: 700; color: #6b7e8c; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
	input, select { width: 100%; border: 1.5px solid #dde3eb; border-radius: 8px; padding: 8px 11px; font-size: 13px; color: #1a2530; background: #fafbfc; outline: none; transition: all .15s; }
	input:focus, select:focus { border-color: #1b6b3a; background: #fff; box-shadow: 0 0 0 3px rgba(27,107,58,.1); }
	.btn-filtrar { padding: 7px 20px; border: none; border-radius: 8px; background: #0f4025; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; transition: all .15s; width: auto; }
	.btn-filtrar:hover { background: #1b6b3a; }
	.loading-center { display: flex; justify-content: center; align-items: center; padding: 48px; }
	.spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #0f4025; border-radius: 50%; animation: spin .6s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
	.modal-box { background: #fff; border-radius: 18px; max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 60px rgba(0,0,0,.25); }
	.modal-hd { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
	.modal-hd h3 { font-size: 16px; font-weight: 800; color: #0f4025; margin: 0; }
	.modal-close { background: #f1f5f9; border: none; border-radius: 8px; width: 32px; height: 32px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .1s; }
	.modal-close:hover { background: #e2e8f0; }
	.modal-body { padding: 20px 24px; }
	.det-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 20px; }
	.det-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 3px; }
	.det-value { font-size: 14px; font-weight: 600; color: #1e293b; }
	.det-anulacion { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; }
	.det-anulacion-hd { font-size: 12px; font-weight: 700; color: #dc2626; margin-bottom: 6px; }
	.det-anulacion-body { font-size: 13px; color: #7f1d1d; line-height: 1.5; white-space: pre-wrap; }
	.det-tbl-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; margin-top: 16px; }
	.det-tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
	.det-tbl th { background: #f8fafc; color: #64748b; font-weight: 700; font-size: 10px; text-transform: uppercase; padding: 9px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
	.det-tbl td { padding: 8px 8px; border-bottom: 1px solid #f1f5f9; }
	.det-tbl .mc { text-align: right; font-family: monospace; }
	.det-totals { margin-top: 16px; background: #f8fdf9; border-radius: 10px; padding: 14px 18px; }
	.det-total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
	.det-total-row.main { font-size: 16px; font-weight: 800; color: #0f4025; padding-top: 8px; border-top: 2px solid #d4ecdb; margin-top: 6px; }
	.estado-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 16px; }
	.btn-estado { padding: 6px 16px; border: 1.5px solid; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; background: #fff; width: auto; }
	.btn-estado:hover { transform: translateY(-1px); }
	.btn-estado.green { border-color: #16a34a; color: #16a34a; }
	.btn-estado.green:hover { background: #f0fdf4; }
	.btn-estado.red { border-color: #dc2626; color: #dc2626; }
	.btn-estado.red:hover { background: #fef2f2; }
	.btn-estado.amber { border-color: #d97706; color: #d97706; }
	.btn-estado.amber:hover { background: #fffbeb; }
	.btn-estado:disabled { opacity: .5; cursor: not-allowed; transform: none; }

	/* Config grid */
	.cfg-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
	.cfg-field { display: flex; flex-direction: column; gap: 4px; }
	.cfg-hint { font-size: 10px; color: #94a3b8; margin-top: 1px; }
	@media (max-width: 900px) { .cfg-grid { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 500px) { .cfg-grid { grid-template-columns: 1fr; } }

	/* Historial */
	.historial-timeline { display: flex; flex-direction: column; gap: 0; }
	.historial-entry { display: flex; gap: 12px; position: relative; padding-bottom: 20px; }
	.historial-entry:not(:last-child)::before {
		content: ''; position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: #e2e8f0;
	}
	.historial-dot {
		width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
		font-size: 14px; flex-shrink: 0; color: #fff;
	}
	.historial-content { flex: 1; min-width: 0; }
	.historial-label {
		display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px;
	}
	.btn-snapshot-toggle {
		background: none; border: none; color: #2563eb; font-size: 11.5px; cursor: pointer;
		padding: 4px 0; margin-top: 4px; font-weight: 600;
	}
	.btn-snapshot-toggle:hover { text-decoration: underline; }
	.snapshot-box {
		background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-top: 6px;
	}
	.snapshot-summary { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #475569; }
	.snapshot-table { width: 100%; border-collapse: collapse; font-size: 11px; }
	.snapshot-table th { background: #e2e8f0; padding: 4px 8px; text-align: left; font-weight: 700; }
	.snapshot-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
</style>
