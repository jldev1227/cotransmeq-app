<script lang="ts">
	/**
	 * Vista rápida de un servicio desde el calendario.
	 *
	 * Reemplaza al drawer lateral, que salía cortado contra el borde y repetía
	 * cada dato en una tarjeta con su propio icono de color. Va sobre
	 * `ModalBase`, como el resto de modales del panel: el recorrido arriba,
	 * quién lo hace y para quién, la línea de fechas y, al pie, las mismas
	 * acciones que el menú de la lista.
	 */
	import { goto } from '$app/navigation';
	import { Building2, Car, Link2, Pencil, Smartphone, Trash2, User } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import { getEstadoColor, getEstadoText, type ServicioConRelaciones } from '$lib/types/servicios';
	import { labelPropositoServicio } from '$lib/config/proposito-servicio';

	interface Props {
		servicio: ServicioConRelaciones | null;
		puedeEditar?: boolean;
		oncerrar: () => void;
		oneditar: (servicio: ServicioConRelaciones) => void;
		oncompartir: (servicio: ServicioConRelaciones) => void;
		oneliminar: (servicio: ServicioConRelaciones) => void;
	}

	let {
		servicio,
		puedeEditar = false,
		oncerrar,
		oneditar,
		oncompartir,
		oneliminar
	}: Props = $props();

	const origen = $derived(
		servicio?.origen_especifico || servicio?.origen?.nombre_municipio || 'Sin origen'
	);
	const destino = $derived(
		servicio?.destino_especifico || servicio?.destino?.nombre_municipio || 'Sin destino'
	);

	const COP = (n: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(n);

	function fechaLarga(s?: string | null) {
		if (!s) return null;
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) return null;
		return new Intl.DateTimeFormat('es-CO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(d);
	}

	const fechas = $derived(
		servicio
			? [
					{ etiqueta: 'Solicitud', valor: fechaLarga(servicio.fecha_solicitud) },
					{ etiqueta: 'Realización', valor: fechaLarga(servicio.fecha_realizacion) },
					{ etiqueta: 'Finalización', valor: fechaLarga(servicio.fecha_finalizacion) }
				]
			: []
	);
</script>

<ModalBase
	open={!!servicio}
	eyebrow={servicio?.numero_planilla ? `Planilla ${servicio.numero_planilla}` : 'Servicio'}
	title="{origen} → {destino}"
	subtitle={servicio?.cliente?.nombre ?? null}
	tamano="md"
	{oncerrar}
>
	{#snippet cabecera()}
		{#if servicio}
			<div class="ds-chips">
				<span class="ds-chip">
					<EstadoPunto
						etiqueta={getEstadoText(servicio.estado)}
						color={getEstadoColor(servicio.estado)}
						apagado={servicio.estado === 'cancelado'}
					/>
				</span>
				<span class="ds-chip">{labelPropositoServicio(servicio.proposito_servicio)}</span>
				{#if servicio.ejecucion?.iniciado_at}
					<span class="ds-chip">
						<Smartphone size={12} />
						{servicio.ejecucion.liberado_at ? 'Liberado desde la app' : 'Iniciado desde la app'}
					</span>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#if servicio}
		<div class="ds">
			<!-- Recorrido: dos paradas unidas por un trazo. -->
			<ol class="ds-ruta">
				<li>
					<span class="ds-ruta-punto ds-ruta-punto--origen" aria-hidden="true"></span>
					<div>
						<small>Origen</small>
						<strong>{origen}</strong>
						{#if servicio.origen_especifico && servicio.origen?.nombre_municipio}
							<span>{servicio.origen.nombre_municipio}</span>
						{/if}
					</div>
				</li>
				<li>
					<span class="ds-ruta-punto" aria-hidden="true"></span>
					<div>
						<small>Destino</small>
						<strong>{destino}</strong>
						{#if servicio.destino_especifico && servicio.destino?.nombre_municipio}
							<span>{servicio.destino.nombre_municipio}</span>
						{/if}
					</div>
				</li>
			</ol>

			<dl class="ds-asignacion">
				<div>
					<dt><User size={13} /> Conductor</dt>
					{#if servicio.conductor}
						<dd>{servicio.conductor.nombre} {servicio.conductor.apellido ?? ''}</dd>
						{#if servicio.conductor.telefono}<dd class="ds-sec">
								{servicio.conductor.telefono}
							</dd>{/if}
					{:else}
						<dd class="ds-nulo">Sin asignar</dd>
					{/if}
				</div>
				<div>
					<dt><Car size={13} /> Vehículo</dt>
					{#if servicio.vehiculo}
						<dd><span class="ds-placa">{servicio.vehiculo.placa}</span></dd>
						<dd class="ds-sec">
							{[servicio.vehiculo.marca, servicio.vehiculo.modelo].filter(Boolean).join(' ')}
						</dd>
					{:else}
						<dd class="ds-nulo">Sin asignar</dd>
					{/if}
				</div>
				<div>
					<dt><Building2 size={13} /> Cliente</dt>
					<dd>{servicio.cliente?.nombre ?? '—'}</dd>
					{#if servicio.cliente?.nit}<dd class="ds-sec">NIT {servicio.cliente.nit}</dd>{/if}
				</div>
			</dl>

			<section class="ds-bloque">
				<h3>Fechas</h3>
				<ol class="ds-fechas">
					{#each fechas as f (f.etiqueta)}
						<li class:pendiente={!f.valor}>
							<span class="ds-fecha-punto" aria-hidden="true"></span>
							<span class="ds-fecha-etiqueta">{f.etiqueta}</span>
							<span class="ds-fecha-valor">{f.valor ?? 'Pendiente'}</span>
						</li>
					{/each}
				</ol>
			</section>

			{#if servicio.valor > 0 || servicio.observaciones}
				<div class="ds-extra">
					{#if servicio.valor > 0}
						<section class="ds-bloque">
							<h3>Valor</h3>
							<p class="ds-valor">{COP(servicio.valor)}</p>
						</section>
					{/if}
					{#if servicio.observaciones}
						<section class="ds-bloque">
							<h3>Observaciones</h3>
							<p class="ds-obs">{servicio.observaciones}</p>
						</section>
					{/if}
				</div>
			{/if}

			{#if servicio.cancelacion}
				<section class="ds-cancelado">
					<h3>Cancelado {fechaLarga(servicio.cancelacion.fecha_cancelacion) ?? ''}</h3>
					{#if servicio.cancelacion.motivo_cancelacion}<p>
							{servicio.cancelacion.motivo_cancelacion}
						</p>{/if}
					{#if servicio.cancelacion.observaciones}<p>{servicio.cancelacion.observaciones}</p>{/if}
				</section>
			{/if}
		</div>
	{/if}

	{#snippet pie()}
		{#if servicio}
			{@const s = servicio}
			{#if puedeEditar}
				<button type="button" class="btn-secondary ds-eliminar" onclick={() => oneliminar(s)}>
					<Trash2 size={15} />
					Eliminar
				</button>
			{/if}
			<button type="button" class="btn-secondary" onclick={() => oncompartir(s)}>
				<Link2 size={15} />
				Copiar enlace
			</button>
			<button
				type="button"
				class="btn-secondary"
				onclick={() => goto(`/dashboard/servicios/${s.id}`)}
			>
				Ver detalle
			</button>
			{#if puedeEditar}
				<button type="button" class="btn-primary" onclick={() => oneditar(s)}>
					<Pencil size={15} />
					Editar
				</button>
			{/if}
		{/if}
	{/snippet}
</ModalBase>

<style>
	.ds {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.ds-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}
	.ds-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* ── Recorrido ── */
	.ds-ruta {
		position: relative;
		display: grid;
		gap: 14px;
		margin: 0;
		padding: 14px 16px;
		list-style: none;
		border-radius: 16px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.ds-ruta li {
		position: relative;
		display: grid;
		grid-template-columns: 14px 1fr;
		gap: 12px;
		align-items: start;
	}
	.ds-ruta li:first-child::after {
		content: '';
		position: absolute;
		left: 6px;
		top: 18px;
		bottom: -14px;
		width: 2px;
		border-radius: 1px;
		background: repeating-linear-gradient(
			to bottom,
			var(--border-default) 0 4px,
			transparent 4px 7px
		);
	}
	.ds-ruta-punto {
		width: 14px;
		height: 14px;
		margin-top: 3px;
		border-radius: 50%;
		border: 3px solid var(--accion);
		background: var(--bg-surface);
	}
	.ds-ruta-punto--origen {
		background: var(--accion);
	}
	.ds-ruta div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.ds-ruta small,
	.ds-asignacion dt,
	.ds-bloque h3 {
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ds-ruta strong {
		font-size: 0.95rem;
		color: var(--text-primary);
	}
	.ds-ruta span {
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	/* ── Asignación ── */
	.ds-asignacion {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin: 0;
	}
	.ds-asignacion > div {
		min-width: 0;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid var(--border-subtle);
	}
	.ds-asignacion dt {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-bottom: 4px;
	}
	.ds-asignacion dd {
		margin: 0;
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.ds-asignacion .ds-sec {
		font-size: 0.76rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.ds-nulo {
		font-style: italic;
		font-weight: 500 !important;
		color: var(--text-very-muted) !important;
	}
	.ds-placa {
		padding: 1px 6px;
		border-radius: 6px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-base);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-weight: 800;
		letter-spacing: 0.05em;
	}
	@media (max-width: 560px) {
		.ds-asignacion {
			grid-template-columns: 1fr;
		}
	}

	/* ── Fechas ── */
	.ds-bloque h3 {
		margin: 0 0 6px;
	}
	.ds-fechas {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ds-fechas li {
		position: relative;
		display: grid;
		grid-template-columns: 10px 6.5rem 1fr;
		align-items: center;
		gap: 10px;
		font-size: 0.84rem;
	}
	.ds-fechas li:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 4px;
		top: 15px;
		height: 12px;
		width: 2px;
		background: var(--border-default);
	}
	.ds-fecha-punto {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accion);
	}
	.ds-fecha-etiqueta {
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ds-fecha-valor {
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.ds-fechas li.pendiente .ds-fecha-punto {
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--border-default);
	}
	.ds-fechas li.pendiente .ds-fecha-valor {
		font-style: italic;
		color: var(--text-very-muted);
	}

	.ds-extra {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 18px;
	}
	.ds-valor {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.ds-obs {
		margin: 0;
		font-size: 0.86rem;
		white-space: pre-line;
		color: var(--text-secondary);
	}
	.ds-cancelado {
		padding: 12px 14px;
		border-radius: 14px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
		font-size: 0.84rem;
	}
	.ds-cancelado h3 {
		margin: 0 0 4px;
		font-size: 0.8rem;
		font-weight: 800;
	}
	.ds-cancelado p {
		margin: 0;
	}
	.ds-eliminar {
		margin-right: auto;
		color: #b91c1c;
	}
</style>
