<script lang="ts">
	/**
	 * Detalle de un plan: dónde está (vencido, próximo, al día), cada cuánto,
	 * cuándo se hizo por última vez y las órdenes que lo han movido. Es a
	 * donde llegan los avisos diarios (`?plan=<id>`).
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import {
		ESTADO_ORDEN,
		ESTADO_PLAN,
		fecha as fmtFecha,
		km as fmtKm,
		mantenimientoAPI,
		moneda,
		periodicidad,
		restante,
		type Orden,
		type PlanDetalle
	} from '$lib/api/mantenimiento';

	interface Props {
		open: boolean;
		planId: string | null;
		puedeEscribir: boolean;
		/** Se incrementa desde fuera para volver a pedir el plan (tras editar o cerrar una orden). */
		version?: number;
		oncerrar: () => void;
		oneditar: (p: PlanDetalle) => void;
		oncrearorden: (p: PlanDetalle) => void;
		onverorden: (o: Pick<Orden, 'id'>) => void;
		oncambio: () => void;
	}
	let {
		open,
		planId,
		puedeEscribir,
		version = 0,
		oncerrar,
		oneditar,
		oncrearorden,
		onverorden,
		oncambio
	}: Props = $props();

	let plan = $state<PlanDetalle | null>(null);
	let cargando = $state(false);
	let trabajando = $state(false);

	$effect(() => {
		if (!open || !planId) return;
		void version;
		const id = planId;
		untrack(() => void cargar(id));
	});

	async function cargar(id: string) {
		cargando = plan?.id !== id;
		try {
			plan = await mantenimientoAPI.plan(id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo abrir el plan');
			oncerrar();
		} finally {
			cargando = false;
		}
	}

	async function pausar() {
		if (!plan) return;
		trabajando = true;
		try {
			plan = await mantenimientoAPI.actualizarPlan(plan.id, { activo: !plan.activo });
			toast.success(
				plan.activo ? 'Plan reanudado' : 'Plan pausado: no avisará ni contará como vencido'
			);
			oncambio();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el plan');
		} finally {
			trabajando = false;
		}
	}

	async function eliminar() {
		if (!plan) return;
		const ok = await confirmarEliminacion({
			title: `¿Eliminar el plan «${plan.nombre}» de ${plan.vehiculo.placa}?`,
			message: 'Sus órdenes cerradas se conservan en el historial del vehículo.'
		});
		if (!ok) return;
		trabajando = true;
		try {
			await mantenimientoAPI.eliminarPlan(plan.id);
			toast.success('Plan eliminado');
			oncambio();
			oncerrar();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el plan');
		} finally {
			trabajando = false;
		}
	}
</script>

<ModalBase
	{open}
	title={plan ? `${plan.nombre} · ${plan.vehiculo.placa}` : 'Plan de mantenimiento'}
	eyebrow="PLAN PREVENTIVO"
	subtitle={plan ? `${plan.categoria_etiqueta} · ${periodicidad(plan)}` : null}
	tamano="md"
	bloqueado={trabajando}
	{oncerrar}
>
	{#if cargando || !plan}
		<CargaMascota texto="Abriendo el plan…" />
	{:else}
		{@const p = plan}
		<div class="dp">
			<div class="dp-estado" style="--c:{ESTADO_PLAN[p.estado].color}">
				<EstadoPunto
					etiqueta={ESTADO_PLAN[p.estado].etiqueta}
					color={ESTADO_PLAN[p.estado].color}
					apagado={p.estado === 'pausado'}
				/>
				<span>{restante(p)}</span>
			</div>
			<dl class="dp-datos">
				<div>
					<dt>Último</dt>
					<dd>{fmtFecha(p.ultima_ejecucion_fecha)} · {fmtKm(p.ultima_ejecucion_km)}</dd>
				</div>
				<div>
					<dt>Próximo</dt>
					<dd>{fmtFecha(p.proxima_fecha)} · {fmtKm(p.proximo_km)}</dd>
				</div>
				<div>
					<dt>Kilometraje actual</dt>
					<dd>{fmtKm(p.km_actual)}</dd>
				</div>
			</dl>
			{#if p.observaciones}<p class="dp-obs">{p.observaciones}</p>{/if}

			<section>
				<h3 class="dp-titulo">Órdenes de este plan</h3>
				{#if p.ordenes.length === 0}
					<p class="dp-vacio">
						Todavía no tiene órdenes. Al cerrar la primera, el plan se mueve solo.
					</p>
				{:else}
					<ul class="dp-ordenes">
						{#each p.ordenes as o (o.id)}
							<li>
								<button type="button" onclick={() => onverorden(o)}>
									<span class="dp-ot">OT {o.consecutivo}</span>
									<span class="dp-ot-fecha">{fmtFecha(o.fecha_ejecucion ?? o.fecha)}</span>
									<EstadoPunto
										etiqueta={ESTADO_ORDEN[o.estado].etiqueta}
										color={ESTADO_ORDEN[o.estado].color}
										apagado={o.estado === 'CANCELADO'}
									/>
									<span class="dp-ot-costo">{moneda(o.costo)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{/if}

	{#snippet pie()}
		{#if plan && puedeEscribir}
			<button
				type="button"
				class="btn-secondary dp-eliminar"
				onclick={eliminar}
				disabled={trabajando}>Eliminar</button
			>
			<button type="button" class="btn-secondary" onclick={pausar} disabled={trabajando}
				>{plan.activo ? 'Pausar' : 'Reanudar'}</button
			>
			<button
				type="button"
				class="btn-secondary"
				onclick={() => plan && oneditar(plan)}
				disabled={trabajando}>Editar</button
			>
			{#if plan.orden_abierta}
				<button
					type="button"
					class="btn-primary"
					onclick={() => plan?.orden_abierta && onverorden(plan.orden_abierta)}
					>Ver OT {plan.orden_abierta.consecutivo}</button
				>
			{:else}
				<button
					type="button"
					class="btn-primary"
					onclick={() => plan && oncrearorden(plan)}
					disabled={trabajando || !plan.activo}>Abrir orden</button
				>
			{/if}
		{/if}
	{/snippet}
</ModalBase>

<style>
	.dp {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.dp-estado {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--c) 8%, transparent);
		font-size: 0.86rem;
		font-weight: 700;
		color: var(--c);
	}
	.dp-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 10px 16px;
		margin: 0;
	}
	.dp-datos dt,
	.dp-titulo {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.dp-titulo {
		margin: 0 0 8px;
	}
	.dp-datos dd {
		margin: 2px 0 0;
		font-size: 0.86rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.dp-obs,
	.dp-vacio {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-muted);
	}
	.dp-ordenes {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		overflow: hidden;
	}
	.dp-ordenes li + li {
		border-top: 1px solid var(--border-subtle);
	}
	.dp-ordenes button {
		display: grid;
		grid-template-columns: 4.5rem 7rem 1fr auto;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 12px;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 0.84rem;
		text-align: left;
		cursor: pointer;
	}
	.dp-ordenes button:hover {
		background: var(--bg-base);
	}
	.dp-ot {
		font-weight: 800;
	}
	.dp-ot-fecha {
		color: var(--text-muted);
	}
	.dp-ot-costo {
		font-variant-numeric: tabular-nums;
	}
	.dp-eliminar {
		margin-right: auto;
		color: #b91c1c;
	}
</style>
