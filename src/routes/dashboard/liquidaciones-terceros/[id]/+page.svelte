<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import { liquidacionesRecordatoriosAPI } from '$lib/api/liquidaciones-recordatorios';
	import PreviewTerceroPDF from '$lib/components/PreviewTerceroPDF.svelte';
	import ChatLiquidacionFab from '$lib/components/chat/ChatLiquidacionFab.svelte';
	import RecordatorioBanner from '$lib/components/chat/RecordatorioBanner.svelte';

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

	$: id = $page.params.id;
	$: viewMode = $page.url.searchParams.get('mode') === 'view';

	let loading = true;
	let loadError = '';
	let previewItem: any = null;
	let showBanner = false;
	let recordatorioCount = 0;

	onMount(async () => {
		if (!id) {
			loadError = 'ID de liquidacion requerido';
			loading = false;
			return;
		}
		try {
			previewItem = await liquidacionesTercerosDescuentosAPI.obtenerPorId(id);

			try {
				if (previewItem && previewItem.placa && previewItem.mes && previewItem.anio) {
					const pending = await liquidacionesRecordatoriosAPI.pendientesPorPlaca(
						previewItem.placa,
						previewItem.mes,
						previewItem.anio
					);
					if (pending.length > 0) {
						recordatorioCount = pending.length;
						const dismissed = localStorage.getItem(`liq-banner-dismissed:${id}`);
						if (!dismissed) {
							showBanner = true;
						}
					}
				}
			} catch {
				/* ignore */
			}
		} catch (e: any) {
			loadError = e?.message || 'Error al cargar la liquidacion';
		} finally {
			loading = false;
		}
	});

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}

	function dismissBanner() {
		showBanner = false;
		if (id) localStorage.setItem(`liq-banner-dismissed:${id}`, '1');
	}
</script>

<svelte:head>
	<title>Vista previa Liquidacion · Transmeralda</title>
</svelte:head>

<div
	class="route-wrap"
	class:is-loading={loading}
	class:is-error={!!loadError}
	class:is-ready={!loading && !loadError}
>
	<div class="route-bar no-print">
		<button class="back-btn" on:click={() => goto('/dashboard/liquidaciones-terceros')}>
			← Volver al listado
		</button>
		{#if previewItem}
			<div class="route-meta">
				<strong>{previewItem.liquidacion?.consecutivo || previewItem.consecutivo || ''}</strong>
				<span class="dot">·</span>
				<span>{previewItem.mes ? MESES[previewItem.mes - 1] : ''} {previewItem.anio || ''}</span>
				<span class="dot">·</span>
				<span class="placa">{fmtPlaca(previewItem.placa)}</span>
			</div>
		{/if}
	</div>

	{#if showBanner && previewItem}
		<div class="no-print mx-auto w-full max-w-4xl px-4 py-2">
			<RecordatorioBanner
				count={recordatorioCount}
				placa={previewItem.placa}
				mes={previewItem.mes ? MESES[previewItem.mes - 1] : ''}
				anio={previewItem.anio || 0}
				onOpenChat={() => {}}
				onDismiss={dismissBanner}
			/>
		</div>
	{/if}

	{#if loading}
		<div class="state-box">
			<div class="spinner"></div>
			<p>Cargando liquidacion...</p>
		</div>
	{:else if loadError}
		<div class="state-box error">
			<p>❌ {loadError}</p>
			<button class="back-btn" on:click={() => goto('/dashboard/liquidaciones-terceros')}>
				Volver
			</button>
		</div>
	{:else if previewItem}
		<PreviewTerceroPDF item={previewItem} {viewMode} />
	{/if}
</div>

{#if previewItem}
	<ChatLiquidacionFab
		liquidacionId={id || ''}
		liquidacionInfo={{
			placa: previewItem.placa,
			mes: previewItem.mes || 0,
			anio: previewItem.anio || 0,
			consecutivo: previewItem.liquidacion?.consecutivo || previewItem.consecutivo || ''
		}}
	/>
{/if}

<style>
	.route-wrap {
		min-height: 100vh;
		background: #b0b8c2;
		display: flex;
		flex-direction: column;
	}
	.route-wrap.is-loading,
	.route-wrap.is-error {
		position: fixed;
		inset: 0;
		z-index: 300;
		min-height: 100vh;
	}
	.route-bar {
		background: #1e2429;
		color: #fff;
		padding: 10px 22px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	@media print {
		.no-print {
			display: none !important;
		}
	}
	.back-btn {
		padding: 7px 16px;
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.back-btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.route-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: rgba(255, 255, 255, 0.85);
	}
	.route-meta strong {
		color: #fff;
		font-weight: 700;
	}
	.route-meta .dot {
		color: rgba(255, 255, 255, 0.4);
	}
	.route-meta .placa {
		font-family: 'SF Mono', 'Fira Code', monospace;
		background: rgba(255, 255, 255, 0.12);
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 700;
	}
	.state-box {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		color: #fff;
		font-size: 14px;
	}
	.state-box.error p {
		color: #fca5a5;
		font-weight: 600;
	}
	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
