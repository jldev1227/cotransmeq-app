<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as chatStore from '$lib/stores/liquidacionChat';

	let presence = $state<any[]>([]);

	const unsub = chatStore.subscribe(() => {
		const s = chatStore.getState();
		presence = [...s.presence];
	});

	onDestroy(() => {
		if (unsub) unsub();
	});

	function getInitials(name: string | null | undefined): string {
		if (!name || typeof name !== 'string') return '?';
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		return parts
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	const maxVisible = 5;
	const visible = $derived(presence.slice(0, maxVisible));
	const extra = $derived(presence.length - maxVisible);
</script>

{#if presence.length > 0}
	<div class="flex items-center gap-1.5">
		<div class="flex -space-x-2">
			{#each visible as p (p.id)}
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-orange-400 to-orange-600 text-[9px] font-bold text-white"
					title={p.name}
				>
					{getInitials(p.name)}
				</div>
			{/each}
			{#if extra > 0}
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[9px] font-medium text-gray-600"
				>
					+{extra}
				</div>
			{/if}
		</div>
		<span class="text-[10px] text-gray-500">{presence.length} en l&iacute;nea</span>
	</div>
{:else}
	<span class="text-[10px] text-gray-400">Sin usuarios en l&iacute;nea</span>
{/if}
