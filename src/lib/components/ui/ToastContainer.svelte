<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { toast, type Toast } from '$lib/stores/toast';

	$: toasts = $toast;

	function getIcon(type: Toast['type']) {
		switch (type) {
			case 'success':
				return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
				</svg>`;
			case 'error':
				return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
				</svg>`;
			case 'warning':
				return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
				</svg>`;
			case 'info':
				return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
				</svg>`;
		}
	}

	function getStyles(type: Toast['type']) {
		switch (type) {
			case 'success':
				return 'bg-orange-50 border-orange-200 text-orange-800';
			case 'error':
				return 'bg-red-50 border-red-200 text-red-800';
			case 'warning':
				return 'bg-amber-50 border-amber-200 text-amber-800';
			case 'info':
				return 'bg-blue-50 border-blue-200 text-blue-800';
		}
	}

	function getIconStyles(type: Toast['type']) {
		switch (type) {
			case 'success':
				return 'text-orange-500';
			case 'error':
				return 'text-red-500';
			case 'warning':
				return 'text-amber-500';
			case 'info':
				return 'text-blue-500';
		}
	}
</script>

<!-- Toast Container -->
<div class="fixed top-4 right-4 z-[9999] flex flex-col gap-3" style="max-width: 400px;">
	{#each toasts as toastItem (toastItem.id)}
		<div
			class="glass soft-shadow flex items-start gap-3 rounded-xl border p-4 {getStyles(
				toastItem.type
			)}"
			in:fly={{ x: 300, duration: 300 }}
			out:fade={{ duration: 200 }}
			role="alert"
		>
			<!-- Icon -->
			<div class="flex-shrink-0 {getIconStyles(toastItem.type)}">
				{@html getIcon(toastItem.type)}
			</div>

			<!-- Message -->
			<div class="flex-1 text-sm font-medium">
				{toastItem.message}
			</div>

			<!-- Close button -->
			<button
				on:click={() => toast.remove(toastItem.id)}
				class="flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-black/5"
				aria-label="Cerrar notificación"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>
	{/each}
</div>
