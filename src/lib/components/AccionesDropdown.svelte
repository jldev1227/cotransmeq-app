<script lang="ts">
	/**
	 * Menú de acciones de una fila.
	 *
	 * Nació para la tabla de liquidaciones, donde la columna de acciones
	 * llegaba a tener ocho botones en línea y se comía el ancho que necesitan
	 * cliente, periodo y totales. Aquí se colapsa a un solo disparador.
	 *
	 * Dos decisiones que no son cosméticas:
	 *
	 * 1. El panel se posiciona con `position: fixed` y coordenadas calculadas a
	 *    mano, NO con `position: absolute` respecto al disparador. La tabla vive
	 *    dentro de un contenedor con `overflow-x: auto`; un panel absoluto se
	 *    recorta contra ese contenedor y en las últimas filas se ve cortado o
	 *    provoca scroll. Fijo respecto al viewport no lo recorta nadie.
	 *
	 * 2. Se mide el panel ya renderizado antes de colocarlo, y se abre hacia
	 *    ARRIBA si abajo no cabe. Estimar la altura por el número de ítems falla
	 *    en cuanto uno lleva dos líneas o aparece un separador.
	 *
	 * Mientras una acción está en curso el menú NO se cierra: es lo que permite
	 * ver el spinner del ítem que se pulsó. Quien lo consume decide cuándo
	 * cerrarlo con `cerrarAlSeleccionar: false`.
	 */
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { MoreVertical } from 'lucide-svelte';

	export interface AccionMenu {
		id: string;
		etiqueta: string;
		/** Componente de icono (lucide). Opcional. */
		icono?: any;
		/**
		 * Peso visual. `destacada` reserva las tres acciones que el usuario
		 * busca primero (ver, editar, eliminar); el resto va en tono neutro.
		 */
		tono?: 'neutro' | 'ver' | 'editar' | 'eliminar' | 'aprobar' | 'aviso';
		destacada?: boolean;
		/** Pinta el spinner y bloquea el ítem. */
		cargando?: boolean;
		deshabilitada?: boolean;
		/** Texto del `title`/`aria-description` cuando está bloqueada. */
		motivoBloqueo?: string;
		separadorAntes?: boolean;
		/** Por defecto true. En falso el menú queda abierto (acciones con spinner). */
		cerrarAlSeleccionar?: boolean;
		onSelect: () => void;
	}

	interface Props {
		acciones: AccionMenu[];
		/** Se anuncia en el disparador: «Acciones de TM-0042». */
		etiqueta?: string;
		/** Bloquea el disparador entero. */
		deshabilitado?: boolean;
	}

	let { acciones, etiqueta = 'Acciones', deshabilitado = false }: Props = $props();

	/** Margen contra el borde del viewport. */
	const MARGEN = 8;
	/** Separación entre el disparador y el panel. */
	const HUECO = 6;
	const ANCHO = 224;

	let abierto = $state(false);
	let disparador = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLDivElement | null>(null);
	let indiceActivo = $state(-1);

	/**
	 * `null` mientras no se ha medido: el panel se pinta, pero invisible y SIN
	 * `max-height`.
	 *
	 * Lo de «sin max-height» no es un detalle: en la primera versión el estilo
	 * ponía `max-height: 0` mientras `posicion` era null, así que `offsetHeight`
	 * medía casi cero, `colocar()` concluía que cabía en cualquier hueco y el
	 * menú de la última fila se abría hacia abajo y se salía de la pantalla.
	 * Hay que medirlo a su altura natural para poder decidir.
	 */
	let posicion = $state<{ top: number; left: number; maxHeight: number } | null>(null);

	const seleccionables = $derived(acciones.filter((a) => !a.deshabilitada && !a.cargando));
	const hayAlgoEnCurso = $derived(acciones.some((a) => a.cargando));

	/**
	 * Coloca el panel: debajo del disparador si cabe, arriba si no, y con la
	 * altura recortada al hueco disponible para que nunca se salga.
	 */
	function colocar() {
		if (!disparador || !panel) return;

		const t = disparador.getBoundingClientRect();
		const alto = panel.offsetHeight;
		const vh = window.innerHeight;
		const vw = window.innerWidth;

		const espacioAbajo = vh - t.bottom - HUECO - MARGEN;
		const espacioArriba = t.top - HUECO - MARGEN;

		// Se abre hacia abajo salvo que no quepa Y arriba haya más sitio. El
		// «y arriba haya más sitio» importa: en una pantalla baja puede no caber
		// en ninguno de los dos lados, y ahí abajo se lee mejor.
		const haciaArriba = alto > espacioAbajo && espacioArriba > espacioAbajo;

		const maxHeight = Math.max(120, haciaArriba ? espacioArriba : espacioAbajo);
		const top = haciaArriba
			? Math.max(MARGEN, t.top - HUECO - Math.min(alto, maxHeight))
			: t.bottom + HUECO;

		// Alineado a la derecha del disparador, pero sin salirse por ninguno de
		// los dos lados: en pantallas estrechas la columna de acciones queda
		// pegada al borde.
		const left = Math.min(Math.max(MARGEN, t.right - ANCHO), vw - ANCHO - MARGEN);

		posicion = { top, left, maxHeight };
	}

	async function abrir() {
		if (deshabilitado) return;
		abierto = true;
		indiceActivo = -1;
		posicion = null;
		await tick();
		colocar();
	}

	function cerrar(devolverFoco = true) {
		abierto = false;
		posicion = null;
		indiceActivo = -1;
		if (devolverFoco) disparador?.focus();
	}

	function alternar() {
		abierto ? cerrar() : abrir();
	}

	function ejecutar(a: AccionMenu) {
		if (a.deshabilitada || a.cargando) return;
		// Se cierra ANTES de ejecutar cuando corresponde: si la acción navega,
		// cerrar después dejaría el panel pintado sobre la pantalla nueva.
		if (a.cerrarAlSeleccionar !== false) cerrar(false);
		a.onSelect();
	}

	function alTeclear(e: KeyboardEvent) {
		if (!abierto) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			cerrar();
			return;
		}
		if (e.key === 'Tab') {
			cerrar(false);
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
		e.preventDefault();

		if (seleccionables.length === 0) return;

		if (e.key === 'Enter' || e.key === ' ') {
			const a = seleccionables[indiceActivo];
			if (a) ejecutar(a);
			return;
		}
		if (e.key === 'Home') indiceActivo = 0;
		else if (e.key === 'End') indiceActivo = seleccionables.length - 1;
		else if (e.key === 'ArrowDown') indiceActivo = (indiceActivo + 1) % seleccionables.length;
		else indiceActivo = (indiceActivo - 1 + seleccionables.length) % seleccionables.length;
	}

	function alPulsarFuera(e: PointerEvent) {
		if (!abierto) return;
		const destino = e.target as Node;
		if (disparador?.contains(destino) || panel?.contains(destino)) return;
		cerrar(false);
	}

	/**
	 * Con el panel en `fixed`, cualquier scroll del contenedor lo dejaría
	 * flotando lejos de su fila. Se recoloca en vez de cerrarse, salvo que haya
	 * una acción en curso —ahí cerrar perdería el spinner—.
	 */
	function alDesplazar() {
		if (abierto) colocar();
	}

	$effect(() => {
		if (!abierto) return;
		document.addEventListener('pointerdown', alPulsarFuera, true);
		// `capture` para enterarse también del scroll de contenedores internos,
		// que no burbujea.
		document.addEventListener('scroll', alDesplazar, true);
		window.addEventListener('resize', alDesplazar);
		return () => {
			document.removeEventListener('pointerdown', alPulsarFuera, true);
			document.removeEventListener('scroll', alDesplazar, true);
			window.removeEventListener('resize', alDesplazar);
		};
	});
</script>

<svelte:window onkeydown={alTeclear} />

<button
	bind:this={disparador}
	type="button"
	class="disparador"
	class:disparador--activo={abierto}
	class:disparador--ocupado={hayAlgoEnCurso}
	aria-haspopup="menu"
	aria-expanded={abierto}
	aria-label={etiqueta}
	title={etiqueta}
	disabled={deshabilitado}
	onclick={alternar}
>
	{#if hayAlgoEnCurso}
		<span class="giro" aria-hidden="true"></span>
	{:else}
		<MoreVertical class="h-4 w-4" />
	{/if}
</button>

{#if abierto}
	<div
		bind:this={panel}
		class="panel"
		role="menu"
		aria-label={etiqueta}
		tabindex="-1"
		style="top:{posicion?.top ?? 0}px; left:{posicion?.left ?? 0}px; width:{ANCHO}px; max-height:{posicion
			? posicion.maxHeight + 'px'
			: 'none'}; visibility:{posicion ? 'visible' : 'hidden'};"
		transition:fly={{ y: 4, duration: 120 }}
	>
		{#each acciones as a (a.id)}
			{#if a.separadorAntes}
				<div class="separador" role="separator"></div>
			{/if}
			{@const Icono = a.icono}
			{@const idx = seleccionables.indexOf(a)}
			<button
				type="button"
				role="menuitem"
				class="item tono-{a.tono ?? 'neutro'}"
				class:item--destacada={a.destacada}
				class:item--activa={idx >= 0 && idx === indiceActivo}
				disabled={a.deshabilitada || a.cargando}
				title={a.deshabilitada ? (a.motivoBloqueo ?? a.etiqueta) : a.etiqueta}
				onclick={() => ejecutar(a)}
				onmouseenter={() => (indiceActivo = idx)}
			>
				<span class="item-icono" aria-hidden="true">
					{#if a.cargando}
						<span class="giro giro--item"></span>
					{:else if Icono}
						<Icono class="h-3.5 w-3.5" />
					{/if}
				</span>
				<span class="item-texto">{a.etiqueta}</span>
				{#if a.cargando}
					<span class="item-estado">…</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.disparador {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid transparent;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.disparador:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.05);
		color: var(--text-primary);
	}
	.disparador:focus-visible {
		outline: none;
		border-color: rgba(249, 115, 22, 0.5);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
	}
	.disparador--activo {
		background: rgba(0, 0, 0, 0.06);
		color: var(--text-primary);
	}
	.disparador--ocupado {
		color: var(--emerald-700);
	}
	.disparador:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.panel {
		position: fixed;
		z-index: 70;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.3rem;
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 12px;
		box-shadow:
			0 12px 32px rgba(0, 0, 0, 0.14),
			0 2px 6px rgba(0, 0, 0, 0.06);
	}

	.separador {
		height: 1px;
		margin: 0.3rem 0.15rem;
		background: rgba(0, 0, 0, 0.07);
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.44rem 0.55rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		text-align: left;
		cursor: pointer;
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}
	.item:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.item--activa:not(:disabled),
	.item:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.045);
		color: var(--text-primary);
	}

	.item-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		flex-shrink: 0;
	}
	.item-texto {
		flex: 1;
		min-width: 0;
	}
	.item-estado {
		font-size: 0.7rem;
		opacity: 0.7;
	}

	/* ── Las tres que el usuario busca primero llevan color propio ── */
	.item--destacada {
		font-weight: 650;
	}
	.tono-ver.item--destacada {
		color: var(--emerald-700);
	}
	.tono-ver.item--destacada:hover:not(:disabled),
	.tono-ver.item--destacada.item--activa:not(:disabled) {
		background: rgba(249, 115, 22, 0.1);
		color: var(--emerald-700);
	}
	.tono-editar.item--destacada {
		color: #1d4ed8;
	}
	.tono-editar.item--destacada:hover:not(:disabled),
	.tono-editar.item--destacada.item--activa:not(:disabled) {
		background: rgba(37, 99, 235, 0.1);
		color: #1d4ed8;
	}
	.tono-eliminar.item--destacada {
		color: #b91c1c;
	}
	.tono-eliminar.item--destacada:hover:not(:disabled),
	.tono-eliminar.item--destacada.item--activa:not(:disabled) {
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}

	/* ── Cambios de estado ── */
	.tono-aprobar {
		color: var(--emerald-700);
	}
	.tono-aprobar:hover:not(:disabled),
	.tono-aprobar.item--activa:not(:disabled) {
		background: rgba(249, 115, 22, 0.1);
		color: var(--emerald-700);
	}
	.tono-aviso {
		color: #b45309;
	}
	.tono-aviso:hover:not(:disabled),
	.tono-aviso.item--activa:not(:disabled) {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
	}

	.giro {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: giro 0.7s linear infinite;
	}
	.giro--item {
		width: 13px;
		height: 13px;
	}
	@keyframes giro {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.giro {
			animation-duration: 1.6s;
		}
		.item,
		.disparador {
			transition: none;
		}
	}
</style>
