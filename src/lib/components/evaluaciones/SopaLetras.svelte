<script lang="ts">
	/**
	 * La cuadrícula de una sopa de letras, para responderla o para verla.
	 *
	 * ── Interactiva ──
	 * Como una sopa de letras de papel: se presiona la primera letra y se
	 * arrastra hasta la última. La selección se ajusta sola a la dirección más
	 * cercana de las ocho (horizontal, vertical y diagonales, en los dos
	 * sentidos), así que basta con apuntar más o menos. Mientras se arrastra,
	 * una cápsula marca las letras que quedarán dentro y el indicador de arriba
	 * las deletrea y avisa si forman una palabra de la lista.
	 *
	 * Funciona igual con ratón, dedo o lápiz porque usa Pointer Events con
	 * captura: el arrastre sigue aunque el dedo salga de la celda. La celda bajo
	 * el puntero se calcula por coordenadas, no con `elementFromPoint`, y la
	 * cuadrícula lleva `touch-action: none` para que en el teléfono arrastrar
	 * no desplace la página. Antes la cuadrícula eran botones sueltos: el
	 * navegador interpretaba el arrastre como selección de texto y había que
	 * pulsar Shift para que cubriera la palabra.
	 *
	 * Alternativas sin arrastre: tocar la primera letra y luego la última, o
	 * con el teclado, Enter sobre cada una.
	 *
	 * ── Estática ──
	 * Pinta los trazos que recibe (lo que marcó el evaluado, o la clave en el
	 * panel) y no reacciona.
	 */
	import { celdasDeTrazo, normalizarPalabraSopa, type TrazoSopa } from './tipos';

	interface Props {
		cuadricula: string[];
		/** Textos, ya normalizados por el backend. */
		palabras: string[];
		trazos?: TrazoSopa[];
		interactivo?: boolean;
		/** Celdas más pequeñas, para tarjetas y listados. */
		compacta?: boolean;
		mostrarLista?: boolean;
		onCambio?: (trazos: TrazoSopa[]) => void;
	}

	let {
		cuadricula,
		palabras,
		trazos = [],
		interactivo = false,
		compacta = false,
		mostrarLista = true,
		onCambio
	}: Props = $props();

	type Celda = [number, number];

	const filas = $derived(cuadricula.length);
	const columnas = $derived(cuadricula[0]?.length ?? 0);
	const lista = $derived(palabras.map((p) => normalizarPalabraSopa(p)));

	let rejilla = $state<HTMLDivElement | null>(null);
	/** Arrastre en curso. */
	let arrastre = $state<{ desde: Celda; hasta: Celda; movido: boolean; id: number } | null>(null);
	/** Primera letra elegida con un toque (o con Enter), esperando la última. */
	let pendiente = $state<Celda | null>(null);
	/** Celda bajo el ratón mientras hay una letra pendiente: previsualiza. */
	let encima = $state<Celda | null>(null);
	/** Respuesta breve al soltar: la cápsula parpadea en verde o en rojo. */
	let destello = $state<{ trazo: TrazoSopa; ok: boolean } | null>(null);
	let aviso = $state('');
	let temporizador: ReturnType<typeof setTimeout> | undefined;

	const encontradas = $derived(new Set(trazos.map((t) => t.palabra).filter(Boolean) as string[]));

	/** La selección que se está dibujando ahora mismo, sea arrastrando o con toques. */
	const seleccion = $derived.by<TrazoSopa | null>(() => {
		if (arrastre) return { desde: arrastre.desde, hasta: arrastre.hasta };
		if (pendiente)
			return { desde: pendiente, hasta: encima ? ajustar(pendiente, encima) : pendiente };
		return null;
	});
	const celdasSeleccion = $derived(
		new Set((seleccion ? celdasDeTrazo(seleccion) : []).map(([f, c]) => `${f},${c}`))
	);
	const letrasSeleccion = $derived(seleccion ? letrasDe(seleccion) : '');
	const coincidencia = $derived(seleccion ? palabraDe(letrasSeleccion) : null);

	const celdasEncontradas = $derived.by(() => {
		const s = new Set<string>();
		for (const t of trazos) for (const [f, c] of celdasDeTrazo(t)) s.add(`${f},${c}`);
		return s;
	});

	function letrasDe(t: TrazoSopa): string {
		return celdasDeTrazo(t)
			.map(([f, c]) => cuadricula[f]?.[c] ?? '')
			.join('');
	}

	/** La palabra de la lista que forman esas letras, al derecho o al revés. */
	function palabraDe(letras: string): string | null {
		if (letras.length < 2) return null;
		if (lista.includes(letras)) return letras;
		const invertidas = [...letras].reverse().join('');
		return lista.includes(invertidas) ? invertidas : null;
	}

	/**
	 * Lleva el punto `hasta` a la recta más cercana que sale de `desde`:
	 * horizontal, vertical o diagonal a 45°. Así un arrastre algo torcido
	 * sigue siendo una línea válida, como cuando se rodea con el lápiz.
	 */
	function ajustar(desde: Celda, hasta: Celda): Celda {
		const [f0, c0] = desde;
		const df = hasta[0] - f0;
		const dc = hasta[1] - c0;
		const af = Math.abs(df);
		const ac = Math.abs(dc);
		if (af === 0 && ac === 0) return desde;
		// Más de dos a uno hacia un eje: es recta por ese eje.
		if (ac >= 2 * af) return [f0, hasta[1]];
		if (af >= 2 * ac) return [hasta[0], c0];
		// Si no, diagonal; la longitud se recorta para no salir de la cuadrícula.
		const sf = Math.sign(df);
		const sc = Math.sign(dc);
		let n = Math.round((af + ac) / 2);
		const maxF = sf > 0 ? filas - 1 - f0 : f0;
		const maxC = sc > 0 ? columnas - 1 - c0 : c0;
		n = Math.min(n, maxF, maxC);
		return [f0 + sf * n, c0 + sc * n];
	}

	/** Celda bajo el puntero, por coordenadas: la rejilla no tiene huecos entre celdas. */
	function celdaEn(e: PointerEvent): Celda | null {
		if (!rejilla) return null;
		const r = rejilla.getBoundingClientRect();
		const x = (e.clientX - r.left) / r.width;
		const y = (e.clientY - r.top) / r.height;
		const c = Math.min(columnas - 1, Math.max(0, Math.floor(x * columnas)));
		const f = Math.min(filas - 1, Math.max(0, Math.floor(y * filas)));
		return [f, c];
	}

	function mismaCelda(a: Celda, b: Celda) {
		return a[0] === b[0] && a[1] === b[1];
	}

	function terminar(t: TrazoSopa) {
		const letras = letrasDe(t);
		const palabra = palabraDe(letras);
		clearTimeout(temporizador);
		if (!palabra) {
			aviso =
				letras.length < 2 ? '' : `«${letras}» no es una palabra de la lista. Prueba otra vez.`;
			destello = letras.length < 2 ? null : { trazo: t, ok: false };
		} else if (encontradas.has(palabra)) {
			aviso = `«${palabra}» ya está marcada.`;
			destello = null;
		} else {
			aviso = `¡Encontraste «${palabra}»!`;
			destello = { trazo: t, ok: true };
			onCambio?.([...trazos, { palabra, desde: t.desde, hasta: t.hasta }]);
		}
		temporizador = setTimeout(() => (destello = null), 650);
	}

	function alPresionar(e: PointerEvent) {
		if (!interactivo || e.button > 0) return;
		const celda = celdaEn(e);
		if (!celda) return;
		// Sin esto el navegador empieza a seleccionar texto o a arrastrar el botón.
		e.preventDefault();
		rejilla?.setPointerCapture(e.pointerId);
		arrastre = {
			desde: pendiente ?? celda,
			hasta: pendiente ? ajustar(pendiente, celda) : celda,
			movido: false,
			id: e.pointerId
		};
		// Si había una letra pendiente, este gesto la continúa como segundo toque.
		if (!pendiente) aviso = '';
	}

	function alMover(e: PointerEvent) {
		if (!interactivo) return;
		const celda = celdaEn(e);
		if (!celda) return;
		if (arrastre && e.pointerId === arrastre.id) {
			const hasta = ajustar(arrastre.desde, celda);
			if (!mismaCelda(hasta, arrastre.hasta)) {
				arrastre = {
					...arrastre,
					hasta,
					movido: arrastre.movido || !mismaCelda(hasta, arrastre.desde)
				};
			}
		} else if (pendiente && e.pointerType === 'mouse') {
			encima = celda;
		}
	}

	function alSoltar(e: PointerEvent) {
		if (!arrastre || e.pointerId !== arrastre.id) return;
		const { desde, hasta, movido } = arrastre;
		arrastre = null;
		if (rejilla?.hasPointerCapture(e.pointerId)) rejilla.releasePointerCapture(e.pointerId);
		if (movido || pendiente) {
			pendiente = null;
			encima = null;
			terminar({ desde, hasta });
		} else {
			// Un toque sin arrastrar: queda como primera letra.
			pendiente = desde;
			aviso = `Primera letra: «${cuadricula[desde[0]][desde[1]]}». Toca o arrastra hasta la última.`;
		}
	}

	function alCancelar() {
		arrastre = null;
	}

	function alSalir() {
		encima = null;
	}

	/** Teclado: Enter o espacio sobre la primera letra y luego sobre la última. */
	function alTeclear(e: KeyboardEvent, f: number, c: number) {
		if (!interactivo) return;
		if (e.key === 'Escape') {
			pendiente = null;
			encima = null;
			aviso = '';
			return;
		}
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		if (!pendiente) {
			pendiente = [f, c];
			aviso = `Primera letra: «${cuadricula[f][c]}». Ve a la última y pulsa Enter.`;
			return;
		}
		const t = { desde: pendiente, hasta: ajustar(pendiente, [f, c]) };
		pendiente = null;
		encima = null;
		terminar(t);
	}

	function alEnfocar(f: number, c: number) {
		if (pendiente) encima = [f, c];
	}

	function quitar(palabra: string) {
		onCambio?.(trazos.filter((t) => t.palabra !== palabra));
		aviso = `«${palabra}» desmarcada.`;
	}

	/** Coordenadas de la cápsula en unidades de celda (viewBox = columnas × filas). */
	function capsula(t: TrazoSopa) {
		return {
			x1: t.desde[1] + 0.5,
			y1: t.desde[0] + 0.5,
			x2: t.hasta[1] + 0.5,
			y2: t.hasta[0] + 0.5
		};
	}
</script>

<div class="sl" class:sl--compacta={compacta} class:sl--interactiva={interactivo}>
	{#if interactivo}
		<div
			class="sl-indicador"
			class:sl-indicador--ok={!!coincidencia && !encontradas.has(coincidencia)}
			class:sl-indicador--repetida={!!coincidencia && encontradas.has(coincidencia)}
			aria-live="polite"
		>
			{#if seleccion && letrasSeleccion.length > 0}
				<span class="sl-indicador-etiqueta">Selección</span>
				<span class="sl-indicador-letras">
					{#each letrasSeleccion.split('') as letra, i (i)}
						<span class="sl-ficha">{letra}</span>
					{/each}
				</span>
				<span class="sl-indicador-estado">
					{#if coincidencia && encontradas.has(coincidencia)}
						Ya marcada
					{:else if coincidencia}
						¡Es «{coincidencia}»! Suelta para marcarla
					{:else}
						{letrasSeleccion.length} letra{letrasSeleccion.length === 1 ? '' : 's'}
					{/if}
				</span>
			{:else}
				<span class="sl-indicador-ayuda">
					{aviso ||
						'Presiona la primera letra y arrastra hasta la última. Sirve en cualquier dirección.'}
				</span>
			{/if}
		</div>
	{/if}

	<div class="sl-cuerpo">
		<div class="sl-marco">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="sl-rejilla"
				bind:this={rejilla}
				style="grid-template-columns: repeat({columnas}, minmax(0, 1fr))"
				onpointerdown={alPresionar}
				onpointermove={alMover}
				onpointerup={alSoltar}
				onpointercancel={alCancelar}
				onpointerleave={alSalir}
			>
				{#each cuadricula as fila, f (f)}
					{#each fila.split('') as letra, c (c)}
						{@const clave = `${f},${c}`}
						<button
							type="button"
							class="sl-celda"
							class:sl-celda--hallada={celdasEncontradas.has(clave)}
							class:sl-celda--seleccion={celdasSeleccion.has(clave)}
							class:sl-celda--inicio={!!seleccion && mismaCelda(seleccion.desde, [f, c])}
							disabled={!interactivo}
							tabindex={interactivo ? 0 : -1}
							aria-label="Fila {f + 1}, columna {c + 1}: {letra}"
							onkeydown={(e) => alTeclear(e, f, c)}
							onfocus={() => alEnfocar(f, c)}
						>
							<span class="sl-letra">{letra}</span>
						</button>
					{/each}
				{/each}

				<!-- Las cápsulas van ENCIMA de las letras, translúcidas, como el
			     trazo de un marcador; no capturan el puntero. -->
				<svg
					class="sl-capas"
					viewBox="0 0 {columnas} {filas}"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{#each trazos as t, i (i)}
						{@const k = capsula(t)}
						<line class="sl-capsula" x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} />
					{/each}
					{#if destello}
						{@const k = capsula(destello.trazo)}
						<line
							class="sl-capsula sl-capsula--destello"
							class:sl-capsula--mal={!destello.ok}
							x1={k.x1}
							y1={k.y1}
							x2={k.x2}
							y2={k.y2}
						/>
					{/if}
					{#if seleccion}
						{@const k = capsula(seleccion)}
						<line
							class="sl-capsula sl-capsula--seleccion"
							class:sl-capsula--coincide={!!coincidencia}
							x1={k.x1}
							y1={k.y1}
							x2={k.x2}
							y2={k.y2}
						/>
					{/if}
				</svg>
			</div>
		</div>

		{#if mostrarLista}
			<aside class="sl-lateral">
				{#if interactivo}<span class="sl-lateral-titulo">Palabras para encontrar</span>{/if}
				<ul class="sl-palabras" aria-label="Palabras para encontrar">
					{#each palabras as palabra (palabra)}
						{@const ok = encontradas.has(normalizarPalabraSopa(palabra))}
						<li class="sl-palabra" class:sl-palabra--ok={ok}>
							{#if ok}
								<svg
									class="sl-palabra-check"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							{/if}
							<span class="sl-palabra-texto">{palabra}</span>
							{#if interactivo && ok}
								<button
									type="button"
									class="sl-quitar"
									onclick={() => quitar(normalizarPalabraSopa(palabra))}
									aria-label="Desmarcar {palabra}"
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if interactivo}
					<p class="sl-progreso">
						{encontradas.size} de {lista.length} palabras encontradas
					</p>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<style>
	.sl {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* ── Indicador de la selección ── */
	/* Altura reservada para dos líneas: si el indicador creciera al empezar a
	   arrastrar, empujaría la cuadrícula bajo el dedo en pleno gesto. */
	.sl-indicador {
		display: flex;
		flex-wrap: wrap;
		align-content: center;
		align-items: center;
		gap: 0.4rem 0.7rem;
		min-height: 3.1rem;
		padding: 0.55rem 0.8rem;
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		background: var(--bg-base, #f7faf8);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.sl-indicador--ok {
		border-color: var(--au-primary);
		background: var(--au-tint);
	}
	.sl-indicador--repetida {
		border-color: var(--au-border);
	}
	.sl-indicador-etiqueta {
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--au-muted);
	}
	.sl-indicador-letras {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}
	.sl-ficha {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.6rem;
		padding: 0 0.2rem;
		border-radius: 6px;
		background: #fff;
		box-shadow: 0 1px 2px rgba(1, 67, 57, 0.12);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.85rem;
		font-weight: 800;
		color: var(--au-text);
	}
	.sl-indicador--ok .sl-ficha {
		background: var(--au-primary);
		color: #fff;
	}
	.sl-indicador-estado {
		margin-left: auto;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--au-muted);
	}
	.sl-indicador--ok .sl-indicador-estado {
		color: var(--au-dark);
	}
	.sl-indicador-ayuda {
		font-size: 0.8rem;
		color: var(--au-muted);
	}

	/* ── Cuadrícula y lista: lado a lado si hay ancho, si no una bajo la otra ── */
	.sl-cuerpo {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.9rem 1.25rem;
	}
	.sl-lateral-titulo {
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--au-muted);
	}
	.sl-lateral {
		display: flex;
		flex: 1 1 13rem;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}

	/* ── Cuadrícula ── */
	.sl-marco {
		flex: 1 1 20rem;
		width: 100%;
		max-width: 34rem;
		padding: 0.4rem;
		border-radius: 16px;
		background: var(--bg-base, #f7faf8);
	}
	.sl--compacta .sl-marco {
		flex-basis: 12rem;
		max-width: 18rem;
		padding: 0.25rem;
		border-radius: 12px;
	}
	.sl-rejilla {
		position: relative;
		display: grid;
		/* Sin `gap`: la separación es el relleno de cada celda. Así las
		   coordenadas del puntero y de las cápsulas son lineales. */
		gap: 0;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.sl--interactiva .sl-rejilla {
		touch-action: none;
		cursor: crosshair;
	}
	.sl-celda {
		aspect-ratio: 1;
		min-width: 0;
		padding: 2px;
		border: 0;
		background: transparent;
		cursor: inherit;
		-webkit-tap-highlight-color: transparent;
	}
	.sl--compacta .sl-celda {
		padding: 1px;
	}
	.sl-celda:disabled {
		cursor: default;
	}
	.sl-letra {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border: 1px solid var(--au-border);
		border-radius: 7px;
		background: #fff;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: clamp(0.72rem, 3vw, 1.05rem);
		font-weight: 700;
		color: var(--au-text);
		line-height: 1;
		pointer-events: none;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease;
	}
	.sl--compacta .sl-letra {
		font-size: 0.62rem;
		border-radius: 4px;
	}
	.sl-celda--hallada .sl-letra {
		border-color: transparent;
		color: var(--au-dark);
		font-weight: 800;
	}
	.sl-celda--seleccion .sl-letra {
		border-color: var(--au-primary);
		color: var(--au-dark);
		font-weight: 800;
		transform: scale(1.06);
	}
	.sl-celda--inicio .sl-letra {
		box-shadow: 0 0 0 2px var(--au-primary);
	}
	.sl-celda:focus-visible {
		outline: none;
	}
	.sl-celda:focus-visible .sl-letra {
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.35);
	}

	/* ── Cápsulas ── */
	.sl-capas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}
	.sl-capsula {
		stroke: var(--au-primary);
		stroke-opacity: 0.26;
		stroke-width: 0.78;
		stroke-linecap: round;
		vector-effect: none;
	}
	.sl-capsula--seleccion {
		stroke-opacity: 0.3;
	}
	.sl-capsula--coincide {
		stroke-opacity: 0.45;
	}
	.sl-capsula--destello {
		stroke-opacity: 0.55;
		animation: sl-destello 0.65s ease-out forwards;
	}
	.sl-capsula--mal {
		stroke: var(--au-danger);
	}
	@keyframes sl-destello {
		to {
			stroke-opacity: 0;
		}
	}

	/* ── Lista de palabras ── */
	.sl-palabras {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.sl-palabra {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1.5px solid var(--au-border);
		background: #fff;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--au-text);
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease;
	}
	.sl--compacta .sl-palabra {
		padding: 0.15rem 0.5rem;
		font-size: 0.68rem;
	}
	.sl-palabra--ok {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.sl-palabra--ok .sl-palabra-texto {
		text-decoration: line-through;
		text-decoration-thickness: 1.5px;
	}
	.sl-palabra-check {
		width: 0.8rem;
		height: 0.8rem;
		color: var(--au-primary);
	}
	.sl-quitar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--au-dark);
		cursor: pointer;
	}
	.sl-quitar:hover {
		background: rgba(var(--au-primary-rgb), 0.15);
	}
	.sl-quitar svg {
		width: 0.7rem;
		height: 0.7rem;
	}
	.sl-progreso {
		margin: 0;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--au-muted);
	}

	@media (max-width: 639.98px) {
		.sl-indicador {
			min-height: 4.9rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sl-letra,
		.sl-indicador,
		.sl-palabra {
			transition: none;
		}
		.sl-celda--seleccion .sl-letra {
			transform: none;
		}
		.sl-capsula--destello {
			animation: none;
		}
	}
</style>
