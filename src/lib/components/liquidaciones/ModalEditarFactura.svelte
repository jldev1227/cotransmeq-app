<script lang="ts">
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';
	import {
		facturacionLiquidacionesAPI,
		type FacturaLiquidacion
	} from '$lib/api/facturacionLiquidaciones';
	import { fechaCorta, sumarDias } from '$lib/pagos/medios';

	type ResultadoEdicion = Awaited<ReturnType<typeof facturacionLiquidacionesAPI.editar>>;

	interface Props {
		open: boolean;
		factura: FacturaLiquidacion | null;
		liquidaciones?: LiquidacionServicio[];
		puedeQuitar?: boolean;
		loading?: boolean;
		onclose?: () => void;
		onupdated?: (resultado: ResultadoEdicion) => void;
	}

	let {
		open,
		factura,
		liquidaciones = [],
		puedeQuitar = true,
		loading = false,
		onclose = () => {},
		onupdated = () => {}
	}: Props = $props();

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Number(v) || 0);

	let formularioFacturaId = $state('');
	let numeroFactura = $state('');
	let observaciones = $state('');
	let fechaEmision = $state('');
	let plazoDias = $state(30);
	let busqueda = $state('');
	let seleccionadas = $state<Set<string>>(new Set());
	let conservadas = $state<Set<string>>(new Set());
	let guardando = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open) {
			formularioFacturaId = '';
			return;
		}
		if (!factura || formularioFacturaId === factura.id) return;

		formularioFacturaId = factura.id;
		numeroFactura = factura.numero_factura;
		observaciones = factura.observaciones ?? '';
		fechaEmision =
			factura.fecha_emision?.slice(0, 10) ?? factura.fecha_facturacion?.slice(0, 10) ?? '';
		plazoDias = factura.plazo_dias ?? 30;
		seleccionadas = new Set();
		conservadas = new Set(factura.items.map((item) => item.liquidacion_id));
		busqueda = '';
		error = '';
	});

	const facturables = $derived.by(() => {
		if (!factura) return [];
		const idsActuales = new Set(factura.items.map((item) => item.liquidacion_id));
		return liquidaciones.filter(
			(liquidacion) =>
				!idsActuales.has(liquidacion.id) &&
				(liquidacion.estado === 'LIQUIDADA' || liquidacion.estado === 'APROBADA')
		);
	});

	const facturablesFiltradas = $derived.by(() => {
		const q = busqueda.trim().toLocaleLowerCase('es');
		if (!q) return facturables;
		return facturables.filter((liquidacion) => {
			const consecutivo = liquidacion.consecutivo.toLocaleLowerCase('es');
			const cliente = liquidacion.cliente?.nombre?.toLocaleLowerCase('es') ?? '';
			return consecutivo.includes(q) || cliente.includes(q);
		});
	});

	const totalNuevas = $derived(
		facturables
			.filter((liquidacion) => seleccionadas.has(liquidacion.id))
			.reduce((total, liquidacion) => total + Number(liquidacion.total || 0), 0)
	);
	const liquidacionesQuitadas = $derived(
		(factura?.items ?? []).filter((item) => !conservadas.has(item.liquidacion_id))
	);
	const totalQuitado = $derived(
		liquidacionesQuitadas.reduce((total, item) => total + Number(item.valor_liquidacion || 0), 0)
	);
	const plazoValido = $derived(
		Number.isInteger(Number(plazoDias)) && Number(plazoDias) >= 0 && Number(plazoDias) <= 365
	);
	const vencimiento = $derived(
		fechaEmision && plazoValido ? sumarDias(fechaEmision, Number(plazoDias)) : ''
	);

	function alternarSeleccion(id: string) {
		const siguiente = new Set(seleccionadas);
		if (siguiente.has(id)) siguiente.delete(id);
		else siguiente.add(id);
		seleccionadas = siguiente;
	}

	function alternarConservada(id: string) {
		const siguiente = new Set(conservadas);
		if (siguiente.has(id)) siguiente.delete(id);
		else siguiente.add(id);
		conservadas = siguiente;
	}

	function alternarTodas() {
		const idsVisibles = facturablesFiltradas.map((liquidacion) => liquidacion.id);
		const todasMarcadas =
			idsVisibles.length > 0 && idsVisibles.every((id) => seleccionadas.has(id));
		const siguiente = new Set(seleccionadas);
		for (const id of idsVisibles) {
			if (todasMarcadas) siguiente.delete(id);
			else siguiente.add(id);
		}
		seleccionadas = siguiente;
	}

	async function guardar() {
		error = '';
		if (!factura) return;
		if (!numeroFactura.trim()) {
			error = 'Ingrese el consecutivo de la factura.';
			return;
		}
		if (!fechaEmision) {
			error = 'Indique la fecha de emisión.';
			return;
		}
		if (!plazoValido) {
			error = 'El plazo debe ser un número entero entre 0 y 365 días.';
			return;
		}

		guardando = true;
		try {
			const resultado = await facturacionLiquidacionesAPI.editar(factura.id, {
				numero_factura: numeroFactura.trim(),
				observaciones: observaciones.trim() || null,
				fecha_emision: fechaEmision,
				plazo_dias: Number(plazoDias),
				liquidacion_ids: [...seleccionadas],
				quitar_liquidacion_ids: liquidacionesQuitadas.map((item) => item.liquidacion_id)
			});
			onupdated(resultado);
			onclose();
		} catch (err: any) {
			error = err.response?.data?.error || err.message || 'No se pudo guardar la factura.';
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	title="Editar factura"
	eyebrow="Facturación"
	subtitle="Actualiza los datos de emisión y ajusta las liquidaciones del lote."
	tamano="xl"
	bloqueado={guardando}
	cerrarAlFondo={!guardando}
	oncerrar={onclose}
>
	<div class="ef-body">
		{#if error}
			<div class="ef-error" role="alert">{error}</div>
		{/if}

		<div class="ef-grid">
			<label class="ef-field">
				<span>Consecutivo de la factura <b>*</b></span>
				<input bind:value={numeroFactura} maxlength="50" autocomplete="off" />
			</label>
			<label class="ef-field">
				<span>Fecha de emisión <b>*</b></span>
				<input type="date" bind:value={fechaEmision} />
			</label>
			<label class="ef-field">
				<span>Plazo (días) <b>*</b></span>
				<input type="number" min="0" max="365" step="1" bind:value={plazoDias} />
				<small>{vencimiento ? `Vence el ${fechaCorta(vencimiento)}` : 'Plazo inválido'}</small>
			</label>
			<label class="ef-field ef-notas">
				<span>Observaciones</span>
				<textarea bind:value={observaciones} rows="2" placeholder="Opcional"></textarea>
			</label>
		</div>

		<section class="ef-liquidaciones" aria-label="Liquidaciones incluidas en la factura">
			<div class="ef-section-head">
				<div>
					<h3>Liquidaciones del lote</h3>
					<p>
						Desmarca las que deben salir de esta factura; quedarán en estado aprobada.
						{#if !puedeQuitar} Solo Administración o Facturación pueden quitarlas.{/if}
					</p>
				</div>
				<span class="ef-count">{conservadas.size} incluidas</span>
			</div>
			{#if factura?.items.length}
				<div class="ef-table-wrap ef-current-table">
					<table>
						<thead>
							<tr>
								<th class="ef-check">Incluir</th>
								<th>Consecutivo</th>
								<th>Cliente</th>
								<th class="ef-right">Valor</th>
							</tr>
						</thead>
						<tbody>
							{#each factura.items as item (item.liquidacion_id)}
								<tr class:ef-removed={!conservadas.has(item.liquidacion_id)}>
									<td class="ef-check">
										<input
											type="checkbox"
											aria-label="Mantener {item.liquidacion?.consecutivo ?? 'liquidación'} en la factura"
											checked={conservadas.has(item.liquidacion_id)}
											disabled={!puedeQuitar}
											onchange={() => alternarConservada(item.liquidacion_id)}
										/>
									</td>
									<td class="ef-mono">{item.liquidacion?.consecutivo ?? 'Liquidación'}</td>
									<td>{item.liquidacion?.cliente?.nombre ?? '—'}</td>
									<td class="ef-right">{COP(item.valor_liquidacion)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if liquidacionesQuitadas.length > 0}
					<p class="ef-removal-note">
						{liquidacionesQuitadas.length} liquidación(es) saldrán del lote y volverán a APROBADA · {COP(totalQuitado)}
					</p>
				{/if}
			{:else}
				<p class="ef-empty">La factura no tiene liquidaciones asociadas.</p>
			{/if}
		</section>

		<section class="ef-liquidaciones" aria-label="Agregar liquidaciones">
			<div class="ef-section-head">
				<div>
					<h3>Agregar liquidaciones</h3>
					<p>
						La factura ya incluye {factura?.items.length ?? 0} liquidaciones; las seleccionadas se sumarán
						al lote.
					</p>
				</div>
				<span class="ef-count">{seleccionadas.size} nuevas</span>
			</div>

			<div class="ef-search-row">
				<input bind:value={busqueda} placeholder="Buscar por consecutivo o cliente" />
				{#if seleccionadas.size > 0}
					<span>{COP(totalNuevas)} por agregar</span>
				{/if}
			</div>

			{#if loading}
				<p class="ef-empty">Cargando liquidaciones disponibles…</p>
			{:else if facturablesFiltradas.length === 0}
				<p class="ef-empty">No hay más liquidaciones aprobadas o liquidadas para agregar.</p>
			{:else}
				<div class="ef-table-wrap">
					<table>
						<thead>
							<tr>
								<th class="ef-check">
									<input
										type="checkbox"
										aria-label="Seleccionar las liquidaciones visibles"
										checked={facturablesFiltradas.length > 0 &&
											facturablesFiltradas.every((item) => seleccionadas.has(item.id))}
										onchange={alternarTodas}
									/>
								</th>
								<th>Consecutivo</th>
								<th>Cliente</th>
								<th>Periodo</th>
								<th>Estado</th>
								<th class="ef-right">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each facturablesFiltradas as liquidacion (liquidacion.id)}
								<tr class:ef-selected={seleccionadas.has(liquidacion.id)}>
									<td class="ef-check">
										<input
											type="checkbox"
											checked={seleccionadas.has(liquidacion.id)}
											onchange={() => alternarSeleccion(liquidacion.id)}
										/>
									</td>
									<td class="ef-mono">{liquidacion.consecutivo}</td>
									<td>{liquidacion.cliente?.nombre || '—'}</td>
									<td>{liquidacion.mes}/{liquidacion.anio}</td>
									<td>{liquidacion.estado === 'APROBADA' ? 'Aprobada' : 'Liquidada'}</td>
									<td class="ef-right">{COP(liquidacion.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={onclose} disabled={guardando}
			>Cancelar</button
		>
		<button
			type="button"
			class="btn-primary"
			onclick={guardar}
			disabled={guardando || !numeroFactura.trim() || !fechaEmision || !plazoValido}
		>
			{guardando ? 'Guardando…' : 'Guardar cambios'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ef-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.ef-error {
		padding: 10px 14px;
		border: 1px solid #fecaca;
		border-radius: 12px;
		background: #fef2f2;
		color: #b91c1c;
		font-size: 13px;
	}
	.ef-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.ef-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
	}
	.ef-field b {
		color: #dc2626;
	}
	.ef-field input,
	.ef-field textarea,
	.ef-search-row input {
		width: 100%;
		min-height: 42px;
		box-sizing: border-box;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	.ef-field textarea {
		resize: vertical;
		font-family: inherit;
	}
	.ef-field input:focus,
	.ef-field textarea:focus,
	.ef-search-row input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ef-field small {
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 500;
	}
	.ef-notas {
		grid-column: 1 / -1;
	}
	.ef-liquidaciones {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 0;
	}
	.ef-section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.ef-section-head h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 750;
	}
	.ef-section-head p {
		margin: 3px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}
	.ef-count {
		flex: none;
		padding: 6px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accion) 12%, transparent);
		color: var(--accion);
		font-size: 12px;
		font-weight: 700;
	}
	.ef-search-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.ef-search-row input {
		flex: 1;
	}
	.ef-search-row span {
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
	}
	.ef-table-wrap {
		max-height: 300px;
		overflow: auto;
		border: 1px solid var(--border-default);
		border-radius: 14px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	thead {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg-surface);
	}
	th,
	td {
		padding: 9px 10px;
		border-bottom: 1px solid var(--border-default);
		text-align: left;
		white-space: nowrap;
	}
	th {
		color: var(--text-muted);
		font-size: 10px;
		font-weight: 750;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	td {
		color: var(--text-secondary);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	tbody tr.ef-selected {
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}
	tbody tr.ef-removed {
		background: color-mix(in srgb, #ef4444 7%, var(--bg-surface));
	}
	.ef-check {
		width: 32px;
		text-align: center;
	}
	.ef-check input {
		accent-color: var(--accion);
	}
	.ef-mono {
		color: var(--text-primary);
		font-family: var(--font-mono);
		font-weight: 700;
	}
	.ef-right {
		text-align: right;
	}
	.ef-empty {
		margin: 0;
		padding: 20px;
		border: 1px dashed var(--border-default);
		border-radius: 14px;
		color: var(--text-muted);
		font-size: 13px;
		text-align: center;
	}
	.ef-removal-note {
		margin: 0;
		color: #b91c1c;
		font-size: 12px;
		font-weight: 650;
	}
	@media (max-width: 720px) {
		.ef-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.ef-notas {
			grid-column: 1 / -1;
		}
		.ef-search-row {
			align-items: stretch;
			flex-direction: column;
		}
		.ef-search-row span {
			align-self: flex-end;
		}
	}
	@media (max-width: 480px) {
		.ef-grid {
			grid-template-columns: 1fr;
		}
		.ef-notas {
			grid-column: auto;
		}
	}
</style>
