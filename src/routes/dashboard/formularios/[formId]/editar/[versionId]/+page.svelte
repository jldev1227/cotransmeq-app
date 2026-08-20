<!--
	Constructor de una versión.

	La página solo carga y monta: toda la lógica vive en `FormBuilderShell` y en el
	store. Se abre también sobre versiones PUBLICADAS, en lectura, porque revisar lo
	que está en la calle es una necesidad real y forzar un clon para mirarlo
	llenaría el catálogo de borradores basura.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { formulariosAPI } from '$lib/api/formularios';
	import { createBuilderStore, type BuilderStore } from '$lib/formularios/builder-store.svelte';
	import type { FormDefinitionDto, FormVersionDto } from '$lib/formularios/types';
	import FormBuilderShell from '$lib/components/formularios/FormBuilderShell.svelte';

	const formId = $derived($page.params.formId!);
	const versionId = $derived($page.params.versionId!);

	let store = $state<BuilderStore | null>(null);
	let definicion = $state<FormDefinitionDto | null>(null);
	let version = $state<FormVersionDto | null>(null);
	let error = $state<string | null>(null);
	let cargando = $state(true);

	onMount(async () => {
		try {
			/// Las dos peticiones en paralelo: la cabecera (código, nombre) y el
			/// árbol. Secuenciarlas duplicaría el tiempo de apertura de un
			/// preoperacional de 200 campos.
			const [form, ver] = await Promise.all([
				formulariosAPI.obtener(formId),
				formulariosAPI.obtenerVersion(formId, versionId)
			]);
			definicion = form;
			version = ver;
			store = createBuilderStore({ formId, version: ver });

			/// Validación inicial para que los issues aparezcan al abrir y no solo
			/// tras el primer guardado.
			formulariosAPI
				.validarVersion(formId, versionId, 'publish')
				.then((v) => {
					if (store) store.issues = [...v.errors, ...v.warnings];
				})
				.catch(() => {
					/// Sin validación inicial el builder sigue funcionando: el siguiente
					/// guardado la trae.
				});
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo abrir la versión.';
			toast.error(error);
		} finally {
			cargando = false;
		}
	});
</script>

<svelte:head>
	<title>
		{definicion ? `${definicion.code} v${version?.versionNumber ?? ''} · Constructor` : 'Constructor'}
	</title>
</svelte:head>

<div class="host">
	{#if cargando}
		<div class="estado" aria-busy="true">Abriendo el constructor…</div>
	{:else if error || !store || !definicion || !version}
		<div class="estado estado--error">
			<p>{error ?? 'No se pudo abrir la versión.'}</p>
			<a class="volver" href="/dashboard/formularios">Volver al catálogo</a>
		</div>
	{:else}
		<FormBuilderShell
			{store}
			code={definicion.code}
			versionNumber={version.versionNumber}
			onpublished={() => {
				window.location.href = `/dashboard/formularios/${formId}`;
			}}
		/>
	{/if}
</div>

<style>
	/* El constructor ocupa el alto disponible del layout del dashboard: las tres
	   columnas necesitan un contenedor de altura definida para que cada una tenga
	   su propio scroll en vez de arrastrar la página entera. */
	.host {
		height: calc(100vh - 4rem);
		min-height: 32rem;
		overflow: hidden;
	}

	.estado {
		display: grid;
		place-items: center;
		gap: 0.75rem;
		height: 100%;
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #6b6b6b);
	}

	.estado--error {
		color: #b91c1c;
	}

	.volver {
		color: var(--emerald-700, #047857);
		font-weight: 600;
		text-decoration: underline;
	}
</style>
