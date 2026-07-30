<script lang="ts">
	import { onMount } from 'svelte';
	import {
		obtenerConfiguraciones,
		obtenerAniosConfiguraciones,
		actualizarConfiguracion,
		crearConfiguracion,
		duplicarConfiguraciones,
		eliminarConfiguracionItem
	} from '$lib/api/nomina';
	import type { ConfiguracionLiquidacion } from '$lib/types/nomina';
	import { toast } from 'svelte-sonner';
	import {
		Settings,
		Edit,
		Trash2,
		Plus,
		Copy,
		Save,
		X,
		Calendar,
		DollarSign,
		Percent,
		Check
	} from 'lucide-svelte';

	// ==================== ESTADO ====================
	let configuraciones: ConfiguracionLiquidacion[] = [];
	let aniosDisponibles: number[] = [];
	let anioSeleccionado: number = new Date().getFullYear();
	let loading = true;

	// Edición inline
	let editingId: string | null = null;
	let editForm = { nombre: '', valor: 0, tipo: '' };

	// Modal crear
	let showCrearModal = false;
	let crearForm = { nombre: '', valor: 0, tipo: 'VALOR_NUMERICO' };

	// Modal duplicar
	let showDuplicarModal = false;
	let anioDestino: number = new Date().getFullYear() + 1;
	let duplicando = false;

	// Modal eliminar
	let showDeleteModal = false;
	let configToDelete: ConfiguracionLiquidacion | null = null;

	const tiposConfig = [
		'BONO',
		'CONFIGURACION',
		'PARAMETRO',
		'OTROS',
		'VALOR_NUMERICO',
		'PORCENTAJE',
		'MONTO_FIJO',
		'BOOLEAN',
		'MULTIPLICADOR',
		'DESCUENTO'
	];

	// ==================== CARGA DE DATOS ====================
	onMount(async () => {
		await cargarAnios();
		await cargarConfiguraciones();
	});

	async function cargarAnios() {
		try {
			const response = await obtenerAniosConfiguraciones();
			aniosDisponibles = response.data || [];
			if (aniosDisponibles.length > 0 && !aniosDisponibles.includes(anioSeleccionado)) {
				anioSeleccionado = aniosDisponibles[0];
			}
		} catch (error) {
			console.error('Error cargando años:', error);
		}
	}

	async function cargarConfiguraciones() {
		try {
			loading = true;
			const response = await obtenerConfiguraciones(anioSeleccionado);
			configuraciones = response.data || [];
		} catch (error: any) {
			console.error('Error cargando configuraciones:', error);
			toast.error('Error al cargar configuraciones');
		} finally {
			loading = false;
		}
	}

	async function handleAnioChange() {
		editingId = null;
		await cargarConfiguraciones();
	}

	// ==================== EDICIÓN INLINE ====================
	function startEdit(config: ConfiguracionLiquidacion) {
		editingId = config.id;
		editForm = {
			nombre: config.nombre,
			valor: config.valor,
			tipo: config.tipo
		};
	}

	function cancelEdit() {
		editingId = null;
		editForm = { nombre: '', valor: 0, tipo: '' };
	}

	async function saveEdit() {
		if (!editingId) return;
		try {
			await actualizarConfiguracion(editingId, {
				nombre: editForm.nombre,
				valor: editForm.valor,
				tipo: editForm.tipo
			});
			toast.success('Configuración actualizada');
			editingId = null;
			await cargarConfiguraciones();
		} catch (error: any) {
			console.error('Error actualizando:', error);
			toast.error('Error al actualizar configuración');
		}
	}

	// ==================== CREAR ====================
	function openCrearModal() {
		crearForm = { nombre: '', valor: 0, tipo: 'VALOR_NUMERICO' };
		showCrearModal = true;
	}

	async function handleCrear() {
		if (!crearForm.nombre.trim()) {
			toast.error('El nombre es obligatorio');
			return;
		}
		try {
			await crearConfiguracion({
				nombre: crearForm.nombre,
				valor: crearForm.valor,
				tipo: crearForm.tipo,
				anio: anioSeleccionado
			});
			toast.success('Configuración creada');
			showCrearModal = false;
			await cargarConfiguraciones();
		} catch (error: any) {
			console.error('Error creando:', error);
			toast.error('Error al crear configuración');
		}
	}

	// ==================== DUPLICAR AÑO ====================
	function openDuplicarModal() {
		anioDestino = anioSeleccionado + 1;
		showDuplicarModal = true;
	}

	async function handleDuplicar() {
		try {
			duplicando = true;
			const response = await duplicarConfiguraciones(anioSeleccionado, anioDestino);
			toast.success(response.message || 'Configuraciones duplicadas');
			showDuplicarModal = false;
			await cargarAnios();
			anioSeleccionado = anioDestino;
			await cargarConfiguraciones();
		} catch (error: any) {
			console.error('Error duplicando:', error);
			toast.error(error?.response?.data?.message || 'Error al duplicar configuraciones');
		} finally {
			duplicando = false;
		}
	}

	// ==================== ELIMINAR ====================
	function confirmarEliminar(config: ConfiguracionLiquidacion) {
		configToDelete = config;
		showDeleteModal = true;
	}

	async function handleEliminar() {
		if (!configToDelete) return;
		try {
			await eliminarConfiguracionItem(configToDelete.id);
			toast.success('Configuración eliminada');
			showDeleteModal = false;
			configToDelete = null;
			await cargarConfiguraciones();
		} catch (error: any) {
			console.error('Error eliminando:', error);
			toast.error('Error al eliminar configuración');
		}
	}

	// ==================== FORMATOS ====================
	function formatValor(config: ConfiguracionLiquidacion): string {
		if (config.tipo === 'PORCENTAJE') {
			return `${config.valor}%`;
		}
		if (config.tipo === 'BOOLEAN') {
			return config.valor ? 'Sí' : 'No';
		}
		if (config.tipo === 'MULTIPLICADOR') {
			return `x${config.valor}`;
		}
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(config.valor);
	}

	function getTipoBadgeColor(tipo: string): string {
		switch (tipo) {
			case 'BONO':
				return 'bg-green-100 text-green-700';
			case 'PORCENTAJE':
				return 'bg-blue-100 text-blue-700';
			case 'DESCUENTO':
				return 'bg-red-100 text-red-700';
			case 'MONTO_FIJO':
				return 'bg-purple-100 text-purple-700';
			case 'MULTIPLICADOR':
				return 'bg-orange-100 text-orange-700';
			case 'VALOR_NUMERICO':
				return 'bg-gray-100 text-gray-700';
			case 'CONFIGURACION':
				return 'bg-teal-100 text-teal-700';
			case 'PARAMETRO':
				return 'bg-indigo-100 text-indigo-700';
			default:
				return 'bg-gray-100 text-gray-600';
		}
	}

	function getTipoIcon(tipo: string) {
		if (tipo === 'PORCENTAJE') return Percent;
		return DollarSign;
	}
</script>

<div>
	<!-- Header de Configuración -->
	<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div class="rounded-lg bg-emerald-100 p-2">
				<Settings class="h-5 w-5 text-emerald-600" />
			</div>
			<div>
				<h2 class="text-xl font-bold text-gray-900">Configuraciones de Liquidación</h2>
				<p class="text-sm text-gray-500">Valores base para el cálculo de nómina</p>
			</div>
		</div>

		<div class="flex items-center gap-3">
			<!-- Selector de año -->
			<div class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
				<Calendar class="h-4 w-4 text-gray-500" />
				<select
					bind:value={anioSeleccionado}
					on:change={handleAnioChange}
					class="border-none bg-transparent text-sm font-semibold text-gray-900 focus:outline-none focus:ring-0"
				>
					{#each aniosDisponibles as anio}
						<option value={anio}>{anio}</option>
					{/each}
				</select>
			</div>

			<!-- Botón duplicar año -->
			<button
				on:click={openDuplicarModal}
				class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
				title="Duplicar configuraciones a otro año"
			>
				<Copy class="h-4 w-4" />
				<span class="hidden sm:inline">Duplicar Año</span>
			</button>

			<!-- Botón agregar -->
			<button
				on:click={openCrearModal}
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
			>
				<Plus class="h-4 w-4" />
				Agregar
			</button>
		</div>
	</div>

	<!-- Tabla de Configuraciones -->
	<div class="rounded-xl bg-white shadow-md overflow-hidden">
		{#if loading}
			<div class="flex items-center justify-center py-12">
				<div class="text-center">
					<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-gray-600">Cargando configuraciones...</p>
				</div>
			</div>
		{:else if configuraciones.length === 0}
			<div class="py-12 text-center">
				<Settings class="mx-auto h-12 w-12 text-gray-400" />
				<p class="mt-4 text-gray-600">No hay configuraciones para el año {anioSeleccionado}</p>
				<div class="mt-4 flex gap-3 justify-center">
					<button
						on:click={openCrearModal}
						class="rounded-lg bg-emerald-500 px-4 py-2 text-white hover:bg-emerald-600"
					>
						Crear configuración
					</button>
					{#if aniosDisponibles.length > 0}
						<button
							on:click={openDuplicarModal}
							class="rounded-lg border border-emerald-500 px-4 py-2 text-emerald-600 hover:bg-emerald-50"
						>
							Duplicar desde otro año
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">Nombre</th>
							<th class="px-6 py-3 text-right text-sm font-semibold text-gray-700">Valor</th>
							<th class="px-6 py-3 text-center text-sm font-semibold text-gray-700">Tipo</th>
							<th class="px-6 py-3 text-center text-sm font-semibold text-gray-700">Año</th>
							<th class="px-6 py-3 text-center text-sm font-semibold text-gray-700">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#each configuraciones as config (config.id)}
							<tr class="hover:bg-gray-50 transition-colors">
								{#if editingId === config.id}
									<!-- Modo edición -->
									<td class="px-6 py-3">
										<input
											type="text"
											bind:value={editForm.nombre}
											class="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
										/>
									</td>
									<td class="px-6 py-3">
										<input
											type="number"
											step="0.01"
											bind:value={editForm.valor}
											class="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-right focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
										/>
									</td>
									<td class="px-6 py-3">
										<select
											bind:value={editForm.tipo}
											class="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
										>
											{#each tiposConfig as tipo}
												<option value={tipo}>{tipo}</option>
											{/each}
										</select>
									</td>
									<td class="px-6 py-3 text-center">
										<span class="text-sm font-medium text-gray-500">{config.anio}</span>
									</td>
									<td class="px-6 py-3">
										<div class="flex items-center justify-center gap-1">
											<button
												on:click={saveEdit}
												class="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 transition-colors"
												title="Guardar"
											>
												<Check class="h-4 w-4" />
											</button>
											<button
												on:click={cancelEdit}
												class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors"
												title="Cancelar"
											>
												<X class="h-4 w-4" />
											</button>
										</div>
									</td>
								{:else}
									<!-- Modo lectura -->
									<td class="px-6 py-3">
										<div class="flex items-center gap-2">
											<svelte:component this={getTipoIcon(config.tipo)} class="h-4 w-4 text-gray-400" />
											<span class="font-medium text-gray-900">{config.nombre}</span>
										</div>
									</td>
									<td class="px-6 py-3 text-right">
										<span class="text-lg font-bold text-gray-900">{formatValor(config)}</span>
									</td>
									<td class="px-6 py-3 text-center">
										<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {getTipoBadgeColor(config.tipo)}">
											{config.tipo}
										</span>
									</td>
									<td class="px-6 py-3 text-center">
										<span class="text-sm font-medium text-gray-500">{config.anio}</span>
									</td>
									<td class="px-6 py-3">
										<div class="flex items-center justify-center gap-1">
											<button
												on:click={() => startEdit(config)}
												class="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 transition-colors"
												title="Editar"
											>
												<Edit class="h-4 w-4" />
											</button>
											<button
												on:click={() => confirmarEliminar(config)}
												class="rounded-lg p-2 text-red-600 hover:bg-red-50 transition-colors"
												title="Eliminar"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Footer resumen -->
			<div class="border-t border-gray-200 bg-gray-50 px-6 py-3">
				<p class="text-sm text-gray-600">
					<span class="font-semibold">{configuraciones.length}</span> configuraciones para el año
					<span class="font-semibold">{anioSeleccionado}</span>
				</p>
			</div>
		{/if}
	</div>
</div>

<!-- ==================== MODAL CREAR ==================== -->
{#if showCrearModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		on:click={() => (showCrearModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showCrearModal = false)}
		role="button"
		tabindex="-1"
	>
		<div
			class="rounded-xl bg-white p-6 shadow-xl max-w-md w-full mx-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog"
			tabindex="0"
		>
			<h3 class="text-xl font-bold text-gray-900 mb-1">Nueva Configuración</h3>
			<p class="text-sm text-gray-500 mb-5">Año: {anioSeleccionado}</p>

			<div class="space-y-4">
				<div>
					<label for="crear-nombre" class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
					<input
						id="crear-nombre"
						type="text"
						bind:value={crearForm.nombre}
						placeholder="Ej: Auxilio de transporte"
						class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
					/>
				</div>

				<div>
					<label for="crear-valor" class="block text-sm font-medium text-gray-700 mb-1">Valor</label>
					<input
						id="crear-valor"
						type="number"
						step="0.01"
						bind:value={crearForm.valor}
						placeholder="0"
						class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
					/>
				</div>

				<div>
					<label for="crear-tipo" class="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
					<select
						id="crear-tipo"
						bind:value={crearForm.tipo}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
					>
						{#each tiposConfig as tipo}
							<option value={tipo}>{tipo}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="mt-6 flex gap-3 justify-end">
				<button
					on:click={() => (showCrearModal = false)}
					class="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 transition-colors"
				>
					Cancelar
				</button>
				<button
					on:click={handleCrear}
					class="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-white font-semibold hover:shadow-lg transition-all"
				>
					<span class="flex items-center gap-2">
						<Save class="h-4 w-4" />
						Guardar
					</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL DUPLICAR ==================== -->
{#if showDuplicarModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		on:click={() => (showDuplicarModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showDuplicarModal = false)}
		role="button"
		tabindex="-1"
	>
		<div
			class="rounded-xl bg-white p-6 shadow-xl max-w-md w-full mx-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog"
			tabindex="0"
		>
			<h3 class="text-xl font-bold text-gray-900 mb-1">Duplicar Configuraciones</h3>
			<p class="text-sm text-gray-500 mb-5">
				Clonar todas las configuraciones del año {anioSeleccionado} a un nuevo año
			</p>

			<div class="space-y-4">
				<div class="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
					<Calendar class="h-5 w-5 text-emerald-600" />
					<div>
						<p class="text-sm font-medium text-emerald-800">Año origen</p>
						<p class="text-lg font-bold text-emerald-900">{anioSeleccionado}</p>
					</div>
					<span class="mx-2 text-gray-400">→</span>
					<div>
						<p class="text-sm font-medium text-emerald-800">Año destino</p>
						<input
							type="number"
							bind:value={anioDestino}
							min="2020"
							max="2050"
							class="w-24 rounded-lg border border-emerald-300 px-2 py-1 text-lg font-bold text-emerald-900 text-center focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
						/>
					</div>
				</div>

				<p class="text-xs text-gray-500">
					Se crearán <span class="font-semibold">{configuraciones.length}</span> configuraciones nuevas con los mismos valores.
					Podrás modificarlas después individualmente.
				</p>
			</div>

			<div class="mt-6 flex gap-3 justify-end">
				<button
					on:click={() => (showDuplicarModal = false)}
					class="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 transition-colors"
				>
					Cancelar
				</button>
				<button
					on:click={handleDuplicar}
					disabled={duplicando}
					class="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-white font-semibold hover:shadow-lg transition-all disabled:opacity-50"
				>
					{#if duplicando}
						<span class="flex items-center gap-2">
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
							Duplicando...
						</span>
					{:else}
						<span class="flex items-center gap-2">
							<Copy class="h-4 w-4" />
							Duplicar
						</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL ELIMINAR ==================== -->
{#if showDeleteModal && configToDelete}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		on:click={() => (showDeleteModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="button"
		tabindex="-1"
	>
		<div
			class="rounded-xl bg-white p-6 shadow-xl max-w-md w-full mx-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog"
			tabindex="0"
		>
			<h3 class="text-xl font-bold text-gray-900 mb-4">Confirmar eliminación</h3>
			<p class="text-gray-600 mb-2">
				¿Eliminar la configuración <span class="font-semibold">"{configToDelete.nombre}"</span>?
			</p>
			<p class="text-sm text-gray-500 mb-6">
				Valor actual: <span class="font-semibold">{formatValor(configToDelete)}</span> · Año: {configToDelete.anio}
			</p>
			<div class="flex gap-3 justify-end">
				<button
					on:click={() => (showDeleteModal = false)}
					class="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100"
				>
					Cancelar
				</button>
				<button
					on:click={handleEliminar}
					class="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
				>
					Eliminar
				</button>
			</div>
		</div>
	</div>
{/if}
