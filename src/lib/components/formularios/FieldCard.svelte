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
	import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from 'lucide-svelte';
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
	const seleccionado = $derived(
		store.selection.kind === 'field' && store.selection.id === field.id
	);
	const propios = $derived(issues.get(field.id) ?? []);
	const errores = $derived(propios.filter((i) => i.severity === 'error'));
	const avisos = $derived(propios.filter((i) => i.severity === 'warning'));
	const editable = $derived(store.editable);

	/// Animación de reordenado. Se anula con `prefers-reduced-motion` porque el
	/// flip completo de una sección de 22 ítems marea.
	const reduceMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
		{#if editable}
			<span class="card__asa" data-dnd-handle aria-hidden="true">
				<GripVertical size={16} strokeWidth={2} />
			</span>
		{/if}

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

		<!-- En lectura (versión publicada) las acciones no se pintan: cuatro
		     botones deshabilitados por card solo le quitaban ancho al título. -->
		{#if editable}
			<div class="card__acciones">
				<button
					type="button"
					class="accion"
					disabled={index === 0}
					aria-label="Mover «{field.label}» arriba"
					onclick={() => store.moveField(field.id, -1)}
				>
					<ArrowUp size={15} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion"
					disabled={index === total - 1}
					aria-label="Mover «{field.label}» abajo"
					onclick={() => store.moveField(field.id, 1)}
				>
					<ArrowDown size={15} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion"
					aria-label="Duplicar «{field.label}»"
					onclick={() => store.duplicateField(field.id)}
				>
					<Copy size={14} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion accion--peligro"
					aria-label="Eliminar «{field.label}»"
					onclick={() => store.removeField(field.id)}
				>
					<Trash2 size={14} strokeWidth={2.25} />
				</button>
			</div>
		{/if}
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
	/* Lenguaje de la app móvil: tarjeta blanca, título oscuro y grueso, tipo
	   como chip suave y la clave en gris, sin monoespaciada. */
	.card {
		container-type: inline-size;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		box-shadow: 0 2px 8px rgba(1, 67, 57, 0.05);
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease;
	}

	.card--hijo {
		box-shadow: none;
		background: var(--bg-base);
	}

	.card--sel {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	.card--error {
		border-left: 3px solid #dc2626;
	}

	.card__fila {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.5rem 0.5rem 0.375rem;
	}

	/* Sin asa (lectura) el cuerpo empieza en la primera columna. */
	.card__fila > .card__cuerpo:first-child {
		grid-column: 1 / 3;
		padding-left: 0.5rem;
	}

	.card__asa {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 2rem;
		color: var(--text-very-muted);
		cursor: grab;
		user-select: none;
	}

	.card__cuerpo {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.25rem;
		text-align: left;
		font: inherit;
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}

	.card__cuerpo:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 1px;
	}

	/* Dos renglones antes de cortar: con una sola línea, en móvil los títulos
	   largos quedaban en «Vencimiento de la tarjet…». */
	.card__titulo {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--text-primary);
	}

	.card__req {
		color: #dc2626;
		margin-left: 0.125rem;
	}

	.card__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.375rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.card__tipo {
		padding: 0.0625rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--color-emerald-900);
		background: var(--color-emerald-100);
		border-radius: 999px;
		white-space: nowrap;
	}

	.card__key {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.card__badge {
		padding: 0.0625rem 0.4375rem;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--text-secondary);
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 999px;
		white-space: nowrap;
	}

	.card__badge--nuevo {
		background: #fef3c7;
		border-color: #fde68a;
		color: #92400e;
	}

	.card__acciones {
		display: flex;
		gap: 0.125rem;
	}

	.accion {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		font: inherit;
		color: var(--text-muted);
		background: none;
		border: 1px solid transparent;
		border-radius: 10px;
		cursor: pointer;
	}

	.accion:hover:not(:disabled) {
		color: var(--text-primary);
		background: var(--bg-base);
		border-color: var(--border-subtle);
	}

	.accion:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 1px;
	}

	.accion:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.accion--peligro:hover:not(:disabled) {
		background: #fef3f2;
		border-color: #f4c7c3;
		color: #b42318;
	}

	/* Card estrecha (móvil, o un hijo dentro de un grupo): las acciones bajan a
	   su propio renglón, alineadas a la derecha, y el título usa todo el ancho. */
	@container (max-width: 26rem) {
		.card__fila {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.card__acciones {
			grid-column: 2;
			justify-content: flex-end;
			margin-top: -0.25rem;
		}
	}

	.card__issues {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0 0.75rem 0.625rem 2.25rem;
		list-style: none;
	}

	.issue {
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.issue--error {
		color: #b42318;
	}

	.issue--warn {
		color: #92400e;
	}

	.hijos {
		margin: 0 0.625rem 0.625rem 1.75rem;
		padding: 0.625rem;
		background: var(--bg-base);
		border: 1px dashed var(--border-default);
		border-radius: 12px;
	}

	.hijos__titulo {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--text-secondary);
	}

	.hijos__conteo {
		padding: 0 0.4375rem;
		font-size: 0.6875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		background: var(--bg-surface);
		border-radius: 999px;
	}

	.hijos__zona {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 1.5rem;
	}

	.hijos__vacio {
		margin: 0;
		padding: 0.375rem 0;
		font-size: 0.75rem;
		color: #b42318;
	}

	.hijos__agregar {
		margin-top: 0.5rem;
		min-height: 36px;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--accion);
		background: var(--bg-surface);
		border: 1px dashed color-mix(in srgb, var(--accion) 45%, transparent);
		border-radius: 10px;
		cursor: pointer;
	}

	.hijos__agregar:hover {
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}
</style>
