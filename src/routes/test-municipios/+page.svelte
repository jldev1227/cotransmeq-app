<script lang="ts">
	import { onMount } from 'svelte';
	import {
		municipios,
		municipiosOptions,
		departamentos,
		departamentosOptions
	} from '$lib/stores/municipios';

	let selectedDepartamento: number | null = null;
	let searchTerm = '';
	let loading = false;

	onMount(async () => {
		// Cargar todos los municipios al iniciar
		await municipios.cargarTodos();
	});

	async function handleDepartamentoChange() {
		if (selectedDepartamento) {
			loading = true;
			try {
				await municipios.cargarPorDepartamento(selectedDepartamento);
			} catch (error) {
				console.error('Error cargando municipios:', error);
			} finally {
				loading = false;
			}
		}
	}

	async function handleBuscar() {
		if (!searchTerm) return;

		loading = true;
		try {
			const result = await municipios.buscar({
				nombre: searchTerm,
				page: 1,
				limit: 50
			});
			console.log('Resultados de búsqueda:', result);
		} catch (error) {
			console.error('Error buscando:', error);
		} finally {
			loading = false;
		}
	}
</script>

<div class="container mx-auto max-w-4xl p-8">
	<div class="mb-8">
		<h1 class="mb-2 text-3xl font-bold text-gray-900">Prueba de Store de Municipios</h1>
		<p class="text-gray-600">Verificación de la integración del endpoint de municipios</p>
	</div>

	<!-- Stats -->
	<div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
		<div class="rounded-xl border-2 border-orange-200 bg-orange-50 p-4">
			<div class="text-sm font-medium text-orange-600">Total Municipios</div>
			<div class="mt-1 text-2xl font-bold text-orange-900">
				{$municipiosOptions.length}
			</div>
		</div>

		<div class="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
			<div class="text-sm font-medium text-blue-600">Departamentos</div>
			<div class="mt-1 text-2xl font-bold text-blue-900">
				{$departamentos.length}
			</div>
		</div>

		<div class="rounded-xl border-2 border-purple-200 bg-purple-50 p-4">
			<div class="text-sm font-medium text-purple-600">Estado</div>
			<div class="mt-1 text-2xl font-bold text-purple-900">
				{loading ? '⏳ Cargando...' : '✅ Listo'}
			</div>
		</div>
	</div>

	<!-- Búsqueda -->
	<div class="mb-6 rounded-xl border-2 border-gray-200 bg-white p-6">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">Buscar Municipio</h2>
		<div class="flex gap-3">
			<input
				type="text"
				bind:value={searchTerm}
				placeholder="Escribe el nombre del municipio..."
				class="flex-1 rounded-xl border-2 border-gray-200 px-4 py-2.5 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
				on:keydown={(e) => e.key === 'Enter' && handleBuscar()}
			/>
			<button
				on:click={handleBuscar}
				disabled={loading || !searchTerm}
				class="rounded-xl bg-orange-500 px-6 py-2.5 font-semibold text-white transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{loading ? 'Buscando...' : 'Buscar'}
			</button>
		</div>
	</div>

	<!-- Filtro por departamento -->
	<div class="mb-6 rounded-xl border-2 border-gray-200 bg-white p-6">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">Filtrar por Departamento</h2>
		<select
			bind:value={selectedDepartamento}
			on:change={handleDepartamentoChange}
			class="w-full rounded-xl border-2 border-gray-200 px-4 py-2.5 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
		>
			<option value={null}>Todos los departamentos</option>
			{#each $departamentosOptions as dept}
				<option value={dept.value}>{dept.label}</option>
			{/each}
		</select>
	</div>

	<!-- Lista de municipios -->
	<div class="rounded-xl border-2 border-gray-200 bg-white p-6">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">
			Lista de Municipios
			<span class="text-sm font-normal text-gray-500">({$municipiosOptions.length} total)</span>
		</h2>

		<div class="max-h-96 space-y-2 overflow-y-auto">
			{#each $municipiosOptions.slice(0, 50) as municipio}
				<div
					class="rounded-lg border border-gray-200 bg-gray-50 p-3 transition-all hover:border-orange-300 hover:bg-orange-50"
				>
					<div class="font-medium text-gray-900">{municipio.label}</div>
					<div class="text-xs text-gray-500">ID: {municipio.value}</div>
				</div>
			{/each}

			{#if $municipiosOptions.length > 50}
				<div class="text-center text-sm text-gray-500">
					... y {$municipiosOptions.length - 50} municipios más
				</div>
			{/if}
		</div>
	</div>

	<!-- Departamentos -->
	<div class="mt-6 rounded-xl border-2 border-gray-200 bg-white p-6">
		<h2 class="mb-4 text-xl font-semibold text-gray-900">
			Departamentos Disponibles
			<span class="text-sm font-normal text-gray-500">({$departamentos.length} total)</span>
		</h2>

		<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
			{#each $departamentos as dept}
				<div
					class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center transition-all hover:border-orange-300 hover:bg-orange-50"
				>
					<div class="text-sm font-medium text-gray-900">{dept.nombre}</div>
					<div class="text-xs text-gray-500">Código: {dept.codigo}</div>
				</div>
			{/each}
		</div>
	</div>
</div>
