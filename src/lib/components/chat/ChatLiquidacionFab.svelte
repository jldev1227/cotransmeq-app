<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import * as chatStore from '$lib/stores/liquidacionChat';
	import ChatMessageList from './ChatMessageList.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatPresenceIndicator from './ChatPresenceIndicator.svelte';
	import ChatRecordatorioList from './ChatRecordatorioList.svelte';
	import ChatRecordatorioForm from './ChatRecordatorioForm.svelte';

	type Props = {
		liquidacionId: string;
		liquidacionInfo: { placa: string; mes: number; anio: number; consecutivo?: string };
	};

	let { liquidacionId, liquidacionInfo }: Props = $props();

	let open = $state(false);
	if (typeof localStorage !== 'undefined') {
		try {
			// svelte-ignore state_referenced_locally
			open = localStorage.getItem(`liq-chat-panel:${liquidacionId}`) === 'open';
		} catch {
			/* ignore */
		}
	}
	let activeTab = $state<'notas' | 'recordatorios'>('notas');
	let unreadCount = $state(0);
	let user = $state<{ id: string; name: string } | null>(null);
	let showRecordatorioForm = $state(false);
	let isMobile = $state(false);

	let chatUnsub: (() => void) | null = null;
	let authUnsub: (() => void) | null = null;
	let initializedLqId: string | null = null;
	let resizeHandler: (() => void) | null = null;

	function openPanel() {
		open = true;
		localStorage.setItem(`liq-chat-panel:${liquidacionId}`, 'open');
	}

	function closePanel() {
		open = false;
		showRecordatorioForm = false;
		localStorage.setItem(`liq-chat-panel:${liquidacionId}`, 'closed');
	}

	function toggle() {
		if (open) closePanel();
		else openPanel();
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			toggle();
		}
		if (e.key === 'Escape') {
			if (showRecordatorioForm) {
				showRecordatorioForm = false;
			} else if (open) {
				closePanel();
			}
		}
	}

	function checkMobile() {
		if (typeof window === 'undefined') return;
		isMobile = window.innerWidth < 768;
	}

	onMount(async () => {
		checkMobile();
		resizeHandler = () => checkMobile();
		window.addEventListener('resize', resizeHandler);

		authUnsub = authStore.subscribe((auth) => {
			if (auth.user) {
				user = { id: auth.user.id, name: auth.user.nombre };
			}
		});

		if (!user) {
			await authStore.init();
			const s = authStore.subscribe((auth) => {
				if (auth.user) {
					user = { id: auth.user.id, name: auth.user.nombre };
				}
			});
			s();
		}
		if (user) {
			await chatStore.init(liquidacionId, user, {
				placa: liquidacionInfo.placa,
				mes: liquidacionInfo.mes,
				anio: liquidacionInfo.anio
			});
			initializedLqId = liquidacionId;
		}

		chatUnsub = chatStore.subscribe(() => {
			const s = chatStore.getState();
			unreadCount = s.unreadCount;
			if (open && s.stickyBottom) {
				chatStore.markAsRead();
			}
		});

		document.addEventListener('keydown', handleKeydown);
	});

	$effect(() => {
		if (user && liquidacionId && initializedLqId !== liquidacionId) {
			initializedLqId = liquidacionId;
			chatStore.init(liquidacionId, user, {
				placa: liquidacionInfo.placa,
				mes: liquidacionInfo.mes,
				anio: liquidacionInfo.anio
			});
		}
	});

	onDestroy(() => {
		if (chatUnsub) chatUnsub();
		if (authUnsub) authUnsub();
		if (resizeHandler) window.removeEventListener('resize', resizeHandler);
		document.removeEventListener('keydown', handleKeydown);
	});
</script>

<!-- FAB: siempre visible, no se desmonta -->
<button
	onclick={openPanel}
	class="cursor-pointer no-print apple-hover fixed right-6 bottom-6 z-[9998] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg transition-opacity {open
		? 'pointer-events-none opacity-0'
		: 'opacity-100'}"
	aria-label="Abrir chat de liquidaci&oacute;n"
	title="Abrir chat de liquidaci&oacute;n"
>
	<svg
		class="h-6 w-6 text-white"
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
	{#if unreadCount > 0}
		<span
			class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold text-white shadow-md"
		>
			{unreadCount > 99 ? '99+' : unreadCount}
		</span>
	{/if}
</button>

<!-- Modal del chat -->
{#if open}
	<div
		class="no-print fixed inset-0 z-[10000] flex items-end justify-end p-0 md:inset-auto md:right-6 md:bottom-6 md:items-end md:justify-end md:p-0"
		role="dialog"
		aria-modal="true"
		aria-label="Chat de liquidaci&oacute;n"
	>
		<div
			class="flex w-full flex-col overflow-hidden bg-white shadow-2xl md:h-[560px] md:w-[380px] md:rounded-2xl md:border md:border-gray-200/50 {isMobile
				? 'h-full rounded-none'
				: 'h-[560px] rounded-2xl'}"
			role="document"
			transition:fly={{ y: 20, duration: 250, opacity: 0 }}
		>
			<!-- Header -->
			<div class="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
				<div class="flex items-center gap-2">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg
							class="h-4 w-4 text-white"
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
					<div>
						<h3 class="text-sm font-semibold text-gray-900">Chat de liquidaci&oacute;n</h3>
						<p class="text-[10px] text-gray-500">
							{liquidacionInfo.consecutivo || ''} &middot; {liquidacionInfo.placa}
						</p>
					</div>
				</div>
				<button
					onclick={closePanel}
					class="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					title="Cerrar"
					aria-label="Cerrar chat"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Presence -->
			<div class="shrink-0 border-b border-gray-100 px-4 py-2">
				<ChatPresenceIndicator />
			</div>

			<!-- Tabs -->
			<div class="flex shrink-0 border-b border-gray-100">
				<button
					class="flex-1 px-4 py-2.5 text-xs font-semibold transition-colors {activeTab === 'notas'
						? 'border-b-2 border-orange-500 text-orange-700'
						: 'text-gray-500 hover:text-gray-700'}"
					onclick={() => (activeTab = 'notas')}
				>
					Notas
				</button>
				<button
					class="flex-1 px-4 py-2.5 text-xs font-semibold transition-colors {activeTab ===
					'recordatorios'
						? 'border-b-2 border-orange-500 text-orange-700'
						: 'text-gray-500 hover:text-gray-700'}"
					onclick={() => (activeTab = 'recordatorios')}
				>
					Recordatorios
					{#if chatStore.getRecordatoriosPendientes().length > 0}
						<span
							class="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white"
						>
							{chatStore.getRecordatoriosPendientes().length}
						</span>
					{/if}
				</button>
			</div>

			<!-- Content -->
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				{#if activeTab === 'notas'}
					<ChatMessageList panelOpen={open} />
					<ChatComposer />
				{:else}
					<ChatRecordatorioList
						{liquidacionId}
						{liquidacionInfo}
						onCreate={() => (showRecordatorioForm = true)}
					/>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Recordatorio Form Modal (encima del chat) -->
{#if showRecordatorioForm}
	<ChatRecordatorioForm
		{liquidacionId}
		{liquidacionInfo}
		onClose={() => (showRecordatorioForm = false)}
	/>
{/if}
