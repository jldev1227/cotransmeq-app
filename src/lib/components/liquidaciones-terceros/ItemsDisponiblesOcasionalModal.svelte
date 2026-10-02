<script lang="ts">
	/**
	 * Traer al ocasional items de liquidación de OTROS meses.
	 *
	 * QUÉ PROBLEMA RESUELVE. El borrador del ocasional se arma con los items
	 * del mes que se liquida. Un servicio de mayo que nadie liquidó —y que se
	 * quiere cobrar en junio— no entra en ese filtro. «Refrescar» tampoco lo
	 * trae: mira el mismo mes. Quedaba regenerar el borrador, que se lleva por
	 * delante todo lo tecleado.
	 *
	 * QUÉ SE LISTA. Items de `liquidacion_tercero` de CUALQUIER mes que sigan
	 * sueltos y estén facturados.
	 *
	 * QUÉ NO SE LISTA, y son dos motivos distintos que el pie separa:
	 *
	 *   · lo que ya está en un CIERRE DE PLACA. La regla del ocasional es que
	 *     liquida lo que no entró en un cierre; traer aquí algo ya cerrado lo
	 *     pagaría dos veces. Se mira contra el mes DEL ITEM y no contra el mes
	 *     destino: lo que decide es dónde se liquidó, no dónde se va a cobrar.
	 *   · lo que ya está en OTRO ocasional vivo, por lo mismo.
	 *
	 * Hermano de `ItemsDisponiblesModal`, el del canvas de placas. No se
	 * comparte componente a propósito: las reglas de exclusión son otras —allí
	 * manda la placa del cierre, aquí que el item siga suelto— y el payload
	 * tampoco coincide. Fundirlos obligaría a un componente con dos modos que
	 * no comparten casi nada salvo la tabla.
	 */

	import { onMount } from 'svelte';
	/**
	 * `SvelteSet` y no un `Set` normal: el `Set` de siempre muta en sitio y
	 * Svelte 5 no se entera, así que las casillas no repintaban al marcarlas.
	 * Es la misma estructura con las lecturas instrumentadas.
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import {
		liquidacionesTercerosOcasionalAPI,
		type ItemDisponibleOcasional
	} from '$lib/api/liquidaciones-terceros-ocasional';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		/// El ocasional se identifica por PERIODO y no por id: la cabecera puede
		/// no existir todavía, y el modal tiene que poder decirlo.
		mes: number;
		anio: number;
		periodo: string;
		onClose: () => void;
		/// Tras añadir: la page recarga el mes y remonta la hoja.
		onAgregado: (n: number) => void | Promise<void>;
	}

	let { mes, anio, periodo, onClose, onAgregado }: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];

	let cargando = $state(true);
	let trabajando = $state(false);
	let error = $state('');
	let disponibles = $state<ItemDisponibleOcasional[]>([]);
	let descartadosCierre = $state(0);
	let descartadosOcasional = $state(0);
	let editable = $state(true);
	/// `null` mientras carga o si el mes no tiene borrador todavía.
	let consecutivo = $state<string | null>(null);
	let sinBorrador = $state(false);
	const seleccion = new SvelteSet<string>();

	let busqueda = $state('');
	/// `''` = todos. Si no, la clave `anio-mes` del item.
	let filtroPeriodo = $state('');
	/// Alto de la franja fija de filtros: la cabecera de la tabla se pega
	/// justo debajo al hacer scroll.
	let altoFiltros = $state(0);

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

	const esDeOtroPeriodo = (i: ItemDisponibleOcasional) => !(i.mes === mes && i.anio === anio);

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	function alternar(id: string) {
		if (!editable || sinBorrador) return;
		if (seleccion.has(id)) seleccion.delete(id);
		else seleccion.add(id);
	}

	function alternarTodos() {
		if (!editable || sinBorrador) return;
		if (todosMarcados) for (const i of filtrados) seleccion.delete(i.id);
		else for (const i of filtrados) seleccion.add(i.id);
	}

	async function cargar() {
		cargando = true;
		error = '';
		try {
			const r = await liquidacionesTercerosOcasionalAPI.itemsDisponibles(mes, anio);
			disponibles = r.disponibles ?? [];
			descartadosCierre = r.descartados_por_cierre ?? 0;
			descartadosOcasional = r.descartados_por_ocasional ?? 0;
			editable = r.cabecera?.editable !== false;
			consecutivo = r.cabecera?.consecutivo ?? null;
			sinBorrador = !r.cabecera?.id;
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'No se pudieron leer los items';
		} finally {
			cargando = false;
		}
	}

	async function agregar() {
		if (!editable || sinBorrador || trabajando || seleccionados.length === 0) return;
		trabajando = true;
		error = '';
		const ids = seleccionados.map((i) => i.id);
		try {
			const r = await liquidacionesTercerosOcasionalAPI.agregarItems(mes, anio, ids);
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

	onMount(() => {
		void cargar();
	});
</script>

<!--
	El fondo no cierra: perder una selección de una docena de items por un
	clic despistado sale caro. Se sale por la ×, por Cerrar o por Esc.
-->
<ModalBase
	open={true}
	eyebrow={consecutivo ? `Liquidación ocasional · ${consecutivo}` : 'Liquidación ocasional'}
	title={`Traer items al ocasional de ${periodo}`}
	subtitle="Items facturados que siguen sueltos, de cualquier mes: ni en un cierre de placa ni en otro ocasional"
	tamano="xl"
	sinRelleno
	cerrarAlFondo={false}
	bloqueado={trabajando}
	cabecera={!cargando && (descartadosCierre > 0 || descartadosOcasional > 0) ? descarte : undefined}
	oncerrar={onClose}
>
	<div class="idm-filtros" bind:clientHeight={altoFiltros}>
		{#if sinBorrador}
			<p class="idm-bloqueo">
				{periodo} todavía no tiene borrador. Genéralo antes de traer items: sin cabecera
				no hay dónde colgarlos.
			</p>
		{:else if !editable}
			<p class="idm-bloqueo">
				La liquidación no está en BORRADOR: se puede consultar la lista, pero no añadir
				items.
			</p>
		{/if}

		<div class="idm-controles">
			<input
				class="idm-input idm-buscar"
				type="search"
				placeholder="Buscar por recorrido, cliente, tercero, factura o # liquidación…"
				bind:value={busqueda}
				disabled={cargando}
			/>
			<select
				class="idm-input"
				bind:value={filtroPeriodo}
				disabled={cargando || periodos.length === 0}
			>
				<option value="">Todos los periodos ({disponibles.length})</option>
				{#each periodos as [clave, etiqueta] (clave)}
					<option value={clave}>
						{etiqueta} ({disponibles.filter((i) => clavePeriodo(i) === clave).length})
					</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="idm-body">
		{#if cargando}
			<p class="idm-vacio">Leyendo items sueltos…</p>
		{:else if error && disponibles.length === 0}
			<p class="idm-error">{error}</p>
		{:else if disponibles.length === 0}
			<p class="idm-vacio">
				No hay items sueltos. Todos los facturados están ya en un cierre de placa o en
				un ocasional.
			</p>
		{:else if filtrados.length === 0}
			<p class="idm-vacio">Ningún item coincide con el filtro.</p>
		{:else}
			<table class="idm-tabla" style="--idm-top: {altoFiltros}px">
				<thead>
					<tr>
						<th class="idm-check">
							<input
								type="checkbox"
								checked={todosMarcados}
								onchange={alternarTodos}
								disabled={!editable || sinBorrador || trabajando}
								aria-label="Marcar todos los visibles"
							/>
						</th>
						<th>Periodo</th>
						<th>Placa</th>
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
									disabled={!editable || sinBorrador || trabajando}
									aria-label={`Seleccionar ${i.placa} ${i.recorrido || ''}`.trim()}
								/>
							</td>
							<td>
								<span class="idm-periodo" class:idm-otro={esDeOtroPeriodo(i)}>
									{etiquetaPeriodo(i)}
								</span>
							</td>
							<td class="idm-mono idm-placa">{i.placa || '—'}</td>
							<td class="idm-mono">{i.liquidacion_consecutivo || '—'}</td>
							<td>{i.cliente_nombre || '—'}</td>
							<td>{i.tercero_nombre || '—'}</td>
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

	{#snippet pie()}
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
		<button class="btn-secondary" onclick={onClose} disabled={trabajando}>Cerrar</button>
		<button
			class="btn-primary"
			onclick={agregar}
			disabled={!editable || sinBorrador || trabajando || seleccionados.length === 0}
		>
			{trabajando ? 'Añadiendo…' : `Añadir ${seleccionados.length || ''} item(s)`}
		</button>
	{/snippet}
</ModalBase>

<!-- El descarte va en la CABECERA y no bajo la tabla, que es donde
     estaba: con una lista corta la nota quedaba fuera de pantalla, y
     es justo entonces —cuando el usuario esperaba más items— cuando
     hay que explicar por qué no están. -->
<!-- Los dos descartes se cuentan POR SEPARADO: significan cosas
     distintas y se arreglan en sitios distintos. Uno manda al canvas
     de placas, el otro al ocasional del mes que se lo llevó. -->
{#snippet descarte()}
	<p class="idm-descarte">
		No se listan
		{#if descartadosCierre > 0}
			<strong>{descartadosCierre}</strong> item(s) que ya se liquidaron en un
			cierre de placa{descartadosOcasional > 0 ? ' y ' : '. '}
		{/if}
		{#if descartadosOcasional > 0}
			<strong>{descartadosOcasional}</strong> que están en otro ocasional.
		{/if}
		Un item solo puede vivir en un documento, o se pagaría dos veces.
	</p>
{/snippet}

<style>
	/* ── Franja fija de filtros (se queda arriba al hacer scroll) ── */
	.idm-filtros {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 22px 12px;
		background: var(--bg-base);
	}
	.idm-controles {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.idm-bloqueo {
		margin: 0;
		padding: 10px 14px;
		border-radius: 14px;
		border: 1px solid #fcd34d;
		background: #fffbeb;
		color: #92400e;
		font-size: 13px;
		font-weight: 600;
	}

	.idm-input {
		min-height: 42px;
		padding: 9px 12px;
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
	.idm-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.idm-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.idm-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	select.idm-input {
		cursor: pointer;
	}
	.idm-buscar {
		flex: 1 1 280px;
		min-width: 0;
	}

	.idm-body {
		padding: 0 22px 18px;
	}

	/* ── Tabla: tarjeta blanca sobre el fondo claro ─────────────── */
	.idm-tabla {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 13px;
		color: var(--text-primary);
		background: var(--bg-surface);
		border-radius: 16px;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.idm-tabla th {
		position: sticky;
		top: var(--idm-top, 0px);
		z-index: 1;
		background: var(--bg-surface);
		text-align: left;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		padding: 12px 10px 8px;
		border-bottom: 1px solid var(--border-default);
	}
	.idm-tabla th:first-child {
		border-top-left-radius: 16px;
	}
	.idm-tabla th:last-child {
		border-top-right-radius: 16px;
	}
	.idm-tabla td {
		padding: 9px 10px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: top;
	}
	.idm-tabla tbody tr:last-child td {
		border-bottom: none;
	}
	.idm-tabla tbody tr {
		cursor: pointer;
	}
	.idm-tabla tbody tr:hover {
		background: var(--bg-base);
	}
	/* El color de fondo solo no bastaba: a 12 filas la diferencia no se ve
	   de un vistazo y había que ir contando casillas. La barra de la
	   izquierda sí se lee en diagonal. */
	.idm-tabla tbody tr.idm-on {
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
		box-shadow: inset 3px 0 0 var(--accion);
	}
	.idm-tabla input[type='checkbox'] {
		accent-color: var(--accion);
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
		color: var(--text-secondary);
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
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.idm-placa {
		font-weight: 700;
		color: var(--text-primary);
	}

	.idm-vacio {
		margin: 14px 2px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.idm-error {
		margin: 10px 0 0;
		font-size: 12.5px;
		font-weight: 600;
		color: #b91c1c;
	}
	/* Nota de descartes, dentro del encabezado oscuro de ModalBase. */
	.idm-descarte {
		margin: 0;
		padding-bottom: 18px;
		font-size: 12px;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.72);
		max-width: 72ch;
	}
	.idm-descarte strong {
		color: #fff;
	}
	.idm-ocultos {
		color: #b45309;
	}

	/* Resumen a la izquierda del pie de ModalBase. */
	.idm-resumen {
		flex: 1;
		min-width: 180px;
		font-size: 13px;
		color: var(--text-secondary);
	}
</style>
