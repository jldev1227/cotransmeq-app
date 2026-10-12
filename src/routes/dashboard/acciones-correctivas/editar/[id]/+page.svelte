<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { page } from '$app/stores';
	import { sidebarStore } from '$lib/stores/sidebar';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { listadoAcciones } from '$lib/stores/volverListado';
	import { mascota } from '$lib/mascot';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import FormularioAccion from '$lib/components/acciones-correctivas/FormularioAccion.svelte';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva
	} from '$lib/api/acciones-correctivas';

	let accion = $state<AccionCorrectivaPreventiva | null>(null);
	let isLoading = $state(true);
	let errorCarga = $state<string | null>(null);
	let id = $state('');

	let formularioAccion: any = $state(null);
	let isSubmitting = $state(false);

	/// Destino del «Volver» y de «Cancelar»: el listado con sus filtros. Se lee
	/// al montar porque vive en sessionStorage, que el render del servidor no tiene.
	let urlListado = $state('/dashboard/acciones-correctivas');
	onMount(() => {
		urlListado = listadoAcciones.url();
	});

	async function handleGuardado() {
		toast.success('Acción actualizada exitosamente');
		goto(listadoAcciones.url());
	}

	/// Antes, si la carga fallaba, la página saltaba sola al listado a los 2 s:
	/// el aviso apenas se leía y no había forma de reintentar. Ahora el error
	/// se queda en pantalla con «Reintentar» y «Volver».
	async function cargar(idAccion: string) {
		isLoading = true;
		errorCarga = null;
		try {
			accion = await accionesCorrectivasAPI.obtener(idAccion);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al cargar la acción';
			errorCarga = message;
			toast.error(message);
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		const newId = $page.params.id ?? '';
		id = newId;
		void cargar(newId);
	});
</script>

<div class="page" in:fade={{ duration: 300 }}>
	<!-- Sticky header -->
	<header
		class="page-header"
		class:sidebar-collapsed={$sidebarStore}
		class:sidebar-expanded={!$sidebarStore}
	>
		<div class="page-header-inner">
			<div class="page-header-left">
				<button class="back-btn" onclick={() => goto(urlListado)} aria-label="Volver al listado">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
					<span class="back-text">Volver</span>
				</button>
				<div class="page-titles">
					<span class="eyebrow">Editando · HSEQ</span>
					<h1 class="page-title">
						{accion ? `Acción ${accion.accion_numero}` : 'Cargando…'}
					</h1>
					<p class="page-sub">Modifica las secciones y guarda los cambios.</p>
				</div>
			</div>

			<div class="page-header-actions">
				<button
					class="btn-primary"
					onclick={() => formularioAccion?.handleSubmit()}
					disabled={isSubmitting || isLoading || !accion}
				>
					{#if isSubmitting}
						<span class="spinner"></span>
						Actualizando…
					{:else}
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						Actualizar cambios
					{/if}
				</button>
			</div>
		</div>
	</header>

	<main class="page-main" in:fly={{ y: 20, duration: 400, easing: quintOut, delay: 100 }}>
		{#if isLoading}
			<CargaMascota texto="Cargando acción…" />
		{:else if accion}
			<FormularioAccion
				bind:this={formularioAccion}
				bind:isSubmitting
				{accion}
				modoEdicion={true}
				onGuardado={handleGuardado}
			/>
		{:else}
			{@const img = mascota('advertencia')}
			<div class="page-card dir-vacio" role="alert" in:fade={{ duration: 200 }}>
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<h3>No pudimos abrir la acción</h3>
				<p>{errorCarga ?? 'La acción no existe o ya no está disponible.'}</p>
				<div class="flex flex-wrap justify-center gap-2">
					<button type="button" class="btn-secondary" onclick={() => goto(urlListado)}>
						Volver al listado
					</button>
					<button type="button" class="btn-primary" onclick={() => cargar(id)}>Reintentar</button>
				</div>
			</div>
		{/if}
	</main>
</div>

<style>
	.page {
		--bg: #fcfcfb;
		--surface: #ffffff;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--text-primary: #0f172a;
		--text-secondary: #334155;
		--text-muted: #64748b;
		--accent: #ea580c;
		--accent-hover: #c2410c;
		--accent-bg: rgba(234, 88, 12, 0.08);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

		min-height: 100vh;
		background: var(--bg);
		font-family: var(--font-sans);
		color: var(--text-primary);
		-webkit-font-smoothing: antialiased;
	}

	.page-header {
		position: sticky;
		top: 0;
		z-index: 30;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-bottom: 1px solid var(--border);
		transition: left 0.2s var(--ease);
	}
	.page-header.sidebar-expanded {
		left: 16rem;
	}
	.page-header.sidebar-collapsed {
		left: 5rem;
	}
	@media (max-width: 1023.98px) {
		.page-header.sidebar-expanded,
		.page-header.sidebar-collapsed {
			left: 0;
		}
	}
	.page-header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		flex-wrap: wrap;
	}
	.page-header-left {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-width: 0;
		flex: 1;
	}
	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.4rem 0.4rem 0.5rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		flex-shrink: 0;
	}
	.back-btn:hover {
		background: var(--surface);
		color: var(--accent-hover);
		border-color: rgba(234, 88, 12, 0.3);
	}
	.back-btn svg {
		width: 14px;
		height: 14px;
	}
	.back-text {
		display: none;
	}
	@media (min-width: 480px) {
		.back-text {
			display: inline;
		}
	}

	.page-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.eyebrow {
		display: inline-block;
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent-hover);
		background: var(--accent-bg);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		margin-bottom: 0.35rem;
	}
	.page-title {
		font-family: var(--font-sans);
		font-size: 1.3rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.015em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.page-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0.2rem 0 0;
		line-height: 1.45;
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		display: inline-block;
	}

	.page-main {
		padding: 1.5rem 1.5rem 3rem;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 640px) {
		.page-header-inner {
			padding: 0.85rem 1rem;
		}
		.page-main {
			padding: 1rem 1rem 2rem;
		}
		.page-title {
			font-size: 1.1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.back-btn {
			transition: none !important;
		}
	}
</style>
