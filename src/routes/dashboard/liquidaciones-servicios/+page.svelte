<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import {
		liquidacionesServiciosAPI,
		getMesLabel,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type ConfigLiquidadorServicio,
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

	let facturasTab: 'liquidaciones' | 'facturas' | 'configuracion' = 'liquidaciones';
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
			if (listEstado) filtros.estado = listEstado;
			if (listMes) filtros.mes = listMes;
			if (listAnio) filtros.anio = listAnio;
			const res = await liquidacionesServiciosAPI.listar(filtros);
			liquidaciones = res.liquidaciones;
			listTotal = res.total;
			listTotalPages = res.totalPages;
			listPage = res.page;
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
</script>

<div class="page-wrap">

	<!-- TOP BAR -->
	<div class="topbar">
		<div class="topbar-l">
			<img src="/assets/logo.png" alt="Logo" class="t-logo"
				on:error={() => logoError = true}
				style={logoError ? 'display:none' : ''} />
			<div>
				<div class="t-title">Liquidacion de Servicios — OP-FR-07</div>
				<div class="t-sub">Gestion, creacion y vista previa de liquidaciones</div>
			</div>
		</div>
		{#if isFull}
		<button class="btn-hdr" on:click={irNuevaLiquidacion}>✏️ Nueva Liquidacion</button>
		{/if}
	</div>

	<!-- Sub-tabs: Liquidaciones / Facturas -->
	<div class="sub-tabs">
		<button class="sub-tab-btn" class:active={facturasTab === 'liquidaciones'} on:click={() => { facturasTab = 'liquidaciones'; }}>📋 Liquidaciones</button>
		<button class="sub-tab-btn" class:active={facturasTab === 'facturas'} on:click={() => { facturasTab = 'facturas'; cargarFacturas(); }}>🧾 Facturas</button>
		{#if isFull}
		<button class="sub-tab-btn" class:active={facturasTab === 'configuracion'} on:click={() => { facturasTab = 'configuracion'; cargarConfig(); }}>⚙️ Configuracion</button>
		{/if}
	</div>

	{#if facturasTab === 'liquidaciones'}
	<div class="card">
		<div class="ch" style="display:flex;align-items:center;justify-content:space-between">
			<span>📋 Liquidaciones Registradas</span>
			{#if isFull || isLimited}
				<button class="btn-facturar-hdr" on:click={abrirModalFacturar}>🧾 Facturar</button>
			{/if}
		</div>
		<div class="list-toolbar">
			<div class="field">
				<label for="list-busqueda">Buscar</label>
				<input id="list-busqueda" placeholder="Consecutivo, cliente..." bind:value={listBusqueda} />
			</div>
			<div class="field">
				<label for="list-estado">Estado</label>
				<select id="list-estado" bind:value={listEstado}>
					<option value="">Todos</option>
					<option value="BORRADOR">Borrador</option>
					<option value="LIQUIDADA">Liquidada</option>
					<option value="APROBADA">Aprobada</option>
					<option value="FACTURADA">Facturada</option>
					<option value="ANULADA">Anulada</option>
				</select>
			</div>
			<div class="field">
				<label for="list-mes">Mes</label>
				<select id="list-mes" bind:value={listMes}>
					<option value="">Todos</option>
					{#each MESES as m}<option value={m}>{m}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="list-anio">Ano</label>
				<select id="list-anio" bind:value={listAnio}>
					<option value="">Todos</option>
					{#each YEARS as y}<option value={y}>{y}</option>{/each}
				</select>
			</div>
			<button class="btn-filtrar" on:click={filtrar}>🔍 Filtrar</button>
		</div>

		{#if listLoading}
			<div class="loading-center"><div class="spinner"></div><span style="margin-left:12px;color:#64748b;font-size:13px;font-weight:500">Cargando liquidaciones…</span></div>
		{:else if listError}
			<div class="empty-state">
				<div class="icon">⚠️</div>
				<div class="msg">{listError}</div>
			</div>
		{:else if liquidaciones.length === 0}
			<div class="empty-state">
				<div class="icon">📭</div>
				<div class="msg">No hay liquidaciones</div>
				<div class="hint">Crea una nueva haciendo clic en "Nueva Liquidacion"</div>
			</div>
		{:else}
			<div class="ltbl-wrap">
				<table class="ltbl">
					<thead>
						<tr>
							<th>Consecutivo</th>
							<th>Cliente</th>
							<th>Periodo</th>
							<th>Estado</th>
							<th>Factura</th>
							<th style="text-align:center">3° Liq.</th>
							<th style="text-align:right">Total</th>
							<th style="text-align:center">Items</th>
							<th>Liquidador</th>
							<th>Fecha</th>
							<th style="text-align:center">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each liquidaciones as liq (liq.id)}
							{@const badge = getEstadoBadge(liq.estado)}
							{@const facturaInfo = facturaInfoMap[liq.id]}
							<tr class={highlightedIds[liq.id] === 'created' ? 'row-new' : highlightedIds[liq.id] === 'updated' ? 'row-updated' : ''}>
								<td class="consec">{liq.consecutivo}</td>
								<td>{liq.cliente?.nombre || '—'}</td>
								<td>{getMesLabel(liq.mes)} {liq.anio}</td>
								<td>
									<span class="badge" style="background:{badge.bg};color:{badge.text}">{liq.estado}</span>
								</td>
								<td>
									{#if facturaInfo}
										<span class="badge-factura" title="Factura #{facturaInfo.numero_factura}">🧾 {facturaInfo.numero_factura}</span>
									{:else}
										<span style="color:#aaa">—</span>
									{/if}
								</td>
								<td style="text-align:center">
									{#if liq.tercero_liquidado}
										<span class="badge" style="background:#d4edda;color:#155724;font-size:11px" title="Tercero liquidado">✅ Si</span>
									{:else}
										<span class="badge" style="background:#f8d7da;color:#721c24;font-size:11px" title="Tercero sin liquidar">❌ No</span>
									{/if}
								</td>
								<td class="monto-total">{COP(liq.total || 0)}</td>
								<td style="text-align:center">{liq.total_items || 0}</td>
								<td style="white-space:nowrap;font-size:11px">{liq.liquidado_por?.nombre || liq.creado_por?.nombre || '—'}</td>
								<td style="white-space:nowrap;font-size:11px">{liq.created_at ? new Date(liq.created_at).toLocaleDateString('es-CO', { weekday:'short', day:'numeric', month:'short' }) + ' ' + new Date(liq.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—'}</td>
								<td style="text-align:center;white-space:nowrap">
									<button class="btn-icon" title="Ver" on:click={() => irVerLiquidacion(liq.id)}>👁</button>
									{#if isFull && liq.estado === 'BORRADOR'}
										<button class="btn-icon" title="Editar" on:click={() => irEditarLiquidacion(liq.id)}>✏️</button>
									{/if}
									{#if canLiquidar && liq.estado === 'BORRADOR'}
										<button class="btn-estado liq" title="Liquidar" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>✅ Liquidar</button>
									{/if}
									{#if canAprobar && liq.estado === 'LIQUIDADA'}
										<button class="btn-estado liq" title="Aprobar" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'APROBADA')}>✅ Aprobar</button>
									{/if}
									{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
										<button class="btn-estado anl" title="Anular" disabled={estadoChanging} on:click={() => abrirAnularModal(liq.id)}>🚫 Anular</button>
									{/if}
									{#if isAdmin && liq.estado === 'ANULADA'}
										<button class="btn-estado rev" title="Revertir a Borrador" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ Revertir</button>
									{/if}
									{#if canRevertirABorrador && liq.estado === 'LIQUIDADA'}
										<button class="btn-estado rev" title="Revertir a Borrador" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'BORRADOR')}>↩️ A Borrador</button>
									{/if}
									{#if canRevertirALiquidada && liq.estado === 'APROBADA'}
										<button class="btn-estado rev" title="Revertir a Liquidada" disabled={estadoChanging} on:click={() => cambiarEstadoLiq(liq.id, 'LIQUIDADA')}>↩️ A Liquidada</button>
									{/if}
									{#if isFull && liq.estado === 'BORRADOR'}
										<button class="btn-icon del" title="Eliminar" on:click={() => { deleteTargetLiq = liq; deleteModalOpen = true; }}>🗑</button>
									{/if}
									{#if isAdmin}
										<button class="btn-icon" title="Historial" on:click={() => abrirHistorial(liq.id, liq.consecutivo)}>📜</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if listTotalPages > 1}
				<div class="pagination">
					<button disabled={listPage <= 1} on:click={() => irPagina(listPage - 1)}>← Ant</button>
					{#each Array(listTotalPages) as _, i}
						<button class:active={listPage === i + 1} on:click={() => irPagina(i + 1)}>{i + 1}</button>
					{/each}
					<button disabled={listPage >= listTotalPages} on:click={() => irPagina(listPage + 1)}>Sig →</button>
				</div>
			{/if}
		{/if}
	</div>

	{:else if facturasTab === 'facturas'}
	<!-- FACTURAS SUB-TAB -->
	<div class="card">
		<div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
			<span>📋 Facturas de Liquidaciones</span>
		</div>

		<div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">
			<div style="flex:1;min-width:180px">
				<label for="facturas-busqueda">Buscar</label>
				<input id="facturas-busqueda" placeholder="No factura, cliente..." bind:value={facturasBusqueda} on:input={filtrarFacturas} />
			</div>
			<div style="min-width:130px">
				<label for="facturas-estado">Estado</label>
				<select id="facturas-estado" bind:value={facturasEstado} on:change={filtrarFacturas}>
					<option value="">Todos</option>
					<option value="ACTIVA">ACTIVA</option>
					<option value="ANULADA">ANULADA</option>
				</select>
			</div>
		</div>

		{#if facturasLoading}
			<div class="loading-center"><div class="spinner"></div></div>
		{:else if facturas.length === 0}
			<div class="empty-msg">No se encontraron facturas</div>
		{:else}
			<div class="ltbl-wrap">
				<table class="ltbl">
					<thead>
						<tr>
							<th>No Factura</th>
							<th>Fecha</th>
							<th style="text-align:center">Liquidaciones</th>
							<th style="text-align:right">Total</th>
							<th>Estado</th>
							<th>Facturado por</th>
							<th>Observaciones</th>
							<th style="text-align:center">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each facturas as fac (fac.id)}
							<tr>
								<td style="font-family:monospace;font-weight:700">{fac.numero_factura}</td>
								<td style="white-space:nowrap;font-size:11px">{fac.fecha_facturacion ? new Date(fac.fecha_facturacion).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) : '—'}</td>
								<td style="text-align:center">{fac.items?.length || 0}</td>
								<td class="monto-total">{COP(fac.valor_total || 0)}</td>
								<td>
									{#if fac.estado === 'ACTIVA'}
										<span class="badge" style="background:#d4edda;color:#155724">ACTIVA</span>
									{:else}
										<span class="badge" style="background:#f8d7da;color:#721c24">ANULADA</span>
									{/if}
								</td>
								<td style="font-size:11px">{fac.facturado_por?.nombre || '—'}</td>
								<td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={fac.observaciones || ''}>{fac.observaciones || '—'}</td>
								<td style="text-align:center;white-space:nowrap">
									<button class="btn-icon" title="Ver detalle" on:click={() => verDetalleFactura(fac.id)}>👁</button>
									{#if fac.estado === 'ACTIVA'}
										<button class="btn-estado anl" title="Anular factura" on:click={() => abrirAnularFactura(fac)}>🚫 Anular</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if facturasTotalPages > 1}
				<div class="pagination">
					<button disabled={facturasPage <= 1} on:click={() => irPaginaFacturas(facturasPage - 1)}>← Ant</button>
					{#each Array(facturasTotalPages) as _, i}
						<button class:active={facturasPage === i + 1} on:click={() => irPaginaFacturas(i + 1)}>{i + 1}</button>
					{/each}
					<button disabled={facturasPage >= facturasTotalPages} on:click={() => irPaginaFacturas(facturasPage + 1)}>Sig →</button>
				</div>
			{/if}
		{/if}
	</div>

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
				{#if detailLiq && detailLiq.estado === 'BORRADOR'}
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
	.topbar {
		background: linear-gradient(135deg, #0f4025 0%, #1b6b3a 60%, #247a45 100%);
		border-radius: 18px; padding: 16px 26px; margin-bottom: 20px;
		display: flex; align-items: center; justify-content: space-between;
		box-shadow: 0 10px 40px rgba(15,64,37,.35);
	}
	.topbar-l { display: flex; align-items: center; gap: 14px; }
	.t-logo { height: 48px; width: 48px; object-fit: contain; background: #fff; border-radius: 12px; padding: 5px; flex-shrink: 0; }
	.t-title { color: #fff; font-size: 18px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
	.t-sub { color: rgba(255,255,255,.65); font-size: 11.5px; margin-top: 2px; }
	.btn-hdr {
		background: #fff; color: #0f4025; border: none; border-radius: 10px;
		padding: 10px 22px; font-weight: 800; font-size: 13px; cursor: pointer;
		box-shadow: 0 2px 16px rgba(0,0,0,.2); transition: all .15s;
	}
	.btn-hdr:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(0,0,0,.25); }
	.card { background: #fff; border-radius: 16px; border: 1px solid #dde3eb; padding: 22px 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
	.ch { font-size: 11px; font-weight: 800; color: #0f4025; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
	.ch::before { content: ''; width: 3px; height: 16px; background: linear-gradient(180deg, #1b6b3a, #5cb87a); border-radius: 2px; display: block; }
	label { display: block; font-size: 10.5px; font-weight: 700; color: #6b7e8c; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
	input, select { width: 100%; border: 1.5px solid #dde3eb; border-radius: 8px; padding: 8px 11px; font-size: 13px; color: #1a2530; background: #fafbfc; outline: none; transition: all .15s; }
	input:focus, select:focus { border-color: #1b6b3a; background: #fff; box-shadow: 0 0 0 3px rgba(27,107,58,.1); }
	.list-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
	.list-toolbar .field { display: flex; flex-direction: column; gap: 3px; }
	.list-toolbar input, .list-toolbar select { padding: 7px 11px; font-size: 12px; min-width: 140px; }
	.btn-filtrar { padding: 7px 20px; border: none; border-radius: 8px; background: #0f4025; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; transition: all .15s; width: auto; }
	.btn-filtrar:hover { background: #1b6b3a; }
	.ltbl-wrap { overflow-x: auto; border: 1px solid #dde3eb; border-radius: 12px; }
	.ltbl { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 900px; }
	.ltbl th { background: linear-gradient(135deg, #e2f0e8, #d4ecdb); color: #0f4025; font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; padding: 11px 10px; border-bottom: 2px solid #b8dfc6; white-space: nowrap; text-align: left; }
	.ltbl td { padding: 10px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
	.ltbl tbody tr:hover td { background: #f7fdf9; }
	.ltbl tbody tr.row-new td { animation: highlightNew 8s ease-out forwards; }
	.ltbl tbody tr.row-updated td { animation: highlightUpdated 8s ease-out forwards; }
	.ltbl tbody tr.row-new { box-shadow: inset 3px 0 0 #22c55e; }
	.ltbl tbody tr.row-updated { box-shadow: inset 3px 0 0 #a7c4b5; }
	@keyframes highlightNew { 0% { background: #dcfce7; } 60% { background: #dcfce7; } 100% { background: transparent; } }
	@keyframes highlightUpdated { 0% { background: #f0f7f4; } 60% { background: #f0f7f4; } 100% { background: transparent; } }
	.ltbl .consec { font-family: monospace; font-weight: 800; color: #0f4025; font-size: 12px; }
	.ltbl .monto-total { font-family: monospace; font-weight: 800; color: #0f4025; font-size: 13px; text-align: right; white-space: nowrap; }
	.badge { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
	.btn-icon { background: none; border: none; cursor: pointer; padding: 5px 7px; border-radius: 6px; font-size: 14px; transition: all .1s; width: auto; }
	.btn-icon:hover { background: #f1f5f9; }
	.btn-icon.del:hover { background: #fee2e2; }
	.pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin-top: 16px; }
	.pagination button { padding: 6px 14px; border: 1px solid #dde3eb; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .1s; width: auto; }
	.pagination button.active { background: #0f4025; color: #fff; border-color: #0f4025; }
	.pagination button:hover:not(.active) { background: #f1f5f9; }
	.pagination button:disabled { opacity: .4; cursor: not-allowed; }
	.empty-state { text-align: center; padding: 48px 20px; color: #94a3b8; }
	.empty-state .icon { font-size: 48px; margin-bottom: 12px; }
	.empty-state .msg { font-size: 14px; font-weight: 600; color: #64748b; }
	.empty-state .hint { font-size: 12px; margin-top: 6px; }
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
	.btn-estado.liq { border-color: #16a34a; color: #16a34a; font-size: 10px; padding: 3px 8px; }
	.btn-estado.liq:hover { background: #f0fdf4; }
	.btn-estado.anl { border-color: #dc2626; color: #dc2626; font-size: 10px; padding: 3px 8px; }
	.btn-estado.anl:hover { background: #fef2f2; }
	.btn-estado.rev { border-color: #d97706; color: #d97706; font-size: 10px; padding: 3px 8px; }
	.btn-estado.rev:hover { background: #fffbeb; }
	.btn-estado:disabled { opacity: .5; cursor: not-allowed; transform: none; }
	.sub-tabs { display: flex; gap: 3px; background: #f1f5f9; border-radius: 8px; padding: 3px; width: fit-content; margin-bottom: 16px; }
	.sub-tab-btn { padding: 6px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700; transition: all .15s; background: transparent; color: #64748b; }
	.sub-tab-btn.active { background: #fff; color: #0f4025; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
	.sub-tab-btn:not(.active):hover { background: rgba(255,255,255,.5); color: #334155; }
	.btn-facturar-hdr {
		background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff;
		border: none; border-radius: 8px; padding: 7px 16px;
		font-size: 12px; font-weight: 700; cursor: pointer;
		box-shadow: 0 2px 8px rgba(124,58,237,.3); transition: all .15s;
	}
	.btn-facturar-hdr:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(124,58,237,.4); }
	.badge-factura {
		display: inline-flex; align-items: center; gap: 3px;
		background: #ede9fe; color: #5b21b6;
		padding: 2px 8px; border-radius: 6px;
		font-size: 11px; font-weight: 700; font-family: monospace; white-space: nowrap;
	}
	.empty-msg { text-align: center; color: #94a3b8; font-size: 13px; padding: 32px 0; font-weight: 600; }

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
