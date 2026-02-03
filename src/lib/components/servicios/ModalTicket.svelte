<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import {
		formatCurrency,
		formatDateTime,
		getEstadoColor,
		getEstadoText
	} from '$lib/types/servicios';
	import { serviciosStore } from '$lib/stores/servicios';

	export let servicio: ServicioConRelaciones | null = null;
	export let onClose: () => void;

	let isSharing = false;
	let isGeneratingLink = false;
	let shareUrl = '';

	function handleClose() {
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	async function handleShare() {
		if (!servicio) return;
		isSharing = true;

		try {
			const shareData = {
				title: `Servicio de Transporte - Cotransmeq`,
				text: `Servicio desde ${servicio.origen?.nombre_municipio || ''} hasta ${servicio.destino?.nombre_municipio || ''}\nConductor: ${servicio.conductor?.nombre || ''} ${servicio.conductor?.apellido || ''}\nEstado: ${getEstadoText(servicio.estado)}`,
				url: window.location.origin + `/servicios/${servicio.id}`
			};

			// Verificar si el navegador soporta Web Share API
			if (navigator.share) {
				await navigator.share(shareData);
			} else {
				// Fallback: copiar al portapapeles
				await navigator.clipboard.writeText(shareData.url);
				toast.success('Enlace copiado al portapapeles');
			}
		} catch (error: any) {
			// El usuario canceló o hubo un error
			if (error.name !== 'AbortError') {
				console.error('Error al compartir:', error);
				toast.error('Error al compartir el ticket');
			}
		} finally {
			isSharing = false;
		}
	}

	async function handleGenerateShareLink() {
		if (!servicio) return;
		isGeneratingLink = true;

		try {
			let token = servicio.share_token;

			// Si no tiene token, generarlo usando el store
			if (!token) {
				const generatedToken = await serviciosStore.generarShareToken(servicio.id);
				token = generatedToken;
				if (!token) {
					toast.error('Error al generar enlace compartible');
					isGeneratingLink = false;
					return;
				}
			}

			// Construir URL pública con el token
			const baseUrl = window.location.origin;
			shareUrl = `${baseUrl}/public/servicio/${token}`;

			// Copiar al portapapeles
			await navigator.clipboard.writeText(shareUrl);

			// Mostrar feedback visual
			toast.success('¡Enlace copiado al portapapeles!');
		} catch (error) {
			console.error('Error al generar enlace:', error);
			toast.error('Error al generar el enlace compartido');
		} finally {
			isGeneratingLink = false;
		}
	}

	// Obtener foto del conductor con URL firmada
	function getConductorPhoto() {
		console.log('🖼️ Conductor data:', {
			conductor: servicio?.conductor,
			foto_url: servicio?.conductor?.foto_url,
			foto_signed_url: servicio?.conductor?.foto_signed_url
		});

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
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		on:click={handleBackdropClick}
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			class="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:fly={{ y: 20, duration: 300, easing: cubicOut }}
			on:click={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header Compacto -->
			<div
				class="relative flex items-center justify-between bg-gradient-to-br from-orange-500 to-orange-600 px-4 py-3 text-white"
			>
				<div class="flex items-center gap-2">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div>
						<h2 class="text-base font-bold">Cotransmeq</h2>
						<p class="text-[10px] text-orange-100">Ticket de Servicio</p>
					</div>
				</div>

				<div class="flex items-center gap-1.5">
					<!-- Botón generar link -->
					<button
						on:click={handleGenerateShareLink}
						disabled={isGeneratingLink}
						class="apple-transition rounded-lg bg-white/20 p-1.5 hover:bg-white/30 disabled:opacity-50"
						title="Copiar enlace"
					>
						{#if isGeneratingLink}
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
								/>
							</svg>
						{/if}
					</button>

					<!-- Botón compartir -->
					<button
						on:click={handleShare}
						disabled={isSharing}
						class="apple-transition rounded-lg bg-white/20 p-1.5 hover:bg-white/30 disabled:opacity-50"
						title="Compartir ticket"
					>
						{#if isSharing}
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
								/>
							</svg>
						{/if}
					</button>

					<!-- Botón cerrar -->
					<button
						on:click={handleClose}
						class="apple-transition rounded-lg bg-white/20 p-1.5 hover:bg-white/30"
						title="Cerrar"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Content - Layout Horizontal Compacto -->
			<div class="p-4">
				<div class="grid gap-4 md:grid-cols-[250px_1fr]">
					<!-- Sidebar en Columna - Conductor y Vehículo -->
					<div class="glass rounded-lg p-3">
						<!-- Foto del conductor -->
						<div
							class="relative mx-auto mb-3 h-56 w-56 overflow-hidden rounded-lg bg-gradient-to-br from-gray-100 to-gray-200"
						>
							<img
								src={getConductorPhoto()}
								alt="Foto del conductor"
								class="h-full w-full object-cover"
							/>
							<div
								class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent"
							></div>
						</div>

						<!-- Info del conductor -->
						<div class="mb-3">
							<h3 class="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Conductor
							</h3>
							<p class="text-xs leading-tight font-bold text-gray-900">
								{servicio.conductor?.nombre || ''}
								{servicio.conductor?.apellido || ''}
							</p>
							<p class="mt-1 text-xs text-gray-600">
								{servicio.conductor?.numero_identificacion || 'Sin ID'}
							</p>
							<p class="text-xs text-gray-600">
								{servicio.conductor?.telefono || 'Sin teléfono'}
							</p>
						</div>

						<!-- Info Vehículo -->
						{#if servicio.vehiculo}
							<div class="border-t border-gray-200/50 pt-3">
								<h3 class="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Vehículo
								</h3>
								<p class="text-xs font-bold text-gray-900">{servicio.vehiculo.placa}</p>
								<p class="text-xs text-gray-600">
									{servicio.vehiculo.marca}
									{servicio.vehiculo.modelo}
								</p>
							</div>
						{/if}
					</div>

					<!-- Main Content Compacto -->
					<div class="space-y-3">
						<!-- Fila 1: Cliente y Ruta en una línea -->
						<div class="grid gap-3 md:grid-cols-2">
							<!-- Cliente -->
							<div class="glass rounded-lg p-3">
								<div class="flex items-center gap-2">
									<div
										class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600"
									>
										<svg
											class="h-3.5 w-3.5 text-white"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
											/>
										</svg>
									</div>
									<div class="min-w-0 flex-1">
										<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
											Cliente
										</h3>
										<p class="truncate text-xs font-bold text-gray-900">
											{servicio.cliente.nombre}
										</p>
										{#if servicio.cliente.nit}
											<p class="text-xs text-gray-600">NIT: {servicio.cliente.nit}</p>
										{/if}
									</div>
								</div>
							</div>

							<!-- Estado y Planilla -->
							<div class="glass rounded-lg p-3">
								<div class="flex items-center justify-between">
									<div>
										<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
											Estado
										</h3>
										<span
											class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
											style="background-color: {getEstadoColor(
												servicio.estado
											)}15; color: {getEstadoColor(
												servicio.estado
											)}; border: 1px solid {getEstadoColor(servicio.estado)}40"
										>
											{getEstadoText(servicio.estado)}
										</span>
									</div>
									{#if servicio.numero_planilla}
										<div class="text-right">
											<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
												Planilla
											</h3>
											<p class="text-xs font-bold text-gray-900">{servicio.numero_planilla}</p>
										</div>
									{/if}
								</div>
							</div>
						</div>

						<!-- Ruta Compacta -->
						<div class="glass rounded-lg p-3">
							<h3 class="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Ruta del Servicio
							</h3>
							<div class="flex items-center gap-2">
								<!-- Origen -->
								<div class="flex flex-1 items-center gap-2">
									<div
										class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br from-orange-400 to-orange-600"
									>
										<span class="text-xs font-bold text-white">A</span>
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-semibold text-gray-900">
											{servicio.origen?.nombre_municipio || 'No especificado'}
										</p>
										{#if servicio.origen_especifico}
											<p class="truncate text-xs text-gray-600">{servicio.origen_especifico}</p>
										{/if}
									</div>
								</div>

								<!-- Flecha -->
								<svg
									class="h-4 w-4 flex-shrink-0 text-gray-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M14 5l7 7m0 0l-7 7m7-7H3"
									/>
								</svg>

								<!-- Destino -->
								<div class="flex flex-1 items-center gap-2">
									<div
										class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br from-red-400 to-red-600"
									>
										<span class="text-xs font-bold text-white">B</span>
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-semibold text-gray-900">
											{servicio.destino?.nombre_municipio || 'No especificado'}
										</p>
										{#if servicio.destino_especifico}
											<p class="truncate text-xs text-gray-600">{servicio.destino_especifico}</p>
										{/if}
									</div>
								</div>
							</div>
						</div>

						<!-- Detalles del Servicio en Grid Compacto -->
						<div class="glass rounded-lg p-3">
							<h3 class="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Información del Servicio
							</h3>
							<div class="grid grid-cols-2 gap-x-4 gap-y-2">
								<div>
									<p class="text-xs text-gray-500">Fecha Solicitud</p>
									<p class="text-xs font-medium text-gray-900">
										{formatDateTime(servicio.fecha_solicitud)}
									</p>
								</div>

								{#if servicio.fecha_realizacion}
									<div>
										<p class="text-xs text-gray-500">Fecha Realización</p>
										<p class="text-xs font-medium text-gray-900">
											{formatDateTime(servicio.fecha_realizacion)}
										</p>
									</div>
								{/if}

								{#if servicio.proposito_servicio}
									<div class="col-span-2">
										<p class="text-xs text-gray-500">Propósito</p>
										<p class="text-xs font-medium text-gray-900 capitalize">
											{servicio.proposito_servicio}
										</p>
									</div>
								{/if}

								<div class="col-span-2 border-t border-gray-200/50 pt-2">
									<p class="text-xs text-gray-500">Observaciones</p>
									<p class="text-xs text-gray-700">
										{servicio.observaciones || 'Sin observaciones'}
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.glass {
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.5);
	}

	.apple-transition {
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
</style>
