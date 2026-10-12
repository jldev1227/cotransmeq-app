<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { TriangleAlert } from 'lucide-svelte';

	/**
	 * Formulario de los modales de Usuarios (editar, alta manual, invitar).
	 *
	 * Solo pone la carcasa común: el `<form>` con su `id` —el botón de enviar
	 * vive en el pie de `ModalBase`, fuera del formulario, y lo enlaza con
	 * `form={id}`—, los estilos de los controles y el aviso de error. Los
	 * tres modales tenían cada uno su copia de `.field`, `.input` y
	 * `.alert-error`; aquí hay una sola.
	 *
	 * Sin `novalidate` a propósito: el editor confía en el `required` y el
	 * `type="email"` nativos para no enviar un nombre vacío, y así se queda.
	 */
	interface Props {
		id: string;
		onenviar: () => void;
		/** Error de validación o del servidor; se pinta al final del formulario. */
		error?: string;
		children: Snippet;
	}

	let { id, onenviar, error = '', children }: Props = $props();
</script>

<form
	{id}
	class="uf"
	onsubmit={(e) => {
		e.preventDefault();
		onenviar();
	}}
>
	{@render children()}

	{#if error}
		<div class="uf-error" role="alert" in:fly={{ y: -8, duration: 200 }}>
			<TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />
			<strong>{error}</strong>
		</div>
	{/if}
</form>

<style>
	.uf {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Controles: los mismos de los modales de directorio (`.de-input`), sobre
	   el fondo claro del cuerpo de `ModalBase`. */
	.uf :global(.uf-input) {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.uf :global(.uf-input::placeholder) {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.uf :global(.uf-input:focus) {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	/* Dos campos por fila cuando caben; se apilan solos en un móvil o en un
	   modal estrecho, sin punto de ruptura que mantener. */
	.uf :global(.uf-fila) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 16px;
	}

	/* Bloque con título propio y un control compuesto (el editor de permisos
	   por ruta), que no cabe en un `Campo` porque no es un único `<input>`. */
	.uf :global(.uf-bloque) {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.uf :global(.uf-etiqueta) {
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}

	.uf :global(.uf-nota) {
		margin: 0;
		padding: 0.7rem 0.85rem;
		font-size: 0.8rem;
		line-height: 1.55;
		color: var(--text-secondary);
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
	}

	.uf :global(.uf-check) {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: -0.35rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		cursor: pointer;
		user-select: none;
	}
	.uf :global(.uf-check input) {
		width: 0.95rem;
		height: 0.95rem;
		accent-color: var(--accion);
		cursor: pointer;
	}

	/* Error: rojo literal, es un semáforo y no la marca. */
	.uf-error {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.8rem 1rem;
		border-radius: 12px;
		font-size: 0.85rem;
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		color: #991b1b;
	}
	.uf-error :global(svg) {
		flex-shrink: 0;
		color: #dc2626;
	}
	.uf-error strong {
		font-weight: 600;
	}
</style>
