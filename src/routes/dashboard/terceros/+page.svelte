<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { tercerosAPI, type Tercero, type TerceroPagination, type TerceroCounts } from '$lib/api/terceros';

	const REGIMENES: Record<string, string> = {
		SIMPLIFICADO: 'Simplificado',
		COMUN: 'Común',
		GRAN_CONTRIBUYENTE: 'Gran Contribuyente',
		NO_RESPONSABLE: 'No Responsable',
		AUTORRETENEDOR: 'Autorretenedor',
		ORDINARIO: 'Ordinario',
	};

	let terceros: Tercero[] = [];
	let pagination: TerceroPagination = { page: 1, limit: 20, total: 0, pages: 0, hasNext: false, hasPrev: false };
	let counts: TerceroCounts = { total: 0, personas: 0, empresas: 0 };
	let isLoading = false;
	let error: string | null = null;
	let searchTerm = '';
	let filtroTipo: 'TODOS' | 'PERSONA' | 'EMPRESA' = 'TODOS';
	let searchTimeout: ReturnType<typeof setTimeout>;

	let sortBy = 'nombre_completo';
	let sortOrder: 'asc' | 'desc' = 'asc';

	let showModal = false;
	let editingTercero: Tercero | null = null;
	let isSaving = false;
	let modalError: string | null = null;

	let form = resetForm();

	function resetForm() {
		return {
			nombre_completo: '',
			identificacion: '',
			telefono: '',
			correo: '',
			direccion: '',
			tipo_persona: 'PERSONA' as 'PERSONA' | 'EMPRESA',
			regimen: '' as string,
			notas: '',
		};
	}

	let showDeleteModal = false;
	let terceroToDelete: Tercero | null = null;

	let showImportModal = false;
	let isImporting = false;
	let importResult: { importados: number; duplicados: number; total: number } | null = null;

	$: hasActiveFilter = searchTerm.trim() !== '' || filtroTipo !== 'TODOS';
	$: { if (typeof searchTerm === 'string') handleSearch(); }

	onMount(() => { loadTerceros(); });

	async function loadTerceros(page = 1) {
		isLoading = true; error = null;
		try {
			const params: any = { page, limit: pagination.limit, sortBy, sortOrder };
			if (searchTerm?.trim()) params.search = searchTerm.trim();
			if (filtroTipo !== 'TODOS') params.tipo_persona = filtroTipo;
			const response = await tercerosAPI.listar(params);
			terceros = response.data || [];
			if (response.pagination) pagination = response.pagination;
			if (response.counts) counts = response.counts;
		} catch (err: any) {
			error = err.response?.data?.message || err.message || 'Error al cargar terceros';
		} finally { isLoading = false; }
	}

	function handleSearch() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => { pagination.page = 1; loadTerceros(1); }, 400);
	}

	function handleFilterChange() { pagination.page = 1; loadTerceros(1); }
	function clearFilters() { searchTerm = ''; filtroTipo = 'TODOS'; loadTerceros(1); }

	function toggleSort(field: string) {
		if (sortBy === field) { sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; }
		else { sortBy = field; sortOrder = 'asc'; }
		pagination.page = 1; loadTerceros(1);
	}

	function goToPage(page: number) { if (page >= 1 && page <= pagination.pages && page !== pagination.page) loadTerceros(page); }
	function previousPage() { if (pagination.hasPrev) goToPage(pagination.page - 1); }
	function nextPage() { if (pagination.hasNext) goToPage(pagination.page + 1); }

	function getPageNumbers(): (number | string)[] {
		const pages: (number | string)[] = [];
		const current = pagination.page; const total = pagination.pages;
		if (total <= 7) { for (let i = 1; i <= total; i++) pages.push(i); return pages; }
		pages.push(1);
		let start = Math.max(2, current - 2); let end = Math.min(total - 1, current + 2);
		if (current <= 4) { start = 2; end = 5; }
		if (current >= total - 3) { start = total - 4; end = total - 1; }
		if (start > 2) pages.push('...');
		for (let i = start; i <= end; i++) pages.push(i);
		if (end < total - 1) pages.push('...');
		pages.push(total);
		return pages;
	}

	function openCreateModal() { editingTercero = null; form = resetForm(); modalError = null; showModal = true; }

	function openEditModal(t: Tercero) {
		editingTercero = t;
		form = { nombre_completo: t.nombre_completo, identificacion: t.identificacion || '', telefono: t.telefono || '', correo: t.correo || '', direccion: t.direccion || '', tipo_persona: t.tipo_persona, regimen: t.regimen || '', notas: t.notas || '' };
		modalError = null; showModal = true;
	}

	function closeModal() { showModal = false; editingTercero = null; modalError = null; }

	async function saveTercero() {
		if (!form.nombre_completo.trim()) { modalError = 'El nombre es requerido'; return; }
		isSaving = true; modalError = null;
		try {
			const payload: any = { nombre_completo: form.nombre_completo.trim(), identificacion: form.identificacion.trim() || null, telefono: form.telefono.trim() || null, correo: form.correo.trim() || null, direccion: form.direccion.trim() || null, tipo_persona: form.tipo_persona, regimen: form.regimen || null, notas: form.notas.trim() || null };
			if (editingTercero) { await tercerosAPI.actualizar(editingTercero.id, payload); }
			else { await tercerosAPI.crear(payload); }
			closeModal(); loadTerceros(pagination.page);
		} catch (err: any) { modalError = err.response?.data?.message || err.message || 'Error al guardar'; }
		finally { isSaving = false; }
	}

	function openDeleteModal(t: Tercero, e: Event) { e.stopPropagation(); terceroToDelete = t; showDeleteModal = true; }
	function closeDeleteModal() { showDeleteModal = false; terceroToDelete = null; }

	async function deleteTercero() {
		if (!terceroToDelete) return;
		isLoading = true;
		try { await tercerosAPI.eliminar(terceroToDelete.id); closeDeleteModal(); loadTerceros(pagination.page); }
		catch (err: any) { error = err.response?.data?.message || err.message || 'Error al eliminar'; }
		finally { isLoading = false; }
	}

	function openImportModal() { importResult = null; showImportModal = true; }

	async function importFromVehiculos() {
		isImporting = true;
		try { importResult = await tercerosAPI.importarDesdeVehiculos(); loadTerceros(1); }
		catch (err: any) { error = err.response?.data?.message || err.message || 'Error al importar'; showImportModal = false; }
		finally { isImporting = false; }
	}

	function formatDate(d: string) { return new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' }); }
	function getTipoColor(tipo: string) { return tipo === 'EMPRESA' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'; }
</script>

<svelte:head>
	<title>Directorio de Terceros - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen space-y-5 p-6">

	<!-- ── HEADER ── -->
	<div class="flex flex-col items-start justify-between gap-4 rounded-2xl border border-orange-100 bg-orange-50 p-6 lg:flex-row lg:items-center" in:fade={{ duration: 400 }}>
		<div class="flex items-center gap-4">
			<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500 shadow-md">
				<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
				</svg>
			</div>
			<div>
				<h1 class="text-xl font-bold text-gray-900">Directorio de Terceros</h1>
				<p class="text-sm text-gray-500">Propietarios de vehículos, personas y empresas</p>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<span class="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
				<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span> {counts.total} Total
			</span>
			<span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> {counts.personas} Personas
			</span>
			<span class="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
				<span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span> {counts.empresas} Empresas
			</span>
			{#if hasActiveFilter}
				<span class="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
					{pagination.total} resultado{pagination.total !== 1 ? 's' : ''}
				</span>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-2">
			<button on:click={openImportModal} title="Importar desde vehículos" class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
				Importar
			</button>
			<button on:click={openCreateModal} class="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-shadow hover:bg-orange-600 hover:shadow-md">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
				Nuevo Tercero
			</button>
		</div>
	</div>

	<!-- ── FILTROS ── -->
	<div class="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center" in:fade={{ duration: 300, delay: 100 }}>
		<div class="relative flex-1">
			<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
			<input type="text" bind:value={searchTerm} placeholder="Buscar por nombre, identificación, teléfono, correo..." class="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm transition-colors focus:border-orange-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100" />
		</div>
		<select bind:value={filtroTipo} on:change={handleFilterChange} class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm transition-colors focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100">
			<option value="TODOS">Todos los tipos</option>
			<option value="PERSONA">Personas</option>
			<option value="EMPRESA">Empresas</option>
		</select>
		{#if searchTerm || filtroTipo !== 'TODOS'}
			<button on:click={clearFilters} class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50">
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				Limpiar
			</button>
		{/if}
	</div>

	<!-- ── TABLA ── -->
	{#if isLoading && terceros.length === 0}
		<div class="flex items-center justify-center py-20" in:fade>
			<div class="flex flex-col items-center gap-3">
				<div class="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent"></div>
				<p class="text-sm text-gray-500">Cargando terceros...</p>
			</div>
		</div>
	{:else if error && terceros.length === 0}
		<div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-red-100 bg-red-50 p-10" in:fade>
			<svg class="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
			<p class="text-sm font-medium text-red-700">{error}</p>
			<button on:click={() => loadTerceros()} class="rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-200">Reintentar</button>
		</div>
	{:else if terceros.length === 0}
		<div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-gray-100 bg-white p-16" in:fade>
			<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
				<svg class="h-8 w-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
			</div>
			<div class="text-center">
				<h3 class="text-base font-semibold text-gray-900">No hay terceros registrados</h3>
				<p class="mt-1 text-sm text-gray-500">Puedes crear uno nuevo o importar desde los vehículos</p>
			</div>
			<div class="flex gap-2">
				<button on:click={openImportModal} class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Importar desde Vehículos</button>
				<button on:click={openCreateModal} class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Nuevo Tercero</button>
			</div>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm" in:fade={{ duration: 300, delay: 150 }}>
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-gray-100 bg-gray-50/50">
							{#each [
								{ field: 'nombre_completo', label: 'Nombre' },
								{ field: 'identificacion', label: 'Identificación' },
								{ field: 'tipo_persona', label: 'Tipo' },
								{ field: 'regimen', label: 'Régimen' },
								{ field: 'telefono', label: 'Teléfono' },
							] as col}
								<th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
									<button on:click={() => toggleSort(col.field)} class="group inline-flex items-center gap-1 hover:text-gray-700">
										{col.label}
										<span class="transition-colors {sortBy === col.field ? 'text-orange-500' : 'text-gray-300 group-hover:text-gray-400'}">
											{#if sortBy === col.field && sortOrder === 'desc'}
												<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
											{:else}
												<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
											{/if}
										</span>
									</button>
								</th>
							{/each}
							<th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 lg:table-cell">
								<button on:click={() => toggleSort('correo')} class="group inline-flex items-center gap-1 hover:text-gray-700">
									Correo
									<span class="transition-colors {sortBy === 'correo' ? 'text-orange-500' : 'text-gray-300 group-hover:text-gray-400'}">
										{#if sortBy === 'correo' && sortOrder === 'desc'}
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
										{:else}
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
										{/if}
									</span>
								</button>
							</th>
							<th class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-50">
						{#each terceros as t, idx (t.id)}
							<tr class="group transition-colors hover:bg-orange-50/30" in:fly={{ y: 10, duration: 200, delay: idx * 30 }}>
								<td class="px-4 py-3">
									<div class="flex items-center gap-3">
										<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {t.tipo_persona === 'EMPRESA' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'} text-sm font-bold">
											{t.tipo_persona === 'EMPRESA' ? '🏢' : '👤'}
										</div>
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold text-gray-900">{t.nombre_completo}</p>
											{#if t.direccion}<p class="truncate text-xs text-gray-400">{t.direccion}</p>{/if}
										</div>
									</div>
								</td>
								<td class="px-4 py-3 text-sm text-gray-600 font-mono">{t.identificacion || '—'}</td>
								<td class="px-4 py-3">
									<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold {getTipoColor(t.tipo_persona)}">
										{t.tipo_persona === 'EMPRESA' ? 'Empresa' : 'Persona'}
									</span>
								</td>
								<td class="px-4 py-3 text-sm text-gray-600">{t.regimen ? REGIMENES[t.regimen] || t.regimen : '—'}</td>
								<td class="px-4 py-3 text-sm text-gray-600">{t.telefono || '—'}</td>
								<td class="hidden px-4 py-3 text-sm text-gray-600 lg:table-cell">
									{#if t.correo}
										<a href="mailto:{t.correo}" class="text-orange-600 hover:underline">{t.correo}</a>
									{:else}<span class="text-gray-400">—</span>{/if}
								</td>
								<td class="px-4 py-3 text-center">
									<div class="flex items-center justify-center gap-1">
										<button on:click={() => openEditModal(t)} title="Editar" class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-orange-100 hover:text-orange-600">
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
										</button>
										<button on:click={(e) => openDeleteModal(t, e)} title="Eliminar" class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600">
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if pagination.pages > 1}
				<div class="flex items-center justify-between border-t border-gray-100 bg-gray-50/30 px-4 py-3">
					<p class="text-xs text-gray-500">Mostrando {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}</p>
					<div class="flex items-center gap-1">
						<button on:click={previousPage} disabled={!pagination.hasPrev} aria-label="Anterior" class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 disabled:opacity-40">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
						</button>
						{#each getPageNumbers() as p}
							{#if typeof p === 'number'}
								<button on:click={() => goToPage(p)} class="min-w-[32px] rounded-lg px-2 py-1 text-xs font-medium transition-colors {p === pagination.page ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-200'}">{p}</button>
							{:else}<span class="px-1 text-xs text-gray-400">…</span>{/if}
						{/each}
						<button on:click={nextPage} disabled={!pagination.hasNext} aria-label="Siguiente" class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 disabled:opacity-40">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- ═══ MODAL: Crear / Editar Tercero ═══ -->
{#if showModal}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" on:click={closeModal} transition:fade={{ duration: 200 }}>
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" on:click|stopPropagation transition:fly={{ y: 30, duration: 250 }}>
			<button on:click={closeModal} aria-label="Cerrar" class="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
			</button>
			<h2 class="mb-5 text-lg font-bold text-gray-900">{editingTercero ? 'Editar Tercero' : 'Nuevo Tercero'}</h2>
			{#if modalError}<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{modalError}</div>{/if}
			<form on:submit|preventDefault={saveTercero} class="space-y-4">
				<div>
					<label class="mb-1 block text-xs font-semibold text-gray-600">Tipo</label>
					<div class="flex gap-2">
						<button type="button" on:click={() => (form.tipo_persona = 'PERSONA')} class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {form.tipo_persona === 'PERSONA' ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}">👤 Persona</button>
						<button type="button" on:click={() => (form.tipo_persona = 'EMPRESA')} class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {form.tipo_persona === 'EMPRESA' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}">🏢 Empresa</button>
					</div>
				</div>
				<div>
					<label for="nombre" class="mb-1 block text-xs font-semibold text-gray-600">{form.tipo_persona === 'EMPRESA' ? 'Razón Social' : 'Nombre Completo'} *</label>
					<input id="nombre" type="text" bind:value={form.nombre_completo} required class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder={form.tipo_persona === 'EMPRESA' ? 'Ej: Transportes del Valle S.A.S.' : 'Ej: Juan Carlos Pérez'} />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="ident" class="mb-1 block text-xs font-semibold text-gray-600">{form.tipo_persona === 'EMPRESA' ? 'NIT' : 'Cédula'}</label>
						<input id="ident" type="text" bind:value={form.identificacion} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder={form.tipo_persona === 'EMPRESA' ? '900123456-1' : '12345678'} />
					</div>
					<div>
						<label for="regimen" class="mb-1 block text-xs font-semibold text-gray-600">Régimen Fiscal</label>
						<select id="regimen" bind:value={form.regimen} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100">
							<option value="">Sin especificar</option>
							{#each Object.entries(REGIMENES) as [key, label]}<option value={key}>{label}</option>{/each}
						</select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="tel" class="mb-1 block text-xs font-semibold text-gray-600">Teléfono</label>
						<input id="tel" type="tel" bind:value={form.telefono} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder="3201234567" />
					</div>
					<div>
						<label for="email" class="mb-1 block text-xs font-semibold text-gray-600">Correo</label>
						<input id="email" type="email" bind:value={form.correo} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder="correo@ejemplo.com" />
					</div>
				</div>
				<div>
					<label for="dir" class="mb-1 block text-xs font-semibold text-gray-600">Dirección</label>
					<input id="dir" type="text" bind:value={form.direccion} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder="Calle 15 #23-45, Ciudad" />
				</div>
				<div>
					<label for="notas" class="mb-1 block text-xs font-semibold text-gray-600">Notas</label>
					<textarea id="notas" bind:value={form.notas} rows="2" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" placeholder="Observaciones adicionales..."></textarea>
				</div>
				<div class="flex justify-end gap-2 pt-2">
					<button type="button" on:click={closeModal} class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
					<button type="submit" disabled={isSaving} class="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-shadow hover:bg-orange-600 hover:shadow-md disabled:opacity-60">
						{#if isSaving}
							<span class="inline-flex items-center gap-2"><svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75" /></svg>Guardando...</span>
						{:else}{editingTercero ? 'Actualizar' : 'Crear'}{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ═══ MODAL: Confirmar Eliminación ═══ -->
{#if showDeleteModal && terceroToDelete}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" on:click={closeDeleteModal} transition:fade={{ duration: 200 }}>
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" on:click|stopPropagation transition:fly={{ y: 20, duration: 200 }}>
			<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
				<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
			</div>
			<h3 class="text-base font-bold text-gray-900">Eliminar tercero</h3>
			<p class="mt-2 text-sm text-gray-600">¿Estás seguro que deseas eliminar a <strong>{terceroToDelete.nombre_completo}</strong>?</p>
			<div class="mt-5 flex justify-end gap-2">
				<button on:click={closeDeleteModal} class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
				<button on:click={deleteTercero} class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Eliminar</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ MODAL: Importar desde Vehículos ═══ -->
{#if showImportModal}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" on:click={() => (showImportModal = false)} transition:fade={{ duration: 200 }}>
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" on:click|stopPropagation transition:fly={{ y: 20, duration: 200 }}>
			{#if importResult}
				<div class="text-center">
					<div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
						<svg class="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
					</div>
					<h3 class="text-base font-bold text-gray-900">Importación completada</h3>
					<div class="mt-3 space-y-1 text-sm text-gray-600">
						<p><strong>{importResult.importados}</strong> terceros importados</p>
						<p><strong>{importResult.duplicados}</strong> ya existían (omitidos)</p>
					</div>
					<button on:click={() => (showImportModal = false)} class="mt-5 w-full rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Cerrar</button>
				</div>
			{:else}
				<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
					<svg class="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
				</div>
				<h3 class="text-base font-bold text-gray-900">Importar desde Vehículos</h3>
				<p class="mt-2 text-sm text-gray-600">Se extraerán los nombres y cédulas de los propietarios registrados en la flota vehicular y se crearán como terceros. Los duplicados serán omitidos.</p>
				<div class="mt-5 flex justify-end gap-2">
					<button on:click={() => (showImportModal = false)} class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
					<button on:click={importFromVehiculos} disabled={isImporting} class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
						{#if isImporting}
							<span class="inline-flex items-center gap-2"><svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75" /></svg>Importando...</span>
						{:else}Importar{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
