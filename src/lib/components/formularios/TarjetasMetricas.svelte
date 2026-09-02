<!--
	Fila de métricas del módulo de formularios.

	Son stat tiles, no gráficas: cada dato es UN número actual sin serie temporal
	detrás, y una barra de una sola barra no añade nada que el número no diga.

	Tres reglas que explican cómo están pintadas:

	  - **El color no significa nada por sí solo.** El punto de color identifica la
	    métrica de un vistazo, pero el sentido lo lleva la etiqueta escrita. Nadie
	    tiene que saber que «el rojo son los anulados».
	  - **El valor viste tinta, no el color de la métrica.** Un ámbar o un cian
	    sobre blanco a 1.5 rem se lee peor que el gris carbón, y el color ya está
	    en el punto de al lado.
	  - **Sin dato ≠ cero.** Si la petición del contador falla, la tarjeta muestra
	    «—». Pintar un 0 sería inventarse que no hay anulados cuando lo que pasa es
	    que no se pudo preguntar.

	La paleta (#ea580c · #4f46e5 · #0891b2 · #d97706 · #b91c1c) está validada sobre
	el blanco de la superficie: todas superan 3:1 de contraste y la separación
	entre pares adyacentes aguanta deuteranopía y protanopía.
-->
<script module lang="ts">
	export type TonoMetrica = 'emerald' | 'indigo' | 'cyan' | 'ambar' | 'rojo';

	export interface Metrica {
		id: string;
		/** Qué se cuenta, en corto. Es lo que da el significado, no el color. */
		etiqueta: string;
		/** `null` = no se pudo obtener. Se pinta «—», nunca 0. */
		valor: number | null;
		/** Contexto del número: período, denominador, salvedad. */
		detalle?: string | null;
		tono: TonoMetrica;
		/** Si la métrica lleva a la lista filtrada, la tarjeta es un botón. */
		onactivar?: () => void;
		activa?: boolean;
	}

	const COLORES: Record<TonoMetrica, string> = {
		emerald: '#ea580c',
		indigo: '#4f46e5',
		cyan: '#0891b2',
		ambar: '#d97706',
		rojo: '#b91c1c'
	};

	/// Los números de flota caben enteros; a partir de cinco cifras se compacta
	/// para que la tarjeta no tenga que ensancharse ni encoger la fuente.
	const compacto = new Intl.NumberFormat('es-CO', {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	const entero = new Intl.NumberFormat('es-CO');

	function formatear(valor: number | null): string {
		if (valor == null) return '—';
		return valor >= 10000 ? compacto.format(valor) : entero.format(valor);
	}
</script>

<script lang="ts">
	interface Props {
		metricas: Metrica[];
		cargando?: boolean;
	}

	let { metricas, cargando = false }: Props = $props();
</script>

<div class="metricas">
	{#each metricas as m (m.id)}
		{#if m.onactivar}
			<button
				type="button"
				class="metrica metrica--pulsable"
				class:metrica--activa={m.activa}
				style={`--tono: ${COLORES[m.tono]}`}
				aria-pressed={m.activa ?? false}
				onclick={m.onactivar}
			>
				<span class="metrica__punto" aria-hidden="true"></span>
				<span class="metrica__etiqueta">{m.etiqueta}</span>
				<span class="metrica__valor" class:metrica__valor--cargando={cargando}>
					{cargando ? '…' : formatear(m.valor)}
				</span>
				{#if m.detalle}<span class="metrica__detalle">{m.detalle}</span>{/if}
			</button>
		{:else}
			<div class="metrica" style={`--tono: ${COLORES[m.tono]}`}>
				<span class="metrica__punto" aria-hidden="true"></span>
				<span class="metrica__etiqueta">{m.etiqueta}</span>
				<span class="metrica__valor" class:metrica__valor--cargando={cargando}>
					{cargando ? '…' : formatear(m.valor)}
				</span>
				{#if m.detalle}<span class="metrica__detalle">{m.detalle}</span>{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	/* Rejilla fluida, no columnas fijas: en un monitor ancho entran las cinco en
	   una fila y en un portátil se reparten solas, sin puntos de ruptura. */
	.metricas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11.5rem, 1fr));
		gap: 0.625rem;
	}

	.metrica {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas:
			'punto etiqueta'
			'valor valor'
			'detalle detalle';
		align-items: center;
		gap: 0.125rem 0.4375rem;
		padding: 0.75rem 0.875rem;
		text-align: left;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 16px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	.metrica__punto {
		grid-area: punto;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--tono);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--tono) 16%, transparent);
	}

	.metrica__etiqueta {
		grid-area: etiqueta;
		font-family: var(--font-mono, monospace);
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted, #6b6b6b);
	}

	/* Cifras proporcionales a propósito: `tabular-nums` da a cada dígito el ancho
	   de un cero y a este tamaño un «121» se ve suelto. Las tabulares son para
	   columnas que tienen que alinearse, como la tabla de envíos. */
	.metrica__valor {
		grid-area: valor;
		margin-top: 0.1875rem;
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.1;
		color: var(--bg-charcoal, #0f172a);
	}

	.metrica__valor--cargando {
		color: var(--text-very-muted, #9a9a9a);
	}

	.metrica__detalle {
		grid-area: detalle;
		margin-top: 0.125rem;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-very-muted, #9a9a9a);
	}

	/* Las métricas que llevan a la lista filtrada son botones de verdad: se
	   tabulan, se activan con Enter y anuncian su estado con `aria-pressed`. */
	.metrica--pulsable {
		font: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s var(--ease-apple, ease),
			transform 0.2s var(--ease-apple, ease);
	}

	.metrica--pulsable:hover {
		border-color: color-mix(in srgb, var(--tono) 45%, transparent);
		transform: translateY(-1px);
	}

	.metrica--pulsable:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: 2px;
	}

	.metrica--activa {
		border-color: var(--tono);
		box-shadow: inset 0 0 0 1px var(--tono);
	}

	@media (prefers-reduced-motion: reduce) {
		.metrica--pulsable {
			transition: none;
		}

		.metrica--pulsable:hover {
			transform: none;
		}
	}
</style>
