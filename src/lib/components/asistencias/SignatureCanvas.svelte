<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	export let value = ''; // Base64 string de la firma
	export let error = '';
	export let disabled = false;

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null;
	let isDrawing = false;
	let isEmpty = true;

	onMount(() => {
		if (canvas) {
			ctx = canvas.getContext('2d');
			if (ctx) {
				// Configurar canvas con alta resolución
				const dpr = window.devicePixelRatio || 1;
				const rect = canvas.getBoundingClientRect();
				canvas.width = rect.width * dpr;
				canvas.height = rect.height * dpr;
				ctx.scale(dpr, dpr);

				// Estilos de dibujo
				ctx.strokeStyle = '#059669'; // orange-600
				ctx.lineWidth = 2;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';

				// Si hay una firma existente, cargarla
				if (value) {
					const img = new Image();
					img.onload = () => {
						if (ctx) {
							ctx.drawImage(img, 0, 0, rect.width, rect.height);
							isEmpty = false;
						}
					};
					img.src = value;
				}
			}
		}
	});

	function startDrawing(e: MouseEvent | TouchEvent) {
		if (disabled) return;
		isDrawing = true;
		isEmpty = false;
		const pos = getPointerPosition(e);
		if (ctx) {
			ctx.beginPath();
			ctx.moveTo(pos.x, pos.y);
		}
	}

	function draw(e: MouseEvent | TouchEvent) {
		if (!isDrawing || disabled) return;
		e.preventDefault();
		const pos = getPointerPosition(e);
		if (ctx) {
			ctx.lineTo(pos.x, pos.y);
			ctx.stroke();
		}
	}

	function stopDrawing() {
		if (!isDrawing) return;
		isDrawing = false;
		saveSignature();
	}

	function getPointerPosition(e: MouseEvent | TouchEvent): { x: number; y: number } {
		const rect = canvas.getBoundingClientRect();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		return {
			x: clientX - rect.left,
			y: clientY - rect.top
		};
	}

	function saveSignature() {
		if (canvas && !isEmpty) {
			value = canvas.toDataURL('image/png');
		}
	}

	function clearSignature() {
		if (ctx && canvas) {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			value = '';
			isEmpty = true;
		}
	}
</script>

<div class="space-y-2">
	<label class="block text-sm font-semibold text-gray-700">
		Firma <span class="text-red-500">*</span>
	</label>

	<div class="relative">
		<canvas
			bind:this={canvas}
			class="h-48 w-full cursor-crosshair rounded-xl border-2 {error
				? 'border-red-300 bg-red-50/30'
				: 'border-gray-300 bg-white'} touch-none transition-colors {disabled
				? 'cursor-not-allowed opacity-50'
				: ''}"
			on:mousedown={startDrawing}
			on:mousemove={draw}
			on:mouseup={stopDrawing}
			on:mouseleave={stopDrawing}
			on:touchstart={startDrawing}
			on:touchmove={draw}
			on:touchend={stopDrawing}
		></canvas>

		<!-- Placeholder text -->
		{#if isEmpty && !disabled}
			<div
				class="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-400"
				transition:fade={{ duration: 200 }}
			>
				<div class="text-center">
					<svg
						class="mx-auto h-8 w-8 text-gray-300"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
						/>
					</svg>
					<p class="mt-2 text-sm">Firma aquí</p>
				</div>
			</div>
		{/if}

		<!-- Clear button -->
		{#if !isEmpty && !disabled}
			<button
				type="button"
				on:click={clearSignature}
				class="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-white hover:shadow-md"
				transition:fade={{ duration: 200 }}
			>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
				Limpiar
			</button>
		{/if}
	</div>

	{#if error}
		<p class="text-sm text-red-600" transition:fade={{ duration: 200 }}>{error}</p>
	{/if}
</div>
