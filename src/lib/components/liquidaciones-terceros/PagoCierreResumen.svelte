<script lang="ts">
	/**
	 * Cómo se le pagó al propietario un cierre PAGADA: una pastilla con la
	 * fecha y el medio, que abre el detalle (referencia, soporte, quién lo
	 * registró y los pagos archivados).
	 *
	 * Los PAGADA anteriores a este registro no tienen datos: se dicen «sin
	 * registro» y Administración los puede completar desde aquí mismo.
	 *
	 * Vive en barras oscuras (toolbar del canvas, barra del visor del cierre),
	 * por eso la pastilla es clara sobre fondo translúcido.
	 */
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import CamposPagoCierre from './CamposPagoCierre.svelte';
	import {
		armarPago,
		liquidacionesTercerosPagosAPI,
		pagoCompleto,
		type FormPago,
		type PagoDeCierre
	} from '$lib/api/liquidacionesTercerosPagos';
	import { esAdmin } from '$lib/editor/builders/cierres-finales-estado';
	import { ETIQUETA_MEDIO, fechaCorta, hoyColombia, pesos } from '$lib/pagos/medios';

	interface Props {
		cierreId: string;
		/** Estado del cierre: solo se consulta si está PAGADA (o la heredada FACTURADA). */
		estado: string;
		areas: string | string[] | null | undefined;
		/**
		 * Cambia cuando el cierre se acaba de marcar o desmarcar: obliga a
		 * releer aunque el estado sea el mismo (p. ej. la versión).
		 */
		refresco?: number;
	}

	let { cierreId, estado, areas, refresco = 0 }: Props = $props();

	const pagado = $derived(estado === 'PAGADA' || estado === 'FACTURADA');
	const admin = $derived(esAdmin(areas));

	let datos = $state<PagoDeCierre | null>(null);
	let cargando = $state(false);
	let abierto = $state(false);
	let editando = $state(false);
	let guardando = $state(false);
	let form = $state<FormPago>({ fecha: hoyColombia(), medio: '', referencia: '', archivo: null });

	let pedido = 0;
	async function cargar(id: string) {
		const yo = ++pedido;
		cargando = true;
		try {
			const r = await liquidacionesTercerosPagosAPI.obtener(id);
			if (yo === pedido) datos = r;
		} catch {
			if (yo === pedido) datos = null;
		} finally {
			if (yo === pedido) cargando = false;
		}
	}

	$effect(() => {
		void refresco;
		if (!pagado || !cierreId) {
			datos = null;
			return;
		}
		void cargar(cierreId);
	});

	function abrirEdicion() {
		const p = datos?.pago;
		form = {
			fecha: p?.fecha ?? hoyColombia(),
			medio: p?.medio ?? '',
			referencia: p?.referencia ?? '',
			archivo: null
		};
		editando = true;
	}

	async function guardar() {
		if (!pagoCompleto(form) || guardando) return;
		guardando = true;
		try {
			/// Sin soporte nuevo, el backend conserva el del registro anterior.
			const pago = await armarPago(form);
			datos = await liquidacionesTercerosPagosAPI.completar(cierreId, pago);
			editando = false;
			toast.success('Pago registrado');
		} catch (e: any) {
			toast.error(e?.response?.data?.message || e?.message || 'No se pudo guardar el pago');
		} finally {
			guardando = false;
		}
	}

	async function verSoporte(pagoId: string) {
		const ventana = window.open('', '_blank');
		try {
			const url = await liquidacionesTercerosPagosAPI.urlComprobante(pagoId);
			if (ventana) ventana.location.href = url;
			else window.open(url, '_blank');
		} catch (e: any) {
			ventana?.close();
			toast.error(e?.response?.data?.message || 'No se pudo abrir el comprobante');
		}
	}

	const etiqueta = $derived(
		!datos
			? cargando
				? 'Pago…'
				: ''
			: datos.pago
				? `Pagada ${fechaCorta(datos.pago.fecha)} · ${ETIQUETA_MEDIO[datos.pago.medio] ?? datos.pago.medio}`
				: 'Pago sin registro'
	);
</script>

{#if pagado && etiqueta}
	<button
		type="button"
		class="pcr-pastilla"
		class:pcr-pastilla--sin={datos && !datos.pago}
		onclick={() => {
			editando = false;
			abierto = true;
		}}
		title="Ver los datos del pago"
	>
		{etiqueta}
	</button>
{/if}

<ModalBase
	open={abierto}
	title="Pago del cierre"
	eyebrow="Liquidación de terceros"
	subtitle={datos ? `${datos.cierre.placa} · ${datos.cierre.consecutivo}` : null}
	tamano="md"
	bloqueado={guardando}
	oncerrar={() => (abierto = false)}
>
	{#if !datos}
		<CargaMascota texto="Leyendo el pago…" />
	{:else if editando}
		<p class="pcr-ayuda">
			{datos.pago
				? 'Corregir deja el registro anterior en el historial.'
				: 'Este cierre se marcó PAGADA antes de que se registrara cómo. Completa los datos.'}
		</p>
		<CamposPagoCierre bind:form deshabilitado={guardando} />
	{:else}
		{#if datos.pago}
			<dl class="pcr-datos">
				<div>
					<dt>Fecha</dt>
					<dd>{fechaCorta(datos.pago.fecha)}</dd>
				</div>
				<div>
					<dt>Medio</dt>
					<dd>{ETIQUETA_MEDIO[datos.pago.medio] ?? datos.pago.medio}</dd>
				</div>
				<div>
					<dt>Referencia</dt>
					<dd>{datos.pago.referencia || '—'}</dd>
				</div>
				<div>
					<dt>Valor</dt>
					<dd>{datos.pago.valor == null ? '—' : pesos(datos.pago.valor)}</dd>
				</div>
				<div>
					<dt>Registrado por</dt>
					<dd>
						{datos.pago.registrado_por?.nombre ?? '—'}
						<small>{new Date(datos.pago.registrado).toLocaleString('es-CO')}</small>
					</dd>
				</div>
				<div>
					<dt>Soporte</dt>
					<dd>
						{#if datos.pago.tiene_comprobante}
							<button type="button" class="pcr-link" onclick={() => verSoporte(datos!.pago!.id)}>
								{datos.pago.comprobante_nombre || 'Ver comprobante'}
							</button>
						{:else}
							—
						{/if}
					</dd>
				</div>
			</dl>
		{:else}
			<p class="pcr-ayuda">
				<strong>Sin registro.</strong> Este cierre está PAGADA pero no tiene fecha, medio ni soporte del
				pago: se marcó antes de que el sistema los pidiera.
			</p>
		{/if}

		{#if datos.historial.length}
			<h4 class="pcr-subtitulo">Registros archivados</h4>
			<ul class="pcr-historial">
				{#each datos.historial as h (h.id)}
					<li>
						<span>
							{fechaCorta(h.fecha)} · {ETIQUETA_MEDIO[h.medio] ?? h.medio}{h.referencia
								? ` · ${h.referencia}`
								: ''}
						</span>
						<small>{h.motivo_archivo ?? 'Archivado'}</small>
						{#if h.tiene_comprobante}
							<button type="button" class="pcr-link" onclick={() => verSoporte(h.id)}
								>Soporte</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#snippet pie()}
		{#if editando}
			<button class="btn-secondary" onclick={() => (editando = false)} disabled={guardando}>
				Cancelar
			</button>
			<button class="btn-primary" onclick={guardar} disabled={guardando || !pagoCompleto(form)}>
				{guardando ? 'Guardando…' : 'Guardar pago'}
			</button>
		{:else}
			{#if admin && datos}
				<button class="btn-secondary" onclick={abrirEdicion}>
					{datos.pago ? 'Corregir' : 'Registrar datos del pago'}
				</button>
			{/if}
			<button class="btn-primary" onclick={() => (abierto = false)}>Cerrar</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.pcr-pastilla {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.1);
		color: #f8fafc;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
	}
	.pcr-pastilla:hover {
		background: rgba(255, 255, 255, 0.18);
	}
	.pcr-pastilla--sin {
		border-style: dashed;
		color: #fde68a;
	}
	.pcr-ayuda {
		margin: 0 0 12px;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.pcr-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 10px 16px;
		margin: 0 0 12px;
	}
	.pcr-datos dt {
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.pcr-datos dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		display: flex;
		flex-direction: column;
	}
	.pcr-datos small {
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.pcr-subtitulo {
		margin: 8px 0 6px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.pcr-historial {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.82rem;
	}
	.pcr-historial li {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
		padding: 6px 0;
		border-bottom: 1px solid var(--border-default);
	}
	.pcr-historial small {
		color: var(--text-muted);
	}
	.pcr-link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 700;
		color: var(--accion);
		cursor: pointer;
		text-align: left;
	}
</style>
