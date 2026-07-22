<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import ModalFormVehiculo from '$lib/components/vehiculos/ModalFormVehiculo.svelte';
	import ModalConfirmDelete from '$lib/components/vehiculos/ModalConfirmDelete.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';

	interface Vehiculo {
		id: string;
		placa: string;
		marca: string;
		modelo: string;
		linea?: string;
		color?: string;
		estado: string;
		clase_vehiculo?: string;
		conductor_id?: string | null;
		conductores?: { id: string; nombre: string; apellido: string } | null;
		created_at?: string;
		oculto?: boolean;
	}

	let vehiculos: Vehiculo[] = [];
	let isLoading = true;
	let error: string | null = null;
	let searchTerm = '';
	let estadoFilter = 'todos';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let mostrarFiltros = false;
	let mostrarOcultos = false;
	let showDeleted = false;
	let vehiculosEliminados: Vehiculo[] = [];

	let isModalOpen = false;
	let selectedVehiculoId: string | null = null;
	let isDeleteModalOpen = false;
	let vehiculoToDelete: Vehiculo | null = null;

	// Estados para modo selección
	let vehiculosSeleccionados = new Set<string>();
	let ultimoSeleccionadoIndex: number | null = null;
	let shiftPressed = false;
	let procesandoMasivo = false;

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = true;
	}

	function handleKeyup(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = false;
	}

	function toggleSeleccion(id: string, index: number, event: MouseEvent | TouchEvent | any) {
		if (event.shiftKey && ultimoSeleccionadoIndex !== null) {
			const start = Math.min(ultimoSeleccionadoIndex, index);
			const end = Math.max(ultimoSeleccionadoIndex, index);

			const idsInRange = vehiculos.slice(start, end + 1).map((v) => v.id);
			const someNotSelected = idsInRange.some((id) => !vehiculosSeleccionados.has(id));

			if (someNotSelected) {
				idsInRange.forEach((id) => vehiculosSeleccionados.add(id));
			} else {
				idsInRange.forEach((id) => vehiculosSeleccionados.delete(id));
			}
		} else {
			if (vehiculosSeleccionados.has(id)) {
				vehiculosSeleccionados.delete(id);
			} else {
				vehiculosSeleccionados.add(id);
			}
			ultimoSeleccionadoIndex = index;
		}
		vehiculosSeleccionados = vehiculosSeleccionados;
	}

	function toggleSeleccionarTodo() {
		if (vehiculosSeleccionados.size === vehiculos.length && vehiculos.length > 0) {
			vehiculosSeleccionados.clear();
		} else {
			vehiculos.forEach((v) => vehiculosSeleccionados.add(v.id));
		}
		vehiculosSeleccionados = vehiculosSeleccionados;
	}

	async function ejecutarAccionMasiva(accion: 'ocultar' | 'mostrar' | 'eliminar' | 'restaurar') {
		if (vehiculosSeleccionados.size === 0) return;

		const ids = Array.from(vehiculosSeleccionados);
		procesandoMasivo = true;

		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/vehiculos/masivo`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${localStorage.getItem('token')}`
				},
				body: JSON.stringify({ ids, accion })
			});

			const data = await response.json();
			if (data.success) {
				toast.success(data.message);
				vehiculosSeleccionados.clear();
				vehiculosSeleccionados = vehiculosSeleccionados;
				loadVehiculos();
			} else {
				toast.error(data.message || 'Error al ejecutar acción masiva');
			}
		} catch (err) {
			toast.error('Error de conexión al ejecutar acción masiva');
		} finally {
			procesandoMasivo = false;
		}
	}

	$: isAdmin = $authStore.user?.rol === 'admin' || $authStore.user?.role === 'admin';
	$: isOperaciones = $authStore.user?.area?.includes('operaciones');
	$: isTalentoHumano = $authStore.user?.area?.includes('talento_humano');
	$: canAccessSpecialViews = isAdmin || isOperaciones || isTalentoHumano;

	// Filtros activos (para chips removibles) — solo los distintos del default
	const ESTADOS_LABELS: Record<string, string> = {
		disponible: 'Disponible',
		servicio: 'En Servicio',
		mantenimiento: 'Mantenimiento',
		inactivo: 'Inactivo'
	};
	$: activeFilters = [
		...(estadoFilter !== 'todos'
			? [{ key: 'estado', label: 'Estado', value: ESTADOS_LABELS[estadoFilter] ?? estadoFilter }]
			: []),
		...(mostrarOcultos ? [{ key: 'ocultos', label: 'Visibilidad', value: 'Ocultos' }] : []),
		...(showDeleted ? [{ key: 'papelera', label: 'Visibilidad', value: 'Papelera' }] : []),
		...(searchTerm.trim()
			? [{ key: 'search', label: 'Búsqueda', value: `"${searchTerm.trim()}"` }]
			: [])
	];

	function clearFilter(key: string) {
		if (key === 'estado') {
			estadoFilter = 'todos';
			loadVehiculos();
		}
		if (key === 'ocultos') {
			mostrarOcultos = false;
			loadVehiculos();
		}
		if (key === 'papelera') {
			showDeleted = false;
			loadVehiculos();
		}
		if (key === 'search') {
			searchTerm = '';
			loadVehiculos();
		}
	}

	$: stats = {
		total: vehiculos.length,
		disponible: vehiculos.filter((v) => ['DISPONIBLE', 'ACTIVO'].includes(v.estado?.toUpperCase()))
			.length,
		servicio: vehiculos.filter((v) => v.estado?.toUpperCase() === 'SERVICIO').length,
		mantenimiento: vehiculos.filter((v) => v.estado?.toUpperCase() === 'MANTENIMIENTO').length,
		inactivo: vehiculos.filter((v) => v.estado?.toUpperCase() === 'INACTIVO').length,
		noDisponible: vehiculos.filter((v) =>
			['NO_DISPONIBLE', 'NO DISPONIBLE'].includes(v.estado?.toUpperCase())
		).length
	};

	async function loadVehiculos() {
		isLoading = true;
		error = null;
		try {
			if (showDeleted) {
				const res = await vehiculosAPI.getDeleted();
				vehiculos = res.data.data || [];
				return;
			}

			const endpoint = mostrarOcultos ? '/api/vehiculos/ocultos' : '/api/vehiculos';
			const response = await (mostrarOcultos
				? fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
						headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
					}).then((r) => r.json())
				: vehiculosAPI.getAll());

			vehiculos = response.data?.data || response.data || [];
		} catch (err: any) {
			error = err.message || 'Error al cargar vehículos';
			if (error) toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function handleSearch() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => loadVehiculos(), 400);
	}

	function limpiarFiltros() {
		searchTerm = '';
		estadoFilter = 'todos';
		mostrarOcultos = false;
		showDeleted = false;
		loadVehiculos();
	}

	function getStatusColor(estado: string) {
		switch (estado?.toUpperCase()) {
			case 'DISPONIBLE':
			case 'ACTIVO':
				return '#f97316';
			case 'SERVICIO':
				return '#8b5cf6';
			case 'MANTENIMIENTO':
				return '#f59e0b';
			case 'INACTIVO':
				return '#6b7280';
			case 'NO_DISPONIBLE':
			case 'NO DISPONIBLE':
				return '#ef4444';
			default:
				return '#9ca3af';
		}
	}

	function openModal(id: string | null = null) {
		selectedVehiculoId = id;
		isModalOpen = true;
	}
	function openDeleteModal(v: Vehiculo) {
		vehiculoToDelete = v;
		isDeleteModalOpen = true;
	}

	onMount(() => {
		loadVehiculos();
		socketUtils.on('vehiculo-creado', loadVehiculos);
		socketUtils.on('vehiculo-actualizado', loadVehiculos);
		socketUtils.on('vehiculo-eliminado', loadVehiculos);
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);
	});

	onDestroy(() => {
		socketUtils.off('vehiculo-creado', loadVehiculos);
		socketUtils.off('vehiculo-actualizado', loadVehiculos);
		socketUtils.off('vehiculo-eliminado', loadVehiculos);
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('keyup', handleKeyup);
	});
</script>

<svelte:head>
	<title>Flota — Cotransmeq</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-4 p-6" in:fade={{ duration: 400 }}>
	<!-- ── HEADER (page-card editorial) ─────────────────────── -->
	<div class="page-card flex-shrink-0" style="padding: 1.25rem 1.5rem;">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex items-center gap-3">
				<div
					class="brand-gradient flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);"
				>
					<svg
						class="h-5 w-5 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Gestión de Flota
						</h1>
						<span
							class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
							style="background: rgba(249, 115, 22,0.08); color: var(--emerald-800);"
						>
							<span
								class="h-1.5 w-1.5 animate-pulse rounded-full"
								style="background-color: var(--emerald-500);"
							></span>
							En vivo
						</span>
					</div>
					<p class="text-xs" style="color: var(--text-muted);">
						Monitorea y administra todos los vehículos de la empresa
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<!-- Vistas Rápidas (Icon Buttons) -->
				{#if canAccessSpecialViews}
					<div class="mr-1 flex items-center gap-1">
						<button
							on:click={() => {
								mostrarOcultos = !mostrarOcultos;
								showDeleted = false;
								loadVehiculos();
							}}
							title={mostrarOcultos ? 'Ver Activos' : 'Ver Ocultos'}
							class="apple-transition btn-icon"
							style="border-color: {mostrarOcultos
								? 'var(--emerald-500)'
								: 'var(--border-default)'}; background-color: {mostrarOcultos
								? 'rgba(249, 115, 22,0.04)'
								: 'white'}; color: {mostrarOcultos ? 'var(--emerald-600)' : 'var(--text-muted)'};"
						>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							</svg>
						</button>
						<button
							on:click={() => {
								showDeleted = !showDeleted;
								mostrarOcultos = false;
								loadVehiculos();
							}}
							title={showDeleted ? 'Ver Activos' : 'Ver Papelera'}
							class="apple-transition btn-icon"
							style="border-color: {showDeleted
								? '#dc2626'
								: 'var(--border-default)'}; background-color: {showDeleted
								? 'rgba(220,38,38,0.04)'
								: 'white'}; color: {showDeleted ? '#dc2626' : 'var(--text-muted)'};"
						>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</button>
					</div>
				{/if}

				<div class="relative">
					<input
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Placa, marca…"
						class="input-glow apple-transition w-64 rounded-xl border py-2 pr-4 pl-9 text-sm"
						style="border-color: var(--border-default); background-color: var(--bg-surface); color: var(--text-primary);"
					/>
					<svg
						class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
						style="color: var(--text-very-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</div>
				<button
					on:click={() => (mostrarFiltros = !mostrarFiltros)}
					class="btn-secondary"
					style="border-color: {mostrarFiltros
						? 'var(--emerald-500)'
						: 'var(--border-default)'}; color: {mostrarFiltros
						? 'var(--emerald-700)'
						: 'var(--text-secondary)'}; background-color: {mostrarFiltros
						? 'rgba(249, 115, 22,0.04)'
						: 'white'};"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/>
					</svg>
					Filtros
				</button>
				<button on:click={() => openModal()} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Registrar Vehículo
				</button>
			</div>
		</div>

		<!-- Panel de filtros (drawer lateral) — siempre montado para que las
		     animaciones de entrada Y salida del FilterDrawer se ejecuten -->
		<FilterDrawer
			open={mostrarFiltros}
			onClose={() => (mostrarFiltros = false)}
			eyebrow="Filtros"
			title="Refinar resultados"
			subtitle="Filtra la flota de vehículos para encontrar lo que necesitas."
			activeCount={activeFilters.length}
		>
			<div slot="chips" class="flex flex-wrap gap-1.5">
				{#each activeFilters as chip, i (chip.key)}
					<span class="chip-pop-in" style="animation-delay: {i * 60}ms">
						<button class="filter-chip" on:click={() => clearFilter(chip.key)}>
							<span style="color: var(--text-muted); font-weight: 500;">{chip.label}:</span>
							<span>{chip.value}</span>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
						</button>
					</span>
				{/each}
			</div>

			<div class="flex flex-col gap-5">
				<div class="filter-field">
					<label for="filtro-estado" class="filter-field-label">
						Estado del vehículo
						{#if estadoFilter !== 'todos'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select id="filtro-estado" bind:value={estadoFilter} on:change={loadVehiculos}>
						<option value="todos">Todos los estados</option>
						<option value="disponible">Disponible</option>
						<option value="servicio">En Servicio</option>
						<option value="mantenimiento">Mantenimiento</option>
						<option value="inactivo">Inactivo</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-visibilidad" class="filter-field-label">
						Visibilidad
						{#if mostrarOcultos || showDeleted}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select
						id="filtro-visibilidad"
						value={mostrarOcultos ? 'ocultos' : showDeleted ? 'papelera' : 'todos'}
						on:change={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							mostrarOcultos = v === 'ocultos';
							showDeleted = v === 'papelera';
							loadVehiculos();
						}}
					>
						<option value="todos">Activos y ocultos</option>
						<option value="ocultos" disabled={!canAccessSpecialViews}>Solo ocultos</option>
						<option value="papelera" disabled={!canAccessSpecialViews}>Papelera</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por placa o marca
						{#if searchTerm.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-busqueda"
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Ej. ABC-123, Chevrolet…"
					/>
				</div>
			</div>

			<div slot="footer">
				<button
					class="filter-clear"
					on:click={limpiarFiltros}
					disabled={activeFilters.length === 0}
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
					Limpiar
				</button>
				<button class="btn-primary" on:click={() => (mostrarFiltros = false)}>
					Ver resultados
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" /></svg
					>
				</button>
			</div>
		</FilterDrawer>
	</div>

	<!-- ── STATS CARDS (radios 16, mono labels) ──────────────── -->
	<div
		class="grid flex-shrink-0 grid-cols-2 gap-3 lg:grid-cols-6"
		in:fly={{ y: 12, duration: 400, delay: 100 }}
	>
		<div class="stat-card">
			<p class="stat-label">Total</p>
			<p class="stat-value">{stats.total}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Disponibles</p>
			<p class="stat-value" style="color: var(--emerald-600);">{stats.disponible}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">En Servicio</p>
			<p class="stat-value" style="color: #8b5cf6;">{stats.servicio}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Mantenimiento</p>
			<p class="stat-value" style="color: #f59e0b;">{stats.mantenimiento}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Inactivos</p>
			<p class="stat-value" style="color: var(--text-muted);">{stats.inactivo}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Fuera Serv.</p>
			<p class="stat-value" style="color: #dc2626;">{stats.noDisponible}</p>
		</div>
	</div>

	<!-- ── TABLA (table-card editorial) ──────────────────────── -->
	<div
		class="table-card flex min-h-0 flex-1 flex-col {shiftPressed ? 'select-none' : ''}"
		in:fly={{ y: 12, duration: 400, delay: 150 }}
	>
		{#if isLoading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
				<p class="text-sm" style="color: var(--text-muted);">Cargando flota…</p>
			</div>
		{:else if vehiculos.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-2xl"
					style="background-color: var(--bg-base);"
				>
					<svg
						class="h-7 w-7"
						style="color: var(--text-very-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
					</svg>
				</div>
				<div class="text-center">
					<h3 class="mb-1 font-display text-lg" style="color: var(--bg-charcoal);">
						No hay vehículos
					</h3>
					<p class="text-sm" style="color: var(--text-muted);">No se encontraron resultados</p>
				</div>
				<button on:click={limpiarFiltros} class="btn-primary">Limpiar filtros</button>
			</div>
		{:else}
			<!-- Cards grid: 1 col mobile, 2 sm, 3 lg, 4 xl -->
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each vehiculos as v, index (v.id)}
						<article
							class="list-card"
							style="border-left: 4px solid {getStatusColor(v.estado)};
								background-color: {vehiculosSeleccionados.has(v.id)
								? 'rgba(249, 115, 22, 0.04)'
								: 'var(--bg-surface)'};
								border-color: {vehiculosSeleccionados.has(v.id) ? 'var(--emerald-500)' : 'var(--border-subtle)'};
								border-left-color: {getStatusColor(v.estado)};"
							in:fly={{ y: 8, duration: 200, delay: Math.min(index * 20, 200) }}
							on:click={(e) => toggleSeleccion(v.id, index, e)}
							role="button"
							tabindex="0"
						>
							<!-- Checkbox -->
							<div class="flex-shrink-0 pt-0.5">
								<input
									type="checkbox"
									checked={vehiculosSeleccionados.has(v.id)}
									on:click|stopPropagation={(e) => toggleSeleccion(v.id, index, e)}
									class="rounded text-orange-600 focus:ring-orange-500"
									style="border-color: var(--border-default);"
								/>
							</div>

							<!-- Contenido principal -->
							<div class="min-w-0 flex-1">
								<!-- Header: placa (mono) + status pill -->
								<div class="mb-1.5 flex items-start justify-between gap-2">
									<p
										class="font-mono-meta text-sm"
										style="color: var(--text-primary); letter-spacing: 0.08em;"
									>
										{v.placa}
									</p>
								</div>

								<!-- Marca + modelo (línea principal) -->
								<p class="text-sm leading-snug font-semibold" style="color: var(--text-primary);">
									{v.marca}
									{v.linea || ''}
								</p>
								<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">
									{v.modelo || '—'} · {v.color || '—'}{#if v.clase_vehiculo}
										· <span class="uppercase">{v.clase_vehiculo}</span>{/if}
								</p>

								<!-- Footer: conductor asignado -->
								<div
									class="mt-2 flex items-center gap-1.5 text-[11px]"
									style="color: var(--text-secondary);"
								>
									<svg
										class="h-3 w-3 flex-shrink-0"
										style="color: var(--text-very-muted);"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
									<span class="truncate">
										{#if v.conductores}
											<span class="font-medium" style="color: var(--text-primary);"
												>{v.conductores.nombre} {v.conductores.apellido}</span
											>
										{:else}
											<span class="italic" style="color: var(--text-very-muted);"
												>Sin conductor asignado</span
											>
										{/if}
									</span>
								</div>
							</div>

							<!-- Actions (vertical) -->
							<div class="flex flex-shrink-0 flex-col gap-1" on:click|stopPropagation>
								<button
									on:click={() => openModal(v.id)}
									class="apple-transition rounded-md p-1.5"
									style="color: var(--emerald-600); background-color: rgba(249, 115, 22, 0.06);"
									title="Editar"
								>
									<svg
										class="h-3.5 w-3.5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-2.828 0L9 13zm-4 6h16"
										/>
									</svg>
								</button>
								<button
									on:click={() => openDeleteModal(v)}
									class="apple-transition rounded-md p-1.5"
									style="color: #dc2626; background-color: rgba(220, 38, 38, 0.06);"
									title="Eliminar"
								>
									<svg
										class="h-3.5 w-3.5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							</div>
						</article>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- Bulk Actions Bar — fondo charcoal profundo (no glass) -->
	{#if vehiculosSeleccionados.size > 0}
		<div class="bulk-actions-container">
			<div
				class="flex items-center gap-4 rounded-2xl p-2.5 shadow-2xl"
				style="background-color: var(--bg-charcoal); border: 1px solid rgba(255,255,255,0.08); color: white;"
				in:scale={{ duration: 300, start: 0.9 }}
			>
				<span
					class="px-2 text-xs font-medium"
					style="border-right: 1px solid rgba(255,255,255,0.15);"
				>
					{vehiculosSeleccionados.size} seleccionados
				</span>
				<div class="flex gap-1.5">
					<button
						on:click={() => ejecutarAccionMasiva('ocultar')}
						disabled={procesandoMasivo}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
						style="background-color: rgba(255,255,255,0.08);"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
							/>
						</svg>
						Ocultar
					</button>
					<button
						on:click={() => ejecutarAccionMasiva('eliminar')}
						disabled={procesandoMasivo}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
						style="background-color: rgba(220,38,38,0.85);"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
						Papelera
					</button>
				</div>
				<button
					on:click={() => {
						vehiculosSeleccionados.clear();
						vehiculosSeleccionados = vehiculosSeleccionados;
					}}
					class="apple-transition ml-2"
					style="color: rgba(255,255,255,0.5);"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>
	{/if}
</div>

<ModalFormVehiculo
	bind:isOpen={isModalOpen}
	vehiculoId={selectedVehiculoId}
	on:close={() => (isModalOpen = false)}
	on:success={loadVehiculos}
/>
<ModalConfirmDelete
	bind:isOpen={isDeleteModalOpen}
	vehiculo={vehiculoToDelete}
	on:close={() => (isDeleteModalOpen = false)}
	on:success={loadVehiculos}
/>

<style>
	/* .glass y .soft-shadow ya están definidos en app.css con la nueva paleta.
	   Solo conservamos reglas específicas de esta vista. */
</style>
