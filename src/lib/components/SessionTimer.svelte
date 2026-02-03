<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getTimeUntilExpiration, formatTimeRemaining } from '$lib/utils/jwt';
	import { fade } from 'svelte/transition';

	export let showTimer = false; // Opcional: mostrar contador

	let timeRemaining = '';
	let updateInterval: ReturnType<typeof setInterval> | null = null;
	let isWarning = false;
	let isCritical = false;

	$: token = $authStore.token;

	function updateTimeDisplay() {
		if (!token) {
			timeRemaining = '';
			return;
		}

		const ms = getTimeUntilExpiration(token);
		timeRemaining = formatTimeRemaining(ms);

		const minutes = Math.floor(ms / 1000 / 60);

		// Estados de advertencia
		isCritical = minutes <= 5 && minutes > 0;
		isWarning = minutes <= 15 && minutes > 5;
	}

	onMount(() => {
		if (showTimer) {
			updateTimeDisplay();
			// Actualizar cada 30 segundos
			updateInterval = setInterval(updateTimeDisplay, 30000);
		}
	});

	onDestroy(() => {
		if (updateInterval) {
			clearInterval(updateInterval);
		}
	});
</script>

{#if showTimer && timeRemaining && timeRemaining !== 'Expirado'}
	<div
		class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
			{isCritical
			? 'bg-red-100 text-red-700'
			: isWarning
				? 'bg-amber-100 text-amber-700'
				: 'bg-gray-100 text-gray-600'}"
		in:fade={{ duration: 200 }}
	>
		<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
		<span>Sesión: {timeRemaining}</span>
	</div>
{/if}
