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

	$: liquidacionId = $page.params.id as string;

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
