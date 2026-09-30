<script lang="ts">
	/**
	 * Estado de un registro: un punto de color y la palabra.
	 *
	 * Es el único elemento con color dentro de una fila. Nada de pastillas
	 * rellenas: el color ya dice lo que hay que decir y así la lista no grita.
	 */
	interface Props {
		etiqueta: string;
		color: string;
		/** Estados «apagados» (inactivo, retirado) van en gris para no llamar. */
		apagado?: boolean;
	}

	let { etiqueta, color, apagado = false }: Props = $props();
</script>

<span class="estado" class:estado--apagado={apagado} style="--c:{color}">
	<span class="estado-punto" aria-hidden="true"></span>
	{etiqueta}
</span>

<style>
	.estado {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--c);
		white-space: nowrap;
	}
	.estado-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c);
		flex-shrink: 0;
	}
	.estado--apagado {
		color: var(--text-muted);
	}
</style>
