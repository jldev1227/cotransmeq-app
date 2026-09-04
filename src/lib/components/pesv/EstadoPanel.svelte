<script lang="ts">
	/**
	 * Los cuatro estados de una vista: cargando, error, vacío y sin datos.
	 *
	 * Están juntos en un componente porque son el mismo hueco de la pantalla y
	 * separarlos llevaba a que cada vista implementara tres de los cuatro y se
	 * olvidara del que menos ocurre —normalmente el error, que es el que más
	 * ayuda cuando pasa.
	 *
	 * `sin-datos` es distinto de `vacio` a propósito: «no hay registros» y «no
	 * hay con qué calcularlo» significan cosas opuestas para un auditor.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		tipo: 'cargando' | 'error' | 'vacio' | 'sin-datos';
		titulo?: string;
		mensaje?: string;
		/** Texto del botón de acción. Sin él no se pinta botón. */
		accion?: string;
		onAccion?: () => void;
		/** Enlace en vez de botón, cuando la acción es ir a otro sitio. */
		enlace?: string;
		enlaceTexto?: string;
		hijos?: Snippet;
	}

	let { tipo, titulo, mensaje, accion, onAccion, enlace, enlaceTexto, hijos }: Props = $props();

	const PREDETERMINADOS = {
		cargando: { titulo: 'Cargando…', mensaje: 'Consultando los datos del período.', icono: '' },
		error: {
			titulo: 'No se pudo cargar',
			mensaje: 'Hubo un problema al consultar los datos. Vuelva a intentarlo.',
			icono: '⚠'
		},
		vacio: {
			titulo: 'Sin registros',
			mensaje: 'No hay nada que mostrar con los filtros actuales.',
			icono: '○'
		},
		'sin-datos': {
			titulo: 'Sin datos suficientes',
			mensaje: 'No hay insumos para calcular este resultado. Esto no es un cero.',
			icono: '–'
		}
	} as const;

	const base = $derived(PREDETERMINADOS[tipo]);
</script>

<div class="panel {tipo}" role={tipo === 'error' ? 'alert' : 'status'} aria-live="polite">
	{#if tipo === 'cargando'}
		<div class="cargando-visual" aria-hidden="true">
			<span class="punto"></span><span class="punto"></span><span class="punto"></span>
		</div>
	{:else}
		<span class="icono" aria-hidden="true">{base.icono}</span>
	{/if}

	<p class="titulo">{titulo ?? base.titulo}</p>
	<p class="mensaje">{mensaje ?? base.mensaje}</p>

	{#if hijos}
		<div class="extra">{@render hijos()}</div>
	{/if}

	{#if accion && onAccion}
		<button type="button" class="boton" onclick={onAccion}>{accion}</button>
	{/if}

	{#if enlace}
		<a class="boton enlace" href={enlace}>{enlaceTexto ?? 'Ir al registro'}</a>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1.5rem;
		text-align: center;
		border-radius: 0.75rem;
		border: 1px dashed #e2e8f0;
		background: #f8fafc;
	}

	.panel.error {
		border-style: solid;
		border-color: #fecaca;
		background: #fef2f2;
	}

	.panel.sin-datos {
		border-color: #cbd5e1;
		background: #f8fafc;
	}

	.icono {
		font-size: 1.5rem;
		line-height: 1;
		color: #64748b;
	}

	.panel.error .icono {
		color: #b91c1c;
	}

	.titulo {
		font-weight: 600;
		color: #0f172a;
		margin: 0;
	}

	.panel.error .titulo {
		color: #991b1b;
	}

	.mensaje {
		margin: 0;
		color: #475569;
		font-size: 0.875rem;
		/* Excepción de ancho legítima: es texto corrido, y pasados ~44rem el ojo
		   pierde el renglón. No es un contenedor de página. */
		max-width: 44rem;
	}

	.extra {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: #475569;
	}

	.boton {
		margin-top: 0.5rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #0f172a;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		/* Objetivo táctil: 44 px de alto mínimo. */
		min-height: 2.75rem;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
	}

	.boton:hover {
		background: #f1f5f9;
	}

	.boton:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
	}

	.cargando-visual {
		display: flex;
		gap: 0.375rem;
	}

	.punto {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #94a3b8;
		animation: latido 1.2s infinite ease-in-out;
	}

	.punto:nth-child(2) {
		animation-delay: 0.15s;
	}
	.punto:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes latido {
		0%,
		80%,
		100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* Quien pidió menos movimiento no necesita ver latir tres puntos. */
	@media (prefers-reduced-motion: reduce) {
		.punto {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
