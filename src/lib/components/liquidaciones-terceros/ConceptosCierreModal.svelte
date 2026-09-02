<script lang="ts">
	/**
	 * Filas de GASTOS DE VEHÍCULO y ANTICIPOS: añadir y quitar.
	 *
	 * POR QUÉ NO SE HACE INSERTANDO UNA FILA EN LA HOJA. Es lo primero que
	 * intenta cualquiera que venga de Excel, y ahí falla en silencio: la fila
	 * que inserta Univer no tiene combinación A:B, ni patrón de moneda, ni
	 * bordes, ni fórmula, ni —lo decisivo— un `id` en la base. El canvas se
	 * apoya en un registro `(fila, columna) → entidad` que se construye al
	 * montar la hoja, así que lo tecleado en una fila que Univer metió por su
	 * cuenta no tiene dónde guardarse. Al recargar había desaparecido.
	 *
	 * Naciendo en el servidor, la fila vuelve con su id y el builder la pinta
	 * como a sus vecinas, dentro del `=SUM()` de su sección.
	 *
	 * LOS IMPUESTOS NO ESTÁN AQUÍ. `calcularImpuestos` hace `deleteMany` +
	 * `createMany` sobre esas cuatro filas cada vez que corre, así que una
	 * añadida a mano duraría hasta el siguiente recálculo. Salen de
	 * `configuracion-descuentos-tercero`, y ahí se añade un quinto.
	 */

	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import { liquidacionesTercerosAdicionalesAPI } from '$lib/api/liquidaciones-terceros-adicionales';
	import type { AdicionalCierre, ItemCierre } from '$lib/editor/builders/cierres-finales.builder';

	interface Props {
		cierreId: string;
		placa: string;
		periodo: string;
		conceptos: ConceptoDescuento[];
		/**
		 * Adicionales del cierre. Viven en su PROPIA tabla
		 * (`liquidacion_tercero_final_adicional`), no entre los conceptos: son
		 * items de liquidación, no descuentos. Por eso llegan aparte y tienen
		 * su propio CRUD.
		 */
		adicionales: AdicionalCierre[];
		/// Items del pivote que SÍ están en el cierre. Los quitados no llegan
		/// aquí — el detalle filtra los que tienen `deleted_at` —, así que se
		/// piden aparte al abrir la pestaña.
		items: ItemCierre[];
		/// Tercero del cierre, para heredarlo en el adicional que se cree.
		terceroNombre?: string | null;
		onClose: () => void;
		/// Tras un cambio: la page recarga el cierre y remonta la hoja.
		onCambiado: (r: { accion: 'add' | 'remove'; concepto: string }) => void | Promise<void>;
	}

	let {
		cierreId,
		placa,
		periodo,
		conceptos,
		adicionales,
		items,
		terceroNombre = null,
		onClose,
		onCambiado
	}: Props = $props();

	type Seccion = 'GASTO_OPERATIVO' | 'ANTICIPO' | 'ADICIONAL' | 'ITEM';

	/**
	 * Los tres gastos que se calculan solos no se pueden borrar ni duplicar.
	 * Espejo de `CONCEPTOS_CALCULADOS_AUTO` en el servidor.
	 */
	const AUTOMATICOS = new Set(['DOTACION', 'EXAMEN_MEDICO', 'GASTOS_DIVERSOS']);

	let seccion = $state<Seccion>('GASTO_OPERATIVO');
	let nombre = $state('');
	let cantidad = $state(1);
	let valorUnitario = $state(0);
	/// Solo en ANTICIPOS. El backend lo guarda en `observaciones`, que es donde
	/// la hoja pinta la columna FECHA (no hay columna propia).
	let fecha = $state('');
	/// Solo en ADICIONALES.
	let recorrido = $state('');
	let pctAdmon = $state(10);

	let trabajando = $state(false);
	let error = $state('');

	const etiqueta = (c: string) => c.replace(/_/g, ' ');

	const filas = $derived(
		(conceptos ?? [])
			.filter((c) => c.tipo === seccion)
			.slice()
			.sort((a, b) => (a.orden || 0) - (b.orden || 0))
	);

	const total = $derived(
		seccion === 'ADICIONAL'
			? (adicionales ?? []).reduce((s, a) => s + (Number(a.valor_liquidar) || 0), 0)
			: filas.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
	);

	const cuentaGastos = $derived(
		(conceptos ?? []).filter((c) => c.tipo === 'GASTO_OPERATIVO').length
	);
	const cuentaAnticipos = $derived(
		(conceptos ?? []).filter((c) => c.tipo === 'ANTICIPO').length
	);
	const cuentaAdicionales = $derived((adicionales ?? []).length);

	/**
	 * Items QUITADOS del cierre.
	 *
	 * Se piden aparte porque `detallePeriodo` los filtra: llevan `deleted_at`
	 * y para el resto de la aplicación no existen. Esta lista es la única
	 * forma de devolverlos — antes, quitar un item era irreversible desde
	 * cualquier interfaz.
	 */
	let quitados = $state<Array<{ id: string; cliente: string; recorrido: string; valor: number }>>(
		[]
	);
	let cargandoQuitados = $state(false);

	async function cargarQuitados() {
		cargandoQuitados = true;
		try {
			const r: any = await liquidacionesTercerosDescuentosAPI.obtenerPorId(cierreId, {
				includeDeleted: true
			});
			quitados = ((r?.items ?? []) as any[])
				.filter((i) => i.deleted_at && i.liquidacion_tercero)
				.map((i) => ({
					id: i.id,
					cliente: i.liquidacion_tercero?.liquidacion?.cliente?.nombre ?? '',
					recorrido: i.liquidacion_tercero?.recorrido ?? '',
					valor: Number(i.liquidacion_tercero?.valor_liquidar ?? 0)
				}));
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'No se pudieron leer los items quitados';
		} finally {
			cargandoQuitados = false;
		}
	}

	async function quitarItem(it: ItemCierre) {
		if (trabajando) return;
		trabajando = true;
		error = '';
		try {
			await liquidacionesTercerosDescuentosAPI.toggleExcluirItem(it.pivoteId, true);
			await onCambiado({ accion: 'remove', concepto: it.recorrido || 'item' });
			await cargarQuitados();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	async function devolverItem(q: { id: string; recorrido: string }) {
		if (trabajando) return;
		trabajando = true;
		error = '';
		try {
			await liquidacionesTercerosDescuentosAPI.toggleExcluirItem(q.id, false);
			await onCambiado({ accion: 'add', concepto: q.recorrido || 'item' });
			await cargarQuitados();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	function irASeccion(s: Seccion) {
		seccion = s;
		if (s === 'ITEM' && quitados.length === 0 && !cargandoQuitados) void cargarQuitados();
	}

	const nombreNormalizado = $derived(nombre.trim().toUpperCase().replace(/\s+/g, '_'));
	/// Dos gastos con el mismo nombre serían indistinguibles en la hoja. Los
	/// ADICIONALES sí pueden repetirse: son servicios distintos y se
	/// distinguen por recorrido y fechas.
	const yaExiste = $derived(
		seccion !== 'ADICIONAL' && filas.some((c) => c.concepto === nombreNormalizado)
	);
	const puedeAgregar = $derived(
		trabajando
			? false
			: seccion === 'ADICIONAL'
				? !!recorrido.trim() && Number(valorUnitario) > 0
				: !!nombreNormalizado && !yaExiste
	);

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	/**
	 * Alta de un ADICIONAL.
	 *
	 * Es un item de liquidación que no viene de ninguna `liquidacion_servicio`:
	 * por eso no lleva número de liquidación. El cliente es COTRANSMEQ, la
	 * placa y el tercero se heredan del cierre, y el usuario diligencia el
	 * recorrido, las fechas y los importes.
	 *
	 * ADMON $ y V/LIQUIDAR los deriva el SERVIDOR (`derivarAdicional`), igual
	 * que en las celdas de la hoja: no se calculan aquí para que no haya dos
	 * aritméticas que puedan discrepar.
	 */
	async function agregarAdicional() {
		await liquidacionesTercerosAdicionalesAPI.crear({
			cierre_id: cierreId,
			cliente: 'COTRANSMEQ',
			placa,
			tercero_nombre: terceroNombre ?? null,
			recorrido: recorrido.trim(),
			fechas: fecha.trim() || null,
			valor_unitario: Number(valorUnitario) || 0,
			cantidad: Number(cantidad) || 1,
			porcentaje_admin: Number(pctAdmon) || 0
		});
	}

	async function agregar() {
		if (!puedeAgregar) return;
		trabajando = true;
		error = '';
		try {
			if (seccion === 'ADICIONAL') {
				const desc = recorrido.trim();
				await agregarAdicional();
				recorrido = '';
				fecha = '';
				cantidad = 1;
				valorUnitario = 0;
				await onCambiado({ accion: 'add', concepto: desc });
				return;
			}
			await liquidacionesTercerosDescuentosAPI.agregarConceptoFila(cierreId, {
				tipo: seccion,
				concepto: nombreNormalizado,
				// Un ANTICIPO no tiene cantidad: la hoja pinta CONCEPTO, FECHA y
				// VALOR, así que su total ES su valor. Se fija a 1 y no se
				// arrastra lo que quedara en el campo del formulario de gastos,
				// que multiplicaría el anticipo por tres sin que se viera dónde.
				dias: seccion === 'ANTICIPO' ? 1 : Number(cantidad) || 0,
				valor_unitario: Number(valorUnitario) || 0,
				observaciones: seccion === 'ANTICIPO' ? fecha.trim() || null : null
			});
			const creado = nombreNormalizado;
			nombre = '';
			cantidad = 1;
			valorUnitario = 0;
			fecha = '';
			await onCambiado({ accion: 'add', concepto: creado });
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			// A diferencia del modal de conductores, este NO se cierra al
			// guardar: los gastos se suelen meter en tanda y cerrarlo obligaría
			// a reabrirlo por cada fila. Por eso hay que devolverlo a estado
			// operativo pase lo que pase.
			trabajando = false;
		}
	}

	async function quitarAdicional(a: AdicionalCierre) {
		if (trabajando || !a.id) return;
		trabajando = true;
		error = '';
		try {
			await liquidacionesTercerosAdicionalesAPI.eliminar(a.id);
			await onCambiado({ accion: 'remove', concepto: a.recorrido || 'adicional' });
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	async function quitar(c: ConceptoDescuento) {
		if (trabajando || !c.id) return;
		trabajando = true;
		error = '';
		try {
			await liquidacionesTercerosDescuentosAPI.eliminarConceptoFila(c.id);
			await onCambiado({ accion: 'remove', concepto: c.concepto });
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	function alTeclado(e: KeyboardEvent) {
		if (e.key === 'Escape' && !trabajando) onClose();
	}
</script>

<svelte:window onkeydown={alTeclado} />

<div class="cxm-backdrop">
	<div class="cxm" role="dialog" aria-modal="true" aria-labelledby="cxm-titulo">
		<div class="cxm-head">
			<div>
				<h2 id="cxm-titulo">Conceptos de {placa}</h2>
				<p class="cxm-sub">
					{periodo} · añadir o quitar filas de gastos, anticipos y adicionales
				</p>
			</div>
			<button class="cxm-x" onclick={onClose} disabled={trabajando} aria-label="Cerrar">×</button>
		</div>

		<div class="cxm-tabs" role="tablist">
			<button
				role="tab"
				aria-selected={seccion === 'GASTO_OPERATIVO'}
				class:cxm-tab-on={seccion === 'GASTO_OPERATIVO'}
				onclick={() => irASeccion('GASTO_OPERATIVO')}
				disabled={trabajando}
			>
				Gastos de vehículo
				<span class="cxm-cuenta">{cuentaGastos}</span>
			</button>
			<button
				role="tab"
				aria-selected={seccion === 'ANTICIPO'}
				class:cxm-tab-on={seccion === 'ANTICIPO'}
				onclick={() => irASeccion('ANTICIPO')}
				disabled={trabajando}
			>
				Anticipos
				<span class="cxm-cuenta">{cuentaAnticipos}</span>
			</button>
			<button
				role="tab"
				aria-selected={seccion === 'ADICIONAL'}
				class:cxm-tab-on={seccion === 'ADICIONAL'}
				onclick={() => irASeccion('ADICIONAL')}
				disabled={trabajando}
			>
				Adicionales
				<span class="cxm-cuenta">{cuentaAdicionales}</span>
			</button>
			<button
				role="tab"
				aria-selected={seccion === 'ITEM'}
				class:cxm-tab-on={seccion === 'ITEM'}
				onclick={() => irASeccion('ITEM')}
				disabled={trabajando}
			>
				Items
				<span class="cxm-cuenta">{(items ?? []).length}</span>
			</button>
		</div>

		<div class="cxm-body">
			{#if seccion === 'ITEM'}
				<table class="cxm-tabla">
					<thead>
						<tr>
							<th>Cliente</th>
							<th>Recorrido</th>
							<th class="cxm-num">V/liquidar</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each items ?? [] as it (it.pivoteId)}
							<tr>
								<td>{it.cliente_nombre || '—'}</td>
								<td>{it.recorrido || '—'}</td>
								<td class="cxm-num cxm-total">${formatCOP(Number(it.valor_liquidar))}</td>
								<td class="cxm-num">
									<button
										class="cxm-quitar"
										onclick={() => quitarItem(it)}
										disabled={trabajando}
										title="Quitar del cierre. Deja de contar en el valor a liquidar y se podrá devolver desde aquí."
										aria-label="Quitar item"
									>×</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<h4 class="cxm-sub2">
					Quitados del cierre
					{#if cargandoQuitados}<span class="cxm-nota">· leyendo…</span>{/if}
				</h4>
				{#if quitados.length === 0}
					<p class="cxm-vacio">
						Ninguno. Un item quitado deja de sumar al valor a liquidar y de la hoja
						desaparece su fila; aquí es donde se devuelve.
					</p>
				{:else}
					<table class="cxm-tabla">
						<tbody>
							{#each quitados as q (q.id)}
								<tr>
									<td>{q.cliente || '—'}</td>
									<td>{q.recorrido || '—'}</td>
									<td class="cxm-num">${formatCOP(q.valor)}</td>
									<td class="cxm-num">
										<button
											class="cxm-devolver"
											onclick={() => devolverItem(q)}
											disabled={trabajando}
										>Devolver</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{:else if seccion === 'ADICIONAL'}
				{#if (adicionales ?? []).length === 0}
					<p class="cxm-vacio">
						Sin adicionales. Son items de liquidación para COTRANSMEQ que no
						vienen de ninguna liquidación de servicio —por eso no llevan
						número—, sobre la misma placa y el mismo tercero.
					</p>
				{:else}
					<table class="cxm-tabla">
						<thead>
							<tr>
								<th>Recorrido</th>
								<th>Fechas</th>
								<th class="cxm-num">V/unidad</th>
								<th class="cxm-num">Cant</th>
								<th class="cxm-num">Admon $</th>
								<th class="cxm-num">V/liquidar</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each adicionales as a (a.id)}
								<tr>
									<td>{a.recorrido || '—'}</td>
									<td>{a.fechas || '—'}</td>
									<td class="cxm-num">${formatCOP(Number(a.valor_unitario))}</td>
									<td class="cxm-num">{a.cantidad}</td>
									<td class="cxm-num">${formatCOP(Number(a.valor_admin))}</td>
									<td class="cxm-num cxm-total">${formatCOP(Number(a.valor_liquidar))}</td>
									<td class="cxm-num">
										<button
											class="cxm-quitar"
											onclick={() => quitarAdicional(a)}
											disabled={trabajando}
											aria-label="Quitar adicional"
										>×</button>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td colspan="5">Total adicionales</td>
								<td class="cxm-num cxm-total">${formatCOP(total)}</td>
								<td></td>
							</tr>
						</tfoot>
					</table>
				{/if}
			{:else if filas.length === 0}
				<p class="cxm-vacio">
					{seccion === 'ANTICIPO'
						? 'Sin anticipos. Añade el primero abajo.'
						: 'Sin gastos. Añade el primero abajo.'}
				</p>
			{:else}
				<table class="cxm-tabla">
					<thead>
						<tr>
							<th>Concepto</th>
							<th class="cxm-num">{seccion === 'ANTICIPO' ? 'Fecha' : 'Cantidad'}</th>
							<th class="cxm-num">Valor</th>
							<th class="cxm-num">Total</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each filas as c (c.id ?? c.concepto)}
							{@const auto = AUTOMATICOS.has(c.concepto)}
							<tr>
								<td>
									{etiqueta(c.concepto)}
									{#if auto}<span class="cxm-auto">automático</span>{/if}
								</td>
								<td class="cxm-num">
									{seccion === 'ANTICIPO' ? (c.observaciones || '—') : (c.dias ?? 0)}
								</td>
								<td class="cxm-num">${formatCOP(Number(c.valor_unitario))}</td>
								<td class="cxm-num cxm-total">${formatCOP(Number(c.valor_total))}</td>
								<td class="cxm-num">
									<button
										class="cxm-quitar"
										onclick={() => quitar(c)}
										disabled={trabajando || auto}
										title={auto
											? 'Se calcula solo a partir de los días de los conductores o del facturado; no se puede quitar.'
											: `Quitar ${etiqueta(c.concepto)}`}
										aria-label="Quitar {etiqueta(c.concepto)}"
									>×</button>
								</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td colspan="3">Total</td>
							<td class="cxm-num cxm-total">${formatCOP(total)}</td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			{/if}
		</div>

		<!-- Los items NO se añaden a mano: vienen de las liquidaciones de
		     servicio del mes. Aquí solo se quitan y se devuelven. -->
		{#if seccion !== 'ITEM'}
		<div class="cxm-alta">
			<h3>Añadir fila</h3>
			<div class="cxm-campos">
				{#if seccion === 'ADICIONAL'}
					<label class="cxm-crece">
						<span>Recorrido</span>
						<input
							type="text"
							bind:value={recorrido}
							placeholder="YOPAL - AGUAZUL"
							disabled={trabajando}
						/>
					</label>
					<label>
						<span>Fechas</span>
						<input type="text" bind:value={fecha} placeholder="12 AGO" disabled={trabajando} />
					</label>
					<label>
						<span>V/unidad</span>
						<input type="number" min="0" step="1000" bind:value={valorUnitario} disabled={trabajando} />
					</label>
					<label class="cxm-corto">
						<span>Cant</span>
						<input type="number" min="0" step="1" bind:value={cantidad} disabled={trabajando} />
					</label>
					<label class="cxm-corto">
						<span>Admon %</span>
						<input type="number" min="0" step="0.5" bind:value={pctAdmon} disabled={trabajando} />
					</label>
				{:else}
					<label class="cxm-crece">
						<span>Concepto</span>
						<input
							type="text"
							bind:value={nombre}
							placeholder={seccion === 'ANTICIPO' ? 'ANTICIPO NÓMINA' : 'PEAJES'}
							disabled={trabajando}
						/>
					</label>

					{#if seccion === 'ANTICIPO'}
						<label>
							<span>Fecha</span>
							<input type="text" bind:value={fecha} placeholder="15 AGO" disabled={trabajando} />
						</label>
					{:else}
						<label class="cxm-corto">
							<span>Cantidad</span>
							<input type="number" min="0" step="0.5" bind:value={cantidad} disabled={trabajando} />
						</label>
					{/if}

					<label>
						<span>Valor unitario</span>
						<input type="number" min="0" step="1000" bind:value={valorUnitario} disabled={trabajando} />
					</label>
				{/if}

				<button class="cxm-add" onclick={agregar} disabled={!puedeAgregar}>
					{trabajando ? '…' : '+ Añadir'}
				</button>
			</div>

			{#if yaExiste}
				<p class="cxm-aviso">
					{etiqueta(nombreNormalizado)} ya está en esta sección. Edita su valor en la hoja.
				</p>
			{:else if nombreNormalizado && nombreNormalizado !== nombre.trim()}
				<p class="cxm-aviso cxm-neutro">Se guardará como «{etiqueta(nombreNormalizado)}».</p>
			{/if}

			{#if error}<p class="cxm-error">{error}</p>{/if}

			{#if seccion === 'ADICIONAL'}
				<p class="cxm-nota">
					Cliente COTRANSMEQ y sin número de liquidación: el adicional no viene
					de ninguna liquidación de servicio. Placa y tercero se heredan del
					cierre. ADMON $ y V/LIQUIDAR los calcula el servidor.
				</p>
			{:else}
				<p class="cxm-nota">
					Los impuestos no se añaden aquí: se regeneran solos con los porcentajes de
					configuración, así que una fila puesta a mano se perdería en el siguiente
					recálculo.
				</p>
			{/if}
		</div>
		{:else if error}
			<p class="cxm-error cxm-error-suelto">{error}</p>
		{/if}

		<div class="cxm-foot">
			<button class="cxm-btn-ghost" onclick={onClose} disabled={trabajando}>Cerrar</button>
		</div>
	</div>
</div>

<style>
	.cxm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}
	.cxm {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 660px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.cxm-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
	}
	.cxm-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.cxm-sub {
		margin: 3px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.cxm-x {
		border: none;
		background: transparent;
		font-size: 22px;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}

	.cxm-tabs {
		display: flex;
		gap: 2px;
		padding: 0 20px;
		border-bottom: 1px solid #e2e8f0;
	}
	.cxm-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: none;
		background: transparent;
		padding: 9px 14px;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		color: #64748b;
		cursor: pointer;
		/* 3px, no 2: con 2 la línea se comía casi entera contra el borde del
		   contenedor y la pestaña activa no se distinguía de un vistazo. */
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
		transition: color 0.12s, background 0.12s;
	}
	.cxm-tabs button:hover:not(:disabled) {
		color: #334155;
		background: #f8fafc;
	}
	/* `.cxm-tabs button.cxm-tab-on` y no `.cxm-tab-on` a secas: la regla de
	   arriba es clase + ELEMENTO, así que con la scoping de Svelte gana
	   (0,2,1) contra (0,2,0) y se llevaba por delante el color y el subrayado
	   del activo. La pestaña marcada se veía idéntica a la otra. */
	.cxm-tabs button.cxm-tab-on {
		color: #166534;
		font-weight: 700;
		background: #f0fdf4;
		border-bottom-color: #ea580c;
	}
	/* Contador por sección: refuerza dónde estás sin depender solo del color,
	   y de paso dice cuántas filas hay sin tener que cambiar de pestaña. */
	.cxm-tabs .cxm-cuenta {
		min-width: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: #e2e8f0;
		color: #475569;
		font-size: 10.5px;
		font-weight: 700;
		line-height: 17px;
		text-align: center;
	}
	.cxm-tabs button.cxm-tab-on .cxm-cuenta {
		background: #ea580c;
		color: #fff;
	}

	.cxm-body {
		padding: 14px 20px;
		overflow-y: auto;
		min-height: 0;
		flex: 1 1 auto;
	}

	.cxm-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.cxm-tabla th {
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 0 8px 6px;
		border-bottom: 1px solid #e2e8f0;
	}
	.cxm-tabla td {
		padding: 7px 8px;
		border-bottom: 1px solid #f1f5f9;
	}
	.cxm-num {
		text-align: right;
	}
	.cxm-total {
		font-weight: 700;
	}
	.cxm-tabla tfoot td {
		border-bottom: none;
		border-top: 2px solid #e2e8f0;
		font-weight: 700;
		color: #0f172a;
	}
	.cxm-auto {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #eff6ff;
		color: #1d4ed8;
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.cxm-quitar {
		border: none;
		background: transparent;
		color: #94a3b8;
		font-size: 17px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
	}
	.cxm-quitar:hover:not(:disabled) {
		color: #b91c1c;
	}
	.cxm-quitar:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.cxm-devolver {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: #fff;
		padding: 4px 10px;
		font-size: 11.5px;
		font-weight: 700;
		font-family: inherit;
		color: #c2410c;
		cursor: pointer;
		white-space: nowrap;
	}
	.cxm-devolver:hover:not(:disabled) {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.cxm-devolver:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.cxm-sub2 {
		margin: 16px 0 6px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #475569;
	}
	.cxm-error-suelto {
		padding: 0 20px 8px;
	}

	.cxm-alta {
		padding: 12px 20px 4px;
		border-top: 1px solid #e2e8f0;
		background: #f8fafc;
	}
	.cxm-alta h3 {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #475569;
	}
	.cxm-campos {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.cxm-campos label {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.cxm-crece {
		flex: 1 1 160px;
	}
	.cxm-corto input {
		width: 84px;
	}
	.cxm-campos span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}
	.cxm-campos input {
		padding: 6px 8px;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 13px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.cxm-add {
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
	.cxm-add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cxm-vacio {
		margin: 10px 2px;
		font-size: 12.5px;
		color: #64748b;
	}
	.cxm-aviso {
		margin: 8px 0 0;
		font-size: 11.5px;
		color: #b45309;
	}
	.cxm-neutro {
		color: #64748b;
	}
	.cxm-error {
		margin: 8px 0 0;
		font-size: 11.5px;
		font-weight: 600;
		color: #b91c1c;
	}
	.cxm-nota {
		margin: 10px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #64748b;
	}

	.cxm-foot {
		padding: 12px 20px 16px;
		display: flex;
		justify-content: flex-end;
	}
	.cxm-btn-ghost {
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
</style>
