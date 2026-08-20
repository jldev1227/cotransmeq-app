<!--
	Card de un campo en el canvas del builder.

	Trae SIEMPRE botones «mover arriba / abajo» junto al asa de arrastre. No es
	redundancia: `svelte-dnd-action` no es operable con teclado ni con lector de
	pantalla, y el documento exige que el builder se pueda usar sin ratón.
-->
<script lang="ts">
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	// Auto-import en vez de `<svelte:self>`, que Svelte 5 marca como deprecado.
	// El anidamiento es de UN nivel (no hay contenedores dentro de contenedores),
	// así que la recursión termina siempre.
	import FieldCard from './FieldCard.svelte';
	import { flip } from 'svelte/animate';
	import { FIELD_TYPE_META, isContainer, type FieldType } from '$lib/formularios/types';
	import type { BuilderField, BuilderStore } from '$lib/formularios/builder-store.svelte';
	import type { ValidationIssue } from '$lib/formularios/types';

	interface Props {
		field: BuilderField;
		store: BuilderStore;
		sectionId: string;
		issues: Map<string, ValidationIssue[]>;
		/** 0 = campo de primer nivel, 1 = hijo de un contenedor. */
		depth?: number;
		index: number;
		total: number;
		onaddchild?: (parentId: string) => void;
	}

	let { field, store, sectionId, issues, depth = 0, index, total, onaddchild }: Props = $props();

	const meta = $derived(FIELD_TYPE_META[field.type as FieldType]);
	const seleccionado = $derived(store.selection.kind === 'field' && store.selection.id === field.id);
	const propios = $derived(issues.get(field.id) ?? []);
	const errores = $derived(propios.filter((i) => i.severity === 'error'));
	const avisos = $derived(propios.filter((i) => i.severity === 'warning'));
	const editable = $derived(store.editable);

	/// Animación de reordenado. Se anula con `prefers-reduced-motion` porque el
	/// flip completo de una sección de 22 ítems marea.
	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const flipDuration = reduceMotion ? 0 : 160;

	function seleccionar() {
		store.selection = { kind: 'field', id: field.id };
	}

	/**
	 * `consider` solo previsualiza; `finalize` persiste.
	 *
	 * Confirmar en `consider` metería una entrada de undo por cada píxel de
	 * arrastre y llenaría el histórico de 50 pasos en un solo gesto.
	 */
	function onConsiderChildren(e: CustomEvent<DndEvent<BuilderField>>) {
		field.children = e.detail.items;
	}

	function onFinalizeChildren(e: CustomEvent<DndEvent<BuilderField>>) {
		store.reorderChildren(field.id, e.detail.items);
	}
</script>

<article
	class="card"
	class:card--sel={seleccionado}
	class:card--error={errores.length > 0}
	class:card--hijo={depth > 0}
	aria-current={seleccionado ? 'true' : undefined}
>
	<!-- El asa es el único punto de arrastre: arrastrar desde toda la card hace
	     imposible seleccionar texto en los campos del inspector inline. -->
	<div class="card__fila">
		<span class="card__asa" data-dnd-handle aria-hidden="true">⠿</span>

		<button type="button" class="card__cuerpo" onclick={seleccionar}>
			<span class="card__titulo">
				{field.label || '(sin etiqueta)'}
				{#if field.required}<span class="card__req" title="Obligatorio">*</span>{/if}
			</span>
			<span class="card__meta">
				<span class="card__tipo">{meta?.label ?? field.type}</span>
				<span class="card__key">{field.key || '⚠ sin clave'}</span>
				{#if field.visibilityRule}
					<span class="card__badge" title="Tiene regla condicional">regla</span>
				{/if}
				{#if field.options.length}
					<span class="card__badge">{field.options.length} opc.</span>
				{/if}
				{#if field.isNew}
					<span class="card__badge card__badge--nuevo" title="Aún no guardado en el servidor">
						nuevo
					</span>
				{/if}
			</span>
		</button>

		<div class="card__acciones">
			<button
				type="button"
				class="accion"
				disabled={!editable || index === 0}
				aria-label="Mover «{field.label}» arriba"
				onclick={() => store.moveField(field.id, -1)}
			>
				↑
			</button>
			<button
				type="button"
				class="accion"
				disabled={!editable || index === total - 1}
				aria-label="Mover «{field.label}» abajo"
				onclick={() => store.moveField(field.id, 1)}
			>
				↓
			</button>
			<button
				type="button"
				class="accion"
				disabled={!editable}
				aria-label="Duplicar «{field.label}»"
				onclick={() => store.duplicateField(field.id)}
			>
				⧉
			</button>
			<button
				type="button"
				class="accion accion--peligro"
				disabled={!editable}
				aria-label="Eliminar «{field.label}»"
				onclick={() => store.removeField(field.id)}
			>
				✕
			</button>
		</div>
	</div>

	{#if errores.length || avisos.length}
		<ul class="card__issues">
			{#each errores.slice(0, 2) as issue (issue.code + issue.path)}
				<li class="issue issue--error">{issue.message}</li>
			{/each}
			{#each avisos.slice(0, 2) as issue (issue.code + issue.path)}
				<li class="issue issue--warn">{issue.message}</li>
			{/each}
		</ul>
	{/if}

	{#if isContainer(field.type)}
		<div class="hijos">
			<p class="hijos__titulo">
				{field.type === 'MATRIX' ? 'Columnas' : 'Campos de cada fila'}
				<span class="hijos__conteo">{field.children.length}</span>
			</p>

			<div
				class="hijos__zona"
				use:dndzone={{
					items: field.children,
					dragDisabled: !editable,
					flipDurationMs: flipDuration,
					dropTargetStyle: {},
					type: `children-${field.id}`
				}}
				onconsider={onConsiderChildren}
				onfinalize={onFinalizeChildren}
			>
				{#each field.children as hijo, i (hijo.id)}
					<div animate:flip={{ duration: flipDuration }}>
						<FieldCard
							field={hijo}
							{store}
							{sectionId}
							{issues}
							depth={depth + 1}
							index={i}
							total={field.children.length}
						/>
					</div>
				{/each}
			</div>

			{#if field.children.length === 0}
				<p class="hijos__vacio">Un grupo sin campos no se puede publicar.</p>
			{/if}

			{#if editable}
				<button type="button" class="hijos__agregar" onclick={() => onaddchild?.(field.id)}>
					+ Agregar campo al grupo
				</button>
			{/if}
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.card--hijo {
		box-shadow: none;
		background: var(--gray-50, #f9fafb);
	}

	.card--sel {
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
	}

	.card--error {
		border-left: 3px solid #dc2626;
	}

	.card__fila {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4375rem 0.5rem;
	}

	.card__asa {
		flex-shrink: 0;
		width: 1.25rem;
		text-align: center;
		font-size: 0.875rem;
		color: var(--text-very-muted, #9a9a9a);
		cursor: grab;
		user-select: none;
	}

	.card__cuerpo {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.25rem;
		text-align: left;
		font: inherit;
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.card__cuerpo:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.card__titulo {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card__req {
		color: #dc2626;
		margin-left: 0.125rem;
	}

	.card__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.card__tipo {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}

	.card__key {
		font-family: var(--font-mono, monospace);
	}

	.card__badge {
		padding: 0.0625rem 0.3125rem;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
	}

	.card__badge--nuevo {
		background: #fffbeb;
		border-color: #fde68a;
		color: #92400e;
	}

	.card__acciones {
		display: flex;
		gap: 0.0625rem;
		flex-shrink: 0;
	}

	.accion {
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
	}

	.accion:hover:not(:disabled) {
		background: var(--gray-50, #f9fafb);
		border-color: var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.accion:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.accion:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.accion--peligro:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fecaca;
		color: #b91c1c;
	}

	.card__issues {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0 0.75rem 0.5rem 1.9375rem;
		list-style: none;
	}

	.issue {
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.issue--error {
		color: #b91c1c;
	}

	.issue--warn {
		color: #92400e;
	}

	.hijos {
		margin: 0 0.5rem 0.5rem 1.75rem;
		padding: 0.5rem;
		background: rgba(0, 0, 0, 0.015);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 8px;
	}

	.hijos__titulo {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.375rem;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.hijos__conteo {
		font-family: var(--font-mono, monospace);
		font-weight: 500;
		color: var(--text-very-muted, #9a9a9a);
	}

	.hijos__zona {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-height: 1.5rem;
	}

	.hijos__vacio {
		padding: 0.375rem 0;
		font-size: 0.75rem;
		font-style: italic;
		color: #b91c1c;
	}

	.hijos__agregar {
		margin-top: 0.375rem;
		min-height: 36px;
		padding: 0 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: none;
		border: 1px dashed #fdba74;
		border-radius: 8px;
		cursor: pointer;
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}
</style>
