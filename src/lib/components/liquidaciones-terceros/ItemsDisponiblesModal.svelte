<script lang="ts">
	/**
	 * Traer al cierre items de liquidación que el borrador no recogió.
	 *
	 * QUÉ PROBLEMA RESUELVE. El borrador se arma con los items del PERIODO que
	 * se está liquidando. Una facturada que se registra hoy y pertenece a
	 * junio —o que se quiere cobrar en junio aunque sea de julio— no entra en
	 * ese filtro y no hay forma de verla desde la hoja. «Recargar items»
	 * tampoco la trae: mira el mismo mes y el mismo tercero. Quedaba regenerar
	 * el borrador, que se lleva por delante todo lo tecleado en la hoja.
	 *
	 * QUÉ SE LISTA. Items de `liquidacion_tercero` de LA MISMA PLACA, de
	 * cualquier mes y de cualquier tercero. Manda la placa porque el cierre es
	 * del vehículo; que el item vaya con otro tercero es legítimo y se avisa
	 * en la fila, no se oculta.
	 *
	 * QUÉ NO SE LISTA. Lo que ya está en un cierre vivo —incluido este—: un
	 * item en dos cierres se pagaría dos veces. El servidor lo filtra y
	 * devuelve cuántos descartó, que es lo que explica el aviso del pie.
	 *
	 * Los items QUITADOS de este cierre tampoco salen aquí: su fila de pivote
	 * sigue existiendo, así que se devuelven desde «Filas del cierre → Items»,
	 * que es donde se quitaron.
	 */

	import { onMount } from 'svelte';
	/**
	 * `SvelteSet` y no un `Set` normal: el `Set` de siempre muta en sitio y
	 * Svelte 5 no se entera, así que las casillas no repintaban al marcarlas.
	 * Es la misma estructura con las lecturas instrumentadas.
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ItemDisponible
	} from '$lib/api/liquidaciones-terceros-descuentos';

	interface Props {
		cierreId: string;
		placa: string;
		periodo: string;
		/// Periodo del cierre, para marcar qué items son de otro mes.
		mes: number | null;
		anio: number | null;
		/// Un cierre que ya no es BORRADOR se puede consultar pero no tocar.
		editable: boolean;
		onClose: () => void;
		/// Tras añadir: la page recarga el cierre y remonta la hoja.
		onAgregado: (n: number) => void | Promise<void>;
	}

	let { cierreId, placa, periodo, mes, anio, editable, onClose, onAgregado }: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];

	let cargando = $state(true);
	let trabajando = $state(false);
	let error = $state('');
	let disponibles = $state<ItemDisponible[]>([]);
	let ocupados = $state(0);
	const seleccion = new SvelteSet<string>();

	let busqueda = $state('');
	/// `''` = todos. Si no, la clave `anio-mes` del item.
	let filtroPeriodo = $state('');

	const clavePeriodo = (i: { anio: number | null; mes: number | null }) =>
		i.anio && i.mes ? `${i.anio}-${String(i.mes).padStart(2, '0')}` : 'sin-periodo';

	const etiquetaPeriodo = (i: { anio: number | null; mes: number | null }) =>
		i.anio && i.mes ? `${MESES[i.mes - 1] ?? i.mes} ${i.anio}` : 'Sin periodo';

	/// Los periodos presentes en la lista, del más reciente al más antiguo.
	const periodos = $derived.by(() => {
		const vistos = new Map<string, string>();
		for (const i of disponibles) vistos.set(clavePeriodo(i), etiquetaPeriodo(i));
		return [...vistos.entries()].sort((a, b) => b[0].localeCompare(a[0]));
	});

	const filtrados = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		return disponibles.filter((i) => {
			if (filtroPeriodo && clavePeriodo(i) !== filtroPeriodo) return false;
			if (!q) return true;
			return [
				i.recorrido,
				i.cliente_nombre,
				i.tercero_nombre,
				i.numero_factura,
				i.liquidacion_consecutivo,
				i.fechas,
				i.numero_planilla
			]
				.filter(Boolean)
				.some((c) => String(c).toLowerCase().includes(q));
		});
	});

	/// Solo cuenta lo VISIBLE: se añade lo que se está viendo, nunca algo que
	/// el filtro dejó fuera de la pantalla. Lo marcado y luego escondido no se
	/// pierde —vuelve al quitar el filtro—, pero tampoco entra: el pie lo
	/// avisa con `ocultosMarcados` para que nadie cuente con ello.
	const seleccionados = $derived(filtrados.filter((i) => seleccion.has(i.id)));
	const ocultosMarcados = $derived(seleccion.size - seleccionados.length);
	const totalSeleccionado = $derived(
		seleccionados.reduce((s, i) => s + (Number(i.valor_liquidar) || 0), 0)
	);
	const todosMarcados = $derived(filtrados.length > 0 && seleccionados.length === filtrados.length);

	const esDeOtroPeriodo = (i: ItemDisponible) => !(i.mes === mes && i.anio === anio);

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	function alternar(id: string) {
		if (!editable) return;
		if (seleccion.has(id)) seleccion.delete(id);
		else seleccion.add(id);
	}

	function alternarTodos() {
		if (!editable) return;
		if (todosMarcados) for (const i of filtrados) seleccion.delete(i.id);
		else for (const i of filtrados) seleccion.add(i.id);
	}

	async function cargar() {
		cargando = true;
		error = '';
		try {
			const r = await liquidacionesTercerosDescuentosAPI.itemsDisponibles(cierreId);
			disponibles = r.disponibles ?? [];
			ocupados = r.ocupados ?? 0;
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'No se pudieron leer los items';
		} finally {
			cargando = false;
		}
	}

	async function agregar() {
		if (!editable || trabajando || seleccionados.length === 0) return;
		trabajando = true;
		error = '';
		const ids = seleccionados.map((i) => i.id);
		try {
			const r = await liquidacionesTercerosDescuentosAPI.agregarItems(cierreId, ids);
			await onAgregado(r.agregados ?? ids.length);
			onClose();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error al agregar los items';
			// Se recarga la lista: el rechazo más probable es que alguien haya
			// metido ese item en otro cierre mientras este modal estaba
			// abierto, y entonces ya no debe seguir ofreciéndose.
			await cargar();
		} finally {
			trabajando = false;
		}
	}

	function alTeclado(e: KeyboardEvent) {
		if (e.key === 'Escape' && !trabajando) onClose();
	}

	onMount(() => {
		void cargar();
	});
</script>

<svelte:window onkeydown={alTeclado} />

<div class="idm-backdrop">
	<div class="idm" role="dialog" aria-modal="true" aria-labelledby="idm-titulo">
		<div class="idm-head">
			<div>
				<h2 id="idm-titulo">Traer items a {placa}</h2>
				<p class="idm-sub">
					{periodo} · items de esta placa que no están en ningún cierre, de cualquier mes
				</p>
				<!-- El descarte va en la CABECERA y no bajo la tabla, que es donde
				     estaba: con una lista corta la nota quedaba fuera de pantalla, y
				     es justo entonces —cuando el usuario esperaba más items— cuando
				     hay que explicar por qué no están. -->
				{#if !cargando && ocupados > 0}
					<p class="idm-descarte">
						{ocupados} item(s) más de {placa} no se listan: ya están en un cierre. Un item
						solo puede vivir en uno, o se pagaría dos veces.
					</p>
				{/if}
			</div>
			<button class="idm-x" onclick={onClose} disabled={trabajando} aria-label="Cerrar">×</button>
		</div>

		{#if !editable}
			<p class="idm-bloqueo">
				La hoja no está en BORRADOR: se puede consultar la lista, pero no añadir items.
			</p>
		{/if}

		<div class="idm-filtros">
			<input
				class="idm-buscar"
				type="search"
				placeholder="Buscar por recorrido, cliente, tercero, factura o # liquidación…"
				bind:value={busqueda}
				disabled={cargando}
			/>
			<select bind:value={filtroPeriodo} disabled={cargando || periodos.length === 0}>
				<option value="">Todos los periodos ({disponibles.length})</option>
				{#each periodos as [clave, etiqueta] (clave)}
					<option value={clave}>
						{etiqueta} ({disponibles.filter((i) => clavePeriodo(i) === clave).length})
					</option>
				{/each}
			</select>
		</div>

		<div class="idm-body">
			{#if cargando}
				<p class="idm-vacio">Leyendo items de {placa}…</p>
			{:else if error && disponibles.length === 0}
				<p class="idm-error">{error}</p>
			{:else if disponibles.length === 0}
				<p class="idm-vacio">
					No hay items sueltos de {placa}. Todos los que existen en la base ya están en
					un cierre.
				</p>
			{:else if filtrados.length === 0}
				<p class="idm-vacio">Ningún item coincide con el filtro.</p>
			{:else}
				<table class="idm-tabla">
					<thead>
						<tr>
							<th class="idm-check">
								<input
									type="checkbox"
									checked={todosMarcados}
									onchange={alternarTodos}
									disabled={!editable || trabajando}
									aria-label="Marcar todos los visibles"
								/>
							</th>
							<th>Periodo</th>
							<th># Liq</th>
							<th>Cliente</th>
							<th>Nombre 3°</th>
							<th>Recorrido</th>
							<th>Fechas</th>
							<th># Factura</th>
							<th class="idm-num">V/Liquidar</th>
						</tr>
					</thead>
					<tbody>
						{#each filtrados as i (i.id)}
							<tr
								class:idm-on={seleccion.has(i.id)}
								onclick={() => alternar(i.id)}
								title={`V/unidad $${formatCOP(i.valor_unitario)} × ${i.cantidad} · admón ${i.porcentaje_admin}% ($${formatCOP(i.valor_admin)}) · total facturado $${formatCOP(i.total_facturado)}${i.numero_planilla ? ` · planilla ${i.numero_planilla}` : ''}`}
							>
								<td class="idm-check">
									<input
										type="checkbox"
										checked={seleccion.has(i.id)}
										onchange={() => alternar(i.id)}
										onclick={(e) => e.stopPropagation()}
										disabled={!editable || trabajando}
										aria-label={`Seleccionar ${i.recorrido || 'item'}`}
									/>
								</td>
								<td>
									<span class="idm-periodo" class:idm-otro={esDeOtroPeriodo(i)}>
										{etiquetaPeriodo(i)}
									</span>
								</td>
								<td class="idm-mono">{i.liquidacion_consecutivo || '—'}</td>
								<td>{i.cliente_nombre || '—'}</td>
								<td>
									{i.tercero_nombre || '—'}
									{#if i.otro_tercero}
										<span class="idm-badge" title="Este item va con un tercero distinto al del cierre. Se puede traer igualmente: lo que decide es la placa.">otro 3°</span>
									{/if}
								</td>
								<td class="idm-recorrido">{i.recorrido || '—'}</td>
								<td class="idm-mono">{i.fechas || '—'}</td>
								<td class="idm-mono">{i.numero_factura || '—'}</td>
								<td class="idm-num idm-total">${formatCOP(i.valor_liquidar)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if error && disponibles.length > 0}
				<p class="idm-error">{error}</p>
			{/if}

		</div>

		<div class="idm-foot">
			<span class="idm-resumen">
				{#if seleccionados.length > 0}
					<strong>{seleccionados.length}</strong> seleccionado(s) ·
					<strong>${formatCOP(totalSeleccionado)}</strong>
					{#if ocultosMarcados > 0}
						<span class="idm-ocultos">
							· {ocultosMarcados} marcado(s) fuera del filtro, no entran
						</span>
					{/if}
				{:else if !cargando && disponibles.length > 0}
					{filtrados.length} item(s) a la vista
				{/if}
			</span>
			<div class="idm-acciones">
				<button class="idm-ghost" onclick={onClose} disabled={trabajando}>Cerrar</button>
				<button
					class="idm-add"
					onclick={agregar}
					disabled={!editable || trabajando || seleccionados.length === 0}
				>
					{trabajando ? 'Añadiendo…' : `Añadir ${seleccionados.length || ''} item(s)`}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.idm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}
	.idm {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 1120px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.idm-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
	}
	.idm-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.idm-sub {
		margin: 3px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.idm-x {
		border: none;
		background: transparent;
		font-size: 22px;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}
	.idm-bloqueo {
		margin: 0 20px 8px;
		padding: 8px 10px;
		border-radius: 7px;
		background: #fffbeb;
		color: #b45309;
		font-size: 11.5px;
		font-weight: 600;
	}

	.idm-filtros {
		display: flex;
		gap: 8px;
		padding: 0 20px 12px;
		border-bottom: 1px solid #e2e8f0;
	}
	.idm-filtros input,
	.idm-filtros select {
		padding: 7px 10px;
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		font-size: 12.5px;
		font-family: inherit;
		color: #0f172a;
		background: #fff;
	}
	.idm-buscar {
		flex: 1 1 auto;
		min-width: 0;
	}

	.idm-body {
		padding: 12px 20px;
		overflow: auto;
		min-height: 0;
		flex: 1 1 auto;
	}

	.idm-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.idm-tabla th {
		position: sticky;
		top: -12px;
		z-index: 1;
		background: #fff;
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 0 8px 6px;
		border-bottom: 1px solid #e2e8f0;
	}
	.idm-tabla td {
		padding: 7px 8px;
		border-bottom: 1px solid #f1f5f9;
		vertical-align: top;
	}
	.idm-tabla tbody tr {
		cursor: pointer;
	}
	.idm-tabla tbody tr:hover {
		background: #f8fafc;
	}
	/* El verde de fondo solo no bastaba: a 12 filas la diferencia entre
	   `#fff` y `#f0fdf4` no se ve de un vistazo y había que ir contando
	   casillas. La barra de la izquierda sí se lee en diagonal. */
	.idm-tabla tbody tr.idm-on {
		background: #f0fdf4;
		box-shadow: inset 3px 0 0 #ea580c;
	}
	.idm-check {
		width: 30px;
	}
	.idm-num {
		text-align: right;
		white-space: nowrap;
	}
	.idm-total {
		font-weight: 700;
	}
	.idm-mono {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: #475569;
	}
	/* El recorrido es la celda larga: se le deja partir para que no empuje al
	   resto de columnas fuera del modal. */
	.idm-recorrido {
		min-width: 220px;
		line-height: 1.35;
	}
	.idm-periodo {
		display: inline-block;
		padding: 1px 7px;
		border-radius: 999px;
		background: #f0fdf4;
		color: #166534;
		font-size: 10.5px;
		font-weight: 700;
		white-space: nowrap;
	}
	/* Un item de otro mes es EL CASO NORMAL de este modal, no un error: se
	   distingue en gris para poder agrupar de un vistazo, sin alarmar. */
	.idm-periodo.idm-otro {
		background: #f1f5f9;
		color: #475569;
	}
	.idm-badge {
		display: inline-block;
		margin-left: 5px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.idm-vacio {
		margin: 14px 2px;
		font-size: 12.5px;
		color: #64748b;
	}
	.idm-error {
		margin: 10px 0 0;
		font-size: 11.5px;
		font-weight: 600;
		color: #b91c1c;
	}
	.idm-descarte {
		margin: 6px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #64748b;
		max-width: 62ch;
	}
	.idm-ocultos {
		color: #b45309;
	}

	.idm-foot {
		padding: 12px 20px 16px;
		border-top: 1px solid #e2e8f0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.idm-resumen {
		font-size: 12px;
		color: #475569;
	}
	.idm-acciones {
		display: flex;
		gap: 8px;
	}
	.idm-ghost {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		background: #f1f5f9;
		color: #334155;
		font-size: 12.5px;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
	}
	.idm-add {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		background: #ea580c;
		color: #fff;
		font-size: 12.5px;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.idm-add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
