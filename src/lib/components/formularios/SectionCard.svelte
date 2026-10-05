<!--
	Sección del canvas: cabecera editable inline + zona de arrastre de sus campos.

	El título se edita aquí y no solo en el inspector porque renombrar secciones es
	lo primero que hace HSEQ al transcribir un formato, y abrir el inspector para
	cada una de diez secciones es fricción pura.
-->
<script lang="ts">
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, Trash2 } from 'lucide-svelte';
	import type {
		BuilderField,
		BuilderSection,
		BuilderStore
	} from '$lib/formularios/builder-store.svelte';
	import type { ValidationIssue } from '$lib/formularios/types';
	import { numeroDeEtapa, tituloDeEtapa } from '$lib/formularios/etapas';
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
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
		{#if editable}
			<span class="sec__asa" data-dnd-handle aria-hidden="true">
				<GripVertical size={16} strokeWidth={2} />
			</span>
		{/if}

		<button
			type="button"
			class="sec__colapsar"
			aria-expanded={!colapsada}
			aria-label={colapsada ? `Expandir ${section.title}` : `Colapsar ${section.title}`}
			onclick={() => (colapsada = !colapsada)}
		>
			<span class="sec__chevron" class:sec__chevron--cerrado={colapsada}>
				<ChevronDown size={18} strokeWidth={2.25} />
			</span>
		</button>

		<div class="sec__titulos">
			{#if editable}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<input
					class="sec__titulo"
					value={section.title}
					disabled={!editable}
					aria-label="Título de la sección"
					oninput={(e) => store.updateSection(section.id, { title: e.currentTarget.value })}
					onfocus={() => (store.selection = { kind: 'section', id: section.id })}
				/>
			{:else}
				<h3 class="sec__titulo sec__titulo--leer">{section.title}</h3>
			{/if}
			<span class="sec__key">{section.key}</span>
			{#if numeroDeEtapa(section) !== null}
				<!-- Para ver de un vistazo el reparto en etapas sin abrir cada
				     sección en el inspector. -->
				<span class="sec__etapa" title={tituloDeEtapa(section) ?? undefined}>
					Etapa {numeroDeEtapa(section)}
				</span>
			{/if}
		</div>

		<span class="sec__conteo">
			{section.fields.length}
			{section.fields.length === 1 ? 'campo' : 'campos'}
		</span>

		{#if editable}
			<div class="sec__acciones">
				<button
					type="button"
					class="accion"
					disabled={index === 0}
					aria-label="Mover sección «{section.title}» arriba"
					onclick={() => store.moveSection(section.id, -1)}
				>
					<ArrowUp size={15} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion"
					disabled={index === total - 1}
					aria-label="Mover sección «{section.title}» abajo"
					onclick={() => store.moveSection(section.id, 1)}
				>
					<ArrowDown size={15} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion"
					aria-label="Duplicar sección «{section.title}»"
					onclick={() => store.duplicateSection(section.id)}
				>
					<Copy size={14} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="accion accion--peligro"
					aria-label="Eliminar sección «{section.title}»"
					onclick={() => store.removeSection(section.id)}
				>
					<Trash2 size={14} strokeWidth={2.25} />
				</button>
			</div>
		{/if}
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
	/* Sección = tarjeta blanca de la app (radio 18, sombra suave). Los campos van
	   dentro como tarjetas más planas. */
	.sec {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem;
		background: var(--bg-surface);
		border: 1px solid transparent;
		border-radius: 18px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	.sec--sel {
		border-color: var(--accion);
	}

	.sec--error {
		border-left: 3px solid #dc2626;
	}

	.sec__head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.375rem;
	}

	.sec__asa {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 2rem;
		color: var(--text-very-muted);
		cursor: grab;
		user-select: none;
	}

	.sec__colapsar {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		font: inherit;
		color: var(--text-muted);
		background: none;
		border: none;
		border-radius: 10px;
		cursor: pointer;
	}

	.sec__colapsar:hover {
		background: var(--bg-base);
	}

	.sec__chevron {
		display: grid;
		transition: transform 160ms ease;
	}

	.sec__chevron--cerrado {
		transform: rotate(-90deg);
	}

	.sec__titulos {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.sec__titulo {
		width: 100%;
		min-height: 34px;
		padding: 0.125rem 0.375rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 800;
		color: var(--text-primary);
		text-overflow: ellipsis;
		background: none;
		border: 1px solid transparent;
		border-radius: 10px;
	}

	.sec__titulo:hover:not(:disabled) {
		border-color: var(--border-subtle);
	}

	.sec__titulo--leer {
		margin: 0;
		min-height: 0;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.sec__titulo:focus-visible {
		outline: none;
		background: var(--bg-surface);
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	.sec__etapa {
		margin-left: 0.4375rem;
		padding: 0.0625rem 0.4375rem;
		font-size: 0.6875rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-secondary, #33423d);
		background: var(--gray-100, #f3f4f6);
		border-radius: 999px;
	}

	.sec__key {
		padding-left: 0.4375rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.sec__conteo {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		background: var(--bg-base);
		border-radius: 999px;
		white-space: nowrap;
	}

	.sec__acciones {
		display: flex;
		gap: 0.125rem;
	}

	/* Sección estrecha: el contador y las acciones bajan a un segundo renglón
	   para que el título no quede en «Información…». */
	@container (max-width: 40rem) {
		.sec__head:has(.sec__acciones) .sec__titulos {
			flex-basis: calc(100% - 4.5rem);
		}

		.sec__conteo {
			margin-left: 0.5rem;
		}

		.sec__acciones {
			margin-left: auto;
		}
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

	.accion:focus-visible,
	.sec__colapsar:focus-visible,
	.sec__agregar:focus-visible {
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

	.sec__error {
		margin: 0;
		padding-left: 2.25rem;
		font-size: 0.75rem;
		color: #b42318;
	}

	.sec__campos {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 2rem;
	}

	.sec__vacio {
		margin: 0;
		padding: 0.875rem 0.75rem;
		font-size: 0.8125rem;
		text-align: center;
		color: var(--text-muted);
		border: 1px dashed var(--border-default);
		border-radius: 12px;
	}

	.sec__agregar {
		align-self: flex-start;
		min-height: 40px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--accion);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
		border: 1px dashed color-mix(in srgb, var(--accion) 45%, transparent);
		border-radius: 12px;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sec__agregar:hover {
		background: color-mix(in srgb, var(--accion) 12%, var(--bg-surface));
	}

	@media (prefers-reduced-motion: reduce) {
		.sec__chevron {
			transition: none;
		}
	}
</style>
