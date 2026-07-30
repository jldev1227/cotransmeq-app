<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { clientesAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';

	const TipoCliente = {
		EMPRESA: 'EMPRESA',
		PERSONA_NATURAL: 'PERSONA_NATURAL'
	} as const;

	type TipoCliente = (typeof TipoCliente)[keyof typeof TipoCliente];

	interface Cliente {
		id: string;
		nit: string;
		nombre: string;
		representante: string | null;
		cedula: string | null;
		telefono: string;
		direccion: string;
		correo: string | null;
		requiere_osi: boolean;
		paga_recargos: boolean;
		tipo: TipoCliente;
		createdAt: string;
		updatedAt: string;
		deletedAt?: string | null;
	}

	let clientes: Cliente[] = [];
	let pagination = { page: 1, limit: 20, total: 0, pages: 1 };
	let isLoading = true;
	let error: string | null = null;
	let filtroTipo: TipoCliente | 'TODOS' = 'TODOS';
	let searchTerm = '';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let mostrarOcultos = false;
	let mostrarFiltros = false;

	let showDeleteModal = false;
	let clienteToDelete: Cliente | null = null;

	// Estados para modo selección
	let clientesSeleccionados = new Set<string>();
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

			const idsInRange = clientes.slice(start, end + 1).map((c) => c.id);
			const someNotSelected = idsInRange.some((id) => !clientesSeleccionados.has(id));

			if (someNotSelected) {
				idsInRange.forEach((id) => clientesSeleccionados.add(id));
			} else {
				idsInRange.forEach((id) => clientesSeleccionados.delete(id));
			}
		} else {
			if (clientesSeleccionados.has(id)) {
				clientesSeleccionados.delete(id);
			} else {
				clientesSeleccionados.add(id);
			}
			ultimoSeleccionadoIndex = index;
		}
		clientesSeleccionados = clientesSeleccionados;
	}

	function toggleSeleccionarTodo() {
		if (clientesSeleccionados.size === clientes.length && clientes.length > 0) {
			clientesSeleccionados.clear();
		} else {
			clientes.forEach((c) => clientesSeleccionados.add(c.id));
		}
		clientesSeleccionados = clientesSeleccionados;
	}

	async function ejecutarAccionMasiva(accion: 'ocultar' | 'mostrar' | 'eliminar') {
		if (clientesSeleccionados.size === 0) return;

		const ids = Array.from(clientesSeleccionados);
		procesandoMasivo = true;

		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/clientes/masivo`, {
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
				clientesSeleccionados.clear();
				clientesSeleccionados = clientesSeleccionados;
				loadClientes();
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

	// Filtros activos (para chips removibles)
	const TIPO_LABELS: Record<string, string> = {
		EMPRESA: 'Empresa',
		PERSONA_NATURAL: 'Persona Natural'
	};
	$: activeFilters = [
		...(filtroTipo !== 'TODOS'
			? [{ key: 'tipo', label: 'Tipo', value: TIPO_LABELS[filtroTipo] ?? filtroTipo }]
			: []),
		...(mostrarOcultos ? [{ key: 'ocultos', label: 'Visibilidad', value: 'Ocultos' }] : []),
		...(searchTerm.trim()
			? [{ key: 'search', label: 'Búsqueda', value: `"${searchTerm.trim()}"` }]
			: [])
	];

	function clearFilter(key: string) {
		if (key === 'tipo') {
			filtroTipo = 'TODOS';
			loadClientes();
		}
		if (key === 'ocultos') {
			mostrarOcultos = false;
			loadClientes();
		}
		if (key === 'search') {
			searchTerm = '';
			loadClientes();
		}
	}

	$: stats = {
		total: pagination.total || clientes.length,
		empresas: clientes.filter((c) => c.tipo === TipoCliente.EMPRESA).length,
		personas: clientes.filter((c) => c.tipo === TipoCliente.PERSONA_NATURAL).length,
		conOSI: clientes.filter((c) => c.requiere_osi).length,
		conRecargos: clientes.filter((c) => c.paga_recargos).length
	};

	async function loadClientes() {
		isLoading = true;
		error = null;
		try {
			const response = await (mostrarOcultos
				? fetch(`${import.meta.env.VITE_API_URL}/api/clientes/ocultos`, {
						headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
					}).then((r) => r.json())
				: clientesAPI.getAll({
						page: pagination.page,
						limit: pagination.limit,
						search: searchTerm.trim() || undefined,
						tipo: filtroTipo !== 'TODOS' ? filtroTipo : undefined
					}));

			if (response.data?.success || Array.isArray(response.data)) {
				clientes = response.data.data || response.data || [];
				if (response.data.pagination) pagination = response.data.pagination;
				else {
					pagination.total = clientes.length;
					pagination.pages = 1;
				}
			}
		} catch (err: any) {
			error = err.message || 'Error al cargar los clientes';
			if (error) toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function handleSearch() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
			loadClientes();
		}, 400);
	}

	function limpiarFiltros() {
		searchTerm = '';
		filtroTipo = 'TODOS';
		mostrarOcultos = false;
		pagination.page = 1;
		loadClientes();
	}

	async function irPagina(pagina: number) {
		if (pagina >= 1 && pagina <= pagination.pages) {
			pagination.page = pagina;
			await loadClientes();
		}
	}

	function openDeleteModal(cliente: Cliente) {
		clienteToDelete = cliente;
		showDeleteModal = true;
	}

	async function confirmDelete() {
		if (!clienteToDelete) return;
		try {
			await fetch(`${import.meta.env.VITE_API_URL}/api/clientes/${clienteToDelete.id}`, {
				method: 'DELETE'
			});
			toast.success('Cliente eliminado');
			showDeleteModal = false;
			loadClientes();
		} catch (err) {
			toast.error('Error al eliminar');
		}
	}

	function getTipoColor(tipo: string) {
		return tipo === TipoCliente.EMPRESA ? '#3b82f6' : '#10b981';
	}

	onMount(() => {
		loadClientes();
		socketUtils.on('cliente:created', loadClientes);
		socketUtils.on('cliente:updated', loadClientes);
		socketUtils.on('cliente:deleted', loadClientes);
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);
	});

	onDestroy(() => {
		socketUtils.off('cliente:created', loadClientes);
		socketUtils.off('cliente:updated', loadClientes);
		socketUtils.off('cliente:deleted', loadClientes);
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('keyup', handleKeyup);
	});
</script>

<svelte:head>
	<title>Clientes — Transmeralda</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-4 p-6" in:fade={{ duration: 400 }}>
	<!-- ── HEADER (page-card editorial) ─────────────────────── -->
	<div class="page-card flex-shrink-0" style="padding: 1.25rem 1.5rem;">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<!-- Título -->
			<div class="flex items-center gap-3">
				<div
					class="brand-gradient flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);"
				>
					<svg
						class="h-5 w-5 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						/>
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Gestión de Clientes
						</h1>
						<span
							class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
							style="background: rgba(16,185,129,0.08); color: var(--emerald-800);"
						>
							<span
								class="h-1.5 w-1.5 animate-pulse rounded-full"
								style="background-color: var(--emerald-500);"
							></span>
							En vivo
						</span>
					</div>
					<p class="text-xs" style="color: var(--text-muted);">
						Administra toda la información de clientes registrados
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
								loadClientes();
							}}
							title={mostrarOcultos ? 'Ver Activos' : 'Ver Ocultos'}
							class="btn-icon"
							style="border-color: {mostrarOcultos
								? 'var(--emerald-500)'
								: 'var(--border-default)'}; background-color: {mostrarOcultos
								? 'rgba(16,185,129,0.04)'
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
					</div>
				{/if}

				<!-- Búsqueda -->
				<div class="relative">
					<input
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Buscar clientes…"
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

				<!-- Filtros -->
				<button
					on:click={() => (mostrarFiltros = !mostrarFiltros)}
					class="btn-secondary"
					style="border-color: {mostrarFiltros
						? 'var(--emerald-500)'
						: 'var(--border-default)'}; color: {mostrarFiltros
						? 'var(--emerald-700)'
						: 'var(--text-secondary)'}; background-color: {mostrarFiltros
						? 'rgba(16,185,129,0.04)'
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
					{#if filtroTipo !== 'TODOS' || mostrarOcultos}
						<span
							class="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
							style="background-color: var(--emerald-500);">!</span
						>
					{/if}
				</button>

				<!-- Nuevo -->
				<button on:click={() => goto('/dashboard/clientes/agregar')} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Nuevo Cliente
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
			subtitle="Filtra la cartera de clientes por tipo o palabra clave."
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
					<label for="filtro-tipo" class="filter-field-label">
						Tipo de cliente
						{#if filtroTipo !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select id="filtro-tipo" bind:value={filtroTipo} on:change={loadClientes}>
						<option value="TODOS">Todos los tipos</option>
						<option value={TipoCliente.EMPRESA}>Empresa</option>
						<option value={TipoCliente.PERSONA_NATURAL}>Persona Natural</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-visibilidad" class="filter-field-label">
						Visibilidad
						{#if mostrarOcultos}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select
						id="filtro-visibilidad"
						value={mostrarOcultos ? 'ocultos' : 'todos'}
						on:change={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							mostrarOcultos = v === 'ocultos';
							loadClientes();
						}}
					>
						<option value="todos">Activos</option>
						<option value="ocultos" disabled={!canAccessSpecialViews}>Solo ocultos</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por nombre, NIT o correo
						{#if searchTerm.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-busqueda"
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Ej. Transportes Norte, 900.123.456…"
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

	<!-- ── STATS CARDS (radio 16, mono labels) ──────────────── -->
	<div
		class="grid flex-shrink-0 grid-cols-2 gap-3 lg:grid-cols-5"
		in:fly={{ y: 12, duration: 400, delay: 100 }}
	>
		<div class="stat-card">
			<p class="stat-label">Total</p>
			<p class="stat-value">{stats.total}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Empresas</p>
			<p class="stat-value" style="color: #3b82f6;">{stats.empresas}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Personas</p>
			<p class="stat-value" style="color: var(--emerald-600);">{stats.personas}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Con OSI</p>
			<p class="stat-value" style="color: #f59e0b;">{stats.conOSI}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Recargos</p>
			<p class="stat-value" style="color: #a855f7;">{stats.conRecargos}</p>
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
				<p class="text-sm" style="color: var(--text-muted);">Cargando clientes…</p>
			</div>
		{:else if clientes.length === 0}
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
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						/>
					</svg>
				</div>
				<div class="text-center">
					<h3 class="font-display mb-1 text-lg" style="color: var(--bg-charcoal); font-weight: 400;">
						No hay clientes
					</h3>
					<p class="text-sm" style="color: var(--text-muted);">No se encontraron resultados</p>
				</div>
				<button on:click={limpiarFiltros} class="btn-primary">Limpiar filtros</button>
			</div>
		{:else}
			<!-- Cards grid: 1 col mobile, 2 sm, 3 lg, 4 xl -->
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each clientes as cliente, index (cliente.id)}
						<article
							class="list-card"
							style="border-left: 4px solid {getTipoColor(cliente.tipo)};
								background-color: {clientesSeleccionados.has(cliente.id)
								? 'rgba(16, 185, 129, 0.04)'
								: 'var(--bg-surface)'};
								border-color: {clientesSeleccionados.has(cliente.id) ? 'var(--emerald-500)' : 'var(--border-subtle)'};
								border-left-color: {getTipoColor(cliente.tipo)};"
							in:fly={{ y: 8, duration: 200, delay: Math.min(index * 20, 200) }}
							on:click={(e) => toggleSeleccion(cliente.id, index, e)}
							role="button"
							tabindex="0"
						>
							<!-- Checkbox -->
							<div class="flex-shrink-0 pt-0.5">
								<input
									type="checkbox"
									checked={clientesSeleccionados.has(cliente.id)}
									on:click|stopPropagation={(e) => toggleSeleccion(cliente.id, index, e)}
									class="rounded text-emerald-600 focus:ring-emerald-500"
									style="border-color: var(--border-default);"
								/>
							</div>

							<!-- Contenido principal -->
							<div class="min-w-0 flex-1">
								<!-- Header: NIT (mono) + tipo pill -->
								<div class="mb-1.5 flex items-start justify-between gap-2">
									<p
										class="font-mono-meta text-[11px]"
										style="color: var(--text-very-muted); letter-spacing: 0.05em;"
									>
										NIT {cliente.nit}
									</p>
								</div>

								<!-- Nombre (línea principal) -->
								<p
									class="truncate text-sm leading-snug font-semibold"
									style="color: var(--text-primary);"
								>
									{cliente.nombre}
								</p>

								<!-- Tipo (label editorial) -->
								<p
									class="mt-0.5 text-[10px] font-semibold tracking-wide uppercase"
									style="color: {getTipoColor(cliente.tipo)};"
								>
									{cliente.tipo === TipoCliente.EMPRESA ? 'Empresa' : 'Persona Natural'}
								</p>

								<!-- Representante -->
								{#if cliente.representante}
									<p
										class="mt-1.5 truncate text-[11px]"
										style="color: var(--text-secondary);"
									>
										{cliente.representante}
									</p>
								{/if}

								<!-- Footer: contacto -->
								<div
									class="mt-1.5 flex items-center justify-between gap-2 text-[10px]"
									style="color: var(--text-muted);"
								>
									{#if cliente.telefono}
										<span class="flex items-center gap-1 truncate">
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
													d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
												/>
											</svg>
											<span class="truncate">{cliente.telefono}</span>
										</span>
									{:else}
										<span class="italic" style="color: var(--text-very-muted);">Sin teléfono</span>
									{/if}
								</div>

								<!-- Badges OSI/REC -->
								{#if cliente.requiere_osi || cliente.paga_recargos}
									<div class="mt-2 flex flex-wrap gap-1">
										{#if cliente.requiere_osi}
											<span
												class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px]"
												style="background: rgba(245, 158, 11, 0.08); color: #b45309;"
											>
												OSI
											</span>
										{/if}
										{#if cliente.paga_recargos}
											<span
												class="font-mono-meta inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px]"
												style="background: rgba(168, 85, 247, 0.08); color: #7e22ce;"
											>
												REC
											</span>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Actions (vertical) -->
							<div class="flex flex-shrink-0 flex-col gap-1" on:click|stopPropagation>
								<button
									on:click={() => goto(`/dashboard/clientes/${cliente.id}`)}
									class="apple-transition rounded-md p-1.5"
									style="color: var(--emerald-600); background-color: rgba(16, 185, 129, 0.06);"
									title="Ver detalle"
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
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
										/>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
										/>
									</svg>
								</button>
								<button
									on:click={() => openDeleteModal(cliente)}
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

			<!-- Paginación -->
			{#if pagination.pages > 1}
				<div
					class="flex flex-shrink-0 items-center justify-between px-4 py-3"
					style="border-top: 1px solid var(--border-subtle); background-color: var(--bg-base);"
				>
					<p class="text-xs" style="color: var(--text-muted);">
						Mostrando <span class="font-semibold" style="color: var(--text-primary);"
							>{(pagination.page - 1) * pagination.limit + 1}–{Math.min(
								pagination.page * pagination.limit,
								pagination.total
							)}</span
						>
						de
						<span class="font-semibold" style="color: var(--text-primary);">{pagination.total}</span>
						clientes
					</p>
					<div class="flex items-center gap-1">
						<button
							on:click={() => irPagina(pagination.page - 1)}
							disabled={pagination.page === 1 || isLoading}
							class="apple-transition rounded-lg border p-1.5"
							style="border-color: var(--border-default); color: {pagination.page === 1 ||
							isLoading
								? 'var(--text-very-muted)'
								: 'var(--text-secondary)'}; background-color: {pagination.page === 1 || isLoading
								? 'var(--bg-base)'
								: 'white'}; cursor: {pagination.page === 1 || isLoading
								? 'not-allowed'
								: 'pointer'};"
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
								><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg
							>
						</button>
						<span
							class="px-2 text-xs font-semibold"
							style="color: var(--text-primary);"
						>
							{pagination.page} / {pagination.pages}
						</span>
						<button
							on:click={() => irPagina(pagination.page + 1)}
							disabled={pagination.page === pagination.pages || isLoading}
							class="apple-transition rounded-lg border p-1.5"
							style="border-color: var(--border-default); color: {pagination.page ===
							pagination.pages || isLoading
								? 'var(--text-very-muted)'
								: 'var(--text-secondary)'}; background-color: {pagination.page ===
							pagination.pages || isLoading
								? 'var(--bg-base)'
								: 'white'}; cursor: {pagination.page === pagination.pages || isLoading
								? 'not-allowed'
								: 'pointer'};"
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
								><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg
							>
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Bulk Actions Bar — fondo charcoal profundo (no glass) -->
	{#if clientesSeleccionados.size > 0}
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
					{clientesSeleccionados.size} seleccionados
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
						clientesSeleccionados.clear();
						clientesSeleccionados = clientesSeleccionados;
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

{#if showDeleteModal && clienteToDelete}
	<!-- Backdrop con blur (paleta landing) -->
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default border-0 p-0"
		style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		on:click={() => (showDeleteModal = false)}
	></button>

	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		on:keydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-sm overflow-hidden"
			style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18); padding: 1.5rem;"
			in:scale={{ duration: 200, start: 0.95 }}
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
					style="background-color: rgba(220, 38, 38, 0.08);"
				>
					<svg
						class="h-5 w-5"
						style="color: #dc2626;"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<div>
					<h2 class="text-base font-bold" style="color: var(--text-primary);">
						¿Eliminar cliente?
					</h2>
					<p class="mt-0.5 text-xs" style="color: var(--text-muted);">
						Esta acción no se puede deshacer
					</p>
				</div>
			</div>
			<p class="mb-5 text-sm" style="color: var(--text-secondary);">
				Se eliminará a <span class="font-semibold" style="color: var(--text-primary);"
					>{clienteToDelete.nombre}</span
				>
				del sistema.
			</p>
			<div class="flex gap-2">
				<button
					on:click={() => (showDeleteModal = false)}
					class="btn-secondary flex-1"
					style="justify-content: center;"
				>
					Cancelar
				</button>
				<button
					on:click={confirmDelete}
					class="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
					style="background-color: #dc2626;"
				>
					Eliminar
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* .page-card, .stat-card, .table-card, .list-card, .brand-gradient, .btn-primary,
	   .btn-secondary, .btn-icon, .spinner, .filter-field, .filter-chip, .filter-clear,
	   .bulk-actions-container y .confirm-card ya están definidos en app.css con la
	   nueva paleta editorial. Solo conservamos animaciones específicas si las hubiera. */
</style>
