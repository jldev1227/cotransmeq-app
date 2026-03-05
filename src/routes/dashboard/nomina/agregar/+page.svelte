<script lang="ts">
	import { goto } from '$app/navigation';
	import { crearLiquidacion } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';
	import LiquidacionFormComplete from '$lib/components/nomina/LiquidacionFormComplete.svelte';

	let loading = false;

	async function handleSubmit(data: any) {
		try {
			loading = true;
			await crearLiquidacion(data);
			toast.success('Liquidación creada correctamente');
			goto('/dashboard/nomina');
		} catch (error: any) {
			console.error('Error creando liquidación:', error);
			toast.error(error.response?.data?.message || 'Error al crear la liquidación');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Nueva Liquidación - Cotransmeq</title>
</svelte:head>

<LiquidacionFormComplete mode="create" onSubmit={handleSubmit} {loading} />
