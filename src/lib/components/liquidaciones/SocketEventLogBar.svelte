<script lang="ts">
	/**
	 * Barra fija de eventos de socket, sobre la tabla.
	 *
	 * Muestra lo que acaba de pasar en el módulo mientras el usuario lo tiene
	 * abierto: quién creó, editó o movió de estado una liquidación, una
	 * factura o los terceros de una liquidación.
	 *
	 * JERARQUÍA VISUAL — es lo que decide si esto ayuda o estorba:
	 *
	 *   created / anulada / deleted → acento saturado, punto lleno
	 *   updated                     → acento azul, punto lleno
	 *   estado                      → DELIBERADAMENTE DISCRETO: punto hueco,
	 *                                 texto apagado, sin fondo de color
	 *
	 * Los cambios de estado son, con diferencia, el evento más frecuente en
	 * un mes normal. Con el mismo peso que un alta, la barra parpadearía todo
	 * el rato y el usuario dejaría de mirarla — que es el único modo real de
	 * que un aviso falle.
	 *
	 * Solo se pinta el evento MÁS RECIENTE. El resto queda accesible
	 * desplegando, para que la barra no robe alto vertical a la tabla.
	 */
	import { fade, slide } from 'svelte/transition';
	import { onDestroy } from 'svelte';
	import { X, ChevronDown, ChevronUp, Radio } from 'lucide-svelte';
	import {
		eventLog,
		eventosSinVer,
		descartar,
		limpiarLog,
		marcarTodosVistos,
		describir,
		haceCuanto,
		type EventoLog
	} from '$lib/stores/socketEventLog';

	interface Props {
		/** Salta a la entidad del evento. Si falta, no se pinta el botón "ver". */
		onVer?: (evt: EventoLog) => void;
		/** Cuántos eventos se ven al desplegar. */
		maxDesplegado?: number;
	}

	let { onVer, maxDesplegado = 8 }: Props = $props();

	let desplegado = $state(false);

	/**
	 * Reloj para los "hace 2m".
	 *
	 * `haceCuanto` es una función pura de `(ts, ahora)`: sin este tick el
	 * texto se congelaría en el valor que tuviera al pintarse, porque nada
	 * en el store cambia con el paso del tiempo. 30s es suficiente para que
	 * la granularidad de minutos nunca se vea desfasada.
	 */
	let ahora = $state(Date.now());
	const reloj = setInterval(() => (ahora = Date.now()), 30_000);
	onDestroy(() => clearInterval(reloj));

	const ultimo = $derived($eventLog[0] ?? null);
	const resto = $derived($eventLog.slice(1, maxDesplegado));

	/** Acento por tipo. `estado` cae al gris de texto apagado a propósito. */
	function acento(tipo: EventoLog['tipo']): string {
		switch (tipo) {
			case 'created':
				return 'var(--orange-600)';
			case 'deleted':
			case 'anulada':
				return '#B91C1C';
			case 'estado':
				return 'var(--text-muted)';
			default:
				return '#2563EB';
		}
	}

	function etiquetaTab(scope: EventoLog['scope']): string {
		if (scope === 'facturas') return 'Facturas';
		if (scope === 'terceros') return 'Terceros';
		if (scope === 'configuracion') return 'Configuración';
		return 'Liquidaciones';
	}

	function alternar() {
		desplegado = !desplegado;
		if (desplegado) marcarTodosVistos();
	}
</script>

{#if ultimo}
	<div class="evt-bar" transition:slide={{ duration: 200 }}>
		<div class="evt-row">
			<span
				class="evt-dot"
				class:evt-dot-hueco={ultimo.tipo === 'estado'}
				style="--acento: {acento(ultimo.tipo)}"
				aria-hidden="true"
			></span>

			<span class="evt-scope">{etiquetaTab(ultimo.scope)}</span>

			<span
				class="evt-text"
				class:evt-text-sutil={ultimo.tipo === 'estado'}
				title={describir(ultimo)}
			>
				{describir(ultimo)}
			</span>

			<span class="evt-time">{haceCuanto(ultimo.ts, ahora)}</span>

			<div class="evt-actions">
				{#if onVer && ultimo.entidadId}
					<button class="evt-btn" onclick={() => onVer?.(ultimo)} title="Ir a {ultimo.etiqueta}">
						ver
					</button>
				{/if}

				{#if $eventLog.length > 1}
					<button
						class="evt-btn evt-btn-icon"
						onclick={alternar}
						title={desplegado ? 'Contraer' : `Ver ${$eventLog.length - 1} evento(s) más`}
						aria-expanded={desplegado}
					>
						{#if desplegado}
							<ChevronUp class="h-3.5 w-3.5" />
						{:else}
							<ChevronDown class="h-3.5 w-3.5" />
							<span class="evt-count">{$eventLog.length - 1}</span>
						{/if}
					</button>
				{/if}

				{#if $eventosSinVer > 0}
					<span class="evt-unseen" title="{$eventosSinVer} sin ver">
						<Radio class="h-3 w-3" />
						{$eventosSinVer}
					</span>
				{/if}

				<button
					class="evt-btn evt-btn-icon"
					onclick={() => descartar(ultimo.id)}
					title="Descartar este evento"
					aria-label="Descartar"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>

		{#if desplegado && resto.length > 0}
			<div class="evt-list" transition:slide={{ duration: 180 }}>
				{#each resto as e (e.id)}
					<div class="evt-row evt-row-sub" in:fade={{ duration: 150 }}>
						<span
							class="evt-dot"
							class:evt-dot-hueco={e.tipo === 'estado'}
							style="--acento: {acento(e.tipo)}"
							aria-hidden="true"
						></span>
						<span class="evt-scope">{etiquetaTab(e.scope)}</span>
						<span class="evt-text" class:evt-text-sutil={e.tipo === 'estado'}>
							{describir(e)}
						</span>
						<span class="evt-time">{haceCuanto(e.ts, ahora)}</span>
						<div class="evt-actions">
							{#if onVer && e.entidadId}
								<button class="evt-btn" onclick={() => onVer?.(e)}>ver</button>
							{/if}
							<button
								class="evt-btn evt-btn-icon"
								onclick={() => descartar(e.id)}
								aria-label="Descartar"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				{/each}

				<div class="evt-footer">
					<button class="evt-btn" onclick={limpiarLog}>Limpiar todo</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.evt-bar {
		margin-bottom: 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.evt-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		min-height: 2.25rem;
	}

	.evt-row-sub {
		border-top: 1px solid var(--border-subtle);
	}

	/* Punto de estado. Lleno = alta/edición; hueco = cambio de estado. */
	.evt-dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--acento);
	}

	.evt-dot-hueco {
		background: transparent;
		border: 1.5px solid var(--acento);
	}

	.evt-scope {
		flex: none;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
		background: rgba(0, 0, 0, 0.04);
	}

	.evt-text {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--bg-charcoal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Cambios de estado: presentes pero sin pedir atención. */
	.evt-text-sutil {
		color: var(--text-muted);
		font-weight: 400;
	}

	.evt-time {
		flex: none;
		font-size: 0.7rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.evt-actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.evt-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		padding: 0.2rem 0.4rem;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.evt-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--bg-charcoal);
	}

	.evt-btn-icon {
		padding: 0.2rem;
	}

	.evt-count {
		font-variant-numeric: tabular-nums;
	}

	.evt-unseen {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--orange-600);
		background: rgba(16, 185, 129, 0.1);
		border-radius: 9999px;
		padding: 0.1rem 0.4rem;
		font-variant-numeric: tabular-nums;
	}

	.evt-footer {
		display: flex;
		justify-content: flex-end;
		padding: 0.35rem 0.75rem;
		border-top: 1px solid var(--border-subtle);
		background: rgba(0, 0, 0, 0.015);
	}

	@media (max-width: 640px) {
		.evt-scope,
		.evt-time {
			display: none;
		}
	}
</style>
