<script lang="ts" module>
	export interface AccionSeleccion {
		id: string;
		etiqueta: string;
		/** Ícono de lucide-svelte. */
		icono?: any;
		/** `primario`: acción de marca · `neutro`: blanca · `peligro`: roja. */
		tono?: 'primario' | 'neutro' | 'peligro';
		onClick: () => unknown;
	}
</script>

<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { X } from 'lucide-svelte';

	/**
	 * Barra flotante de acciones masivas, la misma en todos los directorios.
	 *
	 * Copia la tarjeta de la app móvil: verde profundo de la marca, esquinas de
	 * 22, el conteo como píldora y los botones con sus tres tonos (acción,
	 * blanco y destructivo). Antes cada lista tenía la suya —gris pizarra,
	 * botones de 12 px de texto, un rojo propio— y entraba con un rebote de
	 * escala; ahora sube con una curva suave.
	 */
	interface Props {
		cantidad: number;
		/** «conductores», «clientes»… para leer «3 conductores seleccionados». */
		nombreItems?: string;
		acciones: AccionSeleccion[];
		procesando?: boolean;
		onLimpiar: () => void;
	}

	let {
		cantidad,
		nombreItems = 'registros',
		acciones,
		procesando = false,
		onLimpiar
	}: Props = $props();
</script>

{#if cantidad > 0}
	<div
		class="bs"
		role="toolbar"
		aria-label="Acciones sobre la selección"
		transition:fly={{ y: 24, duration: 220, easing: cubicOut }}
	>
		<p class="bs-cuenta">
			<span class="bs-num">{cantidad.toLocaleString('es-CO')}</span>
			<span class="bs-texto">{nombreItems} seleccionado{cantidad === 1 ? '' : 's'}</span>
		</p>

		<div class="bs-acciones">
			{#each acciones as a (a.id)}
				<button
					type="button"
					class="bs-btn bs-btn--{a.tono ?? 'neutro'}"
					disabled={procesando}
					onclick={a.onClick}
				>
					{#if a.icono}<a.icono size={16} strokeWidth={2.2} />{/if}
					{a.etiqueta}
				</button>
			{/each}
		</div>

		<button
			type="button"
			class="bs-cerrar"
			onclick={onLimpiar}
			disabled={procesando}
			aria-label="Quitar la selección"
		>
			<X size={16} strokeWidth={2.5} />
		</button>
	</div>
{/if}

<style>
	.bs {
		position: fixed;
		z-index: 50;
		left: 50%;
		bottom: 24px;
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: calc(100vw - 32px);
		padding: 10px 10px 10px 16px;
		border-radius: 22px;
		background: var(--bg-charcoal-deep);
		color: #fff;
		box-shadow:
			0 16px 40px rgba(0, 29, 23, 0.32),
			0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.bs-cuenta {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}
	.bs-num {
		min-width: 28px;
		height: 28px;
		padding: 0 8px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.14);
		font-weight: 900;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.bs-texto {
		color: rgba(255, 255, 255, 0.78);
		font-size: 13px;
		font-weight: 700;
	}

	.bs-acciones {
		display: flex;
		gap: 8px;
	}
	.bs-btn {
		min-height: 40px;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0 14px;
		border: 0;
		border-radius: 14px;
		font-size: 13px;
		font-weight: 800;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.15s;
	}
	.bs-btn:active:not(:disabled) {
		transform: scale(0.985);
	}
	.bs-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.bs-btn--primario {
		background: var(--accion);
		color: #fff;
	}
	.bs-btn--primario:hover:not(:disabled) {
		background: var(--accion-hover);
	}
	.bs-btn--neutro {
		background: #fff;
		color: var(--bg-charcoal-deep);
	}
	.bs-btn--neutro:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.86);
	}
	.bs-btn--peligro {
		background: #b42318;
		color: #fff;
	}
	.bs-btn--peligro:hover:not(:disabled) {
		background: #912018;
	}

	.bs-cerrar {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		cursor: pointer;
	}
	.bs-cerrar:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
	}

	/* En móvil: barra a lo ancho, el conteo arriba y los botones repartidos. */
	@media (max-width: 640px) {
		.bs {
			left: 16px;
			right: 16px;
			translate: none;
			bottom: 16px;
			flex-wrap: wrap;
			gap: 10px;
		}
		.bs-cuenta {
			flex: 1;
		}
		.bs-acciones {
			order: 3;
			width: 100%;
		}
		.bs-btn {
			flex: 1;
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bs-btn {
			transition: none;
		}
	}
</style>
