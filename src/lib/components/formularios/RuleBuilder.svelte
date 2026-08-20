<!--
	Constructor de reglas condicionales.

	Se construye en lenguaje natural («si ESTADO es igual a No cumple, entonces
	exigir OBSERVACIÓN») y produce el JSON canónico. Nunca hay un editor de texto
	libre: la regla es un dato, no código, y escribirla a mano garantizaría
	`fieldKey` inexistentes que solo aparecerían al publicar.

	Tres protecciones que evitan errores que el backend rechazaría más tarde:

	  1. los desplegables solo ofrecen campos que EXISTEN en esta versión;
	  2. si el campo de la condición tiene opciones, el valor también es un
	     desplegable — no se puede teclear un `NC` que HSEQ acaba de renombrar;
	  3. no se puede condicionar un campo a su propio valor (nunca se resolvería).
-->
<script lang="ts">
	import {
		ARRAY_OPERATORS,
		NUMERIC_OPERATORS,
		RULE_ACTIONS,
		RULE_ACTION_LABELS,
		RULE_OPERATORS,
		RULE_OPERATOR_LABELS,
		VALUELESS_OPERATORS,
		capabilitiesOf,
		type Rule,
		type RuleAction,
		type RuleOperator
	} from '$lib/formularios/types';
	import type { BuilderStore } from '$lib/formularios/builder-store.svelte';

	interface Props {
		fieldId: string;
		store: BuilderStore;
		disabled?: boolean;
	}

	let { fieldId, store, disabled = false }: Props = $props();

	const entrada = $derived(store.findField(fieldId));
	const rule = $derived(entrada?.field.visibilityRule ?? null);

	/// Candidatos a condición: todos los campos con respuesta, menos el propio.
	/// Los contenedores y los INFO no valen — no tienen valor que comparar.
	const candidatos = $derived(
		store
			.allFields()
			.filter((e) => e.field.id !== fieldId && capabilitiesOf(e.field.type).slot !== 'none')
			.map((e) => ({ key: e.field.key, label: e.field.label, type: e.field.type, options: e.field.options }))
			.filter((c) => c.key)
	);

	/// Destinos del efecto: cualquier campo, incluido el propio (caso habitual).
	const destinos = $derived(
		store
			.allFields()
			.map((e) => ({ key: e.field.key, label: e.field.label }))
			.filter((c) => c.key)
	);

	const targetKey = $derived(rule?.effect?.targetFieldKey ?? entrada?.field.key ?? '');

	function crearRegla() {
		const primero = candidatos[0];
		if (!primero) return;
		store.setRule(fieldId, {
			version: 1,
			all: [{ fieldKey: primero.key, operator: 'equals', value: primero.options[0]?.value ?? '' }],
			effect: { action: 'require', targetFieldKey: entrada?.field.key }
		});
	}

	function quitarRegla() {
		store.setRule(fieldId, null);
	}

	function actualizar(patch: (draft: Rule) => void) {
		if (!rule) return;
		const copia: Rule = structuredClone(rule);
		patch(copia);
		store.setRule(fieldId, copia);
	}

	function agregarCondicion() {
		const primero = candidatos[0];
		if (!primero) return;
		actualizar((draft) => {
			draft.all = [
				...(draft.all ?? []),
				{ fieldKey: primero.key, operator: 'equals', value: primero.options[0]?.value ?? '' }
			];
		});
	}

	function quitarCondicion(index: number) {
		actualizar((draft) => {
			draft.all = (draft.all ?? []).filter((_, i) => i !== index);
		});
	}

	function condicionDe(index: number) {
		return rule?.all?.[index];
	}

	function campoDe(key: string) {
		return candidatos.find((c) => c.key === key);
	}

	/// El operador determina qué control necesita el valor. Sin esto, un `in`
	/// pediría un texto y el backend lo rechazaría por no ser array.
	function tipoValor(operator: RuleOperator): 'ninguno' | 'opciones' | 'multiopciones' | 'numero' | 'texto' {
		if (VALUELESS_OPERATORS.includes(operator)) return 'ninguno';
		if (ARRAY_OPERATORS.includes(operator)) return 'multiopciones';
		if (NUMERIC_OPERATORS.includes(operator)) return 'numero';
		return 'opciones';
	}
</script>

<div class="regla">
	<div class="regla__cabecera">
		<span class="regla__titulo">Regla condicional</span>
		{#if rule && !disabled}
			<button type="button" class="regla__quitar" onclick={quitarRegla}>Quitar regla</button>
		{/if}
	</div>

	{#if !rule}
		<p class="regla__vacia">
			Sin regla: el campo se muestra siempre.
		</p>
		{#if !disabled}
			{#if candidatos.length === 0}
				<p class="regla__aviso">
					Hace falta al menos otro campo con respuesta para poder condicionar algo.
				</p>
			{:else}
				<button type="button" class="regla__crear" onclick={crearRegla}>+ Crear regla</button>
			{/if}
		{/if}
	{:else}
		<div class="frase">
			<span class="frase__palabra">Si</span>

			{#each rule.all ?? [] as condicion, i (i)}
				{@const campo = campoDe(condicion.fieldKey)}
				{@const modo = tipoValor(condicion.operator)}

				<div class="cond">
					{#if i > 0}<span class="cond__y">y</span>{/if}

					<label class="sr-only" for={`c-${fieldId}-${i}-campo`}>Campo de la condición</label>
					<select
						id={`c-${fieldId}-${i}-campo`}
						class="sel"
						{disabled}
						value={condicion.fieldKey}
						onchange={(e) =>
							actualizar((draft) => {
								const nuevo = e.currentTarget.value;
								const c = draft.all![i];
								c.fieldKey = nuevo;
								/// Al cambiar de campo se reinicia el valor: un `NC` de un
								/// campo no significa nada en otro con opciones distintas.
								const destino = campoDe(nuevo);
								c.value = destino?.options[0]?.value ?? '';
							})}
					>
						{#each candidatos as c (c.key)}
							<option value={c.key}>{c.label}</option>
						{/each}
					</select>

					<label class="sr-only" for={`c-${fieldId}-${i}-op`}>Operador</label>
					<select
						id={`c-${fieldId}-${i}-op`}
						class="sel sel--op"
						{disabled}
						value={condicion.operator}
						onchange={(e) =>
							actualizar((draft) => {
								const op = e.currentTarget.value as RuleOperator;
								const c = draft.all![i];
								c.operator = op;
								/// El valor se normaliza al tipo que el operador nuevo exige.
								if (VALUELESS_OPERATORS.includes(op)) delete c.value;
								else if (ARRAY_OPERATORS.includes(op)) c.value = Array.isArray(c.value) ? c.value : [];
								else if (Array.isArray(c.value)) c.value = c.value[0] ?? '';
							})}
					>
						{#each RULE_OPERATORS as op (op)}
							<option value={op}>{RULE_OPERATOR_LABELS[op]}</option>
						{/each}
					</select>

					{#if modo === 'ninguno'}
						<span class="cond__nada">—</span>
					{:else if modo === 'numero'}
						<label class="sr-only" for={`c-${fieldId}-${i}-val`}>Valor</label>
						<input
							id={`c-${fieldId}-${i}-val`}
							class="sel sel--num"
							type="number"
							step="any"
							{disabled}
							value={(condicion.value as number) ?? ''}
							oninput={(e) =>
								actualizar((draft) => {
									draft.all![i].value = e.currentTarget.value === '' ? '' : Number(e.currentTarget.value);
								})}
						/>
					{:else if modo === 'multiopciones' && campo && campo.options.length}
						<div class="multi" role="group" aria-label="Valores de la condición">
							{#each campo.options as opcion (opcion.id)}
								{@const marcada = Array.isArray(condicion.value) && condicion.value.includes(opcion.value)}
								<button
									type="button"
									class="multi__chip"
									class:multi__chip--on={marcada}
									{disabled}
									aria-pressed={marcada}
									onclick={() =>
										actualizar((draft) => {
											const actual = Array.isArray(draft.all![i].value)
												? (draft.all![i].value as unknown[])
												: [];
											draft.all![i].value = marcada
												? actual.filter((v) => v !== opcion.value)
												: [...actual, opcion.value];
										})}
								>
									{opcion.label}
								</button>
							{/each}
						</div>
					{:else if campo && campo.options.length}
						<!-- Desplegable y no texto libre: es lo que impide una condición
						     contra un `value` que ya no existe. -->
						<label class="sr-only" for={`c-${fieldId}-${i}-val`}>Valor</label>
						<select
							id={`c-${fieldId}-${i}-val`}
							class="sel"
							{disabled}
							value={String(condicion.value ?? '')}
							onchange={(e) =>
								actualizar((draft) => {
									draft.all![i].value = e.currentTarget.value;
								})}
						>
							{#each campo.options as opcion (opcion.id)}
								<option value={opcion.value}>{opcion.label} ({opcion.value})</option>
							{/each}
						</select>
					{:else}
						<label class="sr-only" for={`c-${fieldId}-${i}-val`}>Valor</label>
						<input
							id={`c-${fieldId}-${i}-val`}
							class="sel"
							type="text"
							{disabled}
							value={String(condicion.value ?? '')}
							oninput={(e) =>
								actualizar((draft) => {
									draft.all![i].value = e.currentTarget.value;
								})}
						/>
					{/if}

					{#if !disabled && (rule.all?.length ?? 0) > 1}
						<button
							type="button"
							class="cond__quitar"
							aria-label="Quitar condición {i + 1}"
							onclick={() => quitarCondicion(i)}
						>
							✕
						</button>
					{/if}
				</div>
			{/each}

			{#if !disabled}
				<button type="button" class="frase__agregar" onclick={agregarCondicion}>+ y…</button>
			{/if}

			<span class="frase__palabra">entonces</span>

			<label class="sr-only" for={`r-${fieldId}-accion`}>Acción</label>
			<select
				id={`r-${fieldId}-accion`}
				class="sel sel--accion"
				{disabled}
				value={rule.effect.action}
				onchange={(e) =>
					actualizar((draft) => {
						draft.effect.action = e.currentTarget.value as RuleAction;
					})}
			>
				{#each RULE_ACTIONS as accion (accion)}
					<option value={accion}>{RULE_ACTION_LABELS[accion]}</option>
				{/each}
			</select>

			<label class="sr-only" for={`r-${fieldId}-target`}>Campo afectado</label>
			<select
				id={`r-${fieldId}-target`}
				class="sel"
				{disabled}
				value={targetKey}
				onchange={(e) =>
					actualizar((draft) => {
						draft.effect.targetFieldKey = e.currentTarget.value;
					})}
			>
				{#each destinos as d (d.key)}
					<option value={d.key}>{d.label}</option>
				{/each}
			</select>
		</div>

		{#if (rule.all ?? []).some((c) => c.fieldKey === targetKey)}
			<p class="regla__error">
				Una condición mira el mismo campo que el efecto afecta: la regla nunca se podría resolver.
			</p>
		{/if}

		<p class="regla__nota">
			«mostrar» oculta el campo por defecto y solo lo muestra cuando la condición se cumple.
		</p>
	{/if}
</div>

<style>
	.regla {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.regla__cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.regla__titulo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.regla__quitar {
		min-height: 30px;
		padding: 0 0.375rem;
		font: inherit;
		font-size: 0.6875rem;
		color: #b91c1c;
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
	}

	.regla__vacia,
	.regla__nota,
	.regla__aviso {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-very-muted, #9a9a9a);
	}

	.regla__aviso {
		color: #92400e;
	}

	.regla__error {
		font-size: 0.75rem;
		font-weight: 500;
		color: #b91c1c;
	}

	.regla__crear {
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

	.frase {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 8px;
		font-size: 0.8125rem;
	}

	.frase__palabra {
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.cond {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}

	.cond__y {
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.cond__nada {
		color: var(--text-very-muted, #9a9a9a);
	}

	.sel {
		min-height: 34px;
		max-width: 12rem;
		padding: 0.1875rem 0.375rem;
		font: inherit;
		font-size: 0.75rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 6px;
	}

	.sel--op {
		max-width: 9.5rem;
	}

	.sel--accion {
		max-width: 7.5rem;
	}

	.sel--num {
		max-width: 6rem;
	}

	.sel:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.18);
	}

	.multi {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1875rem;
	}

	.multi__chip {
		min-height: 30px;
		padding: 0 0.4375rem;
		font: inherit;
		font-size: 0.6875rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 999px;
		cursor: pointer;
	}

	.multi__chip--on {
		background: #fff7ed;
		border-color: #ea580c;
		color: #9a3412;
		font-weight: 600;
	}

	.cond__quitar {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.625rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	.cond__quitar:hover {
		background: #fef2f2;
		color: #b91c1c;
	}

	.frase__agregar {
		min-height: 30px;
		padding: 0 0.375rem;
		font: inherit;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: none;
		border: 1px dashed #fdba74;
		border-radius: 6px;
		cursor: pointer;
	}

	.multi__chip:focus-visible,
	.cond__quitar:focus-visible,
	.frase__agregar:focus-visible,
	.regla__crear:focus-visible,
	.regla__quitar:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
