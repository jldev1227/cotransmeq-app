<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import {
		asistenciasAPI,
		type FormularioAsistencia,
		type RespuestaAsistencia
	} from '$lib/api/asistencias';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import { socketUtils } from '$lib/socket';

	let formularioId = '';
	let formulario: FormularioAsistencia | null = null;
	let respuestas: RespuestaAsistencia[] = [];
	let isLoading = true;

	// Filtros
	let searchQuery = '';
	let sortBy: 'fecha' | 'nombre' | 'documento' = 'fecha';
	let sortOrder: 'asc' | 'desc' = 'desc';

	// Signature modal
	let selectedSignature = '';
	let showSignatureModal = false;

	// Edit modal
	let showEditModal = false;

	// Delete
	let selectedIds = new Set<string>();
	let showDeleteModal = false;
	let deleting = false;

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
		selectedIds = new Set(selectedIds);
	}
	function toggleSelectAll() {
		if (selectedIds.size === respuestasOrdenadas.length) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(respuestasOrdenadas.map((r) => r.id));
		}
	}
	function abrirDeleteModal() {
		showDeleteModal = true;
	}
	function cerrarDeleteModal() {
		showDeleteModal = false;
	}
	async function confirmarEliminar() {
		if (selectedIds.size === 0) return;
		deleting = true;
		try {
			await asistenciasAPI.eliminarRespuestas([...selectedIds]);
			respuestas = respuestas.filter((r) => !selectedIds.has(r.id));
			toast.success(`${selectedIds.size} respuesta(s) eliminada(s)`);
			selectedIds = new Set();
			showDeleteModal = false;
		} catch (error: any) {
			toast.error(error.message || 'Error al eliminar');
		} finally {
			deleting = false;
		}
	}

	// Socket listener
	const onRespuestaCreated = ({ respuesta, formularioId: formId }: any) => {
		if (formId === formularioId) {
			respuestas = [respuesta, ...respuestas];
			toast.success('Nueva respuesta recibida en tiempo real');
		}
	};

	onMount(async () => {
		formularioId = $page.params.id ?? '';
		await cargarDatos();
		setupSocketListener();
	});

	onDestroy(() => {
		cleanupSocketListener();
	});

	function setupSocketListener() {
		socketUtils.on('asistencias:respuesta:created', onRespuestaCreated);
	}

	function cleanupSocketListener() {
		socketUtils.off('asistencias:respuesta:created', onRespuestaCreated);
	}

	async function cargarDatos() {
		isLoading = true;
		try {
			const [formData, respuestasData] = await Promise.all([
				asistenciasAPI.obtenerFormulario(formularioId),
				asistenciasAPI.obtenerRespuestas(formularioId)
			]);

			formulario = formData;
			respuestas = respuestasData;
		} catch (error: any) {
			toast.error(error.message || 'Error al cargar los datos');
			goto('/dashboard/asistencias');
		} finally {
			isLoading = false;
		}
	}

	function volver() {
		goto('/dashboard/asistencias');
	}

	function verFirma(firma: string) {
		selectedSignature = firma;
		showSignatureModal = true;
	}

	function closeSignatureModal() {
		showSignatureModal = false;
		selectedSignature = '';
	}

	function openEditModal() {
		showEditModal = true;
	}

	function closeEditModal() {
		showEditModal = false;
	}

	async function handleFormularioUpdated(event: CustomEvent) {
		showEditModal = false;

		if (event.detail?.formulario) {
			formulario = { ...event.detail.formulario };
			toast.success('Formulario actualizado exitosamente');
		} else {
			await cargarDatos();
		}
	}

	function exportarCSV() {
		if (!respuestas.length) {
			toast.error('No hay respuestas para exportar');
			return;
		}

		const headers = [
			'Fecha',
			'Nombre Completo',
			'Documento',
			'Cargo',
			'Teléfono',
			'IP',
			'Navegador'
		];

		const rows = respuestasOrdenadas.map((r) => [
			new Date(r.created_at).toLocaleString('es-CO'),
			r.nombre_completo,
			r.numero_documento,
			r.cargo,
			r.numero_telefono,
			r.ip_address || '',
			r.user_agent || ''
		]);

		const csvContent =
			'data:text/csv;charset=utf-8,' +
			[headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
				'\n'
			);

		const encodedUri = encodeURI(csvContent);
		const link = document.createElement('a');
		link.setAttribute('href', encodedUri);
		link.setAttribute('download', `respuestas_${formulario?.tematica}_${Date.now()}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		toast.success('CSV exportado exitosamente');
	}

	async function exportarPDF() {
		if (!respuestas.length) {
			toast.error('No hay respuestas para exportar');
			return;
		}

		try {
			toast.loading('Generando PDF...');
			const blob = await asistenciasAPI.exportarPDF(formularioId);

			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute(
				'download',
				`asistencia_${formulario?.tematica.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`
			);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.success('PDF generado exitosamente');
		} catch (error: any) {
			toast.error(error.message || 'Error al generar el PDF');
		}
	}

	function formatFecha(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		return fecha.toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatFechaCorta(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		return fecha.toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
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

	$: respuestasFiltradas = respuestas.filter((r) => {
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return (
			r.nombre_completo.toLowerCase().includes(q) ||
			r.numero_documento.toLowerCase().includes(q) ||
			r.cargo.toLowerCase().includes(q)
		);
	});

	$: respuestasOrdenadas = [...respuestasFiltradas].sort((a, b) => {
		let comparison = 0;

		if (sortBy === 'fecha') {
			comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
		} else if (sortBy === 'nombre') {
			comparison = a.nombre_completo.localeCompare(b.nombre_completo);
		} else if (sortBy === 'documento') {
			comparison = a.numero_documento.localeCompare(b.numero_documento);
		}

		return sortOrder === 'asc' ? comparison : -comparison;
	});
</script>

<svelte:head>
	<title>Respuestas · {formulario?.tematica || 'Asistencias'} — Cotransmeq</title>
</svelte:head>

<div class="page" in:fade={{ duration: 300 }}>
	{#if isLoading}
		<div class="state-block" in:fade={{ duration: 200 }}>
			<span class="spinner-lg"></span>
			<p class="state-text">Cargando respuestas…</p>
		</div>
	{:else if formulario}
		<!-- ═══ HEADER ═══ -->
		<header class="page-header">
			<div class="page-header-inner">
				<div class="page-header-left">
					<button class="back-btn" on:click={volver} aria-label="Volver a asistencias">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
						<span>Volver</span>
					</button>
					<div class="page-titles">
						<span class="eyebrow">
							Respuestas · {getTipoEventoLabel(formulario.tipo_evento, formulario.tipo_evento_otro)}
						</span>
						<h1 class="page-title">{formulario.tematica}</h1>
						<p class="page-sub">
							{respuestas.length} {respuestas.length === 1 ? 'asistente registrado' : 'asistentes registrados'}
							{#if formulario.fecha}
								· <span class="meta-mono">{formatFechaCorta(formulario.fecha)}</span>
							{/if}
						</p>
					</div>
				</div>

				<div class="page-header-actions">
					{#if selectedIds.size > 0}
						<button class="btn-danger" on:click={abrirDeleteModal} in:fade={{ duration: 200 }}>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							Eliminar ({selectedIds.size})
						</button>
					{/if}
					<button class="btn-secondary" on:click={exportarCSV} aria-label="Exportar a Excel">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						Excel
					</button>
					<button class="btn-secondary" on:click={exportarPDF} aria-label="Exportar a PDF">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						PDF
					</button>
					<button class="btn-primary" on:click={openEditModal} aria-label="Editar formulario">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
						Editar
					</button>
				</div>
			</div>
		</header>

		<!-- ═══ Modal Confirmar Eliminación ═══ -->
		{#if showDeleteModal}
			<div
				class="modal-backdrop"
				on:click={cerrarDeleteModal}
				on:keydown={(e) => e.key === 'Escape' && cerrarDeleteModal()}
				role="button"
				tabindex="0"
				transition:fade={{ duration: 150 }}
			>
				<div
					class="modal"
					on:click|stopPropagation
					on:keydown|stopPropagation
					role="dialog"
					tabindex="0"
					in:fly={{ y: 24, duration: 250, easing: quintOut }}
				>
					<div class="modal-head">
						<div class="modal-icon">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
							</svg>
						</div>
						<div>
							<h3 class="modal-title">Eliminar respuestas</h3>
							<p class="modal-sub">Esta acción no se puede deshacer</p>
						</div>
					</div>
					<p class="modal-body">
						¿Estás seguro de que deseas eliminar
						<strong class="text-danger">{selectedIds.size}</strong>
						respuesta{selectedIds.size > 1 ? 's' : ''}? Se eliminarán permanentemente del sistema.
					</p>
					<div class="modal-actions">
						<button class="btn-secondary" on:click={cerrarDeleteModal} disabled={deleting}>
							Cancelar
						</button>
						<button class="btn-danger" on:click={confirmarEliminar} disabled={deleting}>
							{#if deleting}
								<span class="spinner-sm"></span>
								Eliminando…
							{:else}
								Eliminar
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- ═══ Signature Modal ═══ -->
		{#if showSignatureModal}
			<div
				class="modal-backdrop"
				on:click={closeSignatureModal}
				on:keydown={(e) => e.key === 'Escape' && closeSignatureModal()}
				role="button"
				tabindex="0"
				transition:fade={{ duration: 150 }}
			>
				<div
					class="modal modal--lg"
					on:click|stopPropagation
					on:keydown|stopPropagation
					role="dialog"
					tabindex="0"
					in:fly={{ y: 24, duration: 250, easing: quintOut }}
				>
					<div class="modal-head">
						<h3 class="modal-title">Firma Digital</h3>
						<button class="modal-close" on:click={closeSignatureModal} aria-label="Cerrar firma">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div class="firma-frame">
						<img src={selectedSignature} alt="Firma ampliada" draggable="false" />
					</div>
				</div>
			</div>
		{/if}

		<div class="page-body">
			<!-- ═══ INFO CARD ═══ -->
			<section class="info-card" in:fly={{ y: 16, duration: 400, easing: quintOut, delay: 80 }}>
				<div class="info-grid">
					<div class="info-item">
						<span class="info-label">Fecha</span>
						<span class="info-value">
							{new Date(formulario.fecha).toLocaleDateString('es-CO', {
								day: '2-digit',
								month: 'long',
								year: 'numeric'
							})}
						</span>
					</div>
					{#if formulario.hora_inicio || formulario.hora_finalizacion}
						<div class="info-item">
							<span class="info-label">Horario</span>
							<span class="info-value">
								{formulario.hora_inicio || '--:--'} – {formulario.hora_finalizacion || '--:--'}
								{#if formulario.duracion_minutos}
									<span class="meta-muted">
										· {Math.floor(formulario.duracion_minutos / 60)}h {formulario.duracion_minutos % 60}m
									</span>
								{/if}
							</span>
						</div>
					{/if}
					{#if formulario.lugar_sede}
						<div class="info-item">
							<span class="info-label">Lugar</span>
							<span class="info-value">{formulario.lugar_sede}</span>
						</div>
					{/if}
					{#if formulario.nombre_instructor}
						<div class="info-item">
							<span class="info-label">Instructor</span>
							<span class="info-value">{formulario.nombre_instructor}</span>
						</div>
					{/if}
					<div class="info-item">
						<span class="info-label">Estado</span>
						<span class="status-pill" class:status-active={formulario.activo} class:status-inactive={!formulario.activo}>
							{formulario.activo ? 'Activo' : 'Inactivo'}
						</span>
					</div>
					{#if formulario.creado_por}
						<div class="info-item">
							<span class="info-label">Creado por</span>
							<span class="info-value">{formulario.creado_por.nombre}</span>
						</div>
					{/if}
				</div>

				{#if formulario.objetivo}
					<div class="info-block">
						<span class="info-label">Objetivo</span>
						<p class="info-text">{formulario.objetivo}</p>
					</div>
				{/if}

				{#if formulario.observaciones}
					<div class="info-block">
						<span class="info-label">Observaciones</span>
						<p class="info-text">{formulario.observaciones}</p>
					</div>
				{/if}
			</section>

			<!-- ═══ FILTERS ═══ -->
			<section class="filter-bar" in:fly={{ y: 12, duration: 400, easing: quintOut, delay: 160 }}>
				<div class="search-wrap">
					<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="search"
						bind:value={searchQuery}
						placeholder="Buscar por nombre, documento o cargo…"
						aria-label="Buscar respuestas"
					/>
				</div>

				<div class="sort-wrap">
					<select bind:value={sortBy} class="select" aria-label="Ordenar por">
						<option value="fecha">Fecha</option>
						<option value="nombre">Nombre</option>
						<option value="documento">Documento</option>
					</select>
					<button
						class="sort-dir"
						on:click={() => (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')}
						title={sortOrder === 'asc' ? 'Ascendente' : 'Descendente'}
						aria-label="Cambiar dirección de orden"
					>
						<svg
							class="dir-icon"
							class:rotate={sortOrder === 'desc'}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
						</svg>
					</button>
				</div>

				<div class="results-pill">
					<span class="meta-mono">{respuestasOrdenadas.length}</span>
					<span>{respuestasOrdenadas.length === 1 ? 'resultado' : 'resultados'}</span>
				</div>
			</section>

			<!-- ═══ TABLE / CARDS ═══ -->
			{#if respuestasOrdenadas.length === 0}
				<section class="empty-state" in:fade={{ duration: 250 }}>
					<div class="empty-icon">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
					<h2 class="empty-title">
						{searchQuery ? 'Sin resultados' : 'Aún no hay respuestas'}
					</h2>
					<p class="empty-sub">
						{searchQuery
							? 'Intenta con otros términos de búsqueda.'
							: 'Las respuestas se mostrarán aquí en tiempo real.'}
					</p>
				</section>
			{:else}
				<!-- Desktop table -->
				<section class="table-card" in:fly={{ y: 16, duration: 400, easing: quintOut, delay: 220 }}>
					<div class="table-head">
						<div class="th th-check">
							<input
								type="checkbox"
								class="checkbox"
								checked={selectedIds.size > 0 &&
									selectedIds.size === respuestasOrdenadas.length}
								on:change={toggleSelectAll}
								aria-label="Seleccionar todas las respuestas"
							/>
						</div>
						<div class="th th-name">Nombre</div>
						<div class="th th-doc">Documento</div>
						<div class="th th-cargo">Cargo</div>
						<div class="th th-tel">Teléfono</div>
						<div class="th th-comite">Comité</div>
						<div class="th th-fecha">Fecha</div>
						<div class="th th-firma">Firma</div>
					</div>

					<div class="table-body">
						{#each respuestasOrdenadas as respuesta, i (respuesta.id)}
							<div
								class="tr"
								class:tr-selected={selectedIds.has(respuesta.id)}
								in:fly={{ y: 8, duration: 250, delay: Math.min(i, 8) * 18 }}
							>
								<div class="td td-check">
									<input
										type="checkbox"
										class="checkbox"
										checked={selectedIds.has(respuesta.id)}
										on:change={() => toggleSelect(respuesta.id)}
										aria-label="Seleccionar {respuesta.nombre_completo}"
									/>
								</div>
								<div class="td td-name">
									<span class="cell-strong">{respuesta.nombre_completo}</span>
								</div>
								<div class="td td-doc">
									<span class="meta-mono">{respuesta.numero_documento}</span>
								</div>
								<div class="td td-cargo">
									<span class="cell-soft">{respuesta.cargo}</span>
								</div>
								<div class="td td-tel">
									<span class="meta-mono">{respuesta.numero_telefono}</span>
								</div>
								<div class="td td-comite">
									{#if respuesta.pertenece_comite === true}
										<div class="comite-cell">
											<span class="status-pill status-active">Sí</span>
											{#if respuesta.nombre_comite}
												<span class="comite-name" title={respuesta.nombre_comite}>
													{respuesta.nombre_comite}
												</span>
											{/if}
										</div>
									{:else if respuesta.pertenece_comite === false}
										<span class="status-pill status-inactive">No</span>
									{:else}
										<span class="meta-muted">—</span>
									{/if}
								</div>
								<div class="td td-fecha">
									<span class="cell-soft">{formatFecha(respuesta.created_at)}</span>
								</div>
								<div class="td td-firma">
									<button
										class="firma-thumb"
										on:click={() => verFirma(respuesta.firma)}
										aria-label="Ver firma de {respuesta.nombre_completo}"
									>
										<img src={respuesta.firma} alt="Firma" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				</section>

				<!-- Mobile cards -->
				<section class="m-cards">
					{#each respuestasOrdenadas as respuesta, i (respuesta.id)}
						<article
							class="m-card"
							class:m-card-selected={selectedIds.has(respuesta.id)}
							in:fly={{ y: 8, duration: 250, delay: Math.min(i, 8) * 18 }}
						>
							<div class="m-card-head">
								<div class="m-card-left">
									<input
										type="checkbox"
										class="checkbox"
										checked={selectedIds.has(respuesta.id)}
										on:change={() => toggleSelect(respuesta.id)}
										aria-label="Seleccionar {respuesta.nombre_completo}"
									/>
									<div class="m-card-name-wrap">
										<h3 class="m-card-name">{respuesta.nombre_completo}</h3>
										<span class="m-card-date">{formatFecha(respuesta.created_at)}</span>
									</div>
								</div>
								<button class="firma-thumb firma-thumb--lg" on:click={() => verFirma(respuesta.firma)}>
									<img src={respuesta.firma} alt="Firma" />
								</button>
							</div>

							<dl class="m-card-dl">
								<div>
									<dt>Documento</dt>
									<dd class="meta-mono">{respuesta.numero_documento}</dd>
								</div>
								<div>
									<dt>Teléfono</dt>
									<dd class="meta-mono">{respuesta.numero_telefono}</dd>
								</div>
								<div class="full-row">
									<dt>Cargo</dt>
									<dd>{respuesta.cargo}</dd>
								</div>
								<div class="full-row">
									<dt>Comité</dt>
									<dd>
										{#if respuesta.pertenece_comite === true}
											<div class="comite-cell">
												<span class="status-pill status-active">Sí</span>
												{#if respuesta.nombre_comite}
													<span class="comite-name">{respuesta.nombre_comite}</span>
												{/if}
											</div>
										{:else if respuesta.pertenece_comite === false}
											<span class="status-pill status-inactive">No</span>
										{:else}
											<span class="meta-muted">No especificado</span>
										{/if}
									</dd>
								</div>
							</dl>
						</article>
					{/each}
				</section>
			{/if}
		</div>
	{/if}
</div>

<ModalFormularioAsistencia
	bind:isOpen={showEditModal}
	formularioEdit={formulario}
	on:close={closeEditModal}
	on:save={handleFormularioUpdated}
/>

<style>
	/* ═══════════════════════════════════════════════════
	   TOKENS — landing-transmeralda editorial
	   ═══════════════════════════════════════════════════ */
	.page {
		--bg: #faf7f2;
		--surface: #ffffff;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--border-hover: rgba(0, 0, 0, 0.2);
		--text-primary: #0f1f1a;
		--text-secondary: #4a4a4a;
		--text-muted: #6b6b6b;
		--text-very-muted: #9a9a9a;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: rgba(249, 115, 22, 0.08);
		--shadow-soft: 0 4px 24px rgba(0, 0, 0, 0.04);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

		min-height: 100vh;
		background: var(--bg);
		font-family: 'Inter', 'Geist', system-ui, sans-serif;
		color: var(--text-primary);
		-webkit-font-smoothing: antialiased;
	}

	/* ═══ Loading state ═══ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 6rem 1rem;
		color: var(--text-muted);
	}
	.state-text {
		font-size: 0.9rem;
		margin: 0;
	}
	.spinner-lg {
		width: 36px;
		height: 36px;
		border: 3px solid rgba(249, 115, 22, 0.15);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.spinner-sm {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		display: inline-block;
	}

	/* ═══ Header ═══ */
	.page-header {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 30;
	}
	.page-header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		flex-wrap: wrap;
	}
	.page-header-left {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex: 1;
		min-width: 0;
	}
	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem 0.4rem 0.4rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		flex-shrink: 0;
	}
	.back-btn svg {
		width: 14px;
		height: 14px;
	}
	.back-btn:hover {
		background: var(--surface);
		color: var(--accent-hover);
		border-color: rgba(249, 115, 22, 0.3);
	}

	.page-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.eyebrow {
		display: inline-block;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent-hover);
		background: var(--accent-bg);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		margin-bottom: 0.35rem;
		align-self: flex-start;
	}
	.page-title {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.4rem;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.015em;
		line-height: 1.2;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.page-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0.2rem 0 0;
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn-primary,
	.btn-secondary,
	.btn-danger {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.95rem;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #fff;
		border: none;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-primary svg {
		width: 14px;
		height: 14px;
	}

	.btn-secondary {
		background: var(--surface);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--bg);
		border-color: var(--border-hover);
	}
	.btn-secondary svg {
		width: 14px;
		height: 14px;
	}

	.btn-danger {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		border: 1px solid rgba(220, 38, 38, 0.25);
	}
	.btn-danger:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.14);
		border-color: rgba(220, 38, 38, 0.4);
	}
	.btn-danger svg {
		width: 14px;
		height: 14px;
	}

	/* ═══ Body ═══ */
	.page-body {
		padding: 1.5rem 1.5rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ═══ Info card ═══ */
	.info-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 1.25rem 1.4rem;
		box-shadow: var(--shadow-soft);
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.info-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.85rem 1.5rem;
	}
	@media (min-width: 640px) {
		.info-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (min-width: 1024px) {
		.info-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.info-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.info-label {
		font-family: 'Geist', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}
	.info-value {
		font-size: 0.88rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.info-block {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}
	.info-text {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.55;
		margin: 0;
	}
	.meta-mono {
		font-family: 'Geist', monospace;
		font-size: 0.85em;
		color: var(--text-primary);
	}
	.meta-muted {
		color: var(--text-very-muted);
		font-size: 0.78rem;
	}

	/* ═══ Status pill ═══ */
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 999px;
		align-self: flex-start;
	}
	.status-pill::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: 50%;
	}
	.status-active {
		background: var(--accent-bg);
		color: var(--accent-hover);
	}
	.status-active::before {
		background: var(--accent);
	}
	.status-inactive {
		background: rgba(0, 0, 0, 0.05);
		color: var(--text-muted);
	}
	.status-inactive::before {
		background: var(--text-very-muted);
	}

	/* ═══ Filters ═══ */
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow-soft);
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 200px;
	}
	.search-icon {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--text-very-muted);
		pointer-events: none;
	}
	.search-wrap input {
		width: 100%;
		padding: 0.55rem 0.85rem 0.55rem 2.4rem;
		font-size: 0.85rem;
		font-family: inherit;
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--text-primary);
		outline: none;
		transition: all 0.2s var(--ease);
	}
	.search-wrap input::placeholder {
		color: var(--text-very-muted);
	}
	.search-wrap input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	.sort-wrap {
		display: flex;
		gap: 0.3rem;
	}
	.select {
		padding: 0.55rem 0.85rem;
		font-size: 0.82rem;
		font-family: inherit;
		font-weight: 500;
		color: var(--text-primary);
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		cursor: pointer;
		outline: none;
		transition: all 0.2s var(--ease);
	}
	.select:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}
	.sort-dir {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}
	.sort-dir:hover {
		background: var(--bg);
		border-color: var(--border-hover);
		color: var(--text-primary);
	}
	.dir-icon {
		width: 16px;
		height: 16px;
		transition: transform 0.2s var(--ease);
	}
	.dir-icon.rotate {
		transform: rotate(180deg);
	}

	.results-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-muted);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.results-pill .meta-mono {
		font-weight: 700;
		color: var(--accent-hover);
	}

	/* ═══ Table ═══ */
	.table-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		box-shadow: var(--shadow-soft);
		overflow: hidden;
		display: none;
	}
	@media (min-width: 1024px) {
		.table-card {
			display: block;
		}
	}

	.table-head {
		display: grid;
		grid-template-columns: 40px 1.6fr 1fr 1.4fr 1fr 1.4fr 1.4fr 130px;
		gap: 0.85rem;
		padding: 0.75rem 1rem;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.th {
		font-family: 'Geist', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}
	.th-check {
		justify-content: center;
	}
	.th-firma {
		justify-content: center;
	}

	.table-body {
		display: flex;
		flex-direction: column;
	}
	.tr {
		display: grid;
		grid-template-columns: 40px 1.6fr 1fr 1.4fr 1fr 1.4fr 1.4fr 130px;
		gap: 0.85rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		transition: background-color 0.15s var(--ease);
		align-items: center;
	}
	.tr:last-child {
		border-bottom: none;
	}
	.tr:hover {
		background: rgba(249, 115, 22, 0.04);
	}
	.tr-selected {
		background: var(--accent-bg);
	}
	.td {
		display: flex;
		align-items: center;
		min-width: 0;
		font-size: 0.85rem;
	}
	.td-check {
		justify-content: center;
	}
	.td-firma {
		justify-content: center;
	}
	.cell-strong {
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-soft {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.comite-cell {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.comite-name {
		font-size: 0.72rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ═══ Checkbox ═══ */
	.checkbox {
		width: 16px;
		height: 16px;
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
		border: 1.5px solid rgba(0, 0, 0, 0.24);
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		position: relative;
		flex-shrink: 0;
	}
	.checkbox:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.checkbox:checked {
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		border-color: transparent;
	}
	.checkbox:checked::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 4px;
		width: 5px;
		height: 9px;
		border: solid #fff;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	/* ═══ Firma thumb ═══ */
	.firma-thumb {
		width: 110px;
		height: 50px;
		padding: 4px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s var(--ease);
	}
	.firma-thumb:hover {
		border-color: rgba(249, 115, 22, 0.3);
		background: var(--surface);
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.1);
	}
	.firma-thumb img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}
	.firma-thumb--lg {
		width: 80px;
		height: 56px;
	}

	/* ═══ Empty state ═══ */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 4rem 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		text-align: center;
		box-shadow: var(--shadow-soft);
	}
	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent-bg);
		color: var(--accent);
		margin-bottom: 0.3rem;
	}
	.empty-icon svg {
		width: 26px;
		height: 26px;
	}
	.empty-title {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
	}
	.empty-sub {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0;
		max-width: 360px;
	}

	/* ═══ Mobile cards ═══ */
	.m-cards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	@media (min-width: 1024px) {
		.m-cards {
			display: none;
		}
	}
	.m-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 0.95rem 1rem;
		box-shadow: var(--shadow-soft);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		transition: all 0.2s var(--ease);
	}
	.m-card-selected {
		border-color: rgba(249, 115, 22, 0.3);
		background: rgba(249, 115, 22, 0.03);
	}
	.m-card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.m-card-left {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		flex: 1;
		min-width: 0;
	}
	.m-card-left .checkbox {
		margin-top: 0.2rem;
	}
	.m-card-name-wrap {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.m-card-name {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.005em;
	}
	.m-card-date {
		font-family: 'Geist', monospace;
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-top: 0.15rem;
	}
	.m-card-dl {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.m-card-dl > div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.m-card-dl .full-row {
		grid-column: 1 / -1;
	}
	.m-card-dl dt {
		font-family: 'Geist', monospace;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}
	.m-card-dl dd {
		font-size: 0.85rem;
		color: var(--text-primary);
		margin: 0;
	}

	/* ═══ Modals ═══ */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(15, 31, 26, 0.55);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.modal {
		width: 100%;
		max-width: 440px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 1.5rem 1.5rem 1.25rem;
		box-shadow: 0 24px 64px rgba(15, 31, 26, 0.3);
	}
	.modal--lg {
		max-width: 720px;
	}
	.modal-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}
	.modal-head > div:first-child {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.modal-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		flex-shrink: 0;
	}
	.modal-icon svg {
		width: 22px;
		height: 22px;
	}
	.modal-title {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
	}
	.modal-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0.1rem 0 0;
	}
	.modal-body {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.55;
		margin: 0 0 1.25rem;
	}
	.text-danger {
		color: #b91c1c;
		font-weight: 700;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
	.modal-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}
	.modal-close:hover {
		background: var(--bg);
		color: var(--text-primary);
	}
	.modal-close svg {
		width: 14px;
		height: 14px;
	}

	.firma-frame {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.firma-frame img {
		max-width: 100%;
		max-height: 60vh;
		object-fit: contain;
		display: block;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.page-header-inner {
			padding: 0.85rem 1rem;
		}
		.page-body {
			padding: 1rem 1rem 2rem;
		}
		.page-title {
			font-size: 1.15rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tr,
		.btn-primary,
		.btn-secondary,
		.btn-danger,
		.checkbox,
		.firma-thumb,
		.back-btn {
			transition: none !important;
		}
		.tr {
			animation: none !important;
		}
	}
</style>
