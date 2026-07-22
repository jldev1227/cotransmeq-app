<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as chatStore from '$lib/stores/liquidacionChat';

	type Props = {
		liquidacionId: string;
		liquidacionInfo: { placa: string; mes: number; anio: number };
		onCreate: () => void;
	};

	let { liquidacionId, liquidacionInfo, onCreate }: Props = $props();

	type FilterType = 'TODOS' | 'PENDIENTE' | 'APLICADO' | 'CANCELADO' | 'VENCIDO';
	let activeFilter = $state<FilterType>('TODOS');
	let recordatorios = $state<any[]>([]);

	const unsub = chatStore.subscribe(() => {
		const s = chatStore.getState();
		recordatorios = [...s.recordatorios];
	});

	onDestroy(() => {
		if (unsub) unsub();
	});

	const filtered = $derived(
		activeFilter === 'TODOS'
			? recordatorios
			: recordatorios.filter((r) => r.estado === activeFilter)
	);

	const counts: Record<FilterType, number> = $derived({
		TODOS: recordatorios.length,
		PENDIENTE: recordatorios.filter((r) => r.estado === 'PENDIENTE').length,
		APLICADO: recordatorios.filter((r) => r.estado === 'APLICADO').length,
		CANCELADO: recordatorios.filter((r) => r.estado === 'CANCELADO').length,
		VENCIDO: recordatorios.filter((r) => r.estado === 'VENCIDO').length
	});

	const estadoColors: Record<
		string,
		{ bg: string; fg: string; border: string; dot: string; label: string }
	> = {
		PENDIENTE: {
			bg: '#fff7ed',
			fg: '#c2410c',
			border: '#fed7aa',
			dot: '#f97316',
			label: 'Pendiente'
		},
		APLICADO: {
			bg: '#ecfdf5',
			fg: '#047857',
			border: '#a7f3d0',
			dot: '#f97316',
			label: 'Aplicado'
		},
		CANCELADO: {
			bg: '#f3f4f6',
			fg: '#6b7280',
			border: '#d1d5db',
			dot: '#9ca3af',
			label: 'Cancelado'
		},
		VENCIDO: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca', dot: '#ef4444', label: 'Vencido' }
	};

	const prioridadColors: Record<string, { bg: string; fg: string; border: string }> = {
		BAJA: { bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db' },
		MEDIA: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
		ALTA: { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }
	};

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

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}

	function fmtCurrency(v: number) {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(v);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 py-2">
		{#each ['TODOS', 'PENDIENTE', 'APLICADO', 'CANCELADO', 'VENCIDO'] as filter}
			<button
				class="rounded-lg px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap transition-colors {activeFilter ===
				filter
					? 'bg-orange-500 text-white'
					: 'text-gray-500 hover:bg-gray-100'}"
				onclick={() => (activeFilter = filter as FilterType)}
			>
				{filter}
				{counts[filter as FilterType] > 0 ? `(${counts[filter as FilterType]})` : ''}
			</button>
		{/each}
	</div>

	<div class="flex-1 overflow-y-auto p-3">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center justify-center py-8 text-center">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100">
					<svg
						class="h-5 w-5 text-gray-400"
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
				<p class="text-sm font-semibold text-gray-900">Sin recordatorios</p>
				<p class="mt-1 text-xs text-gray-500">Crea un recordatorio para esta liquidaci&oacute;n</p>
				<button
					onclick={onCreate}
					class="mt-3 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:from-orange-600 hover:to-orange-700"
				>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Nuevo recordatorio
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each filtered as rec}
					<div class="rounded-xl border border-gray-200 bg-white p-3">
						<div class="mb-2 flex items-start justify-between gap-2">
							<div class="flex items-center gap-2">
								<svg
									class="h-4 w-4 text-orange-500"
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
								<span class="text-xs font-semibold text-gray-900">
									{MESES[rec.mes - 1]}
									{rec.anio}
								</span>
							</div>
							{#if estadoColors[rec.estado]}
								<span
									class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase"
									style="background-color: {estadoColors[rec.estado].bg}; color: {estadoColors[
										rec.estado
									].fg}; border-color: {estadoColors[rec.estado].border}"
								>
									<span
										class="h-1.5 w-1.5 rounded-full"
										style="background-color: {estadoColors[rec.estado].dot}"
									></span>
									{estadoColors[rec.estado].label}
								</span>
							{/if}
						</div>

						<p class="mb-2 text-sm text-gray-700">{rec.descripcion || '(cifrado)'}</p>

						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600"
							>
								{fmtPlaca(rec.placa)}
							</span>
							{#if rec.monto}
								<span class="text-xs font-bold text-orange-700 tabular-nums"
									>{fmtCurrency(rec.monto)}</span
								>
							{/if}
							{#if prioridadColors[rec.prioridad]}
								<span
									class="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
									style="background-color: {prioridadColors[rec.prioridad]
										.bg}; color: {prioridadColors[rec.prioridad]
										.fg}; border: 1px solid {prioridadColors[rec.prioridad].border}"
								>
									{rec.prioridad}
								</span>
							{/if}
						</div>

						{#if rec.estado === 'PENDIENTE'}
							<div class="mt-2 flex gap-2 border-t border-gray-100 pt-2">
							<button
								onclick={() => chatStore.cambiarEstadoRecordatorio(rec.id, 'APLICADO')}
								class="rounded-lg bg-orange-500 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-orange-600"
							>
								Aplicar
							</button>
							<button
								onclick={() => chatStore.cambiarEstadoRecordatorio(rec.id, 'CANCELADO')}
								class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
							>
								Cancelar
							</button>
							</div>
						{/if}

						<div class="mt-1.5 text-[9px] text-gray-400">
							Creado por {rec.creado_por_nombre} &middot; {new Date(
								rec.created_at
							).toLocaleDateString('es-CO')}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
