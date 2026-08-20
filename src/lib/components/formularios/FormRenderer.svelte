<!--
	Renderer del formulario completo.

	Es el ÚNICO renderer del módulo: lo usan el preview del builder, el runner del
	portal y el recibo de un envío. El documento lo exige explícitamente, y la
	razón es concreta: con dos implementaciones, HSEQ aprueba en el preview un
	formulario que en el teléfono se comporta de otra forma.

	Lo que cambia entre los tres usos es el `RunnerState` que se le pasa
	(`readonly`, respuestas precargadas) y el chrome de alrededor — no este
	componente.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { FormFieldDto } from '$lib/formularios/types';
	import type { RunnerState } from '$lib/formularios/runner-state.svelte';
	import { fieldLabelPath } from '$lib/formularios/runner-state.svelte';
	import FieldRenderer from './FieldRenderer.svelte';

	interface Props {
		runner: RunnerState;
		title?: string | null;
		instructions?: string | null;
		/** Muestra el resumen accesible de errores tras intentar enviar. */
		showErrorSummary?: boolean;
		/** Captura de evidencia; solo la pasa el runner del portal. */
		evidence?: Snippet<[{ field: FormFieldDto; occurrenceId: string | null }]>;
	}

	let {
		runner,
		title = null,
		instructions = null,
		showErrorSummary = true,
		evidence
	}: Props = $props();

	/**
	 * Secciones con al menos un campo visible.
	 *
	 * Una sección cuyos campos están todos ocultos por reglas no debe dejar un
	 * encabezado suelto con nada debajo: al conductor le parece que la app se
	 * rompió.
	 */
	const seccionesVisibles = $derived(
		runner.sections.filter((section) =>
			section.fields.some((field) => runner.stateOf(field.id, null).visible)
		)
	);

	/**
	 * Lleva el foco al primer campo con error.
	 *
	 * Es lo que convierte el resumen de errores en algo usable: en un
	 * preoperacional de 200 ítems, decir "hay 3 errores" sin llevar al primero
	 * obliga a recorrer la pantalla entera a mano.
	 */
	function irAlPrimerError() {
		const primero = runner.validation.errors[0];
		if (!primero) return;
		const sufijo = primero.occurrenceId ? `-${primero.occurrenceId}` : '';
		const nodo = document.getElementById(`f-${primero.fieldId}${sufijo}`);
		if (nodo) {
			nodo.scrollIntoView({ behavior: 'smooth', block: 'center' });
			(nodo as HTMLElement).focus({ preventScroll: true });
			return;
		}
		/// Los contenedores y los campos de evidencia no tienen input propio; se
		/// cae al contenedor de la card.
		document
			.querySelector(`[data-field-key="${CSS.escape(primero.fieldKey)}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
</script>

<div class="formulario">
	{#if title}
		<h2 class="formulario__titulo">{title}</h2>
	{/if}

	{#if instructions}
		<div class="formulario__instrucciones" role="note">{instructions}</div>
	{/if}

	{#if showErrorSummary && runner.submitAttempted && runner.validation.errors.length > 0}
		<!-- `role="alert"` + `tabindex="-1"` para que el lector de pantalla lo
		     anuncie y se pueda enfocar al pulsar Enviar. -->
		<div class="resumen" role="alert" tabindex="-1">
			<p class="resumen__titulo">
				Faltan {runner.validation.errors.length}
				{runner.validation.errors.length === 1 ? 'respuesta' : 'respuestas'}
			</p>
			<ul class="resumen__lista">
				{#each runner.validation.errors.slice(0, 8) as error (error.fieldId + (error.occurrenceId ?? ''))}
					<li>{fieldLabelPath(runner.sections, error.fieldId) || error.fieldKey}: {error.message}</li>
				{/each}
			</ul>
			{#if runner.validation.errors.length > 8}
				<p class="resumen__mas">y {runner.validation.errors.length - 8} más…</p>
			{/if}
			<button type="button" class="resumen__ir" onclick={irAlPrimerError}>
				Ir al primer campo pendiente
			</button>
		</div>
	{/if}

	{#each seccionesVisibles as section (section.id)}
		<section class="seccion" aria-labelledby={`s-${section.id}`}>
			<header class="seccion__cabecera">
				<h3 class="seccion__titulo" id={`s-${section.id}`}>{section.title}</h3>
				{#if section.description}
					<p class="seccion__desc">{section.description}</p>
				{/if}
			</header>

			<div class="seccion__campos">
				{#each section.fields as field (field.id)}
					<FieldRenderer {field} {runner} {evidence} />
				{/each}
			</div>
		</section>
	{/each}

	{#if seccionesVisibles.length === 0}
		<p class="formulario__vacio">Este formulario todavía no tiene campos que diligenciar.</p>
	{/if}
</div>

<style>
	.formulario {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-width: 44rem;
		margin: 0 auto;
		width: 100%;
	}

	.formulario__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.25;
	}

	.formulario__instrucciones {
		padding: 0.75rem 0.875rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--text-secondary, #4a4a4a);
		background: #fffbeb;
		border-left: 3px solid #f59e0b;
		border-radius: 8px;
		white-space: pre-wrap;
	}

	.formulario__vacio {
		padding: 2rem 1rem;
		text-align: center;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.resumen {
		padding: 0.875rem 1rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 12px;
	}

	.resumen:focus-visible {
		outline: 2px solid #dc2626;
		outline-offset: 2px;
	}

	.resumen__titulo {
		font-size: 0.9375rem;
		font-weight: 700;
		color: #991b1b;
	}

	.resumen__lista {
		margin: 0.5rem 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		font-size: 0.8125rem;
		color: #b91c1c;
		line-height: 1.4;
	}

	.resumen__mas {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: #b91c1c;
		font-style: italic;
	}

	.resumen__ir {
		margin-top: 0.625rem;
		min-height: 44px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: #fff;
		background: #dc2626;
		border: none;
		border-radius: 10px;
		cursor: pointer;
	}

	.seccion {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.seccion__cabecera {
		padding-bottom: 0.375rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.seccion__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.seccion__desc {
		margin-top: 0.1875rem;
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.45;
	}

	.seccion__campos {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
