<script lang="ts">
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';

	type Props = {
		msg: any;
		formatTime: (dateStr: string) => string;
	};

	let { msg, formatTime }: Props = $props();

	let authState = $derived(get(authStore));
	let isOwn = $derived(msg.usuario_id === authState.user?.id);

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
</script>

{#if msg.tipo === 'SISTEMA'}
	<div class="py-1 text-center text-[10px] text-gray-400 italic">
		{msg.contenido}
	</div>
{:else}
	<div class="flex gap-2 py-1 {isOwn ? 'flex-row-reverse' : ''}">
		<div
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-[8px] font-bold text-white"
		>
			{getInitials(msg.usuario_nombre)}
		</div>

		<div class="max-w-[75%]">
			<div class="mb-0.5 flex items-center gap-1.5 {isOwn ? 'flex-row-reverse' : ''}">
				<span class="text-[10px] font-medium text-gray-500">{msg.usuario_nombre}</span>
				<span class="text-[9px] text-gray-400">{formatTime(msg.created_at)}</span>
				{#if msg.tipo === 'RECORDATORIO_REF'}
					<svg
						class="h-3 w-3 text-orange-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
				{/if}
			</div>

			<div
				class="rounded-2xl px-3 py-2 text-sm leading-relaxed {isOwn
					? 'rounded-br-sm bg-gradient-to-br from-orange-500 to-orange-600 text-white'
					: 'rounded-bl-sm border border-gray-200 bg-white text-gray-900'}"
			>
				{msg.contenido}
			</div>
		</div>
	</div>
{/if}
