<script lang="ts">
	/**
	 * Tooltip global para todo elemento con `title`.
	 *
	 * Se monta una sola vez en el layout raíz y escucha en `document`, así
	 * cubre los ~500 `title=` que ya tiene la app —y los que se rendericen
	 * después— sin tocar ningún marcado. Al entrar en un elemento con `title`,
	 * el texto pasa a `data-title` (para que el navegador no muestre también
	 * el suyo) y se pinta aquí; al salir se restaura, de modo que el atributo
	 * sigue disponible para lectores de pantalla el resto del tiempo.
	 *
	 * También responde al foco de teclado, que el tooltip nativo ignora.
	 */
	import { onMount } from 'svelte';

	/** Espera antes de mostrar: evita el parpadeo al cruzar el cursor. */
	const RETRASO_MS = 350;
	const MARGEN = 8;

	let texto = $state('');
	let visible = $state(false);
	let x = $state(0);
	let y = $state(0);
	/** true → arriba del elemento (flecha abajo); false → debajo. */
	let arriba = $state(true);

	let caja = $state<HTMLDivElement | null>(null);
	let objetivo: HTMLElement | null = null;
	let temporizador: ReturnType<typeof setTimeout> | null = null;

	function elementoConTitulo(desde: EventTarget | null): HTMLElement | null {
		if (!(desde instanceof Element)) return null;
		const el = desde.closest<HTMLElement>('[title], [data-title]');
		return el;
	}

	function colocar() {
		if (!objetivo || !caja) return;
		const r = objetivo.getBoundingClientRect();
		const c = caja.getBoundingClientRect();
		const ancho = window.innerWidth;

		arriba = r.top - c.height - MARGEN >= 0;
		y = arriba ? r.top - c.height - MARGEN : r.bottom + MARGEN;

		let cx = r.left + r.width / 2 - c.width / 2;
		cx = Math.max(MARGEN, Math.min(cx, ancho - c.width - MARGEN));
		x = cx;
	}

	function mostrar(el: HTMLElement) {
		const t = el.getAttribute('title') ?? el.getAttribute('data-title') ?? '';
		if (!t.trim()) return;

		objetivo = el;
		// El título nativo se retira mientras dure el hover.
		if (el.hasAttribute('title')) {
			el.setAttribute('data-title', t);
			el.removeAttribute('title');
		}

		if (temporizador) clearTimeout(temporizador);
		temporizador = setTimeout(() => {
			texto = t;
			visible = true;
			// La caja necesita un frame para medirse con el texto nuevo.
			requestAnimationFrame(colocar);
		}, RETRASO_MS);
	}

	function ocultar() {
		if (temporizador) {
			clearTimeout(temporizador);
			temporizador = null;
		}
		if (objetivo) {
			const t = objetivo.getAttribute('data-title');
			if (t !== null && !objetivo.hasAttribute('title')) objetivo.setAttribute('title', t);
			objetivo.removeAttribute('data-title');
		}
		objetivo = null;
		visible = false;
	}

	onMount(() => {
		const sobre = (e: Event) => {
			const el = elementoConTitulo(e.target);
			if (!el) return;
			if (el === objetivo) return;
			ocultar();
			mostrar(el);
		};
		const fuera = (e: Event) => {
			if (!objetivo) return;
			const rel = (e as MouseEvent).relatedTarget;
			// Sigue dentro del mismo elemento (por ejemplo, pasó al icono).
			if (rel instanceof Node && objetivo.contains(rel)) return;
			ocultar();
		};
		const enfoque = (e: Event) => {
			const el = elementoConTitulo(e.target);
			if (el) {
				ocultar();
				mostrar(el);
			}
		};
		const desenfoque = () => ocultar();
		const tecla = (e: KeyboardEvent) => {
			if (e.key === 'Escape') ocultar();
		};
		const reubicar = () => {
			if (visible) colocar();
		};

		document.addEventListener('pointerover', sobre, true);
		document.addEventListener('pointerout', fuera, true);
		document.addEventListener('pointerdown', ocultar, true);
		document.addEventListener('focusin', enfoque, true);
		document.addEventListener('focusout', desenfoque, true);
		document.addEventListener('keydown', tecla, true);
		window.addEventListener('scroll', reubicar, true);
		window.addEventListener('resize', reubicar);

		return () => {
			ocultar();
			document.removeEventListener('pointerover', sobre, true);
			document.removeEventListener('pointerout', fuera, true);
			document.removeEventListener('pointerdown', ocultar, true);
			document.removeEventListener('focusin', enfoque, true);
			document.removeEventListener('focusout', desenfoque, true);
			document.removeEventListener('keydown', tecla, true);
			window.removeEventListener('scroll', reubicar, true);
			window.removeEventListener('resize', reubicar);
		};
	});
</script>

<div
	bind:this={caja}
	class="tip"
	class:tip--visible={visible}
	class:tip--abajo={!arriba}
	style="left:{x}px; top:{y}px;"
	role="tooltip"
	aria-hidden={!visible}
>
	{texto}
</div>

<style>
	.tip {
		position: fixed;
		z-index: 100000;
		max-width: 280px;
		padding: 0.4rem 0.65rem;
		border-radius: 10px;
		background: var(--bg-charcoal, #0f172a);
		color: #ffffff;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.4;
		letter-spacing: 0;
		text-align: center;
		white-space: normal;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
		pointer-events: none;
		opacity: 0;
		transform: translateY(2px) scale(0.98);
		transition:
			opacity 0.12s ease,
			transform 0.12s ease;
	}
	.tip--visible {
		opacity: 1;
		transform: translateY(0) scale(1);
	}

	/* Flecha hacia el elemento */
	.tip::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -5px;
		width: 10px;
		height: 10px;
		background: inherit;
		transform: translateX(-50%) rotate(45deg);
		border-radius: 2px;
	}
	.tip--abajo::after {
		bottom: auto;
		top: -5px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tip {
			transition: none;
		}
	}
</style>
