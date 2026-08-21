<!--
	Indicador de sincronización del portal.

	Siempre lleva TEXTO además del color: el conductor mira esto al sol, en un
	teléfono de gama baja, y un punto amarillo frente a uno verde es
	indistinguible. Por el mismo motivo el icono es un carácter y no un matiz.

	Muestra la antigüedad de lo pendiente, no solo el número. «3 pendientes» no
	dice nada; «3 pendientes, la más vieja de hace 2 h» le dice que algo va mal y
	que conviene buscar señal.
-->
<script lang="ts">
	import { syncState, wakeAll } from '$lib/offline/forms-sync';

	interface Props {
		/** Compacto para la barra superior; extendido para la pantalla de lista. */
		variant?: 'chip' | 'panel';
	}

	let { variant = 'chip' }: Props = $props();

	const estado = $derived($syncState);

	const etiqueta = $derived.by(() => {
		switch (estado.phase) {
			case 'syncing':
				return 'Sincronizando…';
			case 'checking':
				return 'Comprobando conexión…';
			case 'offline':
				return estado.pending > 0 ? 'Sin conexión · guardado en el teléfono' : 'Sin conexión';
			case 'paused-auth':
				return 'Sesión vencida · vuelve a entrar';
			case 'blocked':
				return 'Hay envíos que necesitan corrección';
			default:
				return estado.pending > 0 ? 'Pendiente de enviar' : 'Todo sincronizado';
		}
	});

	const icono = $derived.by(() => {
		switch (estado.phase) {
			case 'syncing':
			case 'checking':
				return '↻';
			case 'offline':
				return '⚡';
			case 'paused-auth':
				return '🔒';
			case 'blocked':
				return '!';
			default:
				return estado.pending > 0 ? '↑' : '✓';
		}
	});

	const tono = $derived.by(() => {
		if (estado.phase === 'blocked' || estado.phase === 'paused-auth') return 'error';
		if (estado.phase === 'offline' || estado.pending > 0) return 'espera';
		return 'ok';
	});

	function edadLegible(ms: number | null): string | null {
		if (ms == null) return null;
		const minutos = Math.floor(ms / 60000);
		if (minutos < 1) return 'hace menos de un minuto';
		if (minutos < 60) return `hace ${minutos} min`;
		const horas = Math.floor(minutos / 60);
		if (horas < 24) return `hace ${horas} h`;
		return `hace ${Math.floor(horas / 24)} d`;
	}

	const edad = $derived(edadLegible(estado.oldestAgeMs));

	/// El texto solo cambia de palabra; sin movimiento el conductor no distingue
	/// «sincronizando» de «sincronizado» de un vistazo, que es como se mira esto.
	const trabajando = $derived(estado.phase === 'syncing' || estado.phase === 'checking');
</script>

{#if variant === 'chip'}
	<button
		type="button"
		class="chip chip--{tono}"
		aria-live="polite"
		title={etiqueta}
		onclick={() => wakeAll()}
	>
		<span class="chip__icono" class:girando={trabajando} aria-hidden="true">{icono}</span>
		<span class="chip__texto">{etiqueta}</span>
		{#if estado.pending > 0}
			<span class="chip__conteo">{estado.pending}</span>
		{/if}
	</button>
{:else}
	<section class="panel panel--{tono}" class:panel--trabajando={trabajando} aria-live="polite">
		<div class="panel__fila">
			<span class="panel__icono" class:girando={trabajando} aria-hidden="true">{icono}</span>
			<div class="panel__texto">
				<p class="panel__titulo">{etiqueta}</p>
				{#if estado.pending > 0}
					<p class="panel__detalle">
						{estado.pending} operación{estado.pending === 1 ? '' : 'es'} en cola{#if edad}, la más
							antigua {edad}{/if}.
					</p>
				{/if}
				{#if estado.blocked > 0}
					<p class="panel__detalle">
						{estado.blocked} necesita{estado.blocked === 1 ? '' : 'n'} corrección antes de reenviarse.
					</p>
				{/if}
				{#if estado.phase === 'offline'}
					<p class="panel__detalle">
						Todo lo diligenciado está guardado en este teléfono. Se enviará solo al recuperar señal.
					</p>
				{/if}
				{#if estado.phase === 'paused-auth'}
					<p class="panel__detalle">
						Tus datos están a salvo. Solicita un enlace nuevo y la sincronización continúa donde
						quedó.
					</p>
				{/if}
				{#if estado.lastError && estado.phase !== 'idle'}
					<p class="panel__error">
						<span class="panel__code">{estado.lastError.code}</span>
						{estado.lastError.message}
					</p>
				{/if}
			</div>
		</div>

		{#if estado.pending > 0 && estado.phase !== 'syncing'}
			<button type="button" class="panel__accion" onclick={() => wakeAll()}>Intentar ahora</button>
		{/if}
	</section>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 36px;
		padding: 0 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 999px;
		border: 1px solid transparent;
		cursor: pointer;
	}

	.chip--ok {
		background: #f0fdf4;
		border-color: #bbf7d0;
		color: #166534;
	}

	.chip--espera {
		background: #fffbeb;
		border-color: #fde68a;
		color: #92400e;
	}

	.chip--error {
		background: #fef2f2;
		border-color: #fecaca;
		color: #991b1b;
	}

	.chip__icono {
		font-size: 0.8125rem;
	}

	.chip__texto {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 11rem;
	}

	.chip__conteo {
		padding: 0 0.3125rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		background: rgba(255, 255, 255, 0.7);
		border-radius: 999px;
	}

	.panel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		border-radius: 12px;
		border: 1px solid transparent;
	}

	.panel--ok {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}

	.panel--espera {
		background: #fffbeb;
		border-color: #fde68a;
	}

	.panel--error {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.panel__fila {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		flex: 1;
		min-width: 12rem;
		/* Por encima del barrido de .panel--trabajando::after. */
		position: relative;
	}

	.panel__icono {
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		font-size: 0.875rem;
		background: rgba(255, 255, 255, 0.75);
		border-radius: 999px;
	}

	.panel__titulo {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.panel__detalle {
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-secondary, #4a4a4a);
	}

	.panel__error {
		margin-top: 0.3125rem;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: #991b1b;
	}

	.panel__code {
		font-family: var(--font-mono, monospace);
		font-weight: 700;
		margin-right: 0.25rem;
	}

	.panel__accion {
		position: relative;
		min-height: 40px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
	}

	/* Movimiento explícito mientras se sincroniza: el giro para el icono y un
	   barrido tenue en el panel. Ambos se apagan con movimiento reducido; el
	   texto sigue diciendo lo mismo. */
	.girando {
		display: inline-grid;
		animation: girar 1.1s linear infinite;
	}

	@keyframes girar {
		to {
			transform: rotate(360deg);
		}
	}

	.panel--trabajando {
		position: relative;
		overflow: hidden;
	}

	.panel--trabajando::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.55) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: barrido 1.6s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes barrido {
		to {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.girando,
		.panel--trabajando::after {
			animation: none;
		}

		.panel--trabajando::after {
			display: none;
		}
	}

	.chip:focus-visible,
	.panel__accion:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}
</style>
