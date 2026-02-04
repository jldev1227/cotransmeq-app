<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import { toPng } from 'html-to-image';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import {
		formatCurrency,
		formatDateTime,
		getEstadoColor,
		getEstadoText
	} from '$lib/types/servicios';

	export let servicio: ServicioConRelaciones | null = null;
	export let onClose: () => void;

	let isSharing = false;
	let modalContainerRef: HTMLElement | undefined;

	function handleClose() {
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	async function handleShareTicket() {
		if (!servicio || !modalContainerRef) return;
		isSharing = true;

		const images = modalContainerRef.querySelectorAll('img');
		
		try {
			// Reemplazar TODAS las imágenes con placeholder SVG ANTES de capturar
			// Esto evita completamente los problemas de CORS con S3
			const placeholderSvg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"%3E%3Crect width="24" height="24" fill="%23e5e7eb"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%239ca3af"/%3E%3C/svg%3E';
			
			images.forEach((img) => {
				const imgElement = img as HTMLImageElement;
				// Si es una imagen externa (no data URL)
				if (imgElement.src.startsWith('http')) {
					imgElement.setAttribute('data-original-src', imgElement.src);
					imgElement.src = placeholderSvg;
				}
			});

			// Pequeño delay para que el DOM se actualice
			await new Promise(resolve => setTimeout(resolve, 50));

			// Generar imagen del modal usando html-to-image
			const dataUrl = await toPng(modalContainerRef, {
				backgroundColor: '#ffffff',
				pixelRatio: 2, // Mayor calidad
				skipAutoScale: false,
				cacheBust: false, // Desactivar para evitar problemas con imágenes ya convertidas
				// Evitar problemas con CORS
				skipFonts: true, // Ignorar fuentes externas
				preferredFontFormat: 'woff2',
				filter: (element) => {
					// Ignorar solo el botón de cerrar X y los botones de acción del footer
					const isCloseButton = element.getAttribute?.('aria-label') === 'Cerrar modal';
					const isActionButton = element.tagName === 'BUTTON' && element.closest('.flex-shrink-0');
					return !isCloseButton && !isActionButton;
				}
			});

			// Convertir dataURL a blob
			const response = await fetch(dataUrl);
			const blob = await response.blob();

			// Crear archivo para compartir
			const file = new File([blob], `ticket-${servicio.id.slice(0, 8)}.png`, {
				type: 'image/png'
			});

			const shareData = {
				title: 'Ticket de Servicio - Cotransmeq',
				text: `Servicio ${servicio.origen?.nombre_municipio || ''} → ${servicio.destino?.nombre_municipio || ''}\nEstado: ${getEstadoText(servicio.estado)}`,
				files: [file]
			};

			// Verificar si el navegador soporta compartir archivos
			if (navigator.canShare && navigator.canShare(shareData)) {
				await navigator.share(shareData);
				toast.success('Ticket compartido exitosamente');
			} else {
				// Fallback: descargar la imagen
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `ticket-${servicio.id.slice(0, 8)}.png`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				toast.success('Ticket descargado como imagen');
			}
		} catch (error: any) {
			if (error.name !== 'AbortError') {
				console.error('Error al compartir:', error);
				toast.error('Error al generar el ticket');
			}
		} finally {
			// Restaurar las imágenes originales siempre
			images.forEach((img) => {
				const originalSrc = img.getAttribute('data-original-src');
				if (originalSrc) {
					img.src = originalSrc;
					img.removeAttribute('data-original-src');
				}
			});
			isSharing = false;
		}
	}

	// Obtener foto del conductor con URL firmada
	function getConductorPhoto() {
		if (servicio?.conductor?.foto_signed_url) {
			return servicio.conductor.foto_signed_url;
		}
		
		// Placeholder si no hay foto
		return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"%3E%3Crect width="24" height="24" fill="%23e5e7eb"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%239ca3af"/%3E%3C/svg%3E';
	}
</script>

{#if servicio}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/50 p-4 pt-20 sm:pt-4 backdrop-blur-sm"
		on:click={handleBackdropClick}
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- Modal - Más compacto con scroll interno si es necesario -->
		<div
			bind:this={modalContainerRef}
			class="relative w-full max-w-4xl my-auto overflow-hidden rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col"
			transition:fly={{ y: 20, duration: 300, easing: cubicOut }}
			role="document"
		>
			<!-- Header compacto -->
			<div class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="rounded-lg bg-orange-100 p-2">
						<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
					<div>
						<h3 class="text-lg font-bold text-gray-900">Ticket de Servicio</h3>
						<p class="text-sm text-gray-500">#{servicio.id.slice(0, 8).toUpperCase()}</p>
					</div>
				</div>
				<button
					on:click={handleClose}
					class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					aria-label="Cerrar modal"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content en 2 columnas - Con scroll -->
			<div class="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 overflow-y-auto flex-1">
				<!-- Columna izquierda: Info principal -->
				<div class="space-y-4">
					<!-- Estado -->
					<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
						<div class="mb-2 text-xs font-medium text-gray-500">Estado</div>
						<div
							class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold"
							style="background-color: {getEstadoColor(servicio.estado)}20; color: {getEstadoColor(servicio.estado)}"
						>
							<div class="h-2 w-2 rounded-full" style="background-color: {getEstadoColor(servicio.estado)}"></div>
							{getEstadoText(servicio.estado)}
						</div>
					</div>

					<!-- Cliente -->
					<div>
						<div class="mb-2 text-xs font-medium text-gray-500">Cliente</div>
						<div class="flex items-center gap-2">
							<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
							</svg>
							<span class="font-medium text-gray-900">{servicio.cliente?.nombre || 'Sin cliente'}</span>
						</div>
					</div>

					<!-- Ruta -->
					<div>
						<div class="mb-2 text-xs font-medium text-gray-500">Ruta</div>
						<div class="space-y-2">
							<div class="flex items-start gap-2">
								<div class="mt-1 h-3 w-3 rounded-full border-2 border-green-500 bg-green-100"></div>
								<div class="flex-1">
									<div class="text-sm font-medium text-gray-900">{servicio.origen?.nombre_municipio || 'Origen'}</div>
									{#if servicio.origen_especifico}
										<div class="text-xs text-gray-500">{servicio.origen_especifico}</div>
									{/if}
								</div>
							</div>
							<div class="ml-1.5 h-8 w-0.5 bg-gray-300"></div>
							<div class="flex items-start gap-2">
								<div class="mt-1 h-3 w-3 rounded-full border-2 border-red-500 bg-red-100"></div>
								<div class="flex-1">
									<div class="text-sm font-medium text-gray-900">{servicio.destino?.nombre_municipio || 'Destino'}</div>
									{#if servicio.destino_especifico}
										<div class="text-xs text-gray-500">{servicio.destino_especifico}</div>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<!-- Fechas -->
					<div class="grid grid-cols-2 gap-3">
						<div>
							<div class="mb-1 text-xs font-medium text-gray-500">Solicitud</div>
							<div class="text-sm text-gray-900">{formatDateTime(servicio.fecha_solicitud).split(',')[0]}</div>
							<div class="text-xs text-gray-500">{formatDateTime(servicio.fecha_solicitud).split(',')[1]}</div>
						</div>
						{#if servicio.fecha_realizacion}
							<div>
								<div class="mb-1 text-xs font-medium text-gray-500">Realización</div>
								<div class="text-sm text-gray-900">{formatDateTime(servicio.fecha_realizacion).split(',')[0]}</div>
								<div class="text-xs text-gray-500">{formatDateTime(servicio.fecha_realizacion).split(',')[1]}</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Columna derecha: Recursos -->
				<div class="space-y-4">
					<!-- Conductor -->
					{#if servicio.conductor}
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<div class="mb-3 text-xs font-medium text-gray-500">Conductor</div>
							<div class="flex items-center gap-3">
								<img
									src={getConductorPhoto()}
									alt="Conductor"
									class="h-12 w-12 rounded-full object-cover ring-2 ring-gray-100"
								/>
								<div class="flex-1">
									<div class="font-medium text-gray-900">{servicio.conductor.nombre} {servicio.conductor.apellido}</div>
									{#if servicio.conductor.telefono}
										<div class="text-sm text-gray-500">{servicio.conductor.telefono}</div>
									{/if}
								</div>
							</div>
						</div>
					{:else}
						<div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
							<div class="text-center text-sm text-gray-500">Sin conductor asignado</div>
						</div>
					{/if}

					<!-- Vehículo -->
					{#if servicio.vehiculo}
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<div class="mb-3 text-xs font-medium text-gray-500">Vehículo</div>
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<div class="rounded bg-orange-100 px-2 py-1 text-sm font-bold text-orange-600">
										{servicio.vehiculo.placa}
									</div>
								</div>
								<div class="text-sm text-gray-900">{servicio.vehiculo.marca} {servicio.vehiculo.modelo}</div>
								<div class="text-xs text-gray-500">{servicio.vehiculo.clase_vehiculo}</div>
							</div>
						</div>
					{:else}
						<div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
							<div class="text-center text-sm text-gray-500">Sin vehículo asignado</div>
						</div>
					{/if}

					<!-- Propósito y Valor -->
					<div class="grid grid-cols-2 gap-3">
						<div>
							<div class="mb-1 text-xs font-medium text-gray-500">Propósito</div>
							<div class="text-sm font-medium capitalize text-gray-900">{servicio.proposito_servicio?.replace('_', ' ')}</div>
						</div>
						{#if servicio.valor && Number(servicio.valor) > 0}
							<div>
								<div class="mb-1 text-xs font-medium text-gray-500">Valor</div>
								<div class="text-sm font-bold text-gray-900">{formatCurrency(Number(servicio.valor))}</div>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Observaciones -->
			{#if servicio.observaciones}
				<div class="border-t border-gray-200 bg-gray-50 px-6 py-4">
					<div class="mb-2 text-xs font-medium text-gray-500">Observaciones</div>
					<div class="text-sm text-gray-700">{servicio.observaciones}</div>
				</div>
			{/if}

			<!-- Footer con acciones - Fijo en la parte inferior -->
			<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-gray-200 bg-white px-6 py-4 flex-shrink-0">
				<div class="text-xs text-gray-400 text-center sm:text-left">
					Generado el {new Date().toLocaleDateString('es-CO')}
				</div>
				<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
					<button
						on:click={handleShareTicket}
						disabled={isSharing}
						class="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
					>
						{#if isSharing}
							<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
						{/if}
						<span class="hidden sm:inline">Compartir Imagen</span>
						<span class="sm:hidden">Compartir</span>
					</button>
					<button
						on:click={handleClose}
						class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
					>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}


