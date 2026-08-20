<!--
	Panel de errores y advertencias de la definición.

	Los issues los produce el BACKEND (`validateFormDefinition`) y llegan en cada
	guardado. No se recalculan aquí a propósito: una segunda implementación en el
	cliente divergiría y acabaría mostrando verde algo que el publish rechaza.

	Al tocar un issue se selecciona la card correspondiente. Sin eso, un mensaje
	como «la clave se repite» en un formulario de 200 campos es inútil.
-->
<script lang="ts">
	import type { ValidationIssue } from '$lib/formularios/types';
	import type { BuilderStore } from '$lib/formularios/builder-store.svelte';

	interface Props {
		errores: ValidationIssue[];
		avisos: ValidationIssue[];
		store: BuilderStore;
	}

	let { errores, avisos, store }: Props = $props();

	let abierto = $state(true);

	const total = $derived(errores.length + avisos.length);
	const porNodo = $derived(store.issuesByNode());

	/** Selecciona el nodo del issue y lo trae a la vista. */
	function irA(issue: ValidationIssue) {
		for (const [id, lista] of porNodo) {
			if (!lista.includes(issue)) continue;
			const esSeccion = store.findSection(id) != null;
			store.selection = { kind: esSeccion ? 'section' : 'field', id };
			return;
		}
	}
</script>

{#if total > 0}
	<section class="panel" class:panel--ok={errores.length === 0}>
		<button
			type="button"
			class="panel__head"
			aria-expanded={abierto}
			onclick={() => (abierto = !abierto)}
		>
			<span class="panel__titulo">
				{#if errores.length}
					{errores.length} {errores.length === 1 ? 'error' : 'errores'}
					{#if avisos.length}· {avisos.length} advertencia{avisos.length === 1 ? '' : 's'}{/if}
				{:else}
					{avisos.length} advertencia{avisos.length === 1 ? '' : 's'}
				{/if}
			</span>
			<span class="panel__flecha">{abierto ? '▾' : '▸'}</span>
		</button>

		{#if abierto}
			<ul class="panel__lista">
				{#each errores as issue (issue.code + issue.path)}
					<li>
						<button type="button" class="fila fila--error" onclick={() => irA(issue)}>
							<span class="fila__code">{issue.code}</span>
							<span class="fila__msg">{issue.message}</span>
						</button>
					</li>
				{/each}
				{#each avisos as issue (issue.code + issue.path)}
					<li>
						<button type="button" class="fila fila--warn" onclick={() => irA(issue)}>
							<span class="fila__code">{issue.code}</span>
							<span class="fila__msg">{issue.message}</span>
						</button>
					</li>
				{/each}
			</ul>

			{#if errores.length === 0}
				<p class="panel__nota">
					Las advertencias no bloquean la publicación, pero conviene revisarlas con HSEQ.
				</p>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.panel {
		border: 1px solid #fecaca;
		border-radius: 12px;
		background: #fef2f2;
		overflow: hidden;
	}

	.panel--ok {
		border-color: #fde68a;
		background: #fffbeb;
	}

	.panel__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 44px;
		padding: 0 0.75rem;
		font: inherit;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.panel__head:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: -2px;
	}

	.panel__titulo {
		font-size: 0.8125rem;
		font-weight: 700;
		color: #991b1b;
	}

	.panel--ok .panel__titulo {
		color: #92400e;
	}

	.panel__flecha {
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.panel__lista {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0 0.5rem 0.5rem;
		list-style: none;
	}

	.fila {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		min-height: 36px;
		padding: 0.25rem 0.375rem;
		font: inherit;
		text-align: left;
		background: rgba(255, 255, 255, 0.6);
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.fila:hover {
		background: #fff;
	}

	.fila:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.fila__code {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--text-very-muted, #9a9a9a);
	}

	.fila__msg {
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.fila--error .fila__msg {
		color: #b91c1c;
	}

	.fila--warn .fila__msg {
		color: #92400e;
	}

	.panel__nota {
		padding: 0 0.75rem 0.625rem;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: #92400e;
	}
</style>
