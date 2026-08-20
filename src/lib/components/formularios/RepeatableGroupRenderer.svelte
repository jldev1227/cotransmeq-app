<!--
	Contenedor repetible (`REPEATABLE_GROUP`) y matriz (`MATRIX`).

	Los dos comparten componente porque comparten modelo: una lista de
	ocurrencias, cada una con las mismas celdas hijas. Lo único que cambia es la
	presentación — el grupo apila tarjetas, la matriz alinea columnas en pantalla
	ancha.

	En móvil la matriz TAMBIÉN se apila. Una tabla de 22 ítems × 4 columnas en 320
	px produce scroll horizontal, que es exactamente lo que el documento prohíbe.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { FormFieldDto } from '$lib/formularios/types';
	import type { RunnerState } from '$lib/formularios/runner-state.svelte';
	import FieldRenderer from './FieldRenderer.svelte';

	interface Props {
		field: FormFieldDto;
		runner: RunnerState;
		depth?: number;
		evidence?: Snippet<[{ field: FormFieldDto; occurrenceId: string | null }]>;
	}

	let { field, runner, depth = 0, evidence }: Props = $props();

	const filas = $derived(runner.occurrencesOf(field.id));
	const errores = $derived(runner.errorsFor(field.id, null));
	const fieldState = $derived(runner.stateOf(field.id, null));

	const maxRows = $derived(Number(field.validation?.maxRows ?? 0) || null);
	const minRows = $derived(Number(field.validation?.minRows ?? 0) || 0);

	const puedeAgregar = $derived(!runner.readonly && (maxRows === null || filas.length < maxRows));
	const puedeQuitar = $derived(!runner.readonly && filas.length > minRows);

	const errorId = $derived(`g-${field.id}-error`);
</script>

<fieldset class="grupo" class:grupo--error={errores.length > 0}>
	<legend class="grupo__legend">
		{field.label}
		{#if fieldState.required}<span class="grupo__req" aria-label="obligatorio">*</span>{/if}
		<span class="grupo__conteo">
			{filas.length}
			{filas.length === 1 ? 'fila' : 'filas'}
			{#if maxRows}<span class="grupo__tope">de {maxRows}</span>{/if}
		</span>
	</legend>

	{#if field.helpText}
		<p class="grupo__ayuda">{field.helpText}</p>
	{/if}

	{#if filas.length === 0}
		<p class="grupo__vacio">Sin filas todavía.</p>
	{/if}

	<ol class="grupo__filas">
		{#each filas as occurrenceId, index (occurrenceId)}
			<li class="fila" class:fila--matriz={field.type === 'MATRIX'}>
				<div class="fila__cabecera">
					<span class="fila__numero">#{index + 1}</span>
					{#if puedeQuitar}
						<button
							type="button"
							class="fila__quitar"
							onclick={() => runner.removeOccurrence(field.id, occurrenceId)}
						>
							Quitar fila {index + 1}
						</button>
					{/if}
				</div>

				<div class="fila__celdas" class:fila__celdas--matriz={field.type === 'MATRIX'}>
					{#each field.children as hijo (hijo.id)}
						<FieldRenderer field={hijo} {runner} {occurrenceId} depth={depth + 1} {evidence} />
					{/each}
				</div>
			</li>
		{/each}
	</ol>

	{#if puedeAgregar}
		<button type="button" class="grupo__agregar" onclick={() => runner.addOccurrence(field.id)}>
			+ Agregar {field.type === 'MATRIX' ? 'registro' : 'fila'}
		</button>
	{:else if !runner.readonly && maxRows !== null}
		<p class="grupo__tope-aviso">Se alcanzó el máximo de {maxRows} filas.</p>
	{/if}

	{#if errores.length}
		<p class="grupo__error" id={errorId} role="alert">{errores[0].message}</p>
	{/if}
</fieldset>

<style>
	.grupo {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
		background: var(--gray-50, #f9fafb);
	}

	.grupo--error {
		border-color: #dc2626;
	}

	.grupo__legend {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0 0.25rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.grupo__req {
		color: #dc2626;
	}

	.grupo__conteo {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--text-muted, #6b6b6b);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.grupo__tope {
		opacity: 0.7;
	}

	.grupo__ayuda {
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
	}

	.grupo__vacio,
	.grupo__tope-aviso {
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.grupo__filas {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		list-style: none;
	}

	.fila {
		padding: 0.625rem 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
	}

	.fila__cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.fila__numero {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-very-muted, #9a9a9a);
	}

	.fila__quitar {
		min-height: 36px;
		padding: 0 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		color: #b91c1c;
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-decoration: underline;
	}

	.fila__celdas {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	/* Columnas solo a partir de 768 px; por debajo se apila para no producir
	   scroll horizontal en un teléfono de 320 px. */
	@media (min-width: 768px) {
		.fila__celdas--matriz {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
			gap: 0.5rem 0.75rem;
			align-items: start;
		}
	}

	.grupo__agregar {
		align-self: flex-start;
		min-height: 44px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px dashed #fdba74;
		border-radius: 10px;
		cursor: pointer;
	}

	.grupo__agregar:focus-visible,
	.fila__quitar:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.grupo__error {
		font-size: 0.8125rem;
		font-weight: 500;
		color: #b91c1c;
	}
</style>
