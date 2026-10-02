<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Etiqueta + control + error de un campo de los formularios de directorio.
	 * El control lo pone quien llama (con `id={id}` y `aria-invalid`), para no
	 * esconder detrás de props la variedad de inputs que necesitan los tres.
	 */
	interface Props {
		id: string;
		label: string;
		requerido?: boolean;
		error?: string;
		ayuda?: string;
		completo?: boolean;
		children: Snippet;
	}

	let { id, label, requerido = false, error, ayuda, completo = false, children }: Props = $props();
</script>

<div class="campo" class:de-full={completo}>
	<label for={id}>
		{label}
		{#if requerido}<span class="req" aria-hidden="true">*</span>{/if}
	</label>
	{@render children()}
	{#if error}
		<p class="err" id="{id}-error" role="alert">{error}</p>
	{:else if ayuda}
		<p class="ayuda">{ayuda}</p>
	{/if}
</div>

<style>
	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	label {
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.req {
		margin-left: 2px;
		color: #dc2626;
	}
	.err {
		margin: 0;
		color: #b42318;
		font-size: 12px;
		font-weight: 600;
	}
	.ayuda {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
