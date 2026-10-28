<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import {
		facturacionLiquidacionesAPI,
		type FacturaLiquidacion,
		type TipoAnulacionFactura
	} from '$lib/api/facturacionLiquidaciones';
	import type { FacturaActivaDeLiquidacion } from '$lib/api/liquidaciones-servicios';
	import SelectorAnulacionFactura from '$lib/components/liquidaciones/SelectorAnulacionFactura.svelte';

	interface Props {
		open: boolean;
		liquidacion: { id: string; consecutivo: string } | null;
		factura: FacturaActivaDeLiquidacion | null;
		onclose: () => void;
		ondone?: (resultado: { accion: Accion; estados: Record<string, string> }) => void;
	}

	type Accion = 'anular' | 'quitar';

	let { open, liquidacion, factura, onclose, ondone }: Props = $props();
	let accion = $state<Accion>('anular');
	let motivo = $state('');
	let tipo = $state<TipoAnulacionFactura>('SIN_MODIFICAR');
	let liquidacionesALiquidar = $state<string[]>([]);
	let liquidacionDuplicadaId = $state('');
	let facturaDetalle = $state<FacturaLiquidacion | null>(null);
	let cargandoFactura = $state(false);
	let enviando = $state(false);
	let error = $state('');

	$effect(() => {
		const facturaId = open ? factura?.id : undefined;
		if (!facturaId) {
			facturaDetalle = null;
			cargandoFactura = false;
			return;
		}

		let vigente = true;
		accion = 'anular';
		motivo = '';
		tipo = 'SIN_MODIFICAR';
		liquidacionesALiquidar = [];
		liquidacionDuplicadaId = '';
		facturaDetalle = null;
		cargandoFactura = true;
		error = '';
		void facturacionLiquidacionesAPI
			.obtenerPorId(facturaId)
			.then((resultado) => {
				if (vigente) facturaDetalle = resultado;
			})
			.catch((e: any) => {
				if (vigente) error = e?.response?.data?.error ?? e?.message ?? 'No se pudo cargar la factura.';
			})
			.finally(() => {
				if (vigente) cargandoFactura = false;
			});
		return () => {
			vigente = false;
		};
	});

	const seleccionValida = $derived(
		tipo === 'SIN_MODIFICAR' ||
		(tipo === 'MODIFICAR_LIQUIDACIONES' && liquidacionesALiquidar.length > 0) ||
		(tipo === 'DUPLICIDAD' && !!liquidacionDuplicadaId)
	);
	const puedeConfirmar = $derived(
		!cargandoFactura && !!facturaDetalle && (accion === 'quitar' || (motivo.trim().length > 0 && seleccionValida))
	);

	async function confirmar() {
		if (!liquidacion || !factura || !puedeConfirmar) return;
		enviando = true;
		error = '';
		try {
			if (accion === 'anular') {
				const resultado = await facturacionLiquidacionesAPI.anular(factura.id, motivo.trim(), {
					tipo,
					liquidaciones_a_liquidar:
						tipo === 'MODIFICAR_LIQUIDACIONES' ? liquidacionesALiquidar : [],
					liquidacion_duplicada_id: tipo === 'DUPLICIDAD' ? liquidacionDuplicadaId : undefined
				});
				ondone?.({ accion, estados: resultado.estados_resultantes });
			} else {
				await facturacionLiquidacionesAPI.quitarLiquidacion(factura.id, liquidacion.id);
				ondone?.({ accion, estados: { [liquidacion.id]: 'APROBADA' } });
			}
			onclose();
		} catch (e: any) {
			error = e?.response?.data?.error ?? e?.message ?? 'No se pudo revertir la facturación.';
		} finally {
			enviando = false;
		}
	}
</script>

<ConfirmDialog
	{open}
	tone="warning"
	eyebrow="LIQUIDACIÓN FACTURADA"
	mascot="ayuda"
	title={accion === 'anular'
		? `¿Anular la factura #${factura?.numero_factura ?? ''}?`
		: `¿Devolver ${liquidacion?.consecutivo ?? ''} a aprobada?`}
	message="Está en la factura {factura?.numero_factura ?? ''}. Elige si anular la factura o quitar solo este servicio."
	confirmText={accion === 'anular' ? 'Anular factura' : 'Quitar de la factura'}
	loading={enviando}
	loadingText="Procesando…"
	confirmDisabled={!puedeConfirmar}
	onconfirm={confirmar}
	oncancel={onclose}
>
	<div class="rf-opciones" role="radiogroup" aria-label="Qué hacer con la factura">
		<label class="rf-opcion" class:activa={accion === 'anular'}>
			<input type="radio" name="rf-accion" value="anular" bind:group={accion} />
			<span>
				<strong>Anular la factura {factura?.numero_factura}</strong>
				<small>Define el resultado de cada liquidación del lote según el motivo.</small>
			</span>
		</label>
		<label class="rf-opcion" class:activa={accion === 'quitar'}>
			<input type="radio" name="rf-accion" value="quitar" bind:group={accion} />
			<span>
				<strong>Solo quitar esta liquidación</strong>
				<small>La factura sigue activa con el resto; esta liquidación queda APROBADA.</small>
			</span>
		</label>
	</div>

	{#if accion === 'anular'}
		{#if cargandoFactura}
			<p class="rf-cargando">Cargando las liquidaciones del lote…</p>
		{:else if facturaDetalle}
			<SelectorAnulacionFactura
				items={facturaDetalle.items}
				prefijoNombre="revertir-facturada"
				{tipo}
				{liquidacionesALiquidar}
				{liquidacionDuplicadaId}
				deshabilitado={enviando}
				onTipoChange={(siguiente) => (tipo = siguiente)}
				onLiquidacionesALiquidarChange={(ids) => (liquidacionesALiquidar = ids)}
				onLiquidacionDuplicadaChange={(id) => (liquidacionDuplicadaId = id)}
			/>
		{/if}
		<label class="rf-motivo">
			<span>Motivo de la anulación</span>
			<textarea
				rows="2"
				bind:value={motivo}
				placeholder="Ej. Error en los valores facturados"
				disabled={enviando}
			></textarea>
		</label>
	{/if}

	{#if error}<p class="rf-error" role="alert">{error}</p>{/if}
</ConfirmDialog>

<style>
	.rf-opciones {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rf-opcion {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.rf-opcion.activa {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 6%, transparent);
	}
	.rf-opcion input {
		margin-top: 3px;
		accent-color: var(--accion);
	}
	.rf-opcion span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.rf-opcion strong {
		color: var(--text-primary);
		font-size: 14px;
	}
	.rf-opcion small {
		color: var(--text-muted);
		font-size: 12.5px;
		line-height: 1.4;
	}
	.rf-motivo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.rf-motivo textarea {
		width: 100%;
		resize: vertical;
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		font: inherit;
		font-weight: 400;
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.rf-motivo textarea:focus {
		outline: 2px solid color-mix(in srgb, var(--accion) 35%, transparent);
		border-color: var(--accion);
	}
	.rf-cargando {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
	}
	.rf-error {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: #fff0ed;
		color: #b42318;
		font-size: 13px;
	}
</style>
