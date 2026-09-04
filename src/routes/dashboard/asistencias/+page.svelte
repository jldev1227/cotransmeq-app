<script lang="ts">
	import { page } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		numero,
		opcion,
		texto,
		valoresPorDefecto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { asistenciasAPI, type FormularioAsistencia } from '$lib/api/asistencias';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import ModalConfirm from '$lib/components/common/ModalConfirm.svelte';
	import type { FormularioWithStatus } from '$lib/stores/asistencias';
	import { socketUtils } from '$lib/socket';
	import DataTable from '$lib/components/ui/data-table/DataTable.svelte';

	const FILTERS: { label: string; value: 'all' | 'activo' | 'inactivo' }[] = [
		{ label: 'Todos', value: 'all' },
		{ label: 'Activos', value: 'activo' },
		{ label: 'Inactivos', value: 'inactivo' }
	];

	let formularios = $state<FormularioWithStatus[]>([]);
	let isLoading = $state(true);
	let showModalForm = $state(false);
	let formularioEdit = $state<FormularioAsistencia | null>(null);
	let showModalDelete = $state(false);
	let formularioToDelete = $state<FormularioAsistencia | null>(null);
	let isDeletingFormulario = $state(false);
	let isDownloading = $state(false);
	let totalRows = $state(0);

	/**
	 * Filtros en la URL: búsqueda, estado, orden y página.
	 *
	 * Todo se resuelve en servidor, así que la firma incluye los cuatro y la
	 * búsqueda va con el retardo compartido.
	 */
	interface FiltrosAsistencias {
		q: string;
		estado: string;
		orden: string;
		dir: string;
		pagina: number;
	}

	const POR_PAGINA = 10;

	const DEFS: DefinicionesFiltros<FiltrosAsistencias> = {
		q: texto(),
		estado: opcion('all'),
		orden: opcion('fecha'),
		dir: opcion('desc'),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	const DEFS_VACIOS = valoresPorDefecto(DEFS);
	let filtros = $state<FiltrosAsistencias>(estadoUrl.leer(page.url));

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	function ponerFiltro<K extends keyof FiltrosAsistencias>(
		clave: K,
		valor: FiltrosAsistencias[K]
	) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	let selectedIds = $state<Set<string>>(new Set());
	let isSelectingAll = $state(false);
	let progressToastId: string | number | undefined;
	let progressJobId = $state<string | null>(null);
	const activeJobs = new Set<string>();

	const onFormularioCreated = ({ formulario }: any) => {
		toast.success(`Nuevo formulario: ${formulario.tematica}`);
		cargarFormularios();
	};

	const onFormularioUpdated = ({ formulario }: any) => {
		cargarFormularios();
	};

	const onFormularioDisabled = ({ formulario }: any) => {
		cargarFormularios();
	};

	const onRespuestaCreated = ({ formularioId }: any) => {
		cargarFormularios();
		toast.success('Nueva respuesta recibida');
	};

	const onExportProgress = (payload: any) => {
		if (!payload || !progressJobId || payload.jobId !== progressJobId) return;
		const { current, total, percent, currentTematica } = payload;
		const label = currentTematica ? ` · ${currentTematica.substring(0, 30)}${currentTematica.length > 30 ? '…' : ''}` : '';
		toast.loading(`Generando PDF ${current}/${total} (${percent}%)${label}`, {
			id: progressToastId,
			description: 'Por favor espera, este proceso puede tardar unos minutos'
		});
	};

	const onExportDone = (payload: any) => {
		if (!payload || !progressJobId || payload.jobId !== progressJobId) return;
		activeJobs.delete(payload.jobId);
		progressJobId = null;
		toast.success('Generación completada, iniciando descarga...', {
			id: progressToastId
		});
	};

	onMount(() => {
		setupSocketListeners();
	});

	onDestroy(() => {
		cleanupSocketListeners();
		selectedIds = new Set();
	});

	function setupSocketListeners() {
		socketUtils.on('asistencias:formulario:created', onFormularioCreated);
		socketUtils.on('asistencias:formulario:updated', onFormularioUpdated);
		socketUtils.on('asistencias:formulario:disabled', onFormularioDisabled);
		socketUtils.on('asistencias:respuesta:created', onRespuestaCreated);
		socketUtils.on('asistencias:export:progress', onExportProgress);
		socketUtils.on('asistencias:export:done', onExportDone);
	}

	function cleanupSocketListeners() {
		socketUtils.off('asistencias:formulario:created', onFormularioCreated);
		socketUtils.off('asistencias:formulario:updated', onFormularioUpdated);
		socketUtils.off('asistencias:formulario:disabled', onFormularioDisabled);
		socketUtils.off('asistencias:respuesta:created', onRespuestaCreated);
		socketUtils.off('asistencias:export:progress', onExportProgress);
		socketUtils.off('asistencias:export:done', onExportDone);
	}

	async function cargarFormularios() {
		isLoading = true;
		try {
			const response = await asistenciasAPI.obtenerFormularios({
				page: filtros.pagina,
				limit: POR_PAGINA,
				search: filtros.q || undefined,
				filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
				sortBy: filtros.orden as 'fecha' | 'tematica' | 'respuestas',
				sortOrder: filtros.dir as 'asc' | 'desc'
			});

			if (response && response.data) {
				formularios = response.data;
				totalRows = response.meta?.total ?? response.data.length;
			}
		} catch (error: any) {
			toast.error('Error al cargar los formularios');
			console.error(error);
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		/// Un solo objeto: cualquiera de sus campos cambia lo que se pide.
		void filtros;
		untrack(() => {
			cargarFormularios();
		});
	});

	/// Cambiar un filtro limpia la selección (`limpiarSeleccion`, más abajo):
	/// las filas marcadas ya no están necesariamente en pantalla, y una acción
	/// masiva sobre ellas sorprendería a quien creía haberlas perdido de vista.
	function buscar(termino: string) {
		ponerFiltro('q', termino);
		limpiarSeleccion();
	}

	function setFilter(value: 'all' | 'activo' | 'inactivo') {
		ponerFiltro('estado', value);
		limpiarSeleccion();
	}

	function clearFilters() {
		filtros = { ...DEFS_VACIOS };
		limpiarSeleccion();
	}

	function handleSort(field: string, order: 'asc' | 'desc') {
		filtros = { ...filtros, orden: field, dir: order, pagina: 1 };
		limpiarSeleccion();
	}

	function handlePageChange(pagina: number) {
		filtros = { ...filtros, pagina };
	}

	function handleSelectionChange(newSelected: Set<string | number>) {
		selectedIds = new Set(newSelected as Set<string>);
	}

	async function seleccionarTodosLosFiltrados() {
		if (isSelectingAll) return;
		isSelectingAll = true;
		try {
			const all = await asistenciasAPI.obtenerTodosLosIds({
				filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
				search: filtros.q || undefined
			});
			selectedIds = new Set(all);
			toast.success(`${all.length} formularios seleccionados`);
		} catch (error) {
			toast.error('Error al seleccionar todos los formularios');
		} finally {
			isSelectingAll = false;
		}
	}

	function limpiarSeleccion() {
		selectedIds = new Set();
		isSelectingAll = false;
	}

	async function handleFormularioSaved(event: CustomEvent) {
		if (event.detail?.formulario) {
			toast.success('Formulario actualizado exitosamente');
			cargarFormularios();
		}
	}

	function openCreateModal() {
		formularioEdit = null;
		showModalForm = true;
	}

	function ejecutarDescarga(blob: Blob, fileName: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function descargarTodasPDFs() {
		if (isDownloading) return;
		isDownloading = true;
		progressJobId = `all-${Date.now()}`;
		activeJobs.add(progressJobId);
		progressToastId = toast.loading(`Generando ZIP con TODAS las asistencias filtradas...`, {
			description: 'Por favor espera, este proceso puede tardar unos minutos'
		});
		try {
			const blob = await asistenciasAPI.exportarTodasPDFs({
				filterActivo: filtros.estado as 'all' | 'activo' | 'inactivo',
				search: filtros.q || undefined,
				jobId: progressJobId
			});

			toast.success('Descarga lista', { id: progressToastId });
			progressJobId = null;
			activeJobs.clear();
			ejecutarDescarga(blob, `asistencias_${new Date().toISOString().split('T')[0]}.zip`);
		} catch (error: any) {
			toast.error(error.message || 'Error al descargar las asistencias', { id: progressToastId });
			progressJobId = null;
			activeJobs.delete(progressJobId!);
		} finally {
			isDownloading = false;
		}
	}

	async function descargarSeleccionados() {
		if (isDownloading || selectedIds.size === 0) return;
		isDownloading = true;
		const ids = Array.from(selectedIds);
		progressJobId = `sel-${Date.now()}`;
		activeJobs.add(progressJobId);
		progressToastId = toast.loading(`Generando ZIP con ${ids.length} formularios seleccionados...`, {
			description: 'Por favor espera, este proceso puede tardar unos minutos'
		});
		try {
			const blob = await asistenciasAPI.exportarSeleccionadosPDFs(ids, progressJobId);

			toast.success('Descarga lista', { id: progressToastId });
			progressJobId = null;
			activeJobs.clear();
			ejecutarDescarga(blob, `asistencias_seleccionadas_${new Date().toISOString().split('T')[0]}.zip`);
			selectedIds = new Set();
		} catch (error: any) {
			toast.error(error.message || 'Error al descargar los formularios seleccionados', { id: progressToastId });
			progressJobId = null;
			activeJobs.delete(progressJobId!);
		} finally {
			isDownloading = false;
		}
	}

	function openEditModal(formulario: FormularioAsistencia) {
		formularioEdit = formulario;
		showModalForm = true;
	}

	async function toggleActivo(formulario: FormularioAsistencia) {
		try {
			await asistenciasAPI.actualizarFormulario(formulario.id, {
				activo: !formulario.activo
			});

			toast.success(formulario.activo ? 'Formulario desactivado' : 'Formulario activado');
			cargarFormularios();
		} catch (error: any) {
			toast.error('Error al actualizar el formulario');
		}
	}

	function eliminarFormulario(formulario: FormularioAsistencia) {
		formularioToDelete = formulario;
		showModalDelete = true;
	}

	async function confirmarEliminarFormulario() {
		if (!formularioToDelete) return;

		isDeletingFormulario = true;
		try {
			await asistenciasAPI.eliminarFormulario(formularioToDelete.id);
			toast.success('Formulario eliminado exitosamente');
			showModalDelete = false;
			formularioToDelete = null;
			cargarFormularios();
		} catch (error: any) {
			toast.error('Error al eliminar el formulario');
		} finally {
			isDeletingFormulario = false;
		}
	}

	function copiarEnlace(formulario: FormularioAsistencia) {
		const url = asistenciasAPI.generarUrlPublica(formulario.token);
		navigator.clipboard.writeText(url);
		toast.success('Enlace copiado al portapapeles');
	}

	function formatFecha(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		const year = fecha.getUTCFullYear();
		const month = fecha.getUTCMonth();
		const day = fecha.getUTCDate();
		const fechaLocal = new Date(year, month, day);
		return fechaLocal.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function getTipoEventoLabel(tipo: string, tipoOtro?: string): string {
		const labels: Record<string, string> = {
			capacitacion: 'Capacitación',
			asesoria: 'Asesoría',
			charla: 'Charla',
			induccion: 'Inducción',
			reunion: 'Reunión',
			divulgacion: 'Divulgación'
		};
		return tipo === 'otro' ? tipoOtro || 'Otro' : labels[tipo] || tipo;
	}

	let activeCount = $derived(formularios.filter((f) => f.activo).length);
	let inactiveCount = $derived(formularios.filter((f) => !f.activo).length);
</script>

<svelte:head>
	<title>Asistencias - Cotransmeq</title>
</svelte:head>

<div class="dash-wrapper" in:fade={{ duration: 400 }}>
	<div class="dash">
		<header class="header">
			<div class="header-left">
				<div class="logo-mark" aria-hidden="true">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 11l3 3L22 4" />
						<path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
					</svg>
				</div>
				<div>
					<span class="eyebrow">Asistencias · {new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
					<h1>Formularios de Asistencia</h1>
					<p class="header-sub">Gestión y trazabilidad de eventos · capacitación, asesoría, reunión.</p>
				</div>
			</div>
			<div class="header-actions">
				{#if selectedIds.size > 0}
					<button class="btn-ghost" onclick={limpiarSeleccion} aria-label="Limpiar selección">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
						Limpiar ({selectedIds.size})
					</button>
				{/if}
				<button class="btn-secondary" onclick={seleccionarTodosLosFiltrados} disabled={isSelectingAll || isDownloading} aria-label="Seleccionar todas las filtradas">
					{#if isSelectingAll}
						<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 12a9 9 0 11-6.219-8.56" />
						</svg>
						Seleccionando...
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="9 11 12 14 22 4" />
							<path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
						</svg>
						Seleccionar todas
					{/if}
				</button>
				<button class="btn-secondary" onclick={descargarTodasPDFs} disabled={isDownloading} aria-label="Descargar todas las asistencias en PDF">
					{#if isDownloading && progressJobId?.startsWith('all-')}
						<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 12a9 9 0 11-6.219-8.56" />
						</svg>
						Descargando...
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
						Descargar todas
					{/if}
				</button>
				<button class="btn-primary" onclick={openCreateModal} aria-label="Crear nuevo formulario">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
					Nuevo Formulario
				</button>
			</div>
		</header>

		<div class="filter-bar" role="search">
			<div class="search-wrap">
				<svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8" />
					<line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<BuscadorLista
					valor={filtros.q}
					onBuscar={buscar}
					placeholder="Buscar formulario…"
					etiqueta="Buscar formularios de asistencia"
				/>
			</div>

			<nav class="pills" aria-label="Filtros de estado">
				{#each FILTERS as f (f.label)}
					<button
						class="pill"
						class:pill-active={filtros.estado === f.value}
						onclick={() => setFilter(f.value)}
						aria-pressed={filtros.estado === f.value}
					>
						{f.label}
						{#if f.value === 'activo'}
							<span class="pill-count">{activeCount}</span>
						{:else if f.value === 'inactivo'}
							<span class="pill-count">{inactiveCount}</span>
						{/if}
					</button>
				{/each}
			</nav>
		</div>

		<div class="results-info" aria-live="polite" aria-atomic="true">
			{#if isLoading}
				<span>Cargando...</span>
			{:else}
				<span>{totalRows} formulario{totalRows !== 1 ? 's' : ''} encontrado{totalRows !== 1 ? 's' : ''}</span>
				{#if filtros.q || filtros.estado !== 'all'}
					<button class="reset-btn" onclick={clearFilters}>
						Limpiar filtros
					</button>
				{/if}
			{/if}
		</div>

		<div class="desktop-only">
			<DataTable
				data={formularios}
				columns={[
					{
						key: 'tematica',
						label: 'Temática',
						sortable: true,
						render: (f: FormularioWithStatus) => {
							if (!f) return '<span class="text-muted">Sin datos</span>';
							const titulo = f.tematica || 'Sin título';
							const objetivo = f.objetivo ? `<p class="td-desc">${f.objetivo}</p>` : '';
							const tipo = `<span class="badge-tipo">${getTipoEventoLabel(f.tipo_evento, f.tipo_evento_otro)}</span>`;
							return `<div class="cell-tematica"><span class="td-title">${titulo}</span>${objetivo}${tipo}</div>`;
						}
					},
					{
						key: 'fecha',
						label: 'Fecha',
						sortable: true,
						render: (f: FormularioWithStatus) => {
							const fecha = f?.fecha ? formatFecha(f.fecha) : '-';
							return `<span class="td-date">${fecha}</span>`;
						}
					},
					{
						key: 'lugar_instructor',
						label: 'Lugar / Instructor',
						render: (f: FormularioWithStatus) => {
							if (!f) return '<span class="text-muted">-</span>';
							const lugar = f.lugar_sede ? `<span>${f.lugar_sede}</span>` : '';
							const instructor = f.nombre_instructor ? `<span class="text-muted">${f.nombre_instructor}</span>` : '';
							if (!lugar && !instructor) return '<span class="text-muted">-</span>';
							return `<div class="cell-lugar">${lugar}${instructor}</div>`;
						}
					},
					{
						key: 'estado',
						label: 'Estado',
						align: 'center',
						render: (f: FormularioWithStatus) => f?.activo
							? '<span class="status-badge active">Activo</span>'
							: '<span class="status-badge inactive">Inactivo</span>'
					},
					{
						key: 'respuestas',
						label: 'Respuestas',
						align: 'center',
						render: (f: FormularioWithStatus) => {
							const count = f?._count?.respuestas ?? 0;
							return `<span class="num-badge blue">${count}</span>`;
						}
					},
					{
						key: 'acciones',
						label: 'Acciones',
						align: 'right',
						render: (f: FormularioWithStatus) => {
							if (!f?.id) return '';
							const playIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
							const pauseIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
							const toggleIcon = f.activo ? pauseIcon : playIcon;
							const toggleClass = f.activo ? 'pause' : 'play';
							const toggleTitle = f.activo ? 'Desactivar' : 'Activar';
							return `
								<div class="actions-wrap">
									<button class="action-btn view" title="Ver respuestas" data-action="view">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
											<circle cx="12" cy="12" r="3" />
										</svg>
									</button>
									<button class="action-btn copy" title="Copiar enlace" data-action="copy">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
											<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
										</svg>
									</button>
									<button class="action-btn edit" title="Editar" data-action="edit">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
											<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
										</svg>
									</button>
									<button class="action-btn ${toggleClass}" title="${toggleTitle}" data-action="toggle">
										${toggleIcon}
									</button>
									<button class="action-btn delete" title="Eliminar" data-action="delete">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6" />
											<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
										</svg>
									</button>
								</div>
							`;
						}
					}
				]}
				isLoading={isLoading}
				totalRows={totalRows}
				currentPage={filtros.pagina}
				pageSize={POR_PAGINA}
				selectable={true}
				selectedIds={selectedIds}
				onSelectionChange={handleSelectionChange}
				onPageChange={handlePageChange}
				onSortChange={handleSort}
				onAction={(action, row) => {
					const f = row as FormularioWithStatus;
					if (!f?.id) return;
					if (action === 'view') {
						goto(`/dashboard/asistencias/${f.id}/respuestas`);
					} else if (action === 'copy') {
						copiarEnlace(f);
					} else if (action === 'edit') {
						openEditModal(f);
					} else if (action === 'toggle') {
						toggleActivo(f);
					} else if (action === 'delete') {
						eliminarFormulario(f);
					}
				}}
				emptyMessage={filtros.q || filtros.estado !== 'all' ? 'Sin resultados para los filtros aplicados' : 'No hay formularios creados'}
				emptyActionLabel={!filtros.q && filtros.estado === 'all' ? 'Crear primer formulario' : undefined}
				onEmptyAction={openCreateModal}
			/>
		</div>

		<div class="mobile-only">
			{#if isLoading}
				<div class="empty" role="status">
					<div class="spinner"></div>
					<p>Cargando...</p>
				</div>
			{:else if formularios.length === 0}
				<div class="empty" role="status">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 11l3 3L22 4" />
						<path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
					</svg>
					<p>{filtros.q || filtros.estado !== 'all' ? 'Sin resultados para los filtros aplicados' : 'No hay formularios creados'}</p>
					{#if !filtros.q && filtros.estado === 'all'}
						<button class="btn-primary" onclick={openCreateModal}>
							Crear primer formulario
						</button>
					{/if}
				</div>
			{:else}
				<div class="cards-grid">
					{#each formularios as f (f.id)}
						<div class="m-card" onclick={() => goto(`/dashboard/asistencias/${f.id}/respuestas`)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && goto(`/dashboard/asistencias/${f.id}/respuestas`)}>
							<div class="m-card-header">
								<div class="m-card-title-row">
									<span class="m-card-title">{f.tematica}</span>
									{#if f.activo}
										<span class="status-badge active">Activo</span>
									{:else}
										<span class="status-badge inactive">Inactivo</span>
									{/if}
								</div>
								{#if f.objetivo}
									<p class="m-card-desc">{f.objetivo}</p>
								{/if}
								<span class="badge-tipo">{getTipoEventoLabel(f.tipo_evento, f.tipo_evento_otro)}</span>
							</div>
							<div class="m-card-info">
								<div class="m-info-row">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
										<line x1="16" y1="2" x2="16" y2="6" />
										<line x1="8" y1="2" x2="8" y2="6" />
										<line x1="3" y1="10" x2="21" y2="10" />
									</svg>
									<span>{formatFecha(f.fecha)}</span>
								</div>
								{#if f.lugar_sede}
									<div class="m-info-row">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
											<circle cx="12" cy="10" r="3" />
										</svg>
										<span>{f.lugar_sede}</span>
									</div>
								{/if}
								<div class="m-info-row">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M9 11l3 3L22 4" />
										<path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
									</svg>
									<span class="num-badge blue">{f._count?.respuestas || 0} respuestas</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if selectedIds.size > 0}
		<div class="bulk-bar" in:fade={{ duration: 200 }} role="region" aria-label="Acciones en lote">
			<div class="bulk-info">
				<span class="bulk-count">{selectedIds.size}</span>
				<span class="bulk-text">seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
			</div>
			<div class="bulk-divider"></div>
			<button class="bulk-btn bulk-btn-primary" onclick={descargarSeleccionados} disabled={isDownloading}>
				{#if isDownloading && progressJobId?.startsWith('sel-')}
					<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 12a9 9 0 11-6.219-8.56" />
					</svg>
					Generando ZIP...
				{:else}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					Descargar ZIP
				{/if}
			</button>
			<button class="bulk-btn bulk-btn-ghost" onclick={limpiarSeleccion} aria-label="Cancelar selección">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		</div>
	{/if}
</div>

<ModalFormularioAsistencia
	bind:isOpen={showModalForm}
	bind:formularioEdit
	on:save={handleFormularioSaved}
/>

<ModalConfirm
	bind:isOpen={showModalDelete}
	title="¿Eliminar formulario?"
	message={formularioToDelete
		? `Se eliminará permanentemente el formulario "${formularioToDelete.tematica}" y todas sus ${formularioToDelete._count?.respuestas || 0} respuestas asociadas. Esta acción no se puede deshacer.`
		: ''}
	confirmText="Eliminar"
	cancelText="Cancelar"
	type="danger"
	isLoading={isDeletingFormulario}
	on:confirm={confirmarEliminarFormulario}
	on:cancel={() => {
		showModalDelete = false;
		formularioToDelete = null;
	}}
/>

<style>
	.dash-wrapper {
		--surface: #fff;
		--surface-hover: #faf7f2;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--border-hover: rgba(0, 0, 0, 0.2);
		--text-primary: #0f1f1a;
		--text-secondary: #4a4a4a;
		--text-muted: #6b6b6b;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: rgba(249, 115, 22, 0.08);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}

	.dash {
		padding: 2rem 2.5rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.logo-mark {
		width: 44px;
		height: 44px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #fff;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}

	.eyebrow {
		display: inline-block;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent-hover);
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		margin-bottom: 0.35rem;
	}

	h1 {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.45rem;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.015em;
		line-height: 1.2;
	}

	.header-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-top: 0.2rem;
		line-height: 1.45;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.55rem 1rem;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
		font-family: inherit;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}

	.btn-primary:active {
		transform: translateY(0);
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.55rem 0.9rem;
		background: var(--surface);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
		font-family: inherit;
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--surface-hover);
		border-color: var(--border-hover);
	}

	.btn-secondary:active:not(:disabled) {
		transform: translateY(0.5px);
	}

	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.spin {
		animation: spin 0.8s linear infinite;
	}

	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.55rem 0.9rem;
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
		font-family: inherit;
	}

	.btn-ghost:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--text-primary);
		border-color: var(--border-hover);
	}

	.btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Bulk actions bar */
	.bulk-bar {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem 0.6rem 1rem;
		background: rgba(15, 31, 26, 0.96);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 14px;
		box-shadow: 0 12px 40px rgba(15, 31, 26, 0.25);
		color: #f0ede6;
		z-index: 40;
	}

	.bulk-info {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.bulk-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 8px;
		font-family: 'Geist', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--accent, #f97316);
		color: #fff;
		border-radius: 11px;
	}

	.bulk-text {
		font-size: 0.8rem;
		font-weight: 500;
		color: rgba(240, 237, 230, 0.85);
	}

	.bulk-divider {
		width: 1px;
		height: 22px;
		background: rgba(255, 255, 255, 0.12);
	}

	.bulk-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
		font-family: inherit;
	}

	.bulk-btn-primary {
		background: var(--accent, #f97316);
		color: #fff;
	}

	.bulk-btn-primary:hover:not(:disabled) {
		background: var(--accent-hover, #ea580c);
	}

	.bulk-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.bulk-btn-ghost {
		background: transparent;
		color: rgba(240, 237, 230, 0.65);
		padding: 0.45rem;
	}

	.bulk-btn-ghost:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.search-wrap {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 200px;
		max-width: 400px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--text-muted);
		pointer-events: none;
	}

	.search-wrap input {
		width: 100%;
		padding: 0.55rem 0.85rem 0.55rem 2.25rem;
		font-size: 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--text-primary);
		font-family: inherit;
		outline: none;
		transition: all 0.2s var(--ease);
	}

	.search-wrap input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	.search-wrap input::placeholder {
		color: var(--text-muted);
	}

	.pills {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		font-family: 'Geist', monospace;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 999px;
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}

	.pill:hover {
		background: var(--surface-hover);
		border-color: var(--border-hover);
	}

	.pill-active {
		background: var(--accent-bg);
		color: var(--accent-hover);
		border-color: rgba(249, 115, 22, 0.3);
	}

	.pill-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 16px;
		padding: 0 5px;
		font-size: 0.65rem;
		font-weight: 700;
		background: rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		font-family: 'Geist', monospace;
	}

	.pill-active .pill-count {
		background: rgba(249, 115, 22, 0.2);
		color: var(--accent-hover);
	}

	.results-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.reset-btn {
		background: none;
		border: none;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		font-family: inherit;
		transition: color 0.2s var(--ease);
	}

	.reset-btn:hover {
		color: var(--accent-hover);
	}

	/* Cell styles */
	:global(.cell-tematica) {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	:global(.cell-lugar) {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}

	:global(.td-title) {
		font-weight: 600;
		color: var(--text-primary);
	}

	:global(.td-desc) {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
		max-width: 280px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.td-date) {
		color: var(--text-muted);
		font-size: 12px;
	}

	:global(.text-muted) {
		color: var(--text-muted);
	}

	:global(.num-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 22px;
		padding: 0 8px;
		font-family: 'Geist', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--accent-bg);
		color: var(--accent-hover);
		border-radius: 6px;
	}

	:global(.num-badge.blue) {
		background: rgba(59, 130, 246, 0.08);
		color: #1d4ed8;
	}

	:global(.badge-tipo) {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		background: rgba(109, 40, 217, 0.08);
		color: #5b21b6;
		border-radius: 5px;
		align-self: flex-start;
		margin-top: 0.25rem;
	}

	:global(.status-badge) {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 999px;
	}

	:global(.status-badge.active) {
		background: var(--accent-bg);
		color: var(--accent-hover);
	}

	:global(.status-badge.active)::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
	}

	:global(.status-badge.inactive) {
		background: rgba(0, 0, 0, 0.05);
		color: var(--text-muted);
	}

	:global(.status-badge.inactive)::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-very-muted, #9a9a9a);
	}

	:global(.actions-wrap) {
		display: inline-flex;
		gap: 0.25rem;
	}

	:global(.action-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}

	:global(.action-btn.view) { background: rgba(37, 99, 235, 0.08); color: #1d4ed8; }
	:global(.action-btn.view:hover) { background: rgba(37, 99, 235, 0.16); }
	:global(.action-btn.copy) { background: rgba(109, 40, 217, 0.08); color: #5b21b6; }
	:global(.action-btn.copy:hover) { background: rgba(109, 40, 217, 0.16); }
	:global(.action-btn.edit) { background: rgba(217, 119, 6, 0.08); color: #b45309; }
	:global(.action-btn.edit:hover) { background: rgba(217, 119, 6, 0.16); }
	:global(.action-btn.pause) { background: rgba(234, 88, 12, 0.08); color: #c2410c; }
	:global(.action-btn.pause:hover) { background: rgba(234, 88, 12, 0.16); }
	:global(.action-btn.play) { background: var(--accent-bg); color: var(--accent-hover); }
	:global(.action-btn.play:hover) { background: rgba(249, 115, 22, 0.16); }
	:global(.action-btn.delete) { background: rgba(220, 38, 38, 0.06); color: #b91c1c; }
	:global(.action-btn.delete:hover) { background: rgba(220, 38, 38, 0.14); }

	/* Empty & spinner */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 4rem 1.25rem;
		text-align: center;
		color: var(--text-muted);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
	}

	.empty svg {
		color: rgba(0, 0, 0, 0.15);
	}

	.empty p {
		font-size: 0.85rem;
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(249, 115, 22, 0.15);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Responsive */
	.desktop-only { display: block; }
	.mobile-only { display: none; }

	@media (max-width: 767px) {
		.dash {
			padding: 1.25rem 1rem 2rem;
		}
		.desktop-only { display: none; }
		.mobile-only { display: block; }
	}

	/* Mobile cards */
	.cards-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.m-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1rem 1.1rem;
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}

	.m-card:hover {
		border-color: rgba(249, 115, 22, 0.3);
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.08);
	}

	.m-card-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.m-card-title {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
		flex: 1;
		letter-spacing: -0.005em;
	}

	.m-card-desc {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0 0 0.4rem;
		line-height: 1.45;
	}

	.m-card-info {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.7rem;
		margin-top: 0.7rem;
		border-top: 1px solid var(--border);
	}

	.m-info-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	.m-info-row svg {
		color: var(--text-muted);
		flex-shrink: 0;
	}
</style>
