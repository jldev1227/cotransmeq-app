<script lang="ts">
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	type Color = 'amber' | 'emerald' | 'red' | 'blue' | 'slate';

	type Props = {
		text: string;
		maxLength?: number;
		color?: Color;
		emptyText?: string;
		label?: string;
	};

	let {
		text,
		maxLength = 60,
		color = 'amber',
		emptyText = '—',
		label = 'Ver más'
	}: Props = $props();

	let open = $state(false);
	let wrapperEl: HTMLSpanElement | null = $state(null);

	// Posición calculada del wrapper (viewport coords) para que el popover
	// escape cualquier `overflow: hidden/auto` de los ancestros (table-card,
	// tabla, etc). Se actualiza al mostrar y al hacer scroll/resize.
	let popoverStyle = $state('');
	let popoverPlacement = $state<'top' | 'bottom'>('top');

	const TRUNCATE_THRESHOLD = maxLength;

	let displayText = $derived(
		text && text.length > TRUNCATE_THRESHOLD ? text.slice(0, TRUNCATE_THRESHOLD) + '…' : text
	);
	let needsPopover = $derived(Boolean(text && text.length > TRUNCATE_THRESHOLD));

	const COLOR_CLASSES: Record<Color, string> = {
		amber: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
		emerald: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100',
		red: 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100',
		blue: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100',
		slate: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
	};

	function computePosition() {
		if (!wrapperEl) return;
		const rect = wrapperEl.getBoundingClientRect();
		const popoverMaxWidth = 320; // max-w-xs
		const popoverEstimatedHeight = 120;
		const margin = 8;

		// Si no entra arriba (por estar en el primer row), colocar abajo
		const placeTop = rect.top - popoverEstimatedHeight - margin >= 8;
		popoverPlacement = placeTop ? 'top' : 'bottom';

		// Centrar horizontalmente respecto al wrapper, sin salir del viewport
		let left = rect.left + rect.width / 2 - popoverMaxWidth / 2;
		left = Math.max(8, Math.min(left, window.innerWidth - popoverMaxWidth - 8));

		const top = placeTop
			? rect.top - popoverEstimatedHeight - margin
			: rect.bottom + margin;

		popoverStyle = `position: fixed; left: ${left}px; top: ${top}px; width: ${popoverMaxWidth}px;`;
	}

	function show() {
		if (!needsPopover) return;
		computePosition();
		open = true;
	}

	function hide() {
		open = false;
	}

	function toggle() {
		if (!needsPopover) return;
		if (open) {
			hide();
		} else {
			show();
		}
	}
</script>

<svelte:window onscroll={() => open && computePosition()} onresize={() => open && computePosition()} />

<span
	bind:this={wrapperEl}
	class="relative inline-flex max-w-full"
	role={needsPopover ? 'button' : undefined}
	tabindex={needsPopover ? 0 : undefined}
	onmouseenter={show}
	onmouseleave={hide}
	onfocus={show}
	onblur={hide}
	onclick={toggle}
	onkeydown={(e) => {
		if ((e.key === 'Enter' || e.key === ' ') && needsPopover) {
			e.preventDefault();
			toggle();
		} else if (e.key === 'Escape' && open) {
			hide();
		}
	}}
>
	{#if !text}
		<span class="text-[#C7C7C7]">{emptyText}</span>
	{:else}
		<span
			class="inline-flex max-w-full cursor-default items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] leading-snug {COLOR_CLASSES[
				color
			]}"
		>
			<span class="truncate">{displayText}</span>
			{#if needsPopover}
				<svg
					class="h-2.5 w-2.5 flex-shrink-0 opacity-60"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
				</svg>
			{/if}
		</span>
	{/if}

	{#if open && needsPopover}
		<span
			class="pointer-events-none z-[9999] rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[12px] font-normal text-slate-700 shadow-2xl"
			transition:fly={{ y: 4, duration: 160, easing: quintOut }}
			style="{popoverStyle} white-space: pre-wrap; word-break: break-word;"
		>
			<span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-slate-400">
				{label}
			</span>
			{text}
		</span>
	{/if}
</span>
