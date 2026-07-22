<script lang="ts">
	import type { ValoracionRiesgo } from '$lib/api/acciones-correctivas';
	import { createEventDispatcher } from 'svelte';

	export let value: ValoracionRiesgo | '' = '';
	export let disabled = false;

	const dispatch = createEventDispatcher<{ select: ValoracionRiesgo }>();

	const options: { value: ValoracionRiesgo; label: string; bg: string; border: string; text: string; hover: string; ring: string; description: string }[] = [
		{
			value: 'ALTO',
			label: 'ALTO',
			bg: 'bg-red-50',
			border: 'border-red-200',
			text: 'text-red-700',
			hover: 'hover:bg-red-100',
			ring: 'ring-red-500',
			description: 'Requiere atención inmediata'
		},
		{
			value: 'MEDIO',
			label: 'MEDIO',
			bg: 'bg-amber-50',
			border: 'border-amber-200',
			text: 'text-amber-700',
			hover: 'hover:bg-amber-100',
			ring: 'ring-amber-500',
			description: 'Riesgo moderado'
		},
		{
			value: 'BAJO',
			label: 'BAJO',
			bg: 'bg-orange-50',
			border: 'border-orange-200',
			text: 'text-orange-700',
			hover: 'hover:bg-orange-100',
			ring: 'ring-orange-500',
			description: 'Riesgo bajo'
		}
	];

	function select(val: ValoracionRiesgo) {
		if (disabled) return;
		value = val;
		dispatch('select', val);
	}
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
	{#each options as opt}
		<button
			type="button"
			class="flex flex-col items-center rounded-[var(--fm-radius-lg)] border-2 p-4 transition-all {opt.bg} {opt.border} {opt.text} {opt.hover} {value ===
			opt.value
				? `ring-2 ring-offset-2 ${opt.ring} scale-[1.02] shadow-md`
				: 'opacity-70 grayscale-[0.3] hover:opacity-100 hover:grayscale-0'} {disabled
				? 'cursor-not-allowed opacity-50'
				: ''}"
			on:click={() => select(opt.value)}
			{disabled}
		>
			<span class="text-sm font-bold tracking-wider">{opt.label}</span>
			<span class="mt-1 text-[10px] leading-tight text-center opacity-80">{opt.description}</span>
		</button>
	{/each}
</div>
