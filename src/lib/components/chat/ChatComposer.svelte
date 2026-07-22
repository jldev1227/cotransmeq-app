<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as chatStore from '$lib/stores/liquidacionChat';

	let text = $state('');
	let textareaEl: HTMLTextAreaElement | null = null;
	let typingUsers = $state<string[]>([]);

	const unsub = chatStore.subscribe(() => {
		const s = chatStore.getState();
		const now = Date.now();
		typingUsers = [...s.typing.values()].filter((t) => now - t.ts < 3000).map((t) => t.name);
	});

	onDestroy(() => {
		if (unsub) unsub();
	});

	function handleInput() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
		chatStore.emitTyping(text.length > 0);
	}

	async function handleSend() {
		if (!text.trim()) return;
		await chatStore.sendMessage(text);
		text = '';
		if (textareaEl) {
			textareaEl.style.height = 'auto';
		}
		chatStore.emitTyping(false);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}
</script>

<div class="border-t border-gray-100 p-3">
	<!-- Typing indicator -->
	{#if typingUsers.length > 0}
		<div class="mb-2 flex items-center gap-1.5 text-[10px] text-gray-400">
			<div class="flex gap-0.5">
				<span
					class="h-1 w-1 animate-bounce rounded-full bg-orange-400"
					style="animation-delay: 0ms"
				></span>
				<span
					class="h-1 w-1 animate-bounce rounded-full bg-orange-400"
					style="animation-delay: 150ms"
				></span>
				<span
					class="h-1 w-1 animate-bounce rounded-full bg-orange-400"
					style="animation-delay: 300ms"
				></span>
			</div>
			{typingUsers.join(', ')} est&aacute; escribiendo...
		</div>
	{/if}

	<div class="flex items-end gap-2">
		<textarea
			bind:this={textareaEl}
			bind:value={text}
			oninput={handleInput}
			onkeydown={handleKeydown}
			placeholder="Escribe una nota sobre esta liquidaci&oacute;n..."
			rows="1"
			class="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400 focus:outline-none"
		></textarea>
		<button
			onclick={handleSend}
			disabled={!text.trim()}
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-sm disabled:opacity-40"
			title="Enviar"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
			</svg>
		</button>
	</div>
</div>
