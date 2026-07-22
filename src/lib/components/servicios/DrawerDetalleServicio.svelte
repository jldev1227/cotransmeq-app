<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import { getEstadoColor, getEstadoText } from '$lib/types/servicios';

	type Props = {
		servicio: ServicioConRelaciones | null;
		onClose: () => void;
		onEdit: (servicio: ServicioConRelaciones) => void;
		onTicket: (servicio: ServicioConRelaciones) => void;
		onDelete: (servicio: ServicioConRelaciones) => void;
	};

	let { servicio, onClose, onEdit, onTicket, onDelete }: Props = $props();

	function formatCurrency(n: number) {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(n);
	}

	function formatDate(s?: string) {
		if (!s) return '—';
		return new Date(s).toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	function formatTime(s?: string) {
		if (!s) return null;
		const d = new Date(s);
		return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
	}

	function handleBackdropKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window on:keydown={(e) => servicio && handleBackdropKey(e)} />

{#if servicio}
	<div
		class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		onclick={onClose}
		role="presentation"
	></div>

	<aside
		class="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
		transition:fly={{ x: 420, duration: 280 }}
	>
		<header class="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg class="h-4.5 w-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
						</svg>
					</div>
					<div class="min-w-0">
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Servicio #{servicio.id.slice(0, 8)}</p>
						<h2 class="truncate text-base font-bold text-gray-900">Detalle del servicio</h2>
					</div>
				</div>
			</div>
			<button
				onclick={onClose}
				class="apple-transition rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
				aria-label="Cerrar"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</header>

		<div class="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-5 py-2.5">
			<span
				class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
				style="background-color: {getEstadoColor(servicio.estado)}15; border-color: {getEstadoColor(servicio.estado)}40; color: {getEstadoColor(servicio.estado)}"
			>
				<span class="h-1.5 w-1.5 rounded-full" style="background-color: {getEstadoColor(servicio.estado)}"></span>
				{getEstadoText(servicio.estado)}
			</span>
			<span class="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
				{servicio.proposito_servicio}
			</span>
			{#if servicio.numero_planilla}
				<span class="inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-purple-700">
					{servicio.numero_planilla}
				</span>
			{/if}
		</div>

		<div class="flex-1 overflow-y-auto px-5 py-4">
			<section class="mb-5">
				<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recorrido</p>
				<div class="space-y-2">
					<div class="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
						<div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100">
							<div class="h-2 w-2 rounded-full bg-orange-600"></div>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Origen</p>
							<p class="truncate text-xs font-semibold text-gray-900">
								{servicio.origen_especifico || servicio.origen?.nombre_municipio || '—'}
							</p>
							{#if servicio.origen_especifico && servicio.origen?.nombre_municipio}
								<p class="truncate text-[10px] text-gray-500">{servicio.origen.nombre_municipio}</p>
							{/if}
						</div>
					</div>

					<div class="ml-3 h-3 w-px border-l-2 border-dashed border-gray-300"></div>

					<div class="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
						<div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100">
							<div class="h-2 w-2 rounded-full bg-red-600"></div>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Destino</p>
							<p class="truncate text-xs font-semibold text-gray-900">
								{servicio.destino_especifico || servicio.destino?.nombre_municipio || '—'}
							</p>
							{#if servicio.destino_especifico && servicio.destino?.nombre_municipio}
								<p class="truncate text-[10px] text-gray-500">{servicio.destino.nombre_municipio}</p>
							{/if}
						</div>
					</div>
				</div>
			</section>

			<section class="mb-5">
				<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Asignaciones</p>
				<div class="grid grid-cols-1 gap-2">
					<div class="rounded-xl border border-gray-200 bg-white p-3">
						<div class="flex items-center gap-2">
							<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600">
								<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Conductor</p>
								<p class="truncate text-xs font-semibold text-gray-900">
									{servicio.conductor ? `${servicio.conductor.nombre} ${servicio.conductor.apellido || ''}`.trim() : 'Sin asignar'}
								</p>
							</div>
						</div>
					</div>

					<div class="rounded-xl border border-gray-200 bg-white p-3">
						<div class="flex items-center gap-2">
							<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600">
								<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Vehículo</p>
								<p class="truncate font-mono text-xs font-semibold text-orange-700">
									{servicio.vehiculo?.placa || 'Sin asignar'}
								</p>
							</div>
						</div>
					</div>

					<div class="rounded-xl border border-gray-200 bg-white p-3">
						<div class="flex items-center gap-2">
							<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-400 to-purple-600">
								<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Cliente</p>
								<p class="truncate text-xs font-semibold text-gray-900">{servicio.cliente?.nombre || '—'}</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section class="mb-5">
				<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Fechas</p>
				<div class="rounded-xl border border-gray-200 bg-white">
					<div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
						<span class="text-[11px] text-gray-600">Solicitado</span>
						<span class="text-xs font-semibold text-gray-900 tabular-nums">{formatDate(servicio.fecha_solicitud)}</span>
					</div>
					<div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
						<span class="text-[11px] text-gray-600">Realización</span>
						<span class="text-xs font-semibold text-gray-900 tabular-nums">
							{formatDate(servicio.fecha_realizacion)}{#if formatTime(servicio.fecha_realizacion)}
								<span class="ml-1 text-[10px] font-normal text-gray-500">{formatTime(servicio.fecha_realizacion)}</span>
							{/if}
						</span>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-[11px] text-gray-600">Finalización</span>
						<span class="text-xs font-semibold text-gray-900 tabular-nums">
							{formatDate(servicio.fecha_finalizacion)}{#if formatTime(servicio.fecha_finalizacion)}
								<span class="ml-1 text-[10px] font-normal text-gray-500">{formatTime(servicio.fecha_finalizacion)}</span>
							{/if}
						</span>
					</div>
				</div>
			</section>

			<section class="mb-5">
				<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Valor</p>
				<div class="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
					<p class="text-xl font-bold text-orange-700 tabular-nums">{formatCurrency(servicio.valor)}</p>
				</div>
			</section>

			{#if servicio.observaciones}
				<section class="mb-5">
					<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Observaciones</p>
					<div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
						{servicio.observaciones}
					</div>
				</section>
			{/if}

			{#if servicio.cancelacion}
				<section class="mb-5">
					<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-600">Cancelación</p>
					<div class="rounded-xl border border-red-200 bg-red-50 p-3">
						<p class="text-[10px] font-medium uppercase tracking-wide text-red-700">
							{formatDate(servicio.cancelacion.fecha_cancelacion)}
						</p>
						{#if servicio.cancelacion.motivo_cancelacion}
							<p class="mt-1 text-xs font-semibold text-red-900">{servicio.cancelacion.motivo_cancelacion}</p>
						{/if}
						{#if servicio.cancelacion.observaciones}
							<p class="mt-1 text-xs text-red-700">{servicio.cancelacion.observaciones}</p>
						{/if}
					</div>
				</section>
			{/if}
		</div>

		<footer class="flex flex-shrink-0 items-center gap-2 border-t border-gray-100 bg-white px-5 py-3">
			<button
				onclick={() => onDelete(servicio)}
				class="apple-transition flex items-center gap-1.5 rounded-xl p-2 text-red-600 hover:bg-red-50"
				aria-label="Eliminar"
				title="Eliminar"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
				</svg>
			</button>
			<button
				onclick={() => onTicket(servicio)}
				class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
				title="Copiar enlace compartible"
			>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
				</svg>
				Ticket
			</button>
			<div class="flex-1"></div>
			<button
				onclick={onClose}
				class="apple-transition rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
			>
				Cerrar
			</button>
			<button
				onclick={() => onEdit(servicio)}
				class="apple-hover apple-transition emerald-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:from-orange-600 hover:to-orange-700"
			>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
				</svg>
				Editar
			</button>
		</footer>
	</aside>
{/if}
