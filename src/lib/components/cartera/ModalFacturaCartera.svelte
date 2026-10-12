<script lang="ts">
	/**
	 * Una factura vista desde cartera: su saldo, sus condiciones de cobro, sus
	 * abonos y el formulario para registrar uno nuevo.
	 *
	 * El formulario vive DENTRO de este modal (modo «abonar») en vez de abrir
	 * otro encima: dos `ModalBase` apilados comparten z-index y Escape cerraría
	 * el de abajo. La acción rápida «Registrar abono» de la tabla abre este
	 * mismo modal directamente en ese modo.
	 *
	 * Todo número que se muestra sale del backend (saldo, estado, tramo): aquí
	 * no se recalcula nada, para que la tabla y el detalle no puedan discrepar.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { FileText, Pencil, Plus, Trash2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import { pedirTexto } from '$lib/stores/confirm';
	import { comprimirImagen } from '$lib/api/viaticos';
	import {
		carteraAPI,
		ESTADO_CARTERA,
		ETIQUETA_TRAMO,
		mensajeError,
		type DetalleFacturaCartera
	} from '$lib/api/cartera';
	import {
		ETIQUETA_MEDIO,
		MEDIOS_PAGO,
		fechaCorta,
		hoyColombia,
		pesos,
		sumarDias
	} from '$lib/pagos/medios';

	interface Props {
		open: boolean;
		facturaId: string | null;
		/** `cartera` en full: registrar y retirar abonos, corregir condiciones. */
		puedeEditar?: boolean;
		modoInicial?: 'detalle' | 'abonar';
		oncerrar: () => void;
		/** Algo cambió (abono, retiro, condiciones): el padre recarga su lista. */
		oncambio?: () => void;
	}

	let {
		open,
		facturaId,
		puedeEditar = false,
		modoInicial = 'detalle',
		oncerrar,
		oncambio
	}: Props = $props();

	let datos = $state<DetalleFacturaCartera | null>(null);
	let cargando = $state(false);
	let error = $state<string | null>(null);
	let modo = $state<'detalle' | 'abonar' | 'condiciones'>('detalle');
	let enviando = $state(false);

	// ── Formulario de abono ──
	let fecha = $state(hoyColombia());
	let valor = $state<number | null>(null);
	let retefuente = $state<number | null>(null);
	let reteica = $state<number | null>(null);
	let reteiva = $state<number | null>(null);
	let otros = $state<number | null>(null);
	let medio = $state<string>('TRANSFERENCIA');
	let referencia = $state('');
	let observaciones = $state('');
	let comprobante = $state<File | null>(null);
	let verRetenciones = $state(false);

	// ── Formulario de condiciones ──
	let cValor = $state<number | null>(null);
	let cEmision = $state('');
	let cPlazo = $state<number | null>(30);

	const factura = $derived(datos?.factura ?? null);
	const n = (v: number | null) => (Number.isFinite(Number(v)) ? Number(v) : 0);
	/// En centavos, como el backend: «pagar el saldo» debe cuadrar exacto.
	const aplicaC = $derived(
		Math.round(n(valor) * 100) +
			Math.round(n(retefuente) * 100) +
			Math.round(n(reteica) * 100) +
			Math.round(n(reteiva) * 100) +
			Math.round(n(otros) * 100)
	);
	const saldoC = $derived(Math.round((factura?.saldo ?? 0) * 100));
	const saldoDespues = $derived((saldoC - aplicaC) / 100);
	const abonoValido = $derived(
		aplicaC > 0 && aplicaC <= saldoC && !!fecha && !!medio && n(valor) >= 0
	);

	async function cargar(id: string) {
		cargando = true;
		error = null;
		try {
			datos = await carteraAPI.detalle(id);
		} catch (e) {
			error = mensajeError(e, 'No se pudo abrir la factura');
		} finally {
			cargando = false;
		}
	}

	function limpiarAbono() {
		fecha = hoyColombia();
		valor = null;
		retefuente = reteica = reteiva = otros = null;
		medio = 'TRANSFERENCIA';
		referencia = '';
		observaciones = '';
		comprobante = null;
		verRetenciones = false;
	}

	/// Al abrir (o cambiar de factura) se recarga y se arranca en el modo pedido.
	$effect(() => {
		if (!open || !facturaId) return;
		const id = facturaId;
		untrack(() => {
			datos = null;
			modo = modoInicial;
			limpiarAbono();
			void cargar(id);
		});
	});

	/// Lo que falta, después de las retenciones digitadas, va al valor recibido.
	function pagarSaldo() {
		const ret =
			Math.round(n(retefuente) * 100) +
			Math.round(n(reteica) * 100) +
			Math.round(n(reteiva) * 100) +
			Math.round(n(otros) * 100);
		valor = Math.max(saldoC - ret, 0) / 100;
	}

	async function guardarAbono() {
		if (!factura || !abonoValido || enviando) return;
		enviando = true;
		try {
			const archivo = comprobante ? await comprimirImagen(comprobante) : null;
			datos = await carteraAPI.registrarAbono(factura.id, {
				fecha,
				valor: n(valor),
				retefuente: n(retefuente),
				reteica: n(reteica),
				reteiva: n(reteiva),
				otros_descuentos: n(otros),
				medio,
				referencia: referencia.trim() || null,
				observaciones: observaciones.trim() || null,
				comprobante: archivo
			});
			toast.success(
				datos.factura.estado === 'pagada'
					? `Factura ${datos.factura.numero_factura} pagada`
					: `Abono registrado. Saldo: ${pesos(datos.factura.saldo)}`
			);
			limpiarAbono();
			modo = 'detalle';
			oncambio?.();
		} catch (e) {
			toast.error(mensajeError(e, 'No se pudo registrar el abono'));
		} finally {
			enviando = false;
		}
	}

	async function retirarAbono(abonoId: string) {
		const motivo = await pedirTexto({
			title: '¿Retirar este abono?',
			message:
				'El saldo de la factura vuelve a subir. El abono no se borra: queda archivado con el motivo.',
			tone: 'danger',
			confirmText: 'Retirar abono',
			label: 'Motivo',
			placeholder: 'Ej. consignación registrada dos veces'
		});
		if (motivo === null) return;
		try {
			datos = await carteraAPI.eliminarAbono(abonoId, motivo);
			toast.success('Abono retirado');
			oncambio?.();
		} catch (e) {
			toast.error(mensajeError(e, 'No se pudo retirar el abono'));
		}
	}

	async function verComprobante(abonoId: string) {
		/// La pestaña se abre ANTES del await: abierta después, el navegador la
		/// trata como ventana emergente y la bloquea.
		const ventana = window.open('', '_blank');
		try {
			const url = await carteraAPI.urlComprobante(abonoId);
			if (ventana) ventana.location.href = url;
			else window.open(url, '_blank');
		} catch (e) {
			ventana?.close();
			toast.error(mensajeError(e, 'No se pudo abrir el comprobante'));
		}
	}

	function editarCondiciones() {
		if (!factura) return;
		cValor = factura.valor;
		cEmision = factura.fecha_emision;
		cPlazo = factura.plazo_dias;
		modo = 'condiciones';
	}

	const cVence = $derived(
		cEmision && Number.isInteger(Number(cPlazo)) && n(cPlazo) >= 0 && n(cPlazo) <= 365
			? sumarDias(cEmision, n(cPlazo))
			: ''
	);

	async function guardarCondiciones() {
		if (!factura || enviando) return;
		enviando = true;
		try {
			datos = await carteraAPI.actualizarCondiciones(factura.id, {
				valor_total: cValor,
				fecha_emision: cEmision,
				plazo_dias: cPlazo
			});
			toast.success('Condiciones actualizadas');
			modo = 'detalle';
			oncambio?.();
		} catch (e) {
			toast.error(mensajeError(e, 'No se pudieron guardar las condiciones'));
		} finally {
			enviando = false;
		}
	}

	function textoVencimiento(f: NonNullable<typeof factura>): string {
		if (f.estado === 'pagada') return 'Pagada';
		if (f.dias_vencida > 0)
			return `Vencida hace ${f.dias_vencida} día${f.dias_vencida === 1 ? '' : 's'}`;
		return 'Al día';
	}
</script>

<ModalBase
	{open}
	title={factura ? `Factura ${factura.numero_factura}` : 'Factura'}
	eyebrow="Cartera"
	subtitle={factura?.cliente?.nombre ?? null}
	tamano="lg"
	bloqueado={enviando}
	cerrarAlFondo={!enviando && modo === 'detalle'}
	{oncerrar}
>
	{#if cargando && !datos}
		<CargaMascota texto="Abriendo la factura…" />
	{:else if error}
		<p class="mfc-error">{error}</p>
	{:else if factura && datos}
		<!-- Cifras: lo primero que se busca al abrir una factura en cobro. -->
		<div class="mfc-cifras">
			<div>
				<span>Valor</span>
				<strong>{pesos(factura.valor)}</strong>
			</div>
			<div>
				<span>Abonado</span>
				<strong>{pesos(factura.recibido)}</strong>
				{#if factura.retenciones > 0}<small>+ {pesos(factura.retenciones)} en retenciones</small
					>{/if}
			</div>
			<div class="mfc-saldo" style="--c:{ESTADO_CARTERA[factura.estado].color}">
				<span>Saldo</span>
				<strong>{pesos(factura.saldo)}</strong>
				<small>
					<EstadoPunto
						etiqueta={ESTADO_CARTERA[factura.estado].etiqueta}
						color={ESTADO_CARTERA[factura.estado].color}
					/>
				</small>
			</div>
		</div>

		{#if factura.estado_factura === 'ANULADA'}
			<p class="mfc-aviso">Factura anulada: no se cobra y no admite abonos.</p>
		{/if}

		{#if modo === 'abonar'}
			<form
				class="mfc-form"
				onsubmit={(e) => {
					e.preventDefault();
					void guardarAbono();
				}}
			>
				<h3 class="mfc-subtitulo">Registrar abono</h3>
				<div class="mfc-rejilla">
					<label class="mfc-campo">
						<span>Fecha del pago <b>*</b></span>
						<input type="date" bind:value={fecha} max={hoyColombia()} required />
					</label>
					<label class="mfc-campo">
						<span>Valor recibido</span>
						<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={valor} />
						<button type="button" class="mfc-link" onclick={pagarSaldo}>Pagar el saldo</button>
					</label>
					<label class="mfc-campo">
						<span>Medio <b>*</b></span>
						<select bind:value={medio}>
							{#each MEDIOS_PAGO as m (m)}
								<option value={m}>{ETIQUETA_MEDIO[m]}</option>
							{/each}
						</select>
					</label>
					<label class="mfc-campo">
						<span>Referencia</span>
						<input
							type="text"
							maxlength="120"
							bind:value={referencia}
							placeholder="N° de transacción, cheque…"
						/>
					</label>
				</div>

				<button type="button" class="mfc-link" onclick={() => (verRetenciones = !verRetenciones)}>
					{verRetenciones ? 'Ocultar' : 'Agregar'} retenciones y descuentos del cliente
				</button>
				{#if verRetenciones}
					<div class="mfc-rejilla">
						<label class="mfc-campo">
							<span>Retefuente</span>
							<input
								type="number"
								min="0"
								step="0.01"
								inputmode="decimal"
								bind:value={retefuente}
							/>
						</label>
						<label class="mfc-campo">
							<span>ReteICA</span>
							<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={reteica} />
						</label>
						<label class="mfc-campo">
							<span>ReteIVA</span>
							<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={reteiva} />
						</label>
						<label class="mfc-campo">
							<span>Otros descuentos</span>
							<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={otros} />
						</label>
					</div>
				{/if}

				<div class="mfc-rejilla">
					<label class="mfc-campo">
						<span>Comprobante (PDF o imagen, opcional)</span>
						<input
							type="file"
							accept="application/pdf,image/png,image/jpeg,image/webp"
							onchange={(e) =>
								(comprobante = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
						/>
					</label>
					<label class="mfc-campo">
						<span>Observaciones</span>
						<input type="text" maxlength="2000" bind:value={observaciones} />
					</label>
				</div>

				<div class="mfc-balance" class:mfc-balance--error={aplicaC > saldoC}>
					<span>Aplica {pesos(aplicaC / 100)}</span>
					<span>
						{#if aplicaC > saldoC}
							Supera el saldo en {pesos((aplicaC - saldoC) / 100)}
						{:else}
							Saldo después: {pesos(saldoDespues)}
						{/if}
					</span>
				</div>
			</form>
		{:else if modo === 'condiciones'}
			<form
				class="mfc-form"
				onsubmit={(e) => {
					e.preventDefault();
					void guardarCondiciones();
				}}
			>
				<h3 class="mfc-subtitulo">Condiciones de cobro</h3>
				<div class="mfc-rejilla">
					<label class="mfc-campo">
						<span>Valor de la factura</span>
						<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={cValor} />
						<small>Liquidaciones: {pesos(factura.suma_liquidaciones)}</small>
					</label>
					<label class="mfc-campo">
						<span>Fecha de emisión</span>
						<input type="date" bind:value={cEmision} required />
					</label>
					<label class="mfc-campo">
						<span>Plazo (días)</span>
						<input type="number" min="0" max="365" step="1" bind:value={cPlazo} />
						<small>{cVence ? `Vence el ${fechaCorta(cVence)}` : 'Plazo inválido'}</small>
					</label>
				</div>
			</form>
		{:else}
			<section class="mfc-seccion">
				<div class="mfc-seccion-cab">
					<h3 class="mfc-subtitulo">Condiciones</h3>
					{#if puedeEditar && factura.estado_factura === 'ACTIVA'}
						<button type="button" class="btn-secondary mfc-btn" onclick={editarCondiciones}>
							<Pencil size={14} /> Corregir
						</button>
					{/if}
				</div>
				<dl class="mfc-datos">
					<div>
						<dt>Emisión</dt>
						<dd>{fechaCorta(factura.fecha_emision)}</dd>
					</div>
					<div>
						<dt>Plazo</dt>
						<dd>{factura.plazo_dias} días</dd>
					</div>
					<div>
						<dt>Vence</dt>
						<dd>
							{fechaCorta(factura.fecha_vencimiento)}
							<small style="color:{ESTADO_CARTERA[factura.estado].color}">
								· {textoVencimiento(factura)}{factura.tramo && factura.tramo !== 'corriente'
									? ` (${ETIQUETA_TRAMO[factura.tramo]})`
									: ''}
							</small>
						</dd>
					</div>
					<div>
						<dt>Liquidaciones</dt>
						<dd>
							{pesos(factura.suma_liquidaciones)}
							{#if factura.ajuste_valor !== 0}
								<small>
									· ajuste {factura.ajuste_valor > 0 ? '+' : '−'}{pesos(
										Math.abs(factura.ajuste_valor)
									)}
								</small>
							{/if}
						</dd>
					</div>
					<div>
						<dt>Registrada por</dt>
						<dd>{factura.facturado_por?.nombre ?? '—'}</dd>
					</div>
				</dl>
			</section>

			<section class="mfc-seccion">
				<div class="mfc-seccion-cab">
					<h3 class="mfc-subtitulo">Abonos ({datos.abonos.length})</h3>
					{#if puedeEditar && factura.estado_factura === 'ACTIVA' && factura.saldo > 0}
						<button type="button" class="btn-primary mfc-btn" onclick={() => (modo = 'abonar')}>
							<Plus size={14} /> Registrar abono
						</button>
					{/if}
				</div>
				{#if datos.abonos.length === 0}
					<p class="mfc-vacio">Todavía no se ha registrado ningún pago de esta factura.</p>
				{:else}
					<div class="mfc-tabla-scroll">
						<table class="mfc-tabla">
							<thead>
								<tr>
									<th>Fecha</th>
									<th>Medio</th>
									<th class="num">Recibido</th>
									<th class="num">Retenciones</th>
									<th class="num">Aplica</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each datos.abonos as a (a.id)}
									{@const ret = a.retefuente + a.reteica + a.reteiva + a.otros_descuentos}
									<tr>
										<td class="nowrap">{fechaCorta(a.fecha)}</td>
										<td>
											<div class="mfc-celda">
												<span>{ETIQUETA_MEDIO[a.medio] ?? a.medio}</span>
												{#if a.referencia}<small>{a.referencia}</small>{/if}
												{#if a.observaciones}<small title={a.observaciones}>{a.observaciones}</small
													>{/if}
											</div>
										</td>
										<td class="num">{pesos(a.valor)}</td>
										<td
											class="num"
											title={ret
												? `Retefuente ${pesos(a.retefuente)} · ReteICA ${pesos(a.reteica)} · ReteIVA ${pesos(a.reteiva)} · Otros ${pesos(a.otros_descuentos)}`
												: ''}
										>
											{ret ? pesos(ret) : '—'}
										</td>
										<td class="num fuerte">{pesos(a.aplicado)}</td>
										<td class="acciones">
											{#if a.tiene_comprobante}
												<button
													type="button"
													class="mfc-icono"
													title="Ver comprobante"
													aria-label="Ver comprobante del abono del {fechaCorta(a.fecha)}"
													onclick={() => verComprobante(a.id)}
												>
													<FileText size={15} />
												</button>
											{/if}
											{#if puedeEditar}
												<button
													type="button"
													class="mfc-icono mfc-icono--peligro"
													title="Retirar abono"
													aria-label="Retirar el abono del {fechaCorta(a.fecha)}"
													onclick={() => retirarAbono(a.id)}
												>
													<Trash2 size={15} />
												</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>

			<section class="mfc-seccion">
				<h3 class="mfc-subtitulo">Liquidaciones facturadas ({factura.items.length})</h3>
				<div class="mfc-chips">
					{#each factura.items as it (it.liquidacion_id)}
						<span class="mfc-chip" title="{it.mes}/{it.anio} · {pesos(it.valor)}"
							>{it.consecutivo}</span
						>
					{/each}
				</div>
			</section>
		{/if}
	{/if}

	{#snippet pie()}
		{#if modo === 'abonar'}
			<button
				class="btn-secondary"
				onclick={() => (modoInicial === 'abonar' ? oncerrar() : (modo = 'detalle'))}
				disabled={enviando}
			>
				Cancelar
			</button>
			<button class="btn-primary" onclick={guardarAbono} disabled={!abonoValido || enviando}>
				{enviando ? 'Guardando…' : 'Registrar abono'}
			</button>
		{:else if modo === 'condiciones'}
			<button class="btn-secondary" onclick={() => (modo = 'detalle')} disabled={enviando}>
				Cancelar
			</button>
			<button
				class="btn-primary"
				onclick={guardarCondiciones}
				disabled={enviando || !cVence || !cEmision}
			>
				{enviando ? 'Guardando…' : 'Guardar'}
			</button>
		{:else}
			<button class="btn-secondary" onclick={oncerrar}>Cerrar</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.mfc-error {
		color: #b91c1c;
		font-size: 0.85rem;
	}
	.mfc-aviso {
		margin: 0 0 0.75rem;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: #fef2f2;
		color: #991b1b;
		font-size: 0.82rem;
	}
	.mfc-cifras {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.mfc-cifras > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.75rem 0.9rem;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
	}
	.mfc-cifras span {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.mfc-cifras strong {
		font-size: 1.15rem;
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.mfc-cifras small {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.mfc-saldo {
		border-color: color-mix(in srgb, var(--c) 45%, transparent) !important;
	}
	.mfc-seccion {
		margin-bottom: 1.1rem;
	}
	.mfc-seccion-cab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.mfc-subtitulo {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.mfc-seccion-cab .mfc-subtitulo {
		margin: 0;
	}
	.mfc-btn {
		padding: 0.35rem 0.75rem;
		font-size: 0.78rem;
		gap: 0.3rem;
	}
	.mfc-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.5rem 1rem;
		margin: 0;
	}
	.mfc-datos dt {
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.mfc-datos dd {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.mfc-datos small {
		font-weight: 600;
	}
	.mfc-vacio {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0;
	}
	.mfc-tabla-scroll {
		overflow-x: auto;
	}
	.mfc-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}
	.mfc-tabla th {
		text-align: left;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border-default);
	}
	.mfc-tabla td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-subtle, var(--border-default));
		vertical-align: top;
	}
	.mfc-tabla .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.mfc-tabla .fuerte {
		font-weight: 700;
	}
	.mfc-tabla .nowrap {
		white-space: nowrap;
	}
	.mfc-tabla .acciones {
		text-align: right;
		white-space: nowrap;
	}
	.mfc-celda {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.mfc-celda small {
		font-size: 0.74rem;
		color: var(--text-muted);
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mfc-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.mfc-icono:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.mfc-icono--peligro:hover {
		color: #dc2626;
	}
	.mfc-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.mfc-chip {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.mfc-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.mfc-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.75rem;
	}
	.mfc-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mfc-campo b {
		color: #dc2626;
	}
	.mfc-campo input,
	.mfc-campo select {
		min-height: 40px;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		font-weight: 500;
	}
	.mfc-campo input[type='file'] {
		padding: 0.4rem;
	}
	.mfc-campo input:focus,
	.mfc-campo select:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mfc-campo small {
		font-weight: 500;
		color: var(--text-muted);
	}
	.mfc-link {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--accion);
		cursor: pointer;
	}
	.mfc-balance {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		border-radius: 10px;
		background: var(--bg-base);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.mfc-balance--error {
		background: #fef2f2;
		color: #b91c1c;
	}
</style>
