<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';
	import { facturacionLiquidacionesAPI } from '$lib/api/facturacionLiquidaciones';

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

		saving = true;
		try {
			const factura = await facturacionLiquidacionesAPI.crear({
				numero_factura: numeroFactura.trim(),
				liquidacion_ids: [...selectedIds],
				observaciones: observaciones.trim() || undefined,
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
		dispatch('close');
	}
</script>

{#if open}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="modal-overlay" on:click={cerrar}>
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div class="modal-box" on:click|stopPropagation>
			<div class="modal-header">
				<h2>🧾 Facturar Liquidaciones</h2>
				<button class="close-btn" on:click={cerrar}>✕</button>
			</div>

			<div class="modal-body">
				{#if error}
					<div class="error-msg">⚠️ {error}</div>
				{/if}

				<!-- Número de factura -->
				<div class="form-row">
					<div class="field">
						<label for="numero-factura">Número / Consecutivo de Factura <span class="req">*</span></label>
						<input
							id="numero-factura"
							type="text"
							bind:value={numeroFactura}
							placeholder="Ej: FV-2-5001, FAC-2026-001..."
							class="factura-input"
						/>
					</div>
					<div class="field">
						<label for="observaciones">Observaciones</label>
						<input
							id="observaciones"
							type="text"
							bind:value={observaciones}
							placeholder="Opcional..."
						/>
					</div>
				</div>

				<!-- Buscador -->
				<div class="search-row">
					<input
						type="text"
						bind:value={searchText}
						placeholder="🔍 Buscar por consecutivo o cliente..."
						class="search-input"
					/>
					<span class="count-badge">{selectedIds.size} seleccionadas</span>
				</div>

			<!-- Tabla de selección -->
			{#if loading}
				<div class="empty">
					<span class="spinner-sm" style="border-color:rgba(15,23,42,0.2);border-top-color:#0f4025"></span>
					<p style="margin-top:8px">Cargando liquidaciones facturables…</p>
				</div>
			{:else if facturables.length === 0}
				<div class="empty">
					<p>No hay liquidaciones en estado LIQUIDADA o APROBADA para facturar.</p>
				</div>
			{:else}
					<div class="table-wrap">
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
					<div class="resumen">
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

			<div class="modal-footer">
				<button class="btn-cancel" on:click={cerrar} disabled={saving}>Cancelar</button>
				<button
					class="btn-facturar"
					on:click={facturar}
					disabled={saving || selectedIds.size === 0 || !numeroFactura.trim()}
				>
					{#if saving}
						<span class="spinner-sm"></span> Facturando...
					{:else}
						🧾 Facturar ({selectedIds.size})
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed; inset: 0; z-index: 9999;
		background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
		display: flex; align-items: center; justify-content: center;
		padding: 20px;
	}
	.modal-box {
		background: white; border-radius: 14px; width: 100%; max-width: 820px;
		max-height: 85vh; display: flex; flex-direction: column;
		box-shadow: 0 20px 60px rgba(0,0,0,0.25);
	}
	.modal-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 18px 24px; border-bottom: 1px solid #e2e8f0;
	}
	.modal-header h2 { margin: 0; font-size: 18px; color: #1e293b; }
	.close-btn {
		background: none; border: none; font-size: 20px; color: #94a3b8;
		cursor: pointer; padding: 4px 8px; border-radius: 6px;
	}
	.close-btn:hover { background: #f1f5f9; color: #475569; }
	.modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
	.modal-footer {
		display: flex; gap: 10px; justify-content: flex-end;
		padding: 16px 24px; border-top: 1px solid #e2e8f0;
	}
	.error-msg {
		background: #fef2f2; color: #dc2626; padding: 10px 14px;
		border-radius: 8px; font-size: 13px; margin-bottom: 14px;
		border: 1px solid #fecaca;
	}
	.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
	.field label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 5px; }
	.field input {
		width: 100%; padding: 9px 12px; border: 1.5px solid #cbd5e1;
		border-radius: 8px; font-size: 13px; transition: border-color 0.2s;
		box-sizing: border-box;
	}
	.field input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
	.factura-input { font-family: monospace; font-weight: 700; font-size: 15px !important; letter-spacing: 0.5px; }
	.req { color: #ef4444; }
	.search-row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
	.search-input {
		flex: 1; padding: 8px 12px; border: 1.5px solid #e2e8f0;
		border-radius: 8px; font-size: 13px;
	}
	.search-input:focus { outline: none; border-color: #3b82f6; }
	.count-badge {
		background: #eff6ff; color: #2563eb; padding: 6px 12px;
		border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap;
	}
	.table-wrap { max-height: 320px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	thead { position: sticky; top: 0; z-index: 1; }
	th {
		background: #f8fafc; padding: 10px 12px; text-align: left;
		font-weight: 600; color: #64748b; font-size: 11px;
		text-transform: uppercase; letter-spacing: 0.5px;
		border-bottom: 1px solid #e2e8f0;
	}
	td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
	tr { cursor: pointer; transition: background 0.15s; }
	tbody tr:hover { background: #f8fafc; }
	tr.selected { background: #eff6ff !important; }
	.chk-col { width: 36px; text-align: center; }
	.right { text-align: right; }
	.mono { font-family: monospace; font-weight: 600; }
	.badge {
		display: inline-block; padding: 2px 8px; border-radius: 12px;
		font-size: 10px; font-weight: 700; text-transform: uppercase;
	}
	.bg-blue { background: #dbeafe; color: #2563eb; }
	.bg-green { background: #dcfce7; color: #16a34a; }
	.resumen {
		margin-top: 14px; padding: 12px 16px; background: #f8fafc;
		border-radius: 10px; display: flex; justify-content: space-between; align-items: center;
	}
	.resumen-item { display: flex; gap: 8px; align-items: center; }
	.resumen-item .label { font-size: 13px; color: #64748b; }
	.resumen-item .value { font-weight: 700; font-size: 14px; color: #1e293b; }
	.resumen-item.total .value { color: #ea580c; font-size: 16px; }
	.btn-cancel {
		padding: 10px 20px; border: 1.5px solid #e2e8f0; background: white;
		border-radius: 8px; font-size: 13px; cursor: pointer; color: #475569;
	}
	.btn-cancel:hover { background: #f8fafc; }
	.btn-facturar {
		padding: 10px 24px; background: #ea580c; color: white;
		border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
		cursor: pointer; display: flex; align-items: center; gap: 6px;
	}
	.btn-facturar:hover:not(:disabled) { background: #047857; }
	.btn-facturar:disabled { opacity: 0.5; cursor: not-allowed; }
	.spinner-sm {
		display: inline-block; width: 14px; height: 14px;
		border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
		border-radius: 50%; animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.empty { text-align: center; padding: 30px; color: #94a3b8; }

	@media (max-width: 600px) {
		.form-row { grid-template-columns: 1fr; }
		.modal-box { max-width: 100%; }
	}
</style>
