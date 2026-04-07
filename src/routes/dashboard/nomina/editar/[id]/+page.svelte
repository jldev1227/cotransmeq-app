<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { obtenerLiquidacionPorId, editarLiquidacion } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';
	import LiquidacionFormComplete from '$lib/components/nomina/LiquidacionFormComplete.svelte';
	import type { Liquidacion } from '$lib/types/nomina';

	let liquidacion: Liquidacion | null = null;
	let loading = false;
	let loadingData = true;

	$: liquidacionId = $page.params.id;

	onMount(async () => {
		await cargarLiquidacion();
	});

	async function cargarLiquidacion() {
		try {
			loadingData = true;
			const response = await obtenerLiquidacionPorId(liquidacionId);
			liquidacion = response.data;
		} catch (error: any) {
			console.error('Error cargando liquidación:', error);
			toast.error('Error al cargar la liquidación');
			goto('/dashboard/nomina');
		} finally {
			loadingData = false;
		}
	}

	async function handleSubmit(data: any) {
		try {
			loading = true;
			await editarLiquidacion(liquidacionId, data);
			toast.success('Liquidación actualizada correctamente');
			goto('/dashboard/nomina');
		} catch (error: any) {
			console.error('Error actualizando liquidación:', error);
			toast.error(error.response?.data?.message || 'Error al actualizar la liquidación');
		} finally {
			loading = false;
		}
	}

	function formatCurrency(value: number | undefined): string {
		if (value === undefined || value === null) return '$0';
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	function formatDate(dateStr: string | undefined): string {
		if (!dateStr) return '—';
		return new Date(dateStr).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatPeriodo(inicio: string | undefined, fin: string | undefined): string {
		if (!inicio || !fin) return '—';
		const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
		const from = new Date(inicio).toLocaleDateString('es-CO', opts);
		const to = new Date(fin).toLocaleDateString('es-CO', opts);
		return `${from} — ${to}`;
	}

	function getEstadoConfig(estado: string | undefined) {
		switch (estado) {
			case 'liquidada':
				return { label: 'Liquidada', bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' };
			case 'pendiente':
				return { label: 'Pendiente', bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' };
			case 'anulada':
				return { label: 'Anulada', bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' };
			case 'borrador':
				return { label: 'Borrador', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' };
			default:
				return { label: estado || 'Sin estado', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' };
		}
	}
</script>

<svelte:head>
	<title>Editar Liquidación - Cotransmeq</title>
</svelte:head>

{#if loadingData}
	<div class="flex items-center justify-center min-h-screen">
		<div class="text-center">
			<div
				class="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"
			></div>
			<p class="mt-4 text-gray-600">Cargando liquidación...</p>
		</div>
	</div>
{:else if liquidacion}
	{@const estado = getEstadoConfig(liquidacion.estado)}

	<!-- Header informativo de la liquidación -->
	<div class="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm">
		<div class="mx-auto max-w-[1800px] px-4 py-3 md:px-6">
			<!-- Fila principal -->
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<!-- Izquierda: Conductor + documento -->
				<div class="flex items-center gap-3">
					<button
						on:click={() => goto('/dashboard/nomina')}
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
						title="Volver al listado"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>

					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
					</div>

					<div>
						<h1 class="text-base font-bold text-gray-900 md:text-lg leading-tight">
							{liquidacion.conductor?.nombre || 'Conductor sin nombre'}
						</h1>
						<div class="flex items-center gap-2 text-xs text-gray-500">
							<span class="flex items-center gap-1">
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
								</svg>
								C.C. {liquidacion.conductor?.cedula || '—'}
							</span>
							<span class="text-gray-300">|</span>
							<span class="font-medium text-gray-600">Editando liquidación</span>
						</div>
					</div>
				</div>

				<!-- Derecha: Métricas -->
				<div class="flex flex-wrap items-center gap-2 md:gap-3">
					<!-- Periodo -->
					<div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
						<svg class="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
						<div class="text-xs">
							<div class="text-gray-400 leading-none">Período</div>
							<div class="font-semibold text-gray-700 leading-tight">{formatPeriodo(liquidacion.periodo_inicio, liquidacion.periodo_fin)}</div>
						</div>
					</div>

					<!-- Fecha liquidación -->
					<div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
						<svg class="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<div class="text-xs">
							<div class="text-gray-400 leading-none">Fecha liquidación</div>
							<div class="font-semibold text-gray-700 leading-tight">{formatDate(liquidacion.fecha_liquidacion)}</div>
						</div>
					</div>

					<!-- Neto pagado -->
					<div class="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5">
						<svg class="h-3.5 w-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<div class="text-xs">
							<div class="text-orange-600/70 leading-none">Neto anterior</div>
							<div class="font-bold text-orange-700 leading-tight">{formatCurrency(liquidacion.neto_pagado)}</div>
						</div>
					</div>

					<!-- Estado -->
					<div class="flex items-center gap-1.5 rounded-full {estado.bg} px-3 py-1.5">
						<span class="h-2 w-2 rounded-full {estado.dot}"></span>
						<span class="text-xs font-semibold {estado.text}">{estado.label}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<LiquidacionFormComplete mode="edit" initialData={liquidacion} onSubmit={handleSubmit} {loading} />
{:else}
	<div class="text-center py-12">
		<p class="text-gray-600">No se encontró la liquidación</p>
		<button
			on:click={() => goto('/dashboard/nomina')}
			class="mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
		>
			Volver al listado
		</button>
	</div>
{/if}
