<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import {
		getEstadoText,
		getEstadoColor,
		formatCurrency,
		formatDateTime,
		type ServicioConRelaciones
	} from '$lib/types/servicios';
	// import ModalTicket from './ModalTicket.svelte';

	export let servicio: ServicioConRelaciones;
	// export let onClick: (() => void) | undefined = undefined;
	export let onEdit: ((servicio: ServicioConRelaciones) => void) | undefined = undefined;

	// let showTicketModal = false;
	let showActions = false;

	// function handleTicket(e: MouseEvent) {
	// 	e.stopPropagation();
	// 	showTicketModal = true;
	// }

	function handleEdit(e: MouseEvent) {
		e.stopPropagation();
		if (onEdit) {
			onEdit(servicio);
		}
	}

	// function handleView(e: MouseEvent) {
	// 	e.stopPropagation();
	// 	if (onClick) {
	// 		onClick();
	// 	}
	// }

	function toggleActions(e: MouseEvent) {
		e.stopPropagation();
		showActions = !showActions;
	}

	// Verificar si se puede editar según el estado
	$: canEdit = ['solicitado', 'asignado', 'en_curso'].includes(servicio.estado);
	$: canShowTicket = !['solicitado', 'cancelado'].includes(servicio.estado);
</script>

<div
	class="glass soft-shadow apple-transition group w-full overflow-hidden rounded-2xl border border-gray-200/50 hover:scale-[1.02]"
	in:fade={{ duration: 300 }}
>
	<!-- Header con gradiente -->
	<div class="border-b border-gray-200/50 bg-gradient-to-r from-orange-50 to-transparent p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex-1 min-w-0">
				<div class="mb-2 flex items-center gap-2">
					<div
						class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<span class="font-mono text-xs text-gray-500 truncate">#{servicio.id.slice(0, 8)}</span>
				</div>
				<h3 class="mb-1 text-base sm:text-lg font-semibold text-gray-900 break-words">{servicio.cliente.nombre}</h3>
			</div>
			<span
				class="rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap self-start"
				style="background-color: {getEstadoColor(servicio.estado)}15; border-color: {getEstadoColor(
					servicio.estado
				)}40; color: {getEstadoColor(servicio.estado)}"
			>
				{getEstadoText(servicio.estado)}
			</span>
		</div>
	</div>

	<!-- Body -->
	<div class="space-y-4 p-4">
		<!-- Ruta -->
		<div class="space-y-2">
			<div class="flex items-start gap-3">
				<div
					class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100"
				>
					<span class="text-xs font-bold text-orange-600">A</span>
				</div>
				<div class="min-w-0 flex-1">
					<p class="mb-0.5 text-xs text-gray-500">Origen</p>
					<p class="text-sm font-medium text-gray-900 break-words">
						{servicio.origen_especifico || servicio.origen.nombre_municipio}
					</p>
				</div>
			</div>

			<div class="ml-3 h-6 border-l-2 border-dashed border-gray-300"></div>

			<div class="flex items-start gap-3">
				<div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-red-100">
					<span class="text-xs font-bold text-red-600">B</span>
				</div>
				<div class="min-w-0 flex-1">
					<p class="mb-0.5 text-xs text-gray-500">Destino</p>
					<p class="text-sm font-medium text-gray-900 break-words">
						{servicio.destino_especifico || servicio.destino.nombre_municipio}
					</p>
				</div>
			</div>
		</div>

		<!-- Detalles -->
		<div class="space-y-2 border-t border-gray-200/50 pt-4">
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-sm">
				<span class="text-gray-500">Conductor:</span>
				<span class="font-medium text-gray-900 break-words text-right">
					{servicio.conductor
						? `${servicio.conductor.nombre} ${servicio.conductor.apellido}`
						: 'No asignado'}
				</span>
			</div>

			{#if servicio.vehiculo}
				<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-sm">
					<span class="text-gray-500">Vehículo:</span>
					<span class="font-bold text-gray-900">{servicio.vehiculo.placa}</span>
				</div>
			{/if}

			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-sm">
				<span class="text-gray-500">Fecha:</span>
				<span class="font-medium text-gray-900 text-xs sm:text-sm">{formatDateTime(servicio.fecha_solicitud)}</span>
			</div>

			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between border-t border-gray-200/50 pt-2 gap-1 sm:gap-2 text-sm">
				<span class="text-gray-500">Valor:</span>
				<span class="text-base sm:text-lg font-bold text-orange-600">{formatCurrency(servicio.valor)}</span>
			</div>
		</div>
	</div>

	<!-- Footer con acciones -->
	<div class="border-t border-gray-200/50 bg-gray-50/50 px-4 py-3">
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
			<!-- Botones de acción principales -->
			<div class="flex items-center gap-2">
				<!-- Ver detalles -->
				<!-- {#if onClick}
					<button
						on:click={handleView}
						class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium apple-transition flex items-center gap-2"
						title="Ver detalles"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
						</svg>
						<span>Ver</span>
					</button>
				{/if} -->

				<!-- Editar -->
				{#if onEdit && canEdit}
					<button
						on:click={handleEdit}
						class="apple-transition flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 w-full sm:w-auto"
						title="Editar servicio"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
						<span>Editar</span>
					</button>
				{/if}

				<!-- Ticket -->
				<!-- {#if canShowTicket}
					<button
						on:click={handleTicket}
						class="px-4 py-2 glass border border-gray-200 hover:border-orange-400 hover:bg-orange-50 text-gray-700 hover:text-orange-700 rounded-xl text-sm font-medium apple-transition flex items-center gap-2"
						title="Ver ticket"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
						</svg>
						<span>Ticket</span>
					</button>
				{/if} -->
			</div>

			<!-- Menú de más opciones -->
			<div class="relative">
				<button
					on:click={toggleActions}
					class="apple-transition rounded-lg p-2 hover:bg-gray-100"
					title="Más opciones"
				>
					<svg class="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
						/>
					</svg>
				</button>

				{#if showActions}
					<div
						class="absolute right-0 bottom-full z-10 mb-2 min-w-[180px] rounded-xl border border-gray-200 bg-white py-2 shadow-lg"
						transition:scale={{ duration: 150 }}
					>
						<button
							on:click={(e) => {
								e.stopPropagation();
								showActions = false;
								// Agregar funcionalidad
							}}
							class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							Historial
						</button>
						<button
							on:click={(e) => {
								e.stopPropagation();
								showActions = false;
								// Agregar funcionalidad
							}}
							class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							Exportar
						</button>
						<div class="my-1 border-t border-gray-200"></div>
						<button
							on:click={(e) => {
								e.stopPropagation();
								showActions = false;
								// Agregar funcionalidad de cancelar
							}}
							class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
							Cancelar servicio
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- Modal de Ticket -->
<!-- <ModalTicket
	bind:isOpen={showTicketModal}
	{servicio}
	onClose={() => showTicketModal = false}
/> -->
