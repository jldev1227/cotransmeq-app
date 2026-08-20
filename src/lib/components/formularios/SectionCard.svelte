<!--
	Sección del canvas: cabecera editable inline + zona de arrastre de sus campos.

	El título se edita aquí y no solo en el inspector porque renombrar secciones es
	lo primero que hace HSEQ al transcribir un formato, y abrir el inspector para
	cada una de diez secciones es fricción pura.
-->
<script lang="ts">
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import type { BuilderField, BuilderSection, BuilderStore } from '$lib/formularios/builder-store.svelte';
	import type { ValidationIssue } from '$lib/formularios/types';
	import FieldCard from './FieldCard.svelte';

	interface Props {
		section: BuilderSection;
		store: BuilderStore;
		issues: Map<string, ValidationIssue[]>;
		index: number;
		total: number;
		/** Abre la paleta apuntando a esta sección (o a un grupo dentro). */
		onaddfield: (sectionId: string, parentFieldId?: string | null) => void;
	}

	let { section, store, issues, index, total, onaddfield }: Props = $props();

	const seleccionada = $derived(
		store.selection.kind === 'section' && store.selection.id === section.id
	);
	const propios = $derived(issues.get(section.id) ?? []);
	const errores = $derived(propios.filter((i) => i.severity === 'error'));
	const editable = $derived(store.editable);

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const flipDuration = reduceMotion ? 0 : 160;

	let colapsada = $state(false);

	function onConsider(e: CustomEvent<DndEvent<BuilderField>>) {
		/// `consider` es solo preview visual: se muta el array local sin registrar
		/// nada en el histórico de undo.
		section.fields = e.detail.items;
	}

	function onFinalize(e: CustomEvent<DndEvent<BuilderField>>) {
		store.reorderSectionFields(section.id, e.detail.items);
	}
</script>

<section class="sec" class:sec--sel={seleccionada} class:sec--error={errores.length > 0}>
	<header class="sec__head">
		<span class="sec__asa" data-dnd-handle aria-hidden="true">⠿</span>

		<button
			type="button"
			class="sec__colapsar"
			aria-expanded={!colapsada}
			aria-label={colapsada ? `Expandir ${section.title}` : `Colapsar ${section.title}`}
			onclick={() => (colapsada = !colapsada)}
		>
			{colapsada ? '▸' : '▾'}
		</button>

		<div class="sec__titulos">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<input
				class="sec__titulo"
				value={section.title}
				disabled={!editable}
				aria-label="Título de la sección"
				oninput={(e) => store.updateSection(section.id, { title: e.currentTarget.value })}
				onfocus={() => (store.selection = { kind: 'section', id: section.id })}
			/>
			<span class="sec__key">{section.key}</span>
		</div>

		<span class="sec__conteo">
			{section.fields.length}
			{section.fields.length === 1 ? 'campo' : 'campos'}
		</span>

		<div class="sec__acciones">
			<button
				type="button"
				class="accion"
				disabled={!editable || index === 0}
				aria-label="Mover sección «{section.title}» arriba"
				onclick={() => store.moveSection(section.id, -1)}
			>
				↑
			</button>
			<button
				type="button"
				class="accion"
				disabled={!editable || index === total - 1}
				aria-label="Mover sección «{section.title}» abajo"
				onclick={() => store.moveSection(section.id, 1)}
			>
				↓
			</button>
			<button
				type="button"
				class="accion"
				disabled={!editable}
				aria-label="Duplicar sección «{section.title}»"
				onclick={() => store.duplicateSection(section.id)}
			>
				⧉
			</button>
			<button
				type="button"
				class="accion accion--peligro"
				disabled={!editable}
				aria-label="Eliminar sección «{section.title}»"
				onclick={() => store.removeSection(section.id)}
			>
				✕
			</button>
		</div>
	</header>

	{#if errores.length}
		<p class="sec__error">{errores[0].message}</p>
	{/if}

	{#if !colapsada}
		<div
			class="sec__campos"
			use:dndzone={{
				items: section.fields,
				dragDisabled: !editable,
				flipDurationMs: flipDuration,
				dropTargetStyle: {},
				/// Un `type` común a todas las secciones permite arrastrar una card de
				/// una sección a otra, que es como HSEQ reorganiza un formato largo.
				type: 'section-fields'
			}}
			onconsider={onConsider}
			onfinalize={onFinalize}
		>
			{#each section.fields as field, i (field.id)}
				<div animate:flip={{ duration: flipDuration }}>
					<FieldCard
						{field}
						{store}
						sectionId={section.id}
						{issues}
						index={i}
						total={section.fields.length}
						onaddchild={(parentId) => onaddfield(section.id, parentId)}
					/>
				</div>
			{/each}
		</div>

		{#if section.fields.length === 0}
			<p class="sec__vacio">Arrastra un campo de la paleta o usa el botón de abajo.</p>
		{/if}

		{#if editable}
			<button type="button" class="sec__agregar" onclick={() => onaddfield(section.id, null)}>
				+ Agregar campo a «{section.title}»
			</button>
		{/if}
	{/if}
</section>

<style>
	.sec {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem;
		background: rgba(255, 255, 255, 0.6);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 14px;
	}

	.sec--sel {
		border-color: var(--emerald-600, #059669);
	}

	.sec--error {
		border-left: 3px solid #dc2626;
	}

	.sec__head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.sec__asa {
		width: 1.25rem;
		text-align: center;
		color: var(--text-very-muted, #9a9a9a);
		cursor: grab;
		user-select: none;
	}

	.sec__colapsar {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.sec__titulos {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.sec__titulo {
		width: 100%;
		min-height: 32px;
		padding: 0.125rem 0.25rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
	}

	.sec__titulo:hover:not(:disabled) {
		border-color: var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.sec__titulo:focus-visible {
		outline: none;
		background: #fff;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.sec__key {
		padding-left: 0.3125rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.sec__conteo {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.sec__acciones {
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

	.accion:focus-visible,
	.sec__colapsar:focus-visible,
	.sec__agregar:focus-visible {
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

	.sec__error {
		padding-left: 1.9375rem;
		font-size: 0.75rem;
		color: #b91c1c;
	}

	.sec__campos {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 2rem;
	}

	.sec__vacio {
		padding: 0.75rem 0.5rem;
		font-size: 0.8125rem;
		font-style: italic;
		text-align: center;
		color: var(--text-very-muted, #9a9a9a);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
	}

	.sec__agregar {
		align-self: flex-start;
		min-height: 40px;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 10px;
		cursor: pointer;
	}
</style>
