<script lang="ts">
	/**
	 * La cuadrícula de una sopa de letras, para responderla o para verla.
	 *
	 * Interactiva: se toca la primera letra de una palabra y luego la última.
	 * Si la línea es recta y sus letras forman una palabra de la lista (en
	 * cualquier sentido), queda marcada. Dos toques en vez de arrastrar: en el
	 * teléfono, arrastrar sobre una cuadrícula compite con el desplazamiento
	 * de la página y a la segunda palabra ya se ha perdido la paciencia.
	 *
	 * Estática: pinta los trazos que recibe (lo que marcó el evaluado, o la
	 * clave en el panel) y no reacciona a toques.
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

	let inicio = $state<[number, number] | null>(null);
	let aviso = $state('');

	const encontradas = $derived(new Set(trazos.map((t) => t.palabra).filter(Boolean)));
	const marcadas = $derived.by(() => {
		const s = new Set<string>();
		for (const t of trazos) for (const [f, c] of celdasDeTrazo(t)) s.add(`${f},${c}`);
		return s;
	});

	function letrasDe(t: TrazoSopa): string | null {
		const celdas = celdasDeTrazo(t);
		if (!celdas.length) return null;
		return celdas.map(([f, c]) => cuadricula[f]?.[c] ?? '').join('');
	}

	function tocar(f: number, c: number) {
		if (!interactivo) return;
		if (!inicio) {
			inicio = [f, c];
			aviso = '';
			return;
		}
		const t: TrazoSopa = { desde: inicio, hasta: [f, c] };
		inicio = null;
		const letras = letrasDe(t);
		if (letras === null) {
			aviso = 'La palabra tiene que ir en línea recta.';
			return;
		}
		const invertidas = [...letras].reverse().join('');
		const palabra = palabras.includes(letras)
			? letras
			: palabras.includes(invertidas)
				? invertidas
				: null;
		if (!palabra) {
			aviso = 'Esas letras no forman una palabra de la lista.';
			return;
		}
		if (encontradas.has(palabra)) {
			aviso = `«${palabra}» ya está marcada.`;
			return;
		}
		aviso = '';
		onCambio?.([...trazos, { palabra, desde: t.desde, hasta: t.hasta }]);
	}

	function quitar(palabra: string) {
		onCambio?.(trazos.filter((t) => t.palabra !== palabra));
	}
</script>

<div class="sl" class:sl--compacta={compacta}>
	<div
		class="sl-cuadricula"
		style="grid-template-columns: repeat({cuadricula[0]?.length ?? 1}, minmax(0, 1fr))"
	>
		{#each cuadricula as fila, f}
			{#each fila.split('') as letra, c}
				<button
					type="button"
					class="sl-celda"
					class:sl-celda--marcada={marcadas.has(`${f},${c}`)}
					class:sl-celda--inicio={inicio?.[0] === f && inicio?.[1] === c}
					disabled={!interactivo}
					tabindex={interactivo ? 0 : -1}
					aria-label="Fila {f + 1}, columna {c + 1}: {letra}"
					onclick={() => tocar(f, c)}
				>
					{letra}
				</button>
			{/each}
		{/each}
	</div>

	{#if interactivo}
		<p class="sl-ayuda" class:sl-ayuda--aviso={!!aviso} aria-live="polite">
			{aviso ||
				(inicio
					? 'Ahora toca la última letra de esa palabra.'
					: 'Toca la primera letra de una palabra y luego la última.')}
		</p>
	{/if}

	{#if mostrarLista}
		<ul class="sl-palabras">
			{#each palabras as palabra (palabra)}
				{@const ok = encontradas.has(normalizarPalabraSopa(palabra))}
				<li class="sl-palabra" class:sl-palabra--ok={ok}>
					<span>{palabra}</span>
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
	{/if}
</div>

<style>
	.sl {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.sl-cuadricula {
		display: grid;
		gap: 3px;
		width: 100%;
		max-width: 30rem;
		user-select: none;
		-webkit-user-select: none;
	}
	.sl--compacta .sl-cuadricula {
		max-width: 18rem;
		gap: 2px;
	}
	.sl-celda {
		aspect-ratio: 1;
		min-width: 0;
		padding: 0;
		border: 1.5px solid var(--au-border);
		border-radius: 6px;
		background: #fff;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: clamp(0.72rem, 2.6vw, 1rem);
		font-weight: 700;
		color: var(--au-text);
		line-height: 1;
		cursor: default;
		transition:
			background-color 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}
	.sl--compacta .sl-celda {
		font-size: 0.62rem;
		border-radius: 4px;
		border-width: 1px;
	}
	.sl-celda:not(:disabled) {
		cursor: pointer;
	}
	.sl-celda:not(:disabled):hover {
		border-color: var(--au-primary);
	}
	.sl-celda:focus-visible {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.25);
	}
	.sl-celda--inicio {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.sl-celda--marcada {
		border-color: var(--au-primary);
		background: var(--au-primary);
		color: #fff;
	}
	.sl-ayuda {
		margin: 0;
		font-size: 0.8rem;
		color: var(--au-muted);
	}
	.sl-ayuda--aviso {
		color: var(--au-danger);
		font-weight: 600;
	}
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
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		border: 1.5px solid var(--au-border);
		background: #fff;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--au-text);
	}
	.sl--compacta .sl-palabra {
		padding: 0.15rem 0.5rem;
		font-size: 0.68rem;
	}
	.sl-palabra--ok {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
		text-decoration: line-through;
		text-decoration-thickness: 1.5px;
	}
	.sl-quitar {
		display: inline-flex;
		width: 1rem;
		height: 1rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--au-dark);
		cursor: pointer;
	}
	.sl-quitar svg {
		width: 0.7rem;
		height: 0.7rem;
	}
</style>
