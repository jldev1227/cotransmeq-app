<script lang="ts">
	/**
	 * Viáticos del conductor en el portal web: SOLO CONSULTA.
	 *
	 * Reportar gastos (con la foto de la factura) y pedir más dinero se hace
	 * desde la app móvil, que tiene cámara, trabaja sin señal y recibe el aviso
	 * de saldo bajo. Aquí el conductor ve cuánto le entregaron, cuánto lleva
	 * reportado y lo que le queda de cada anticipo.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, slide } from 'svelte/transition';
	import { isAuthenticated, portalFetch } from '$lib/stores/portalStore';
	import PortalHeader from '$lib/components/portal/PortalHeader.svelte';
	import PortalSection from '$lib/components/portal/PortalSection.svelte';
	import BarraSaldo from '$lib/components/viaticos/BarraSaldo.svelte';
	import {
		colorSaldo,
		etiquetaSaldo,
		fechaCorta,
		METODO_LABELS,
		moneda,
		type AnticipoDetalle,
		type AnticipoResumen
	} from '$lib/api/viaticos';

	let anticipos = $state<AnticipoResumen[]>([]);
	let totales = $state({ anticipado: 0, gastado: 0, saldo: 0 });
	let cargando = $state(true);
	let error = $state('');
	let abierto = $state<string | null>(null);
	let detalles = $state<Record<string, AnticipoDetalle>>({});
	let cargandoDetalle = $state<string | null>(null);

	async function cargar() {
		cargando = true;
		error = '';
		try {
			const r = await portalFetch('/conductor-portal/viaticos');
			anticipos = r.data.anticipos;
			totales = r.data.totales;
		} catch (e: any) {
			if (e?.status === 401) return goto('/public/portal');
			error = e?.message || 'No pudimos cargar tus viáticos.';
		} finally {
			cargando = false;
		}
	}

	async function alternar(id: string) {
		if (abierto === id) {
			abierto = null;
			return;
		}
		abierto = id;
		if (detalles[id]) return;
		cargandoDetalle = id;
		try {
			const r = await portalFetch(`/conductor-portal/viaticos/${id}`);
			detalles = { ...detalles, [id]: r.data };
		} catch (e: any) {
			error = e?.message || 'No pudimos cargar el anticipo.';
		} finally {
			cargandoDetalle = null;
		}
	}

	const activos = $derived(anticipos.filter((a) => !a.agotado));
	const cerrados = $derived(anticipos.filter((a) => a.agotado));

	onMount(() => {
		if (!$isAuthenticated) {
			goto('/public/portal');
			return;
		}
		void cargar();
	});
</script>

<svelte:head>
	<title>Viáticos · Portal Conductor</title>
</svelte:head>

<div class="pv">
	<PortalHeader
		eyebrow="Mis anticipos"
		titulo="Viáticos"
		meta={cargando ? 'Cargando…' : `Saldo disponible: ${moneda(totales.saldo)}`}
		mascota="exito"
	/>

	<p class="pv-app" in:fade>
		Para reportar un gasto con la foto de la factura o pedir más dinero, usa la app móvil de
		Cotransmeq.
	</p>

	{#if error}
		<p class="pv-error">{error}</p>
	{/if}

	{#if cargando}
		<div class="pv-esqueleto" aria-hidden="true"></div>
		<div class="pv-esqueleto" aria-hidden="true"></div>
	{:else if anticipos.length === 0}
		<p class="pv-vacio">No tienes anticipos de viáticos registrados.</p>
	{:else}
		{#snippet tarjeta(a: AnticipoResumen)}
			{@const d = detalles[a.id]}
			<article class="pv-tarjeta">
				<button
					type="button"
					class="pv-cabecera"
					aria-expanded={abierto === a.id}
					onclick={() => alternar(a.id)}
				>
					<div class="pv-titulo">
						<strong>{a.concepto}</strong>
						<span>{a.vehiculo.placa} · {fechaCorta(a.fecha)} · {METODO_LABELS[a.metodo]}</span>
					</div>
					<span class="pv-chip" style="--c: {colorSaldo(a)}">{etiquetaSaldo(a)}</span>
				</button>
				<BarraSaldo saldo={a} compacta />
				{#if a.solicitud_pendiente}
					<p class="pv-pendiente">
						Pediste {moneda(a.solicitud_pendiente.valor_solicitado)}: operaciones la está revisando.
					</p>
				{/if}
				{#if abierto === a.id}
					<div class="pv-detalle" transition:slide={{ duration: 180 }}>
						{#if cargandoDetalle === a.id && !d}
							<p class="pv-nota">Cargando…</p>
						{:else if d}
							<h3>Gastos reportados</h3>
							{#if d.gastos.length === 0}
								<p class="pv-nota">Todavía no has reportado gastos de este anticipo.</p>
							{:else}
								<ul class="pv-gastos">
									{#each d.gastos as g (g.id)}
										<li class:pv-anulado={g.anulado}>
											<div>
												<strong>{moneda(g.valor)}</strong>
												<span
													>{fechaCorta(g.fecha)}{g.descripcion ? ` · ${g.descripcion}` : ''}</span
												>
												{#if g.anulado}
													<span class="pv-motivo">Anulado: {g.motivo_anulacion}</span>
												{/if}
											</div>
											<span class="pv-adj">
												{g.adjuntos.length}
												{g.adjuntos.length === 1 ? 'factura' : 'facturas'}
											</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if d.solicitudes.length}
								<h3>Solicitudes</h3>
								<ul class="pv-gastos">
									{#each d.solicitudes as s (s.id)}
										<li>
											<div>
												<strong>{moneda(s.valor_solicitado)}</strong>
												<span>
													{fechaCorta(s.created_at)} ·
													{s.estado === 'PENDIENTE'
														? 'En revisión'
														: s.estado === 'APROBADA'
															? 'Aprobada'
															: `Rechazada: ${s.motivo_rechazo}`}
												</span>
											</div>
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					</div>
				{/if}
			</article>
		{/snippet}

		{#if activos.length}
			<PortalSection titulo="Con saldo" meta={String(activos.length)}>
				<div class="pv-lista">
					{#each activos as a (a.id)}{@render tarjeta(a)}{/each}
				</div>
			</PortalSection>
		{/if}
		{#if cerrados.length}
			<PortalSection titulo="Agotados" tono="historial" meta={String(cerrados.length)}>
				<div class="pv-lista">
					{#each cerrados as a (a.id)}{@render tarjeta(a)}{/each}
				</div>
			</PortalSection>
		{/if}
	{/if}
</div>

<style>
	.pv {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-bottom: 32px;
	}
	.pv-app {
		margin: 0;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--au-tint, #e7f6ef);
		color: var(--au-dark, #064e3b);
		font-size: 14px;
	}
	.pv-error {
		margin: 0;
		padding: 12px 14px;
		border-radius: 14px;
		background: #fee2e2;
		color: #b42318;
		font-size: 14px;
	}
	.pv-vacio,
	.pv-nota {
		margin: 0;
		color: var(--text-secondary, #66756f);
		font-size: 14px;
	}
	.pv-vacio {
		padding: 32px 0;
		text-align: center;
	}
	.pv-esqueleto {
		height: 110px;
		border-radius: 18px;
		background: linear-gradient(90deg, #eef2f0 25%, #f7f9f8 50%, #eef2f0 75%);
		background-size: 200% 100%;
		animation: pv-brillo 1.2s infinite;
	}
	@keyframes pv-brillo {
		to {
			background-position: -200% 0;
		}
	}
	.pv-lista {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.pv-tarjeta {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		border-radius: 18px;
		background: var(--bg-surface, #fff);
		box-shadow: 0 2px 10px rgba(0, 29, 23, 0.06);
	}
	.pv-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.pv-titulo {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pv-titulo strong {
		color: var(--text-primary, #10201b);
		font-size: 15px;
	}
	.pv-titulo span {
		color: var(--text-secondary, #66756f);
		font-size: 12px;
	}
	.pv-chip {
		--c: #66756f;
		flex-shrink: 0;
		padding: 3px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--c) 14%, transparent);
		color: var(--c);
		font-size: 12px;
		font-weight: 700;
	}
	.pv-pendiente {
		margin: 0;
		color: #b45309;
		font-size: 13px;
		font-weight: 600;
	}
	.pv-detalle {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--border-default, #e3e9e6);
	}
	.pv-detalle h3 {
		margin: 4px 0 0;
		color: var(--text-secondary, #66756f);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.pv-gastos {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pv-gastos li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 12px;
		background: var(--bg-muted, #f5f7f6);
		font-size: 13px;
	}
	.pv-gastos li > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pv-gastos strong {
		font-variant-numeric: tabular-nums;
	}
	.pv-gastos span {
		color: var(--text-secondary, #66756f);
	}
	.pv-anulado strong {
		text-decoration: line-through;
	}
	.pv-motivo {
		color: #b42318 !important;
	}
	.pv-adj {
		flex-shrink: 0;
		font-size: 12px;
	}
</style>
