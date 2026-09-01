<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PreviewDataMensual } from '$lib/api/liquidaciones-terceros-mensual';

	export let data: PreviewDataMensual;

	const BACK_URL = '/dashboard/liquidaciones-terceros?tab=mensual';

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

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);

	const fmtPlaca = (p: string) => {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	};

	let pdfZoom = 0.7;
	let logoError = false;
	let viewportWidth = 0;
	let pageScaledHeight = 800;
	let pageEl: HTMLElement | null = null;
	let pdfLoading = false;
	let pageObserver: ResizeObserver | null = null;

	const EXTENDED_WIDTH_PX = 1900;

	function measurePage() {
		if (!pageEl) return;
		pageScaledHeight = pageEl.scrollHeight * pdfZoom;
	}

	function updateViewport() {
		if (typeof window === 'undefined') return;
		viewportWidth = window.innerWidth;
	}

	function fitToViewport() {
		if (typeof window === 'undefined' || viewportWidth <= 0) return;
		const padding = 60;
		const available = Math.max(280, viewportWidth - padding);
		const target = available * 0.96;
		pdfZoom = Math.max(0.3, Math.min(2.5, target / EXTENDED_WIDTH_PX));
	}

	$: if (pdfZoom != null && typeof window !== 'undefined') {
		requestAnimationFrame(measurePage);
	}

	function pageObserve(node: HTMLElement) {
		pageEl = node;
		pageObserver = new ResizeObserver(() => measurePage());
		pageObserver.observe(node);
		setTimeout(measurePage, 30);
		return {
			destroy() {
				if (pageObserver) {
					pageObserver.disconnect();
					pageObserver = null;
				}
			}
		};
	}

	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const delta = e.deltaY < 0 ? 0.05 : -0.05;
		pdfZoom = Math.max(0.3, Math.min(2.5, pdfZoom + delta));
	}

	$: adicionales = data?.adicionales || [];
	$: conceptos = data?.conceptos || [];
	$: cabecera = data?.cabecera;
	$: totales = data?.totales;
	$: porPlaca = data?.por_placa || [];

	onMount(() => {
		updateViewport();
		window.addEventListener('resize', updateViewport);
		window.addEventListener('wheel', handleWheel, { passive: false });
		setTimeout(() => {
			fitToViewport();
			setTimeout(measurePage, 60);
		}, 50);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', updateViewport);
			window.removeEventListener('wheel', handleWheel);
		}
		if (pageObserver) {
			pageObserver.disconnect();
			pageObserver = null;
		}
	});
</script>

<div class="pdf-wrap">
	<!-- TOOLBAR -->
	<div class="pdf-bar no-print">
		<div class="pdf-bar-l">
			<img
				src="/assets/logo_nombre.webp"
				alt=""
				class="pb-logo"
				onerror={(e: any) => {
					e.currentTarget.style.display = 'none';
				}}
			/>
			<div class="pdf-bar-text">
				<div class="pb-t font-display" style="font-family:'Fraunces',Georgia,serif;font-weight:500">
					Liquidación Mensual de Adicionales · Terceros
				</div>
				<div class="pb-s">
					<span class="code-badge" style="margin-right:6px;vertical-align:1px">GAF-FR-12</span>
					{cabecera?.consecutivo || '—'}
					&nbsp;·&nbsp;
					{cabecera?.mes ? MESES[cabecera.mes - 1] : ''} {cabecera?.anio || ''}
				</div>
			</div>
		</div>
		<div class="pdf-bar-actions">
			<div class="zoom-controls">
				<button class="zoom-btn" onclick={() => (pdfZoom = Math.max(0.3, pdfZoom - 0.05))} title="Reducir zoom">−</button>
				<span class="zoom-label">{Math.round(pdfZoom * 100)}%</span>
				<button class="zoom-btn" onclick={() => (pdfZoom = Math.min(2.5, pdfZoom + 0.05))} title="Aumentar zoom">+</button>
				<button class="zoom-btn zoom-reset" onclick={() => (pdfZoom = 1)} title="Restablecer">↺</button>
				<button class="zoom-btn zoom-fit" onclick={fitToViewport} title="Ajustar">⤢</button>
			</div>
			<button class="pbtn pbtn-back" onclick={() => goto(BACK_URL)}>
				<svg class="pbtn-icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
				Volver
			</button>
		</div>
	</div>

	<!-- RESUMEN STRIP -->
	<div class="estado-bar no-print">
		<span
			class="status-pill"
			style="background:rgba(16,185,129,0.10);color:#047857;border:1px solid rgba(16,185,129,0.28);font-size:11px;padding:3px 10px"
		>
			{cabecera?.estado || '—'}
		</span>
		<div class="estado-info-stack">
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</span>
				<span class="estado-info-full">
					<span class="filter-field-label" style="font-size:0.6rem">Período</span>
					<strong>{cabecera?.mes ? MESES[cabecera.mes - 1] : ''} {cabecera?.anio || ''}</strong>
				</span>
			</span>
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
					</svg>
				</span>
				<span class="estado-info-full">
					<span class="filter-field-label" style="font-size:0.6rem">Adicionales</span>
					<strong>{adicionales.length}</strong>
				</span>
			</span>
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
					</svg>
				</span>
				<span class="estado-info-full">
					<span class="filter-field-label" style="font-size:0.6rem">Total Pagar</span>
					<strong class="font-mono" style="color:#065f46;font-weight:700;letter-spacing:0.02em">{COP(totales?.total_pagar || 0)}</strong>
				</span>
			</span>
		</div>
	</div>

	<!-- PAGE -->
	<div class="pdf-body print-sheet">
		<div
			class="page-scale-wrap"
			style="width: {EXTENDED_WIDTH_PX * pdfZoom}px; height: {pageScaledHeight}px;"
		>
			<div
				class="page"
				bind:this={pageEl}
				use:pageObserve
				style="transform: scale({pdfZoom}); transform-origin: top left;"
			>
				<!-- HEADER -->
				<div class="dh">
					<div class="dh-logo">
						{#if logoError}
							<div class="dh-logo-fallback">TRANS<br />MERALDA</div>
						{:else}
							<img
								src="/assets/logo_nombre.webp"
								alt="Logo"
								onerror={() => (logoError = true)}
								style="height:58px;width:auto;object-fit:contain"
							/>
						{/if}
					</div>
					<div class="dh-title">
						<div class="dh-co">SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S</div>
						<div class="dh-doc">CONSOLIDADO MENSUAL DE ADICIONALES PARA TERCEROS</div>
					</div>
					<div class="dh-meta">
						<table class="mt">
							<tbody>
								<tr><td class="ml">Codigo:</td><td class="mv">GAF-FR-12</td></tr>
								<tr><td class="ml">Versión:</td><td class="mv">1</td></tr>
								<tr><td class="ml">Fecha:</td><td class="mv">29/07/2026</td></tr>
							</tbody>
						</table>
					</div>
				</div>

				<!-- PERIODO -->
				<div class="pb">
					<div class="pc">
						<span class="pclabel">MES:</span>
						<span class="pcval">{cabecera?.mes ? MESES[cabecera.mes - 1] : ''}</span>
					</div>
					<div class="pc">
						<span class="pclabel">AÑO:</span>
						<span class="pcval">{cabecera?.anio || ''}</span>
					</div>
					<div class="pc">
						<span class="pclabel">CONSECUTIVO:</span>
						<span class="pcval">{cabecera?.consecutivo || ''}</span>
					</div>
					<div class="pc">
						<span class="pclabel">PLACAS:</span>
						<span class="pcval">{porPlaca.length}</span>
					</div>
					<div class="pc pc-tercero">
						<span class="pclabel">ADICIONALES:</span>
						<span class="pcval">{adicionales.length}</span>
					</div>
				</div>

				<!-- ADICIONALES -->
				<table class="terc-prev-tbl">
					<colgroup>
						<col style="width:2%" />
						<col style="width:12%" />
						<col style="width:6%" />
						<col style="width:18%" />
						<col style="width:6%" />
						<col style="width:10%" />
						<col style="width:6%" />
						<col style="width:3%" />
						<col style="width:5%" />
						<col style="width:8%" />
						<col style="width:8%" />
						<col style="width:6%" />
						<col style="width:5%" />
						<col style="width:5%" />
					</colgroup>
					<thead>
						<tr>
							<th>#</th>
							<th>CLIENTE</th>
							<th>PLACA</th>
							<th>TERCERO</th>
							<th>RECORRIDO</th>
							<th>FECHAS</th>
							<th>V/UNIDAD</th>
							<th>CANT</th>
							<th>ADMON%</th>
							<th>ADMON $</th>
							<th>TOTAL</th>
							<th>V/LIQUIDAR</th>
							<th>IMP</th>
							<th>ORIGEN</th>
						</tr>
					</thead>
					<tbody>
						{#each adicionales as adc, idx (adc.id)}
							{@const vLiqGross = (adc.valor_unitario || 0) * (adc.cantidad || 1)}
							{@const pctAdc = Number(adc.porcentaje_admin) || 0}
							{@const vAdmin = Number(adc.valor_admin) || 0}
							<tr>
								<td class="num-cell">{idx + 1}</td>
								<td>{adc.cliente || 'COTRANSMEQ'}</td>
								<td class="tc" style="font-weight:600">{fmtPlaca(adc.placa || '')}</td>
								<td>{adc.tercero_nombre || '—'}</td>
								<td>{adc.recorrido || '—'}</td>
								<td class="tc">{adc.fechas || ''}</td>
								<td class="mc">{COP(adc.valor_unitario || 0)}</td>
								<td class="num-cell">{adc.cantidad || 1}</td>
								<td class="num-cell">{pctAdc ? pctAdc.toFixed(2) + '%' : '0%'}</td>
								<td class="mc" style="color:#b91c1c">{COP(vAdmin)}</td>
								<td class="mc" style="font-weight:700">{COP(vLiqGross)}</td>
								<td class="mc" style="font-weight:800;color:#0f4025">{COP(adc.valor_liquidar || 0)}</td>
								<td class="num-cell">{adc.aplica_impuestos !== false ? 'Sí' : 'No'}</td>
								<td class="tc" style="font-size:9px">{adc.cierre_final_origen_id ? 'Cierre' : 'Manual'}</td>
							</tr>
						{:else}
							<tr>
								<td colspan="14" class="empty-desc">Sin adicionales.</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr style="font-weight:800;background:#e2e8f0">
							<td colspan="11" style="text-align:right;padding-right:6px">TOTALES</td>
							<td class="mc" style="color:#0f4025">{COP(totales?.total_adicionales || 0)}</td>
							<td colspan="2"></td>
						</tr>
					</tfoot>
				</table>

				<!-- RESUMEN POR PLACA -->
				<div class="desc-section-title">RESUMEN POR PLACA</div>
				<table class="terc-prev-tbl" style="margin-top:6px">
					<colgroup>
						<col style="width:3%" />
						<col style="width:15%" />
						<col style="width:50%" />
						<col style="width:10%" />
						<col style="width:22%" />
					</colgroup>
					<thead>
						<tr>
							<th>#</th>
							<th>PLACA</th>
							<th>TERCERO</th>
							<th class="num-cell">ADICIONALES</th>
							<th>V/LIQUIDAR</th>
						</tr>
					</thead>
					<tbody>
						{#each porPlaca as p, idx (p.placa)}
							<tr>
								<td class="num-cell">{idx + 1}</td>
								<td style="font-weight:600">{fmtPlaca(p.placa)}</td>
								<td>{p.tercero_nombre || '—'}</td>
								<td class="num-cell">{p.adicionales_count}</td>
								<td class="mc" style="font-weight:700;color:#0f4025">{COP(p.valor_liquidar)}</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="empty-desc">Sin datos por placa.</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<!-- CONCEPTOS -->
				{#if conceptos.length > 0}
					<div class="desc-section-title" style="margin-top:14px">CONCEPTOS APLICADOS</div>
					<table class="terc-prev-tbl" style="margin-top:6px">
						<colgroup>
							<col style="width:2%" />
							<col style="width:6%" />
							<col style="width:20%" />
							<col style="width:10%" />
							<col style="width:8%" />
							<col style="width:8%" />
							<col style="width:6%" />
							<col style="width:18%" />
							<col style="width:22%" />
						</colgroup>
						<thead>
							<tr>
								<th>#</th>
								<th>TIPO</th>
								<th>CONCEPTO</th>
								<th>PLACA</th>
								<th>DIAS</th>
								<th>V/UNIT</th>
								<th>%</th>
								<th>OBSERVACIONES</th>
								<th>TOTAL</th>
							</tr>
						</thead>
						<tbody>
							{#each conceptos as c, idx (c.id)}
								<tr>
									<td class="num-cell">{idx + 1}</td>
									<td class="tc">{c.tipo.replace(/_/g, ' ')}</td>
									<td>{c.concepto.replace(/_/g, ' ')}</td>
									<td class="tc" style="font-weight:600">{c.placa_aplicada ? fmtPlaca(c.placa_aplicada) : 'TODAS'}</td>
									<td class="num-cell">{c.dias || ''}</td>
									<td class="mc">{COP(c.valor_unitario || 0)}</td>
									<td class="num-cell">{c.porcentaje != null ? c.porcentaje + '%' : ''}</td>
									<td>{c.observaciones || ''}</td>
									<td class="mc" style="font-weight:700">{COP(c.valor_total || 0)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}

				<!-- RESUMEN -->
				<div class="desc-resumen">
					<div class="resumen-line">
						<span>TOTAL ADICIONALES:</span>
						<span class="resumen-val">{COP(totales?.total_adicionales || 0)}</span>
					</div>
				</div>
				<div class="desc-resumen">
					<div class="resumen-line">
						<span>TOTAL DESCUENTOS:</span>
						<span class="resumen-val resumen-red">- {COP(totales?.total_descuentos || 0)}</span>
					</div>
				</div>
				<div class="desc-resumen">
					<div class="resumen-line resumen-pagar">
						<span>TOTAL A PAGAR:</span>
						<span class="resumen-val">{COP(totales?.total_pagar || 0)}</span>
					</div>
				</div>

				<!-- FIRMAS -->
				<div class="sigs">
					<div class="sig">
						<img data-firma="camilo" class="sig-img" src="/assets/firmas/firma-camilo.png" alt="Firma" />
						<div class="sig-line">
							<div class="sig-lbl">Aprobado por</div>
							{cabecera?.actualizado_por?.nombre || '—'}
						</div>
					</div>
					<div class="sig">
						<div class="sig-line">
							<div class="sig-lbl">Elaborado por</div>
							{cabecera?.creado_por?.nombre || '—'}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	:global(.pdf-wrap) {
		position: relative;
		display: flex;
		flex-direction: column;
		background: #faf7f2;
		min-height: 100%;
	}
	:global(.pdf-bar) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 28px;
		background: white;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	:global(.pdf-bar-l) {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	:global(.pb-logo) {
		height: 38px;
		width: auto;
	}
	:global(.pdf-bar-text .pb-t) {
		font-size: 14px;
		color: #0f1f1a;
	}
	:global(.pdf-bar-text .pb-s) {
		font-size: 11px;
		color: #6b6b6b;
		margin-top: 2px;
	}
	:global(.code-badge) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		padding: 2px 6px;
		background: rgba(0, 0, 0, 0.05);
		border-radius: 3px;
		letter-spacing: 0.06em;
		color: #4a4a4a;
	}
	:global(.pdf-bar-actions) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	:global(.zoom-controls) {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
	}
	:global(.zoom-btn) {
		padding: 4px 8px;
		font-size: 12px;
		font-weight: 600;
		color: #4a4a4a;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 4px;
	}
	:global(.zoom-btn:hover) {
		background: rgba(0, 0, 0, 0.05);
	}
	:global(.zoom-label) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #6b6b6b;
		padding: 0 6px;
		min-width: 36px;
		text-align: center;
	}
	:global(.pbtn) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
	}
	:global(.pbtn-back) {
		background: white;
		border-color: rgba(0, 0, 0, 0.1);
		color: #1a1a1a;
	}
	:global(.pbtn-back:hover) {
		background: #faf7f2;
	}
	:global(.pbtn-icon-svg) {
		height: 14px;
		width: 14px;
	}
	:global(.estado-bar) {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 12px 28px;
		background: white;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	:global(.status-pill) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 10px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	:global(.estado-info-stack) {
		display: flex;
		gap: 24px;
		flex: 1;
	}
	:global(.estado-info) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	:global(.estado-info-icon) {
		display: flex;
		width: 22px;
		height: 22px;
		align-items: center;
		justify-content: center;
		color: #6b6b6b;
	}
	:global(.estado-info-icon svg) {
		width: 16px;
		height: 16px;
	}
	:global(.filter-field-label) {
		font-size: 0.55rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #9a9a9a;
		display: block;
	}
	:global(.estado-info-full) {
		font-size: 12px;
		color: #1a1a1a;
	}
	:global(.font-mono) {
		font-family: 'JetBrains Mono', monospace;
	}
	:global(.pdf-body) {
		flex: 1;
		overflow: auto;
		padding: 28px;
		background: #faf7f2;
	}
	:global(.page-scale-wrap) {
		margin: 0 auto;
	}
	:global(.page) {
		background: white;
		padding: 14mm;
		width: 1900px;
		min-height: 800px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
		border-radius: 4px;
	}
	:global(.dh) {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 14px;
		align-items: center;
		margin-bottom: 10px;
		padding-bottom: 8px;
		border-bottom: 2px solid #0f4025;
	}
	:global(.dh-title .dh-co) {
		font-size: 14pt;
		font-weight: 800;
		color: #0f4025;
		letter-spacing: 0.02em;
	}
	:global(.dh-title .dh-doc) {
		font-size: 9pt;
		font-weight: 600;
		color: #4a4a4a;
		margin-top: 2px;
	}
	:global(.dh-meta .mt) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 8pt;
	}
	:global(.dh-meta .ml) {
		padding: 1px 6px;
		color: #6b6b6b;
		text-align: right;
	}
	:global(.dh-meta .mv) {
		padding: 1px 6px;
		color: #0f4025;
		font-weight: 600;
	}
	:global(.pb) {
		display: flex;
		gap: 14px;
		padding: 6px 0;
		margin-bottom: 12px;
		background: rgba(15, 64, 37, 0.04);
		border-radius: 4px;
		padding-left: 8px;
	}
	:global(.pc) {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	:global(.pc .pclabel) {
		font-size: 8pt;
		font-weight: 700;
		text-transform: uppercase;
		color: #6b6b6b;
		letter-spacing: 0.04em;
	}
	:global(.pc .pcval) {
		font-size: 10pt;
		font-weight: 700;
		color: #0f1f1a;
	}
	:global(.pc-tercero .pcval) {
		font-size: 9pt;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.terc-prev-tbl) {
		width: 100%;
		border-collapse: collapse;
		font-family: 'Inter', system-ui;
	}
	:global(.terc-prev-tbl th) {
		background: #0f4025;
		color: white;
		padding: 5px 6px;
		font-size: 9pt;
		font-weight: 700;
		text-align: left;
		letter-spacing: 0.02em;
	}
	:global(.terc-prev-tbl td) {
		padding: 4px 6px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
		font-size: 9.5pt;
		color: #1a1a1a;
	}
	:global(.num-cell) {
		text-align: center;
	}
	:global(.mc) {
		text-align: right;
		font-family: 'JetBrains Mono', monospace;
	}
	:global(.tc) {
		text-align: center;
	}
	:global(.empty-desc) {
		text-align: center;
		color: #9a9a9a;
		font-style: italic;
		padding: 14px;
	}
	:global(.desc-section-title) {
		font-size: 10pt;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #0f4025;
		border-left: 4px solid #0f4025;
		padding-left: 8px;
		margin-top: 14px;
		margin-bottom: 4px;
	}
	:global(.desc-resumen) {
		display: flex;
		justify-content: flex-end;
		gap: 30px;
		width: 600px;
		max-width: 600px;
		margin-top: 8px;
		margin-left: auto;
		padding: 0;
	}
	:global(.resumen-line) {
		display: flex;
		flex-direction: row;
		align-items: baseline;
		gap: 6px;
		font-weight: 800;
		font-size: 11pt;
	}
	:global(.resumen-line > span:first-child) {
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	:global(.resumen-val) {
		font-family: 'JetBrains Mono', monospace;
	}
	:global(.resumen-red) {
		color: #dc2626;
	}
	:global(.resumen-pagar) {
		color: #0f4025;
		font-size: 14pt;
		border-top: 1.5px solid #0f4025;
		padding-top: 4px;
	}
	:global(.resumen-pagar .resumen-val) {
		font-size: 14pt;
	}
	:global(.sigs) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 30px;
		margin-top: 50px;
		padding-top: 12px;
	}
	:global(.sig) {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-height: 100px;
	}
	:global(.sig-img) {
		max-height: 60px;
		max-width: 280px;
		object-fit: contain;
		display: block;
	}
	:global(.sig-lbl) {
		font-size: 9pt;
		font-weight: 700;
		color: #0f4025;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	:global(.sig-line) {
		padding-top: 6px;
		border-top: 1px solid #0f1f1a;
		font-size: 9pt;
		color: #1a1a1a;
	}
	@media print {
		:global(.no-print) {
			display: none !important;
		}
	}
</style>
