<!--
	Tabla de listado, compartida por las pantallas del dashboard.

	Vive junto a `BuscadorLista` y `PaginadorLista` porque forma parte del mismo
	juego: buscador arriba, tabla en medio, paginador abajo. Las pantallas que
	listan registros venían resolviéndolo cada una a su manera —tarjetas en
	SARLAFT, rejillas en otras— y eso es lo que hacía que no se parecieran entre
	sí ni aprovecharan el ancho.

	── Por qué `@tanstack/table-core` y no `@tanstack/svelte-table` ──
	El adaptador de Svelte en su versión 8 está escrito contra los stores de
	Svelte 4; la 9 es otra mayor. El núcleo es agnóstico y son treinta líneas
	conectarlo a runes, que es justo lo que hace este componente.

	── Por qué la ordenación es del servidor ──
	`manualSorting: true`. Estas listas vienen paginadas: ordenar en el
	navegador reordenaría solo los 20 registros de la página actual y daría un
	orden que NO es el del conjunto, sin que nada avise. La cabecera solo emite
	el criterio; quien ordena es la consulta.

	── Cómo se pintan las celdas ──
	`flexRender` es específico de cada framework y en Svelte obliga a
	componentes dinámicos por celda. Aquí el consumidor pasa un único snippet
	`celda` y decide con un `{#if columna.id === ...}`. Es explícito, se tipa
	solo y deja el markup rico (pastillas de estado, enlaces, iconos) donde
	vive su CSS. Si el snippet no cubre una columna, se pinta el valor plano.
-->
<script lang="ts" generics="T">
	import {
		createTable,
		getCoreRowModel,
		type ColumnDef,
		type Row,
		type SortingState,
		type TableOptionsResolved
	} from '@tanstack/table-core';
	import { untrack, type Snippet } from 'svelte';

	interface Props {
		columnas: ColumnDef<T, any>[];
		datos: T[];
		/** Clave estable de cada fila; sin ella Svelte reordena mal al ordenar. */
		claveFila: (fila: T) => string;
		cargando?: boolean;
		/** Estado de ordenación. Lo controla el padre, que consulta al servidor. */
		orden?: SortingState;
		/** Sin esto las cabeceras no son pulsables: no se finge ordenación. */
		onOrdenar?: (orden: SortingState) => void;
		/** Clic en la fila entera. La fila solo es pulsable si se pasa. */
		onFila?: (fila: T) => void;
		/** Descripción de la tabla para lectores de pantalla. */
		etiqueta: string;
		celda?: Snippet<[{ columnaId: string; fila: T; valor: unknown }]>;
		vacio?: Snippet;
		/**
		 * Selección múltiple. Con `onSeleccion` la tabla pinta una columna
		 * PROPIA de casillas, con «seleccionar todo» en la cabecera. Antes cada
		 * pantalla metía la casilla dentro de su primera celda, pegada al nombre
		 * y sin forma de marcar la página entera.
		 */
		seleccion?: Set<string>;
		onSeleccion?: (ids: Set<string>) => void;
	}

	let {
		columnas,
		datos,
		claveFila,
		cargando = false,
		orden = [],
		onOrdenar,
		onFila,
		etiqueta,
		celda,
		vacio,
		seleccion = new Set<string>(),
		onSeleccion
	}: Props = $props();

	const conSeleccion = $derived(!!onSeleccion);
	const clavesVisibles = $derived(datos.map((d) => claveFila(d)));
	const marcadasVisibles = $derived(clavesVisibles.filter((k) => seleccion.has(k)).length);
	const todasMarcadas = $derived(
		clavesVisibles.length > 0 && marcadasVisibles === clavesVisibles.length
	);
	const algunasMarcadas = $derived(marcadasVisibles > 0 && !todasMarcadas);

	/// Último índice marcado a mano: con Mayús se marca el tramo hasta él.
	let ultimoIndice: number | null = null;

	function alternarFila(clave: string, indice: number, e: MouseEvent) {
		if (!onSeleccion) return;
		const nueva = new Set(seleccion);
		if (e.shiftKey && ultimoIndice !== null) {
			const [a, b] = [Math.min(ultimoIndice, indice), Math.max(ultimoIndice, indice)];
			const tramo = clavesVisibles.slice(a, b + 1);
			const marcar = tramo.some((k) => !nueva.has(k));
			for (const k of tramo) {
				if (marcar) nueva.add(k);
				else nueva.delete(k);
			}
		} else {
			if (nueva.has(clave)) nueva.delete(clave);
			else nueva.add(clave);
		}
		ultimoIndice = indice;
		onSeleccion(nueva);
	}

	/// «Todo» es la página visible: es lo que el usuario ve marcado. Lo de
	/// otras páginas se conserva tal cual.
	function alternarTodas() {
		if (!onSeleccion) return;
		const nueva = new Set(seleccion);
		if (todasMarcadas) clavesVisibles.forEach((k) => nueva.delete(k));
		else clavesVisibles.forEach((k) => nueva.add(k));
		onSeleccion(nueva);
	}

	/// `indeterminate` solo existe como propiedad del DOM, no como atributo.
	function indeterminada(nodo: HTMLInputElement) {
		$effect(() => {
			nodo.indeterminate = algunasMarcadas;
		});
	}

	/// `state` y `onStateChange` son obligatorios en el núcleo aunque el estado
	/// real lo tenga el padre. Se crea con el estado vacío porque `createTable`
	/// es perezoso: no calcula nada hasta que se le piden los modelos, y hasta
	/// después de crearlo no existe `tabla.initialState` para fusionarlo.
	///
	/// `untrack` es deliberado: la instancia tiene que ser ESTABLE porque
	/// guarda el estado interno de la tabla. Quien la mantiene al día es el
	/// derivado de abajo.
	const tabla = createTable(
		untrack(
			() =>
				({
					data: datos,
					columns: columnas,
					getCoreRowModel: getCoreRowModel(),
					manualSorting: true,
					state: {},
					onStateChange: () => {},
					renderFallbackValue: null
				}) as TableOptionsResolved<T>
		)
	);

	/// Las opciones se empujan DENTRO del derivado, antes de leer el modelo: el
	/// núcleo no es reactivo, y hacerlo en un `$effect` aparte haría que el
	/// primer render leyera el modelo con los datos anteriores.
	const modelo = $derived.by(() => {
		tabla.setOptions((previas) => ({
			...previas,
			data: datos,
			columns: columnas,
			/// `initialState` trae los valores por defecto de TODAS las funciones
			/// del núcleo: `columnPinning`, `columnOrder`, `columnSizing`...
			/// Pasar solo `{ sorting }` deja el resto en `undefined` y
			/// `getHeaderGroups()` revienta leyendo `columnPinning.left`, con la
			/// página entera en blanco. Se vio así en el navegador.
			state: { ...tabla.initialState, sorting: orden }
		}));
		return {
			grupos: tabla.getHeaderGroups(),
			filas: tabla.getRowModel().rows
		};
	});

	function ordenable(id: string): boolean {
		if (!onOrdenar) return false;
		const col = columnas.find((c) => (c.id ?? (c as any).accessorKey) === id);
		return col?.enableSorting !== false;
	}

	function direccion(id: string): 'asc' | 'desc' | null {
		return orden.find((o) => o.id === id)?.desc === undefined
			? null
			: orden.find((o) => o.id === id)!.desc
				? 'desc'
				: 'asc';
	}

	/// Tres estados por columna: asc → desc → sin orden. El tercero devuelve al
	/// orden natural de la pantalla, que en un buzón de trámites (lo más nuevo
	/// arriba) suele ser el que se quiere recuperar.
	function alternarOrden(id: string) {
		if (!onOrdenar || !ordenable(id)) return;
		const actual = direccion(id);
		if (actual === null) onOrdenar([{ id, desc: false }]);
		else if (actual === 'asc') onOrdenar([{ id, desc: true }]);
		else onOrdenar([]);
	}

	function valorDe(fila: Row<T>, columnaId: string): unknown {
		try {
			return fila.getValue(columnaId);
		} catch {
			// Columnas de solo presentación (una de acciones, por ejemplo) no
			// tienen accessor y `getValue` revienta. No es un error.
			return undefined;
		}
	}
</script>

<div class="tl-marco">
	<!-- El desbordamiento horizontal se queda AQUÍ. Una tabla ancha que empuje
	     el scroll de la página entera rompe el layout del dashboard. -->
	<div class="tl-scroll">
		<table
			class="tl-tabla"
			class:tl-tabla--sel={conSeleccion}
			aria-label={etiqueta}
			aria-busy={cargando}
		>
			<thead>
				{#each modelo.grupos as grupo (grupo.id)}
					<tr>
						{#if conSeleccion}
							<th scope="col" class="tl-th tl-th--sel">
								<input
									type="checkbox"
									class="tl-check"
									checked={todasMarcadas}
									use:indeterminada
									disabled={cargando || clavesVisibles.length === 0}
									onclick={alternarTodas}
									aria-label={todasMarcadas
										? 'Quitar la selección de esta página'
										: 'Seleccionar todos los de esta página'}
								/>
							</th>
						{/if}
						{#each grupo.headers as header (header.id)}
							{@const id = header.column.id}
							{@const dir = direccion(id)}
							<th
								scope="col"
								class="tl-th"
								style={header.column.columnDef.size
									? `width:${header.column.columnDef.size}px`
									: undefined}
								aria-sort={dir === 'asc'
									? 'ascending'
									: dir === 'desc'
										? 'descending'
										: ordenable(id)
											? 'none'
											: undefined}
							>
								{#if ordenable(id)}
									<button type="button" class="tl-th-btn" onclick={() => alternarOrden(id)}>
										<span>{header.column.columnDef.header}</span>
										<span class="tl-orden" class:tl-orden--activo={dir !== null} aria-hidden="true">
											{dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}
										</span>
									</button>
								{:else}
									<span>{header.column.columnDef.header}</span>
								{/if}
							</th>
						{/each}
					</tr>
				{/each}
			</thead>

			<tbody>
				{#if cargando}
					<!-- Esqueleto con las MISMAS columnas: sin él la tabla colapsa a
					     cero y el contenido de abajo salta al llegar los datos. -->
					{#each Array(6) as _, i (i)}
						<tr class="tl-tr">
							{#if conSeleccion}<td class="tl-td tl-td--sel"></td>{/if}
							{#each columnas as col, j (j)}
								<td class="tl-td"><span class="tl-esqueleto"></span></td>
							{/each}
						</tr>
					{/each}
				{:else if modelo.filas.length === 0}
					<tr>
						<td class="tl-td tl-vacio" colspan={columnas.length + (conSeleccion ? 1 : 0)}>
							{#if vacio}{@render vacio()}{:else}Sin resultados{/if}
						</td>
					</tr>
				{:else}
					{#each modelo.filas as fila, indice (claveFila(fila.original))}
						{@const clave = claveFila(fila.original)}
						<tr
							class="tl-tr"
							class:tl-tr--pulsable={!!onFila}
							class:tl-tr--marcada={seleccion.has(clave)}
							onclick={onFila ? () => onFila(fila.original) : undefined}
							onkeydown={onFila
								? (e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											onFila(fila.original);
										}
									}
								: undefined}
							tabindex={onFila ? 0 : undefined}
							role={onFila ? 'button' : undefined}
						>
							{#if conSeleccion}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
								<td class="tl-td tl-td--sel" onclick={(e) => e.stopPropagation()}>
									<input
										type="checkbox"
										class="tl-check"
										checked={seleccion.has(clave)}
										onclick={(e) => alternarFila(clave, indice, e)}
										aria-label="Seleccionar fila"
									/>
								</td>
							{/if}
							{#each fila.getVisibleCells() as cell, j (cell.id)}
								<td
									class="tl-td"
									class:tl-td--primera={j === 0}
									class:tl-td--acciones={cell.column.id === 'acciones'}
									data-etiqueta={typeof cell.column.columnDef.header === 'string'
										? cell.column.columnDef.header
										: ''}
								>
									{#if celda}
										{@render celda({
											columnaId: cell.column.id,
											fila: fila.original,
											valor: valorDe(fila, cell.column.id)
										})}
									{:else}
										{valorDe(fila, cell.column.id) ?? ''}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

<style>
	/* Los colores salen de custom properties con valor por defecto neutro: el
	   componente lo comparten dos productos con paletas distintas (esmeralda y
	   naranja) y cada pantalla puede afinarlo sin tocar este archivo. */
	.tl-marco {
		background: var(--tl-fondo, white);
		border: 1px solid var(--tl-borde, var(--border-subtle, rgba(0, 0, 0, 0.06)));
		border-radius: var(--tl-radio, 22px);
		box-shadow: var(--tl-sombra, 0 4px 24px rgba(0, 0, 0, 0.04));
		overflow: hidden;
	}
	.tl-scroll {
		overflow-x: auto;
	}
	.tl-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.tl-th {
		position: sticky;
		top: 0;
		z-index: 1;
		text-align: left;
		white-space: nowrap;
		padding: 0.7rem 1.1rem;
		background: var(--tl-th-fondo, var(--bg-base, #fcfcfb));
		border-bottom: 1px solid var(--tl-borde, var(--border-subtle, rgba(0, 0, 0, 0.06)));
		font-family: var(--tl-mono, var(--font-sans));
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--tl-th-color, #64748b);
	}
	.tl-th-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}
	.tl-th-btn:hover {
		color: var(--tl-th-color-hover, #0f172a);
	}
	.tl-orden {
		opacity: 0.35;
		font-size: 0.75rem;
	}
	.tl-orden--activo {
		opacity: 1;
	}

	.tl-tr {
		border-bottom: 1px solid var(--tl-borde, var(--border-subtle, rgba(0, 0, 0, 0.05)));
	}
	.tl-tr:last-child {
		border-bottom: none;
	}
	.tl-tr--pulsable {
		cursor: pointer;
		transition: background-color 0.15s;
	}
	.tl-tr--pulsable:hover,
	.tl-tr--pulsable:focus-visible {
		background: var(--tl-fila-hover, var(--au-bg, rgba(0, 0, 0, 0.02)));
		outline: none;
	}
	.tl-tr--pulsable:focus-visible {
		box-shadow: inset 3px 0 0 var(--tl-acento, #16a34a);
	}

	.tl-td {
		padding: 0.75rem 1.1rem;
		height: 64px;
		vertical-align: middle;
		color: var(--tl-td-color, #0f172a);
	}
	.tl-td--acciones {
		text-align: right;
	}

	/* Columna de selección: angosta y propia, separada del nombre. */
	.tl-th--sel,
	.tl-td--sel {
		width: 52px;
		padding-right: 0;
		text-align: center;
	}
	.tl-check {
		width: 18px;
		height: 18px;
		margin: 0;
		vertical-align: middle;
		accent-color: var(--accion, #079665);
		cursor: pointer;
	}
	.tl-check:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.tl-tr--marcada,
	.tl-tr--marcada:hover {
		background: color-mix(in srgb, var(--accion, #079665) 7%, transparent);
	}

	/* ── Móvil: cada fila se apila como una tarjeta ──
	   La celda de identidad va arriba a todo el ancho; el resto lleva su
	   etiqueta de columna delante; las acciones, a la derecha del título. */
	@media (max-width: 767.98px) {
		.tl-tabla,
		.tl-tabla tbody,
		.tl-tr {
			display: block;
		}
		.tl-tabla thead {
			display: none;
		}
		.tl-tr {
			position: relative;
			padding: 0.85rem 1rem 0.85rem;
		}
		.tl-td {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			height: auto;
			padding: 0.2rem 0;
			font-size: 0.85rem;
		}
		.tl-td--primera {
			/* Deja sitio a las acciones, que van en la esquina superior derecha. */
			padding-right: 7.5rem;
			margin-bottom: 0.35rem;
		}
		.tl-td:not(.tl-td--primera):not(.tl-td--acciones):not(.tl-td--sel)::before {
			content: attr(data-etiqueta);
			flex: 0 0 6.5rem;
			font-size: 0.62rem;
			font-weight: 700;
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-very-muted, #94a3b8);
		}
		.tl-td--acciones {
			position: absolute;
			top: 0.6rem;
			right: 0.5rem;
			padding: 0;
		}
		/* En tarjeta, la casilla va en la esquina superior izquierda. */
		.tl-tabla--sel .tl-tr {
			padding-left: 2.85rem;
		}
		.tl-td--sel {
			position: absolute;
			top: 1.05rem;
			left: 0.9rem;
			width: auto;
			padding: 0;
		}
		.tl-td .tl-esqueleto {
			width: 100%;
		}
	}
	.tl-vacio {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--tl-td-suave, #64748b);
	}

	.tl-esqueleto {
		display: block;
		height: 0.85rem;
		border-radius: 5px;
		background: var(--tl-borde, rgba(0, 0, 0, 0.06));
		animation: tl-latido 1.2s ease-in-out infinite;
	}
	@keyframes tl-latido {
		50% {
			opacity: 0.45;
		}
	}

	/* Sin `prefers-reduced-motion` el esqueleto late en pantallas donde el
	   usuario pidió expresamente que nada se mueva. */
	@media (prefers-reduced-motion: reduce) {
		.tl-esqueleto {
			animation: none;
		}
		.tl-tr--pulsable {
			transition: none;
		}
	}
</style>
