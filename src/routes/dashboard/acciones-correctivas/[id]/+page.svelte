<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva
	} from '$lib/api/acciones-correctivas';
	import { sidebarStore } from '$lib/stores/sidebar';
	import {
		MATRICES_ACTUALIZAR,
		etiquetaTipoHallazgo,
		etiquetaEstadoSeguimiento,
		calcularProximoSeguimiento,
		accionTieneCierreDefinitivo,
		INTERVALO_SEGUIMIENTO_DIAS
	} from '$lib/acciones-correctivas/constants';
	import VistaDetalleFormularioAccion from '$lib/components/acciones-correctivas/VistaDetalleFormularioAccion.svelte';

	let accion: AccionCorrectivaPreventiva | null = null;
	let isLoading = true;
	let id = '';
	$: collapsed = $sidebarStore;

	onMount(async () => {
		id = $page.params.id ?? '';
		await cargarAccion();
	});

	async function cargarAccion() {
		isLoading = true;
		try {
			accion = await accionesCorrectivasAPI.obtener(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al cargar la acción';
			toast.error(message);
			setTimeout(() => {
				goto('/dashboard/acciones-correctivas');
			}, 2000);
		} finally {
			isLoading = false;
		}
	}

	function formatearFecha(fecha: string | undefined): string {
		if (!fecha) return '—';
		const [year, month, day] = fecha.split('T')[0].split('-');
		const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
		return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function formatearValor(valor: unknown): string {
		if (valor === null || valor === undefined || valor === '') return '—';
		if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
		return String(valor);
	}

	async function descargarPDF() {
		if (!accion) return;
		try {
			toast.loading('Generando PDF...');
			await accionesCorrectivasAPI.descargarPDF(accion.id, accion.accion_numero);
			toast.success('PDF descargado correctamente');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al descargar el PDF';
			toast.error(message);
		}
	}
</script>

<style>
	:global(.fm-detail) {
		--fm-bg: #FFFFFF;
		--fm-surface: #FAFAFA;
		--fm-surface-elevated: #FFFFFF;
		--fm-surface-hover: #F4F4F5;
		--fm-border: #E4E4E7;
		--fm-border-hover: #D4D4D8;
		--fm-text: #18181B;
		--fm-text-secondary: #52525B;
		--fm-muted: #71717A;
		--fm-focus-ring: rgba(0, 0, 0, 0.08);
		--fm-radius: 8px;
		--fm-radius-lg: 10px;
	}

	.page-header {
		position: fixed;
		top: 4rem;
		left: 0;
		right: 0;
		z-index: 20;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-bottom: 1px solid var(--fm-border);
		transition: left 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	@media (min-width: 1024px) {
		.page-header {
			left: 16rem;
		}
	}
	@media (min-width: 1024px) {
		.page-header.page-header-collapsed {
			left: 5rem;
		}
	}

	.page-header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 0.85rem 1.5rem;
	}

	.header-left { display: flex; align-items: center; gap: 0.85rem; }
	.btn-back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--fm-muted);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		background: var(--fm-surface-elevated);
		border: 1px solid var(--fm-border);
	}
	.btn-back:hover {
		background: var(--fm-surface-hover);
		color: #ea580c;
		border-color: rgba(249, 115, 22, 0.3);
	}
	.header-title-group { display: flex; flex-direction: column; gap: 0.15rem; }
	h1 {
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		color: #ea580c;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		align-self: flex-start;
		margin: 0;
		line-height: 1;
	}
	.header-sub {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.2rem;
		font-weight: 500;
		color: var(--fm-text);
		margin: 0.25rem 0 0;
		letter-spacing: -0.015em;
	}
	.header-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		font-family: inherit;
		white-space: nowrap;
	}
	.btn-outline {
		background: var(--fm-surface-elevated);
		color: var(--fm-text);
		border: 1px solid var(--fm-border);
	}
	.btn-outline:hover {
		border-color: rgba(249, 115, 22, 0.3);
		background: rgba(249, 115, 22, 0.04);
		color: #ea580c;
	}

	.page-content {
		padding: 3.5rem 1.5rem 3rem;
	}
	@media (min-width: 1024px) {
		.page-content {
			padding: 3.5rem 2rem 3rem;
		}
	}

	.fm-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 4rem 2rem;
		color: var(--fm-muted);
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--fm-border);
		border-top-color: var(--fm-text);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	:global(.fm-card) {
		border: 1px solid var(--fm-border);
		border-radius: var(--fm-radius-lg);
		background: var(--fm-surface-elevated);
		padding: 20px;
		margin-top: 1rem;
	}
	:global(.fm-card-title) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 600;
		color: var(--fm-text);
		margin-bottom: 16px;
		letter-spacing: -0.01em;
	}
	:global(.section-icon) { color: var(--fm-muted); }
	:global(.fm-card-header-row) {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	:global(.fm-card-subtitle) { font-size: 11.5px; margin-top: 4px; }

	:global(.fm-grid) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	:global(.fm-field) { display: flex; flex-direction: column; gap: 3px; }
	:global(.fm-span-2) { grid-column: span 2; }
	:global(.fm-label) {
		font-size: 11px;
		font-weight: 600;
		color: var(--fm-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	:global(.fm-value) { font-size: 13px; color: var(--fm-text); line-height: 1.5; }
	:global(.fm-block) { white-space: pre-wrap; }
	:global(.fm-mono) { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
	:global(.fm-muted-text) { font-size: 12px; color: var(--fm-muted); }
	:global(.fm-small) { font-size: 10.5px; }
	:global(.fm-detail-text) { font-size: 12px; color: var(--fm-text-secondary); margin-top: 6px; }
	:global(.fm-alert-title) { font-weight: 600; margin-bottom: 2px; }

	:global(.fm-subsection) {
		margin-top: 16px;
		padding: 14px;
		border: 1px solid var(--fm-border);
		border-radius: var(--fm-radius);
		background: var(--fm-surface);
	}
	:global(.fm-subsection-title) {
		font-size: 12px;
		font-weight: 600;
		color: var(--fm-text);
		margin-bottom: 10px;
	}
	:global(.fm-list) { display: flex; flex-direction: column; gap: 6px; }
	:global(.fm-list-item) {
		padding: 10px 12px;
		border: 1px solid var(--fm-border);
		border-radius: var(--fm-radius);
		background: var(--fm-surface-elevated);
	}
	:global(.fm-list-item-header) {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	:global(.fm-list-item-num) { font-size: 10px; font-weight: 700; color: var(--fm-muted); }
	:global(.fm-list-item-text) { font-size: 12px; color: var(--fm-text-secondary); margin-top: 4px; white-space: pre-wrap; }
	:global(.fm-list-item-label) {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--fm-text);
		margin-bottom: 8px;
	}
	:global(.fm-status-tag) {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--fm-surface);
		color: var(--fm-text-secondary);
		border: 1px solid var(--fm-border);
	}

	:global(.fm-alert) {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		border-radius: var(--fm-radius);
		font-size: 12.5px;
		background: var(--fm-surface);
		border: 1px solid var(--fm-border);
		color: var(--fm-text-secondary);
	}
	:global(.fm-alert svg) { flex-shrink: 0; }

	:global(.fm-bullet-list) {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	:global(.fm-bullet-list li::before) {
		content: '·';
		margin-right: 6px;
		font-weight: 700;
		color: var(--fm-muted);
	}

	.badges-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 1rem; }
	.badge {
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--fm-border);
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--fm-surface);
		color: var(--fm-text-secondary);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.matrices-list { display: flex; flex-wrap: wrap; gap: 4px; }
	.matrix-tag {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--fm-surface);
		color: var(--fm-muted);
		border: 1px solid var(--fm-border);
	}
	.matrix-tag-active {
		background: var(--fm-surface-elevated);
		color: var(--fm-text);
		border-color: var(--fm-border-hover);
	}

	.causas-list { display: flex; flex-direction: column; gap: 14px; }
	.causa-card {
		border: 1px solid var(--fm-border);
		border-radius: var(--fm-radius-lg);
		background: var(--fm-surface-elevated);
		padding: 18px;
	}
	.causa-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	.causa-header-left { display: flex; align-items: flex-start; gap: 10px; }
	.causa-num {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1px solid var(--fm-border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 700;
		color: var(--fm-text);
		background: var(--fm-surface);
		flex-shrink: 0;
	}
	.causa-title { font-size: 13px; font-weight: 700; color: var(--fm-text); }
	.causa-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }

	.causa-block {
		padding: 12px 14px;
		border-radius: var(--fm-radius);
		border: 1px solid var(--fm-border);
		background: var(--fm-surface);
		margin-bottom: 10px;
	}
	.causa-block:last-child { margin-bottom: 0; }
	.causa-block-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--fm-text);
		margin-bottom: 6px;
	}
	.causa-block-content {
		font-size: 12.5px;
		color: var(--fm-text-secondary);
		line-height: 1.55;
		white-space: pre-wrap;
	}
	.causa-plan-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }

	.detail-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--fm-border);
	}

	.btn-footer-back {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 1rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--fm-text);
		background: var(--fm-surface-elevated);
		border: 1px solid var(--fm-border);
		border-radius: 10px;
		text-decoration: none;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.btn-footer-back:hover {
		background: rgba(249, 115, 22, 0.04);
		border-color: rgba(249, 115, 22, 0.3);
		color: #ea580c;
	}
	.btn-footer-back svg { transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
	.btn-footer-back:hover svg { transform: translateX(-3px); }

	:global(.adjunto-link) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #0369a1;
		text-decoration: underline;
		word-break: break-all;
	}
	:global(.adjunto-link:hover) { color: #0c4a6e; }
	:global(.adjunto-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 14px;
		border-radius: 3px;
		background: #fee2e2;
		border: 1px solid #f87171;
		font-size: 8px;
		font-weight: 700;
		color: #dc2626;
		flex-shrink: 0;
	}
	:global(.adjunto-fallback) {
		font-size: 11px;
		font-style: italic;
		color: var(--fm-muted);
	}

	@media (max-width: 640px) {
		.fm-span-2 { grid-column: span 1; }
		.page-header { flex-direction: column; align-items: flex-start; }
		.header-actions { width: 100%; justify-content: flex-start; }
		.causa-header { flex-direction: column; }
		.causa-plan-meta { grid-template-columns: 1fr; }
		.page-content { padding: 7rem 1rem 2rem; }
	}
</style>

{#if isLoading}
	<div class="fm-detail fm-loading">
		<div class="spinner"></div>
		<p>Cargando acción...</p>
	</div>
{:else if accion}
	<!-- Fixed page header -->
	<header class="page-header {collapsed ? 'page-header-collapsed' : ''}" in:fade={{ duration: 400 }}>
		<div class="page-header-inner">
			<div class="header-left">
				<button on:click={() => goto('/dashboard/acciones-correctivas')} class="btn-back" aria-label="Volver al listado" title="Volver al listado">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
				</button>
				<div class="header-title-group">
					<h1>Acción Correctiva</h1>
					<p class="header-sub">{accion.accion_numero}</p>
				</div>
			</div>
			<div class="header-actions">
				<a href="/dashboard/acciones-correctivas/editar/{accion.id}" class="btn btn-outline">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
					Editar
				</a>
				<button on:click={descargarPDF} class="btn btn-outline">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
					PDF
				</button>
			</div>
		</div>
	</header>

	<!-- Page content -->
	<div class="page-content fm-detail">
		{#if !accionTieneCierreDefinitivo(accion) && calcularProximoSeguimiento(accion)}
			<div class="fm-alert" in:fade>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
				<span><strong>Próximo seguimiento:</strong> {formatearFecha(calcularProximoSeguimiento(accion) ?? undefined)} (cada {INTERVALO_SEGUIMIENTO_DIAS} días).</span>
			</div>
		{/if}

		<!-- Badges -->
		<div class="badges-row" in:fly={{ y: 20, delay: 100 }}>
			<span class="badge">{accion.tipo_accion_ejecutar || '—'}</span>
			{#if accion.causas && accion.causas.length > 0}
				<span class="badge">{accion.causas.length} {accion.causas.length === 1 ? 'Causa' : 'Causas'}</span>
			{/if}
			<span class="badge">Riesgo: {accion.valoracion_riesgo || '—'}</span>
		</div>

		<!-- Sección 1: Identificación del Hallazgo -->
		<section class="fm-card" in:fly={{ y: 20, delay: 200 }}>
			<h2 class="fm-card-title">
				<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
				Identificación del Hallazgo
			</h2>
			<div class="fm-grid">
				<div class="fm-field">
					<span class="fm-label">Fecha de registro</span>
					<span class="fm-value">{formatearFecha(accion.created_at)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Acción No.</span>
					<span class="fm-value fm-mono">{formatearValor(accion.accion_numero)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Tipo de hallazgo</span>
					<span class="fm-value">{etiquetaTipoHallazgo(accion.tipo_hallazgo_detectado)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Proceso donde se origina</span>
					<span class="fm-value">{formatearValor(accion.proceso_origen_hallazgo)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Lugar / Sede</span>
					<span class="fm-value">{formatearValor(accion.lugar_sede)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Fuente que generó el hallazgo</span>
					<span class="fm-value">{formatearValor(accion.fuente_genero_hallazgo)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Fecha de identificación</span>
					<span class="fm-value">{formatearFecha(accion.fecha_identificacion_hallazgo)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Componente / Elemento / Requisito de referencia</span>
					<span class="fm-value">{formatearValor(accion.componente_elemento_referencia)}</span>
				</div>
				<div class="fm-field fm-span-2">
					<span class="fm-label">Marco legal / Normativo / Contractual</span>
					<span class="fm-value">{formatearValor(accion.marco_legal_normativo)}</span>
				</div>
				<div class="fm-field fm-span-2">
					<span class="fm-label">Variable / categoría para análisis de tendencias</span>
					<span class="fm-value">{formatearValor(accion.variable_categoria_analisis)}</span>
				</div>
				<div class="fm-field fm-span-2">
					<span class="fm-label">Descripción del hallazgo</span>
					<span class="fm-value fm-block">{formatearValor(accion.descripcion_hallazgo)}</span>
				</div>
				<div class="fm-field fm-span-2">
					<span class="fm-label">Matrices a actualizar</span>
					<div class="matrices-list">
						{#each MATRICES_ACTUALIZAR as matriz}
							{@const matricesSel = accion.matriz_a_actualizar?.split(',') || []}
							<span class="matrix-tag {matricesSel.some((m) => m === matriz.key || (matriz.key === 'Otros' && m.startsWith('Otros'))) ? 'matrix-tag-active' : ''}">
								{matriz.label}
							</span>
						{/each}
					</div>
					{#if accion.matriz_a_actualizar}
						<p class="fm-detail-text">{accion.matriz_a_actualizar}</p>
					{:else if !accion.requiere_actualizar_matriz}
						<p class="fm-muted-text">No requiere actualización de matrices</p>
					{/if}
				</div>
				<div class="fm-field">
					<span class="fm-label">Tipo de acción</span>
					<span class="fm-value">{formatearValor(accion.tipo_accion_ejecutar)}</span>
				</div>
			</div>
		</section>

		<!-- Sección 2: Corrección Inmediata -->
		<section class="fm-card" in:fly={{ y: 20, delay: 300 }}>
			<h2 class="fm-card-title">
				<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
				Corrección Inmediata
			</h2>
			<div class="fm-grid">
				<div class="fm-field fm-span-2">
					<span class="fm-label">Corrección o solución inmediata</span>
					<span class="fm-value fm-block">{formatearValor(accion.correccion_solucion_inmediata)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Fecha de implementación</span>
					<span class="fm-value">{formatearFecha(accion.fecha_implementacion)}</span>
				</div>
				<div class="fm-field">
					<span class="fm-label">Valoración del riesgo</span>
					<span class="fm-value">{formatearValor(accion.valoracion_riesgo)}</span>
				</div>
			</div>

			{#if accion.seguimientos_correccion && accion.seguimientos_correccion.length > 0}
				<div class="fm-subsection">
					<h3 class="fm-subsection-title">Seguimiento a la corrección inmediata</h3>
					<div class="fm-list">
						{#each accion.seguimientos_correccion as reg, i}
							<div class="fm-list-item">
								<div class="fm-list-item-header">
									<span class="fm-list-item-num">#{i + 1}</span>
									<span class="fm-muted-text">{formatearFecha(reg.fecha_seguimiento)}</span>
									<span class="fm-status-tag">{etiquetaEstadoSeguimiento(reg.estado_accion)}</span>
								</div>
								{#if reg.descripcion_observaciones}
									<p class="fm-list-item-text">{reg.descripcion_observaciones}</p>
								{/if}
								{#if reg.adjunto_url}
									<a href={reg.adjunto_url} target="_blank" rel="noopener noreferrer" class="adjunto-link">
										<span class="adjunto-icon">PDF</span>
										{reg.adjunto_url.split('?')[0].split('/').pop()}
									</a>
								{:else}
									<span class="adjunto-fallback">Sin adjunto</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- Sección 3: Análisis de Causa y Plan de Acción -->
		<section class="fm-card" in:fly={{ y: 20, delay: 400 }}>
			<div class="fm-card-header-row">
				<div>
					<h2 class="fm-card-title">
						<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
						Análisis de Causa y Plan de Acción
					</h2>
					<p class="fm-muted-text fm-card-subtitle">Tipo de acción: <strong>{formatearValor(accion.tipo_accion_ejecutar)}</strong></p>
				</div>
			</div>

			{#if accion.causas && accion.causas.length > 0}
				<div class="causas-list">
					{#each accion.causas as causa, index (causa.id || causa.orden)}
						{@const seguimientosFormulario = causa.seguimientos?.length ? causa.seguimientos : []}
						<div class="causa-card" in:fly={{ y: 20, delay: 500 + index * 100 }}>
							<div class="causa-header">
								<div class="causa-header-left">
									<span class="causa-num">{causa.orden}°</span>
									<div>
										<h3 class="causa-title">{causa.orden}° Por qué</h3>
										<div class="causa-badges">
											{#if causa.estado_seguimiento}
												<span class="badge">{causa.estado_seguimiento}</span>
											{/if}
											{#if causa.es_causa_raiz}
												<span class="badge">Causa raíz</span>
											{/if}
										</div>
									</div>
								</div>
								{#if causa.evaluacion_cierre_eficaz}
									<span class="badge">{causa.evaluacion_cierre_eficaz}</span>
								{/if}
							</div>

							<div class="causa-block">
								<p class="causa-block-label">Análisis de la Causa</p>
								<p class="causa-block-content">{causa.analisis_causa}</p>
							</div>

							{#if causa.descripcion_plan_accion}
								<div class="causa-block">
									<p class="causa-block-label">Plan de Acción</p>
									<p class="causa-block-content">{causa.descripcion_plan_accion}</p>
									<div class="causa-plan-meta">
										{#if causa.responsable_ejecucion}
											<div>
												<span class="fm-label">Responsable</span>
												<span class="fm-value">{causa.responsable_ejecucion}</span>
											</div>
										{/if}
										{#if causa.fecha_limite_implementacion}
											<div>
												<span class="fm-label">Fecha Límite</span>
												<span class="fm-value">{formatearFecha(causa.fecha_limite_implementacion)}</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}

							{#if seguimientosFormulario.length > 0}
								<div class="causa-block">
									<p class="causa-block-label">Registros de seguimiento</p>
									<div class="fm-list">
										{#each seguimientosFormulario as seg, idx}
											<div class="fm-list-item">
												<div class="fm-list-item-header">
													<span class="fm-list-item-num">#{idx + 1}</span>
													<span class="fm-muted-text">{formatearFecha(seg.fecha_seguimiento)}</span>
													<span class="fm-status-tag">{etiquetaEstadoSeguimiento(seg.estado_accion)}</span>
												</div>
												{#if seg.descripcion_observaciones}
													<p class="fm-list-item-text">{seg.descripcion_observaciones}</p>
												{/if}
												{#if seg.adjunto_url}
													<a href={seg.adjunto_url} target="_blank" rel="noopener noreferrer" class="adjunto-link">
														<span class="adjunto-icon">PDF</span>
														{seg.adjunto_url.split('?')[0].split('/').pop()}
													</a>
												{:else}
													<span class="adjunto-fallback">Sin adjunto</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							{#if causa.fecha_seguimiento || causa.descripcion_observaciones}
								<div class="causa-block">
									<p class="causa-block-label">Seguimiento de Implementación</p>
									{#if causa.fecha_seguimiento}
										<div class="fm-field">
											<span class="fm-label">Fecha del Seguimiento</span>
											<span class="fm-value">{formatearFecha(causa.fecha_seguimiento)}</span>
										</div>
									{/if}
									{#if causa.descripcion_observaciones}
										<div>
											<span class="fm-label">Observaciones</span>
											<span class="fm-value fm-block">{causa.descripcion_observaciones}</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if causa.fecha_evaluacion_eficacia || causa.criterio_evaluacion_eficacia || causa.analisis_evidencias_cierre || causa.evaluacion_cierre_eficaz}
								<div class="causa-block">
									<p class="causa-block-label">Evaluación de Eficacia y Cierre</p>
									<div class="fm-grid">
										{#if causa.fecha_evaluacion_eficacia}
											<div class="fm-field">
												<span class="fm-label">Fecha de Evaluación</span>
												<span class="fm-value">{formatearFecha(causa.fecha_evaluacion_eficacia)}</span>
											</div>
										{/if}
										{#if causa.criterio_evaluacion_eficacia}
											<div class="fm-field fm-span-2">
												<span class="fm-label">Criterio de Evaluación</span>
												<span class="fm-value fm-block">{causa.criterio_evaluacion_eficacia}</span>
											</div>
										{/if}
										{#if causa.analisis_evidencias_cierre}
											<div class="fm-field fm-span-2">
												<span class="fm-label">Análisis y Evidencias</span>
												<span class="fm-value fm-block">{causa.analisis_evidencias_cierre}</span>
											</div>
										{/if}
										{#if causa.soporte_cierre_eficaz}
											<div class="fm-field fm-span-2">
												<span class="fm-label">Soporte del Cierre</span>
												<span class="fm-value fm-block">{causa.soporte_cierre_eficaz}</span>
											</div>
										{/if}
										{#if causa.fecha_cierre}
											<div class="fm-field">
												<span class="fm-label">Fecha de Cierre</span>
												<span class="fm-value">{formatearFecha(causa.fecha_cierre)}</span>
											</div>
										{/if}
										{#if causa.responsable_cierre}
											<div class="fm-field">
												<span class="fm-label">Responsable del Cierre</span>
												<span class="fm-value">{causa.responsable_cierre}</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<VistaDetalleFormularioAccion {accion} {formatearFecha} {formatearValor} />

		<!-- Footer -->
		<footer class="detail-footer" in:fly={{ y: 20, delay: 700 }}>
			<a href="/dashboard/acciones-correctivas" class="btn-footer-back">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
				Volver al listado
			</a>
			<span class="fm-muted-text fm-small">ID: <span class="fm-mono">{accion.id}</span></span>
		</footer>
	</div>
{/if}
