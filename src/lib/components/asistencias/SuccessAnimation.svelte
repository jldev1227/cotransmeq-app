<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';

	export let show = false;
	export let message = '¡Respuesta enviada exitosamente!';
	export let subtitle = '';
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-orange-500/95 to-orange-600/95 p-4"
		transition:fade={{ duration: 300 }}
	>
		<div class="text-center" transition:scale={{ duration: 600, easing: elasticOut, start: 0.5 }}>
			<!-- Check Icon con animación -->
			<div class="mb-6 flex justify-center">
				<div
					class="flex h-32 w-32 items-center justify-center rounded-full bg-white shadow-2xl"
					transition:scale={{ duration: 800, delay: 200, easing: elasticOut }}
				>
					<svg class="h-20 w-20 text-orange-600" fill="none" viewBox="0 0 24 24">
						<path
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2.5"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							class="checkmark-animation"
						/>
					</svg>
				</div>
			</div>

			<!-- Mensaje -->
			<h2 class="text-4xl font-bold text-white" transition:fade={{ delay: 400, duration: 400 }}>
				{message}
			</h2>

			{#if subtitle}
				<p class="mt-4 text-xl text-orange-50" transition:fade={{ delay: 600, duration: 400 }}>
					{subtitle}
				</p>
			{/if}

			<!-- Confetti particles -->
			<div class="confetti-container">
				{#each Array(20) as _, i}
					<div
						class="confetti"
						style="--delay: {i * 0.1}s; --x: {Math.random() * 200 -
							100}px; --rotation: {Math.random() * 360}deg;"
					/>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes checkmark {
		0% {
			stroke-dasharray: 0 100;
		}
		100% {
			stroke-dasharray: 100 100;
		}
	}

	.checkmark-animation {
		stroke-dasharray: 0 100;
		animation: checkmark 0.6s ease-out 0.5s forwards;
	}

	@keyframes confetti-fall {
		0% {
			transform: translateY(0) translateX(0) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(100vh) translateX(var(--x)) rotate(var(--rotation));
			opacity: 0;
		}
	}

	.confetti-container {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: hidden;
	}

	.confetti {
		position: absolute;
		width: 10px;
		height: 10px;
		background: white;
		top: -20px;
		left: 50%;
		opacity: 0;
		animation: confetti-fall 2s ease-out var(--delay) forwards;
		border-radius: 2px;
	}

	.confetti:nth-child(2n) {
		background: rgba(255, 255, 255, 0.8);
		width: 8px;
		height: 8px;
	}

	.confetti:nth-child(3n) {
		background: rgba(255, 255, 255, 0.6);
		width: 12px;
		height: 4px;
	}
</style>
