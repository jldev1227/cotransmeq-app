<!--
	Inspector del nodo seleccionado (sección o campo).

	La `key` se puede editar mientras el borrador siga en DRAFT y el store arrastra
	las reglas que la referencian. En una versión publicada el panel entero pasa a
	lectura: cambiar una clave ahí rompería las reglas y los informes históricos que
	la citan.

	Los campos de `validation` que se ofrecen dependen del tipo. Ofrecer `maxFiles`
	en un texto largo dejaría una clave que ningún validador aplica y que el
	backend reporta como warning al publicar.
-->
<script lang="ts">
	import {
		FIELD_TYPE_META,
		FIELD_TYPES,
		LOOKUP_SOURCES,
		capabilitiesOf,
		isContainer,
		type FieldType,
		type ValidationIssue
	} from '$lib/formularios/types';
	import type { BuilderStore } from '$lib/formularios/builder-store.svelte';
	import OptionsEditor from './OptionsEditor.svelte';
	import RuleBuilder from './RuleBuilder.svelte';

	interface Props {
		store: BuilderStore;
		issues: Map<string, ValidationIssue[]>;
	}

	let { store, issues }: Props = $props();

	const seleccion = $derived(store.selection);
	const campo = $derived(seleccion.kind === 'field' && seleccion.id ? store.findField(seleccion.id) : null);
	const seccion = $derived(
		seleccion.kind === 'section' && seleccion.id ? store.findSection(seleccion.id) : null
	);
	const bloqueado = $derived(!store.editable);
	const propios = $derived(
		seleccion.id ? (issues.get(seleccion.id) ?? []) : ([] as ValidationIssue[])
	);

	const cap = $derived(campo ? capabilitiesOf(campo.field.type) : null);

	/// Solo se ofrecen tipos con la misma "forma" cuando ya hay datos que se
	/// perderían: cambiar un SINGLE_CHOICE con seis opciones a un texto las borra,
	/// y el store lo hace de forma explícita, pero conviene avisar antes.
	const cambioDestructivo = $derived.by(() => {
		if (!campo) return false;
		return campo.field.options.length > 0 || campo.field.children.length > 0;
	});

	/** Claves de `validation` con sentido para el tipo actual. */
	const validaciones = $derived.by(() => {
		if (!campo) return [] as { key: string; label: string; tipo: 'number' | 'text'; hint?: string }[];
		const t = campo.field.type;
		if (['SHORT_TEXT', 'LONG_TEXT', 'TIME'].includes(t)) {
			return [
				{ key: 'minLength', label: 'Mínimo de caracteres', tipo: 'number' as const },
				{ key: 'maxLength', label: 'Máximo de caracteres', tipo: 'number' as const },
				{
					key: 'pattern',
					label: 'Formato (expresión regular)',
					tipo: 'text' as const,
					hint: 'Ej.: ^[A-Z]{3}\\d{3}$ para una placa'
				}
			];
		}
		if (['INTEGER', 'DECIMAL', 'CALCULATED'].includes(t)) {
			return [
				{ key: 'min', label: 'Valor mínimo', tipo: 'number' as const },
				{ key: 'max', label: 'Valor máximo', tipo: 'number' as const },
				...(t !== 'INTEGER'
					? [
							{
								key: 'precision',
								label: 'Decimales',
								tipo: 'number' as const,
								hint: 'Máximo 6: es lo que guarda la columna'
							}
						]
					: [])
			];
		}
		if (['PHOTO', 'FILE', 'SIGNATURE'].includes(t)) {
			return [{ key: 'maxFiles', label: 'Máximo de archivos', tipo: 'number' as const }];
		}
		if (isContainer(t)) {
			return [
				{ key: 'minRows', label: 'Mínimo de filas', tipo: 'number' as const },
				{ key: 'maxRows', label: 'Máximo de filas', tipo: 'number' as const }
			];
		}
		if (t === 'MULTIPLE_CHOICE') {
			return [
				{ key: 'minSelected', label: 'Mínimo de opciones', tipo: 'number' as const },
				{ key: 'maxSelected', label: 'Máximo de opciones', tipo: 'number' as const }
			];
		}
		return [];
	});

	function setValidacion(key: string, valor: string, tipo: 'number' | 'text') {
		if (!campo) return;
		const actual = { ...campo.field.validation };
		if (valor === '') delete actual[key];
		else actual[key] = tipo === 'number' ? Number(valor) : valor;
		store.updateField(campo.field.id, { validation: actual });
	}

	function setConfig(key: string, valor: unknown) {
		if (!campo) return;
		const actual = { ...campo.field.config };
		if (valor === '' || valor == null) delete actual[key];
		else actual[key] = valor;
		store.updateField(campo.field.id, { config: actual });
	}
</script>

<aside class="insp" aria-label="Propiedades del elemento seleccionado">
	{#if !campo && !seccion}
		<div class="insp__vacio">
			<p class="insp__vacio-t">Nada seleccionado</p>
			<p class="insp__vacio-d">
				Toca una sección o un campo del canvas para ver y editar sus propiedades.
			</p>
		</div>
	{:else if seccion}
		<header class="insp__head">
			<span class="insp__kind">Sección</span>
			<h3 class="insp__titulo">{seccion.title}</h3>
		</header>

		<div class="insp__cuerpo">
			<label class="campo">
				<span class="campo__label">Título</span>
				<input
					class="campo__input"
					value={seccion.title}
					disabled={bloqueado}
					oninput={(e) => store.updateSection(seccion.id, { title: e.currentTarget.value })}
				/>
			</label>

			<label class="campo">
				<span class="campo__label">Clave</span>
				<input
					class="campo__input campo__input--mono"
					value={seccion.key}
					disabled={bloqueado}
					oninput={(e) => store.updateSection(seccion.id, { key: e.currentTarget.value })}
				/>
				<span class="campo__hint">Identificador estable. Minúsculas, números y «_».</span>
			</label>

			<label class="campo">
				<span class="campo__label">Descripción</span>
				<textarea
					class="campo__input campo__input--area"
					rows="3"
					value={seccion.description ?? ''}
					disabled={bloqueado}
					oninput={(e) =>
						store.updateSection(seccion.id, { description: e.currentTarget.value || null })}
				></textarea>
			</label>
		</div>
	{:else if campo}
		{@const f = campo.field}
		<header class="insp__head">
			<span class="insp__kind">{FIELD_TYPE_META[f.type as FieldType]?.label ?? f.type}</span>
			<h3 class="insp__titulo">{f.label || '(sin etiqueta)'}</h3>
		</header>

		{#if propios.length}
			<ul class="insp__issues">
				{#each propios as issue (issue.code + issue.path)}
					<li class="issue" class:issue--error={issue.severity === 'error'}>{issue.message}</li>
				{/each}
			</ul>
		{/if}

		<div class="insp__cuerpo">
			<label class="campo">
				<span class="campo__label">Etiqueta</span>
				<textarea
					class="campo__input campo__input--area"
					rows="2"
					value={f.label}
					disabled={bloqueado}
					oninput={(e) => store.updateField(f.id, { label: e.currentTarget.value })}
				></textarea>
				<span class="campo__hint">Es el texto que lee el conductor. Se puede corregir siempre.</span>
			</label>

			<label class="campo">
				<span class="campo__label">Clave</span>
				<input
					class="campo__input campo__input--mono"
					value={f.key}
					disabled={bloqueado}
					onchange={(e) => store.renameFieldKey(f.id, e.currentTarget.value)}
				/>
				<span class="campo__hint">
					La referencian las reglas y los informes. Al cambiarla, las reglas se actualizan solas.
				</span>
			</label>

			<label class="campo">
				<span class="campo__label">Tipo</span>
				<select
					class="campo__input"
					value={f.type}
					disabled={bloqueado}
					onchange={(e) => {
						const nuevo = e.currentTarget.value as FieldType;
						if (
							cambioDestructivo &&
							!confirm(
								'Cambiar el tipo elimina las opciones y los campos hijos de esta card. ¿Continuar?'
							)
						) {
							e.currentTarget.value = f.type;
							return;
						}
						store.updateField(f.id, { type: nuevo });
					}}
				>
					{#each FIELD_TYPES as type (type)}
						<option value={type}>{FIELD_TYPE_META[type].label}</option>
					{/each}
				</select>
			</label>

			<label class="campo campo--check">
				<input
					type="checkbox"
					checked={f.required}
					disabled={bloqueado || f.type === 'INFO'}
					onchange={(e) => store.updateField(f.id, { required: e.currentTarget.checked })}
				/>
				<span>
					Obligatorio
					{#if f.type === 'INFO'}
						<span class="campo__hint">Un campo informativo no se responde.</span>
					{/if}
				</span>
			</label>

			<label class="campo">
				<span class="campo__label">Texto de ayuda</span>
				<textarea
					class="campo__input campo__input--area"
					rows="2"
					value={f.helpText ?? ''}
					disabled={bloqueado}
					oninput={(e) => store.updateField(f.id, { helpText: e.currentTarget.value || null })}
				></textarea>
			</label>

			{#if ['SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL'].includes(f.type)}
				<label class="campo">
					<span class="campo__label">Placeholder</span>
					<input
						class="campo__input"
						value={f.placeholder ?? ''}
						disabled={bloqueado}
						oninput={(e) => store.updateField(f.id, { placeholder: e.currentTarget.value || null })}
					/>
				</label>
			{/if}

			{#if f.type === 'LOOKUP'}
				<label class="campo">
					<span class="campo__label">Origen de la referencia</span>
					<select
						class="campo__input"
						value={String(f.config.source ?? '')}
						disabled={bloqueado}
						onchange={(e) => setConfig('source', e.currentTarget.value)}
					>
						<option value="">Selecciona…</option>
						{#each LOOKUP_SOURCES as source (source)}
							<option value={source}>{source}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if f.type === 'CALCULATED'}
				<label class="campo">
					<span class="campo__label">Fórmula</span>
					<input
						class="campo__input campo__input--mono"
						value={String(f.config.formula ?? '')}
						disabled={bloqueado}
						placeholder="cantidad - faltante"
						oninput={(e) => setConfig('formula', e.currentTarget.value)}
					/>
					<span class="campo__hint">
						Referencia claves de esta versión. Se evalúa como dato, nunca como código.
					</span>
				</label>
			{/if}

			{#if cap?.options}
				<div class="bloque">
					<OptionsEditor fieldId={f.id} options={f.options} {store} disabled={bloqueado} />
				</div>
			{/if}

			{#if validaciones.length}
				<div class="bloque">
					<span class="bloque__titulo">Validación</span>
					{#each validaciones as v (v.key)}
						<label class="campo">
							<span class="campo__label">{v.label}</span>
							<input
								class="campo__input"
								class:campo__input--mono={v.tipo === 'text'}
								type={v.tipo}
								step={v.tipo === 'number' ? 'any' : undefined}
								value={f.validation[v.key] ?? ''}
								disabled={bloqueado}
								oninput={(e) => setValidacion(v.key, e.currentTarget.value, v.tipo)}
							/>
							{#if v.hint}<span class="campo__hint">{v.hint}</span>{/if}
						</label>
					{/each}
				</div>
			{/if}

			<div class="bloque">
				<RuleBuilder fieldId={f.id} {store} disabled={bloqueado} />
			</div>
		</div>
	{/if}
</aside>

<style>
	.insp {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--bg-surface, #fff);
	}

	.insp__head {
		padding: 0.75rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.insp__kind {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--emerald-700, #047857);
	}

	.insp__titulo {
		margin-top: 0.125rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.3;
	}

	.insp__cuerpo {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.insp__vacio {
		padding: 2rem 1rem;
		text-align: center;
	}

	.insp__vacio-t {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.insp__vacio-d {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-very-muted, #9a9a9a);
	}

	.insp__issues {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		padding: 0.5rem 0.75rem;
		list-style: none;
		background: #fffbeb;
		border-bottom: 1px solid #fde68a;
	}

	.issue {
		font-size: 0.75rem;
		line-height: 1.35;
		color: #92400e;
	}

	.issue--error {
		color: #b91c1c;
		font-weight: 500;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	.campo--check {
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-primary, #1a1a1a);
	}

	.campo--check input {
		width: 18px;
		height: 18px;
		margin-top: 0.0625rem;
		accent-color: var(--emerald-600, #059669);
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.campo__input {
		width: 100%;
		min-height: 38px;
		padding: 0.3125rem 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 8px;
	}

	.campo__input--mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	.campo__input--area {
		min-height: 3.5rem;
		resize: vertical;
	}

	.campo__input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.campo__input:disabled {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
	}

	.campo__hint {
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-very-muted, #9a9a9a);
	}

	.bloque {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.625rem;
		border-top: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.bloque__titulo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}
</style>
