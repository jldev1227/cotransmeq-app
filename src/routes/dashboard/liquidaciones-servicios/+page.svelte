<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import {
		liquidacionesServiciosAPI,
		getMesLabel,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type ConfigLiquidadorServicio,
	} from '$lib/api/liquidaciones-servicios';
	import { facturacionLiquidacionesAPI, type FacturaInfoMap, type FacturaLiquidacion } from '$lib/api/facturacionLiquidaciones';
	import ModalFacturar from '$lib/components/ModalFacturar.svelte';

	const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
	const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(String(v)) || 0);

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

	let logoError = false;

	let facturarModalOpen = false;
	let facturarPreselected: string[] = [];
	let facturaInfoMap: FacturaInfoMap = {};

	let activeTab: 'liquidaciones' | 'facturas' | 'configuracion' = 'liquidaciones';
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

	let configLoading = false;
	let configSaving = false;
	let configData: ConfigLiquidadorServicio | null = null;
	let configForm = {
		salario_basico: 2358886,
		cargo: 'Conductor',
		valor_hora_override: 0,
		conductor_adicional: 73693,
		pct_seg_social: 22.96,
		pct_prestaciones: 21.83,
		pct_admin: 8,
		prueba_covid: 0,
	};

	$: configValorHoraAuto = configForm.salario_basico > 0 ? configForm.salario_basico / 220 : 0;

	$: isAdmin = $authStore.user?.rol === 'admin';
	$: canLiquidar = isAdmin;
	$: canAprobar = isAdmin;
	$: canAnular = isAdmin;

	onMount(async () => { await cargarListado(); });

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
		finally { listLoading = false; cargarFacturaInfo(); }
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
		detailModal = true; detailLoading = true; detailLiq = null;
		try { detailLiq = await liquidacionesServiciosAPI.obtenerPorId(id); }
		catch (err: any) { alert(err.message || 'Error al cargar liquidacion'); detailModal = false; }
		finally { detailLoading = false; }
	}
	function cerrarDetalle() { detailModal = false; detailLiq = null; }

	async function eliminarLiq(id: string) {
		deleting = true;
		try { await liquidacionesServiciosAPI.eliminar(id); deleteModalOpen = false; deleteTargetLiq = null; cargarListado(); }
		catch (err: any) { alert(err.message || 'Error'); }
		finally { deleting = false; }
	}

	async function cambiarEstado(id: string, estado: EstadoLiquidacionServicio, motivo?: string) {
		estadoChanging = true;
		try {
			await liquidacionesServiciosAPI.cambiarEstado(id, estado, motivo);
			if (detailLiq?.id === id) detailLiq = { ...detailLiq, estado };
			cargarListado();
		} catch (err: any) { alert(err.message || 'Error'); }
		finally { estadoChanging = false; }
	}

	function abrirAnularModal(id: string) { anularTargetId = id; anularMotivo = ''; anularModalOpen = true; }

	async function confirmarAnulacion() {
		if (!anularMotivo.trim()) { alert('Debes indicar el motivo de la anulación'); return; }
		await cambiarEstado(anularTargetId, 'ANULADA', anularMotivo.trim());
		anularModalOpen = false; anularTargetId = ''; anularMotivo = '';
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

	async function cargarConfig() {
		configLoading = true;
		try {
			const data = await liquidacionesServiciosAPI.obtenerConfigLiquidador();
			configData = data;
			configForm = {
				salario_basico: data.salario_basico,
				cargo: data.cargo,
				valor_hora_override: data.valor_hora_override,
				conductor_adicional: data.conductor_adicional,
				pct_seg_social: data.pct_seg_social,
				pct_prestaciones: data.pct_prestaciones,
				pct_admin: data.pct_admin,
				prueba_covid: data.prueba_covid,
			};
		} catch (err: any) { alert(err.message || 'Error al cargar configuración'); }
		finally { configLoading = false; }
	}

	async function guardarConfig() {
		configSaving = true;
		try {
			const data = await liquidacionesServiciosAPI.actualizarConfigLiquidador(configForm);
			configData = data;
			alert('✅ Configuración guardada exitosamente');
		} catch (err: any) { alert(err.message || 'Error al guardar configuración'); }
		finally { configSaving = false; }
	}

	function getEstadoBadge(estado: EstadoLiquidacionServicio) {
		const map: Record<string, { bg: string; text: string; label: string }> = {
			BORRADOR:  { bg: '#f1f5f9', text: '#64748b', label: 'Borrador' },
			LIQUIDADA: { bg: '#dbeafe', text: '#2563eb', label: 'Liquidada' },
			APROBADA:  { bg: '#fff7ed', text: '#ea580c', label: 'Aprobada' },
			FACTURADA: { bg: '#d1fae5', text: '#059669', label: 'Facturada' },
			ANULADA:   { bg: '#fee2e2', text: '#dc2626', label: 'Anulada' },
		};
		return map[estado] || map.BORRADOR;
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
				<div class="t-title">Liquidación de Servicios — OP-FR-07</div>
				<div class="t-sub">Gestión, creación y vista previa de liquidaciones</div>
			</div>
		</div>
		<button class="btn-hdr" on:click={irNuevaLiquidacion}>✏️ Nueva Liquidación</button>
	</div>

	<!-- Sub-tabs: Liquidaciones / Facturas / Configuración -->
	<div class="sub-tabs">
		<button class="sub-tab-btn" class:active={activeTab === 'liquidaciones'} on:click={() => { activeTab = 'liquidaciones'; }}>📋 Liquidaciones</button>
		<button class="sub-tab-btn" class:active={activeTab === 'facturas'} on:click={() => { activeTab = 'facturas'; cargarFacturas(); }}>🧾 Facturas</button>
		<button class="sub-tab-btn" class:active={activeTab === 'configuracion'} on:click={() => { activeTab = 'configuracion'; cargarConfig(); }}>⚙️ Configuración</button>
	</div>

	{#if activeTab === 'liquidaciones'}
	<div class="card">
		<div class="ch" style="display:flex;align-items:center;justify-content:space-between">
			<span>📋 Liquidaciones Registradas</span>
			{#if isAdmin || canLiquidar}
				<button class="btn-facturar-hdr" on:click={abrirModalFacturar}>🧾 Facturar</button>
			{/if}
		</div>

		<div class="list-toolbar">
			<div class="field">
				<label>Buscar</label>
				<input placeholder="Consecutivo, cliente..." bind:value={listBusqueda} />
			</div>
			<div class="field">
				<label>Estado</label>
				<select bind:value={listEstado}>
					<option value="">Todos</option>
					<option value="BORRADOR">Borrador</option>
					<option value="LIQUIDADA">Liquidada</option>
					<option value="APROBADA">Aprobada</option>
					<option value="FACTURADA">Facturada</option>
					<option value="ANULADA">Anulada</option>
				</select>
			</div>
			<div class="field">
				<label>Mes</label>
				<select bind:value={listMes}>
					<option value="">Todos</option>
					{#each MESES as m, i}<option value={i + 1}>{m}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label>Año</label>
				<select bind:value={listAnio}>
					<option value="">Todos</option>
					{#each YEARS as y}<option value={y}>{y}</option>{/each}
				</select>
			</div>
			<button class="btn-filtrar" on:click={filtrar}>🔍 Filtrar</button>
		</div>

		{#if listLoading}
			<div class="loading-center"><div class="spinner"></div><span style="margin-left:12px;color:#64748b;font-size:13px;font-weight:500">Cargando liquidaciones…</span></div>
		{:else if listError}
			<div class="empty-state"><div class="icon">⚠️</div><div class="msg">{listError}</div></div>
		{:else if liquidaciones.length === 0}
			<div class="empty-state"><div class="icon">📭</div><div class="msg">No hay liquidaciones</div><div class="hint">Crea una nueva haciendo clic en "Nueva Liquidación"</div></div>
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
							<tr>
								<td class="consec">{liq.consecutivo}</td>
								<td>{liq.cliente?.nombre || '—'}</td>
								<td>{getMesLabel(liq.mes)} {liq.anio}</td>
								<td><span class="badge" style="background:{badge.bg};color:{badge.text}">{liq.estado}</span></td>
								<td>
									{#if facturaInfo}
										<span class="badge-factura" title="Factura #{facturaInfo.numero_factura}">🧾 {facturaInfo.numero_factura}</span>
									{:else}
										<span style="color:#aaa">—</span>
									{/if}
								</td>
								<td style="text-align:center">
									{#if liq.tercero_liquidado}
										<span class="badge" style="background:#fff7ed;color:#9a3412;font-size:11px" title="Tercero liquidado">✅ Si</span>
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
									{#if liq.estado === 'BORRADOR'}
										<button class="btn-icon" title="Editar" on:click={() => irEditarLiquidacion(liq.id)}>✏️</button>
									{/if}
									{#if canLiquidar && liq.estado === 'BORRADOR'}
										<button class="btn-estado liq" title="Liquidar" disabled={estadoChanging} on:click={() => cambiarEstado(liq.id, 'LIQUIDADA')}>✅ Liquidar</button>
									{/if}
									{#if canAprobar && liq.estado === 'LIQUIDADA'}
										<button class="btn-estado liq" title="Aprobar" disabled={estadoChanging} on:click={() => cambiarEstado(liq.id, 'APROBADA')}>✅ Aprobar</button>
									{/if}
									{#if canAnular && liq.estado !== 'ANULADA' && liq.estado !== 'FACTURADA'}
										<button class="btn-estado anl" title="Anular" disabled={estadoChanging} on:click={() => abrirAnularModal(liq.id)}>🚫 Anular</button>
									{/if}
									{#if isAdmin && liq.estado === 'ANULADA'}
										<button class="btn-estado rev" title="Revertir a Borrador" disabled={estadoChanging} on:click={() => cambiarEstado(liq.id, 'BORRADOR')}>↩️ Revertir</button>
									{/if}
									{#if isAdmin && liq.estado === 'LIQUIDADA'}
										<button class="btn-estado rev" title="A Borrador" disabled={estadoChanging} on:click={() => cambiarEstado(liq.id, 'BORRADOR')}>↩️ A Borrador</button>
									{/if}
									{#if isAdmin && liq.estado === 'APROBADA'}
										<button class="btn-estado rev" title="A Liquidada" disabled={estadoChanging} on:click={() => cambiarEstado(liq.id, 'LIQUIDADA')}>↩️ A Liquidada</button>
									{/if}
									{#if liq.estado === 'BORRADOR'}
										<button class="btn-icon del" title="Eliminar" on:click={() => { deleteTargetLiq = liq; deleteModalOpen = true; }}>🗑</button>
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

	{:else if activeTab === 'facturas'}
	<!-- FACTURAS SUB-TAB -->
	<div class="card">
		<div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
			<span>🧾 Facturas de Liquidaciones</span>
		</div>

		<div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">
			<div style="flex:1;min-width:180px">
				<label>Buscar</label>
				<input placeholder="No factura, cliente..." bind:value={facturasBusqueda} on:input={filtrarFacturas} />
			</div>
			<div style="min-width:130px">
				<label>Estado</label>
				<select bind:value={facturasEstado} on:change={filtrarFacturas}>
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
										<span class="badge" style="background:#d1fae5;color:#059669">ACTIVA</span>
									{:else}
										<span class="badge" style="background:#fee2e2;color:#dc2626">ANULADA</span>
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

	{:else if activeTab === 'configuracion'}
	<div class="card">
		<div class="ch"><span>⚙️ Configuración Liquidador de Servicios</span></div>
		{#if configLoading}
			<div class="loading-center"><div class="spinner"></div><span style="margin-left:12px;color:#64748b;font-size:13px;font-weight:500">Cargando configuración…</span></div>
		{:else}
			<p style="font-size:12px;color:#64748b;margin:0 0 18px">Estos valores se usarán como predeterminados al crear nuevas liquidaciones (Hoja 3 — Liquidador de Recargos). Pueden ser editados por liquidación.</p>
			<div class="cfg-grid">
				<div class="cfg-field">
					<label>Salario Básico ($)</label>
					<input type="number" bind:value={configForm.salario_basico} step="1" />
				</div>
				<div class="cfg-field">
					<label>Cargo</label>
					<input type="text" bind:value={configForm.cargo} />
				</div>
				<div class="cfg-field">
					<label>Valor Hora (override)</label>
					<input type="number" bind:value={configForm.valor_hora_override} step="0.01" />
					<span class="cfg-hint">0 = automático: ${configValorHoraAuto.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr</span>
				</div>
				<div class="cfg-field">
					<label>Conductor Adicional ($)</label>
					<input type="number" bind:value={configForm.conductor_adicional} step="1" />
				</div>
				<div class="cfg-field">
					<label>% Seguridad Social</label>
					<input type="number" bind:value={configForm.pct_seg_social} step="0.01" />
				</div>
				<div class="cfg-field">
					<label>% Prestaciones Sociales</label>
					<input type="number" bind:value={configForm.pct_prestaciones} step="0.01" />
				</div>
				<div class="cfg-field">
					<label>% Administración</label>
					<input type="number" bind:value={configForm.pct_admin} step="0.01" />
				</div>
				<div class="cfg-field">
					<label>Prueba COVID ($)</label>
					<input type="number" bind:value={configForm.prueba_covid} step="1" />
				</div>
			</div>
			<div style="display:flex;justify-content:flex-end;margin-top:20px">
				<button class="btn-filtrar" disabled={configSaving} on:click={guardarConfig}>
					{configSaving ? '⏳ Guardando...' : '💾 Guardar Configuración'}
				</button>
			</div>
		{/if}
	</div>
	{/if}
</div>

<!-- DETAIL MODAL -->
{#if detailModal}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-bg" on:click|self={cerrarDetalle}>
	<div class="modal-box">
		<div class="modal-hd">
			<h3>📄 {detailLiq?.consecutivo || 'Detalle'}</h3>
			<div style="display:flex;gap:8px;align-items:center">
				{#if detailLiq && detailLiq.estado === 'BORRADOR'}
					<button class="btn-estado" style="border-color:#ea580c;color:#ea580c;font-size:11px;padding:5px 12px" on:click={() => { cerrarDetalle(); if (detailLiq) irEditarLiquidacion(detailLiq.id); }}>✏️ Editar</button>
				{/if}
				{#if detailLiq}
					<button class="btn-estado" style="border-color:#9a3412;color:#9a3412;font-size:11px;padding:5px 12px" on:click={() => { cerrarDetalle(); if (detailLiq) irVerLiquidacion(detailLiq.id); }}>👁 Ver</button>
				{/if}
				<button class="modal-close" on:click={cerrarDetalle}>✕</button>
			</div>
		</div>
		<div class="modal-body">
			{#if detailLoading}
				<div class="loading-center"><div class="spinner"></div></div>
			{:else if detailLiq}
				<div class="det-grid">
					<div><div class="det-label">Consecutivo</div><div class="det-value" style="font-family:monospace;color:#9a3412">{detailLiq.consecutivo}</div></div>
					<div><div class="det-label">Cliente</div><div class="det-value">{detailLiq.cliente?.nombre || '—'}</div></div>
					<div><div class="det-label">NIT</div><div class="det-value">{detailLiq.cliente?.nit || '—'}</div></div>
					<div><div class="det-label">Periodo</div><div class="det-value">{getMesLabel(detailLiq.mes)} {detailLiq.anio}</div></div>
					<div><div class="det-label">Estado</div><div class="det-value"><span class="badge" style="background:{getEstadoBadge(detailLiq.estado).bg};color:{getEstadoBadge(detailLiq.estado).text}">{detailLiq.estado}</span></div></div>
					<div><div class="det-label">Fecha de Creación</div><div class="det-value">{detailLiq.created_at ? new Date(detailLiq.created_at).toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' }) : '—'}</div></div>
				</div>

				{#if detailLiq.estado === 'ANULADA' && detailLiq.motivo_anulacion}
					<div class="det-anulacion"><div class="det-anulacion-hd">🚫 Motivo de Anulación</div><div class="det-anulacion-body">{detailLiq.motivo_anulacion}</div></div>
				{/if}

				{#if detailLiq.items && detailLiq.items.length > 0}
					<div class="det-tbl-wrap">
						<table class="det-tbl">
							<thead><tr><th>Placa</th><th>F. Inicial</th><th>F. Final</th><th>Recorrido</th><th>Tipo</th><th style="text-align:center">Cant.</th><th style="text-align:right">Vr. Unit.</th><th style="text-align:right">Subtotal</th><th style="text-align:center">Dcto</th><th style="text-align:right">Vr. Final</th></tr></thead>
							<tbody>
								{#each detailLiq.items as it}
									<tr>
										<td style="font-family:monospace;font-weight:700;color:#9a3412">{it.placa}</td>
										<td>{it.fecha_inicial ? new Date(it.fecha_inicial).toLocaleDateString('es-CO') : '—'}</td>
										<td>{it.fecha_final ? new Date(it.fecha_final).toLocaleDateString('es-CO') : '—'}</td>
										<td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis">{it.recorrido || ''}</td>
										<td style="font-size:11px">{it.tipo_servicio}</td>
										<td style="text-align:center;font-weight:700">{it.cantidad}</td>
										<td class="mc">{COP(it.valor_unitario)}</td>
										<td class="mc">{COP(it.subtotal || it.cantidad * it.valor_unitario)}</td>
										<td style="text-align:center">{it.porcentaje_descuento || 0}%</td>
										<td class="mc" style="font-weight:700;color:#9a3412">{COP(it.valor_final || it.subtotal || it.cantidad * it.valor_unitario)}</td>
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
				</div>
			{/if}
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ELIMINAR -->
{#if deleteModalOpen && deleteTargetLiq}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-bg" on:click|self={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>
	<div class="modal-box" style="max-width:440px">
		<div class="modal-hd"><h3>🗑 Eliminar Liquidación</h3><button class="modal-close" on:click={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>✕</button></div>
		<div class="modal-body">
			<div style="text-align:center;margin-bottom:16px"><div style="font-size:48px;margin-bottom:8px">⚠️</div><p style="font-size:14px;color:#374151;font-weight:600;margin:0">¿Estás seguro de eliminar esta liquidación?</p></div>
			<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:16px">
				<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748b">Consecutivo</span><span style="font-size:12px;font-weight:700;color:#0f172a;font-family:monospace">{deleteTargetLiq.consecutivo}</span></div>
				<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748b">Cliente</span><span style="font-size:12px;font-weight:600;color:#0f172a">{deleteTargetLiq.cliente?.nombre || '—'}</span></div>
				<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:#64748b">Total</span><span style="font-size:12px;font-weight:700;color:#0f172a">{COP(deleteTargetLiq.total || 0)}</span></div>
			</div>
			<p style="font-size:12px;color:#dc2626;margin:0 0 16px;text-align:center">Esta acción es irreversible.</p>
			<div style="display:flex;gap:10px;justify-content:flex-end">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => { deleteModalOpen = false; deleteTargetLiq = null; }}>Cancelar</button>
				<button class="btn-estado red" disabled={deleting} on:click={() => deleteTargetLiq && eliminarLiq(deleteTargetLiq.id)}>{deleting ? '⏳ Eliminando...' : '🗑 Eliminar'}</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: ANULAR -->
{#if anularModalOpen}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-bg" on:click|self={() => (anularModalOpen = false)}>
	<div class="modal-box" style="max-width:480px">
		<div class="modal-hd"><h3>🚫 Anular Liquidación</h3><button class="modal-close" on:click={() => (anularModalOpen = false)}>✕</button></div>
		<div class="modal-body">
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">Esta acción cambiará el estado a <strong style="color:#dc2626">ANULADA</strong>.</p>
			<label style="font-weight:600;font-size:12px;color:#374151;display:block;margin-bottom:4px">Motivo de anulación <span style="color:#dc2626">*</span></label>
			<textarea bind:value={anularMotivo} rows="4" placeholder="Ej: Error en valores, datos incorrectos..." style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
			<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => (anularModalOpen = false)}>Cancelar</button>
				<button class="btn-estado red" disabled={!anularMotivo.trim() || estadoChanging} on:click={confirmarAnulacion}>{estadoChanging ? '⏳ Anulando...' : '🚫 Confirmar'}</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- MODAL: DETALLE FACTURA -->
{#if detalleFactura}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
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
							<span class="badge" style="background:#d1fae5;color:#059669">ACTIVA</span>
						{:else}
							<span class="badge" style="background:#fee2e2;color:#dc2626">ANULADA</span>
						{/if}
					</div>
				</div>
				<div>
					<span style="font-size:11px;color:#64748b">Total</span>
					<div style="font-weight:700;color:#9a3412">{COP(detalleFactura.valor_total || 0)}</div>
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
						<span style="font-size:11px;color:#64748b">Motivo de anulación</span>
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
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
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
					Las liquidaciones asociadas volverán a estado LIQUIDADA.
				</p>
			</div>
			<label style="font-weight:600;font-size:12px;color:#374151;display:block;margin-bottom:4px">Motivo de anulación <span style="color:#dc2626">*</span></label>
			<textarea bind:value={anularFacturaMotivo} rows="3"
				placeholder="Ej: Error en número de factura, liquidaciones incorrectas..."
				style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
			<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
				<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => { anularFacturaModalOpen = false; anularFacturaTarget = null; }}>Cancelar</button>
				<button class="btn-estado red" disabled={!anularFacturaMotivo.trim() || anulandoFactura} on:click={confirmarAnularFactura}>
					{anulandoFactura ? '⏳ Anulando...' : '🚫 Confirmar Anulación'}
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

<style>
	.page-wrap { padding: 24px 18px 48px; }
	.topbar {
		background: linear-gradient(135deg, #9a3412 0%, #c2410c 60%, #ea580c 100%);
		border-radius: 18px; padding: 16px 26px; margin-bottom: 20px;
		display: flex; align-items: center; justify-content: space-between;
		box-shadow: 0 10px 40px rgba(154,52,18,.35);
	}
	.topbar-l { display: flex; align-items: center; gap: 14px; }
	.t-logo { height: 48px; width: 48px; object-fit: contain; background: #fff; border-radius: 12px; padding: 5px; flex-shrink: 0; }
	.t-title { color: #fff; font-size: 18px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
	.t-sub { color: rgba(255,255,255,.65); font-size: 11.5px; margin-top: 2px; }
	.btn-hdr {
		background: #fff; color: #9a3412; border: none; border-radius: 10px;
		padding: 10px 22px; font-weight: 800; font-size: 13px; cursor: pointer;
		box-shadow: 0 2px 16px rgba(0,0,0,.2); transition: all .15s;
	}
	.btn-hdr:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(0,0,0,.25); }
	.card { background: #fff; border-radius: 16px; border: 1px solid #dde3eb; padding: 22px 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
	.ch { font-size: 11px; font-weight: 800; color: #9a3412; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
	.ch::before { content: ''; width: 3px; height: 16px; background: linear-gradient(180deg, #c2410c, #f97316); border-radius: 2px; display: block; }
	label { display: block; font-size: 10.5px; font-weight: 700; color: #6b7e8c; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
	input, select { width: 100%; border: 1.5px solid #dde3eb; border-radius: 8px; padding: 8px 11px; font-size: 13px; color: #1a2530; background: #fafbfc; outline: none; transition: all .15s; }
	input:focus, select:focus { border-color: #ea580c; background: #fff; box-shadow: 0 0 0 3px rgba(234,88,12,.1); }
	.list-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
	.list-toolbar .field { display: flex; flex-direction: column; gap: 3px; }
	.list-toolbar input, .list-toolbar select { padding: 7px 11px; font-size: 12px; min-width: 140px; }
	.btn-filtrar { padding: 7px 20px; border: none; border-radius: 8px; background: #9a3412; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; transition: all .15s; width: auto; }
	.btn-filtrar:hover { background: #c2410c; }
	.ltbl-wrap { overflow-x: auto; border: 1px solid #dde3eb; border-radius: 12px; }
	.ltbl { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 900px; }
	.ltbl th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; padding: 11px 10px; border-bottom: 2px solid #fed7aa; white-space: nowrap; text-align: left; }
	.ltbl td { padding: 10px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
	.ltbl tbody tr:hover td { background: #fffbf5; }
	.ltbl .consec { font-family: monospace; font-weight: 800; color: #9a3412; font-size: 12px; }
	.ltbl .monto-total { font-family: monospace; font-weight: 800; color: #9a3412; font-size: 13px; text-align: right; white-space: nowrap; }
	.badge { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
	.btn-icon { background: none; border: none; cursor: pointer; padding: 5px 7px; border-radius: 6px; font-size: 14px; transition: all .1s; width: auto; }
	.btn-icon:hover { background: #f1f5f9; }
	.btn-icon.del:hover { background: #fee2e2; }
	.pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin-top: 16px; }
	.pagination button { padding: 6px 14px; border: 1px solid #dde3eb; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .1s; width: auto; }
	.pagination button.active { background: #9a3412; color: #fff; border-color: #9a3412; }
	.pagination button:hover:not(.active) { background: #f1f5f9; }
	.pagination button:disabled { opacity: .4; cursor: not-allowed; }
	.empty-state { text-align: center; padding: 48px 20px; color: #94a3b8; }
	.empty-state .icon { font-size: 48px; margin-bottom: 12px; }
	.empty-state .msg { font-size: 14px; font-weight: 600; color: #64748b; }
	.empty-state .hint { font-size: 12px; margin-top: 6px; }
	.loading-center { display: flex; justify-content: center; align-items: center; padding: 48px; }
	.spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #ea580c; border-radius: 50%; animation: spin .6s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
	.modal-box { background: #fff; border-radius: 18px; max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 60px rgba(0,0,0,.25); }
	.modal-hd { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
	.modal-hd h3 { font-size: 16px; font-weight: 800; color: #9a3412; margin: 0; }
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
	.det-totals { margin-top: 16px; background: #fffbf5; border-radius: 10px; padding: 14px 18px; }
	.det-total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
	.det-total-row.main { font-size: 16px; font-weight: 800; color: #9a3412; padding-top: 8px; border-top: 2px solid #fed7aa; margin-top: 6px; }
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
	.btn-estado.anl { border-color: #dc2626; color: #dc2626; font-size: 10px; padding: 3px 8px; }
	.btn-estado.rev { border-color: #d97706; color: #d97706; font-size: 10px; padding: 3px 8px; }
	.btn-estado:disabled { opacity: .5; cursor: not-allowed; transform: none; }

	/* Sub-tabs */
	.sub-tabs { display: flex; gap: 3px; background: #f1f5f9; border-radius: 8px; padding: 3px; width: fit-content; margin-bottom: 16px; }
	.sub-tab-btn { padding: 6px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700; transition: all .15s; background: transparent; color: #64748b; width: auto; }
	.sub-tab-btn.active { background: #fff; color: #9a3412; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
	.sub-tab-btn:hover:not(.active) { color: #475569; }

	/* Facturación */
	.btn-facturar-hdr {
		background: linear-gradient(135deg, #9a3412, #c2410c); color: #fff;
		border: none; border-radius: 8px; padding: 7px 16px;
		font-size: 12px; font-weight: 700; cursor: pointer;
		box-shadow: 0 2px 8px rgba(154,52,18,.3); transition: all .15s;
	}
	.btn-facturar-hdr:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(154,52,18,.4); }
	.badge-factura {
		display: inline-flex; align-items: center; gap: 3px;
		background: #fff7ed; color: #9a3412;
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
</style>
