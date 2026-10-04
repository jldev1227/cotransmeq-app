<script lang="ts">
	/**
	 * Visor de guías interactivas: oscurece la pantalla, deja un foco sobre el
	 * elemento del paso y pone al lado una tarjeta con el título, el texto y
	 * los botones Anterior / Siguiente. Lo monta el layout del dashboard y se
	 * activa cuando `guiaActiva` tiene algo (lo pone el panel del asistente).
	 *
	 * Comportamientos que no se ven a simple vista:
	 *  - un paso con `ruta` navega primero y espera a que cargue;
	 *  - un paso con `accion: 'clic'` enseña el elemento un momento, hace clic
	 *    por el usuario (abre el modal o la pestaña) y pasa al siguiente;
	 *  - si el siguiente paso señala algo que todavía no existe en pantalla
	 *    (lo revela el elemento actual), el paso exige que el usuario use el
	 *    elemento y bloquea el resto de la página hasta que lo haga;
	 *  - la tarjeta se recoloca sola cuando el elemento se mueve (scroll,
	 *    animaciones de entrada, cambios de tamaño).
	 */
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ChevronLeft, ChevronRight, Lightbulb, X } from 'lucide-svelte';
	import { guiaActiva, irAPaso, terminarGuia } from '$lib/stores/guia';
	import {
		ATRIBUTO_VISOR,
		bloquearInteraccion,
		desbloquearInteraccion,
		esperarAncla,
		esperarInteraccion,
		resolverAncla,
		traerAVista
	} from '$lib/guias/motor';

	const RELLENO = 8;
	const MARGEN = 14;

	let objetivo = $state<HTMLElement | null>(null);
	let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
	let cargando = $state(false);
	let requiereInteraccion = $state(false);
	let anclaPerdida = $state(false);
	let tarjeta = $state<HTMLDivElement | null>(null);
	let posicion = $state<{ top: number; left: number } | null>(null);

	let token = 0;
	let quitarEscucha: (() => void) | null = null;
	let temporizador: ReturnType<typeof setInterval> | null = null;

	const estado = $derived($guiaActiva);
	const paso = $derived(estado ? estado.guia.pasos[estado.paso] : null);
	const total = $derived(estado ? estado.guia.pasos.length : 0);
	const esUltimo = $derived(estado ? estado.paso === total - 1 : false);

	const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

	function rutaActual(): string {
		return `${$page.url.pathname}${$page.url.search}`;
	}

	function limpiarPaso() {
		desbloquearInteraccion();
		quitarEscucha?.();
		quitarEscucha = null;
		requiereInteraccion = false;
		anclaPerdida = false;
		objetivo = null;
		rect = null;
		posicion = null;
	}

	async function aplicar(indice: number) {
		const actual = $guiaActiva;
		if (!actual) return;
		const miToken = ++token;
		const vigente = () => token === miToken && $guiaActiva === actual;
		limpiarPaso();
		cargando = true;

		const p = actual.guia.pasos[indice];
		if (p.ruta && rutaActual() !== p.ruta) {
			await goto(p.ruta);
			await dormir(700);
			if (!vigente()) return;
		}

		let el: HTMLElement | null = null;
		if (p.ancla) {
			// Hasta 15 s: una pantalla pesada tarda en pintar su cabecera.
			el = await esperarAncla(p.ancla, 50, 300);
			if (!vigente()) return;
			if (!el) {
				anclaPerdida = true;
				cargando = false;
				return;
			}
			await traerAVista(el);
			if (!vigente()) return;
		}
		objetivo = el;
		cargando = false;
		if (!el) return;
		medir();

		if (p.accion === 'clic') {
			// Que se vea qué se va a pulsar, y se pulsa por el usuario.
			await dormir(900);
			if (!vigente()) return;
			el.click();
			await dormir(250);
			if (!vigente()) return;
			if (indice < actual.guia.pasos.length - 1) irAPaso(indice + 1);
			else terminarGuia();
			return;
		}

		// Si el siguiente paso apunta a algo que aún no está (lo abre este
		// elemento), el usuario tiene que usarlo para seguir.
		const siguiente = actual.guia.pasos[indice + 1];
		const revela = !!siguiente?.ancla && !siguiente.ruta && !resolverAncla(siguiente.ancla);
		if (revela) {
			requiereInteraccion = true;
			bloquearInteraccion(el);
			quitarEscucha = esperarInteraccion(el, () => {
				setTimeout(() => {
					if (vigente()) irAPaso(indice + 1);
				}, 450);
			});
		}
	}

	function medir() {
		if (!objetivo) return;
		if (!objetivo.isConnected) {
			anclaPerdida = true;
			objetivo = null;
			rect = null;
			return;
		}
		const r = objetivo.getBoundingClientRect();
		const nuevo = {
			top: r.top - RELLENO,
			left: r.left - RELLENO,
			width: r.width + RELLENO * 2,
			height: r.height + RELLENO * 2
		};
		if (
			!rect ||
			Math.abs(rect.top - nuevo.top) > 0.5 ||
			Math.abs(rect.left - nuevo.left) > 0.5 ||
			Math.abs(rect.width - nuevo.width) > 0.5 ||
			Math.abs(rect.height - nuevo.height) > 0.5
		) {
			rect = nuevo;
		}
		colocarTarjeta();
	}

	/** Debajo del foco si cabe; si no, encima; si no, a un lado; si no, abajo del todo. */
	function colocarTarjeta() {
		if (!tarjeta) return;
		const w = tarjeta.offsetWidth;
		const h = tarjeta.offsetHeight;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
		let top: number;
		let left: number;
		if (!rect) {
			top = Math.max(12, (vh - h) / 2);
			left = Math.max(12, (vw - w) / 2);
		} else {
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			left = limitar(cx - w / 2, 12, vw - w - 12);
			if (rect.top + rect.height + MARGEN + h <= vh - 12) {
				top = rect.top + rect.height + MARGEN;
			} else if (rect.top - MARGEN - h >= 12) {
				top = rect.top - MARGEN - h;
			} else if (rect.left + rect.width + MARGEN + w <= vw - 12) {
				left = rect.left + rect.width + MARGEN;
				top = limitar(cy - h / 2, 12, vh - h - 12);
			} else if (rect.left - MARGEN - w >= 12) {
				left = rect.left - MARGEN - w;
				top = limitar(cy - h / 2, 12, vh - h - 12);
			} else {
				top = vh - h - 24;
			}
		}
		if (!posicion || Math.abs(posicion.top - top) > 0.5 || Math.abs(posicion.left - left) > 0.5) {
			posicion = { top, left };
		}
	}

	function siguiente() {
		if (!estado || cargando || requiereInteraccion) return;
		if (esUltimo) terminarGuia();
		else irAPaso(estado.paso + 1);
	}

	/** Vuelve a buscar el elemento del paso actual (la pantalla puede haber terminado de cargar). */
	function reintentar() {
		if (!estado) return;
		void aplicar(estado.paso);
	}

	function anterior() {
		if (!estado || cargando || estado.paso === 0) return;
		irAPaso(estado.paso - 1);
	}

	function teclado(e: KeyboardEvent) {
		if (!estado) return;
		if (e.key === 'Escape') {
			// Solo cierra la guía: el modal que esté abierto (también escucha
			// Escape en window) se queda, que es lo que el usuario estaba viendo.
			e.preventDefault();
			e.stopImmediatePropagation();
			terminarGuia();
		} else if (e.key === 'ArrowRight') {
			siguiente();
		} else if (e.key === 'ArrowLeft') {
			anterior();
		}
	}

	// Un efecto por cambio de paso. Lee `paso` (índice) y la guía: si cambia
	// cualquiera de los dos se vuelve a aplicar; al cerrarse, se limpia.
	$effect(() => {
		const e = $guiaActiva;
		if (!e) {
			token++;
			limpiarPaso();
			cargando = false;
			return;
		}
		void aplicar(e.paso);
	});

	// Mientras hay guía, se mide periódicamente: las transiciones de entrada
	// mueven los elementos sin disparar ningún evento.
	$effect(() => {
		if (!estado) return;
		medir();
		temporizador = setInterval(() => medir(), 150);
		const alMover = () => medir();
		window.addEventListener('resize', alMover);
		window.addEventListener('scroll', alMover, true);
		return () => {
			if (temporizador) clearInterval(temporizador);
			temporizador = null;
			window.removeEventListener('resize', alMover);
			window.removeEventListener('scroll', alMover, true);
		};
	});

	// La tarjeta cambia de tamaño con el texto de cada paso.
	$effect(() => {
		void paso;
		void tarjeta;
		colocarTarjeta();
	});

	onDestroy(() => {
		token++;
		limpiarPaso();
	});
</script>

<svelte:window onkeydown={teclado} />

{#if estado && paso}
	<!-- Oscurecimiento con hueco: un cuadro sobre el objetivo cuya sombra tapa el resto. -->
	{#if rect}
		<div
			{...{ [ATRIBUTO_VISOR]: '' }}
			class="guia-foco"
			style="top:{rect.top}px; left:{rect.left}px; width:{rect.width}px; height:{rect.height}px;"
		></div>
	{:else}
		<div {...{ [ATRIBUTO_VISOR]: '' }} class="guia-velo"></div>
	{/if}

	<div
		{...{ [ATRIBUTO_VISOR]: '' }}
		bind:this={tarjeta}
		class="guia-tarjeta"
		class:guia-tarjeta--oculta={!posicion}
		style={posicion ? `top:${posicion.top}px; left:${posicion.left}px;` : ''}
		role="dialog"
		aria-label="Guía: {estado.guia.titulo}"
	>
		<header class="guia-cabecera">
			<span class="guia-icono"><Lightbulb size={14} strokeWidth={2.2} /></span>
			<span class="guia-nombre">{estado.guia.titulo}</span>
			<span class="guia-contador">{estado.paso + 1} / {total}</span>
			<button type="button" class="guia-cerrar" aria-label="Salir de la guía" onclick={terminarGuia}>
				<X size={15} />
			</button>
		</header>
		<h3 class="guia-titulo">{paso.titulo}</h3>
		<p class="guia-texto">{paso.texto}</p>
		{#if cargando}
			<p class="guia-nota">Buscando el elemento en pantalla…</p>
		{:else if anclaPerdida}
			<p class="guia-nota guia-nota--aviso">
				No encontré este elemento en pantalla. Si la página aún estaba cargando, reintenta; si no,
				puede que no esté disponible con tus permisos o con la pestaña actual.
				<button type="button" class="guia-reintentar" onclick={reintentar}>Reintentar</button>
			</p>
		{:else if requiereInteraccion}
			<p class="guia-nota guia-nota--accion">Usa el elemento resaltado para continuar.</p>
		{/if}
		<footer class="guia-pie">
			<div class="guia-puntos" aria-hidden="true">
				{#each estado.guia.pasos as _, i (i)}
					<span class="guia-punto" class:guia-punto--activo={i === estado.paso}></span>
				{/each}
			</div>
			<div class="guia-botones">
				<button type="button" class="guia-btn" disabled={estado.paso === 0 || cargando} onclick={anterior}>
					<ChevronLeft size={14} /> Anterior
				</button>
				<button
					type="button"
					class="guia-btn guia-btn--primario"
					disabled={cargando || requiereInteraccion}
					onclick={siguiente}
				>
					{esUltimo ? 'Finalizar' : 'Siguiente'}
					{#if !esUltimo}<ChevronRight size={14} />{/if}
				</button>
			</div>
		</footer>
	</div>
{/if}

<style>
	/* Por encima de los modales (ModalBase: 10040) y del canvas (9999). */
	/* Entrada con animación CSS y salida inmediata: una transición de Svelte en
	   un bloque que se desmonta mientras su interior cambia dejaba el velo
	   «inert» y a medio desvanecer. */
	@keyframes guia-aparecer {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.guia-foco {
		position: fixed;
		z-index: 10100;
		animation: guia-aparecer 0.18s ease-out;
		border-radius: 10px;
		box-shadow:
			0 0 0 2px rgba(255, 255, 255, 0.95),
			0 0 0 100vmax rgba(15, 23, 42, 0.62);
		pointer-events: none;
		transition:
			top 0.22s ease,
			left 0.22s ease,
			width 0.22s ease,
			height 0.22s ease;
	}
	.guia-velo {
		position: fixed;
		inset: 0;
		z-index: 10100;
		animation: guia-aparecer 0.18s ease-out;
		background: rgba(15, 23, 42, 0.62);
		pointer-events: none;
	}
	.guia-tarjeta {
		position: fixed;
		z-index: 10110;
		animation: guia-aparecer 0.18s ease-out;
		width: min(340px, calc(100vw - 24px));
		padding: 0.85rem 0.95rem 0.8rem;
		border-radius: 14px;
		background: var(--bg-surface, #fff);
		color: var(--text-primary, #17201d);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		box-shadow:
			0 18px 50px rgba(0, 0, 0, 0.28),
			0 2px 8px rgba(0, 0, 0, 0.12);
		transition:
			top 0.22s ease,
			left 0.22s ease;
	}
	.guia-tarjeta--oculta {
		visibility: hidden;
	}
	.guia-cabecera {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.55rem;
	}
	.guia-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: var(--emerald-600, #079665);
		color: #fff;
	}
	.guia-nombre {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted, #66756f);
	}
	.guia-contador {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted, #66756f);
	}
	.guia-cerrar {
		display: inline-flex;
		padding: 0.2rem;
		border-radius: 6px;
		color: var(--text-muted, #66756f);
	}
	.guia-cerrar:hover {
		background: var(--bg-base, #f4f6f5);
		color: var(--text-primary, #17201d);
	}
	.guia-titulo {
		margin: 0 0 0.3rem;
		font-size: 0.98rem;
		font-weight: 700;
		line-height: 1.3;
	}
	.guia-texto {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary, #33423d);
	}
	.guia-nota {
		margin: 0.55rem 0 0;
		font-size: 0.76rem;
		color: var(--text-muted, #66756f);
	}
	.guia-nota--aviso {
		color: #92400e;
	}
	.guia-reintentar {
		margin-left: 0.35rem;
		padding: 0.12rem 0.5rem;
		border-radius: 6px;
		font-weight: 600;
		color: #92400e;
		background: rgba(146, 64, 14, 0.1);
	}
	.guia-reintentar:hover {
		background: rgba(146, 64, 14, 0.18);
	}
	.guia-nota--accion {
		color: var(--emerald-700, #075c49);
		font-weight: 600;
	}
	.guia-pie {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.8rem;
	}
	.guia-puntos {
		display: flex;
		gap: 0.25rem;
	}
	.guia-punto {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--border-default, #d4d4d8);
	}
	.guia-punto--activo {
		width: 16px;
		background: var(--emerald-600, #079665);
	}
	.guia-botones {
		display: flex;
		gap: 0.4rem;
	}
	.guia-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.38rem 0.65rem;
		border-radius: 8px;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-secondary, #33423d);
		background: var(--bg-base, #f4f6f5);
	}
	.guia-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.guia-btn--primario {
		color: #fff;
		background: var(--emerald-600, #079665);
	}
	.guia-btn--primario:not(:disabled):hover {
		background: var(--emerald-700, #075c49);
	}
</style>
