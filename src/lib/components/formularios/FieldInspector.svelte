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
	import { confirmarEliminacion } from '$lib/stores/confirm';
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
	import {
		firmaDeEtapa,
		numeroDeEtapa,
		problemasEtapas,
		tituloDeEtapa
	} from '$lib/formularios/etapas';
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

	/**
	 * Etapas ya declaradas en el formulario, más la siguiente libre.
	 *
	 * El selector ofrece solo esas: una etapa es un paso que el conductor cierra
	 * en el teléfono, y dejar escribir «7» en un formulario de tres pasos crea
	 * cuatro pasos vacíos en medio.
	 */
	const etapasDeclaradas = $derived(
		[...new Set(store.sections.map(numeroDeEtapa).filter((n): n is number => n !== null))].sort(
			(a, b) => a - b
		)
	);
	const siguienteEtapa = $derived(
		etapasDeclaradas.length ? etapasDeclaradas[etapasDeclaradas.length - 1] + 1 : 1
	);
	const avisosEtapas = $derived(problemasEtapas(store.sections));
	const etapaActual = $derived(seccion ? numeroDeEtapa(seccion) : null);
	const seccionesDeLaEtapa = $derived(
		etapaActual === null ? 0 : store.sections.filter((s) => numeroDeEtapa(s) === etapaActual).length
	);

	function cambiarEtapa(id: string, valor: string) {
		if (valor === '') store.updateSectionStage(id, { etapa: null });
		else store.updateSectionStage(id, { etapa: Number(valor) });
	}
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

			<!-- Etapas: tramos que el conductor diligencia y cierra por separado
			     dentro de UN SOLO envío (p. ej. prealistamiento → desplazamiento →
			     cierre). Viven en `settings` de la sección, sin columna propia. El
			     título y la firma son de la etapa entera: el store los propaga a
			     todas las secciones con el mismo número. -->
			<fieldset class="campo etapa">
				<legend class="campo__label">Etapa</legend>
				<select
					class="campo__input"
					value={etapaActual === null ? '' : String(etapaActual)}
					disabled={bloqueado}
					aria-label="Etapa de la sección"
					onchange={(e) => cambiarEtapa(seccion.id, e.currentTarget.value)}
				>
					<option value="">Sin etapa · el formulario se diligencia de una vez</option>
					{#each etapasDeclaradas as n (n)}
						<option value={String(n)}>Etapa {n}</option>
					{/each}
					<option value={String(siguienteEtapa)}>Nueva etapa {siguienteEtapa}</option>
				</select>

				{#if etapaActual !== null}
					<label class="campo">
						<span class="campo__label">Título de la etapa {etapaActual}</span>
						<input
							class="campo__input"
							value={tituloDeEtapa(seccion) ?? ''}
							placeholder={`Etapa ${etapaActual}`}
							disabled={bloqueado}
							oninput={(e) =>
								store.updateSectionStage(seccion.id, { etapaTitulo: e.currentTarget.value })}
						/>
					</label>
					<label class="campo campo--check">
						<input
							type="checkbox"
							checked={firmaDeEtapa(seccion)}
							disabled={bloqueado}
							onchange={(e) =>
								store.updateSectionStage(seccion.id, { etapaFirma: e.currentTarget.checked })}
						/>
						<span>
							Se cierra con la firma del conductor
							<span class="campo__hint">
								Solo cambia los textos del teléfono: qué campo firma lo decide la sección.
							</span>
						</span>
					</label>
					<span class="campo__hint">
						{seccionesDeLaEtapa === 1
							? 'Esta es la única sección de la etapa.'
							: `La etapa agrupa ${seccionesDeLaEtapa} secciones; el título y la firma se aplican a todas.`}
					</span>
				{/if}

				{#each avisosEtapas as aviso (aviso.mensaje)}
					<p class="etapa__aviso" class:etapa__aviso--error={aviso.nivel === 'error'}>
						{aviso.mensaje}
					</p>
				{/each}
			</fieldset>
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
					onchange={async (e) => {
						const select = e.currentTarget;
						const id = f.id;
						const nuevo = select.value as FieldType;
						if (cambioDestructivo) {
							/// Mientras se decide, el select vuelve al tipo actual; solo cambia si confirma.
							select.value = f.type;
							const ok = await confirmarEliminacion({
								title: '¿Cambiar el tipo del campo?',
								message: 'Cambiar el tipo elimina las opciones y los campos hijos de esta card.',
								confirmText: 'Cambiar tipo'
							});
							if (!ok) return;
							select.value = nuevo;
						}
						store.updateField(id, { type: nuevo });
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
		color: var(--emerald-700, #166534);
	}

	.insp__titulo {
		margin-top: 0.125rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #0f172a);
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
		color: var(--text-secondary, #334155);
	}

	.insp__vacio-d {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-very-muted, #94a3b8);
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
		color: var(--text-primary, #0f172a);
	}

	.campo--check input {
		width: 18px;
		height: 18px;
		margin-top: 0.0625rem;
		accent-color: var(--emerald-600, #15803d);
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #64748b);
	}

	.campo__input {
		width: 100%;
		min-height: 38px;
		padding: 0.3125rem 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--text-primary, #0f172a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 8px;
	}

	.campo__input--mono {
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
	}

	.campo__input--area {
		min-height: 3.5rem;
		resize: vertical;
	}

	.campo__input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #15803d);
		box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
	}

	.campo__input:disabled {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #64748b);
	}

	.etapa {
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px dashed var(--border-strong, rgba(0, 0, 0, 0.16));
		border-radius: 10px;
	}

	.etapa > legend {
		padding: 0 0.25rem;
	}

	.etapa__aviso {
		margin: 0;
		padding: 0.375rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
	}

	.etapa__aviso--error {
		color: #991b1b;
		background: #fef2f2;
		border-color: #fecaca;
	}

	.campo__hint {
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-very-muted, #94a3b8);
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
		color: var(--text-muted, #64748b);
	}
</style>
