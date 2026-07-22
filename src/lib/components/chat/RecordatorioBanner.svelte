<script lang="ts">
	import { fly } from 'svelte/transition';

	export let count: number;
	export let placa: string;
	export let mes: string;
	export let anio: number;
	export let onOpenChat: () => void;
	export let onDismiss: () => void;

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}
</script>

<div
	class="no-print rounded-xl border border-amber-200 bg-amber-50/60 p-3"
	transition:fly={{ y: -10, duration: 300 }}
>
	<div class="flex items-start gap-3">
		<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
			<svg
				class="h-4 w-4 text-amber-600"
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
		</div>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-semibold text-amber-900">
				{count} recordatorio{count > 1 ? 's' : ''} pendiente{count > 1 ? 's' : ''}
			</p>
			<p class="text-xs text-amber-700">
				Para <span class="font-mono font-semibold">{fmtPlaca(placa)}</span> &middot; {mes}
				{anio}
			</p>
			<button
				onclick={onOpenChat}
				class="apple-transition mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-200 px-2.5 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-300"
			>
				<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
					/>
				</svg>
				Ver en el chat
			</button>
		</div>
		<button
			onclick={onDismiss}
			class="rounded-lg p-1 text-amber-400 hover:bg-amber-100 hover:text-amber-600"
			aria-label="Cerrar banner de recordatorios"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</div>
</div>
