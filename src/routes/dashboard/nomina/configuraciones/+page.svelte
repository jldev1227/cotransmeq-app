<script lang="ts">
	import type { PageData } from './$types';
	import ConfiguracionesView from '$lib/components/nomina/ConfiguracionesView.svelte';

	let { data }: { data: PageData } = $props();
	const anio = data.anioInicial ?? new Date().getFullYear();
	const mes = data.mesInicial ?? new Date().getMonth() + 1;
	const volverAlCanvas = `/dashboard/nomina/canvas?anio=${anio}&mes=${mes}`;
</script>

<svelte:head>
	<title>Configuración de nómina · Cotransmeq</title>
</svelte:head>

<div class="space-y-5 p-4 sm:p-6">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<p class="text-sm font-medium text-gray-500">Nómina · Valores anuales</p>
			<h1 class="mt-1 text-2xl font-bold text-gray-900">Configuración de nómina</h1>
			<p class="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
				Edita aquí «Salario villanueva» y «Auxilio de transporte». Se guardan por año y se usan
				al generar borradores y recalcular liquidaciones de ese periodo. La nivelación toma la
				diferencia entre «Salario villanueva» y «Salario básico», y la prorratea por días. Para
				ajustar una sola liquidación, cambia «Salario básico» en la fila del desprendible.
			</p>
		</div>
		<a
			href={volverAlCanvas}
			class="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
		>
			Volver al canvas
		</a>
	</header>

	<ConfiguracionesView anioInicial={anio} />
</div>
