<script lang="ts">
	import { tick } from 'svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import { liquidacionesTercerosOcasionalAPI, type TerceroCandidato } from '$lib/api/liquidaciones-terceros-ocasional';

	export let isOpen = false;
	export let mes: number;
	export let anio: number;
	export let onClose: () => void = () => { isOpen = false; };
	export let onConfirm: (tercerosSeleccionados: TerceroCandidato[]) => void = () => {};

	type FiltroTipo = 'documento' | 'placa' | 'nombre';
	let filtroTipo: FiltroTipo = 'nombre';
	const TABS_FILTRO: { id: FiltroTipo; label: string }[] = [
		{ id: 'nombre', label: 'Nombre' },
		{ id: 'documento', label: 'NIT / Documento' },
		{ id: 'placa', label: 'Placa' }
	];
	let busqueda = '';
	let loading = false;
	let terceros: TerceroCandidato[] = [];
	let selected = new Set<string>();
	let searchInput: HTMLInputElement;

	$: if (isOpen && searchInput) {
		tick().then(() => searchInput?.focus());
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	$: if (isOpen && mes && anio) {
		loadTerceros();
	}
	$: busqueda, scheduleSearch();

	function scheduleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(loadTerceros, 250);
	}

	async function loadTerceros() {
		loading = true;
		try {
			const r = await liquidacionesTercerosOcasionalAPI.buscarTercerosCandidatos({
				mes,
				anio,
				busqueda,
				filtro_tipo: filtroTipo
			});
			terceros = r.items;
		} catch (e) {
			console.error('[modal-terceros-ocasionales] loadTerceros error', e);
			terceros = [];
		} finally {
			loading = false;
		}
	}

	/// La selección va por `candidato_id`, NO por `tercero_id`.
	///
	/// Los items sin tercero asignado llegan con `tercero_id: ''` agrupados por
	/// placa: son candidatos distintos que comparten ese valor. Con el id del
	/// tercero como clave, marcar uno marcaba todos los «(sin tercero)» a la vez
	/// —y la lista ni siquiera llegaba a pintarse, porque `{#each}` la lleva
	/// como clave y Svelte aborta el bloque entero al ver claves repetidas—.
	function toggle(t: TerceroCandidato) {
		if (selected.has(t.candidato_id)) {
			selected.delete(t.candidato_id);
		} else {
			selected.add(t.candidato_id);
		}
		selected = new Set(selected);
	}

	function toggleAll() {
		if (terceros.every((t) => selected.has(t.candidato_id))) {
			selected = new Set();
		} else {
			selected = new Set(terceros.map((t) => t.candidato_id));
		}
	}

	function handleConfirm() {
		const picked = terceros.filter((t) => selected.has(t.candidato_id));
		onConfirm(picked);
		onClose();
	}

	/// Escape lo atiende ModalBase; aquí queda el atajo de Enter para confirmar.
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && selected.size > 0) {
			e.preventDefault();
			handleConfirm();
		}
	}
</script>

<ModalBase
	open={isOpen}
	eyebrow="Liquidación ocasional"
	title="Seleccionar terceros ocasionales"
	subtitle={`Mes ${mes}/${anio} — elige los terceros que deseas incluir en la liquidación mensual`}
	tamano="lg"
	oncerrar={onClose}
>
	{#snippet cabecera()}
		<TabsVista
			tabs={TABS_FILTRO}
			activa={filtroTipo}
			variante="oscuro"
			etiqueta="Buscar por"
			onCambiar={(id) => (filtroTipo = id as FiltroTipo)}
		/>
	{/snippet}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="mst" on:keydown={handleKeydown}>
		<!-- Búsqueda -->
		<div class="mst-buscar">
			<svg
				class="mst-buscar-icono"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="2"
				aria-hidden="true"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				bind:this={searchInput}
				bind:value={busqueda}
				type="text"
				aria-label="Buscar terceros"
				placeholder={filtroTipo === 'documento'
					? 'Buscar por NIT o número de documento...'
					: filtroTipo === 'placa'
						? 'Buscar por placa...'
						: 'Buscar por nombre del tercero...'}
				class="mst-input"
			/>
		</div>

		<!-- Hint -->
		<p class="mst-hint">
			Búsqueda insensible a mayúsculas. Aparecen terceros con items pendientes de cierre en este mes.
		</p>

		<!-- Lista -->
		{#if loading}
			<div class="mst-cargando">
				<div class="mst-spinner" aria-hidden="true"></div>
			</div>
		{:else if terceros.length === 0}
			<div class="mst-vacio">
				<div class="mst-vacio-icono">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
				<p class="mst-vacio-titulo">Sin terceros</p>
				<p class="mst-vacio-texto">No hay items pendientes de cierre para este filtro en {mes}/{anio}.</p>
			</div>
		{:else}
			<div class="mst-lista">
				{#if terceros.length > 1}
					<button class="mst-todos" on:click={toggleAll} type="button">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
						</svg>
						{terceros.every((t) => selected.has(t.candidato_id))
							? 'Deseleccionar todos'
							: 'Seleccionar todos'}
					</button>
				{/if}
				{#each terceros as t (t.candidato_id)}
					{@const isSelected = selected.has(t.candidato_id)}
					{@const hasBlocked = t.cierres_bloqueados > 0}
					<button
						class="mst-fila"
						class:mst-fila--on={isSelected}
						aria-pressed={isSelected}
						on:click={() => toggle(t)}
						type="button"
					>
						<div class="mst-check" class:mst-check--on={isSelected}>
							{#if isSelected}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							{/if}
						</div>
						<div class="mst-fila-texto">
							<div class="mst-fila-cabeza">
								<p class="mst-nombre">{t.tercero_nombre}</p>
								{#if hasBlocked}
									<span class="mst-bloqueado">
										{t.cierres_bloqueados} bloqueado{t.cierres_bloqueados > 1 ? 's' : ''}
									</span>
								{/if}
							</div>
							<div class="mst-meta">
								{#if t.tercero_documento}
									<span>
										<span class="mst-meta-label">Doc:</span>
										{t.tercero_documento}
									</span>
								{/if}
								<span>
									<span class="mst-meta-label">Placas:</span>
									<!-- Un item puede no tener placa registrada; sin este
									     texto la etiqueta quedaba colgando vacía. -->
									{t.placas.filter(Boolean).join(', ') || '(sin placa)'}
								</span>
								<span>
									<span class="mst-meta-label">Cierres:</span>
									{t.cierres_count}
								</span>
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#snippet pie()}
		<p class="mst-resumen">
			<strong>{selected.size}</strong>
			{selected.size === 1 ? 'tercero seleccionado' : 'terceros seleccionados'}
		</p>
		<button class="btn-secondary" on:click={onClose} type="button">Cancelar</button>
		<button
			class="btn-primary"
			on:click={handleConfirm}
			disabled={selected.size === 0}
			type="button"
		>
			Generar borrador ({selected.size})
		</button>
	{/snippet}
</ModalBase>

<style>
	.mst {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mst-buscar {
		position: relative;
	}
	.mst-buscar-icono {
		position: absolute;
		left: 12px;
		top: 50%;
		width: 16px;
		height: 16px;
		transform: translateY(-50%);
		color: var(--text-very-muted);
		pointer-events: none;
	}
	.mst-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px 9px 36px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.mst-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.mst-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mst-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	.mst-hint {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.mst-cargando {
		display: flex;
		justify-content: center;
		padding: 48px 0;
	}
	.mst-spinner {
		width: 32px;
		height: 32px;
		border: 4px solid var(--accion);
		border-top-color: transparent;
		border-radius: 50%;
		animation: mst-gira 0.8s linear infinite;
	}
	@keyframes mst-gira {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mst-spinner {
			animation: none;
		}
	}

	.mst-vacio {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 40px 16px;
		text-align: center;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.mst-vacio-icono {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		margin-bottom: 12px;
		border-radius: 16px;
		background: var(--bg-base);
		color: var(--text-very-muted);
	}
	.mst-vacio-icono svg {
		width: 24px;
		height: 24px;
	}
	.mst-vacio-titulo {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary);
	}
	.mst-vacio-texto {
		margin: 2px 0 0;
		font-size: 12.5px;
		color: var(--text-muted);
	}

	.mst-lista {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mst-todos {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--accion);
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.mst-todos:hover {
		background: color-mix(in srgb, var(--accion) 8%, transparent);
	}
	.mst-todos svg {
		width: 16px;
		height: 16px;
	}

	.mst-fila {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		width: 100%;
		padding: 12px 14px;
		border: 1px solid transparent;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.mst-fila:hover {
		border-color: var(--border-default);
	}
	.mst-fila:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mst-fila--on,
	.mst-fila--on:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}

	.mst-check {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin-top: 1px;
		border: 2px solid var(--border-default);
		border-radius: 6px;
		background: var(--bg-surface);
		color: #fff;
	}
	.mst-check--on {
		border-color: var(--accion);
		background: var(--accion);
	}
	.mst-check svg {
		width: 12px;
		height: 12px;
	}

	.mst-fila-texto {
		flex: 1;
		min-width: 0;
	}
	.mst-fila-cabeza {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mst-nombre {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary);
	}
	.mst-bloqueado {
		flex-shrink: 0;
		padding: 2px 6px;
		border: 1px solid #fed7aa;
		border-radius: 6px;
		background: #fff7ed;
		color: #9a3412;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.mst-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-top: 3px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.mst-meta-label {
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* Resumen a la izquierda del pie de ModalBase. */
	.mst-resumen {
		flex: 1;
		min-width: 160px;
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.mst-resumen strong {
		color: var(--text-primary);
	}
</style>
