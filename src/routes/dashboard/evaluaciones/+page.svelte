<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';

	interface Evaluacion {
		id: string;
		titulo: string;
		descripcion: string | null;
		requiere_firma: boolean;
		created_at: string;
		updated_at: string;
		preguntas: Pregunta[];
	}

	interface Pregunta {
		id: string;
		texto: string;
		tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION';
		puntaje: number;
		opciones: Opcion[];
	}

	interface Opcion {
		id: string;
		texto: string;
		esCorrecta: boolean;
	}

	let evaluaciones: Evaluacion[] = [];
	let isLoading = false;
	let error: string | null = null;

	onMount(() => {
		loadEvaluaciones();
	});

	async function loadEvaluaciones() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones`);
			const data = await response.json();
			if (data.success) {
				evaluaciones = data.data;
			} else {
				error = 'Error al cargar evaluaciones';
			}
		} catch (err: any) {
			error = err.message || 'Error al cargar evaluaciones';
			console.error('Error:', err);
		} finally {
			isLoading = false;
		}
	}

	function getTipoColor(tipo: string) {
		const colors: Record<string, string> = {
			OPCION_UNICA: 'bg-blue-100 text-blue-800',
			OPCION_MULTIPLE: 'bg-purple-100 text-purple-800',
			NUMERICA: 'bg-orange-100 text-orange-800',
			TEXTO: 'bg-orange-100 text-orange-800',
			RELACION: 'bg-pink-100 text-pink-800'
		};
		return colors[tipo] || 'bg-gray-100 text-gray-800';
	}

	function getTipoLabel(tipo: string) {
		const labels: Record<string, string> = {
			OPCION_UNICA: 'Opción Única',
			OPCION_MULTIPLE: 'Opción Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación'
		};
		return labels[tipo] || tipo;
	}

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function calcularPuntajeTotal(evaluacion: Evaluacion) {
		return evaluacion.preguntas.reduce((sum, p) => sum + p.puntaje, 0);
	}

	function navigateToCrear() {
		goto('/dashboard/evaluaciones/crear');
	}

	function navigateToDetalle(id: string) {
		goto(`/dashboard/evaluaciones/${id}`);
	}

	async function deleteEvaluacion(id: string, titulo: string) {
		if (!confirm(`¿Estás seguro de eliminar la evaluación "${titulo}"?`)) return;
		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones/${id}`, {
				method: 'DELETE'
			});
			if (response.ok) {
				evaluaciones = evaluaciones.filter((e) => e.id !== id);
			} else {
				alert('Error al eliminar la evaluación');
			}
		} catch (err) {
			console.error('Error:', err);
			alert('Error al eliminar la evaluación');
		}
	}
</script>

<svelte:head>
	<title>Evaluaciones - Cotransmeq</title>
</svelte:head>

<div class="space-y-8 p-6">
	<!-- Header -->
	<div
		class="glass rounded-3xl border border-orange-200/30 bg-gradient-to-r from-orange-50/50 to-amber-50/50 p-8"
		in:fade={{ duration: 600 }}
	>
		<div class="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
			<div class="flex-1">
				<div class="mb-2 flex items-center gap-3">
					<div
						class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg"
					>
						<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div>
						<h1 class="text-3xl font-bold text-gray-900">Evaluaciones</h1>
						<p class="text-gray-600">Gestión de evaluaciones y formularios</p>
					</div>
				</div>

				<!-- Métricas -->
				<div class="mt-4 flex flex-wrap gap-4">
					<div class="rounded-lg bg-white/60 px-4 py-2 backdrop-blur-sm">
						<div class="text-2xl font-bold text-orange-600">{evaluaciones.length}</div>
						<div class="text-xs text-gray-600">Evaluaciones</div>
					</div>
				</div>
			</div>

			<button
				on:click={navigateToCrear}
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
			>
				<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
				Nueva Evaluación
			</button>
		</div>
	</div>

	<!-- Lista de Evaluaciones -->
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="text-center">
				<div
					class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"
				></div>
				<p class="text-gray-600">Cargando evaluaciones...</p>
			</div>
		</div>
	{:else if error}
		<div class="glass rounded-2xl border border-red-200/50 bg-red-50/30 p-8 text-center">
			<div class="mb-4 text-red-500">
				<svg class="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<h3 class="mb-2 text-lg font-semibold text-gray-900">Error al cargar evaluaciones</h3>
			<p class="mb-6 text-gray-600">{error}</p>
			<button
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
				on:click={loadEvaluaciones}
			>
				Reintentar
			</button>
		</div>
	{:else if evaluaciones.length === 0}
		<div class="glass rounded-2xl border border-gray-200/50 p-12 text-center">
			<svg
				class="mx-auto mb-4 h-16 w-16 text-gray-400"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
				/>
			</svg>
			<h3 class="mb-2 text-lg font-semibold text-gray-900">No hay evaluaciones</h3>
			<p class="mb-6 text-gray-600">Crea tu primera evaluación para comenzar</p>
			<button
				on:click={navigateToCrear}
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
			>
				<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
				Crear Evaluación
			</button>
		</div>
	{:else}
		<div
			class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
			in:fly={{ y: 20, duration: 600, delay: 400 }}
		>
			{#each evaluaciones as evaluacion (evaluacion.id)}
				<div
					class="glass apple-transition group relative overflow-hidden rounded-2xl border border-gray-200/50 p-6 hover:shadow-lg"
					in:fade={{ duration: 300 }}
				>
					<!-- Badge de firma requerida -->
					{#if evaluacion.requiere_firma}
						<div class="absolute top-4 right-4">
							<span
								class="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-800"
							>
								<svg
									class="mr-1 inline h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
									/>
								</svg>
								Firma
							</span>
						</div>
					{/if}

					<!-- Título y descripción -->
					<div class="mb-4 cursor-pointer" on:click={() => navigateToDetalle(evaluacion.id)}>
						<h3 class="mb-2 text-xl font-bold text-gray-900">{evaluacion.titulo}</h3>
						{#if evaluacion.descripcion}
							<p class="line-clamp-2 text-sm text-gray-600">{evaluacion.descripcion}</p>
						{/if}
					</div>

					<!-- Estadísticas -->
					<div class="mb-4 grid grid-cols-2 gap-4">
						<div class="rounded-lg bg-orange-50 p-3">
							<div class="text-2xl font-bold text-orange-600">
								{evaluacion.preguntas.length}
							</div>
							<div class="text-xs text-gray-600">Preguntas</div>
						</div>
						<div class="rounded-lg bg-blue-50 p-3">
							<div class="text-2xl font-bold text-blue-600">
								{calcularPuntajeTotal(evaluacion)}
							</div>
							<div class="text-xs text-gray-600">Puntos</div>
						</div>
					</div>

					<!-- Tipos de preguntas -->
					<div class="mb-4">
						<div class="mb-2 text-xs font-semibold text-gray-500">Tipos de preguntas:</div>
						<div class="flex flex-wrap gap-1">
							{#each [...new Set(evaluacion.preguntas.map((p) => p.tipo))] as tipo}
								<span class="rounded-full px-2 py-1 text-xs {getTipoColor(tipo)}">
									{getTipoLabel(tipo)}
								</span>
							{/each}
						</div>
					</div>

					<!-- Fecha -->
					<div class="mb-4 text-xs text-gray-500">
						Creada: {formatDate(evaluacion.created_at)}
					</div>

					<!-- Acciones -->
					<div class="flex gap-2">
						<button
							on:click={() => navigateToDetalle(evaluacion.id)}
							class="apple-transition flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
						>
							Ver Detalle
						</button>
						<button
							on:click={() => deleteEvaluacion(evaluacion.id, evaluacion.titulo)}
							class="apple-transition rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
