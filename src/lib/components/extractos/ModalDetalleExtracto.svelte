<script lang="ts">
	/**
	 * Detalle de un extracto emitido: lo impreso, su estado, el QR y las
	 * acciones (descargar el PDF, reemplazarlo o anularlo). No se edita nada:
	 * el documento ya salió firmado.
	 */
	import { untrack } from 'svelte';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import { Download, ExternalLink, RefreshCw, XCircle } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import {
		ESTADO_COLORES,
		ESTADO_LABELS,
		conPuntos,
		extractosAPI,
		fechaLarga,
		urlPublicaExtracto,
		type Extracto
	} from '$lib/api/extractos';

	interface Props {
		open: boolean;
		extracto: Extracto | null;
		puedeEscribir: boolean;
		oncerrar: () => void;
		ondescargar: (e: Extracto) => Promise<void>;
		onreemplazar: (e: Extracto) => void;
		onanulado: (e: Extracto) => void;
	}
	let { open, extracto, puedeEscribir, oncerrar, ondescargar, onreemplazar, onanulado }: Props =
		$props();

	let qr = $state<string | null>(null);
	let descargando = $state(false);
	let anulando = $state(false);
	let motivo = $state('');
	let mostrarAnular = $state(false);

	$effect(() => {
		const codigo = extracto?.codigo_verificacion ?? null;
		if (!open) return;
		untrack(() => {
			mostrarAnular = false;
			motivo = '';
			qr = null;
		});
		if (!codigo) return;
		QRCode.toDataURL(urlPublicaExtracto(codigo), { margin: 1, width: 180 })
			.then((d) => (qr = d))
			.catch(() => (qr = null));
	});

	async function descargar() {
		if (!extracto || descargando) return;
		descargando = true;
		try {
			await ondescargar(extracto);
		} finally {
			descargando = false;
		}
	}

	async function anular() {
		if (!extracto || motivo.trim().length < 5 || anulando) return;
		anulando = true;
		try {
			const r = await extractosAPI.anular(extracto.id, motivo.trim());
			toast.success(`Extracto ${r.consecutivo} anulado`);
			onanulado(r);
			mostrarAnular = false;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo anular');
		} finally {
			anulando = false;
		}
	}
	const puedeAnular = $derived(!!extracto && puedeEscribir && !extracto.anulado_at);
</script>

<ModalBase
	{open}
	title={extracto ? `Extracto ${extracto.consecutivo}` : 'Extracto'}
	eyebrow="FUEC · OP-FR-04"
	subtitle={extracto?.numero_completo ?? null}
	tamano="lg"
	{oncerrar}
>
	{#snippet accionesCabecera()}
		{#if extracto}
			<EstadoPunto
				etiqueta={ESTADO_LABELS[extracto.estado]}
				color={ESTADO_COLORES[extracto.estado]}
			/>
		{/if}
	{/snippet}

	{#if extracto}
		{@const e = extracto}
		<div class="dx">
			{#if e.anulado_at}
				<div class="dx-aviso dx-aviso--rojo">
					<strong>Anulado</strong> el {fechaLarga(e.anulado_at)}{e.anulado_por
						? ` por ${e.anulado_por.nombre}`
						: ''}{e.motivo_anulacion ? `: ${e.motivo_anulacion}` : ''}.
					{#if e.reemplazado_por.length}
						Lo reemplaza el <strong>{e.reemplazado_por[0].numero_completo}</strong>.
					{/if}
				</div>
			{:else if e.estado === 'VENCIDO'}
				<div class="dx-aviso">
					Venció el {fechaLarga(e.vigencia_hasta)}. Para seguir operando se emite uno nuevo.
				</div>
			{/if}
			{#if e.reemplaza_a}
				<div class="dx-aviso dx-aviso--gris">
					Reemplaza al extracto {e.reemplaza_a.consecutivo} ({e.reemplaza_a.numero_completo}).
				</div>
			{/if}

			<div class="dx-cols">
				<dl class="dx-datos">
					<div class="dx-ancho">
						<dt>Contratante</dt>
						<dd>
							<strong>{e.contratante_nombre ?? '—'}</strong>{e.contratante_nit
								? ` · NIT ${conPuntos(e.contratante_nit)}`
								: ''} · contrato {e.contrato_numero ?? '—'}
						</dd>
					</div>
					<div class="dx-ancho">
						<dt>Objeto</dt>
						<dd>{e.objeto_contrato ?? '—'}</dd>
					</div>
					<div class="dx-ancho">
						<dt>Origen - destino</dt>
						<dd>{e.origen_destino ?? '—'}</dd>
					</div>
					<div>
						<dt>Convenio</dt>
						<dd>{e.convenio ?? 'N/A'}</dd>
					</div>
					<div>
						<dt>Vigencia</dt>
						<dd>{fechaLarga(e.vigencia_desde)} → {fechaLarga(e.vigencia_hasta)}</dd>
					</div>
					<div>
						<dt>Vehículo</dt>
						<dd>
							<strong>{e.placa ?? '—'}</strong> · {[e.marca, e.modelo, e.clase]
								.filter(Boolean)
								.join(' ') || 'sin datos'}
						</dd>
					</div>
					<div>
						<dt>Interno · tarjeta</dt>
						<dd>{e.numero_interno ?? '—'} · {e.tarjeta_operacion ?? '—'}</dd>
					</div>
					<div class="dx-ancho">
						<dt>Conductores</dt>
						<dd>
							{#each e.conductores as c (c.id)}
								<div>
									{c.nombre}{c.cedula ? ` · ${conPuntos(c.cedula)}` : ''}{c.licencia_vigencia
										? ` · licencia hasta ${fechaLarga(c.licencia_vigencia)}`
										: ''}
								</div>
							{:else}
								—
							{/each}
						</dd>
					</div>
					<div class="dx-ancho">
						<dt>Responsable del contratante</dt>
						<dd>
							{e.responsable.nombre ?? '—'}{e.responsable.cedula
								? ` · ${conPuntos(e.responsable.cedula)}`
								: ''}{e.responsable.telefono ? ` · ${e.responsable.telefono}` : ''}{e.responsable
								.direccion
								? ` · ${e.responsable.direccion}`
								: ''}
						</dd>
					</div>
					<div>
						<dt>Emitido</dt>
						<dd>
							{fechaLarga(e.emitido_at)}{e.creado_por
								? ` por ${e.creado_por.nombre}`
								: ''}{e.source === 'XLSM' ? ' · importado del libro' : ''}
						</dd>
					</div>
					<div>
						<dt>Firma</dt>
						<dd>{e.firmado ? `HMAC-SHA512 · huella ${e.huella}` : 'Sin firma (importado)'}</dd>
					</div>
				</dl>
				<div class="dx-qr">
					{#if qr && e.codigo_verificacion}
						<img src={qr} alt="QR de validación" width="150" height="150" />
						<code>{e.codigo_verificacion}</code>
						<a href={urlPublicaExtracto(e.codigo_verificacion)} target="_blank" rel="noopener"
							><ExternalLink size={13} /> Página de validación</a
						>
					{:else}
						<p>Sin QR: este extracto se importó del libro de Excel y no lo firmó el sistema.</p>
					{/if}
				</div>
			</div>

			{#if mostrarAnular}
				<div class="dx-anular">
					<label for="dx-motivo">Motivo de la anulación</label>
					<textarea
						id="dx-motivo"
						rows="2"
						bind:value={motivo}
						maxlength="500"
						placeholder="Por qué se anula (mínimo 5 letras)"
					></textarea>
					<div>
						<button
							type="button"
							class="btn-secondary"
							onclick={() => (mostrarAnular = false)}
							disabled={anulando}>Cancelar</button
						>
						<button
							type="button"
							class="btn-danger"
							onclick={anular}
							disabled={motivo.trim().length < 5 || anulando}
							>{anulando ? 'Anulando…' : 'Confirmar anulación'}</button
						>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet pie()}
		{#if extracto}
			{#if puedeAnular && !mostrarAnular}
				<button
					type="button"
					class="btn-secondary dx-peligro"
					onclick={() => (mostrarAnular = true)}><XCircle size={15} /> Anular</button
				>
			{/if}
			{#if puedeEscribir}
				<button type="button" class="btn-secondary" onclick={() => onreemplazar(extracto)}
					><RefreshCw size={15} /> {extracto.anulado_at ? 'Emitir uno igual' : 'Reemplazar'}</button
				>
			{/if}
			<button type="button" class="btn-primary" onclick={descargar} disabled={descargando}
				><Download size={15} /> {descargando ? 'Generando…' : 'Descargar PDF'}</button
			>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.dx {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.dx-aviso {
		padding: 0.55rem 0.8rem;
		border-radius: 10px;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.84rem;
	}
	.dx-aviso--rojo {
		background: #fee2e2;
		color: #991b1b;
	}
	.dx-aviso--gris {
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.dx-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 170px;
		gap: 16px;
	}
	@media (max-width: 640px) {
		.dx-cols {
			grid-template-columns: 1fr;
		}
	}
	.dx-datos {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 14px;
	}
	.dx-ancho {
		grid-column: span 2;
	}
	.dx-datos dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.dx-datos dd {
		margin: 0;
		font-size: 0.86rem;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.dx-qr {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 10px;
		border-radius: 12px;
		background: var(--bg-base);
		text-align: center;
	}
	.dx-qr img {
		border-radius: 8px;
		background: #fff;
	}
	.dx-qr code {
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.08em;
	}
	.dx-qr a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.76rem;
		color: var(--au-dark);
	}
	.dx-qr p {
		margin: 0;
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.dx-anular {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border: 1.5px solid #fecaca;
		border-radius: 12px;
		background: #fff5f5;
	}
	.dx-anular label {
		font-size: 0.78rem;
		font-weight: 700;
		color: #991b1b;
	}
	.dx-anular textarea {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		font: inherit;
		font-size: 0.86rem;
	}
	.dx-anular > div {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.dx-peligro {
		color: #b91c1c;
	}
</style>
