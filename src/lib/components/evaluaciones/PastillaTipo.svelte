<script lang="ts">
	/**
	 * El tipo de una pregunta, como pastilla en el tinte de la marca.
	 *
	 * Antes cada tipo tenía su propio color de Tailwind —azul, morado, verde,
	 * naranja, rosa, verde azulado—: seis colores para una información que
	 * nadie compara de un vistazo. Una pastilla única en el tinte basta, y la
	 * paleta se la deja al puntaje, que sí es un semáforo.
	 */
	import { etiquetaTipo, etiquetaTipoCorta } from './tipos';

	interface Props {
		tipo: string;
		/** `Única`, `V / F`… para celdas estrechas. */
		corta?: boolean;
	}

	let { tipo, corta = false }: Props = $props();
</script>

<span class="pastilla">{corta ? etiquetaTipoCorta(tipo) : etiquetaTipo(tipo)}</span>

<style>
	.pastilla {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1.2;
		white-space: nowrap;
	}
</style>
