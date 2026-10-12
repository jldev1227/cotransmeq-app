<script lang="ts">
	/**
	 * Campos del pago de un cierre de terceros: fecha, medio, referencia y
	 * soporte. Los comparten el header del canvas (una hoja), el lote y el
	 * registro posterior de un PAGADA «sin registro».
	 *
	 * Solo pinta y enlaza el formulario; quien lo usa decide cuándo mandarlo
	 * (`armarPago` sube el soporte y arma el objeto `pago`).
	 */
	import type { FormPago } from '$lib/api/liquidacionesTercerosPagos';
	import { ETIQUETA_MEDIO, MEDIOS_PAGO, hoyColombia } from '$lib/pagos/medios';

	interface Props {
		form: FormPago;
		/** Varias hojas con un solo pago: cambia el texto de ayuda. */
		lote?: boolean;
		deshabilitado?: boolean;
	}

	let { form = $bindable(), lote = false, deshabilitado = false }: Props = $props();
	const id = `pago-${Math.random().toString(36).slice(2, 8)}`;
</script>

<fieldset class="cpc" disabled={deshabilitado}>
	<legend class="cpc-leyenda">
		Datos del pago {#if lote}<small>· se registran en cada hoja</small>{/if}
	</legend>
	<div class="cpc-rejilla">
		<label class="cpc-campo" for="{id}-fecha">
			<span>Fecha del pago <b>*</b></span>
			<input id="{id}-fecha" type="date" bind:value={form.fecha} max={hoyColombia()} required />
		</label>
		<label class="cpc-campo" for="{id}-medio">
			<span>Medio <b>*</b></span>
			<select id="{id}-medio" bind:value={form.medio} required>
				<option value="" disabled>Elige…</option>
				{#each MEDIOS_PAGO as m (m)}
					<option value={m}>{ETIQUETA_MEDIO[m]}</option>
				{/each}
			</select>
		</label>
		<label class="cpc-campo" for="{id}-ref">
			<span>Referencia</span>
			<input
				id="{id}-ref"
				type="text"
				maxlength="120"
				bind:value={form.referencia}
				placeholder="N° de transacción, cheque…"
			/>
		</label>
		<label class="cpc-campo" for="{id}-soporte">
			<span>Comprobante (opcional)</span>
			<input
				id="{id}-soporte"
				type="file"
				accept="application/pdf,image/png,image/jpeg,image/webp"
				onchange={(e) => (form.archivo = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
			/>
		</label>
	</div>
</fieldset>

<style>
	.cpc {
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.cpc-leyenda {
		padding: 0;
		margin-bottom: 8px;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #475569;
	}
	.cpc-leyenda small {
		font-weight: 600;
		text-transform: none;
		letter-spacing: 0;
		color: #64748b;
	}
	.cpc-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
		gap: 10px;
	}
	.cpc-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 700;
		color: #475569;
	}
	.cpc-campo b {
		color: #dc2626;
	}
	.cpc-campo input,
	.cpc-campo select {
		min-height: 36px;
		width: 100%;
		padding: 6px 9px;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		background: #fff;
		color: #0f172a;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		box-sizing: border-box;
	}
	.cpc-campo input[type='file'] {
		padding: 5px;
		font-size: 12px;
	}
</style>
