<!--
	ModalFilasIngresos — alta y baja de las filas del PIE de una hoja del canvas
	de ingresos: gastos de vehículo, anticipos y, en la de adicionales, las
	retenciones.

	POR QUÉ EXISTE. El pie abre un número FIJO de filas libres —PAPELERIA más
	cuatro «GASTO n», OTROS_ANTICIPOS más dos «ANTICIPO n»— y se editan muy bien
	en la propia hoja mientras alcancen. El problema es cuando no alcanzan: un
	quinto gasto en la hoja de adicionales no tenía dónde ir, y añadir la fila
	con el «insertar fila» de Univer no sirve —nace sin concepto en la base, sin
	binding, y lo que se escriba ahí se descarta en silencio—.

	Desde aquí la fila nace con id propio, así que el builder la pinta en su
	bloque con el resto y sus celdas quedan bindeadas: a partir de ese momento se
	edita en la hoja como cualquier otra.

	TODO SE EDITA DESDE AQUÍ: nombre, valor y —en las retenciones— porcentaje.
	Se puede hacer también en la hoja, celda a celda; el modal existe para verlo
	todo junto y para las filas que la hoja no deja crear.

	QUITAR SIGNIFICA DOS COSAS DISTINTAS y por eso el botón cambia de nombre.
	Una fila AÑADIDA a mano se borra de verdad. Una fila DEL PIE no se puede
	borrar —`ensureConceptosIngresos` la repone en la siguiente lectura, así que
	un botón «Quitar» sobre ella mentiría—: lo que se hace es VACIARLA, que la
	devuelve a su nombre de fábrica y a cero. Entonces `conceptosParaGuardar` la
	descarta y vuelve a ser lo que era, una fila libre del formato esperando a
	que alguien escriba en ella.

	LOS IMPUESTOS SÍ SE PUEDEN AÑADIR AQUÍ, al revés que en placas y ocasionales.
	En aquellos el backend REGENERA las cuatro retenciones en cada recálculo y
	una quinta no sobreviviría; este canvas no recalcula nada por su cuenta, y
	`conceptosParaGuardar` conserva expresamente lo que no corresponde a ninguna
	semilla.

	El componente no persiste nada: emite `onAgregar` / `onEliminar` y es la page
	quien guarda y recarga el mes.
-->
<script lang="ts">
	import type {
		ConceptoIngreso,
		HojaIngreso
	} from '$lib/api/liquidaciones-terceros-ingresos';

	/// Los tres bloques del pie. IMPUESTO solo existe en la hoja de adicionales.
	type TipoFila = 'GASTO_OPERATIVO' | 'ANTICIPO' | 'IMPUESTO';

	interface NuevaFilaIngreso {
		hoja: HojaIngreso;
		tipo: TipoFila;
		concepto: string;
		valor_total: number;
		/// Solo en IMPUESTO. Las retenciones se liquidan por porcentaje sobre la
		/// base imponible, no por un importe escrito a mano.
		porcentaje: number | null;
	}

	interface Props {
		open: boolean;
		/// La hoja que está en pantalla. El pie es DE LA HOJA: cada una tiene sus
		/// gastos y sus anticipos, y sumarlos sería contarlos dos veces.
		hoja: HojaIngreso;
		periodo: string;
		/// Conceptos del mes YA SEMBRADOS, de las dos hojas. El modal filtra.
		conceptos: ConceptoIngreso[];
		/// Ids de las filas que abre el pie por sí solo.
		sembrados: Set<string>;
		guardando?: boolean;
		onAgregar: (f: NuevaFilaIngreso) => void;
		onEliminar: (id: string) => void;
		/// Cambio en una fila que ya existe. La page lo aplica sobre el estado y
		/// deja que el autoguardado lo lleve.
		onEditar: (id: string, cambios: Partial<ConceptoIngreso>) => void;
		/// Devuelve una fila del pie a su nombre de fábrica y a cero.
		onVaciar: (id: string) => void;
		onClose: () => void;
	}

	let {
		open,
		hoja,
		periodo,
		conceptos,
		sembrados,
		guardando = false,
		onAgregar,
		onEliminar,
		onEditar,
		onVaciar,
		onClose
	}: Props = $props();

	const ETIQUETA: Record<TipoFila, string> = {
		GASTO_OPERATIVO: 'Gastos del vehículo',
		ANTICIPO: 'Anticipos',
		IMPUESTO: 'Impuestos y retenciones'
	};

	let seccion = $state<TipoFila>('GASTO_OPERATIVO');
	let concepto = $state('');
	let valorTxt = $state('');
	let pctTxt = $state('');
	let error = $state('');

	/// Las tres pestañas, o dos: la hoja de INGRESOS no retiene nada.
	const pestanas = $derived(
		(hoja === 'ADICIONALES'
			? ['GASTO_OPERATIVO', 'ANTICIPO', 'IMPUESTO']
			: ['GASTO_OPERATIVO', 'ANTICIPO']) as TipoFila[]
	);

	const filas = $derived(
		conceptos
			.filter((c) => c.hoja === hoja && c.tipo === seccion)
			.slice()
			.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
	);

	const total = $derived(filas.reduce((s, c) => s + (Number(c.valor_total) || 0), 0));
	const esSembrada = (c: ConceptoIngreso) => !!c.id && sembrados.has(c.id);

	/**
	 * Confirma la edición de una celda al salir de ella o con Enter, no en cada
	 * tecla: cada cambio marca el mes sucio y encola un guardado, y hacerlo por
	 * pulsación mandaría una petición por letra.
	 */
	function editarTexto(c: ConceptoIngreso, valor: string) {
		const nombre = valor.trim();
		if (!c.id || !nombre || nombre === c.concepto) return;
		if (nombre.length > 100) return;
		onEditar(c.id, { concepto: nombre });
	}

	function editarNumero(
		c: ConceptoIngreso,
		campo: 'valor_total' | 'porcentaje',
		valor: string
	) {
		if (!c.id) return;
		const n = numeroDeTexto(valor);
		if (n == null || n === Number(c[campo] ?? 0)) return;
		onEditar(c.id, { [campo]: n } as Partial<ConceptoIngreso>);
	}

	/**
	 * Al cambiar de hoja, una pestaña que ya no existe dejaría la lista vacía sin
	 * explicación. Volver a la primera es lo único que siempre está.
	 */
	$effect(() => {
		if (!pestanas.includes(seccion)) seccion = 'GASTO_OPERATIVO';
	});

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	/// Acepta «439.555», «439555» y «439,5». Devuelve `null` si no es un número.
	function numeroDeTexto(txt: string): number | null {
		const limpio = String(txt ?? '')
			.trim()
			.replace(/\s/g, '')
			.replace(/\./g, '')
			.replace(',', '.');
		if (limpio === '') return 0;
		const n = Number(limpio);
		return Number.isFinite(n) ? n : null;
	}

	const claveDe = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

	function limpiar() {
		concepto = '';
		valorTxt = '';
		pctTxt = '';
		error = '';
	}

	function agregar() {
		error = '';
		const nombre = concepto.trim();
		if (!nombre) {
			error = 'Escribe el nombre de la fila.';
			return;
		}
		// La columna es `VarChar(100)`: pasarse haría fallar el guardado del mes
		// entero, no solo esta fila.
		if (nombre.length > 100) {
			error = `El nombre no puede pasar de 100 caracteres (van ${nombre.length}).`;
			return;
		}
		if (filas.some((c) => claveDe(String(c.concepto)) === claveDe(nombre))) {
			error = `Ya hay una fila con ese nombre en ${ETIQUETA[seccion].toLowerCase()} de esta hoja.`;
			return;
		}
		const valor = numeroDeTexto(valorTxt);
		if (valor == null) {
			error = 'El valor tiene que ser un número.';
			return;
		}
		let pct: number | null = null;
		if (seccion === 'IMPUESTO') {
			pct = numeroDeTexto(pctTxt);
			if (pct == null) {
				error = 'El porcentaje tiene que ser un número.';
				return;
			}
		}
		onAgregar({ hoja, tipo: seccion, concepto: nombre, valor_total: valor, porcentaje: pct });
		limpiar();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fi-backdrop"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
	>
		<div class="fi-modal" role="dialog" aria-modal="true" aria-label="Filas del pie">
			<header class="fi-header">
				<div>
					<h2>Filas de {hoja === 'ADICIONALES' ? 'ADICIONALES' : 'OTROS INGRESOS'}</h2>
					<p>{periodo} · el pie de esta hoja. Cada hoja tiene el suyo.</p>
				</div>
				<button class="fi-x" onclick={onClose} aria-label="Cerrar">✕</button>
			</header>

			<div class="fi-tabs" role="tablist">
				{#each pestanas as t (t)}
					<button
						role="tab"
						aria-selected={seccion === t}
						class:fi-tab-on={seccion === t}
						onclick={() => {
							seccion = t;
							error = '';
						}}
						disabled={guardando}
					>
						{ETIQUETA[t]}
						<span class="fi-cuenta">
							{conceptos.filter((c) => c.hoja === hoja && c.tipo === t).length}
						</span>
					</button>
				{/each}
			</div>

			<div class="fi-body">
				<section class="fi-form">
					<label class="fi-field fi-crece">
						<span>Nombre de la fila</span>
						<input
							bind:value={concepto}
							maxlength="100"
							placeholder={seccion === 'IMPUESTO'
								? 'Ej. RETENCION CREE'
								: seccion === 'ANTICIPO'
									? 'Ej. ANTICIPO TALLER'
									: 'Ej. LAVADO Y ENGRASE'}
							disabled={guardando}
							onkeydown={(e) => {
								if (e.key === 'Enter') agregar();
							}}
						/>
					</label>

					{#if seccion === 'IMPUESTO'}
						<label class="fi-field fi-corto">
							<span>Porcentaje</span>
							<input bind:value={pctTxt} inputmode="decimal" placeholder="3.5" disabled={guardando} />
						</label>
					{/if}

					<label class="fi-field fi-corto">
						<span>Valor <em>(opcional)</em></span>
						<input
							bind:value={valorTxt}
							inputmode="decimal"
							placeholder="0"
							disabled={guardando}
							onkeydown={(e) => {
								if (e.key === 'Enter') agregar();
							}}
						/>
					</label>

					<button class="fi-add" onclick={agregar} disabled={guardando}>
						{guardando ? 'Guardando…' : 'Añadir fila'}
					</button>
				</section>

				<p class="fi-nota">
					{#if seccion === 'IMPUESTO'}
						El valor lo calcula la hoja aplicando el porcentaje a la base imponible; el que
						escribas aquí es solo el de arranque. Las cuatro retenciones estándar ya están:
						esto es para una quinta.
					{:else}
						El valor se puede dejar en cero y escribirlo después. Una fila que se quede a
						cero y con su nombre de fábrica no se guarda.
					{/if}
				</p>

				{#if error}
					<p class="fi-error">{error}</p>
				{/if}

				<table class="fi-tabla">
					<thead>
						<tr>
							<th>Concepto</th>
							{#if seccion === 'IMPUESTO'}<th class="fi-num">%</th>{/if}
							<th class="fi-num">Valor</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each filas as c (c.id)}
							<tr>
								<td>
									<input
										class="fi-edit fi-edit-txt"
										value={String(c.concepto).replace(/_/g, ' ')}
										maxlength="100"
										disabled={guardando}
										aria-label="Nombre de la fila"
										onblur={(e) => editarTexto(c, e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') e.currentTarget.blur();
										}}
									/>
									{#if esSembrada(c)}
										<span
											class="fi-fija"
											title="Fila que el pie abre por sí solo. Se edita, pero no se borra: reaparecería en la siguiente lectura. «Vaciar» la devuelve a su nombre y a cero."
										>del pie</span>
									{/if}
								</td>
								{#if seccion === 'IMPUESTO'}
									<td class="fi-num">
										<input
											class="fi-edit fi-edit-num"
											value={Number(c.porcentaje) || 0}
											inputmode="decimal"
											disabled={guardando}
											aria-label="Porcentaje"
											onblur={(e) => editarNumero(c, 'porcentaje', e.currentTarget.value)}
											onkeydown={(e) => {
												if (e.key === 'Enter') e.currentTarget.blur();
											}}
										/>
									</td>
								{/if}
								<td class="fi-num">
									<input
										class="fi-edit fi-edit-num"
										value={Number(c.valor_total) || 0}
										inputmode="decimal"
										disabled={guardando}
										aria-label="Valor"
										onblur={(e) => editarNumero(c, 'valor_total', e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') e.currentTarget.blur();
										}}
									/>
								</td>
								<td class="fi-num">
									{#if esSembrada(c)}
										<button
											class="fi-quitar"
											onclick={() => c.id && onVaciar(c.id)}
											disabled={guardando}
											title="Devolver esta fila a su nombre de fábrica y a cero. No se puede borrar: es una de las que el pie abre siempre."
										>Vaciar</button>
									{:else}
										<button
											class="fi-quitar"
											onclick={() => c.id && onEliminar(c.id)}
											disabled={guardando}
											title="Borrar esta fila del pie"
										>Quitar</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td colspan={seccion === 'IMPUESTO' ? 2 : 1}>Total del bloque</td>
							<td class="fi-num"><strong>${formatCOP(total)}</strong></td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</div>

			<div class="fi-foot">
				<button class="fi-ghost" onclick={onClose} disabled={guardando}>Cerrar</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.fi-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}
	.fi-modal {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 700px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.fi-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
	}
	.fi-header h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.fi-header p {
		margin: 3px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.fi-x {
		border: none;
		background: transparent;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}

	.fi-tabs {
		display: flex;
		gap: 2px;
		padding: 0 20px;
		border-bottom: 1px solid #e2e8f0;
	}
	.fi-tabs button {
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
	.fi-tabs button:hover:not(:disabled) {
		color: #334155;
		background: #f8fafc;
	}
	/* Clase + ELEMENTO: la regla de arriba es (0,2,1) y con el scoping de
	   Svelte se llevaría por delante el color del activo. */
	.fi-tabs button.fi-tab-on {
		color: #166534;
		font-weight: 700;
		background: #f0fdf4;
		border-bottom-color: #ea580c;
	}
	.fi-cuenta {
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
	.fi-tabs button.fi-tab-on .fi-cuenta {
		background: #ea580c;
		color: #fff;
	}

	.fi-body {
		padding: 14px 20px;
		overflow-y: auto;
		min-height: 0;
		flex: 1 1 auto;
	}

	.fi-form {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.fi-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.fi-crece {
		flex: 1 1 200px;
	}
	.fi-corto input {
		width: 96px;
	}
	.fi-field span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}
	.fi-field em {
		font-style: normal;
		text-transform: none;
		font-weight: 500;
	}
	.fi-field input {
		padding: 6px 8px;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 13px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.fi-add {
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
	.fi-add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.fi-nota {
		margin: 10px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: #64748b;
	}
	.fi-error {
		margin: 8px 0 0;
		font-size: 11.5px;
		font-weight: 600;
		color: #b91c1c;
	}

	.fi-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
		margin-top: 14px;
	}
	.fi-tabla th {
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 0 8px 6px;
		border-bottom: 1px solid #e2e8f0;
	}
	.fi-tabla td {
		padding: 7px 8px;
		border-bottom: 1px solid #f1f5f9;
	}
	.fi-num {
		text-align: right;
		white-space: nowrap;
	}
	.fi-tabla tfoot td {
		border-bottom: none;
		border-top: 2px solid #e2e8f0;
		font-weight: 700;
	}
	/* Celdas editables: sin caja hasta que se enfocan. Con borde permanente,
	   veinte filas de tabla parecían un formulario y costaba leerlas de un
	   vistazo, que es para lo que se abre esta lista. */
	.fi-edit {
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		padding: 3px 5px;
		font-family: inherit;
		font-size: 12.5px;
		color: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.fi-edit:hover:not(:disabled) {
		border-color: #e2e8f0;
		background: #f8fafc;
	}
	.fi-edit:focus {
		outline: none;
		border-color: #ea580c;
		background: #fff;
	}
	.fi-edit:disabled {
		opacity: 0.6;
	}
	.fi-edit-txt {
		min-width: 140px;
	}
	.fi-edit-num {
		text-align: right;
		width: 96px;
		font-variant-numeric: tabular-nums;
	}

	.fi-fija {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #f1f5f9;
		color: #475569;
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: help;
	}
	.fi-quitar {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: #fff;
		padding: 3px 9px;
		font-size: 11.5px;
		font-weight: 700;
		font-family: inherit;
		color: #b91c1c;
		cursor: pointer;
	}
	.fi-quitar:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fecaca;
	}
	.fi-quitar:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.fi-foot {
		padding: 12px 20px 16px;
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid #e2e8f0;
	}
	.fi-ghost {
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
