<script lang="ts">
	/**
	 * Distintivo de estado.
	 *
	 * Pinta SIEMPRE icono + texto, no solo color. Hay daltonismo, hay pantallas
	 * malas y hay capturas en blanco y negro pegadas en un informe de auditoría;
	 * un punto ámbar y uno verde son indistinguibles en las tres situaciones.
	 *
	 * El color viene de `estados.ts` como hex literal y no como clase de
	 * Tailwind: cotransmeq reasigna la escala `emerald` a naranja, y un «cumple»
	 * verde se vería allí igual que un «alerta».
	 */
	import { TOKEN_DESCONOCIDO, type TokenEstado } from './estados';

	interface Props {
		token: TokenEstado | undefined;
		/** `sm` para dentro de una tabla; `md` para tarjetas. */
		tamano?: 'sm' | 'md';
		/** Texto alternativo al del token, cuando el contexto pide otro. */
		etiqueta?: string;
	}

	let { token, tamano = 'sm', etiqueta }: Props = $props();

	const t = $derived(token ?? TOKEN_DESCONOCIDO);
	const texto = $derived(etiqueta ?? t.etiqueta);
</script>

<span
	class="badge {tamano}"
	style="color: {t.color}; background: {t.fondo}; border-color: {t.borde};"
	title={t.descripcion}
>
	<span class="icono" aria-hidden="true">{t.icono}</span>
	<span class="texto">{texto}</span>
	<!-- La descripción viaja al lector de pantalla: el `title` no se anuncia
	     de forma fiable y el icono es decorativo. -->
	<span class="sr-only">. {t.descripcion}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid;
		border-radius: 999px;
		font-weight: 600;
		white-space: nowrap;
		line-height: 1.2;
	}

	.badge.sm {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
	}

	.badge.md {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
	}

	.icono {
		font-weight: 700;
		/* Ancho fijo para que las filas de una tabla no bailen entre iconos de
		   distinto ancho (✓ y ⏳ no miden lo mismo). */
		display: inline-block;
		min-width: 0.75em;
		text-align: center;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
