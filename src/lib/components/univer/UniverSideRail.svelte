<!--
	UniverSideRail — carril vertical de acciones a la derecha del canvas.

	POR QUÉ EXISTE:
	  El header de los canvas es una sola fila de altura fija (52px, ver
	  `UniverShell`) y crece hacia la izquierda a medida que se añaden
	  acciones. En cierres finales ya convivían nueve controles y el título
	  empezaba a truncarse; cada acción nueva —sincronizar nómina, dar de
	  alta un conductor, un concepto— empujaba a los selectores fuera de
	  pantalla.

	  El carril separa las dos naturalezas que estaban mezcladas ahí:

	    · El HEADER se queda con el CONTEXTO: dónde estoy (periodo, hoja
	      activa), quién más está conectado, si hay algo sin guardar.
	    · El CARRIL concentra lo que se HACE sobre ese contexto.

	  Es tan ancho como alto es el header —los dos salen de
	  `--univer-header-h`—, así que el canvas queda enmarcado con el mismo
	  grosor por arriba y por la derecha. Aun así conserva el protagonismo:
	  la etiqueta de cada acción no vive en la barra, aparece en un popover
	  al pasar por encima. Es el mismo trato que dan VS Code o Figma a sus
	  rails, y por el mismo motivo — el icono es el ancla visual, el texto
	  solo hace falta cuando dudas.

	CONTRATO:
	  · El carril NO conoce ninguna acción concreta: recibe `items` y
	    renderiza. Toda la lógica (qué se habilita, qué hace) vive en la
	    page, que es quien tiene el estado.
	  · Un item con `panel` abre un flyout en vez de ejecutar. Sirve para
	    alojar controles que ya existen y son demasiado ricos para caber en
	    un icono (el bloque de estado de un cierre, por ejemplo) sin tener
	    que reescribirlos.
	  · `disabled` + `disabledHint` es el par importante: un icono apagado
	    sin explicación es exactamente el problema que este componente viene
	    a resolver. Si algo no se puede pulsar, el popover dice por qué.

	⚠️ ESPERAS: `busy` solo sirve para acciones INSTANTÁNEAS y locales. Un
	spinner de 14px en un botón de 40×40 pegado al borde derecho es invisible
	para quien está mirando las celdas, que es donde está la vista después de
	pulsar. Si la acción va al servidor —y casi todas las de este carril van—,
	usa `UniverActionOverlay`: cubre canvas y carril, dice QUÉ se está
	haciendo y sobre qué hoja, e impide lanzar una segunda acción encima.

	Uso:
	  <UniverSideRail items={[
	    { id: 'sync', label: 'Sincronizar con nómina', hint: '…', icon: iconSync,
	      onSelect: () => sincronizar(), disabled: !!accionEnCurso },
	    { type: 'sep' },
	    { id: 'estado', label: 'Estado', icon: iconCheck, panel: panelEstado }
	  ]} />
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface RailAction {
		type?: 'button';
		/// Estable: es la clave del `{#each}` y la identidad del flyout abierto.
		id: string;
		/// Título del popover y `aria-label` del botón.
		label: string;
		/// Una línea explicando qué hace. Es lo que sustituye al texto del botón.
		hint?: string;
		icon: Snippet;
		tone?: 'default' | 'green' | 'blue' | 'red';
		disabled?: boolean;
		/// Por qué está deshabilitado. Gana sobre `hint` en el popover.
		disabledHint?: string;
		/// Muestra spinner y bloquea el botón sin apagarlo visualmente.
		/// Solo para esperas instantáneas — ver el aviso de la cabecera.
		busy?: boolean;
		/// Contador sobre el icono (borradores pendientes, conflictos…).
		badge?: string | number | null;
		onSelect?: () => void;
		/// Si viene, el clic abre este flyout en vez de llamar a `onSelect`.
		panel?: Snippet;
		panelWidth?: number;
		/**
		 * Fondo del flyout.
		 *
		 * `dark` existe para alojar controles que se escribieron para el
		 * header oscuro y llevan el texto en blanco (`univer-btn-dark`,
		 * `.ceh-msg`): sobre un panel claro serían invisibles. Reestilarlos
		 * costaría tocar componentes de cientos de líneas para un cambio que
		 * es puramente de ubicación.
		 */
		panelTone?: 'light' | 'dark';
	}

	export interface RailSeparator {
		type: 'sep';
		id?: string;
	}

	export type RailItem = RailAction | RailSeparator;
</script>

<script lang="ts">
	interface Props {
		items: RailItem[];
		ariaLabel?: string;
	}

	let { items, ariaLabel = 'Acciones del canvas' }: Props = $props();

	/// Id del item cuyo flyout está abierto. Solo uno a la vez: dos paneles
	/// abiertos sobre un canvas de 32px de margen se solapan sin remedio.
	let abierto = $state<string | null>(null);

	function esAccion(i: RailItem): i is RailAction {
		return i.type !== 'sep';
	}

	function activar(it: RailAction) {
		if (it.disabled || it.busy) return;
		if (it.panel) {
			abierto = abierto === it.id ? null : it.id;
			return;
		}
		abierto = null;
		it.onSelect?.();
	}

	/**
	 * Cierre del flyout.
	 *
	 * Va en `pointerdown` y no en `click` para que un clic sobre el canvas
	 * cierre el panel ANTES de que Univer procese la selección de celda: con
	 * `click` el panel se quedaba abierto encima de la celda recién elegida.
	 */
	function alPunteroFuera(e: PointerEvent) {
		if (!abierto) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('[data-rail]')) return;
		abierto = null;
	}

	function alTeclado(e: KeyboardEvent) {
		if (e.key === 'Escape' && abierto) abierto = null;
	}
</script>

<svelte:window onpointerdown={alPunteroFuera} onkeydown={alTeclado} />

<div
	class="rail"
	data-rail
	role="toolbar"
	aria-label={ariaLabel}
	aria-orientation="vertical"
>
	{#each items as it, i (esAccion(it) ? it.id : (it.id ?? `sep-${i}`))}
		{#if !esAccion(it)}
			<div class="rail-sep" role="separator"></div>
		{:else}
			<div class="rail-slot" class:rail-slot-abierto={abierto === it.id}>
				<button
					type="button"
					class="rail-btn rail-{it.tone ?? 'default'}"
					class:rail-on={abierto === it.id}
					aria-label={it.label}
					aria-haspopup={it.panel ? 'dialog' : undefined}
					aria-expanded={it.panel ? abierto === it.id : undefined}
					disabled={it.disabled || it.busy}
					onclick={() => activar(it)}
				>
					{#if it.busy}
						<span class="rail-spin" aria-hidden="true"></span>
					{:else}
						{@render it.icon()}
					{/if}
					{#if it.badge != null && it.badge !== '' && it.badge !== 0}
						<span class="rail-badge">{it.badge}</span>
					{/if}
				</button>

				<!-- El popover del carril: sustituye al texto que llevaría el botón
				     en el header. Se oculta mientras el flyout está abierto, o se
				     solaparían sobre la misma esquina. -->
				<div class="rail-tip" role="tooltip">
					<strong>{it.label}</strong>
					{#if it.disabled && it.disabledHint}
						<span>{it.disabledHint}</span>
					{:else if it.hint}
						<span>{it.hint}</span>
					{/if}
				</div>

				{#if it.panel && abierto === it.id}
					<div
						class="rail-panel rail-panel-{it.panelTone ?? 'light'}"
						role="dialog"
						aria-label={it.label}
						style="width:{it.panelWidth ?? 320}px"
					>
						{@render it.panel()}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	/* El ancho del carril ES la altura del header, leída de la misma variable
	   que la define (`--univer-header-h`, en UniverShell). Escribir 52px aquí
	   funcionaría hoy y quedaría descuadrado el día que alguien ajuste la
	   altura de la barra; así el marco del canvas tiene el mismo grosor por
	   arriba y por la derecha pase lo que pase. */
	.rail {
		flex: 0 0 var(--univer-header-h, 52px);
		width: var(--univer-header-h, 52px);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px 0;
		background: #1e2429;
		border-left: 1px solid rgba(255, 255, 255, 0.08);
		/* Por encima del canvas para que el popover no quede recortado por el
		   `overflow:hidden` del host de Univer. */
		z-index: 20;
		/* Sin overflow: los popovers salen por la izquierda del carril. */
		overflow: visible;
	}

	.rail-sep {
		width: 24px;
		height: 1px;
		margin: 5px 0;
		background: rgba(255, 255, 255, 0.14);
		flex: none;
	}

	.rail-slot {
		position: relative;
		flex: none;
	}

	.rail-btn {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.82);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.rail-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
	}
	.rail-btn:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: 1px;
	}
	.rail-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.rail-btn.rail-on {
		background: rgba(255, 255, 255, 0.24);
		border-color: rgba(255, 255, 255, 0.35);
		color: #fff;
	}

	/* La escala del icono la decide el carril, no cada snippet: así el
	   llamador dibuja su SVG en el viewBox que quiera y aquí encaja. */
	.rail-btn :global(svg) {
		width: 19px;
		height: 19px;
		flex: none;
	}

	.rail-green {
		background: #059669;
		color: #fff;
	}
	.rail-green:hover:not(:disabled) {
		background: #047857;
	}
	.rail-blue {
		background: #2563eb;
		color: #fff;
	}
	.rail-blue:hover:not(:disabled) {
		background: #1d4ed8;
	}
	.rail-red {
		background: #b91c1c;
		color: #fff;
	}
	.rail-red:hover:not(:disabled) {
		background: #991b1b;
	}

	.rail-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: #f59e0b;
		color: #1e2429;
		font-size: 10px;
		font-weight: 700;
		line-height: 16px;
		text-align: center;
		pointer-events: none;
	}

	.rail-spin {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: rail-spin 0.7s linear infinite;
	}
	@keyframes rail-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ─── Popover ───────────────────────────────────────────────────── */
	/* Alineado al ALTO del botón, no centrado sobre él.
	   Centrarlo (`top:50%; translateY(-50%)`) hacía que el popover del primer
	   icono asomara por encima del carril, y ahí lo recortaba el
	   `overflow:hidden` de `.univer-shell-main`: se perdía justo la línea del
	   título. Creciendo hacia abajo desde el borde superior del botón, el
	   padding del carril garantiza que siempre quede dentro. */
	.rail-tip {
		position: absolute;
		top: 0;
		right: calc(100% + 8px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 240px;
		width: max-content;
		padding: 7px 10px;
		border-radius: 6px;
		background: #0f172a;
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.12s,
			visibility 0.12s;
		pointer-events: none;
		z-index: 30;
	}
	.rail-tip strong {
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.rail-tip span {
		color: rgba(255, 255, 255, 0.6);
		font-size: 11px;
		line-height: 1.4;
	}
	.rail-slot:hover .rail-tip,
	.rail-slot:focus-within .rail-tip {
		opacity: 1;
		visibility: visible;
	}
	/* Con el flyout abierto el popover sobra y estorba. */
	.rail-slot-abierto .rail-tip {
		opacity: 0 !important;
		visibility: hidden !important;
	}

	/* ─── Flyout ────────────────────────────────────────────────────── */
	.rail-panel {
		position: absolute;
		top: 0;
		right: calc(100% + 8px);
		max-height: min(70vh, 560px);
		/* `visible` y no `auto`: los menús desplegables de los controles que
		   se alojan aquí son `position:absolute` y un `overflow:auto` los
		   recortaría contra el borde del panel. */
		overflow: visible;
		padding: 12px;
		border-radius: 8px;
		box-shadow: 0 16px 40px rgba(15, 23, 42, 0.28);
		z-index: 30;
	}
	.rail-panel-light {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		color: #0f172a;
	}
	.rail-panel-dark {
		background: #1e2429;
		border: 1px solid rgba(255, 255, 255, 0.14);
		color: #e2e8f0;
	}

	@media (max-width: 720px) {
		.rail-tip {
			display: none;
		}
		.rail-panel {
			width: min(80vw, 320px) !important;
		}
	}
</style>
