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
			const response = await obtenerLiquidacionPorId(liquidacionId ?? '');
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
			await editarLiquidacion(liquidacionId ?? '', data);
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

		// ✅ Forzar parsing local agregando T00:00:00 o separando partes
		const [iy, im, id] = inicio.split('-').map(Number);
		const [fy, fm, fd] = fin.split('-').map(Number);

		const from = new Date(iy, im - 1, id).toLocaleDateString('es-CO', opts);
		const to = new Date(fy, fm - 1, fd).toLocaleDateString('es-CO', opts);

		return `${from} — ${to}`;
	}

	function getEstadoConfig(estado: string | undefined) {
		switch (estado) {
			case 'liquidada':
				return {
					label: 'Liquidada',
					bg: 'bg-[rgba(16,185,129,0.12)]',
					text: 'text-[var(--emerald-700)]',
					dot: 'bg-[var(--emerald-500)]'
				};
			case 'pendiente':
				return {
					label: 'Pendiente',
					bg: 'bg-[rgba(245,158,11,0.12)]',
					text: 'text-[#92400E]',
					dot: 'bg-[#F59E0B]'
				};
			case 'anulada':
				return {
					label: 'Anulada',
					bg: 'bg-[rgba(220,38,38,0.12)]',
					text: 'text-[#991B1B]',
					dot: 'bg-[#DC2626]'
				};
			case 'borrador':
				return {
					label: 'Borrador',
					bg: 'bg-[var(--bg-base)]',
					text: 'text-[var(--text-secondary)]',
					dot: 'bg-[var(--text-very-muted)]'
				};
			default:
				return {
					label: estado || 'Sin estado',
					bg: 'bg-[var(--bg-base)]',
					text: 'text-[var(--text-secondary)]',
					dot: 'bg-[var(--text-very-muted)]'
				};
		}
	}
</script>

<svelte:head>
	<title>Editar Liquidación - Cotransmeq (NIT 901983227)</title>
</svelte:head>

{#if loadingData}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="spinner mx-auto mb-4"></div>
			<p class="text-sm text-[var(--text-muted)]">Cargando liquidación...</p>
		</div>
	</div>
{:else if liquidacion}
	{@const estado = getEstadoConfig(liquidacion.estado)}

	<!-- Header informativo de la liquidación -->
	<div
		class="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-white/95 shadow-[var(--shadow-card)] backdrop-blur-sm"
	>
		<div class="mx-auto max-w-[1800px] px-4 py-3 md:px-6">
			<!-- Fila principal -->
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<!-- Izquierda: Conductor + documento -->
				<div class="flex items-center gap-3">
					<button
						on:click={() => goto('/dashboard/nomina')}
						class="apple-transition flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-white text-[var(--text-muted)] hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
						title="Volver al listado"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/>
						</svg>
					</button>

					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(16,185,129,0.12)] text-[var(--emerald-700)]"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
							/>
						</svg>
					</div>

					<div>
						<h1
							class="font-display text-base leading-tight font-medium tracking-tight text-[var(--text-primary)] md:text-lg"
						>
							{liquidacion.conductor?.nombre || 'Conductor sin nombre'}
						</h1>
						<div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
							<span class="flex items-center gap-1">
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
									/>
								</svg>
								C.C. {liquidacion.conductor?.cedula || '—'}
							</span>
							<span class="text-[var(--text-very-muted)]">|</span>
							<span class="font-mono-meta text-[0.65rem] text-[var(--text-secondary)]"
								>Editando liquidación</span
							>
						</div>
					</div>
				</div>

				<!-- Derecha: Métricas -->
				<div class="flex flex-wrap items-center gap-2 md:gap-3">
					<!-- Periodo -->
					<div
						class="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5"
					>
						<svg
							class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
						<div class="text-xs">
							<div class="font-mono-meta text-[0.6rem] leading-none text-[var(--text-muted)]">
								Período
							</div>
							<div class="leading-tight font-semibold text-[var(--text-primary)]">
								{formatPeriodo(liquidacion.periodo_inicio, liquidacion.periodo_fin)}
							</div>
						</div>
					</div>

					<!-- Fecha liquidación -->
					<div
						class="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5"
					>
						<svg
							class="h-3.5 w-3.5 text-[var(--text-very-muted)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<div class="text-xs">
							<div class="font-mono-meta text-[0.6rem] leading-none text-[var(--text-muted)]">
								Fecha liquidación
							</div>
							<div class="leading-tight font-semibold text-[var(--text-primary)]">
								{formatDate(liquidacion.fecha_liquidacion)}
							</div>
						</div>
					</div>

					<!-- Neto pagado -->
					<div
						class="flex items-center gap-2 rounded-xl border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.08)] px-3 py-1.5"
					>
						<svg
							class="h-3.5 w-3.5 text-[var(--emerald-500)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<div class="text-xs">
							<div class="font-mono-meta text-[0.6rem] leading-none text-[var(--emerald-700)]/80">
								Neto anterior
							</div>
							<div class="leading-tight font-bold text-[var(--emerald-700)]">
								{formatCurrency(liquidacion.neto_pagado)}
							</div>
						</div>
					</div>

					<!-- Estado -->
					<div
						class="status-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 {estado.bg}"
					>
						<span class="h-1.5 w-1.5 rounded-full {estado.dot}"></span>
						<span class="{estado.text}">{estado.label}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<LiquidacionFormComplete
		mode="edit"
		initialData={liquidacion}
		onSubmit={handleSubmit}
		{loading}
	/>
{:else}
	<div class="py-12 text-center">
		<p class="text-[var(--text-muted)]">No se encontró la liquidación</p>
		<button
			on:click={() => goto('/dashboard/nomina')}
			class="btn-primary apple-transition mt-4"
		>
			Volver al listado
		</button>
	</div>
{/if}
