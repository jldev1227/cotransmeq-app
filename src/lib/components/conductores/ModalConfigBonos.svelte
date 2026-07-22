<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { bonoConfigVisualAPI, type BonoConfigVisualItem } from '$lib/api/apiClient';
	import { toast } from 'svelte-sonner';

	type Props = {
		open: boolean;
		anio: number;
		/** Cuando el usuario NO tiene permiso para guardar, se renderiza read-only */
		canManageBonos?: boolean;
		/** Callback al cerrar (Esc, X, Cancelar, click fuera) */
		onclose?: () => void;
		/** Callback cuando se persiste la selección de visibilidad */
		onsaved?: (visibles: BonoConfigVisualItem[]) => void;
	};

	let { open, anio, canManageBonos = false, onclose, onsaved }: Props = $props();

	// Estado local
	let items = $state<BonoConfigVisualItem[]>([]);
	let loading = $state(false);
	let guardando = $state(false);
	let error = '';
	let searchTerm = $state('');

	// Set reactivo de IDs seleccionados (visibles)
	let visiblesSet = $state<Set<string>>(new Set());

	// Carga inicial al abrir
	$effect(() => {
		if (!open || !browser) return;
		void anio;
		cargar();
	});

	async function cargar() {
		loading = true;
		error = '';
		try {
			const res = await bonoConfigVisualAPI.listar(anio);
			items = res.data?.data ?? [];
			visiblesSet = new Set(items.filter((i) => i.visible).map((i) => i.id));
		} catch (err: any) {
			error = err?.response?.data?.message || err?.message || 'Error al cargar configuraciones';
		} finally {
			loading = false;
		}
	}

	function toggleItem(id: string) {
		if (!canManageBonos) return;
		const newSet = new Set(visiblesSet);
		if (newSet.has(id)) newSet.delete(id);
		else newSet.add(id);
		visiblesSet = newSet;
	}

	function toggleTodas() {
		if (!canManageBonos) return;
		const filtrados = itemsFiltrados();
		const allSelected = filtrados.every((i) => visiblesSet.has(i.id));
		const newSet = new Set(visiblesSet);
		for (const i of filtrados) {
			if (allSelected) newSet.delete(i.id);
			else newSet.add(i.id);
		}
		visiblesSet = newSet;
	}

	function itemsFiltrados(): BonoConfigVisualItem[] {
		const term = searchTerm.trim().toLowerCase();
		if (!term) return items;
		return items.filter(
			(i) =>
				i.nombre.toLowerCase().includes(term) ||
				String(i.valor).includes(term)
		);
	}

	function formatCOP(value: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value || 0);
	}

	async function guardar() {
		if (!canManageBonos) {
			toast.warning('No tienes el permiso "bonos-planilla" para modificar la configuración');
			return;
		}
		guardando = true;
		try {
			const visibles = Array.from(visiblesSet);
			const res = await bonoConfigVisualAPI.guardar(anio, visibles);
			items = res.data?.data ?? items;
			visiblesSet = new Set(items.filter((i) => i.visible).map((i) => i.id));
			toast.success(`Configuración de bonos guardada (${visibles.length} visibles)`);
			onsaved?.(items);
			cerrar();
		} catch (err: any) {
			const msg = err?.response?.data?.message || err?.message || 'Error al guardar';
			toast.error(msg);
		} finally {
			guardando = false;
		}
	}

	function cerrar() {
		onclose?.();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) cerrar();
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			document.addEventListener('keydown', onKeydown);
			return () => document.removeEventListener('keydown', onKeydown);
		}
	});

	let totalSeleccionados = $derived(visiblesSet.size);
	let totalItems = $derived(items.length);
	let todasFiltradasVisibles = $derived.by(() => {
		const f = itemsFiltrados();
		return f.length > 0 && f.every((i) => visiblesSet.has(i.id));
	});
</script>

{#if open}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="modal-overlay"
		onclick={cerrar}
		role="presentation"
		transition:fade={{ duration: 150 }}
	>
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div
			class="modal-box"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-config-bonos-title"
			in:scale={{ duration: 200, start: 0.96 }}
			out:scale={{ duration: 120, start: 0.98 }}
		>
			<!-- Header -->
			<div class="modal-header">
				<div class="flex items-center gap-3">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-xl"
						style="background: linear-gradient(135deg, #f97316, #ea580c); box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
							/>
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
					</div>
					<div>
						<h2 id="modal-config-bonos-title" class="modal-title">Configurar bonos visibles</h2>
						<p class="modal-subtitle">
							Selecciona qué items de configuración de liquidación se exponen como columna en
							Recorridos para el año <strong class="text-orange-700">{anio}</strong>.
						</p>
					</div>
				</div>
				<button class="close-btn" onclick={cerrar} aria-label="Cerrar">✕</button>
			</div>

			<!-- Toolbar -->
			<div class="toolbar">
				<div class="search-wrap">
					<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						bind:value={searchTerm}
						placeholder="Buscar por nombre o valor…"
						class="search-input"
					/>
				</div>
				<div class="counter-pill">
					<span class="font-mono-meta text-[10px] font-bold text-orange-700">
						{totalSeleccionados}/{totalItems}
					</span>
					<span class="text-[10px]" style="color: var(--text-muted);">visibles</span>
				</div>
				{#if canManageBonos && itemsFiltrados().length > 0}
					<button class="btn-link" onclick={toggleTodas} type="button">
						{todasFiltradasVisibles ? 'Ninguna' : 'Todas'}
					</button>
				{/if}
			</div>

			<!-- Body -->
			<div class="modal-body">
				{#if error}
					<div class="error-msg">⚠️ {error}</div>
				{/if}

				{#if loading}
					<div class="empty-state">
						<div class="spinner"></div>
						<p class="text-sm" style="color: var(--text-muted);">Cargando configuraciones…</p>
					</div>
				{:else if items.length === 0}
					<div class="empty-state">
						<div class="empty-icon">📋</div>
						<p class="text-sm font-semibold" style="color: var(--text-primary);">
							No hay configuraciones activas para {anio}
						</p>
						<p class="text-xs" style="color: var(--text-muted);">
							Crea primero las configuraciones de liquidación en
							<code class="code-badge">/dashboard/liquidaciones</code>.
						</p>
					</div>
				{:else}
					<div class="items-list">
						{#each itemsFiltrados() as item (item.id)}
							{@const isOn = visiblesSet.has(item.id)}
							<button
								type="button"
								class="item-card"
								class:item-on={isOn}
								class:item-off={!isOn}
								class:item-disabled={!canManageBonos}
								onclick={() => toggleItem(item.id)}
								disabled={!canManageBonos}
							>
								<div class="item-checkbox" class:checked={isOn}>
									{#if isOn}
										<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</div>
								<div class="item-body">
									<div class="flex items-center justify-between gap-2">
										<p class="item-name">{item.nombre}</p>
										<p class="item-value">${formatCOP(item.valor)}</p>
									</div>
									<div class="item-meta">
										<span class="item-tag">{item.tipo}</span>
										{#if !isOn}
											<span class="item-tag-off">OCULTO</span>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="modal-footer">
				<p class="footer-hint">
					{#if !canManageBonos}
						🔒 Modo solo lectura — necesitas el permiso <strong>bonos-planilla</strong>
					{:else}
						Los cambios aplican para todos los usuarios que abran Recorridos.
					{/if}
				</p>
				<div class="flex gap-2">
					<button class="btn-secondary-sm" onclick={cerrar} type="button" disabled={guardando}>
						Cancelar
					</button>
					<button
						class="btn-primary-sm"
						onclick={guardar}
						type="button"
						disabled={!canManageBonos || guardando || loading || items.length === 0}
					>
						{#if guardando}
							<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
								<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							Guardando…
						{:else}
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							Guardar configuración
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(3px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}
	.modal-box {
		background: white;
		border-radius: 16px;
		width: 100%;
		max-width: 640px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 24px 16px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.modal-title {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		color: #1a1a1a;
		letter-spacing: -0.01em;
	}
	.modal-subtitle {
		margin: 4px 0 0;
		font-size: 12px;
		color: #6b6b6b;
		max-width: 440px;
		line-height: 1.45;
	}
	.close-btn {
		background: none;
		border: none;
		font-size: 18px;
		color: #94a3b8;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 6px;
		transition: all 0.15s ease;
	}
	.close-btn:hover {
		background: #f1f5f9;
		color: #475569;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
		background: #faf7f2;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		width: 14px;
		height: 14px;
		color: #9ca3af;
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		padding: 7px 10px 7px 30px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 12px;
		background: white;
		transition: all 0.15s ease;
	}
	.search-input:focus {
		outline: none;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}
	.counter-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: rgba(249, 115, 22, 0.08);
		border: 1px solid rgba(249, 115, 22, 0.25);
		border-radius: 999px;
		white-space: nowrap;
	}
	.btn-link {
		background: none;
		border: none;
		font-size: 11px;
		font-weight: 600;
		color: #047857;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 6px;
		transition: all 0.15s ease;
	}
	.btn-link:hover {
		background: rgba(249, 115, 22, 0.06);
	}
	.modal-body {
		padding: 16px 24px;
		overflow-y: auto;
		flex: 1;
		min-height: 200px;
		max-height: 55vh;
	}
	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 24px;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		background: #faf7f2;
	}
	.footer-hint {
		margin: 0;
		font-size: 11px;
		color: #6b6b6b;
		line-height: 1.4;
	}
	.items-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.item-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: white;
		border: 1.5px solid #e5e7eb;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
		text-align: left;
		width: 100%;
		font: inherit;
	}
	.item-card:hover:not(:disabled) {
		border-color: rgba(249, 115, 22, 0.45);
		background: rgba(249, 115, 22, 0.02);
		transform: translateX(2px);
	}
	.item-card.item-on {
		border-color: rgba(249, 115, 22, 0.5);
		background: rgba(249, 115, 22, 0.04);
	}
	.item-card.item-off {
		opacity: 0.6;
	}
	.item-card.item-disabled {
		cursor: not-allowed;
	}
	.item-checkbox {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		border: 2px solid #d1d5db;
		background: white;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 0.15s ease;
	}
	.item-checkbox.checked {
		background: #f97316;
		border-color: #f97316;
	}
	.item-body {
		flex: 1;
		min-width: 0;
	}
	.item-name {
		font-size: 13px;
		font-weight: 600;
		color: #1a1a1a;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item-value {
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: #047857;
		margin: 0;
		flex-shrink: 0;
	}
	.item-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 3px;
	}
	.item-tag {
		display: inline-block;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 4px;
		background: #f1f5f9;
		color: #64748b;
		text-transform: uppercase;
	}
	.item-tag-off {
		display: inline-block;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 4px;
		background: #fef2f2;
		color: #b91c1c;
		text-transform: uppercase;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 40px 20px;
		text-align: center;
	}
	.empty-icon {
		font-size: 36px;
		opacity: 0.5;
	}
	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid rgba(249, 115, 22, 0.2);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.error-msg {
		background: #fef2f2;
		color: #dc2626;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		margin-bottom: 12px;
		border: 1px solid #fecaca;
	}
	.btn-secondary-sm {
		padding: 7px 14px;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		background: white;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.btn-secondary-sm:hover:not(:disabled) {
		background: #f8fafc;
	}
	.btn-secondary-sm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary-sm {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		font-size: 12px;
		font-weight: 600;
		color: white;
		background: linear-gradient(135deg, #f97316, #ea580c);
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 2px 6px rgba(249, 115, 22, 0.25);
	}
	.btn-primary-sm:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 10px rgba(249, 115, 22, 0.35);
	}
	.btn-primary-sm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}
	.code-badge {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		background: #f1f5f9;
		color: #475569;
		padding: 1px 5px;
		border-radius: 4px;
	}
</style>
