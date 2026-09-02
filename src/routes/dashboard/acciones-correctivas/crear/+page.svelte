<script lang="ts">
	import { sidebarStore } from '$lib/stores/sidebar';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import FormularioAccion from '$lib/components/acciones-correctivas/FormularioAccion.svelte';

	let formularioAccion: any;
	let isSubmitting = false;
	let mounted = false;

	async function handleGuardado() {
		toast.success('Acción creada exitosamente');
		goto('/dashboard/acciones-correctivas');
	}
</script>

<svelte:window on:load={() => (mounted = true)} />

{#if mounted || true}
	<div class="page" in:fade={{ duration: 300 }}>
		<!-- Sticky header -->
		<header
			class="page-header"
			class:sidebar-collapsed={$sidebarStore}
			class:sidebar-expanded={!$sidebarStore}
		>
			<div class="page-header-inner">
				<div class="page-header-left">
					<button class="back-btn" onclick={() => goto('/dashboard/acciones-correctivas')} aria-label="Volver al listado">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
						<span class="back-text">Volver</span>
					</button>
					<div class="page-titles">
						<span class="eyebrow">Nueva · HSEQ</span>
						<h1 class="page-title">Registrando Acción</h1>
						<p class="page-sub">Complete las secciones para crear la acción correctiva, preventiva o de mejora.</p>
					</div>
				</div>

				<div class="page-header-actions">
					<button
						class="btn-primary"
						onclick={() => formularioAccion?.handleSubmit()}
						disabled={isSubmitting}
					>
						{#if isSubmitting}
							<span class="spinner"></span>
							Guardando…
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							Guardar acción
						{/if}
					</button>
				</div>
			</div>
		</header>

		<main class="page-main" in:fly={{ y: 20, duration: 400, easing: quintOut, delay: 100 }}>
			<FormularioAccion
				bind:this={formularioAccion}
				bind:isSubmitting
				accion={null}
				modoEdicion={false}
				onGuardado={handleGuardado}
			/>
		</main>
	</div>
{/if}

<style>
	.page {
		--bg: #faf7f2;
		--surface: #ffffff;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--text-primary: #0f1f1a;
		--text-secondary: #4a4a4a;
		--text-muted: #6b6b6b;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: rgba(249, 115, 22, 0.08);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

		min-height: 100vh;
		background: var(--bg);
		font-family: 'Inter', 'Geist', system-ui, sans-serif;
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
		border-color: rgba(249, 115, 22, 0.3);
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
		font-family: 'Geist', monospace;
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
		font-family: 'Geist', Georgia, serif;
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

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 1.1rem;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #ffffff;
		border: none;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		transition: all 0.2s var(--ease);
		white-space: nowrap;
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-primary:active:not(:disabled) {
		transform: translateY(0);
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary svg {
		width: 15px;
		height: 15px;
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
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.page-main {
		padding: 1.5rem 1.5rem 3rem;
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
		.btn-primary,
		.back-btn {
			transition: none !important;
		}
	}
</style>
