<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let value = 'En Proceso';
	export let disabled = false;

	const dispatch = createEventDispatcher<{ select: string }>();

	const options = [
		{
			value: 'Cerrada',
			label: 'Cumplida',
			icon: '✅',
			bg: 'bg-orange-50',
			border: 'border-orange-200',
			text: 'text-orange-700',
			hover: 'hover:bg-orange-100',
			ring: 'ring-orange-500',
			borderActive: 'border-orange-400'
		},
		{
			value: 'En Proceso',
			label: 'En Proceso',
			icon: '🔄',
			bg: 'bg-blue-50',
			border: 'border-blue-200',
			text: 'text-blue-700',
			hover: 'hover:bg-blue-100',
			ring: 'ring-blue-500',
			borderActive: 'border-blue-400'
		},
		{
			value: 'Vencida',
			label: 'Vencida',
			icon: '⛔',
			bg: 'bg-red-50',
			border: 'border-red-200',
			text: 'text-red-700',
			hover: 'hover:bg-red-100',
			ring: 'ring-red-500',
			borderActive: 'border-red-400'
		},
		{
			value: 'Replanteada',
			label: 'Replanteada',
			icon: '📅',
			bg: 'bg-amber-50',
			border: 'border-amber-200',
			text: 'text-amber-700',
			hover: 'hover:bg-amber-100',
			ring: 'ring-amber-500',
			borderActive: 'border-amber-400'
		}
	];

	function select(val: string) {
		if (disabled) return;
		value = val;
		dispatch('select', val);
	}
</script>

<div class="flex flex-wrap gap-2">
	{#each options as opt}
		<button
			type="button"
			class="flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition-all {opt.bg} {opt.border} {opt.text} {opt.hover} {value ===
			opt.value
				? `ring-2 ring-offset-1 ${opt.ring} scale-105 ${opt.borderActive} shadow-sm`
				: 'opacity-60 grayscale-[0.2] hover:opacity-100 hover:grayscale-0'} {disabled
				? 'cursor-not-allowed opacity-40'
				: ''}"
			on:click={() => select(opt.value)}
			{disabled}
		>
			<span>{opt.icon}</span>
			<span>{opt.label}</span>
		</button>
	{/each}
</div>
