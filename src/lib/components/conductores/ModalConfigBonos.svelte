<script lang="ts">
	import { browser } from '$app/environment';
	import { bonoConfigVisualAPI, type BonoConfigVisualItem } from '$lib/api/apiClient';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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
	let error = $state('');
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

	let totalSeleccionados = $derived(visiblesSet.size);
	let totalItems = $derived(items.length);
	let todasFiltradasVisibles = $derived.by(() => {
		const f = itemsFiltrados();
		return f.length > 0 && f.every((i) => visiblesSet.has(i.id));
	});
</script>

<ModalBase
	{open}
	title="Configurar bonos visibles"
	eyebrow="Recorridos · {anio}"
	subtitle="Selecciona qué items de configuración de liquidación se exponen como columna en Recorridos para el año {anio}."
	tamano="md"
	bloqueado={guardando}
	oncerrar={cerrar}
>
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
			<span class="counter-num">{totalSeleccionados}/{totalItems}</span>
			<span class="counter-lbl">visibles</span>
		</div>
		{#if canManageBonos && itemsFiltrados().length > 0}
			<button class="btn-link" onclick={toggleTodas} type="button">
				{todasFiltradasVisibles ? 'Ninguna' : 'Todas'}
			</button>
		{/if}
	</div>

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

	{#snippet pie()}
		<p class="footer-hint">
			{#if !canManageBonos}
				🔒 Modo solo lectura — necesitas el permiso <strong>bonos-planilla</strong>
			{:else}
				Los cambios aplican para todos los usuarios que abran Recorridos.
			{/if}
		</p>
		<button class="btn-secondary" onclick={cerrar} type="button" disabled={guardando}>
			Cancelar
		</button>
		<button
			class="btn-primary"
			onclick={guardar}
			type="button"
			disabled={!canManageBonos || guardando || loading || items.length === 0}
		>
			{#if guardando}
				<svg class="animate-spin" fill="none" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
					<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
				</svg>
				Guardando…
			{:else}
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
				Guardar configuración
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		width: 15px;
		height: 15px;
		color: var(--text-muted);
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px 9px 34px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		font-size: 14px;
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.search-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.counter-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 6px 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 999px;
		white-space: nowrap;
	}
	.counter-num {
		font-size: 12px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.counter-lbl {
		font-size: 11px;
		color: var(--text-muted);
	}
	.btn-link {
		background: none;
		border: none;
		font-size: 12px;
		font-weight: 700;
		color: var(--accion);
		cursor: pointer;
		padding: 6px 8px;
		border-radius: 8px;
	}
	.btn-link:hover {
		background: color-mix(in srgb, var(--accion) 8%, transparent);
	}
	.footer-hint {
		margin: 0 auto 0 0;
		flex: 1 1 200px;
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}
	.items-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.item-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		background: var(--bg-surface);
		border: 1.5px solid transparent;
		border-radius: 16px;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			opacity 0.15s ease;
		text-align: left;
		width: 100%;
		font: inherit;
	}
	.item-card:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--accion) 45%, transparent);
	}
	.item-card.item-on {
		border-color: color-mix(in srgb, var(--accion) 55%, transparent);
	}
	.item-card.item-off {
		opacity: 0.65;
	}
	.item-card.item-disabled {
		cursor: not-allowed;
	}
	.item-checkbox {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		border: 2px solid var(--border-default);
		background: var(--bg-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.item-checkbox.checked {
		background: var(--accion);
		border-color: var(--accion);
	}
	.item-body {
		flex: 1;
		min-width: 0;
	}
	.item-name {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item-value {
		font-size: 13px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
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
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg-base);
		color: var(--text-secondary);
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
		border: 3px solid color-mix(in srgb, var(--accion) 20%, transparent);
		border-top-color: var(--accion);
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
		color: #b42318;
		padding: 10px 14px;
		border-radius: 12px;
		font-size: 13px;
		margin-bottom: 12px;
		border: 1px solid #fecaca;
	}
	.code-badge {
		font-family: var(--font-sans);
		font-size: 10px;
		background: var(--bg-base);
		color: var(--text-secondary);
		padding: 1px 5px;
		border-radius: 4px;
	}
</style>
