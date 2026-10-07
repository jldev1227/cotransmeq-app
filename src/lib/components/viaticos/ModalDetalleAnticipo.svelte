<script lang="ts">
	/**
	 * Ficha de un anticipo: saldo, cómo se entregó, los gastos que el conductor
	 * reportó (con sus facturas) y las solicitudes de más dinero.
	 *
	 * Desde aquí operaciones anula gastos (con motivo, que le llega al
	 * conductor), aprueba o rechaza la solicitud pendiente, edita o elimina.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Ban, Check, FileText, Pencil, Trash2, X } from 'lucide-svelte';
	import ModalDetalle from '$lib/components/directorio/ModalDetalle.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import ModalMotivo from './ModalMotivo.svelte';
	import BarraSaldo from './BarraSaldo.svelte';
	import {
		METODO_LABELS,
		colorSaldo,
		etiquetaSaldo,
		fechaCorta,
		moneda,
		viaticosAPI,
		type AnticipoDetalle,
		type Gasto,
		type Solicitud
	} from '$lib/api/viaticos';

	interface Props {
		open: boolean;
		anticipoId: string | null;
		puedeEscribir: boolean;
		oncerrar: () => void;
		oneditar: (a: AnticipoDetalle) => void;
		onaprobar: (solicitudId: string) => void;
		oneliminar: (a: AnticipoDetalle) => void;
		/** Algo cambió (anulación, rechazo): la lista de fondo se recarga. */
		oncambio: () => void;
	}
	let {
		open,
		anticipoId,
		puedeEscribir,
		oncerrar,
		oneditar,
		onaprobar,
		oneliminar,
		oncambio
	}: Props = $props();

	let a = $state<AnticipoDetalle | null>(null);
	let cargando = $state(false);
	let tab = $state('resumen');
	let anulando = $state<Gasto | null>(null);
	let rechazando = $state<Solicitud | null>(null);

	$effect(() => {
		if (!open || !anticipoId) return;
		const id = anticipoId;
		untrack(() => {
			tab = 'resumen';
			void cargar(id);
		});
	});

	async function cargar(id: string) {
		cargando = true;
		try {
			a = await viaticosAPI.detalle(id);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo cargar el anticipo');
			oncerrar();
		} finally {
			cargando = false;
		}
	}

	const vigentes = $derived(a?.gastos.filter((g) => !g.anulado) ?? []);
	const pendiente = $derived(a?.solicitudes.find((s) => s.estado === 'PENDIENTE') ?? null);

	async function anular(motivo: string) {
		if (!anulando) return;
		try {
			a = await viaticosAPI.anularGasto(anulando.id, motivo);
			toast.success('Gasto anulado. El saldo se restableció y el conductor fue notificado.');
			oncambio();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo anular el gasto');
			throw error;
		}
	}

	async function rechazar(motivo: string) {
		if (!rechazando || !a) return;
		try {
			await viaticosAPI.rechazar(rechazando.id, motivo);
			toast.success('Solicitud rechazada. El conductor fue notificado.');
			await cargar(a.id);
			oncambio();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo rechazar la solicitud');
			throw error;
		}
	}

	const ESTADO_SOLICITUD = {
		PENDIENTE: { etiqueta: 'Pendiente', color: '#f59e0b' },
		APROBADA: { etiqueta: 'Aprobada', color: '#22c55e' },
		RECHAZADA: { etiqueta: 'Rechazada', color: '#ef4444' }
	} as const;
	const kb = (b: number) =>
		b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
</script>

<ModalDetalle
	{open}
	eyebrow="ANTICIPO DE VIÁTICOS"
	title={a?.conductor.nombre ?? 'Anticipo'}
	subtitle={a ? `${a.vehiculo.placa} · ${a.concepto}` : null}
	iniciales={a?.vehiculo.placa.slice(0, 3) ?? null}
	estado={a ? { etiqueta: etiquetaSaldo(a), color: colorSaldo(a) } : null}
	tabs={[
		{ id: 'resumen', label: 'Resumen' },
		{ id: 'gastos', label: 'Gastos', cuenta: a ? vigentes.length : null },
		{ id: 'solicitudes', label: 'Solicitudes', cuenta: a ? a.solicitudes.length : null }
	]}
	bind:tabActiva={tab}
	cargando={cargando && !a}
	{oncerrar}
>
	{#snippet children(activa)}
		{#if a}
			{#if pendiente}
				<div class="dv-pendiente">
					<div>
						<strong>Solicitud pendiente: {moneda(pendiente.valor_solicitado)}</strong>
						<span>
							{fechaCorta(pendiente.created_at)}{pendiente.observaciones
								? ` · «${pendiente.observaciones}»`
								: ''}
						</span>
					</div>
					{#if puedeEscribir}
						<div class="dv-pendiente-acciones">
							<button type="button" class="btn-secondary" onclick={() => (rechazando = pendiente)}>
								<X size={15} /> Rechazar
							</button>
							<button type="button" class="btn-primary" onclick={() => onaprobar(pendiente.id)}>
								<Check size={15} /> Aprobar
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if activa === 'resumen'}
				<BarraSaldo saldo={a} />
				<div class="md-grid">
					<p class="md-seccion">Entrega</p>
					<Dato etiqueta="Método" valor={METODO_LABELS[a.metodo]} />
					<Dato etiqueta="Fecha" valor={fechaCorta(a.fecha)} />
					{#if a.metodo === 'TRANSFERENCIA'}
						<Dato etiqueta="Número de comprobante" valor={a.numero_comprobante} mono />
						<Dato etiqueta="Banco o entidad" valor={a.entidad} />
						<Dato etiqueta="Comprobante" completo>
							{#if a.comprobante?.url}
								{#if a.comprobante.mime_type?.startsWith('image/')}
									<a href={a.comprobante.url} target="_blank" rel="noopener" class="dv-comprobante">
										<img src={a.comprobante.url} alt="Comprobante de la transferencia" />
									</a>
								{:else}
									<a href={a.comprobante.url} target="_blank" rel="noopener" class="dv-archivo">
										<FileText size={16} />
										{a.comprobante.nombre ?? 'Ver comprobante (PDF)'}
									</a>
								{/if}
							{:else}
								<span class="dv-nulo">No disponible</span>
							{/if}
						</Dato>
						{#if a.comprobante_lectura && a.comprobante_lectura.valor != null && a.comprobante_lectura.valor !== a.valor}
							<p class="dv-aviso md-full">
								El comprobante leído por IA decía {moneda(a.comprobante_lectura.valor)}; se registró {moneda(
									a.valor
								)}.
							</p>
						{/if}
					{:else}
						<Dato etiqueta="Tarjeta o cuenta" valor={a.tarjeta_cuenta} completo />
					{/if}
					<p class="md-seccion">Registro</p>
					<Dato etiqueta="Conductor" valor={a.conductor.nombre} />
					<Dato etiqueta="Documento" valor={a.conductor.numero_identificacion} mono />
					<Dato etiqueta="Placa" valor={a.vehiculo.placa} mono />
					<Dato etiqueta="Vehículo" valor={a.vehiculo.descripcion || null} />
					<Dato etiqueta="Registrado por" valor={a.creado_por?.nombre ?? null} />
					<Dato
						etiqueta="Última edición"
						valor={a.actualizado_por
							? `${a.actualizado_por.nombre} · ${fechaCorta(a.updated_at)}`
							: null}
					/>
				</div>
			{:else if activa === 'gastos'}
				{#if a.gastos.length === 0}
					<p class="dv-vacio">El conductor todavía no ha reportado gastos de este anticipo.</p>
				{:else}
					<ul class="dv-gastos">
						{#each a.gastos as g (g.id)}
							<li class="dv-gasto" class:dv-gasto--anulado={g.anulado}>
								<div class="dv-gasto-cabecera">
									<div>
										<strong class="dv-valor">{moneda(g.valor)}</strong>
										<span class="dv-fecha">{fechaCorta(g.fecha)}</span>
									</div>
									{#if g.anulado}
										<span class="dv-chip dv-chip--anulado">Anulado</span>
									{:else if puedeEscribir}
										<button type="button" class="dv-anular" onclick={() => (anulando = g)}>
											<Ban size={14} /> Anular
										</button>
									{/if}
								</div>
								{#if g.descripcion}<p class="dv-desc">{g.descripcion}</p>{/if}
								{#if g.anulado}
									<p class="dv-motivo">
										{g.anulado_por?.nombre ?? 'Operaciones'} · {fechaCorta(g.anulado_at)}: {g.motivo_anulacion}
									</p>
								{/if}
								{#if g.adjuntos.length}
									<div class="dv-adjuntos">
										{#each g.adjuntos as adj (adj.id)}
											{#if adj.url && adj.mime_type.startsWith('image/')}
												<a
													href={adj.url}
													target="_blank"
													rel="noopener"
													class="dv-foto"
													title={adj.original_name ?? 'Factura'}
												>
													<img src={adj.url} alt={adj.original_name ?? 'Factura'} loading="lazy" />
												</a>
											{:else if adj.url}
												<a href={adj.url} target="_blank" rel="noopener" class="dv-archivo">
													<FileText size={16} />
													{adj.original_name ?? 'Factura.pdf'} · {kb(adj.byte_size)}
												</a>
											{:else}
												<span class="dv-archivo dv-archivo--pendiente">Subiendo desde la app…</span>
											{/if}
										{/each}
									</div>
								{:else}
									<p class="dv-nulo">Sin factura adjunta</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{:else if a.solicitudes.length === 0}
				<p class="dv-vacio">El conductor no ha pedido más dinero desde este anticipo.</p>
			{:else}
				<ul class="dv-gastos">
					{#each a.solicitudes as s (s.id)}
						<li class="dv-gasto">
							<div class="dv-gasto-cabecera">
								<div>
									<strong class="dv-valor">{moneda(s.valor_solicitado)}</strong>
									<span class="dv-fecha">{fechaCorta(s.created_at)}</span>
								</div>
								<span class="dv-chip" style="--c: {ESTADO_SOLICITUD[s.estado].color}"
									>{ESTADO_SOLICITUD[s.estado].etiqueta}</span
								>
							</div>
							{#if s.observaciones}<p class="dv-desc">«{s.observaciones}»</p>{/if}
							{#if s.estado === 'RECHAZADA'}
								<p class="dv-motivo">
									{s.resuelta_por?.nombre ?? 'Operaciones'}: {s.motivo_rechazo}
								</p>
							{:else if s.estado === 'APROBADA'}
								<p class="dv-desc">
									Aprobada por {s.resuelta_por?.nombre ?? 'operaciones'} · {fechaCorta(
										s.resuelta_at
									)}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/snippet}

	{#snippet acciones()}
		{#if a && puedeEscribir}
			{#if vigentes.length === 0}
				<button type="button" class="btn-secondary dv-peligro" onclick={() => a && oneliminar(a)}>
					<Trash2 size={15} /> Eliminar
				</button>
			{/if}
			<button type="button" class="btn-primary" onclick={() => a && oneditar(a)}>
				<Pencil size={15} /> Editar
			</button>
		{/if}
	{/snippet}
</ModalDetalle>

<ModalMotivo
	open={!!anulando}
	titulo="Anular gasto"
	descripcion={anulando
		? `El gasto de ${moneda(anulando.valor)} dejará de descontar del saldo. El conductor verá el motivo.`
		: ''}
	textoConfirmar="Anular gasto"
	placeholder="Ej. La factura no corresponde al viaje"
	oncerrar={() => (anulando = null)}
	onconfirmar={anular}
/>

<ModalMotivo
	open={!!rechazando}
	titulo="Rechazar solicitud"
	descripcion={rechazando
		? `El conductor pidió ${moneda(rechazando.valor_solicitado)}. Le llegará una notificación con el motivo.`
		: ''}
	textoConfirmar="Rechazar"
	placeholder="Ej. El viaje ya terminó"
	oncerrar={() => (rechazando = null)}
	onconfirmar={rechazar}
/>

<style>
	.dv-pendiente {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
		padding: 12px 14px;
		border: 1px solid #fcd34d;
		border-radius: 14px;
		background: #fffbeb;
	}
	.dv-pendiente > div:first-child {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		color: #92400e;
		font-size: 13px;
	}
	.dv-pendiente strong {
		font-size: 14px;
	}
	.dv-pendiente-acciones {
		display: flex;
		gap: 8px;
	}
	.dv-comprobante {
		display: block;
		max-width: 260px;
		overflow: hidden;
		border: 1px solid var(--border-default);
		border-radius: 12px;
	}
	.dv-comprobante img {
		display: block;
		width: 100%;
		height: auto;
	}
	.dv-archivo {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--au-dark);
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}
	.dv-archivo--pendiente {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.dv-aviso {
		grid-column: 1 / -1;
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: #fffbeb;
		color: #92400e;
		font-size: 13px;
	}
	.dv-nulo,
	.dv-vacio {
		margin: 0;
		color: var(--text-secondary);
		font-size: 13px;
	}
	.dv-vacio {
		padding: 24px 0;
		text-align: center;
	}
	.dv-gastos {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.dv-gasto {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
	}
	.dv-gasto--anulado {
		opacity: 0.7;
	}
	.dv-gasto--anulado .dv-valor {
		text-decoration: line-through;
	}
	.dv-gasto-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.dv-gasto-cabecera > div {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.dv-valor {
		color: var(--text-primary);
		font-size: 16px;
		font-variant-numeric: tabular-nums;
	}
	.dv-fecha {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.dv-desc {
		margin: 0;
		color: var(--text-primary);
		font-size: 13px;
	}
	.dv-motivo {
		margin: 0;
		color: #b42318;
		font-size: 12px;
	}
	.dv-chip {
		--c: #66756f;
		padding: 3px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--c) 14%, transparent);
		color: var(--c);
		font-size: 12px;
		font-weight: 700;
	}
	.dv-chip--anulado {
		--c: #b42318;
	}
	.dv-anular {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border: 1px solid var(--border-default);
		border-radius: 999px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.dv-anular:hover {
		border-color: #fca5a5;
		background: #fee2e2;
		color: #b42318;
	}
	.dv-adjuntos {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.dv-foto {
		display: block;
		width: 72px;
		height: 72px;
		overflow: hidden;
		border: 1px solid var(--border-default);
		border-radius: 10px;
	}
	.dv-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	:global(.dv-peligro:hover) {
		border-color: #fca5a5 !important;
		color: #b42318 !important;
	}
</style>
