<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import {
		facturacionLiquidacionesAPI,
		type FacturaLiquidacion,
		type TipoAnulacionFactura
	} from '$lib/api/facturacionLiquidaciones';
	import SelectorAnulacionFactura from './SelectorAnulacionFactura.svelte';

	interface Props {
		open: boolean;
		factura: FacturaLiquidacion | null;
		puedeElegirResultadoLiquidaciones: boolean;
		onclose: () => void;
		onannulled: (factura: FacturaLiquidacion & { estados_resultantes: Record<string, string> }) => void;
	}

	let { open, factura, puedeElegirResultadoLiquidaciones, onclose, onannulled }: Props = $props();
	let motivo = $state('');
	let tipo = $state<TipoAnulacionFactura>('SIN_MODIFICAR');
	let liquidacionesALiquidar = $state<string[]>([]);
	let liquidacionDuplicadaId = $state('');
	let enviando = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open) return;
		motivo = '';
		tipo = 'SIN_MODIFICAR';
		liquidacionesALiquidar = [];
		liquidacionDuplicadaId = '';
		error = '';
	});

	const seleccionValida = $derived(
		tipo === 'SIN_MODIFICAR' ||
		(tipo === 'MODIFICAR_LIQUIDACIONES' && liquidacionesALiquidar.length > 0) ||
		(tipo === 'DUPLICIDAD' && !!liquidacionDuplicadaId)
	);

	async function confirmar() {
		if (!factura || !motivo.trim() || !seleccionValida) return;
		enviando = true;
		error = '';
		try {
			const resultado = await facturacionLiquidacionesAPI.anular(factura.id, motivo.trim(), {
				tipo,
				liquidaciones_a_liquidar:
					tipo === 'MODIFICAR_LIQUIDACIONES' ? liquidacionesALiquidar : [],
				liquidacion_duplicada_id: tipo === 'DUPLICIDAD' ? liquidacionDuplicadaId : undefined
			});
			onannulled(resultado);
			onclose();
		} catch (err: any) {
			error = err.response?.data?.error || err.message || 'No se pudo anular la factura.';
		} finally {
			enviando = false;
		}
	}
</script>

<ConfirmDialog
	{open}
	tone="danger"
	title="¿Anular la factura #{factura?.numero_factura ?? ''}?"
	message={puedeElegirResultadoLiquidaciones
		? 'Elige el resultado para cada liquidación del lote.'
		: 'Todas las liquidaciones asociadas volverán a APROBADA.'}
	confirmText="Anular factura"
	loading={enviando}
	loadingText="Anulando…"
	confirmDisabled={!motivo.trim() || !seleccionValida}
	onconfirm={confirmar}
	oncancel={onclose}
>
	<div class="ma-contenido">
		{#if puedeElegirResultadoLiquidaciones}
			<SelectorAnulacionFactura
				items={factura?.items ?? []}
				prefijoNombre="anular-factura-principal"
				{tipo}
				{liquidacionesALiquidar}
				{liquidacionDuplicadaId}
				deshabilitado={enviando}
				onTipoChange={(siguiente) => (tipo = siguiente)}
				onLiquidacionesALiquidarChange={(ids) => (liquidacionesALiquidar = ids)}
				onLiquidacionDuplicadaChange={(id) => (liquidacionDuplicadaId = id)}
			/>
		{/if}
		<label class="ma-motivo">
			<span>Motivo de anulación <b>*</b></span>
			<textarea
				rows="2"
				bind:value={motivo}
				placeholder="Explica por qué se anula la factura"
				disabled={enviando}
			></textarea>
		</label>
		{#if error}<p class="ma-error" role="alert">{error}</p>{/if}
	</div>
</ConfirmDialog>

<style>
	.ma-contenido {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: min(65vh, 600px);
		overflow: auto;
	}
	.ma-motivo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
	}
	.ma-motivo b {
		color: #dc2626;
	}
	.ma-motivo textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 13px;
		resize: vertical;
	}
	.ma-error {
		margin: 0;
		color: #b91c1c;
		font-size: 12px;
	}
</style>
