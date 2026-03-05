<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { obtenerLiquidacionPorId } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';
	import type { Liquidacion } from '$lib/types/nomina';
	import { FileText, Calendar, User, Truck, DollarSign, Download, Mail, ArrowLeft } from 'lucide-svelte';

	let liquidacion: Liquidacion | null = null;
	let loading = true;

	$: liquidacionId = $page.params.id as string;

	onMount(async () => {
		await cargarLiquidacion();
	});

	async function cargarLiquidacion() {
		try {
			loading = true;
			const response = await obtenerLiquidacionPorId(liquidacionId);
			liquidacion = response.data;
		} catch (error: any) {
			console.error('Error cargando liquidación:', error);
			toast.error('Error al cargar la liquidación');
			goto('/dashboard/nomina');
		} finally {
			loading = false;
		}
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(amount);
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function imprimirDesprendible() {
		window.print();
	}
</script>

<svelte:head>
	<title>Desprendible de Pago - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-6">
	{#if loading}
		<div class="flex items-center justify-center min-h-screen">
			<div class="text-center">
				<div
					class="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"
				></div>
				<p class="mt-4 text-gray-600">Cargando desprendible...</p>
			</div>
		</div>
	{:else if liquidacion}
		<div class="max-w-4xl mx-auto">
			<!-- Botones de acción (no se imprimen) -->
			<div class="flex items-center justify-between mb-6 print:hidden">
				<button
					on:click={() => goto('/dashboard/nomina')}
					class="flex items-center gap-2 text-gray-600 hover:text-gray-900"
				>
					<ArrowLeft class="h-5 w-5" />
					Volver
				</button>
				<div class="flex gap-2">
					<button
						on:click={imprimirDesprendible}
						class="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
					>
						<Download class="h-4 w-4" />
						Imprimir/Guardar PDF
					</button>
				</div>
			</div>

			<!-- Desprendible de pago -->
			<div class="bg-white shadow-lg rounded-xl p-8 print:shadow-none">
				<!-- Header -->
				<div class="border-b-2 border-orange-600 pb-4 mb-6">
					<h1 class="text-3xl font-bold text-gray-900">DESPRENDIBLE DE PAGO</h1>
					<p class="text-gray-600 mt-1">Cotransmeq S.A.S.</p>
				</div>

				<!-- Información del conductor -->
				<div class="mb-6">
					<h2 class="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
						<User class="h-5 w-5 text-orange-600" />
						Información del Conductor
					</h2>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<p class="text-gray-600">Nombre:</p>
							<p class="font-medium">{liquidacion.conductor?.nombre || 'N/A'}</p>
						</div>
						<div>
							<p class="text-gray-600">Cédula:</p>
							<p class="font-medium">{liquidacion.conductor?.cedula || 'N/A'}</p>
						</div>
						<div>
							<p class="text-gray-600">Período:</p>
							<p class="font-medium">
								{formatDate(liquidacion.periodo_inicio)} - {formatDate(liquidacion.periodo_fin)}
							</p>
						</div>
						<div>
							<p class="text-gray-600">Días Laborados:</p>
							<p class="font-medium">{liquidacion.dias_laborados}</p>
						</div>
					</div>
				</div>

				<!-- Vehículos -->
				{#if liquidacion.vehiculos && liquidacion.vehiculos.length > 0}
					<div class="mb-6">
						<h2 class="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
							<Truck class="h-5 w-5 text-orange-600" />
							Vehículos Asignados
						</h2>
						<div class="flex flex-wrap gap-2">
							{#each liquidacion.vehiculos as vehiculo}
								<span
									class="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium"
								>
									{vehiculo.placa}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Devengado -->
				<div class="mb-6">
					<h2 class="text-lg font-semibold text-gray-900 mb-3 bg-green-50 p-2 rounded">
						Devengado
					</h2>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between py-2 border-b">
							<span class="text-gray-600">Salario Base</span>
							<span class="font-medium">{formatCurrency(liquidacion.salario_base || 0)}</span>
						</div>
						{#if liquidacion.total_bonificaciones > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Bonificaciones</span>
								<span class="font-medium"
									>{formatCurrency(liquidacion.total_bonificaciones)}</span
								>
							</div>
						{/if}
						{#if liquidacion.total_pernotes > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Pernotes</span>
								<span class="font-medium">{formatCurrency(liquidacion.total_pernotes)}</span>
							</div>
						{/if}
						{#if liquidacion.total_recargos > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Recargos</span>
								<span class="font-medium">{formatCurrency(liquidacion.total_recargos)}</span>
							</div>
						{/if}
						{#if liquidacion.auxilio_transporte > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Auxilio de Transporte</span>
								<span class="font-medium"
									>{formatCurrency(liquidacion.auxilio_transporte)}</span
								>
							</div>
						{/if}
						{#if liquidacion.cesantias && liquidacion.cesantias > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Cesantías</span>
								<span class="font-medium">{formatCurrency(liquidacion.cesantias)}</span>
							</div>
						{/if}
						{#if liquidacion.interes_cesantias && liquidacion.interes_cesantias > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Intereses Cesantías</span>
								<span class="font-medium"
									>{formatCurrency(liquidacion.interes_cesantias)}</span
								>
							</div>
						{/if}
						{#if liquidacion.prima && liquidacion.prima > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Prima</span>
								<span class="font-medium">{formatCurrency(liquidacion.prima)}</span>
							</div>
						{/if}
						<div class="flex justify-between py-2 font-bold text-lg">
							<span>Total Devengado</span>
							<span class="text-green-600"
								>{formatCurrency(liquidacion.total_devengado || 0)}</span
							>
						</div>
					</div>
				</div>

				<!-- Deducciones -->
				<div class="mb-6">
					<h2 class="text-lg font-semibold text-gray-900 mb-3 bg-red-50 p-2 rounded">
						Deducciones
					</h2>
					<div class="space-y-2 text-sm">
						{#if liquidacion.salud > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Salud (4%)</span>
								<span class="font-medium">{formatCurrency(liquidacion.salud)}</span>
							</div>
						{/if}
						{#if liquidacion.pension > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Pensión (4%)</span>
								<span class="font-medium">{formatCurrency(liquidacion.pension)}</span>
							</div>
						{/if}
						{#if liquidacion.total_mantenimientos > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Mantenimientos</span>
								<span class="font-medium"
									>{formatCurrency(liquidacion.total_mantenimientos)}</span
								>
							</div>
						{/if}
						{#if liquidacion.total_anticipos > 0}
							<div class="flex justify-between py-2 border-b">
								<span class="text-gray-600">Anticipos</span>
								<span class="font-medium">{formatCurrency(liquidacion.total_anticipos)}</span>
							</div>
						{/if}
						<div class="flex justify-between py-2 font-bold text-lg">
							<span>Total Deducido</span>
							<span class="text-red-600"
								>{formatCurrency(liquidacion.total_deducido || 0)}</span
							>
						</div>
					</div>
				</div>

				<!-- Neto a pagar -->
				<div class="bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg p-6">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-orange-100 mb-1">Neto a Pagar</p>
							<p class="text-4xl font-bold">
								{formatCurrency(liquidacion.neto_pagado || 0)}
							</p>
						</div>
						<DollarSign class="h-16 w-16 text-orange-100" />
					</div>
				</div>

				<!-- Footer -->
				<div class="mt-8 pt-6 border-t text-center text-sm text-gray-500">
					<p>Este desprendible es un documento informativo</p>
					<p class="mt-1">Generado el {new Date().toLocaleDateString('es-CO')}</p>
				</div>
			</div>
		</div>
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
</div>

<style>
	@media print {
		body {
			background: white;
		}
		:global(.print\:hidden) {
			display: none !important;
		}
		:global(.print\:shadow-none) {
			box-shadow: none !important;
		}
	}
</style>
