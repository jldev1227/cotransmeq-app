<script lang="ts">
	/**
	 * Selector múltiple con buscador: un campo que abre una lista con casillas
	 * y deja lo elegido como pastillas debajo.
	 *
	 * Para filtros de «varias placas», «varios conductores»: un `<select
	 * multiple>` nativo obliga a mantener Ctrl pulsado y no busca; una lista de
	 * cincuenta casillas a la vista se come la pantalla.
	 */
	export interface OpcionMultiple {
		valor: string;
		etiqueta: string;
		/** Línea secundaria (una cédula, una placa). */
		detalle?: string;
	}

	interface Props {
		etiqueta: string;
		placeholder?: string;
		opciones: OpcionMultiple[];
		seleccion: string[];
		onCambiar: (seleccion: string[]) => void;
		/** Cuántas pastillas se muestran antes de resumir «+N». */
		maxPastillas?: number;
	}

	let {
		etiqueta,
		placeholder = 'Buscar…',
		opciones,
		seleccion,
		onCambiar,
		maxPastillas = 6
	}: Props = $props();

	let abierto = $state(false);
	let texto = $state('');
	let indice = $state(0);
	let campo = $state<HTMLInputElement | null>(null);

	function normalizar(s: string) {
		return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}

	const filtradas = $derived.by(() => {
		const q = normalizar(texto.trim());
		const lista = q
			? opciones.filter(
					(o) => normalizar(o.etiqueta).includes(q) || normalizar(o.detalle ?? '').includes(q)
				)
			: opciones;
		return lista.slice(0, 60);
	});

	const elegidas = $derived(
		seleccion.map((v) => opciones.find((o) => o.valor === v) ?? { valor: v, etiqueta: v })
	);

	function alternar(valor: string) {
		onCambiar(
			seleccion.includes(valor) ? seleccion.filter((v) => v !== valor) : [...seleccion, valor]
		);
	}

	function teclas(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			abierto = true;
			indice = Math.min(indice + 1, filtradas.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			indice = Math.max(indice - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const o = filtradas[indice];
			if (o) alternar(o.valor);
		} else if (e.key === 'Escape') {
			abierto = false;
			campo?.blur();
		} else if (e.key === 'Backspace' && !texto && seleccion.length) {
			onCambiar(seleccion.slice(0, -1));
		}
	}

	$effect(() => {
		void filtradas;
		indice = 0;
	});
</script>

<div class="sm" class:sm--abierto={abierto}>
	<span class="sm-etiqueta">{etiqueta}</span>
	<div class="sm-campo-marco">
		<svg class="sm-lupa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="11" cy="11" r="7" />
			<path stroke-linecap="round" d="M21 21l-4.3-4.3" />
		</svg>
		<input
			bind:this={campo}
			bind:value={texto}
			type="text"
			class="sm-campo"
			{placeholder}
			autocomplete="off"
			spellcheck="false"
			onfocus={() => (abierto = true)}
			onblur={() => setTimeout(() => (abierto = false), 140)}
			onkeydown={teclas}
			aria-label={etiqueta}
		/>
		{#if seleccion.length}
			<span class="sm-cuenta">{seleccion.length}</span>
			<button
				type="button"
				class="sm-limpiar"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => onCambiar([])}
				aria-label="Quitar todos de {etiqueta}"
			>
				✕
			</button>
		{/if}
	</div>

	{#if abierto}
		<ul class="sm-lista" role="listbox" aria-multiselectable="true">
			{#if filtradas.length}
				{#each filtradas as o, i (o.valor)}
					{@const marcada = seleccion.includes(o.valor)}
					<li>
						<button
							type="button"
							class="sm-item"
							class:sm-item--activo={i === indice}
							class:sm-item--marcado={marcada}
							role="option"
							aria-selected={marcada}
							onmousedown={(e) => e.preventDefault()}
							onmouseenter={() => (indice = i)}
							onclick={() => alternar(o.valor)}
						>
							<span class="sm-check" aria-hidden="true">{marcada ? '✓' : ''}</span>
							<span class="sm-texto">
								<span>{o.etiqueta}</span>
								{#if o.detalle}<small>{o.detalle}</small>{/if}
							</span>
						</button>
					</li>
				{/each}
				{#if opciones.length > filtradas.length && !texto}
					<li class="sm-mas">Escribe para ver más ({opciones.length - filtradas.length} más)</li>
				{/if}
			{:else}
				<li class="sm-vacio">Sin coincidencias.</li>
			{/if}
		</ul>
	{/if}

	{#if elegidas.length}
		<div class="sm-pastillas">
			{#each elegidas.slice(0, maxPastillas) as o (o.valor)}
				<span class="sm-pastilla">
					{o.etiqueta}
					<button type="button" onclick={() => alternar(o.valor)} aria-label="Quitar {o.etiqueta}"
						>✕</button
					>
				</span>
			{/each}
			{#if elegidas.length > maxPastillas}
				<span class="sm-pastilla sm-pastilla--mas">+{elegidas.length - maxPastillas}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.sm {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.sm-etiqueta {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.sm-campo-marco {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 40px;
		padding: 0 0.5rem 0 0.75rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.sm--abierto .sm-campo-marco {
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb, 7, 150, 101), 0.12);
	}
	.sm-lupa {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
		color: var(--text-very-muted);
	}
	.sm-campo {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.sm-campo:focus {
		outline: none;
	}
	.sm-campo::placeholder {
		color: var(--text-very-muted);
	}
	.sm-cuenta {
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: var(--au-tint, #ddf7ea);
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--emerald-800);
	}
	.sm-limpiar {
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 8px;
		background: transparent;
		font-size: 0.7rem;
		color: var(--text-muted);
		cursor: pointer;
	}
	.sm-limpiar:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}

	.sm-lista {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(0.62rem + 0.4rem + 40px + 6px);
		z-index: 40;
		max-height: 17rem;
		margin: 0;
		padding: 0.35rem;
		list-style: none;
		overflow-y: auto;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 14px;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
	}
	.sm-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: none;
		border-radius: 9px;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
	}
	.sm-item--activo {
		background: var(--bg-base);
	}
	.sm-item--marcado {
		color: var(--emerald-800);
	}
	.sm-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		border: 1.5px solid var(--border-default);
		border-radius: 6px;
		font-size: 0.7rem;
		font-weight: 800;
		color: #fff;
	}
	.sm-item--marcado .sm-check {
		background: var(--emerald-500);
		border-color: var(--emerald-500);
	}
	.sm-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}
	.sm-texto span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sm-texto small {
		font-size: 0.68rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.sm-vacio,
	.sm-mas {
		padding: 0.6rem 0.7rem;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.sm-pastillas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.sm-pastilla {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.22rem 0.3rem 0.22rem 0.6rem;
		border-radius: 999px;
		background: var(--au-tint, #ddf7ea);
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--emerald-800);
	}
	.sm-pastilla button {
		width: 18px;
		height: 18px;
		border: none;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 0.6rem;
		color: inherit;
		cursor: pointer;
	}
	.sm-pastilla--mas {
		padding-right: 0.6rem;
		background: var(--bg-base);
		color: var(--text-muted);
	}
</style>
