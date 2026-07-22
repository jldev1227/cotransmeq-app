<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import * as chatStore from '$lib/stores/liquidacionChat';

	type Props = {
		liquidacionId: string;
		liquidacionInfo: { placa: string; mes: number; anio: number };
		onClose: () => void;
	};

	let { liquidacionId, liquidacionInfo, onClose }: Props = $props();

	let descripcion = $state('');
	let mes = $state(liquidacionInfo.mes + 1 > 12 ? 1 : liquidacionInfo.mes + 1);
	let anio = $state(liquidacionInfo.mes + 1 > 12 ? liquidacionInfo.anio + 1 : liquidacionInfo.anio);
	let monto = $state('');
	let prioridad = $state<'BAJA' | 'MEDIA' | 'ALTA'>('MEDIA');
	let aplicaEn = $state('');
	let saving = $state(false);

	const MESES = [
		'ENERO',
		'FEBRERO',
		'MARZO',
		'ABRIL',
		'MAYO',
		'JUNIO',
		'JULIO',
		'AGOSTO',
		'SEPTIEMBRE',
		'OCTUBRE',
		'NOVIEMBRE',
		'DICIEMBRE'
	];

	const charCount = $derived(descripcion.length);
	const maxChars = 500;
	const isValid = $derived(descripcion.trim().length > 0 && charCount <= maxChars);

	async function handleSubmit() {
		if (!isValid || saving) return;
		saving = true;

		try {
			await chatStore.crearRecordatorio({
				placa: liquidacionInfo.placa,
				mes,
				anio,
				descripcion: descripcion.trim(),
				monto: monto ? parseFloat(monto) : undefined,
				prioridad,
				aplica_en: aplicaEn || undefined
			});
			onClose();
		} catch (e) {
			console.error('Error creando recordatorio:', e);
		} finally {
			saving = false;
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function stopProp(e: MouseEvent) {
		e.stopPropagation();
	}

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}
</script>

<div
	class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
	onclick={handleBackdrop}
	role="dialog"
	aria-modal="true"
	transition:fade={{ duration: 200 }}
>
	<div
		class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
		onclick={stopProp}
		role="document"
		transition:fly={{ y: 20, duration: 250, opacity: 0 }}
	>
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
					<svg
						class="h-5 w-5 text-orange-600"
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
				<div>
					<h2 class="text-lg font-bold text-gray-900">Nuevo recordatorio</h2>
					<p class="text-xs text-gray-500">
						Planifica una acci&oacute;n para esta liquidaci&oacute;n
					</p>
				</div>
			</div>
			<button
				onclick={onClose}
				class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
				title="Cerrar"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Form -->
		<div class="flex flex-col gap-3">
			<!-- Descripci&oacute;n -->
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-gray-700"
					>Descripci&oacute;n <span class="text-red-500">*</span></span
				>
			<textarea
				bind:value={descripcion}
				placeholder="Ej: Descontar $500.000 por concepto de..."
				class="input-glow w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400"
				rows="3"
				maxlength={maxChars}
			></textarea>
				<div
					class="mt-1 flex justify-end text-[10px] {charCount > maxChars
						? 'text-red-500'
						: 'text-gray-400'}"
				>
					{charCount}/{maxChars}
				</div>
			</label>

			<!-- Placa -->
			<div>
				<span class="mb-1.5 block text-xs font-medium text-gray-700">Placa</span>
				<div
					class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm font-semibold text-gray-600"
				>
					{fmtPlaca(liquidacionInfo.placa)}
				</div>
			</div>

			<!-- Mes y A&ntilde;o -->
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium text-gray-700"
						>Mes objetivo <span class="text-red-500">*</span></span
					>
					<select
						bind:value={mes}
						class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-400 focus:outline-none"
					>
						{#each MESES as m, i}
							<option value={i + 1}>{m}</option>
						{/each}
					</select>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium text-gray-700"
						>A&ntilde;o objetivo <span class="text-red-500">*</span></span
					>
					<input
						type="number"
						bind:value={anio}
						min={liquidacionInfo.anio}
						class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-400 focus:outline-none"
					/>
				</label>
			</div>

			<!-- Monto -->
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-gray-700">Monto (opcional)</span>
				<div class="relative">
					<span class="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-gray-400">$</span>
					<input
						type="number"
						bind:value={monto}
						placeholder="0"
						min="0"
						class="w-full rounded-xl border border-gray-200 bg-white py-2 pr-3 pl-7 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400 focus:outline-none"
					/>
				</div>
			</label>

			<!-- Prioridad -->
			<div>
				<span class="mb-1.5 block text-xs font-medium text-gray-700">Prioridad</span>
				<div class="flex gap-2">
					{#each [{ key: 'BAJA', bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db' }, { key: 'MEDIA', bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' }, { key: 'ALTA', bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }] as p}
						<button
							onclick={() => (prioridad = p.key as any)}
							class="rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors {prioridad ===
							p.key
								? 'ring-2 ring-orange-400'
								: ''}"
							style="background-color: {p.bg}; color: {p.fg}; border-color: {p.border}"
						>
							{p.key}
						</button>
					{/each}
				</div>
			</div>

			<!-- Aplica el -->
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-gray-700">Aplicar el (opcional)</span>
			<input
				type="date"
				bind:value={aplicaEn}
				class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-400 focus:outline-none"
			/>
			</label>
		</div>

		<!-- Footer -->
		<div class="mt-5 flex items-center justify-end gap-2">
			<button
				onclick={onClose}
				class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
			>
				Cancelar
			</button>
			<button
				onclick={handleSubmit}
				disabled={!isValid || saving}
				class="apple-hover emerald-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
			>
				{#if saving}
					<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						/>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						/>
					</svg>
					Creando...
				{:else}
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Crear recordatorio
				{/if}
			</button>
		</div>
	</div>
</div>
