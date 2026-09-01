<script lang="ts">
	/**
	 * Buscador de hoja del canvas de cierres finales.
	 *
	 * La sheet bar de Univer sigue activa, pero deja de ser usable a partir
	 * de ~20 pestañas: los nombres van truncados a 31 caracteres —"ABC-123 ·
	 * JUAN P. GOM"— y hay que desplazarla horizontalmente para llegar al
	 * final del abecedario. Con 80 placas es inservible.
	 *
	 * Este combo busca por placa Y por propietario, muestra el nombre
	 * completo del tercero (que en la pestaña no cabe) y el estado de cada
	 * hoja, que es lo que decide si se puede editar.
	 */

	import { claseBadgeEstado } from '$lib/editor/builders/cierres-finales-estado';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';

	interface Props {
		cierres: CierreHoja[];
		/** Id del cierre cuya hoja está activa. */
		activo: string | null;
		onSeleccionar: (cierreId: string) => void;
	}

	let { cierres, activo, onSeleccionar }: Props = $props();

	let abierto = $state(false);
	let busqueda = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	/** Índice resaltado para navegar con el teclado. */
	let cursor = $state(0);

	const activoObj = $derived(cierres.find((c) => c.id === activo) ?? null);

	function normalizar(s: string): string {
		// Sin acentos y sin separadores: "ABC-123" encuentra "abc123", y
		// "MUNOZ" encuentra "MUÑOZ".
		return (s || '')
			.toUpperCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Z0-9]/g, '');
	}

	const filtrados = $derived.by(() => {
		const q = normalizar(busqueda);
		if (!q) return cierres;
		return cierres.filter(
			(c) =>
				normalizar(c.placa).includes(q) ||
				normalizar(c.tercero_nombre).includes(q) ||
				normalizar(c.consecutivo).includes(q)
		);
	});

	function abrir() {
		abierto = true;
		busqueda = '';
		cursor = Math.max(
			0,
			cierres.findIndex((c) => c.id === activo)
		);
		queueMicrotask(() => inputEl?.focus());
	}

	function elegir(cierreId: string) {
		abierto = false;
		busqueda = '';
		onSeleccionar(cierreId);
	}

	function teclas(e: KeyboardEvent) {
		if (!abierto) return;
		if (e.key === 'Escape') {
			abierto = false;
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			cursor = Math.min(cursor + 1, filtrados.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			cursor = Math.max(cursor - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const c = filtrados[cursor];
			if (c) elegir(c.id);
		}
	}

	// Al filtrar, el cursor puede quedar fuera de rango.
	$effect(() => {
		if (cursor >= filtrados.length) cursor = 0;
	});
</script>

<svelte:window onkeydown={teclas} />

<div class="shc">
	<button
		class="univer-btn univer-btn-dark shc-trigger"
		onclick={() => (abierto ? (abierto = false) : abrir())}
		title="Buscar una placa o un propietario"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
		</svg>
		<span class="shc-actual">
			{activoObj ? activoObj.placa : 'Buscar hoja'}
		</span>
		<span class="shc-cuenta">{cierres.length}</span>
	</button>

	{#if abierto}
		<!-- Capa de cierre: un clic fuera cierra el combo. `presentation`
		     porque no aporta semántica; la tecla Escape ya está en window. -->
		<div class="shc-fuera" role="presentation" onclick={() => (abierto = false)}></div>

		<div class="shc-panel">
			<input
				bind:this={inputEl}
				bind:value={busqueda}
				class="shc-input"
				type="text"
				placeholder="Placa, propietario o consecutivo…"
				autocomplete="off"
			/>

			{#if filtrados.length === 0}
				<div class="shc-vacio">Ninguna hoja coincide con «{busqueda}».</div>
			{:else}
				<ul class="shc-lista">
					{#each filtrados as c, i (c.id)}
						<li>
							<button
								class="shc-item"
								class:shc-item-cursor={i === cursor}
								class:shc-item-activo={c.id === activo}
								onclick={() => elegir(c.id)}
								onmouseenter={() => (cursor = i)}
							>
								<span class="shc-placa">{c.placa}</span>
								<span class="shc-tercero">{c.tercero_nombre || 'sin propietario'}</span>
								{#if c.es_multi_propietario}
									<span class="shc-multi" title="{c.copropietarios} copropietarios">
										{c.copropietarios}p
									</span>
								{/if}
								<span class="shc-estado {claseBadgeEstado(c.estado)}">{c.estado}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.shc {
		position: relative;
	}

	.shc-trigger {
		max-width: 260px;
	}
	.shc-actual {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shc-cuenta {
		background: rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		padding: 1px 7px;
		font-size: 10px;
		font-weight: 700;
	}

	.shc-fuera {
		position: fixed;
		inset: 0;
		z-index: 55;
	}

	.shc-panel {
		position: absolute;
		top: calc(100% + 6px);
		/* Anclado por la DERECHA. El disparador vive en la mitad derecha del
		   toolbar, así que un panel de 380px colgando de `left: 0` se salía de
		   la ventana y sus últimas columnas —el estado de cada hoja— quedaban
		   debajo del carril de acciones. Creciendo hacia la izquierda el ancho
		   útil es el que hay, no el que sobra. */
		right: 0;
		left: auto;
		z-index: 60;
		width: 380px;
		/* Suelo para pantallas estrechas: con el ancla a la derecha, lo que se
		   sale es el borde izquierdo. */
		max-width: calc(100vw - 24px);
		background: #fff;
		color: #0f172a;
		border-radius: 8px;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
		padding: 6px;
	}

	.shc-input {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 7px 10px;
		font-size: 12.5px;
		font-family: inherit;
		margin-bottom: 5px;
	}
	.shc-input:focus {
		outline: 2px solid #059669;
		outline-offset: -1px;
	}

	.shc-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 320px;
		overflow-y: auto;
	}

	.shc-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		border-radius: 6px;
		padding: 7px 9px;
		font-size: 12px;
		cursor: pointer;
	}
	.shc-item-cursor {
		background: #f1f5f9;
	}
	.shc-item-activo {
		box-shadow: inset 2px 0 0 #059669;
	}

	.shc-placa {
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		min-width: 74px;
	}
	.shc-tercero {
		flex: 1;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shc-multi {
		background: #e2e8f0;
		color: #334155;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 10px;
		font-weight: 700;
	}
	.shc-estado {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 9.5px;
		font-weight: 700;
		white-space: nowrap;
	}

	.shc-vacio {
		padding: 14px 10px;
		font-size: 12.5px;
		color: #64748b;
		text-align: center;
	}
</style>
