<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { onMount } from 'svelte';

	export let title: string;
	export let value: string | number;
	export let subtitle: string = '';
	export let icon: string = 'chart';
	export let trend: 'up' | 'down' | 'neutral' = 'neutral';
	export let trendValue: string = '';
	export let color: 'orange' | 'blue' | 'purple' | 'orange' = 'orange';
	export let delay: number = 0;

	let isVisible = false;

	onMount(() => {
		setTimeout(() => {
			isVisible = true;
		}, delay);
	});

	function getIcon(iconName: string) {
		const icons = {
			chart: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />`,
			truck: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />`,
			users: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a4 4 0 11-8 0 4 4 0 018 0z" />`,
			clock: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`,
			money: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />`,
			warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />`,
			calendar: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />`
		};
		return icons[iconName as keyof typeof icons] || icons.chart;
	}

	function getColorClasses(colorName: string) {
		const colorMap = {
			orange: {
				gradient: 'from-orange-400 to-orange-600',
				bg: 'bg-orange-50/80',
				text: 'text-orange-700',
				border: 'border-orange-200/50'
			},
			blue: {
				gradient: 'from-blue-400 to-blue-600',
				bg: 'bg-blue-50/80',
				text: 'text-blue-700',
				border: 'border-blue-200/50'
			},
			purple: {
				gradient: 'from-purple-400 to-purple-600',
				bg: 'bg-purple-50/80',
				text: 'text-purple-700',
				border: 'border-purple-200/50'
			},
			orange: {
				gradient: 'from-orange-400 to-orange-600',
				bg: 'bg-orange-50/80',
				text: 'text-orange-700',
				border: 'border-orange-200/50'
			}
		};
		return colorMap[colorName as keyof typeof colorMap] || colorMap.orange;
	}

	$: colorClasses = getColorClasses(color);
</script>

{#if isVisible}
	<div
		class="glass apple-transition apple-hover rounded-2xl border p-6 hover:shadow-lg {colorClasses.border} group relative cursor-pointer overflow-hidden"
		in:fly={{ y: 20, duration: 600 }}
	>
		<!-- Background Pattern -->
		<div class="absolute top-0 right-0 h-32 w-32 overflow-hidden opacity-5">
			<div
				class="h-full w-full bg-gradient-to-br {colorClasses.gradient} translate-x-8 -translate-y-8 transform rounded-full"
			></div>
		</div>

		<!-- Header -->
		<div class="relative z-10 mb-4 flex items-center justify-between">
			<div class="flex items-center space-x-3">
				<!-- Icon -->
				<div
					class="h-12 w-12 bg-gradient-to-br {colorClasses.gradient} soft-shadow apple-transition flex items-center justify-center rounded-xl group-hover:scale-105"
				>
					<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{@html getIcon(icon)}
					</svg>
				</div>

				<!-- Title -->
				<div>
					<h3 class="text-sm font-semibold text-gray-900">{title}</h3>
					{#if subtitle}
						<p class="mt-0.5 text-xs text-gray-500">{subtitle}</p>
					{/if}
				</div>
			</div>

			<!-- Trend Indicator -->
			{#if trend !== 'neutral' && trendValue}
				<div
					class="flex items-center space-x-1 {trend === 'up' ? 'text-orange-600' : 'text-red-500'}"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#if trend === 'up'}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M7 17l9.2-9.2M17 17V7h-10"
							/>
						{:else}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 7l-9.2 9.2M7 7v10h10"
							/>
						{/if}
					</svg>
					<span class="text-xs font-medium">{trendValue}</span>
				</div>
			{/if}
		</div>

		<!-- Value -->
		<div class="relative z-10">
			<div class="apple-transition mb-1 text-3xl font-bold text-gray-900 group-hover:text-gray-800">
				{#if typeof value === 'number'}
					{value.toLocaleString()}
				{:else}
					{value}
				{/if}
			</div>
		</div>

		<!-- Hover Effect -->
		<div
			class="apple-transition absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100"
		></div>
	</div>
{/if}
