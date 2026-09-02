<!--
	ModalFilasOcasional — alta y baja de las filas sueltas de la liquidación
	ocasional: GASTOS DE VEHÍCULO y ANTICIPOS, más los IMPUESTOS en lectura.

	Antes era `ModalGastosVehiculo` y solo sabía de gastos. Los anticipos ya
	restaban en TOTAL DESCUENTOS —el builder los sumaba— pero ninguna interfaz
	los creaba y ninguna sección los pintaba: eran un descuento que no existía.
	Ahora comparten modal porque comparten forma (concepto, cantidad, valor) y
	el mismo camino de guardado.

	LOS IMPUESTOS NO SE AÑADEN AQUÍ, y la pestaña lo dice en vez de esconderla:
	el builder REPINTA las cuatro filas estándar en cada montaje, así que una
	quinta puesta a mano duraría hasta el siguiente recálculo. Sus porcentajes
	se editan en la propia hoja. Mismo criterio que el modal de placas.

	POR QUÉ EXISTE: la tabla de gastos de la hoja pinta cinco filas fijas
	(DOTACIÓN, EXAMEN MÉDICO, COMBUSTIBLE, PAPELERÍA, GASTOS DIVERSOS) dentro de
	celdas combinadas. Un gasto puntual —unas llantas, su IVA, un anticipo de
	taller— no encaja en ninguna, y añadir la fila con el «insertar fila» de
	Univer no sirve: la fila nueva nace fuera de las combinaciones, sin binding a
	ningún concepto de la base, así que lo que se escriba ahí se descarta en
	silencio.

	Desde aquí la fila se crea como un `GASTO_OPERATIVO` de verdad, con id: el
	builder la pinta con la misma estructura que las fijas y sus celdas CANTIDAD
	y VALOR quedan bindeadas, así que a partir de ese momento se editan en la
	hoja como cualquier otra.

	El componente no persiste nada: emite `onAgregar` / `onEliminar` y es la
	page quien guarda y recarga el mes.
-->
<script lang="ts">
	import type { ConceptoOcasional } from '$lib/api/liquidaciones-terceros-ocasional';

	/// Las dos secciones que se pueden EDITAR desde aquí.
	type TipoFila = 'GASTO_OPERATIVO' | 'ANTICIPO';
	/// La tercera pestaña es de lectura: ver el docblock.
	type Seccion = TipoFila | 'IMPUESTO';

	interface NuevaFila {
		tipo: TipoFila;
		concepto: string;
		cantidad: number;
		valor_unitario: number;
		placa_aplicada: string | null;
		observaciones: string | null;
	}

	interface Props {
		open: boolean;
		mes: number;
		anio: number;
		/// Solo los gastos AÑADIDOS A MANO (las cinco filas fijas no se listan:
		/// no se pueden borrar ni renombrar).
		gastos: ConceptoOcasional[];
		/// Anticipos del mes. Todos son añadidos a mano: no hay filas fijas.
		anticipos?: ConceptoOcasional[];
		/// Las cuatro retenciones. Solo para mostrarlas y explicar dónde se tocan.
		impuestos?: ConceptoOcasional[];
		/// `true` mientras la page guarda: bloquea el formulario para que no se
		/// encolen dos altas contra el mismo estado.
		guardando?: boolean;
		onAgregar: (f: NuevaFila) => void;
		onEliminar: (id: string) => void;
		onClose: () => void;
	}

	let {
		open,
		mes,
		anio,
		gastos,
		anticipos = [],
		impuestos = [],
		guardando = false,
		onAgregar,
		onEliminar,
		onClose
	}: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];

	/// Nombres reservados: son las cinco filas fijas de la tabla. Reutilizar uno
	/// haría que la fila nueva se pintara en el hueco de la fija y que hubiera
	/// dos conceptos compitiendo por el mismo sitio.
	const FIJOS = new Set([
		'DOTACION',
		'EXAMEN_MEDICO',
		'COMBUSTIBLE',
		'PAPELERIA',
		'GASTOS_DIVERSOS'
	]);

	let seccion = $state<Seccion>('GASTO_OPERATIVO');
	/// Las que se pueden editar en la pestaña activa. En IMPUESTO no se usa.
	const filasDeSeccion = $derived(
		seccion === 'ANTICIPO' ? (anticipos ?? []) : (gastos ?? [])
	);

	let concepto = $state('');
	let cantidadTxt = $state('1');
	let valorTxt = $state('');
	let placa = $state('');
	let observaciones = $state('');
	let error = $state('');

	/**
	 * Lee un importe en pesos escrito como lo escribe el equipo.
	 *
	 * En COP el punto y la coma son separadores de MILES: «439.555» son
	 * cuatrocientos treinta y nueve mil quinientos cincuenta y cinco, no
	 * cuatrocientos treinta y nueve con medio. `Number('439.555')` daría 439.555
	 * y se guardarían $440 en vez de $439.555.
	 */
	function pesosDeTexto(txt: string): number | null {
		// `\s` no cubre el espacio duro ni el fino, que es justo lo que pega un
		// copiar-pegar desde Excel.
		const limpio = String(txt ?? '')
			.replace(/[$\s\u00a0\u2009]/g, '')
			.trim();
		if (!limpio) return null;
		const soloGrupos = /^-?\d{1,3}([.,]\d{3})+$/.test(limpio);
		const normalizado = soloGrupos
			? limpio.replace(/[.,]/g, '')
			: limpio.replace(',', '.');
		if (!/^-?\d*\.?\d+$/.test(normalizado)) return null;
		const n = Number(normalizado);
		return Number.isFinite(n) ? n : null;
	}

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	/// Normaliza para comparar con los nombres fijos y con los ya existentes:
	/// sin tildes, en mayúsculas y con los espacios convertidos en guion bajo.
	function claveDe(txt: string): string {
		return txt
			.trim()
			.toUpperCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, '_');
	}

	let cantidad = $derived(pesosDeTexto(cantidadTxt) ?? 0);
	let valorUnitario = $derived(pesosDeTexto(valorTxt) ?? 0);
	let totalPrevio = $derived(cantidad * valorUnitario);

	function limpiar() {
		concepto = '';
		cantidadTxt = '1';
		valorTxt = '';
		placa = '';
		observaciones = '';
		error = '';
	}

	function agregar() {
		error = '';
		const nombre = concepto.trim();
		if (!nombre) {
			error = `Escribe la descripción ${seccion === 'ANTICIPO' ? 'del anticipo' : 'del gasto'}.`;
			return;
		}
		// La columna es `VarChar(100)`: pasarse haría fallar el guardado entero
		// de la hoja, no solo esta fila.
		if (nombre.length > 100) {
			error = `La descripción no puede pasar de 100 caracteres (van ${nombre.length}). Lo que sobre ponlo en observaciones.`;
			return;
		}
		// Las cinco fijas solo colisionan en GASTOS: la tabla de anticipos no
		// tiene filas fijas con las que chocar.
		if (seccion === 'GASTO_OPERATIVO' && FIJOS.has(claveDe(nombre))) {
			error = 'Ese nombre es el de una de las filas fijas de la tabla. Usa esa fila o escribe otra descripción.';
			return;
		}
		if (filasDeSeccion.some((g) => claveDe(String(g.concepto)) === claveDe(nombre))) {
			error = `Ya hay ${seccion === 'ANTICIPO' ? 'un anticipo' : 'un gasto'} con esa descripción en este mes.`;
			return;
		}
		if (pesosDeTexto(cantidadTxt) == null || cantidad <= 0) {
			error = 'La cantidad tiene que ser un número mayor que cero.';
			return;
		}
		if (pesosDeTexto(valorTxt) == null) {
			error = `Escribe el valor ${seccion === 'ANTICIPO' ? 'del anticipo' : 'del gasto'}.`;
			return;
		}

		onAgregar({
			tipo: seccion as TipoFila,
			concepto: nombre,
			cantidad,
			valor_unitario: valorUnitario,
			placa_aplicada: placa.trim().toUpperCase() || null,
			observaciones: observaciones.trim() || null
		});
		limpiar();
	}

	function eliminar(g: ConceptoOcasional) {
		if (!g.id) return;
		if (!confirm(`¿Eliminar «${g.concepto}» de los gastos de ${MESES[mes - 1]} ${anio}?`)) {
			return;
		}
		onEliminar(g.id);
	}

	function totalDe(g: ConceptoOcasional): number {
		const t = Number(g.valor_total);
		if (t) return t;
		return (Number(g.dias) || 0) * (Number(g.valor_unitario) || 0);
	}

	let totalSeccion = $derived(filasDeSeccion.reduce((s, g) => s + totalDe(g), 0));
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="gv-backdrop"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
	>
		<div class="gv-modal" role="dialog" aria-modal="true" aria-label="Filas del ocasional">
			<header class="gv-header">
				<div>
					<h2>Filas de {MESES[mes - 1]} {anio}</h2>
					<p>Añadir o quitar gastos de vehículo, anticipos e impuestos</p>
				</div>
				<button class="gv-btn" onclick={onClose} aria-label="Cerrar">✕</button>
			</header>

			<div class="gv-tabs" role="tablist">
				<button
					role="tab"
					aria-selected={seccion === 'GASTO_OPERATIVO'}
					class:gv-tab-on={seccion === 'GASTO_OPERATIVO'}
					onclick={() => { seccion = 'GASTO_OPERATIVO'; error = ''; }}
					disabled={guardando}
				>
					Gastos de vehículo
					<span class="gv-cuenta">{(gastos ?? []).length}</span>
				</button>
				<button
					role="tab"
					aria-selected={seccion === 'ANTICIPO'}
					class:gv-tab-on={seccion === 'ANTICIPO'}
					onclick={() => { seccion = 'ANTICIPO'; error = ''; }}
					disabled={guardando}
				>
					Anticipos
					<span class="gv-cuenta">{(anticipos ?? []).length}</span>
				</button>
				<button
					role="tab"
					aria-selected={seccion === 'IMPUESTO'}
					class:gv-tab-on={seccion === 'IMPUESTO'}
					onclick={() => { seccion = 'IMPUESTO'; error = ''; }}
					disabled={guardando}
				>
					Impuestos
					<span class="gv-cuenta">{(impuestos ?? []).length}</span>
				</button>
			</div>

			<div class="gv-body">
				{#if seccion === 'IMPUESTO'}
					<section class="gv-lista">
						<p class="gv-nota-imp">
							Las cuatro retenciones se repintan solas en cada montaje de la hoja, así que
							una quinta puesta aquí duraría hasta el siguiente recálculo. Sus
							<strong>porcentajes se editan en la propia hoja</strong>, en la columna
							PORCENTAJE del bloque IMPUESTOS Y RETENCIONES.
						</p>
						{#if (impuestos ?? []).length === 0}
							<p class="gv-vacio">Este mes todavía no tiene impuestos calculados.</p>
						{:else}
							<table class="gv-tabla">
								<thead>
									<tr>
										<th>Concepto</th>
										<th class="gv-num">%</th>
										<th class="gv-num">Base</th>
										<th class="gv-num">Valor</th>
									</tr>
								</thead>
								<tbody>
									{#each impuestos ?? [] as imp (imp.id)}
										<tr>
											<td>{String(imp.concepto).replace(/_/g, ' ')}</td>
											<td class="gv-num">{Number(imp.porcentaje) || 0}%</td>
											<td class="gv-num">${formatCOP(Number(imp.base_calculo) || 0)}</td>
											<td class="gv-num">${formatCOP(Number(imp.valor_total) || 0)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</section>
				{:else}
				<section class="gv-form">
					<label class="gv-field gv-field-wide">
						<span>Descripción</span>
						<input
							bind:value={concepto}
							maxlength="100"
							placeholder="Ej. FEOL7850 compra de llantas austone 195/55r16 sp401 veh LZQ-974"
							disabled={guardando}
							onkeydown={(e) => {
								if (e.key === 'Enter') agregar();
							}}
						/>
						<small>{concepto.trim().length}/100</small>
					</label>

					<label class="gv-field gv-field-sm">
						<span>Cantidad</span>
						<input bind:value={cantidadTxt} inputmode="decimal" disabled={guardando} />
					</label>

					<label class="gv-field">
						<span>Valor unitario</span>
						<input
							bind:value={valorTxt}
							inputmode="decimal"
							placeholder="439.555"
							disabled={guardando}
							onkeydown={(e) => {
								if (e.key === 'Enter') agregar();
							}}
						/>
					</label>

					<label class="gv-field gv-field-sm">
						<span>Placa <em>(opcional)</em></span>
						<input bind:value={placa} maxlength="20" placeholder="LZQ-974" disabled={guardando} />
					</label>

					<label class="gv-field gv-field-wide">
						<span>Observaciones <em>(opcional)</em></span>
						<input
							bind:value={observaciones}
							placeholder="Detalle que no cabe en la descripción"
							disabled={guardando}
						/>
					</label>

					<div class="gv-form-foot">
						<span class="gv-preview">
							Total de esta fila: <strong>${formatCOP(totalPrevio)}</strong>
						</span>
						<button class="gv-btn gv-btn-primary" onclick={agregar} disabled={guardando}>
							{guardando
								? 'Guardando…'
								: seccion === 'ANTICIPO'
									? 'Agregar anticipo'
									: 'Agregar gasto'}
						</button>
					</div>

					{#if error}
						<p class="gv-error">{error}</p>
					{/if}
				</section>

				<section class="gv-lista">
					<h3>
						{seccion === 'ANTICIPO' ? 'Anticipos de este mes' : 'Gastos añadidos en este mes'}
					</h3>
					{#if filasDeSeccion.length === 0}
						<p class="gv-vacio">
							{#if seccion === 'ANTICIPO'}
								Todavía no hay ninguno. Los que agregues abren el bloque ANTICIPOS al final de
								la hoja —si el mes no tiene ninguno, ese bloque no se pinta— y restan del
								TOTAL DESCUENTOS.
							{:else}
								Todavía no hay ninguno. Los que agregues aparecen como filas nuevas al final de
								«GASTOS DE VEHÍCULO», y su cantidad y su valor se editan directamente en la hoja.
							{/if}
						</p>
					{:else}
						<table class="gv-tabla">
							<thead>
								<tr>
									<th>Descripción</th>
									<th class="gv-num">Cant.</th>
									<th class="gv-num">Valor</th>
									<th class="gv-num">Total</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each filasDeSeccion as g (g.id)}
									<tr>
										<td>
											{g.concepto}
											{#if g.placa_aplicada}<span class="gv-placa">{g.placa_aplicada}</span>{/if}
										</td>
										<td class="gv-num">{Number(g.dias) || 0}</td>
										<td class="gv-num">${formatCOP(Number(g.valor_unitario) || 0)}</td>
										<td class="gv-num">${formatCOP(totalDe(g))}</td>
										<td class="gv-num">
											<button
												class="gv-btn gv-btn-danger"
												onclick={() => eliminar(g)}
												disabled={guardando}
												title={seccion === 'ANTICIPO' ? 'Eliminar este anticipo' : 'Eliminar este gasto'}
											>
												Eliminar
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td colspan="3">
										{seccion === 'ANTICIPO' ? 'Suma de los anticipos' : 'Suma de los gastos añadidos'}
									</td>
									<td class="gv-num"><strong>${formatCOP(totalSeccion)}</strong></td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					{/if}
				</section>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.gv-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9600;
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.gv-modal {
		width: min(880px, 100%);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.gv-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}
	.gv-header h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #0f172a;
	}
	.gv-header p {
		margin: 2px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.gv-tabs {
		display: flex;
		gap: 2px;
		padding: 0 20px;
		border-bottom: 1px solid #e2e8f0;
	}
	.gv-tabs button {
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
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.gv-tabs button:hover:not(:disabled) {
		color: #334155;
		background: #f8fafc;
	}
	/* Clase + ELEMENTO, no la clase sola: la regla de arriba es (0,2,1) y con
	   el scoping de Svelte se llevaría por delante el color del activo. Mismo
	   tropiezo que ya hubo en el modal de conceptos de placas. */
	.gv-tabs button.gv-tab-on {
		color: #166534;
		font-weight: 700;
		background: #f0fdf4;
		border-bottom-color: #ea580c;
	}
	.gv-tabs .gv-cuenta {
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
	.gv-tabs button.gv-tab-on .gv-cuenta {
		background: #ea580c;
		color: #fff;
	}
	.gv-nota-imp {
		margin: 0 0 12px;
		padding: 10px 12px;
		border-radius: 8px;
		background: #fffbeb;
		color: #92400e;
		font-size: 12px;
		line-height: 1.5;
	}

	.gv-body {
		overflow-y: auto;
		padding: 16px 20px 20px;
	}

	.gv-form {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		padding-bottom: 16px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}
	.gv-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.gv-field-wide {
		grid-column: 1 / -1;
	}
	.gv-field-sm {
		max-width: 100%;
	}
	.gv-field span {
		font-size: 11px;
		font-weight: 600;
		color: #334155;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.gv-field em {
		font-style: normal;
		font-weight: 400;
		color: #94a3b8;
		text-transform: none;
	}
	.gv-field input {
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		color: #0f172a;
		background: #fff;
	}
	.gv-field input:focus {
		outline: 2px solid rgba(22, 101, 52, 0.35);
		outline-offset: -1px;
	}
	.gv-field small {
		font-size: 10px;
		color: #94a3b8;
		align-self: flex-end;
	}
	.gv-form-foot {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.gv-preview {
		font-size: 12px;
		color: #475569;
	}
	.gv-error {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 12px;
		color: #b91c1c;
	}

	.gv-lista h3 {
		margin: 16px 0 8px;
		font-size: 13px;
		font-weight: 700;
		color: #0f172a;
	}
	.gv-vacio {
		margin: 0;
		font-size: 12px;
		color: #64748b;
		line-height: 1.5;
	}
	.gv-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.gv-tabla th,
	.gv-tabla td {
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		padding: 8px 6px;
		text-align: left;
		color: #0f172a;
		vertical-align: top;
	}
	.gv-tabla th {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #475569;
	}
	.gv-tabla .gv-num {
		text-align: right;
		white-space: nowrap;
	}
	.gv-tabla tfoot td {
		border-bottom: none;
		color: #475569;
	}
	.gv-placa {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #f1f5f9;
		color: #475569;
		font-size: 10px;
		font-weight: 600;
	}

	.gv-btn {
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: #fff;
		border-radius: 8px;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
	}
	.gv-btn:hover:not(:disabled) {
		background: #f8fafc;
	}
	.gv-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.gv-btn-primary {
		background: #166534;
		border-color: #166534;
		color: #fff;
	}
	.gv-btn-primary:hover:not(:disabled) {
		background: #14532d;
	}
	.gv-btn-danger {
		color: #b91c1c;
		border-color: rgba(185, 28, 28, 0.35);
	}
	.gv-btn-danger:hover:not(:disabled) {
		background: #fef2f2;
	}
</style>
