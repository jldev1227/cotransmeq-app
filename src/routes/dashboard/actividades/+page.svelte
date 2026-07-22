<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast';
	import { socketUtils } from '$lib/socket';
	import {
		listarActividadesPesv,
		crearActividadPesv,
		actualizarActividadPesv,
		eliminarActividadPesv,
		obtenerSiguienteNumero,
		obtenerEstadisticasPesv
	} from '$lib/api/actividadesPesv';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import type {
		ActividadPesv,
		ActividadPesvFormData,
		ActividadPesvEstado,
		ActividadPesvPrioridad,
		ActividadPesvFrecuencia,
		ActividadPesvEstadisticas
	} from '$lib/types/actividadesPesv';

	// ==================== STATE ====================
	let loading = true;
	let actividades: ActividadPesv[] = [];
	let total = 0;
	let totalPages = 1;
	let currentPage = 1;
	let usuarios: Usuario[] = [];
	let estadisticas: ActividadPesvEstadisticas | null = null;

	// Vista
	let vistaActiva: 'listado' | 'calendario' = 'listado';

	// Filtros
	let filtroAnio = new Date().getFullYear();
	let filtroEstado = '';
	let filtroPrioridad = '';
	let filtroFrecuencia = '';
	let filtroSearch = '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	// Modal
	let showModal = false;
	let modalMode: 'crear' | 'editar' | 'ver' = 'crear';
	let editingId: string | null = null;
	let saving = false;

	// Form
	let form: ActividadPesvFormData = getEmptyForm();

	// Delete
	let showDeleteModal = false;
	let deletingId: string | null = null;
	let deletingName = '';
	let deleting = false;

	// Calendario
	let calMes = new Date().getMonth();
	let calAnio = new Date().getFullYear();

	// Constants
	const ESTADOS: { value: ActividadPesvEstado; label: string; color: string; bg: string }[] = [
		{ value: 'PENDIENTE', label: 'Pendiente', color: 'text-yellow-700', bg: 'bg-yellow-100' },
		{ value: 'EN_PROGRESO', label: 'En Progreso', color: 'text-blue-700', bg: 'bg-blue-100' },
		{ value: 'COMPLETADA', label: 'Completada', color: 'text-orange-700', bg: 'bg-orange-100' },
		{ value: 'VENCIDA', label: 'Vencida', color: 'text-red-700', bg: 'bg-red-100' },
		{ value: 'CANCELADA', label: 'Cancelada', color: 'text-gray-700', bg: 'bg-gray-100' }
	];
	const PRIORIDADES: { value: ActividadPesvPrioridad; label: string; color: string; bg: string }[] = [
		{ value: 'BAJA', label: 'Baja', color: 'text-gray-600', bg: 'bg-gray-100' },
		{ value: 'MEDIA', label: 'Media', color: 'text-blue-600', bg: 'bg-blue-100' },
		{ value: 'ALTA', label: 'Alta', color: 'text-orange-600', bg: 'bg-orange-100' },
		{ value: 'CRITICA', label: 'Crítica', color: 'text-red-600', bg: 'bg-red-100' }
	];
	const FRECUENCIAS: { value: ActividadPesvFrecuencia; label: string }[] = [
		{ value: 'UNICA', label: 'Única' },
		{ value: 'DIARIA', label: 'Diaria' },
		{ value: 'SEMANAL', label: 'Semanal' },
		{ value: 'QUINCENAL', label: 'Quincenal' },
		{ value: 'MENSUAL', label: 'Mensual' },
		{ value: 'BIMESTRAL', label: 'Bimestral' },
		{ value: 'TRIMESTRAL', label: 'Trimestral' },
		{ value: 'SEMESTRAL', label: 'Semestral' },
		{ value: 'ANUAL', label: 'Anual' }
	];
	const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

	function getEmptyForm(): ActividadPesvFormData {
		return {
			numero: 1,
			unidad_programa: '',
			actividad: '',
			alcance: '',
			recursos: '',
			responsable_planeacion: '',
			metodo_seguimiento: '',
			frecuencia: 'ANUAL',
			fecha_limite: '',
			responsable_ejecucion_id: '',
			estado: 'PENDIENTE',
			prioridad: 'BAJA',
			fecha_ejecucion: '',
			observacion: '',
			anio: new Date().getFullYear()
		};
	}

	// ==================== LIFECYCLE ====================
	onMount(async () => {
		await Promise.all([cargarActividades(), cargarUsuarios(), cargarEstadisticas()]);
		loading = false;

		socketUtils.on('actividad-pesv-created', handleSocketEvent);
		socketUtils.on('actividad-pesv-updated', handleSocketEvent);
		socketUtils.on('actividad-pesv-deleted', handleSocketEvent);
	});

	onDestroy(() => {
		socketUtils.off('actividad-pesv-created', handleSocketEvent);
		socketUtils.off('actividad-pesv-updated', handleSocketEvent);
		socketUtils.off('actividad-pesv-deleted', handleSocketEvent);
	});

	function handleSocketEvent() {
		cargarActividades();
		cargarEstadisticas();
	}

	// ==================== DATA ====================
	async function cargarActividades() {
		try {
			const res = await listarActividadesPesv({
				page: currentPage,
				limit: 50,
				anio: filtroAnio || undefined,
				estado: filtroEstado || undefined,
				prioridad: filtroPrioridad || undefined,
				frecuencia: filtroFrecuencia || undefined,
				search: filtroSearch || undefined
			});
			actividades = res.actividades;
			total = res.total;
			totalPages = res.totalPages;
		} catch (e) {
			console.error(e);
			toast.error('Error al cargar actividades');
		}
	}

	async function cargarUsuarios() {
		try {
			usuarios = await usuariosAPI.listar();
		} catch (e) {
			console.error(e);
		}
	}

	async function cargarEstadisticas() {
		try {
			estadisticas = await obtenerEstadisticasPesv(filtroAnio || undefined);
		} catch (e) {
			console.error(e);
		}
	}

	// ==================== FILTERS ====================
	function aplicarFiltros() {
		currentPage = 1;
		cargarActividades();
		cargarEstadisticas();
	}

	function limpiarFiltros() {
		filtroAnio = new Date().getFullYear();
		filtroEstado = '';
		filtroPrioridad = '';
		filtroFrecuencia = '';
		filtroSearch = '';
		aplicarFiltros();
	}

	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => aplicarFiltros(), 400);
	}

	function cambiarPagina(p: number) {
		if (p < 1 || p > totalPages) return;
		currentPage = p;
		cargarActividades();
	}

	// ==================== MODAL ====================
	async function abrirCrear() {
		modalMode = 'crear';
		form = getEmptyForm();
		try {
			form.numero = await obtenerSiguienteNumero(filtroAnio || undefined);
		} catch (e) { /* keep default */ }
		form.anio = filtroAnio || new Date().getFullYear();
		editingId = null;
		showModal = true;
	}

	function abrirEditar(act: ActividadPesv) {
		modalMode = 'editar';
		editingId = act.id;
		form = {
			numero: act.numero,
			unidad_programa: act.unidad_programa,
			actividad: act.actividad,
			alcance: act.alcance || '',
			recursos: act.recursos || '',
			responsable_planeacion: act.responsable_planeacion || '',
			metodo_seguimiento: act.metodo_seguimiento || '',
			frecuencia: act.frecuencia,
			fecha_limite: act.fecha_limite ? act.fecha_limite.substring(0, 10) : '',
			responsable_ejecucion_id: act.responsable_ejecucion_id || '',
			estado: act.estado,
			prioridad: act.prioridad,
			fecha_ejecucion: act.fecha_ejecucion ? act.fecha_ejecucion.substring(0, 10) : '',
			observacion: act.observacion || '',
			anio: act.anio
		};
		showModal = true;
	}

	function abrirVer(act: ActividadPesv) {
		abrirEditar(act);
		modalMode = 'ver';
	}

	async function guardar() {
		if (!form.actividad.trim()) {
			toast.error('El nombre de la actividad es requerido');
			return;
		}
		if (!form.unidad_programa.trim()) {
			toast.error('La unidad/programa es requerida');
			return;
		}

		saving = true;
		try {
			if (modalMode === 'crear') {
				await crearActividadPesv(form);
				toast.success('Actividad creada exitosamente');
			} else {
				await actualizarActividadPesv(editingId!, form);
				toast.success('Actividad actualizada exitosamente');
			}
			showModal = false;
			await cargarActividades();
			await cargarEstadisticas();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error al guardar');
		} finally {
			saving = false;
		}
	}

	// ==================== DELETE ====================
	function confirmarEliminar(act: ActividadPesv) {
		deletingId = act.id;
		deletingName = act.actividad;
		showDeleteModal = true;
	}

	async function ejecutarEliminar() {
		if (!deletingId) return;
		deleting = true;
		try {
			await eliminarActividadPesv(deletingId);
			toast.success('Actividad eliminada');
			showDeleteModal = false;
			deletingId = null;
			await cargarActividades();
			await cargarEstadisticas();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error al eliminar');
		} finally {
			deleting = false;
		}
	}

	// ==================== HELPERS ====================
	function getEstadoInfo(estado: string) {
		return ESTADOS.find(e => e.value === estado) || ESTADOS[0];
	}

	function getPrioridadInfo(prioridad: string) {
		return PRIORIDADES.find(p => p.value === prioridad) || PRIORIDADES[0];
	}

	function getFrecuenciaLabel(f: string) {
		return FRECUENCIAS.find(x => x.value === f)?.label || f;
	}

	function formatDate(d: string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	// ==================== CALENDARIO ====================
	$: calDays = getCalendarDays(calMes, calAnio);

	function getCalendarDays(mes: number, anio: number): (number | null)[] {
		const firstDay = new Date(anio, mes, 1).getDay();
		const daysInMonth = new Date(anio, mes + 1, 0).getDate();
		const days: (number | null)[] = [];
		for (let i = 0; i < firstDay; i++) days.push(null);
		for (let i = 1; i <= daysInMonth; i++) days.push(i);
		return days;
	}

	/**
	 * Check if a given activity should appear on a specific calendar day
	 * based on its frequency, using fecha_limite as anchor and repeating.
	 */
	function actividadAppearsOnDay(act: ActividadPesv, day: number): boolean {
		const targetDate = new Date(calAnio, calMes, day);
		const anchor = act.fecha_limite ? new Date(act.fecha_limite) : (act.fecha_ejecucion ? new Date(act.fecha_ejecucion) : null);
		if (!anchor) return false;

		// Normalize to date only (no time)
		const anchorDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
		const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

		// Target must be on or after anchor
		if (target < anchorDate) return false;

		const diffMs = target.getTime() - anchorDate.getTime();
		const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

		switch (act.frecuencia) {
			case 'UNICA':
				return diffDays === 0;
			case 'DIARIA':
				return true; // every day from anchor onwards
			case 'SEMANAL':
				return diffDays % 7 === 0;
			case 'QUINCENAL':
				return diffDays % 14 === 0;
			case 'MENSUAL':
				// Same day of month, on or after anchor
				if (target.getDate() !== anchorDate.getDate()) return false;
				return target >= anchorDate;
			case 'BIMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 2 === 0;
			}
			case 'TRIMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 3 === 0;
			}
			case 'SEMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 6 === 0;
			}
			case 'ANUAL':
				return target.getMonth() === anchorDate.getMonth() && target.getDate() === anchorDate.getDate();
			default:
				return false;
		}
	}

	function getActividadesForDay(day: number): ActividadPesv[] {
		return actividades.filter(a => actividadAppearsOnDay(a, day));
	}

	function prevMonth() {
		if (calMes === 0) { calMes = 11; calAnio--; }
		else calMes--;
	}

	function nextMonth() {
		if (calMes === 11) { calMes = 0; calAnio++; }
		else calMes++;
	}

	function irHoy() {
		calMes = new Date().getMonth();
		calAnio = new Date().getFullYear();
	}
</script>

<svelte:head>
	<title>Actividades | Cotransmeq</title>
</svelte:head>

<div class="actividades-pesv-page" in:fade={{ duration: 300 }}>
	<!-- Header -->
	<div class="page-header">
		<div class="header-left">
			<div>
				<h1>📋 Actividades</h1>
				<p class="subtitle">Plan Estratégico de Seguridad Vial — {filtroAnio}</p>
			</div>
		</div>
		<div class="header-actions">
			<div class="vista-toggle">
				<button class:active={vistaActiva === 'listado'} on:click={() => vistaActiva = 'listado'}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
					Listado
				</button>
				<button class:active={vistaActiva === 'calendario'} on:click={() => vistaActiva = 'calendario'}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
					Calendario
				</button>
			</div>
			<button class="btn-primary" on:click={abrirCrear}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
				Nueva Actividad
			</button>
		</div>
	</div>

	<!-- KPIs -->
	{#if estadisticas}
		<div class="kpis-row" in:fly={{ y: 20, duration: 300, delay: 100 }}>
			<div class="kpi-card">
				<span class="kpi-icon">📊</span>
				<div class="kpi-info">
					<span class="kpi-value">{estadisticas.total}</span>
					<span class="kpi-label">Total</span>
				</div>
			</div>
			<div class="kpi-card">
				<span class="kpi-icon">⏳</span>
				<div class="kpi-info">
					<span class="kpi-value">{estadisticas.porEstado?.PENDIENTE || 0}</span>
					<span class="kpi-label">Pendientes</span>
				</div>
			</div>
			<div class="kpi-card">
				<span class="kpi-icon">🔄</span>
				<div class="kpi-info">
					<span class="kpi-value">{estadisticas.porEstado?.EN_PROGRESO || 0}</span>
					<span class="kpi-label">En Progreso</span>
				</div>
			</div>
			<div class="kpi-card">
				<span class="kpi-icon">✅</span>
				<div class="kpi-info">
					<span class="kpi-value">{estadisticas.porEstado?.COMPLETADA || 0}</span>
					<span class="kpi-label">Completadas</span>
				</div>
			</div>
			<div class="kpi-card">
				<span class="kpi-icon">⚠️</span>
				<div class="kpi-info">
					<span class="kpi-value">{estadisticas.porEstado?.VENCIDA || 0}</span>
					<span class="kpi-label">Vencidas</span>
				</div>
			</div>
		</div>
	{/if}

	<!-- Filtros -->
	<div class="filtros-bar" in:fly={{ y: 20, duration: 300, delay: 150 }}>
		<div class="filtro-group">
			<input type="number" bind:value={filtroAnio} placeholder="Año" min="2020" max="2030" class="input-sm" on:change={aplicarFiltros} />
		</div>
		<div class="filtro-group">
			<select bind:value={filtroEstado} class="input-sm" on:change={aplicarFiltros}>
				<option value="">Todos los estados</option>
				{#each ESTADOS as e}
					<option value={e.value}>{e.label}</option>
				{/each}
			</select>
		</div>
		<div class="filtro-group">
			<select bind:value={filtroPrioridad} class="input-sm" on:change={aplicarFiltros}>
				<option value="">Todas las prioridades</option>
				{#each PRIORIDADES as p}
					<option value={p.value}>{p.label}</option>
				{/each}
			</select>
		</div>
		<div class="filtro-group">
			<select bind:value={filtroFrecuencia} class="input-sm" on:change={aplicarFiltros}>
				<option value="">Todas las frecuencias</option>
				{#each FRECUENCIAS as f}
					<option value={f.value}>{f.label}</option>
				{/each}
			</select>
		</div>
		<div class="filtro-group search-group">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
			<input type="text" bind:value={filtroSearch} placeholder="Buscar actividad..." class="input-sm" on:input={handleSearch} />
		</div>
		{#if filtroEstado || filtroPrioridad || filtroFrecuencia || filtroSearch}
			<button class="btn-clear" on:click={limpiarFiltros}>✕ Limpiar</button>
		{/if}
	</div>

	<!-- Content -->
	{#if loading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Cargando actividades...</p>
		</div>
	{:else if vistaActiva === 'listado'}
		<!-- TABLA -->
		<div class="table-container" in:fade={{ duration: 200 }}>
			{#if actividades.length === 0}
				<div class="empty-state">
					<span class="empty-icon">📋</span>
					<p>No se encontraron actividades</p>
					<button class="btn-primary" on:click={abrirCrear}>Crear primera actividad</button>
				</div>
			{:else}
				<div class="table-scroll">
					<table>
						<thead>
							<tr>
								<th class="w-16">#</th>
								<th>Actividad</th>
								<th>Unidad/Programa</th>
								<th>Frecuencia</th>
								<th>Responsable</th>
								<th>Estado</th>
								<th>Prioridad</th>
								<th>Fecha Límite</th>
								<th class="w-28">Acciones</th>
							</tr>
						</thead>
						<tbody>
							{#each actividades as act (act.id)}
								<tr in:fade={{ duration: 150 }}>
									<td class="font-mono text-center">{act.numero}</td>
									<td class="font-medium max-w-xs truncate" title={act.actividad}>{act.actividad}</td>
									<td class="max-w-xs truncate" title={act.unidad_programa}>{act.unidad_programa}</td>
									<td><span class="badge badge-neutral">{getFrecuenciaLabel(act.frecuencia)}</span></td>
									<td>{act.responsable_ejecucion?.nombre || '—'}</td>
									<td>
										<span class="badge {getEstadoInfo(act.estado).bg} {getEstadoInfo(act.estado).color}">{getEstadoInfo(act.estado).label}</span>
									</td>
									<td>
										<span class="badge {getPrioridadInfo(act.prioridad).bg} {getPrioridadInfo(act.prioridad).color}">{getPrioridadInfo(act.prioridad).label}</span>
									</td>
									<td class="text-sm">{formatDate(act.fecha_limite)}</td>
									<td>
										<div class="action-buttons">
											<button class="btn-icon" title="Ver" on:click={() => abrirVer(act)}>👁️</button>
											<button class="btn-icon" title="Editar" on:click={() => abrirEditar(act)}>✏️</button>
											<button class="btn-icon delete" title="Eliminar" on:click={() => confirmarEliminar(act)}>🗑️</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Paginación -->
				{#if totalPages > 1}
					<div class="pagination">
						<span class="pagination-info">Mostrando {actividades.length} de {total}</span>
						<div class="pagination-controls">
							<button disabled={currentPage === 1} on:click={() => cambiarPagina(currentPage - 1)}>←</button>
							{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
								<button class:active={p === currentPage} on:click={() => cambiarPagina(p)}>{p}</button>
							{/each}
							<button disabled={currentPage === totalPages} on:click={() => cambiarPagina(currentPage + 1)}>→</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>

	{:else}
		<!-- CALENDARIO -->
		<div class="calendar-container" in:fade={{ duration: 200 }}>
			<div class="calendar-header">
				<button class="btn-cal-nav" on:click={prevMonth}>←</button>
				<h2>{MESES[calMes]} {calAnio}</h2>
				<button class="btn-cal-nav" on:click={nextMonth}>→</button>
				<button class="btn-cal-today" on:click={irHoy}>Hoy</button>
			</div>
			<div class="calendar-grid">
				<div class="cal-day-header">Dom</div>
				<div class="cal-day-header">Lun</div>
				<div class="cal-day-header">Mar</div>
				<div class="cal-day-header">Mié</div>
				<div class="cal-day-header">Jue</div>
				<div class="cal-day-header">Vie</div>
				<div class="cal-day-header">Sáb</div>

				{#each calDays as day}
					{@const dayActs = day ? getActividadesForDay(day) : []}
					<div class="cal-cell" class:empty={!day} class:today={day === new Date().getDate() && calMes === new Date().getMonth() && calAnio === new Date().getFullYear()}>
						{#if day}
							<span class="cal-day-num">{day}</span>
							{#each dayActs.slice(0, 3) as act}
								<button
									class="cal-event {getEstadoInfo(act.estado).bg}"
									title="{act.actividad} — {getEstadoInfo(act.estado).label}"
									on:click={() => abrirVer(act)}
								>
									{act.actividad.substring(0, 18)}{act.actividad.length > 18 ? '…' : ''}
								</button>
							{/each}
							{#if dayActs.length > 3}
								<span class="cal-more">+{dayActs.length - 3} más</span>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- ==================== MODAL CREAR/EDITAR ==================== -->
{#if showModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" on:click|self={() => showModal = false} on:keydown={e => e.key === 'Escape' && (showModal = false)} transition:fade={{ duration: 200 }}>
		<div class="modal-content modal-xl" in:fly={{ y: 30, duration: 300 }}>
			<div class="modal-header">
				<h2>{modalMode === 'crear' ? '➕ Nueva Actividad' : modalMode === 'editar' ? '✏️ Editar Actividad' : '👁️ Detalle Actividad'}</h2>
				<button class="btn-close" on:click={() => showModal = false}>✕</button>
			</div>

		<div class="modal-body">
					<!-- Row 1 -->
					<div class="form-group w-20">
						<label>Nº
						<input type="number" bind:value={form.numero} disabled={modalMode === 'ver'} class="input" />
						</label>
					</div>
					<div class="form-group flex-1">
						<label>Actividad *
						<input type="text" bind:value={form.actividad} disabled={modalMode === 'ver'} class="input" placeholder="Nombre de la actividad" />
						</label>
					</div>
					<div class="form-group w-28">
						<label>Año
						<input type="number" bind:value={form.anio} disabled={modalMode === 'ver'} class="input" />
						</label>
					</div>

					<!-- Row 2 -->
					<div class="form-group flex-1">
						<label>Unidad/Programa *
						<input type="text" bind:value={form.unidad_programa} disabled={modalMode === 'ver'} class="input" placeholder="Ej: Fortalecimiento en la gestión institucional" />
						</label>
					</div>
					<div class="form-group flex-1">
						<label>Alcance
						<input type="text" bind:value={form.alcance} disabled={modalMode === 'ver'} class="input" placeholder="Alcance de la actividad" />
						</label>
					</div>

					<!-- Row 3 -->
					<div class="form-group flex-1">
						<label>Recursos
						<input type="text" bind:value={form.recursos} disabled={modalMode === 'ver'} class="input" placeholder="Recursos necesarios" />
						</label>
					</div>
					<div class="form-group flex-1">
						<label>Responsable Planeación
						<input type="text" bind:value={form.responsable_planeacion} disabled={modalMode === 'ver'} class="input" placeholder="Responsable de planeación" />
						</label>
					</div>

					<!-- Row 4 -->
					<div class="form-group flex-1">
						<label>Método de Seguimiento
						<input type="text" bind:value={form.metodo_seguimiento} disabled={modalMode === 'ver'} class="input" placeholder="Método de seguimiento" />
						</label>
					</div>
					<div class="form-group w-40">
						<label>Frecuencia
						<select bind:value={form.frecuencia} disabled={modalMode === 'ver'} class="input">
							{#each FRECUENCIAS as f}
								<option value={f.value}>{f.label}</option>
							{/each}
						</select>
						</label>
					</div>

					<!-- Row 5 -->
					<div class="form-group flex-1">
						<label>Responsable Ejecución
						<select bind:value={form.responsable_ejecucion_id} disabled={modalMode === 'ver'} class="input">
							<option value="">— Sin asignar —</option>
							{#each usuarios as u}
								<option value={u.id}>{u.nombre}</option>
							{/each}
						</select>
						</label>
					</div>
					<div class="form-group w-36">
						<label>Fecha Límite
						<input type="date" bind:value={form.fecha_limite} disabled={modalMode === 'ver'} class="input" />
						</label>
					</div>
					<div class="form-group w-36">
						<label>Fecha Ejecución
						<input type="date" bind:value={form.fecha_ejecucion} disabled={modalMode === 'ver'} class="input" />
						</label>
					</div>

					<!-- Row 6 -->
					<div class="form-group w-32">
						<label>Estado
						<select bind:value={form.estado} disabled={modalMode === 'ver'} class="input">
							{#each ESTADOS as e}
								<option value={e.value}>{e.label}</option>
							{/each}
						</select>
						</label>
					</div>
					<div class="form-group w-32">
						<label>Prioridad
						<select bind:value={form.prioridad} disabled={modalMode === 'ver'} class="input">
							{#each PRIORIDADES as p}
								<option value={p.value}>{p.label}</option>
							{/each}
						</select>
						</label>
					</div>

					<!-- Row 7 -->
					<div class="form-group full-width">
						<label>Observación
						<textarea bind:value={form.observacion} disabled={modalMode === 'ver'} class="input" rows="3" placeholder="Observaciones..."></textarea>
						</label>
					</div>
		</div>

		<div class="modal-footer">
			{#if modalMode === 'ver'}
				<button class="btn-secondary" on:click={() => { modalMode = 'editar' }}>✏️ Editar</button>
			{:else}
				<button class="btn-primary" on:click={guardar} disabled={saving}>
					{#if saving}
						<div class="spinner-sm"></div> Guardando...
					{:else}
						💾 {modalMode === 'crear' ? 'Crear' : 'Guardar'}
					{/if}
				</button>
			{/if}
		</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL DELETE ==================== -->
{#if showDeleteModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" on:click|self={() => showDeleteModal = false} on:keydown={e => e.key === 'Escape' && (showDeleteModal = false)} transition:fade={{ duration: 150 }}>
		<div class="modal-content modal-sm" in:fly={{ y: 20, duration: 200 }}>
			<div class="modal-header delete-header">
				<h2>🗑️ Eliminar Actividad</h2>
				<button class="btn-close" on:click={() => showDeleteModal = false}>✕</button>
			</div>
			<div class="modal-body text-center">
				<p class="text-gray-700">¿Estás seguro de eliminar la actividad:</p>
				<p class="font-semibold text-lg mt-2">"{deletingName}"</p>
				<p class="text-sm text-gray-500 mt-2">Esta acción no se puede deshacer.</p>
			</div>
			<div class="modal-footer justify-center gap-3">
				<button class="btn-secondary" on:click={() => showDeleteModal = false}>Cancelar</button>
				<button class="btn-danger" on:click={ejecutarEliminar} disabled={deleting}>
					{#if deleting}
						Eliminando...
					{:else}
						Sí, eliminar
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.actividades-pesv-page {
		padding: 1.5rem;
		max-width: 100%;
	}

	/* Header */
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.header-left h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #111;
	}
	.subtitle {
		font-size: 0.85rem;
		color: #6b7280;
	}
	.header-actions { display: flex; align-items: center; gap: 0.75rem; }

	/* Vista toggle */
	.vista-toggle {
		display: flex;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		overflow: hidden;
		background: white;
	}
	.vista-toggle button {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		font-size: 0.8rem;
		font-weight: 500;
		border: none;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
	}
	.vista-toggle button svg { width: 1rem; height: 1rem; }
	.vista-toggle button.active {
		background: #f97316;
		color: white;
	}

	/* Buttons */
	.btn-primary {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: #f97316;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-primary:hover { background: #ea580c; }
	.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.btn-primary svg { width: 1rem; height: 1rem; }

	.btn-secondary {
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #374151;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-secondary:hover { background: #e5e7eb; }

	.btn-danger {
		padding: 0.5rem 1rem;
		background: #ef4444;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-danger:hover { background: #dc2626; }
	.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

	.btn-clear {
		padding: 0.375rem 0.75rem;
		background: transparent;
		color: #ef4444;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-clear:hover { background: #fef2f2; }

	/* KPIs */
	.kpis-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.kpi-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.04);
	}
	.kpi-icon { font-size: 1.5rem; }
	.kpi-value { font-size: 1.5rem; font-weight: 700; color: #111; display: block; }
	.kpi-label { font-size: 0.75rem; color: #6b7280; }

	/* Filtros */
	.filtros-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
	}
	.filtro-group { position: relative; }
	.search-group {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 180px;
	}
	.search-group svg { width: 1rem; height: 1rem; color: #9ca3af; flex-shrink: 0; }
	.input-sm {
		padding: 0.375rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		background: white;
		outline: none;
		transition: border-color 0.2s;
	}
	.input-sm:focus { border-color: #f97316; }
	.search-group .input-sm { border: none; flex: 1; }

	/* Table */
	.table-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		overflow: hidden;
	}
	.table-scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	thead { background: #f9fafb; }
	th {
		padding: 0.75rem 0.75rem;
		text-align: left;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}
	td {
		padding: 0.625rem 0.75rem;
		font-size: 0.8rem;
		color: #374151;
		border-bottom: 1px solid #f3f4f6;
		white-space: nowrap;
	}
	tr:hover { background: #f0fdf4; }
	.w-16 { width: 4rem; }
	.w-24 { width: 6rem; }
	.w-28 { width: 7rem; }
	.w-32 { width: 8rem; }
	.max-w-xs { max-width: 12rem; }
	.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.font-mono { font-family: monospace; }
	.font-medium { font-weight: 500; }
	.text-center { text-align: center; }
	.text-xs { font-size: 0.7rem; }
	.text-sm { font-size: 0.8rem; }

	/* Badges */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.badge-neutral { background: #f3f4f6; color: #4b5563; }

	/* Action buttons */
	.action-buttons { display: flex; gap: 0.25rem; }
	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		cursor: pointer;
		font-size: 0.85rem;
		transition: background 0.2s;
	}
	.btn-icon:hover { background: #f3f4f6; }
	.btn-icon.delete:hover { background: #fef2f2; }

	/* Pagination */
	.pagination {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-top: 1px solid #e5e7eb;
	}
	.pagination-info { font-size: 0.8rem; color: #6b7280; }
	.pagination-controls { display: flex; gap: 0.25rem; }
	.pagination-controls button {
		padding: 0.375rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
		color: #374151;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	.pagination-controls button.active { background: #f97316; color: white; border-color: #f97316; }
	.pagination-controls button:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Calendar */
	.calendar-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		padding: 1.25rem;
	}
	.calendar-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.calendar-header h2 {
		font-size: 1.2rem;
		font-weight: 600;
		color: #111;
		min-width: 12rem;
		text-align: center;
	}
	.btn-cal-nav {
		padding: 0.375rem 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
		cursor: pointer;
		font-size: 1rem;
		transition: all 0.2s;
	}
	.btn-cal-nav:hover { background: #f3f4f6; }
	.btn-cal-today {
		padding: 0.375rem 0.75rem;
		border: 1px solid #f97316;
		border-radius: 0.5rem;
		background: #f0fdf4;
		color: #ea580c;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-cal-today:hover { background: #d1fae5; }
	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		overflow: hidden;
	}
	.cal-day-header {
		padding: 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
	}
	.cal-cell {
		min-height: 6rem;
		padding: 0.375rem;
		border-right: 1px solid #f3f4f6;
		border-bottom: 1px solid #f3f4f6;
		position: relative;
	}
	.cal-cell.empty { background: #fafafa; }
	.cal-cell.today { background: #f0fdf4; }
	.cal-day-num {
		font-size: 0.75rem;
		font-weight: 600;
		color: #374151;
		display: block;
		margin-bottom: 2px;
	}
	.cal-event {
		display: block;
		width: 100%;
		padding: 1px 4px;
		border: none;
		border-radius: 3px;
		font-size: 0.6rem;
		text-align: left;
		cursor: pointer;
		margin-bottom: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: opacity 0.2s;
	}
	.cal-event:hover { opacity: 0.8; }
	.cal-more {
		font-size: 0.6rem;
		color: #6b7280;
		display: block;
	}

	/* Modal (landing-cotransmeq) */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}
	.modal-content {
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 24px;
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 64px rgba(0,0,0,0.18);
	}
	.modal-xl { max-width: 56rem; }
	.modal-sm { max-width: 28rem; }
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		background: linear-gradient(180deg, #ffffff 0%, #fcfcfb 100%);
	}
	.modal-header h2 {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 1.25rem;
		font-weight: 600;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.delete-header { background: linear-gradient(135deg, rgba(220, 38, 38, 0.04), #ffffff 60%); }
	.btn-close {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 10px;
		background: transparent;
		font-size: 1.1rem;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-close:hover {
		background: rgba(249, 115, 22, 0.06);
		border-color: rgba(249, 115, 22, 0.3);
		color: #ea580c;
		transform: rotate(90deg);
	}
	.modal-body {
		padding: 1.25rem 1.5rem;
		overflow-y: auto;
	}
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid rgba(15, 23, 42, 0.08);
		background: #fcfcfb;
	}
	.justify-center { justify-content: center; }
	.gap-3 { gap: 0.75rem; }

	/* Form */
	.form-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.form-group label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
	}
	.form-group.full-width { width: 100%; }
	.form-group.flex-1 { flex: 1; min-width: 200px; }
	.form-group.w-20 { width: 5rem; }
	.form-group.w-28 { width: 7rem; }
	.form-group.w-32 { width: 8rem; }
	.form-group.w-36 { width: 9rem; }
	.form-group.w-40 { width: 10rem; }

	.input {
		padding: 0.5rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		background: white;
		outline: none;
		transition: border-color 0.2s;
		width: 100%;
	}
	.input:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1); }
	.input:disabled { background: #f9fafb; color: #6b7280; }
	textarea.input { resize: vertical; }

	/* Empty / Loading */
	.loading-state, .empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		color: #6b7280;
		gap: 0.75rem;
	}
	.empty-icon { font-size: 3rem; }
	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid #e5e7eb;
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	.spinner-sm {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* Responsive */
	@media (max-width: 768px) {
		.page-header { flex-direction: column; align-items: flex-start; }
		.header-actions { width: 100%; justify-content: space-between; }
		.filtros-bar { flex-direction: column; }
		.filtro-group { width: 100%; }
		.search-group { width: 100%; }
		.input-sm { width: 100%; }
		.kpis-row { grid-template-columns: repeat(2, 1fr); }
		.form-group.flex-1 { min-width: 100%; }
		.form-group.w-20, .form-group.w-28, .form-group.w-32,
		.form-group.w-36, .form-group.w-40 { width: 100%; }
	}
</style>
