<!--
	Preview responsive de una versión.

	Usa el MISMO `FormRenderer` que el portal del conductor, y por eso las reglas
	condicionales funcionan de verdad al probarlas aquí: marcar «No cumple» hace
	aparecer la observación exactamente como le aparecerá al conductor.

	El selector de ancho no es decoración: el documento exige comprobar que a 320 px
	no hay overflow horizontal ni acciones inalcanzables, y hacerlo abriendo las
	herramientas del navegador es algo que HSEQ no va a hacer.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { formulariosAPI } from '$lib/api/formularios';
	import { createRunnerState, type RunnerState } from '$lib/formularios/runner-state.svelte';
	import type { FormVersionDto } from '$lib/formularios/types';
	import FormRenderer from '$lib/components/formularios/FormRenderer.svelte';

	const formId = $derived($page.params.formId!);
	const versionId = $derived($page.params.versionId!);

	let version = $state<FormVersionDto | null>(null);
	let runner = $state<RunnerState | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	/// Anchos de referencia: 320 es el teléfono más pequeño que la flota usa; 768
	/// es donde las matrices pasan a columnas; «libre» ocupa la pantalla.
	const ANCHOS = [
		{ id: 'movil', label: '320 px', px: 320 },
		{ id: 'movil-l', label: '390 px', px: 390 },
		{ id: 'tablet', label: '768 px', px: 768 },
		{ id: 'libre', label: 'Libre', px: 0 }
	] as const;
	let ancho = $state<(typeof ANCHOS)[number]['id']>('movil-l');
	const anchoPx = $derived(ANCHOS.find((a) => a.id === ancho)?.px ?? 0);

	onMount(async () => {
		try {
			const dto = await formulariosAPI.obtenerVersion(formId, versionId);
			version = dto;
			runner = createRunnerState({ sections: dto.sections });
			runner.seedMinRows();
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo cargar la versión.';
			toast.error(error);
		} finally {
			cargando = false;
		}
	});

	function reiniciar() {
		if (!version) return;
		runner = createRunnerState({ sections: version.sections });
		runner.seedMinRows();
	}
</script>

<svelte:head>
	<title>{version ? `Preview v${version.versionNumber}` : 'Preview'} · Formularios</title>
</svelte:head>

<div class="pagina">
	<header class="barra">
		<nav class="migas" aria-label="Ruta">
			<a href="/dashboard/formularios">Formularios</a>
			<span aria-hidden="true">›</span>
			<a href={`/dashboard/formularios/${formId}`}>Resumen</a>
			<span aria-hidden="true">›</span>
			<span>Preview {version ? `v${version.versionNumber}` : ''}</span>
		</nav>

		<div class="barra__controles">
			<div class="anchos" role="group" aria-label="Ancho de la vista previa">
				{#each ANCHOS as opcion (opcion.id)}
					<button
						type="button"
						class="ancho"
						class:ancho--on={ancho === opcion.id}
						aria-pressed={ancho === opcion.id}
						onclick={() => (ancho = opcion.id)}
					>
						{opcion.label}
					</button>
				{/each}
			</div>
			<button type="button" class="btn" onclick={reiniciar}>Limpiar respuestas</button>
			<a class="btn" href={`/dashboard/formularios/${formId}/editar/${versionId}`}>
				{version?.status === 'DRAFT' ? 'Editar' : 'Ver estructura'}
			</a>
		</div>
	</header>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando la definición…</div>
	{:else if error || !runner || !version}
		<div class="estado estado--error">{error ?? 'No se pudo cargar la versión.'}</div>
	{:else}
		<div class="metricas">
			<span class="metrica">
				<strong>{runner.progress}%</strong> de campos obligatorios respondidos
			</span>
			<span class="metrica">
				{runner.validation.errors.length} pendiente{runner.validation.errors.length === 1 ? '' : 's'}
			</span>
			<span class="metrica metrica--nota">
				Estado {version.status} · revisión {version.revision}
			</span>
		</div>

		<div class="lienzo">
			<div
				class="marco"
				class:marco--acotado={anchoPx > 0}
				style={anchoPx > 0 ? `width:${anchoPx}px` : undefined}
			>
				<FormRenderer
					{runner}
					title={version.title}
					instructions={version.instructions}
					showErrorSummary={true}
				/>

				<div class="marco__pie">
					<button
						type="button"
						class="btn btn--primario"
						onclick={() => {
							const ok = runner!.attemptSubmit();
							if (ok) toast.success('El formulario está completo. (Preview: no se envía nada.)');
							else toast.error(`Faltan ${runner!.validation.errors.length} respuestas.`);
						}}
					>
						Probar validación de envío
					</button>
				</div>
			</div>
		</div>

		<p class="nota">
			Esta vista usa el mismo renderer que el portal del conductor. Las reglas condicionales y la
			validación son las reales; los adjuntos no se suben desde aquí.
		</p>
	{/if}
</div>

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1rem 0.875rem 3rem;
	}

	.barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.migas {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.migas a {
		color: var(--emerald-700, #047857);
		text-decoration: none;
	}

	.migas a:hover {
		text-decoration: underline;
	}

	.barra__controles {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.anchos {
		display: flex;
		gap: 0.125rem;
		padding: 0.125rem;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
	}

	.ancho {
		min-height: 34px;
		padding: 0 0.625rem;
		font: inherit;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-radius: 999px;
		cursor: pointer;
	}

	.ancho--on {
		background: #fff;
		color: var(--emerald-700, #047857);
		font-weight: 700;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.metricas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
		font-size: 0.8125rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.metrica--nota {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.lienzo {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}

	.marco {
		width: 100%;
		max-width: 100%;
	}

	/* El marco acotado simula el teléfono: `overflow-x: hidden` NO se usa a
	   propósito — si algo desborda a 320 px hay que verlo, no taparlo. */
	.marco--acotado {
		padding: 0.75rem;
		background: var(--bg-base, #faf7f2);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 20px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	.marco__pie {
		margin-top: 1rem;
		display: flex;
		justify-content: flex-end;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
		font-weight: 600;
	}

	.btn:focus-visible,
	.ancho:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.estado {
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-muted, #6b6b6b);
	}

	.estado--error {
		color: #b91c1c;
	}

	.nota {
		max-width: 44rem;
		margin: 0 auto;
		font-size: 0.75rem;
		line-height: 1.45;
		text-align: center;
		color: var(--text-very-muted, #9a9a9a);
	}
</style>
