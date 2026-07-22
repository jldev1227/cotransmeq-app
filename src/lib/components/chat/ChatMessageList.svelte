<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import * as chatStore from '$lib/stores/liquidacionChat';
	import ChatMessageItem from './ChatMessageItem.svelte';

	type Props = {
		panelOpen?: boolean;
	};

	let { panelOpen = false }: Props = $props();

	let messages = $state<any[]>([]);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let containerEl: HTMLElement | null = null;
	let prevMessageCount = 0;
	let prevLastId: string | null = null;
	let programmaticScroll = false;
	let lastSeenPanelOpen = false;

	const STICKY_THRESHOLD_PX = 48;

	const unsub = chatStore.subscribe(() => {
		const s = chatStore.getState();
		const newCount = s.messages.length;
		const newLastId = s.messages[newCount - 1]?.id ?? null;

		const shouldAutoScroll = s.stickyBottom && panelOpen;
		if (shouldAutoScroll && containerEl && newCount > 0) {
			programmaticScroll = true;
			queueMicrotask(() => {
				if (containerEl) {
					containerEl.scrollTop = containerEl.scrollHeight;
				}
				setTimeout(() => {
					programmaticScroll = false;
				}, 50);
			});
		}

		messages = [...s.messages];
		hasMore = s.hasMore;
		loadingMore = s.loadingMore;
		prevMessageCount = newCount;
		prevLastId = newLastId;
	});

	$effect(() => {
		if (panelOpen && !lastSeenPanelOpen && containerEl) {
			programmaticScroll = true;
			queueMicrotask(() => {
				if (containerEl) {
					containerEl.scrollTop = containerEl.scrollHeight;
				}
				chatStore.setStickyBottom(true);
				setTimeout(() => {
					programmaticScroll = false;
				}, 50);
			});
		}
		lastSeenPanelOpen = panelOpen;
	});

	onMount(() => {
		const s = chatStore.getState();
		if (s.messages.length > 0) {
			messages = [...s.messages];
			hasMore = s.hasMore;
			loadingMore = s.loadingMore;
			prevMessageCount = s.messages.length;
			prevLastId = s.messages[s.messages.length - 1]?.id ?? null;
		}
	});

	onDestroy(() => {
		if (unsub) unsub();
	});

	$effect(() => {
		if (panelOpen && messages.length > 0 && containerEl) {
			queueMicrotask(() => {
				if (containerEl) {
					containerEl.scrollTop = containerEl.scrollHeight;
				}
			});
		}
	});

	function handleScroll() {
		if (!containerEl) return;
		if (programmaticScroll) return;

		const { scrollTop, scrollHeight, clientHeight } = containerEl;
		const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
		const sticky = distanceFromBottom <= STICKY_THRESHOLD_PX;
		chatStore.setStickyBottom(sticky);

		if (scrollTop < 50 && hasMore && !loadingMore) {
			chatStore.loadMore();
		}
	}

	function isNewDay(msg: any, prev: any): boolean {
		if (!prev) return true;
		const d1 = new Date(msg.created_at).toDateString();
		const d2 = new Date(prev.created_at).toDateString();
		return d1 !== d2;
	}

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr);
		const today = new Date();
		const yesterday = new Date();
		yesterday.setDate(today.getDate() - 1);

		if (d.toDateString() === today.toDateString()) return 'Hoy';
		if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
		return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function formatTime(dateStr: string): string {
		return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
	}

	function scrollToBottomInstant() {
		if (!containerEl) return;
		programmaticScroll = true;
		containerEl.scrollTop = containerEl.scrollHeight;
		setTimeout(() => {
			programmaticScroll = false;
			chatStore.setStickyBottom(true);
		}, 50);
	}
</script>

<div
	bind:this={containerEl}
	onscroll={handleScroll}
	class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2"
>
	{#if loadingMore}
		<div class="flex justify-center py-2">
			<div
				class="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent"
			></div>
		</div>
	{/if}

	{#if messages.length === 0}
		<div
			class="flex flex-1 flex-col items-center justify-center py-12 text-center"
			in:fade={{ duration: 300 }}
		>
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
				<svg
					class="h-6 w-6 text-gray-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
					/>
				</svg>
			</div>
			<p class="text-sm font-semibold text-gray-900">Sin mensajes a&uacute;n</p>
			<p class="mt-1 text-xs text-gray-500">
				Inicia la conversaci&oacute;n sobre esta liquidaci&oacute;n
			</p>
		</div>
	{:else}
		{#each messages as msg, i (msg.id)}
			{#if isNewDay(msg, messages[i - 1])}
				<div class="my-2 flex items-center gap-2">
					<div class="h-px flex-1 bg-gray-200"></div>
					<span class="text-[10px] font-medium text-gray-400">{formatDate(msg.created_at)}</span>
					<div class="h-px flex-1 bg-gray-200"></div>
				</div>
			{/if}
			<ChatMessageItem {msg} {formatTime} />
		{/each}
	{/if}

	{#if panelOpen && messages.length > 0}
		{@const s = chatStore.getState()}
		{#if !s.stickyBottom}
			<button
				onclick={scrollToBottomInstant}
				class="apple-transition sticky bottom-2 mx-auto flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-500 px-3 py-1 text-[10px] font-semibold text-white shadow-md hover:bg-orange-600"
				title="Ir al final"
			>
				<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
				</svg>
				Ir al final
			</button>
		{/if}
	{/if}
</div>
