<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';
	import { fade, fly, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { Wrench, Settings, Plus, Edit, Trash2, Search, FileText } from 'lucide-svelte';
	import type {
		ConfiguracionSalario,
		CrearConfiguracionSalarioDTO,
		EmpresaDisponible
	} from '$lib/types/recargos';

	// State
	let configuraciones: ConfiguracionSalario[] = [];
	let empresas: EmpresaDisponible[] = [];
	let loading = true;
	let saving = false;
	let searchTerm = '';
	let filtroActivo: 'todos' | 'activos' | 'inactivos' = 'activos';
	let filtroEmpresa = '';
	let filtroSede = '';

	// Modal state
	let modalOpen = false;
	let editingId: string | null = null;
	let deleteConfirmId: string | null = null;
	let deleteLoading = false;

	// Highlight state (socket)
	let recentlyCreated = new Set<string>();
	let recentlyUpdated = new Set<string>();

	// Form state
	let form: CrearConfiguracionSalarioDTO = getEmptyForm();

	// User
	$: user = $authStore.user;
	$: isReadOnly = user?.role === 'consulta';

	// Filtered data
	$: filtered = configuraciones.filter((c) => {
		if (filtroActivo === 'activos' && !c.activo) return false;
		if (filtroActivo === 'inactivos' && c.activo) return false;
		if (filtroEmpresa && c.empresa_id !== filtroEmpresa) return false;
		if (filtroSede && c.sede !== filtroSede) return false;
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			const empNombre = c.clientes?.nombre?.toLowerCase() || '';
			const obs = c.observaciones?.toLowerCase() || '';
			const sede = (c.sede || '').toLowerCase();
			return empNombre.includes(term) || obs.includes(term) || sede.includes(term);
		}
		return true;
	});

	function getEmptyForm(): CrearConfiguracionSalarioDTO {
		return {
			empresa_id: null,
			salario_basico: 0,
			valor_hora_trabajador: 0,
			horas_mensuales_base: 240,
			vigencia_desde: new Date().toISOString().split('T')[0],
			vigencia_hasta: null,
			activo: true,
			observaciones: '',
			paga_dias_festivos: false,
			porcentaje_festivos: 75,
			seguridad_social: 0,
			administracion: 0,
			prueba_antigeno_covid: 0,
			prestaciones_sociales: 0,
			sede: null
		};
	}

	async function cargarDatos() {
		loading = true;
		try {
			const [configsRes, empresasRes] = await Promise.all([
				recargosApi.obtenerConfiguracionesSalarios(),
				recargosApi.obtenerEmpresasDisponibles()
			]);
			configuraciones = configsRes;
			empresas = empresasRes;
		} catch (err) {
			console.error('Error cargando datos:', err);
			toast.error('Error al cargar configuraciones de salarios');
		} finally {
			loading = false;
		}
	}

	function abrirCrear() {
		editingId = null;
		form = getEmptyForm();
		modalOpen = true;
	}

	function abrirEditar(config: ConfiguracionSalario) {
		editingId = config.id;
		form = {
			empresa_id: config.empresa_id,
			salario_basico: Number(config.salario_basico),
			valor_hora_trabajador: Number(config.valor_hora_trabajador),
			horas_mensuales_base: config.horas_mensuales_base,
			vigencia_desde: config.vigencia_desde ? config.vigencia_desde.split('T')[0] : '',
			vigencia_hasta: config.vigencia_hasta ? config.vigencia_hasta.split('T')[0] : null,
			activo: config.activo,
			observaciones: config.observaciones || '',
			paga_dias_festivos: config.paga_dias_festivos,
			porcentaje_festivos: Number(config.porcentaje_festivos),
			seguridad_social: Number(config.seguridad_social),
			administracion: Number(config.administracion),
			prueba_antigeno_covid: Number(config.prueba_antigeno_covid),
			prestaciones_sociales: Number(config.prestaciones_sociales),
			sede: config.sede
		};
		modalOpen = true;
	}

	async function guardar() {
		saving = true;
		try {
			if (editingId) {
				await recargosApi.actualizarConfiguracionSalario(editingId, form);
				toast.success('Configuración actualizada');
			} else {
				await recargosApi.crearConfiguracionSalario(form);
				toast.success('Configuración creada');
			}
			modalOpen = false;
			await cargarDatos();
		} catch (err: any) {
			console.error('Error guardando:', err);
			toast.error(err?.response?.data?.message || 'Error al guardar configuración');
		} finally {
			saving = false;
		}
	}

	async function eliminar(id: string) {
		deleteLoading = true;
		try {
			await recargosApi.eliminarConfiguracionSalario(id);
			toast.success('Configuración eliminada');
			deleteConfirmId = null;
			await cargarDatos();
		} catch (err) {
			console.error('Error eliminando:', err);
			toast.error('Error al eliminar configuración');
		} finally {
			deleteLoading = false;
		}
	}

	async function toggleActivo(config: ConfiguracionSalario) {
		try {
			await recargosApi.actualizarConfiguracionSalario(config.id, { activo: !config.activo });
			toast.success(config.activo ? 'Configuración desactivada' : 'Configuración activada');
			await cargarDatos();
		} catch (err) {
			toast.error('Error al cambiar estado');
		}
	}

	// Formatear moneda
	function formatCurrency(value: number | string): string {
		const num = Number(value);
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		}).format(num);
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		// Usar timeZone UTC para evitar desfase de -1 día por conversión timezone
		const fecha = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00Z');
		return fecha.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	// Socket listeners
	function setupSocketListeners() {
		socketUtils.on('config-salario-creada', handleConfigCreada);
		socketUtils.on('config-salario-actualizada', handleConfigActualizada);
		socketUtils.on('config-salario-eliminada', handleConfigEliminada);
	}

	function handleConfigCreada(data: any) {
		recentlyCreated.add(data.configId);
		recentlyCreated = recentlyCreated;
		cargarDatos();
		setTimeout(() => {
			recentlyCreated.delete(data.configId);
			recentlyCreated = recentlyCreated;
		}, 5000);
	}

	function handleConfigActualizada(data: any) {
		recentlyUpdated.add(data.configId);
		recentlyUpdated = recentlyUpdated;
		cargarDatos();
		setTimeout(() => {
			recentlyUpdated.delete(data.configId);
			recentlyUpdated = recentlyUpdated;
		}, 5000);
	}

	function handleConfigEliminada(data: any) {
		cargarDatos();
		toast.info('Una configuración fue eliminada por otro usuario');
	}

	onMount(async () => {
		await cargarDatos();
		setupSocketListeners();
	});

	onDestroy(() => {
		socketUtils.off('config-salario-creada', handleConfigCreada);
		socketUtils.off('config-salario-actualizada', handleConfigActualizada);
		socketUtils.off('config-salario-eliminada', handleConfigEliminada);
	});
</script>

<svelte:head>
	<title>Configuración Salarios - Recargos - Cotransmeq</title>
</svelte:head>

<div
	class="min-h-screen p-4 md:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<div class="mb-2.5 flex items-center gap-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
				<a
					href="/dashboard/recargos"
					class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 apple-transition hover:bg-[var(--bg-surface)] hover:text-[var(--emerald-700)]"
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
					</svg>
					Recargos
				</a>
				<span class="text-[var(--text-very-muted)]">/</span>
				<span class="rounded-md bg-[rgba(249, 115, 22,0.08)] px-2 py-0.5 text-[var(--emerald-700)]">
					Configuración
				</span>
			</div>
			<h1
				class="font-display flex items-center gap-3 text-2xl font-normal tracking-tight text-[var(--bg-charcoal)] md:text-3xl"
			>
				<div class="card-icon">
					<Settings class="h-5 w-5 text-white" />
				</div>
				Configuración de Salarios
			</h1>
			<p class="mt-1.5 text-sm text-[var(--text-secondary)]">
				Gestiona los salarios, porcentajes y valores de hora para los cálculos de recargos
			</p>
		</div>

		<div class="flex items-center gap-2">
			<a href="/dashboard/recargos" class="btn-secondary apple-transition">
				<FileText class="h-4 w-4" />
				Planillas
			</a>

			{#if !isReadOnly}
				<button on:click={abrirCrear} class="btn-primary apple-transition">
					<Plus class="h-4 w-4" />
					Nueva Configuración
				</button>
			{/if}
		</div>
	</div>

	<!-- Filtros -->
	<div class="page-card mb-4">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-[200px] flex-1 max-w-md">
				<Search
					class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-very-muted)]"
				/>
				<input
					type="text"
					bind:value={searchTerm}
					placeholder="Buscar por empresa, sede u observaciones..."
					class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white py-2 pl-10 pr-4 text-sm"
				/>
			</div>

			<select
				bind:value={filtroActivo}
				class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium"
			>
				<option value="todos">Todos</option>
				<option value="activos">Activos</option>
				<option value="inactivos">Inactivos</option>
			</select>

			<select
				bind:value={filtroEmpresa}
				class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium"
			>
				<option value="">Todas las empresas</option>
				{#each empresas as emp}
					<option value={emp.id}>{emp.nombre || 'Sin nombre'}</option>
				{/each}
			</select>

			<select
				bind:value={filtroSede}
				class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium"
			>
				<option value="">Todas las sedes</option>
				<option value="YOPAL">Yopal</option>
				<option value="VILLANUEVA">Villanueva</option>
				<option value="TAURAMENA">Tauramena</option>
			</select>

			<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
				{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
			</span>
		</div>
	</div>

	<!-- Tabla -->
	{#if loading}
		<div class="table-card flex items-center justify-center py-20">
			<div class="flex flex-col items-center gap-3">
				<div class="spinner"></div>
				<p class="text-sm text-[var(--text-muted)]">Cargando configuraciones...</p>
			</div>
		</div>
	{:else if filtered.length === 0}
		<div class="table-card flex flex-col items-center justify-center py-20 text-center">
			<div
				class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-base)]"
			>
				<Wrench class="h-8 w-8 text-[var(--text-very-muted)]" />
			</div>
			<h3 class="font-display text-lg font-medium text-[var(--text-primary)]">
				No hay configuraciones
			</h3>
			<p class="mt-1 text-sm text-[var(--text-muted)]">
				{searchTerm || filtroEmpresa || filtroSede || filtroActivo !== 'activos'
					? 'No se encontraron resultados con los filtros aplicados'
					: 'Crea la primera configuración de salarios'}
			</p>
			{#if !isReadOnly && !searchTerm}
				<button on:click={abrirCrear} class="btn-primary apple-transition mt-4">
					<Plus class="h-4 w-4" />
					Crear Configuración
				</button>
			{/if}
		</div>
	{:else}
		<div class="table-card">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="table-header">
						<tr>
							<th class="text-left">Empresa</th>
							<th class="text-left">Sede</th>
							<th class="text-right">Salario Básico</th>
							<th class="text-right">Valor Hora</th>
							<th class="text-center">Hrs/Mes</th>
							<th class="text-center">Festivos</th>
							<th class="text-center">Vigencia</th>
							<th class="text-center">Estado</th>
							<th class="text-center">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--border-subtle)]">
						{#each filtered as config (config.id)}
							<tr
								class="table-row {recentlyCreated.has(config.id)
									? '!bg-[rgba(249, 115, 22,0.08)]'
									: ''} {recentlyUpdated.has(config.id)
									? '!bg-[rgba(37,99,235,0.08)]'
									: ''}"
							>
								<td class="px-4 py-3">
									<div class="font-semibold text-[var(--text-primary)]">
										{config.clientes?.nombre || 'General (todas)'}
									</div>
									{#if config.clientes?.nit}
										<div class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											NIT: {config.clientes.nit}
										</div>
									{/if}
								</td>
								<td class="px-4 py-3">
									{#if config.sede}
										<span
											class="status-pill !bg-[rgba(168,85,247,0.10)] !text-[#7E22CE]"
										>
											{config.sede}
										</span>
									{:else}
										<span class="text-[var(--text-very-muted)]">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
									{formatCurrency(config.salario_basico)}
								</td>
								<td class="px-4 py-3 text-right font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
									{formatCurrency(config.valor_hora_trabajador)}
								</td>
								<td class="px-4 py-3 text-center font-mono-meta text-[0.7rem] text-[var(--emerald-700)]">
									{config.horas_mensuales_base}
								</td>
								<td class="px-4 py-3 text-center">
									{#if config.paga_dias_festivos}
										<span
											class="status-pill !bg-[rgba(249, 115, 22,0.10)] !text-[var(--emerald-700)]"
										>
											<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
													clip-rule="evenodd"
												/>
											</svg>
											{Number(config.porcentaje_festivos)}%
										</span>
									{:else}
										<span
											class="status-pill !bg-[rgba(0,0,0,0.04)] !text-[var(--text-muted)]"
										>No</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-center">
									<div class="font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
										{formatDate(config.vigencia_desde)}
									</div>
									{#if config.vigencia_hasta}
										<div class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											→ {formatDate(config.vigencia_hasta)}
										</div>
									{/if}
								</td>
								<td class="px-4 py-3 text-center">
									<button
										on:click={() => toggleActivo(config)}
										disabled={isReadOnly}
										class="status-pill apple-transition
											{config.activo
											? '!bg-[rgba(249, 115, 22,0.10)] !text-[var(--emerald-700)] hover:!bg-[rgba(249, 115, 22,0.18)]'
											: '!bg-[rgba(0,0,0,0.04)] !text-[var(--text-muted)] hover:!bg-[rgba(0,0,0,0.08)]'}"
									>
										{config.activo ? 'Activo' : 'Inactivo'}
									</button>
								</td>
								<td class="px-4 py-3">
									<div class="flex items-center justify-center gap-1">
										{#if !isReadOnly}
											<button
												on:click={() => abrirEditar(config)}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563EB]"
												title="Editar"
											>
												<Edit class="h-3.5 w-3.5" />
											</button>
											<button
												on:click={() => (deleteConfirmId = config.id)}
												class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#DC2626]"
												title="Eliminar"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
								</td>
							</tr>

							<!-- Delete confirmation inline -->
							{#if deleteConfirmId === config.id}
								<tr transition:slide>
									<td colspan="9" class="px-4 py-3">
										<div
											class="alert alert-error flex items-center justify-between"
										>
											<p class="text-sm">
												¿Eliminar la configuración de
												<strong>{config.clientes?.nombre || 'General'}</strong>?
											</p>
											<div class="flex gap-2">
												<button
													on:click={() => (deleteConfirmId = null)}
													class="apple-transition rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
												>
													Cancelar
												</button>
												<button
													on:click={() => eliminar(config.id)}
													disabled={deleteLoading}
													class="apple-transition rounded-lg bg-[#DC2626] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#B91C1C] disabled:opacity-50"
												>
													{deleteLoading ? 'Eliminando...' : 'Confirmar'}
												</button>
											</div>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Detalle de porcentajes (cards) -->
		<div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each filtered as config (config.id)}
				<div
					class="page-card apple-transition
						{recentlyCreated.has(config.id) ? '!border-[var(--emerald-500)] emerald-glow' : ''}
						{recentlyUpdated.has(config.id) ? '!border-[#2563EB]' : ''}"
				>
					<div class="mb-3 flex items-center justify-between gap-2">
						<div class="min-w-0 flex-1">
							<h3 class="font-display text-base font-medium text-[var(--text-primary)]">
								{config.clientes?.nombre || 'Configuración General'}
							</h3>
							{#if config.sede}
								<span class="font-mono-meta text-[0.65rem] text-[#7E22CE]">
									Sede {config.sede}
								</span>
							{/if}
						</div>
						<span
							class="status-pill
								{config.activo
								? '!bg-[rgba(249, 115, 22,0.10)] !text-[var(--emerald-700)]'
								: '!bg-[rgba(0,0,0,0.04)] !text-[var(--text-muted)]'}"
						>
							{config.activo ? 'Activo' : 'Inactivo'}
						</span>
					</div>

					<div class="grid grid-cols-2 gap-2 text-xs">
						<div class="rounded-lg bg-[var(--bg-base)] p-2.5">
							<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">SEG. SOCIAL</p>
							<p class="mt-0.5 font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
								{formatCurrency(config.seguridad_social)}
							</p>
						</div>
						<div class="rounded-lg bg-[var(--bg-base)] p-2.5">
							<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">ADMINISTRACIÓN</p>
							<p class="mt-0.5 font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
								{formatCurrency(config.administracion)}
							</p>
						</div>
						<div class="rounded-lg bg-[var(--bg-base)] p-2.5">
							<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">PREST. SOCIALES</p>
							<p class="mt-0.5 font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
								{formatCurrency(config.prestaciones_sociales)}
							</p>
						</div>
						<div class="rounded-lg bg-[var(--bg-base)] p-2.5">
							<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">ANTÍGENO COVID</p>
							<p class="mt-0.5 font-mono-meta text-[0.7rem] text-[var(--text-primary)]">
								{formatCurrency(config.prueba_antigeno_covid)}
							</p>
						</div>
					</div>

					{#if config.observaciones}
						<div
							class="mt-3 flex items-start gap-2 rounded-lg bg-[rgba(245,158,11,0.06)] p-2.5 text-xs text-[#92400E]"
						>
							<span class="text-sm leading-none">💡</span>
							<span>{config.observaciones}</span>
						</div>
					{/if}

					{#if config.usuarios}
						<div class="mt-3 font-mono-meta text-[0.65rem] text-[var(--text-very-muted)]">
							Creado por: {config.usuarios.nombre}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Modal Crear/Editar -->
{#if modalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 150 }}
		on:click|self={() => (modalOpen = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="confirm-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-0">
			<!-- Modal header -->
			<div
				class="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-white/95 px-6 py-4 backdrop-blur-sm"
			>
				<div class="flex items-center gap-3">
					<div class="card-icon !h-10 !w-10 !rounded-[10px]">
						<Settings class="h-5 w-5 text-white" />
					</div>
					<div>
						<h2 class="font-display text-lg font-medium text-[var(--text-primary)]">
							{editingId ? 'Editar Configuración' : 'Nueva Configuración'}
						</h2>
						<p class="text-xs text-[var(--text-muted)]">
							{editingId
								? 'Modifica los valores de la configuración'
								: 'Define los valores salariales y porcentajes'}
						</p>
					</div>
				</div>
				<button
					on:click={() => (modalOpen = false)}
					class="apple-transition rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
					aria-label="Cerrar modal"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal body -->
			<form on:submit|preventDefault={guardar} class="p-6">
				<div class="space-y-5">
					<!-- Empresa + Sede -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label
								for="empresa_id"
								class="mb-1.5 block font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>
								EMPRESA
							</label>
							<select
								id="empresa_id"
								bind:value={form.empresa_id}
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							>
								<option value={null}>General (todas las empresas)</option>
								{#each empresas as emp}
									<option value={emp.id}
										>{emp.nombre || 'Sin nombre'} {emp.nit ? `— ${emp.nit}` : ''}</option
									>
								{/each}
							</select>
						</div>
						<div>
							<label
								for="sede"
								class="mb-1.5 block font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>
								SEDE
							</label>
							<select
								id="sede"
								bind:value={form.sede}
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							>
								<option value={null}>Sin especificar</option>
								<option value="YOPAL">Yopal</option>
								<option value="VILLANUEVA">Villanueva</option>
								<option value="TAURAMENA">Tauramena</option>
							</select>
						</div>
					</div>

					<!-- Salario + Valor Hora + Horas/Mes -->
					<div class="hint-card space-y-3">
						<div class="flex items-center gap-2">
							<span class="hint-label">💰 VALORES SALARIALES</span>
						</div>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div>
								<label
									for="salario_basico"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Salario Básico</label
								>
								<input
									id="salario_basico"
									type="number"
									step="0.01"
									min="0"
									bind:value={form.salario_basico}
									required
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
							<div>
								<label
									for="valor_hora"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Valor Hora Trabajador</label
								>
								<input
									id="valor_hora"
									type="number"
									step="0.0001"
									min="0"
									bind:value={form.valor_hora_trabajador}
									required
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
							<div>
								<label
									for="horas_mes"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Horas/Mes Base</label
								>
								<input
									id="horas_mes"
									type="number"
									min="1"
									bind:value={form.horas_mensuales_base}
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
						</div>
					</div>

					<!-- Porcentajes y deducciones -->
					<div class="hint-card space-y-3">
						<div class="flex items-center gap-2">
							<span class="hint-label">📊 DEDUCCIONES Y APORTES</span>
						</div>
						<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<div>
								<label
									for="seguridad_social"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Seguridad Social</label
								>
								<input
									id="seguridad_social"
									type="number"
									step="0.01"
									min="0"
									bind:value={form.seguridad_social}
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
							<div>
								<label
									for="administracion"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Administración</label
								>
								<input
									id="administracion"
									type="number"
									step="0.01"
									min="0"
									bind:value={form.administracion}
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
							<div>
								<label
									for="prestaciones"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Prest. Sociales</label
								>
								<input
									id="prestaciones"
									type="number"
									step="0.01"
									min="0"
									bind:value={form.prestaciones_sociales}
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
							<div>
								<label
									for="antigeno"
									class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
									>Antígeno COVID</label
								>
								<input
									id="antigeno"
									type="number"
									step="0.01"
									min="0"
									bind:value={form.prueba_antigeno_covid}
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 font-mono-meta text-sm"
								/>
							</div>
						</div>
					</div>

					<!-- Festivos -->
					<div class="hint-card space-y-3">
						<div class="flex items-center gap-2">
							<span class="hint-label">🎉 DÍAS FESTIVOS</span>
						</div>
						<div class="flex flex-wrap items-center gap-6">
							<label class="flex cursor-pointer items-center gap-2">
								<input
									type="checkbox"
									bind:checked={form.paga_dias_festivos}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								<span class="text-sm font-medium text-[var(--text-secondary)]">
									Paga días festivos
								</span>
							</label>
							{#if form.paga_dias_festivos}
								<div class="flex items-center gap-2">
									<label
										for="porcentaje_festivos"
										class="text-sm text-[var(--text-muted)]">Porcentaje:</label
									>
									<input
										id="porcentaje_festivos"
										type="number"
										step="0.01"
										min="0"
										max="200"
										bind:value={form.porcentaje_festivos}
										class="input-glow w-20 rounded-xl border border-[var(--border-default)] bg-white px-2 py-1.5 text-center font-mono-meta text-sm"
									/>
									<span class="font-mono-meta text-sm text-[var(--text-muted)]">%</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Vigencia -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label
								for="vigencia_desde"
								class="mb-1.5 block font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>
								VIGENCIA DESDE *
							</label>
							<input
								id="vigencia_desde"
								type="date"
								bind:value={form.vigencia_desde}
								required
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
						<div>
							<label
								for="vigencia_hasta"
								class="mb-1.5 block font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>
								VIGENCIA HASTA <span class="text-[var(--text-very-muted)]">(opcional)</span>
							</label>
							<input
								id="vigencia_hasta"
								type="date"
								bind:value={form.vigencia_hasta}
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
					</div>

					<!-- Observaciones + Activo -->
					<div>
						<label
							for="observaciones"
							class="mb-1.5 block font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
						>
							OBSERVACIONES
						</label>
						<textarea
							id="observaciones"
							bind:value={form.observaciones}
							rows="2"
							class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							placeholder="Notas adicionales..."
						></textarea>
					</div>

					<label
						class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
					>
						<input
							type="checkbox"
							bind:checked={form.activo}
							class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
						/>
						<span class="text-sm font-semibold text-[var(--text-primary)]">
							Configuración activa
						</span>
					</label>
				</div>

				<!-- Modal footer -->
				<div
					class="mt-6 flex justify-end gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-base)]/50 px-0 pt-4"
				>
					<button
						type="button"
						on:click={() => (modalOpen = false)}
						class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={saving}
						class="apple-transition flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
						style="background: linear-gradient(135deg, #10B981, #ea580c);"
					>
						{#if saving}
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
						{/if}
						{editingId ? 'Guardar Cambios' : 'Crear Configuración'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
