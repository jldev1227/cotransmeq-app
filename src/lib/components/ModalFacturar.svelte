<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';
	import { facturacionLiquidacionesAPI } from '$lib/api/facturacionLiquidaciones';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { fechaCorta, hoyColombia, sumarDias } from '$lib/pagos/medios';

	export let open = false;
	export let liquidaciones: LiquidacionServicio[] = [];
	export let preselectedIds: string[] = [];
	export let loading = false;

	const dispatch = createEventDispatcher<{
		created: { factura: any };
		close: void;
	}>();

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency', currency: 'COP',
			minimumFractionDigits: 0, maximumFractionDigits: 0,
		}).format(parseFloat(String(v)) || 0);

	// State
	let selectedIds: Set<string> = new Set();
	let numeroFactura = '';
	let observaciones = '';
	let saving = false;
	let error = '';
	let searchText = '';

	/// Condiciones de cobro (cartera). El valor sigue la suma de lo marcado
	/// hasta que el usuario lo toca: entonces manda lo digitado, que es el
	/// valor de la factura electrónica (puede diferir por redondeos o ajustes).
	let valorFactura: number | null = null;
	let valorEditado = false;
	let fechaEmision = hoyColombia();
	let plazoDias = 30;

	// Initialize selection from preselected
	$: if (open && preselectedIds.length > 0) {
		selectedIds = new Set(preselectedIds);
	}

	// Filter only facturable liquidaciones (APROBADA only, not already facturada)
	$: facturables = liquidaciones.filter(l =>
		l.estado === 'APROBADA'
	);

	$: filtered = searchText
		? facturables.filter(l =>
			l.consecutivo.toLowerCase().includes(searchText.toLowerCase()) ||
			(l.cliente?.nombre || '').toLowerCase().includes(searchText.toLowerCase())
		)
		: facturables;

	$: selectedList = facturables.filter(l => selectedIds.has(l.id));
	$: totalSelected = selectedList.reduce((s, l) => s + (l.total || 0), 0);
	$: if (!valorEditado) valorFactura = Math.round(totalSelected * 100) / 100;
	$: plazoValido = Number.isInteger(Number(plazoDias)) && plazoDias >= 0 && plazoDias <= 365;
	$: vencimiento = fechaEmision && plazoValido ? sumarDias(fechaEmision, Number(plazoDias)) : '';
	$: diferencia = valorEditado ? Number(valorFactura ?? 0) - totalSelected : 0;

	function toggle(id: string) {
		if (selectedIds.has(id)) {
			selectedIds.delete(id);
		} else {
			selectedIds.add(id);
		}
		selectedIds = new Set(selectedIds); // trigger reactivity
	}

	function toggleAll() {
		if (selectedIds.size === filtered.length) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(filtered.map(l => l.id));
		}
	}

	async function facturar() {
		error = '';
		if (!numeroFactura.trim()) {
			error = 'Ingrese un número de factura';
			return;
		}
		if (selectedIds.size === 0) {
			error = 'Seleccione al menos una liquidación';
			return;
		}
		if (!fechaEmision) {
			error = 'Indique la fecha de emisión de la factura';
			return;
		}
		if (!plazoValido) {
			error = 'El plazo debe ser un número entero de días entre 0 y 365';
			return;
		}
		if (valorEditado && (valorFactura == null || !(Number(valorFactura) >= 0))) {
			error = 'El valor de la factura no es válido';
			return;
		}

		saving = true;
		try {
			const factura = await facturacionLiquidacionesAPI.crear({
				numero_factura: numeroFactura.trim(),
				liquidacion_ids: [...selectedIds],
				observaciones: observaciones.trim() || undefined,
				/// Solo si se digitó: sin él, el backend usa la suma exacta.
				valor_total: valorEditado ? Number(valorFactura) : undefined,
				fecha_emision: fechaEmision,
				plazo_dias: Number(plazoDias)
			});
			dispatch('created', { factura });
			cerrar();
		} catch (err: any) {
			error = err.response?.data?.error || err.message || 'Error al facturar';
		} finally {
			saving = false;
		}
	}

	function cerrar() {
		open = false;
		selectedIds = new Set();
		numeroFactura = '';
		observaciones = '';
		error = '';
		searchText = '';
		valorEditado = false;
		fechaEmision = hoyColombia();
		plazoDias = 30;
		dispatch('close');
	}
</script>

<ModalBase
	{open}
	eyebrow="Facturación"
	title="Facturar liquidaciones"
	subtitle="Solo liquidaciones en estado APROBADA"
	tamano="lg"
	bloqueado={saving}
	cerrarAlFondo={!saving}
	oncerrar={cerrar}
>
	<div class="mf-contenido">
		{#if error}
			<div class="error-msg">{error}</div>
		{/if}

		<!-- Número de factura -->
		<div class="mf-card form-row">
			<div class="field">
				<label for="numero-factura">Número / Consecutivo de Factura <span class="req">*</span></label>
				<input
					id="numero-factura"
					type="text"
					bind:value={numeroFactura}
					placeholder="Ej: FV-2-5001, FAC-2026-001..."
					class="mf-input factura-input"
				/>
			</div>
			<div class="field">
				<label for="observaciones">Observaciones</label>
				<input
					id="observaciones"
					type="text"
					class="mf-input"
					bind:value={observaciones}
					placeholder="Opcional..."
				/>
			</div>
		</div>

		<!-- Cobro: lo que lee Cartera para el saldo y las edades -->
		<div class="mf-card form-row form-row--cobro">
			<div class="field">
				<label for="valor-factura">Valor de la factura</label>
				<input
					id="valor-factura"
					type="number"
					min="0"
					step="0.01"
					inputmode="decimal"
					class="mf-input"
					bind:value={valorFactura}
					on:input={() => (valorEditado = true)}
				/>
				{#if valorEditado}
					<small class="hint">
						{diferencia === 0
							? 'Igual a la suma de las liquidaciones.'
							: `${diferencia > 0 ? '+' : '−'}${COP(Math.abs(diferencia))} frente a la suma.`}
						<button type="button" class="link" on:click={() => (valorEditado = false)}>
							Usar la suma
						</button>
					</small>
				{:else}
					<small class="hint">La suma de las liquidaciones marcadas.</small>
				{/if}
			</div>
			<div class="field">
				<label for="fecha-emision">Fecha de emisión</label>
				<input id="fecha-emision" type="date" class="mf-input" bind:value={fechaEmision} />
			</div>
			<div class="field">
				<label for="plazo-dias">Plazo (días)</label>
				<input id="plazo-dias" type="number" min="0" max="365" step="1" class="mf-input" bind:value={plazoDias} />
				<small class="hint"
					>{vencimiento ? `Vence el ${fechaCorta(vencimiento)}` : 'Plazo inválido'}</small
				>
			</div>
		</div>

		<!-- Buscador -->
		<div class="search-row">
			<input data-tour="fac-buscar"
				type="text"
				bind:value={searchText}
				placeholder="Buscar por consecutivo o cliente..."
				class="mf-input search-input"
			/>
			<span class="count-badge">{selectedIds.size} seleccionadas</span>
		</div>

		<!-- Tabla de selección -->
		{#if loading}
			<div class="mf-card">
				<CargaMascota texto="Cargando liquidaciones facturables…" />
			</div>
		{:else if facturables.length === 0}
			<div class="mf-card empty">
				<p>No hay liquidaciones en estado LIQUIDADA o APROBADA para facturar.</p>
			</div>
		{:else}
			<div class="mf-card table-wrap" data-tour="fac-tabla">
				<table>
					<thead>
						<tr>
							<th class="chk-col">
								<input type="checkbox"
									checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
									on:change={toggleAll}
								/>
							</th>
							<th>Consecutivo</th>
							<th>Cliente</th>
							<th>Periodo</th>
							<th>Estado</th>
							<th class="right">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as liq (liq.id)}
							<tr
								class:selected={selectedIds.has(liq.id)}
								on:click={() => toggle(liq.id)}
							>
								<td class="chk-col">
									<input type="checkbox" checked={selectedIds.has(liq.id)} on:click|stopPropagation={() => toggle(liq.id)} />
								</td>
								<td class="mono">{liq.consecutivo}</td>
								<td>{liq.cliente?.nombre || '—'}</td>
								<td>{liq.mes}/{liq.anio}</td>
								<td>
									<span class="badge {liq.estado === 'APROBADA' ? 'bg-green' : 'bg-blue'}">
										{liq.estado}
									</span>
								</td>
								<td class="right mono">{COP(liq.total || 0)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Resumen -->
		{#if selectedIds.size > 0}
			<div class="mf-card resumen">
				<div class="resumen-item">
					<span class="label">Liquidaciones seleccionadas:</span>
					<span class="value">{selectedIds.size}</span>
				</div>
				<div class="resumen-item total">
					<span class="label">Total a facturar:</span>
					<span class="value">{COP(totalSelected)}</span>
				</div>
			</div>
		{/if}
	</div>

	{#snippet pie()}
		<button class="btn-secondary" on:click={cerrar} disabled={saving}>Cancelar</button>
		<button data-tour="fac-confirmar"
			class="btn-primary"
			on:click={facturar}
			disabled={saving || selectedIds.size === 0 || !numeroFactura.trim()}
		>
			{#if saving}
				<span class="spinner-sm"></span> Facturando...
			{:else}
				Facturar ({selectedIds.size})
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mf-contenido { display: flex; flex-direction: column; gap: 14px; }
	.mf-card {
		background: var(--bg-surface);
		border-radius: 16px;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.error-msg {
		background: #fef2f2; color: #b42318; padding: 10px 14px;
		border-radius: 12px; font-size: 13px; font-weight: 600;
		border: 1px solid #fecaca;
	}
	.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 16px; }
	.field label {
		display: block; font-size: 12px; font-weight: 700;
		color: var(--text-secondary); margin-bottom: 6px;
	}
	.mf-input {
		width: 100%; box-sizing: border-box;
		min-height: 42px; padding: 9px 12px; border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary);
		font: inherit; font-size: 14px;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.mf-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mf-input:disabled { background: var(--bg-base); color: var(--text-muted); }
	.factura-input { font-family: var(--font-mono); font-weight: 700; letter-spacing: 0.5px; }
	.form-row--cobro {
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
	}
	.hint {
		display: block;
		margin-top: 4px;
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		margin-left: 4px;
		font: inherit;
		font-weight: 700;
		color: var(--accion);
		cursor: pointer;
	}
	.req { color: #b42318; }
	.search-row { display: flex; gap: 10px; align-items: center; }
	.search-input { flex: 1; }
	.count-badge {
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-default);
		padding: 6px 12px; border-radius: 999px;
		font-size: 12px; font-weight: 700; white-space: nowrap;
	}
	.table-wrap { max-height: 320px; overflow-y: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text-primary); }
	thead { position: sticky; top: 0; z-index: 1; }
	th {
		background: var(--bg-surface); padding: 10px 12px; text-align: left;
		font-weight: 700; color: var(--text-muted); font-size: 11px;
		text-transform: uppercase; letter-spacing: 0.5px;
		border-bottom: 1px solid var(--border-default);
	}
	td { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); }
	tbody tr:last-child td { border-bottom: none; }
	tr { cursor: pointer; transition: background 0.15s; }
	tbody tr:hover { background: var(--bg-base); }
	tr.selected { background: color-mix(in srgb, var(--accion) 8%, transparent) !important; }
	.chk-col { width: 36px; text-align: center; }
	.chk-col input { accent-color: var(--accion); }
	.right { text-align: right; }
	.mono { font-family: var(--font-mono); font-weight: 600; }
	.badge {
		display: inline-block; padding: 2px 8px; border-radius: 12px;
		font-size: 10px; font-weight: 700; text-transform: uppercase;
	}
	.bg-blue { background: #dbeafe; color: #2563eb; }
	.bg-green { background: #dcfce7; color: #16a34a; }
	.resumen {
		padding: 14px 16px;
		display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
	}
	.resumen-item { display: flex; gap: 8px; align-items: center; }
	.resumen-item .label { font-size: 13px; color: var(--text-secondary); }
	.resumen-item .value { font-weight: 700; font-size: 14px; color: var(--text-primary); }
	.resumen-item.total .value { color: var(--accion); font-size: 16px; font-weight: 800; }
	.spinner-sm {
		display: inline-block; width: 14px; height: 14px;
		border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
		border-radius: 50%; animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.empty { text-align: center; padding: 30px; color: var(--text-muted); }
	.empty p { margin: 0; }

	@media (max-width: 600px) {
		.form-row { grid-template-columns: 1fr; }
	}
</style>
