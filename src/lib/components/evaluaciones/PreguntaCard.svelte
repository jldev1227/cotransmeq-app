<script lang="ts">
	/**
	 * Una pregunta tal y como la ve quien la diseña: número, tipo, puntos, el
	 * enunciado y la clave de corrección (qué opciones son correctas, cómo se
	 * emparejan los lados, si es verdadera o falsa).
	 *
	 * La usan el detalle de la evaluación y los formularios de crear y
	 * editar. En estos últimos se pasan `onEditar`/`onEliminar` y aparecen
	 * los dos botones de acción; en el detalle no.
	 */
	import { Pencil, Trash2 } from 'lucide-svelte';
	import PastillaTipo from './PastillaTipo.svelte';
	import { pluralPuntos } from './tipos';

	interface OpcionVista {
		texto: string;
		esCorrecta: boolean;
	}

	interface PreguntaVista {
		texto: string;
		tipo: string;
		puntaje: number;
		opciones?: OpcionVista[];
		relacionIzq?: string[];
		relacionDer?: string[];
		respuestaCorrecta?: number | null;
	}

	interface Props {
		pregunta: PreguntaVista;
		/** Posición 0-based; se pinta como `1`, `2`… */
		indice: number;
		onEditar?: () => void;
		onEliminar?: () => void;
	}

	let { pregunta, indice, onEditar, onEliminar }: Props = $props();

	const opciones = $derived(pregunta.opciones ?? []);
	const pares = $derived(
		pregunta.tipo === 'RELACION'
			? (pregunta.relacionIzq ?? []).map((izq, i) => ({
					izq,
					der: pregunta.relacionDer?.[i] ?? ''
				}))
			: []
	);
</script>

<article class="pc">
	<header class="pc-cab">
		<span class="pc-num" aria-label="Pregunta {indice + 1}">{indice + 1}</span>
		<div class="pc-meta">
			<PastillaTipo tipo={pregunta.tipo} />
			<span class="pc-pts">{pluralPuntos(pregunta.puntaje)}</span>
		</div>
		{#if onEditar || onEliminar}
			<div class="pc-acciones">
				{#if onEditar}
					<button type="button" class="btn-icon" onclick={onEditar} aria-label="Editar pregunta">
						<Pencil />
					</button>
				{/if}
				{#if onEliminar}
					<button
						type="button"
						class="btn-icon pc-btn-peligro"
						onclick={onEliminar}
						aria-label="Eliminar pregunta"
					>
						<Trash2 />
					</button>
				{/if}
			</div>
		{/if}
	</header>

	<p class="pc-texto">{pregunta.texto}</p>

	{#if opciones.length > 0}
		<ul class="pc-opciones">
			{#each opciones as opcion}
				<li class="pc-opcion" class:pc-opcion--correcta={opcion.esCorrecta}>
					<span class="pc-marca" aria-hidden="true">
						{#if opcion.esCorrecta}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						{/if}
					</span>
					<span class="pc-opcion-texto">{opcion.texto}</span>
					{#if opcion.esCorrecta}<span class="pc-correcta-tag">Correcta</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if pares.length > 0}
		<ul class="pc-pares">
			{#each pares as par}
				<li class="pc-par">
					<span class="pc-par-lado">{par.izq}</span>
					<svg
						class="pc-par-flecha"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
					</svg>
					<span class="pc-par-lado pc-par-lado--der">{par.der}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if pregunta.tipo === 'VERDADERO_FALSO'}
		<p class="pc-clave">
			<span class="pc-clave-etiqueta">Respuesta correcta</span>
			<span class="pc-clave-valor" class:pc-clave-valor--falso={pregunta.respuestaCorrecta !== 1}>
				{pregunta.respuestaCorrecta === 1 ? 'Verdadero' : 'Falso'}
			</span>
		</p>
	{:else if pregunta.tipo === 'NUMERICA' && pregunta.respuestaCorrecta !== undefined && pregunta.respuestaCorrecta !== null}
		<p class="pc-clave">
			<span class="pc-clave-etiqueta">Respuesta correcta</span>
			<span class="pc-clave-valor">{pregunta.respuestaCorrecta}</span>
		</p>
	{:else if pregunta.tipo === 'TEXTO'}
		<p class="pc-nota">Respuesta abierta · la califica la IA.</p>
	{/if}
</article>

<style>
	.pc {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1rem 1.1rem 1.1rem;
		background: #fff;
		border-radius: 20px;
		box-shadow: 0 6px 14px rgba(20, 83, 45, 0.065);
	}
	.pc-cab {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.pc-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 10px;
		background: var(--au-dark);
		color: #fff;
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 800;
	}
	.pc-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		flex: 1;
		min-width: 0;
	}
	.pc-pts {
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--au-muted);
	}
	.pc-acciones {
		display: flex;
		gap: 0.35rem;
		flex-shrink: 0;
	}
	.pc-btn-peligro:hover {
		background: var(--au-danger-soft);
		border-color: rgba(180, 35, 24, 0.25);
		color: var(--au-danger);
	}
	.pc-texto {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.45;
		color: var(--au-text);
		white-space: pre-line;
	}
	.pc-opciones,
	.pc-pares {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.pc-opcion {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		border-radius: 12px;
		background: var(--bg-base, #fff7ed);
		font-size: 0.86rem;
		color: var(--au-text);
	}
	.pc-opcion--correcta {
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 600;
	}
	.pc-marca {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.15rem;
		height: 1.15rem;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1.5px solid var(--au-border);
		background: #fff;
		color: #fff;
	}
	.pc-opcion--correcta .pc-marca {
		border-color: var(--au-primary);
		background: var(--au-primary);
	}
	.pc-marca svg {
		width: 0.7rem;
		height: 0.7rem;
	}
	.pc-opcion-texto {
		flex: 1;
		min-width: 0;
		line-height: 1.4;
	}
	.pc-correcta-tag {
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--au-primary);
	}
	.pc-par {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
	}
	.pc-par-lado {
		padding: 0.45rem 0.7rem;
		border-radius: 12px;
		background: var(--bg-base, #fff7ed);
		font-size: 0.84rem;
		color: var(--au-text);
		line-height: 1.35;
	}
	.pc-par-lado--der {
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 600;
	}
	.pc-par-flecha {
		width: 1rem;
		height: 1rem;
		color: var(--au-muted);
	}
	.pc-clave {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		align-self: flex-start;
		padding: 0.4rem 0.75rem 0.4rem 0.9rem;
		border-radius: 999px;
		background: var(--bg-base, #fff7ed);
		font-size: 0.78rem;
	}
	.pc-clave-etiqueta {
		font-weight: 600;
		color: var(--au-muted);
	}
	.pc-clave-valor {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 800;
	}
	.pc-clave-valor--falso {
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}
	.pc-nota {
		margin: 0;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--au-muted);
	}
</style>
