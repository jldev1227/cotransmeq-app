<script lang="ts">
	import { goto } from '$app/navigation';
	import { crearLiquidacion } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import LiquidacionFormComplete from '$lib/components/nomina/LiquidacionFormComplete.svelte';
	import { ArrowLeft } from 'lucide-svelte';

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

<div
	class="min-h-screen p-4 sm:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<LiquidacionFormComplete mode="create" onSubmit={handleSubmit} {loading} />
</div>
