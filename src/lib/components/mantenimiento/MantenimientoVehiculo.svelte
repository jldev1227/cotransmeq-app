<script lang="ts">
	/**
	 * Pestaña «Mantenimiento» de la ficha del vehículo: sus planes con su
	 * semáforo, sus últimas órdenes y lo que ha costado.
	 *
	 * Es de consulta: crear, cerrar y adjuntar se hace en la pantalla de
	 * Mantenimiento, a la que llevan los enlaces (`?plan=`, `?orden=`,
	 * `?nuevo=orden&vehiculo=`). Así hay un solo sitio con los formularios y
	 * la ficha no apila un modal sobre otro.
	 */
	import { untrack } from 'svelte';
	import { Plus, Wrench } from 'lucide-svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import {
		ESTADO_ORDEN,
		ESTADO_PLAN,
		TIPO_ORDEN,
		fecha as fmtFecha,
		km as fmtKm,
		mantenimientoAPI,
		moneda,
		periodicidad,
		restante,
		type MantenimientoVehiculo
	} from '$lib/api/mantenimiento';

	interface Props {
		vehiculoId: string;
		/** `mantenimiento` en full: ofrece abrir orden y crear plan. */
		puedeEscribir?: boolean;
	}
	let { vehiculoId, puedeEscribir = false }: Props = $props();

	let datos = $state<MantenimientoVehiculo | null>(null);
	let error = $state<string | null>(null);

	async function cargar(id: string) {
		error = null;
		try {
			datos = await mantenimientoAPI.vehiculo(id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo cargar el mantenimiento';
		}
	}

	$effect(() => {
		const id = vehiculoId;
		untrack(() => {
			datos = null;
			void cargar(id);
		});
	});

	const base = '/dashboard/mantenimiento';
</script>

{#if error}
	<div class="mv-error">
		<p>{error}</p>
		<button type="button" class="btn-secondary" onclick={() => cargar(vehiculoId)}
			>Reintentar</button
		>
	</div>
{:else if !datos}
	<CargaMascota texto="Cargando mantenimiento…" />
{:else}
	{@const d = datos}
	<div class="mv">
		<div class="mv-cabecera">
			<ResumenConteos
				conteos={[
					...(d.conteos.vencido
						? [
								{
									clave: 'v',
									etiqueta: 'Vencidos',
									valor: d.conteos.vencido,
									color: ESTADO_PLAN.vencido.color
								}
							]
						: []),
					...(d.conteos.proximo
						? [
								{
									clave: 'p',
									etiqueta: 'Próximos',
									valor: d.conteos.proximo,
									color: ESTADO_PLAN.proximo.color
								}
							]
						: []),
					{ clave: 'km', etiqueta: 'Kilometraje', valor: fmtKm(d.vehiculo.km_actual) },
					{
						clave: 'c12',
						etiqueta: 'Últimos 12 meses',
						valor: moneda(d.costos.ultimos_12_meses.total)
					},
					{ clave: 'ch', etiqueta: 'Histórico', valor: moneda(d.costos.historico.total) }
				]}
			/>
			{#if puedeEscribir}
				<div class="mv-acciones">
					<a class="btn-secondary" href={`${base}?nuevo=plan&vehiculo=${d.vehiculo.id}`}
						><Plus size={15} /> Plan</a
					>
					<a class="btn-primary" href={`${base}?nuevo=orden&vehiculo=${d.vehiculo.id}`}
						><Wrench size={15} /> Orden</a
					>
				</div>
			{/if}
		</div>

		<section>
			<h3 class="mv-titulo">Planes</h3>
			{#if d.planes.length === 0}
				<p class="mv-vacio">
					Sin planes de mantenimiento. Un plan avisa antes de que toque el cambio de aceite, los
					frenos o las llantas.
				</p>
			{:else}
				<ul class="mv-lista">
					{#each d.planes as p (p.id)}
						<li>
							<a href={`${base}?plan=${p.id}`}>
								<span class="mv-principal">
									<strong>{p.nombre}</strong>
									<small
										>{periodicidad(p)} · próximo {[
											p.proximo_km ? fmtKm(p.proximo_km) : null,
											p.proxima_fecha ? fmtFecha(p.proxima_fecha) : null
										]
											.filter(Boolean)
											.join(' o ') || '—'}</small
									>
								</span>
								<span class="mv-estado">
									<EstadoPunto
										etiqueta={ESTADO_PLAN[p.estado].etiqueta}
										color={ESTADO_PLAN[p.estado].color}
										apagado={p.estado === 'pausado'}
									/>
									<small
										>{p.orden_abierta
											? `OT ${p.orden_abierta.consecutivo} abierta`
											: restante(p)}</small
									>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h3 class="mv-titulo">Órdenes de trabajo</h3>
			{#if d.ordenes.length === 0}
				<p class="mv-vacio">Sin órdenes de trabajo registradas.</p>
			{:else}
				<ul class="mv-lista">
					{#each d.ordenes as o (o.id)}
						<li>
							<a href={`${base}?orden=${o.id}`}>
								<span class="mv-principal">
									<strong>OT {o.consecutivo} · {TIPO_ORDEN[o.tipo]}</strong>
									<small>{fmtFecha(o.fecha_ejecucion ?? o.fecha)} · {o.descripcion}</small>
								</span>
								<span class="mv-estado">
									<EstadoPunto
										etiqueta={ESTADO_ORDEN[o.estado].etiqueta}
										color={ESTADO_ORDEN[o.estado].color}
										apagado={o.estado === 'CANCELADO'}
									/>
									<small>{moneda(o.costo)}</small>
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if d.ordenes.length >= 30}
					<a
						class="mv-mas"
						href={`${base}?vista=ordenes&estado_orden=todas&q=${encodeURIComponent(d.vehiculo.placa)}`}
						>Ver todas las órdenes de {d.vehiculo.placa}</a
					>
				{/if}
			{/if}
		</section>
	</div>
{/if}

<style>
	.mv {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.mv-cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.mv-acciones {
		display: flex;
		gap: 6px;
	}
	.mv-titulo {
		margin: 0 0 8px;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.mv-vacio {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-muted);
		max-width: 44rem;
	}
	.mv-lista {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		overflow: hidden;
		background: var(--bg-surface);
	}
	.mv-lista li + li {
		border-top: 1px solid var(--border-subtle);
	}
	.mv-lista a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		color: inherit;
		text-decoration: none;
	}
	.mv-lista a:hover {
		background: var(--bg-base);
	}
	.mv-principal,
	.mv-estado {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.mv-estado {
		flex-shrink: 0;
		align-items: flex-end;
	}
	.mv-principal strong {
		font-size: 0.86rem;
		color: var(--text-primary);
	}
	.mv-principal small,
	.mv-estado small {
		font-size: 0.76rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mv-mas {
		display: inline-block;
		margin-top: 8px;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--accion);
	}
	.mv-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--text-secondary);
	}
</style>
