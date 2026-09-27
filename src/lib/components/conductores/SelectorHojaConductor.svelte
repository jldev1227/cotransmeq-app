<script lang="ts">
	/**
	 * Buscador de hoja del canvas de RECORRIDOS.
	 *
	 * Hermano de `SelectorHojaCierre`: el problema es el mismo y la solución
	 * tiene que ser la misma para que se usen igual. La sheet bar de Univer
	 * deja de servir en cuanto el corte pasa de ~20 conductores: los nombres
	 * van truncados a 31 caracteres y hay que arrastrar la barra hasta el final
	 * del abecedario para llegar a los últimos apellidos.
	 *
	 * Busca por NOMBRE, por APELLIDO y por CÉDULA —que en la pestaña no cabe— y
	 * enseña cuántas filas lleva cada hoja, que es lo que distingue una hoja con
	 * recorridos de una recién añadida que sigue vacía.
	 */

	interface HojaItem {
		conductor_id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string | null;
		filas: unknown[];
	}

	interface Props {
		hojas: HojaItem[];
		/** Id del conductor cuya hoja está activa. */
		activo: string | null;
		onSeleccionar: (conductorId: string) => void;
	}

	let { hojas, activo, onSeleccionar }: Props = $props();

	let abierto = $state(false);
	let busqueda = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	/** Índice resaltado para navegar con el teclado. */
	let cursor = $state(0);

	const activoObj = $derived(hojas.find((h) => h.conductor_id === activo) ?? null);

	/** NOMBRE y luego apellido, igual que la pestaña y que el PDF. */
	function nombreCompleto(h: HojaItem): string {
		return `${h.nombre} ${h.apellido}`.replace(/\s+/g, ' ').trim();
	}

	function normalizar(s: string): string {
		// Sin acentos y sin separadores: "MUNOZ" encuentra "MUÑOZ" y
		// "1.116.867" encuentra "1116867049".
		return (s || '')
			.toUpperCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^A-Z0-9]/g, '');
	}

	const filtrados = $derived.by(() => {
		const q = normalizar(busqueda);
		if (!q) return hojas;
		return hojas.filter(
			(h) =>
				// Nombre y apellido se comparan por separado ADEMÁS de juntos:
				// así "MUNEVAR" encuentra a quien lo lleva de apellido aunque
				// se escriba antes que el nombre de pila.
				normalizar(nombreCompleto(h)).includes(q) ||
				normalizar(h.apellido).includes(q) ||
				normalizar(h.numero_identificacion ?? '').includes(q)
		);
	});

	function abrir() {
		abierto = true;
		busqueda = '';
		cursor = Math.max(
			0,
			hojas.findIndex((h) => h.conductor_id === activo)
		);
		queueMicrotask(() => inputEl?.focus());
	}

	function elegir(conductorId: string) {
		abierto = false;
		busqueda = '';
		onSeleccionar(conductorId);
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
			const h = filtrados[cursor];
			if (h) elegir(h.conductor_id);
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
		title="Buscar un conductor del corte y abrir su hoja"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
		</svg>
		<span class="shc-actual">
			{activoObj ? nombreCompleto(activoObj) : 'Buscar hoja'}
		</span>
		<span class="shc-cuenta">{hojas.length}</span>
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
				placeholder="Nombre, apellido o cédula…"
				autocomplete="off"
			/>

			{#if filtrados.length === 0}
				<div class="shc-vacio">Ninguna hoja del corte coincide con «{busqueda}».</div>
			{:else}
				<ul class="shc-lista">
					{#each filtrados as h, i (h.conductor_id)}
						<li>
							<button
								class="shc-item"
								class:shc-item-cursor={i === cursor}
								class:shc-item-activo={h.conductor_id === activo}
								onclick={() => elegir(h.conductor_id)}
								onmouseenter={() => (cursor = i)}
							>
								<span class="shc-nombre">{nombreCompleto(h)}</span>
								<span class="shc-cedula">{h.numero_identificacion ?? 'sin cédula'}</span>
								{#if h.filas.length === 0}
									<span class="shc-filas shc-filas-vacia" title="Hoja sin recorridos">vacía</span>
								{:else}
									<span class="shc-filas" title="{h.filas.length} filas en el corte">
										{h.filas.length}
									</span>
								{/if}
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
		/* Anclado por la DERECHA, como en cierres: el disparador vive en la
		   mitad derecha del toolbar y un panel de 380px colgando de `left: 0`
		   se salía de la ventana. */
		right: 0;
		left: auto;
		z-index: 60;
		width: 380px;
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
		outline: 2px solid #ea580c;
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
		box-shadow: inset 2px 0 0 #ea580c;
	}

	.shc-nombre {
		flex: 1;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shc-cedula {
		color: #475569;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.shc-filas {
		background: #e2e8f0;
		color: #334155;
		border-radius: 999px;
		padding: 1px 7px;
		font-size: 10px;
		font-weight: 700;
		min-width: 24px;
		text-align: center;
	}
	.shc-filas-vacia {
		background: #fef3c7;
		color: #92400e;
	}

	.shc-vacio {
		padding: 14px 10px;
		font-size: 12.5px;
		color: #64748b;
		text-align: center;
	}
</style>
