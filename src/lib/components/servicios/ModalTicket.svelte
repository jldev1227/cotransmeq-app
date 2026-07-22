<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import {
		formatCurrency,
		formatDateTime,
		getEstadoColor,
		getEstadoText
	} from '$lib/types/servicios';
	import { serviciosStore } from '$lib/stores/servicios';
	import { onMount } from 'svelte';

	export let servicio: ServicioConRelaciones | null = null;
	export let onClose: () => void;

	let isSharing = false;
	let ticketElement: HTMLElement;
	let captureElement: HTMLElement;
	let html2canvas: any = null;

	onMount(async () => {
		try {
			const module = await import('html2canvas');
			html2canvas = module.default;
		} catch (error) {
			console.error('Error cargando html2canvas:', error);
		}
	});

	function handleClose() {
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	async function handleShareTicket() {
		if (!servicio || !captureElement || !html2canvas) {
			toast.error('No se puede generar la imagen del ticket');
			return;
		}

		isSharing = true;

		try {
			captureElement.style.display = 'block';
			await new Promise((resolve) => requestAnimationFrame(resolve));

			const canvas = await html2canvas(captureElement, {
				backgroundColor: '#ffffff',
				scale: 2,
				logging: false,
				useCORS: true,
				allowTaint: true,
				width: captureElement.scrollWidth,
				height: captureElement.scrollHeight
			});

			captureElement.style.display = 'none';

			const blob = await new Promise<Blob>((resolve) => {
				canvas.toBlob((blob: Blob | null) => {
					resolve(blob!);
				}, 'image/png');
			});

			const file = new File([blob], `ticket-servicio-${servicio.id}.png`, {
				type: 'image/png'
			});

			if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
				await navigator.share({
					title: 'Ticket de Servicio - Cotransmeq',
					files: [file]
				});
				toast.success('Ticket compartido exitosamente');
			} else {
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `ticket-servicio-${servicio.id}.png`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				toast.success('Ticket descargado como imagen');
			}
		} catch (error: any) {
			if (error.name !== 'AbortError') {
				console.error('Error al compartir ticket:', error);
				toast.error('Error al generar o compartir el ticket');
			}
		} finally {
			isSharing = false;
		}
	}

	function getConductorPhoto() {
		if (servicio?.conductor?.foto_signed_url) {
			return servicio.conductor.foto_signed_url;
		}
		return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"%3E%3Crect width="24" height="24" fill="%23e5e7eb"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%239ca3af"/%3E%3C/svg%3E';
	}
</script>

{#if servicio}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background-color: rgba(15, 31, 26, 0.55); backdrop-filter: blur(8px);"
		on:click={handleBackdropClick}
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		transition:fade={{ duration: 220 }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			bind:this={ticketElement}
			class="ticket-modal w-full max-w-5xl overflow-hidden bg-white"
			transition:fly={{ y: 20, duration: 500, easing: quintOut }}
			on:click={(e) => e.stopPropagation()}
			on:keydown={(e) => e.stopPropagation()}
			role="presentation"
		>
			<!-- Header sticky — fondo blanco, borde inferior sutil -->
			<header class="ticket-header">
				<div class="ticket-header-inner">
					<div class="flex items-center gap-3">
						<div class="h-10 w-38">
							<img
								src="/assets/logo_nombre.png"
								alt="Cotransmeq"
								class="ticket-brand-logo"
								width="100"
								height="100"
							/>
						</div>
						<div>
							<span class="ticket-eyebrow">Ticket · {servicio.id.slice(0, 8).toUpperCase()}</span>
						</div>
					</div>

					<div class="ticket-actions">
						<button
							on:click={handleShareTicket}
							disabled={isSharing}
							class="ticket-icon-btn"
							title="Compartir ticket como imagen"
							aria-label="Compartir ticket como imagen"
						>
							{#if isSharing}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
								></div>
							{:else}
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
							{/if}
						</button>
						<button
							on:click={handleClose}
							class="ticket-icon-btn"
							title="Cerrar"
							aria-label="Cerrar"
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
				</div>
			</header>

			<!-- Content -->
			<div class="ticket-body">
				<!-- Eyebrow superior del contenido -->
				<div class="ticket-body-eyebrow">
					<span class="ticket-eyebrow">Detalle del servicio</span>
					<span
						class="ticket-status"
						style="background-color: {getEstadoColor(servicio.estado)}15; color: {getEstadoColor(
							servicio.estado
						)}; border-color: {getEstadoColor(servicio.estado)}40;"
					>
						<span
							class="h-1.5 w-1.5 rounded-full"
							style="background-color: {getEstadoColor(servicio.estado)};"
						></span>
						{getEstadoText(servicio.estado)}
					</span>
				</div>

				<div class="ticket-main">
					<!-- Fila 1: Conductor + Vehículo + Cliente + Planilla (4 cols en desktop) -->
					<div class="ticket-row-grid">
						<!-- Conductor -->
						<div class="ticket-cell">
							<span class="ticket-section-label">Conductor</span>
							<p class="ticket-section-value truncate">
								{servicio.conductor?.nombre || ''} {servicio.conductor?.apellido || ''}
							</p>
							<p class="ticket-section-meta">
								{#if servicio.conductor?.numero_identificacion}
									CC {servicio.conductor.numero_identificacion}
								{/if}
								{#if servicio.conductor?.numero_identificacion && servicio.conductor?.telefono}
									·
								{/if}
								{#if servicio.conductor?.telefono}
									📞 {servicio.conductor.telefono}
								{/if}
							</p>
						</div>

						<!-- Vehículo -->
						{#if servicio.vehiculo}
							<div class="ticket-cell">
								<span class="ticket-section-label">Vehículo</span>
								<p class="ticket-section-value ticket-placa">{servicio.vehiculo.placa}</p>
								<p class="ticket-section-meta">
									{#if servicio.vehiculo.marca}{servicio.vehiculo.marca}{/if}
									{#if servicio.vehiculo.marca && servicio.vehiculo.modelo}
										{servicio.vehiculo.modelo}
									{/if}
								</p>
							</div>
						{/if}

						<!-- Cliente -->
						<div class="ticket-cell">
							<span class="ticket-section-label">Cliente</span>
							<p class="ticket-section-value truncate">{servicio.cliente.nombre}</p>
							{#if servicio.cliente.nit}
								<p class="ticket-section-meta">NIT {servicio.cliente.nit}</p>
							{/if}
						</div>

						<!-- Planilla -->
						{#if servicio.numero_planilla}
							<div class="ticket-cell">
								<span class="ticket-section-label">Planilla</span>
								<p class="ticket-section-value ticket-placa">{servicio.numero_planilla}</p>
							</div>
						{/if}
					</div>

					<!-- Fila 2: Ruta horizontal A → B (compacta, inline) -->
					<div class="ticket-route-inline">
						<div class="ticket-route-step">
							<div class="ticket-pin ticket-pin--a">A</div>
							<div class="min-w-0 flex-1">
								<span class="ticket-route-eyebrow">Origen</span>
								<p class="ticket-route-city">
									{servicio.origen?.nombre_municipio || 'No especificado'}
								</p>
							</div>
						</div>
						<div class="ticket-route-arrow" aria-hidden="true">
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M14 5l7 7m0 0l-7 7m7-7H3"
								/>
							</svg>
						</div>
						<div class="ticket-route-step">
							<div class="ticket-pin ticket-pin--b">B</div>
							<div class="min-w-0 flex-1">
								<span class="ticket-route-eyebrow">Destino</span>
								<p class="ticket-route-city">
									{servicio.destino?.nombre_municipio || 'No especificado'}
								</p>
							</div>
						</div>
					</div>

					<!-- Fila 3: Grid 5 cols — Info del servicio (1-2) + Foto conductor (3-5) -->
					<div class="ticket-grid-5">
						<div class="ticket-info-card-col">
							<span class="ticket-section-label">Información del servicio</span>
							<div class="ticket-info-grid">
								{#if servicio.fecha_solicitud}
									<div class="ticket-info-cell">
										<p class="ticket-info-key">Fecha solicitud</p>
										<p class="ticket-info-val">{formatDateTime(servicio.fecha_solicitud)}</p>
									</div>
								{/if}
								{#if servicio.fecha_realizacion}
									<div class="ticket-info-cell">
										<p class="ticket-info-key">Fecha realización</p>
										<p class="ticket-info-val">{formatDateTime(servicio.fecha_realizacion)}</p>
									</div>
								{/if}
								{#if servicio.proposito_servicio}
									<div class="ticket-info-cell">
										<p class="ticket-info-key">Propósito</p>
										<p class="ticket-info-val capitalize">{servicio.proposito_servicio}</p>
									</div>
								{/if}
								<div class="ticket-info-cell ticket-info-cell--full">
									<p class="ticket-info-key">Observaciones</p>
									<p class="ticket-info-val ticket-info-val--soft">
										{servicio.observaciones || 'Sin observaciones'}
									</p>
								</div>
							</div>
						</div>

						<div class="ticket-photo-card">
							<div class="ticket-photo-frame">
								<img src={getConductorPhoto()} alt="Foto del conductor" />
							</div>
						</div>
					</div>

					<!-- Fila 4: Total (full width compacto) -->
					{#if (servicio as any).valor_total || (servicio as any).recargos_planillas?.[0]?.valor}
						{@const total =
							(servicio as any).valor_total ?? (servicio as any).recargos_planillas?.[0]?.valor}
						<div class="ticket-total-row">
							<div>
								<span class="ticket-section-label">Valor total</span>
								<p class="ticket-total-amount">{formatCurrency(total)}</p>
							</div>
							<span class="ticket-eyebrow">Pago confirmado</span>
						</div>
					{/if}
				</div>

				<!-- Footer -->
				<footer class="ticket-footer">
					<p>
						Generado el {new Date().toLocaleDateString('es-CO', {
							day: 'numeric',
							month: 'long',
							year: 'numeric'
						})} ·
						<span class="ticket-footer-mono">transmeralda.com</span>
					</p>
				</footer>
			</div>
		</div>
	</div>

	<!-- Elemento oculto para captura (sistema landing aplicado, versión simple) -->
	<div bind:this={captureElement} class="ticket-capture" style="display: none;">
		<div class="ticket-capture-inner">
			<!-- Header con logo 132.webp -->
			<div class="ticket-capture-header">
				<div class="ticket-capture-brand">
					<div>
						<div class="ticket-capture-eyebrow">Ticket · {servicio.id.slice(0, 8).toUpperCase()}</div>
						<div class="ticket-capture-title">Cotransmeq</div>
					</div>
				</div>
			</div>

			<!-- Body -->
			<div class="ticket-capture-body">
				<!-- Conductor: nombre, identificación, teléfono -->
				<div class="ticket-capture-card">
					<div class="ticket-capture-card-label">Conductor</div>
					<div class="ticket-capture-name">
						{servicio.conductor?.nombre || ''} {servicio.conductor?.apellido || ''}
					</div>
					{#if servicio.conductor?.numero_identificacion}
						<div class="ticket-capture-meta">CC {servicio.conductor.numero_identificacion}</div>
					{/if}
					{#if servicio.conductor?.telefono}
						<div class="ticket-capture-meta">📞 {servicio.conductor.telefono}</div>
					{/if}
				</div>

				<!-- Vehículo: placa, modelo, year -->
				{#if servicio.vehiculo}
					<div class="ticket-capture-card">
						<div class="ticket-capture-card-label">Vehículo</div>
						<div class="ticket-capture-placa">{servicio.vehiculo.placa}</div>
						<div class="ticket-capture-meta">
							{servicio.vehiculo.linea || servicio.vehiculo.marca || ''} · {servicio.vehiculo.modelo || '—'}
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="ticket-capture-footer">
				<span>
					Generado el {new Date().toLocaleDateString('es-CO', {
						day: 'numeric',
						month: 'long',
						year: 'numeric'
					})}
				</span>
				<span class="ticket-capture-footer-mono">transmeralda.com</span>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ─── Tipografía editorial (Fraunces + Inter Tight + JetBrains Mono) ─── */
	.ticket-modal {
		font-family:
			'Inter Tight',
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		border-radius: 24px;
		box-shadow: 0 20px 60px rgba(15, 31, 26, 0.25);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}

	/* ─── Header sticky (white sólido, borde inferior sutil) ─── */
	.ticket-header {
		background: #ffffff;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		position: sticky;
		top: 0;
		z-index: 2;
		flex-shrink: 0;
	}
	.ticket-header-inner {
		padding: 1rem 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.ticket-brand-logo {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.ticket-eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.25rem 0.6rem;
		border-radius: 5px;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
	}

	.ticket-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.ticket-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: #faf7f2;
		color: #4a4a4a;
		border: 1px solid rgba(0, 0, 0, 0.08);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.ticket-icon-btn:hover:not(:disabled) {
		background: white;
		border-color: rgba(249, 115, 22, 0.3);
		color: #ea580c;
		transform: translateY(-1px);
	}
	.ticket-icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ─── Body ─── */
	.ticket-body {
		background: #faf7f2;
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.ticket-body-eyebrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.ticket-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: 'JetBrains Mono', monospace;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid;
	}

	/* ─── Main column ─── */
	.ticket-main {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	/* ─── Fila 1: Conductor + Vehículo + Cliente + Planilla (4 cols) ─── */
	.ticket-row-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.75rem 1rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	@media (min-width: 640px) {
		.ticket-row-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (min-width: 1024px) {
		.ticket-row-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.ticket-cell {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		padding: 0.25rem 0;
	}
	@media (min-width: 640px) {
		.ticket-cell:not(:last-child) {
			border-right: 1px solid rgba(0, 0, 0, 0.06);
			padding-right: 0.85rem;
		}
		.ticket-cell:not(:first-child) {
			padding-left: 0.85rem;
		}
	}

	.ticket-section-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
	}

	.ticket-section-value {
		font-size: 0.88rem;
		font-weight: 600;
		color: #0f1f1a;
		line-height: 1.3;
	}

	.ticket-section-meta {
		font-size: 0.74rem;
		color: #6b6b6b;
		line-height: 1.3;
	}

	.ticket-placa {
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: 0.08em;
	}

	/* ─── Fila 2: Ruta horizontal A → B (inline compacta) ─── */
	.ticket-route-inline {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.7rem 1rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.ticket-route-step {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1;
		min-width: 0;
	}
	.ticket-route-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: #f97316;
		opacity: 0.7;
	}
	.ticket-route-eyebrow {
		display: block;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin-bottom: 0.1rem;
	}
	.ticket-route-city {
		font-size: 0.88rem;
		font-weight: 600;
		color: #0f1f1a;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ticket-pin {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		font-family: 'JetBrains Mono', monospace;
	}
	.ticket-pin--a {
		background: #ea580c;
	}
	.ticket-pin--b {
		background: #dc2626;
	}

	/* ─── Fila 3: Grid 5 cols — Info del servicio (1-2) + Foto conductor (3-5) ─── */
	.ticket-grid-5 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.6rem;
	}
	@media (min-width: 768px) {
		.ticket-grid-5 {
			grid-template-columns: repeat(5, 1fr);
		}
	}

	.ticket-info-card-col {
		grid-column: 1 / -1;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.85rem 1rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	@media (min-width: 768px) {
		.ticket-info-card-col {
			grid-column: 1 / 5;
		}
	}

	.ticket-info-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem 1rem;
		margin-top: 0.5rem;
	}
	@media (max-width: 480px) {
		.ticket-info-grid {
			grid-template-columns: 1fr;
		}
	}
	.ticket-info-cell--full {
		grid-column: 1 / -1;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
	}

	.ticket-info-key {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin: 0 0 0.15rem;
	}
	.ticket-info-val {
		font-size: 0.85rem;
		font-weight: 500;
		color: #0f1f1a;
		margin: 0;
	}
	.ticket-info-val--soft {
		font-weight: 400;
		color: #4a4a4a;
	}

	/* ─── Foto del conductor (cols 3-5) ─── */
	.ticket-photo-card {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.85rem 1rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	@media (min-width: 768px) {
		.ticket-photo-card {
			grid-column: 5 / 6;
		}
	}

	.ticket-photo-frame {
		position: relative;
		width: 100%;
		flex: 1;
		min-height: 140px;
		border-radius: 12px;
		overflow: hidden;
		background: linear-gradient(135deg, #f0ede6, #e8e2d4);
	}
	.ticket-photo-frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.ticket-photo-footer {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.ticket-photo-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: #0f1f1a;
		margin: 0.15rem 0 0;
		line-height: 1.2;
	}
	.ticket-photo-meta {
		font-size: 0.74rem;
		color: #6b6b6b;
		margin: 0;
		line-height: 1.3;
	}

	/* ─── Fila 4: Total full width compacto ─── */
	.ticket-total-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.10));
		border: 1px solid rgba(249, 115, 22, 0.20);
		border-radius: 16px;
		padding: 0.7rem 1rem;
	}
	.ticket-total-amount {
		font-family: 'Fraunces', Georgia, serif;
		font-weight: 500;
		font-size: 1.35rem;
		color: #065f46;
		margin: 0.15rem 0 0;
		line-height: 1.1;
	}

	/* ─── Footer ─── */
	.ticket-footer {
		margin-top: 0.75rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		text-align: center;
		font-size: 0.72rem;
		color: #9a9a9a;
	}
	.ticket-footer-mono {
		font-family: 'JetBrains Mono', monospace;
		color: #f97316;
	}

	/* ─── Estilos del elemento de captura (sistema landing aplicado) ─── */
	/* html2canvas lee estilos del mismo documento; usamos clases para
	   mantener el markup limpio y la cascada predecible. */
	.ticket-capture {
		position: fixed;
		top: -9999px;
		left: -9999px;
		width: 480px;
		background: #faf7f2;
		font-family: 'Inter Tight', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
		color: #0f1f1a;
	}

	.ticket-capture-inner {
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 20px;
		overflow: hidden;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}

	/* Header emerald */
	.ticket-capture-header {
		background: linear-gradient(135deg, #f97316, #ea580c);
		padding: 1.1rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.ticket-capture-brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.ticket-capture-logo {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.95);
		object-fit: contain;
		padding: 3px;
		flex-shrink: 0;
	}

	.ticket-capture-eyebrow {
		display: inline-block;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(255, 255, 255, 0.85);
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
	}

	.ticket-capture-title {
		font-family: 'Fraunces', Georgia, serif;
		font-weight: 500;
		font-size: 1.05rem;
		color: #ffffff;
		line-height: 1.2;
	}

	/* Body */
	.ticket-capture-body {
		padding: 1.1rem 1.25rem;
		background: #faf7f2;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.ticket-capture-card {
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		padding: 0.85rem 1rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}

	.ticket-capture-card-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin-bottom: 0.4rem;
	}

	.ticket-capture-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: #0f1f1a;
		line-height: 1.2;
	}

	.ticket-capture-meta {
		font-size: 0.72rem;
		color: #6b6b6b;
		margin-top: 0.1rem;
	}

	.ticket-capture-placa {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-size: 0.95rem;
		color: #0f1f1a;
		letter-spacing: 0.08em;
	}

	/* Ruta horizontal: A → B en fila */
	.ticket-capture-route-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ticket-capture-route-step {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		flex: 1;
		min-width: 0;
	}
	.ticket-capture-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: #f97316;
		opacity: 0.75;
		padding-top: 0.5rem;
	}
	.ticket-capture-route-eyebrow {
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
	}
	.ticket-capture-route-city {
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f1f1a;
		margin-top: 0.1rem;
		word-break: break-word;
	}

	.ticket-capture-pin {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.68rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
		border: 2px solid #ffffff;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		font-family: 'JetBrains Mono', monospace;
	}
	.ticket-capture-pin--a {
		background: #ea580c;
	}
	.ticket-capture-pin--b {
		background: #dc2626;
	}

	/* Footer */
	.ticket-capture-footer {
		background: #ffffff;
		padding: 0.85rem 1.25rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.68rem;
		color: #9a9a9a;
	}
	.ticket-capture-footer-mono {
		font-family: 'JetBrains Mono', monospace;
		color: #f97316;
		font-weight: 700;
	}
</style>
