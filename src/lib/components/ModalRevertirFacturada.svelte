<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { facturacionLiquidacionesAPI } from '$lib/api/facturacionLiquidaciones';
	import type { FacturaActivaDeLiquidacion } from '$lib/api/liquidaciones-servicios';

	/**
	 * Devolver una liquidación FACTURADA a APROBADA.
	 *
	 * Mientras siga dentro de una factura activa, el backend no deja cambiarle
	 * el estado (409 `FACTURA_ACTIVA`). Este modal sugiere primero anular la
	 * factura —es lo que pide el flujo contable cuando la factura salió mal— y
	 * ofrece como alternativa quitar solo esta liquidación, que deja la factura
	 * viva con el resto. En los dos casos la liquidación queda APROBADA.
	 */
	interface Props {
		open: boolean;
		liquidacion: { id: string; consecutivo: string } | null;
		factura: FacturaActivaDeLiquidacion | null;
		onclose: () => void;
		/** Tras revertir; `ids` son todas las liquidaciones que cambiaron de estado. */
		ondone?: (resultado: { accion: Accion; estados: Record<string, string> }) => void;
	}

	type Accion = 'anular' | 'quitar';

	let { open, liquidacion, factura, onclose, ondone }: Props = $props();

	let accion = $state<Accion>('anular');
	let motivo = $state('');
	let enviando = $state(false);
	let error = $state('');

	/// Cada apertura empieza limpia: el motivo de la factura anterior no tiene
	/// nada que ver con esta.
	$effect(() => {
		if (open) {
			accion = 'anular';
			motivo = '';
			error = '';
		}
	});

	const otras = $derived(Math.max(0, (factura?.liquidaciones_en_factura ?? 1) - 1));
	const puedeConfirmar = $derived(accion === 'quitar' || motivo.trim().length > 0);

	async function confirmar() {
		if (!liquidacion || !factura || !puedeConfirmar) return;
		enviando = true;
		error = '';
		try {
			if (accion === 'anular') {
				const r = await facturacionLiquidacionesAPI.anular(factura.id, motivo.trim(), {
					mantener_aprobada: liquidacion.id
				});
				const estados: Record<string, string> = {};
				for (const item of r.items ?? []) {
					const id = item.liquidacion?.id ?? item.liquidacion_id;
					if (id) estados[id] = id === liquidacion.id ? 'APROBADA' : 'LIQUIDADA';
				}
				estados[liquidacion.id] = 'APROBADA';
				ondone?.({ accion, estados });
			} else {
				await facturacionLiquidacionesAPI.quitarLiquidacion(factura.id, liquidacion.id, 'APROBADA');
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
	title="¿Devolver {liquidacion?.consecutivo ?? ''} a aprobada?"
	message="Está en la factura {factura?.numero_factura ??
		''}. Para dejarla aprobada primero hay que sacarla de esa factura."
	confirmText={accion === 'anular' ? 'Anular factura' : 'Quitar de la factura'}
	loading={enviando}
	loadingText="Revirtiendo…"
	confirmDisabled={!puedeConfirmar}
	onconfirm={confirmar}
	oncancel={onclose}
>
	<div class="rf-opciones" role="radiogroup" aria-label="Qué hacer con la factura">
		<label class="rf-opcion" class:activa={accion === 'anular'}>
			<input type="radio" name="rf-accion" value="anular" bind:group={accion} />
			<span>
				<strong>Anular la factura {factura?.numero_factura} <em>(sugerido)</em></strong>
				<small>
					{#if otras > 0}
						Las otras {otras} liquidación(es) de la factura volverán a LIQUIDADA.
					{:else}
						Es la única liquidación de esta factura.
					{/if}
				</small>
			</span>
		</label>
		<label class="rf-opcion" class:activa={accion === 'quitar'}>
			<input type="radio" name="rf-accion" value="quitar" bind:group={accion} />
			<span>
				<strong>Solo quitar esta liquidación</strong>
				<small>La factura sigue activa con el resto y su total se recalcula.</small>
			</span>
		</label>
	</div>

	{#if accion === 'anular'}
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
		transition:
			border-color 0.15s,
			background 0.15s;
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
	.rf-opcion em {
		color: var(--accion-hover);
		font-style: normal;
		font-weight: 600;
		font-size: 12px;
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
	.rf-error {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: #fff0ed;
		color: #b42318;
		font-size: 13px;
	}
</style>
