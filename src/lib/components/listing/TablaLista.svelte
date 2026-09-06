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
		vacio
	}: Props = $props();

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
		<table class="tl-tabla" aria-label={etiqueta} aria-busy={cargando}>
			<thead>
				{#each modelo.grupos as grupo (grupo.id)}
					<tr>
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
							{#each columnas as col, j (j)}
								<td class="tl-td"><span class="tl-esqueleto"></span></td>
							{/each}
						</tr>
					{/each}
				{:else if modelo.filas.length === 0}
					<tr>
						<td class="tl-td tl-vacio" colspan={columnas.length}>
							{#if vacio}{@render vacio()}{:else}Sin resultados{/if}
						</td>
					</tr>
				{:else}
					{#each modelo.filas as fila (claveFila(fila.original))}
						<tr
							class="tl-tr"
							class:tl-tr--pulsable={!!onFila}
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
							{#each fila.getVisibleCells() as cell (cell.id)}
								<td class="tl-td">
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
		border: 1px solid var(--tl-borde, rgba(0, 0, 0, 0.06));
		border-radius: var(--tl-radio, 16px);
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
		padding: 0.65rem 0.9rem;
		background: var(--tl-th-fondo, #faf7f2);
		border-bottom: 1px solid var(--tl-borde, rgba(0, 0, 0, 0.06));
		font-family: var(--tl-mono, 'JetBrains Mono', monospace);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--tl-th-color, #6b6b6b);
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
		color: var(--tl-th-color-hover, #0f1f1a);
	}
	.tl-orden {
		opacity: 0.35;
		font-size: 0.75rem;
	}
	.tl-orden--activo {
		opacity: 1;
	}

	.tl-tr {
		border-bottom: 1px solid var(--tl-borde, rgba(0, 0, 0, 0.05));
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
		background: var(--tl-fila-hover, rgba(0, 0, 0, 0.02));
		outline: none;
	}
	.tl-tr--pulsable:focus-visible {
		box-shadow: inset 3px 0 0 var(--tl-acento, #10b981);
	}

	.tl-td {
		padding: 0.6rem 0.9rem;
		vertical-align: middle;
		color: var(--tl-td-color, #1a1a1a);
	}
	.tl-vacio {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--tl-td-suave, #6b6b6b);
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
