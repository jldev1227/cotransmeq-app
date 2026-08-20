<!--
	Editor de opciones de un `SINGLE_CHOICE` / `MULTIPLE_CHOICE`.

	Distingue con insistencia `value` de `label`, porque es la confusión que
	produce el fallo más silencioso del módulo:

	  - `label` es texto de presentación. HSEQ lo corrige cuando quiera.
	  - `value` es el token que referencian las reglas condicionales y los
	    informes. Cambiarlo mueve la regla (el store lo arrastra), pero también
	    cambia lo que se guarda para los envíos futuros.

	Los presets existen porque nueve de cada diez listas de HSEQ son una de estas
	cuatro, y teclearlas a mano invita a escribir `NA` en un sitio y `N/A` en otro.
-->
<script lang="ts">
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { OPTION_VALUE_PATTERN } from '$lib/formularios/types';
	import type { BuilderOption, BuilderStore } from '$lib/formularios/builder-store.svelte';

	interface Props {
		fieldId: string;
		options: BuilderOption[];
		store: BuilderStore;
		disabled?: boolean;
	}

	let { fieldId, options, store, disabled = false }: Props = $props();

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const flipDuration = reduceMotion ? 0 : 140;

	const PRESETS: { nombre: string; opciones: { value: string; label: string; color: string }[] }[] = [
		{
			nombre: 'Cumple / No cumple / No aplica',
			opciones: [
				{ value: 'C', label: 'Cumple', color: 'emerald' },
				{ value: 'NC', label: 'No cumple', color: 'red' },
				{ value: 'NA', label: 'No aplica', color: 'gray' }
			]
		},
		{
			nombre: 'Sí / No / No aplica',
			opciones: [
				{ value: 'SI', label: 'Sí', color: 'emerald' },
				{ value: 'NO', label: 'No', color: 'red' },
				{ value: 'NA', label: 'No aplica', color: 'gray' }
			]
		},
		{
			nombre: 'Bueno / Malo / Regular',
			opciones: [
				{ value: 'B', label: 'Bueno', color: 'emerald' },
				{ value: 'M', label: 'Malo', color: 'red' },
				{ value: 'R', label: 'Regular', color: 'amber' }
			]
		},
		{
			nombre: 'Bueno / Malo / Cambiar-Reemplazar',
			opciones: [
				{ value: 'B', label: 'Bueno', color: 'emerald' },
				{ value: 'M', label: 'Malo', color: 'red' },
				{ value: 'CR', label: 'Cambiar / Reemplazar', color: 'amber' }
			]
		}
	];

	const COLORES = ['emerald', 'red', 'amber', 'gray'] as const;

	/// Valores duplicados: la base los rechaza con `uq_form_field_options_value`,
	/// así que se avisa mientras se escribe y no al publicar.
	const duplicados = $derived.by(() => {
		const vistos = new Map<string, number>();
		for (const o of options) vistos.set(o.value, (vistos.get(o.value) ?? 0) + 1);
		return new Set([...vistos.entries()].filter(([, n]) => n > 1).map(([v]) => v));
	});

	function aplicarPreset(preset: (typeof PRESETS)[number]) {
		/// Reemplaza la lista entera. Es lo que el usuario espera de un preset, y
		/// mezclarlo con lo que hubiera dejaría duplicados.
		for (const existente of [...options]) store.removeOption(fieldId, existente.id);
		for (const opcion of preset.opciones) {
			store.addOption(fieldId, { value: opcion.value, label: opcion.label });
		}
		/// El color se aplica después, cuando las opciones ya existen con su id.
		const creadas = store.findField(fieldId)?.field.options ?? [];
		preset.opciones.forEach((o, i) => {
			if (creadas[i]) store.updateOption(fieldId, creadas[i].id, { color: o.color });
		});
	}

	function onConsider(e: CustomEvent<DndEvent<BuilderOption>>) {
		const campo = store.findField(fieldId);
		if (campo) campo.field.options = e.detail.items;
	}

	function onFinalize(e: CustomEvent<DndEvent<BuilderOption>>) {
		store.reorderOptions(fieldId, e.detail.items);
	}
</script>

<div class="opciones">
	<div class="opciones__cabecera">
		<span class="opciones__titulo">Opciones</span>
		<span class="opciones__conteo">{options.length}</span>
	</div>

	{#if !disabled}
		<div class="presets">
			<span class="presets__label">Listas frecuentes</span>
			<div class="presets__botones">
				{#each PRESETS as preset (preset.nombre)}
					<button type="button" class="preset" onclick={() => aplicarPreset(preset)}>
						{preset.opciones.map((o) => o.value).join(' / ')}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<ul
		class="lista"
		use:dndzone={{
			items: options,
			dragDisabled: disabled,
			flipDurationMs: flipDuration,
			dropTargetStyle: {},
			type: `options-${fieldId}`
		}}
		onconsider={onConsider}
		onfinalize={onFinalize}
	>
		{#each options as opcion, i (opcion.id)}
			<li class="op" animate:flip={{ duration: flipDuration }}>
				<span class="op__asa" data-dnd-handle aria-hidden="true">⠿</span>

				<div class="op__campos">
					<label class="op__campo">
						<span class="op__hint">Etiqueta</span>
						<input
							class="op__input"
							value={opcion.label}
							{disabled}
							oninput={(e) => store.updateOption(fieldId, opcion.id, { label: e.currentTarget.value })}
						/>
					</label>

					<label class="op__campo op__campo--valor">
						<span class="op__hint">Valor</span>
						<input
							class="op__input op__input--mono"
							class:op__input--dup={duplicados.has(opcion.value)}
							value={opcion.value}
							{disabled}
							aria-invalid={duplicados.has(opcion.value) || !OPTION_VALUE_PATTERN.test(opcion.value)}
							oninput={(e) => store.updateOption(fieldId, opcion.id, { value: e.currentTarget.value })}
						/>
					</label>

					<label class="op__campo op__campo--corto">
						<span class="op__hint">Color</span>
						<select
							class="op__input"
							value={opcion.color ?? ''}
							{disabled}
							onchange={(e) =>
								store.updateOption(fieldId, opcion.id, { color: e.currentTarget.value || null })}
						>
							<option value="">—</option>
							{#each COLORES as color (color)}
								<option value={color}>{color}</option>
							{/each}
						</select>
					</label>
				</div>

				<div class="op__acciones">
					<button
						type="button"
						class="mini"
						disabled={disabled || i === 0}
						aria-label="Mover «{opcion.label}» arriba"
						onclick={() =>
							store.reorderOptions(fieldId, (() => {
								const copia = [...options];
								[copia[i - 1], copia[i]] = [copia[i], copia[i - 1]];
								return copia;
							})())}
					>
						↑
					</button>
					<button
						type="button"
						class="mini"
						disabled={disabled || i === options.length - 1}
						aria-label="Mover «{opcion.label}» abajo"
						onclick={() =>
							store.reorderOptions(fieldId, (() => {
								const copia = [...options];
								[copia[i], copia[i + 1]] = [copia[i + 1], copia[i]];
								return copia;
							})())}
					>
						↓
					</button>
					<button
						type="button"
						class="mini mini--peligro"
						{disabled}
						aria-label="Eliminar «{opcion.label}»"
						onclick={() => store.removeOption(fieldId, opcion.id)}
					>
						✕
					</button>
				</div>

				{#if duplicados.has(opcion.value)}
					<p class="op__error">El valor «{opcion.value}» está repetido en este campo.</p>
				{:else if opcion.value && !OPTION_VALUE_PATTERN.test(opcion.value)}
					<p class="op__error">Solo letras, números, «.», «_» y «-», empezando por letra o número.</p>
				{/if}
			</li>
		{/each}
	</ul>

	{#if options.length === 0}
		<p class="opciones__vacio">
			Un campo de selección sin opciones no se puede publicar.
		</p>
	{/if}

	{#if !disabled}
		<button type="button" class="agregar" onclick={() => store.addOption(fieldId)}>
			+ Agregar opción
		</button>
	{/if}
</div>

<style>
	.opciones {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.opciones__cabecera {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.opciones__titulo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.opciones__conteo {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.presets {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.presets__label {
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.presets__botones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.preset {
		min-height: 32px;
		padding: 0 0.5rem;
		font: inherit;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 999px;
		cursor: pointer;
	}

	.lista {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
		min-height: 1rem;
	}

	.op {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: 0.25rem;
		padding: 0.375rem;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 8px;
	}

	.op__asa {
		align-self: center;
		width: 1rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
		cursor: grab;
		user-select: none;
	}

	.op__campos {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.25rem;
	}

	@media (min-width: 480px) {
		.op__campos {
			grid-template-columns: 1.4fr 1fr 0.7fr;
		}
	}

	.op__campo {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.op__hint {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-very-muted, #9a9a9a);
	}

	.op__input {
		width: 100%;
		min-height: 34px;
		padding: 0.1875rem 0.375rem;
		font: inherit;
		font-size: 0.8125rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 6px;
	}

	.op__input--mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	.op__input--dup {
		border-color: #dc2626;
		background: #fef2f2;
	}

	.op__input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.18);
	}

	.op__acciones {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.mini {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: 1px solid transparent;
		border-radius: 5px;
		cursor: pointer;
	}

	.mini:hover:not(:disabled) {
		background: #fff;
		border-color: var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.mini:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.mini--peligro:hover:not(:disabled) {
		background: #fef2f2;
		color: #b91c1c;
	}

	.mini:focus-visible,
	.preset:focus-visible,
	.agregar:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.op__error {
		grid-column: 1 / -1;
		padding-left: 1.25rem;
		font-size: 0.6875rem;
		color: #b91c1c;
	}

	.opciones__vacio {
		font-size: 0.75rem;
		color: #b91c1c;
	}

	.agregar {
		align-self: flex-start;
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
</style>
