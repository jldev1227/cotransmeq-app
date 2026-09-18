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
		type ConceptoDescuento,
		type DestinoTrasladoItem
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import { liquidacionesTercerosAdicionalesAPI } from '$lib/api/liquidaciones-terceros-adicionales';
	import {
		CONFIG_GASTOS_FALLBACK,
		importeGastosDiversos,
		importePapeleria,
		type ConfigGastosPeriodo
	} from '$lib/editor/business/conceptos.service';
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
		/// Periodo del cierre. Decide qué configuración de gastos se aplica.
		anio: number;
		mes: number;
		/**
		 * `valor_liquidar` del cierre. Es lo que decide el tramo de papelería.
		 *
		 * Llega como prop y no se deriva de `items` a propósito: el cierre lo
		 * tiene ya calculado y sumar aquí los items volvería a abrir la pregunta
		 * de si los adicionales entran, que es justo lo que `totales-cierre.ts`
		 * resolvió de una vez en el servidor.
		 */
		valorLiquidar: number;
		onClose: () => void;
		/// Tras un cambio: la page recarga el cierre y remonta la hoja. `mensaje`
		/// sustituye al toast genérico de alta/baja cuando la operación es otra
		/// cosa (un traslado dice a dónde fue el item).
		onCambiado: (r: {
			accion: 'add' | 'remove';
			concepto: string;
			mensaje?: string;
		}) => void | Promise<void>;
	}

	let {
		cierreId,
		placa,
		periodo,
		conceptos,
		adicionales,
		items,
		terceroNombre = null,
		anio,
		mes,
		valorLiquidar,
		onClose,
		onCambiado
	}: Props = $props();

	type Seccion = 'GASTO_OPERATIVO' | 'ANTICIPO' | 'ADICIONAL' | 'ITEM';

	/**
	 * Los tres gastos que se calculan solos no se pueden borrar ni duplicar.
	 * Espejo de `CONCEPTOS_CALCULADOS_AUTO` en el servidor.
	 */
	const AUTOMATICOS = new Set(['DOTACION', 'EXAMEN_MEDICO', 'GASTOS_DIVERSOS', 'PAPELERIA']);

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

	// ── Gastos calculados que le faltan al cierre ────────────────────────
	//
	// Un borrador generado antes de que la siembra existiera no tiene papelería
	// ni gastos diversos: en julio de 2026, 40 de 41 cierres. Regenerarlo para
	// conseguirlos perdería lo tecleado, así que se ofrecen aquí, con el
	// importe ya resuelto para que se vea QUÉ se va a aplicar antes de pulsar.

	let configGastos = $state<ConfigGastosPeriodo>(CONFIG_GASTOS_FALLBACK);
	let aplicandoSugeridos = $state(false);

	$effect(() => {
		// El periodo no cambia mientras el modal está abierto, pero la config
		// sí puede haberse editado desde el otro modal, así que se relee al
		// abrir en vez de cachearla en la page.
		let vivo = true;
		liquidacionesTercerosDescuentosAPI
			.obtenerConfigGastos(anio, mes)
			.then((c) => {
				if (vivo) configGastos = c;
			})
			.catch(() => {
				// Sin config se usa el respaldo, que es lo que rigió siempre. No
				// se avisa: el usuario no pidió la config, pidió sus gastos.
			});
		return () => {
			vivo = false;
		};
	});

	/** Base de gastos diversos: Σ TOTAL de los items + Σ bruto de adicionales. */
	const baseFacturada = $derived(
		(items ?? []).reduce((s, i) => s + (Number(i.total_facturado) || 0), 0) +
			(adicionales ?? []).reduce(
				(s, a) => s + (Number(a.valor_unitario) || 0) * (Number(a.cantidad) || 0),
				0
			)
	);

	const sugeridos = $derived.by(() => {
		const presentes = new Set(
			(conceptos ?? []).filter((c) => c.tipo === 'GASTO_OPERATIVO').map((c) => c.concepto)
		);
		const out: Array<{ concepto: string; valor: number; nota: string }> = [];
		if (!presentes.has('PAPELERIA')) {
			out.push({
				concepto: 'PAPELERIA',
				valor: importePapeleria(configGastos, valorLiquidar),
				nota:
					valorLiquidar > configGastos.papeleria_umbral
						? `v/liquidar supera $${formatCOP(configGastos.papeleria_umbral)}`
						: `v/liquidar no supera $${formatCOP(configGastos.papeleria_umbral)}`
			});
		}
		if (!presentes.has('GASTOS_DIVERSOS')) {
			out.push({
				concepto: 'GASTOS_DIVERSOS',
				valor: importeGastosDiversos(configGastos, baseFacturada),
				nota: `$${formatCOP(configGastos.fijo_gastos_diversos)} + ${configGastos.pct_gastos_diversos}% de $${formatCOP(baseFacturada)}`
			});
		}
		return out;
	});

	async function aplicarSugeridos() {
		if (aplicandoSugeridos || sugeridos.length === 0) return;
		aplicandoSugeridos = true;
		error = '';
		try {
			// Uno a uno y no en lote: `agregarConceptoFila` es el único camino que
			// crea la fila con su `orden` canónico y recalcula los totales del
			// cierre. Son dos filas como mucho.
			for (const g of sugeridos) {
				await liquidacionesTercerosDescuentosAPI.agregarConceptoFila(cierreId, {
					tipo: 'GASTO_OPERATIVO',
					concepto: g.concepto,
					dias: 1,
					valor_unitario: g.valor,
					observaciones: null
				});
			}
			await onCambiado({ accion: 'add', concepto: sugeridos.map((g) => g.concepto).join(' y ') });
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			aplicandoSugeridos = false;
		}
	}

	/**
	 * Items QUITADOS del cierre.
	 *
	 * Se piden aparte porque `detallePeriodo` los filtra: llevan `deleted_at`
	 * y para el resto de la aplicación no existen. Esta lista es la única
	 * forma de devolverlos — antes, quitar un item era irreversible desde
	 * cualquier interfaz.
	 */
	interface Quitado {
		id: string;
		cliente: string;
		recorrido: string;
		fechas: string;
		valor: number;
		/**
		 * A dónde se TRASLADÓ al quitarlo, o `null` si solo se quitó. Un
		 * trasladado vuelve con «Devolver al cierre», que además lo saca del
		 * otro documento; el «Devolver» a secas lo rechaza el servidor.
		 */
		trasladado_a: DestinoTrasladoItem | null;
	}
	let quitados = $state<Quitado[]>([]);
	let cargandoQuitados = $state(false);

	const ETIQUETA_DESTINO: Record<DestinoTrasladoItem, string> = {
		OCASIONAL: 'Ocasional',
		INGRESOS: 'Ingresos'
	};

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
					fechas: i.liquidacion_tercero?.fechas ?? '',
					valor: Number(i.liquidacion_tercero?.valor_liquidar ?? 0),
					trasladado_a:
						i.trasladado_a === 'OCASIONAL' || i.trasladado_a === 'INGRESOS'
							? i.trasladado_a
							: null
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

	async function devolverItem(q: Quitado) {
		if (trabajando) return;
		trabajando = true;
		error = '';
		try {
			if (q.trasladado_a) {
				// Deshace los DOS lados: saca el item del ocasional / apaga el
				// INCLUIR de ingresos, y reactiva el pivote.
				await liquidacionesTercerosDescuentosAPI.revertirTrasladoItem(q.id);
				await onCambiado({
					accion: 'add',
					concepto: q.recorrido || 'item',
					mensaje: `${q.recorrido || 'Item'} devuelto a ${placa} desde ${ETIQUETA_DESTINO[q.trasladado_a].toLowerCase()}`
				});
			} else {
				await liquidacionesTercerosDescuentosAPI.toggleExcluirItem(q.id, false);
				await onCambiado({ accion: 'add', concepto: q.recorrido || 'item' });
			}
			await cargarQuitados();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

	/**
	 * TRASLADAR un item a otro documento del mismo tercero.
	 *
	 * OCASIONAL: entra como item de la liquidación ocasional del periodo del
	 * cierre (se crea vacía si no existe). INGRESOS: su fila de la hoja de
	 * ingresos queda marcada INCLUIR y baja a ADICIONALES. En los dos casos el
	 * item se quita del cierre —si se quedara en ambos se pagaría dos veces— y
	 * pasa a «Quitados» con la marca de a dónde fue, desde donde se devuelve.
	 */
	async function trasladarItem(it: ItemCierre, destino: DestinoTrasladoItem) {
		if (trabajando) return;
		trabajando = true;
		error = '';
		try {
			const r = await liquidacionesTercerosDescuentosAPI.trasladarItem(it.pivoteId, destino);
			const info = r?.destino_info ?? {};
			const donde =
				destino === 'OCASIONAL'
					? `ocasional ${info.consecutivo ?? ''}${info.creada ? ' (recién creado)' : ''}`.trim()
					: `ingresos ${MESES_CORTOS[(info.mes ?? mes) - 1] ?? ''} ${info.anio ?? anio}`.trim();
			await onCambiado({
				accion: 'remove',
				concepto: it.recorrido || 'item',
				mensaje: `${it.recorrido || 'Item'} trasladado de ${placa} a ${donde}`
			});
			await cargarQuitados();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'Error desconocido';
		} finally {
			trabajando = false;
		}
	}

	/**
	 * Por qué un item NO puede ir a ingresos, o `null` si puede. Espejo de las
	 * validaciones de `marcarIncluirDesdeCierre`: la hoja de ingresos solo
	 * lista servicios facturados que dejaron ingreso a Transmeralda, así que un
	 * item que no cumpla tendría la fila marcada y nadie la vería. Se decide
	 * aquí para deshabilitar el botón con el motivo, en vez de dejar pulsar y
	 * devolver el error.
	 */
	function motivoSinIngresos(it: ItemCierre): string | null {
		const ingresoEmpresa =
			(Number(it.ingreso_extra_global) || 0) - (Number(it.ingresos_extra_aval) || 0);
		if (ingresoEmpresa === 0) return 'Sin ingreso de Transmeralda: no tiene fila en la hoja de ingresos.';
		if (!it.numero_factura || it.factura_anulada)
			return 'Sin factura activa: la hoja de ingresos solo lista servicios facturados.';
		return null;
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
							<th>Fechas</th>
							<th class="cxm-num">V/liquidar</th>
							<th class="cxm-num">Trasladar a</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each items ?? [] as it (it.pivoteId)}
							{@const sinIngresos = motivoSinIngresos(it)}
							<tr>
								<td>{it.cliente_nombre || '—'}</td>
								<td>{it.recorrido || '—'}</td>
								<td class="cxm-fechas" title={it.fechas || ''}>{it.fechas || '—'}</td>
								<td class="cxm-num cxm-total">${formatCOP(Number(it.valor_liquidar))}</td>
								<td class="cxm-num">
									<!--
										Los dos destinos a los que puede irse un item que es de la placa
										pero no se paga por el cierre. Van al lado de la × y no dentro de
										un menú: son dos, y quien liquida los pulsa muchas veces por hoja.
									-->
									<span class="cxm-mover">
										<button
											class="cxm-mover-btn"
											onclick={() => trasladarItem(it, 'OCASIONAL')}
											disabled={trabajando}
											title="Trasladar a la liquidación OCASIONAL del periodo: entra allí como item y se quita del cierre. Se devuelve desde «Quitados»."
										>Ocasional</button>
										<button
											class="cxm-mover-btn"
											onclick={() => trasladarItem(it, 'INGRESOS')}
											disabled={trabajando || !!sinIngresos}
											title={sinIngresos ??
												'Trasladar a INGRESOS: su fila de la hoja de ingresos queda marcada INCLUIR (baja a ADICIONALES) y se quita del cierre. Se devuelve desde «Quitados».'}
										>Ingresos</button>
									</span>
								</td>
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
				<p class="cxm-nota">
					<strong>Ocasional</strong> lo lleva a la liquidación ocasional de {periodo} (se crea
					si no existe). <strong>Ingresos</strong> marca INCLUIR en su fila de la hoja de
					ingresos, en el mes de su liquidación de servicio, para que baje a ADICIONALES. En
					ambos casos deja de sumar aquí y se puede devolver desde «Quitados».
				</p>

				<h4 class="cxm-sub2">
					Quitados del cierre
					{#if cargandoQuitados}<span class="cxm-nota">· leyendo…</span>{/if}
				</h4>
				{#if quitados.length === 0}
					<p class="cxm-vacio">
						Ninguno. Un item quitado o trasladado deja de sumar al valor a liquidar y de
						la hoja desaparece su fila; aquí es donde se devuelve.
					</p>
				{:else}
					<table class="cxm-tabla">
						<tbody>
							{#each quitados as q (q.id)}
								<tr>
									<td>{q.cliente || '—'}</td>
									<td>
										{q.recorrido || '—'}
										{#if q.trasladado_a}
											<span
												class="cxm-destino"
												class:cxm-destino-ing={q.trasladado_a === 'INGRESOS'}
												title={q.trasladado_a === 'OCASIONAL'
													? 'Está como item en la liquidación ocasional del periodo.'
													: 'Su fila de la hoja de ingresos está marcada INCLUIR.'}
											>{ETIQUETA_DESTINO[q.trasladado_a]}</span>
										{/if}
									</td>
									<td class="cxm-fechas" title={q.fechas || ''}>{q.fechas || '—'}</td>
									<td class="cxm-num">${formatCOP(q.valor)}</td>
									<td class="cxm-num">
										<button
											class="cxm-devolver"
											onclick={() => devolverItem(q)}
											disabled={trabajando}
											title={q.trasladado_a
												? `Lo saca de ${ETIQUETA_DESTINO[q.trasladado_a].toLowerCase()} y vuelve a sumar en el cierre.`
												: 'Vuelve a sumar en el cierre.'}
										>{q.trasladado_a ? 'Devolver al cierre' : 'Devolver'}</button>
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
			{:else}
				{#if seccion === 'GASTO_OPERATIVO' && sugeridos.length > 0}
					<!--
						Los gastos calculados que le faltan al cierre, con su importe ya
						resuelto. Se enseñan ANTES de aplicarlos porque son dinero: quien
						liquida tiene que poder ver de dónde sale cada número —el tramo de
						papelería, la base de gastos diversos— y no fiarse de un botón.
					-->
					<div class="cxm-sug">
						<div class="cxm-sug-cab">
							<span class="cxm-sug-tit">
								{sugeridos.length === 1
									? 'Falta un gasto calculado'
									: 'Faltan gastos calculados'}
							</span>
							<button
								class="cxm-sug-btn"
								type="button"
								onclick={aplicarSugeridos}
								disabled={aplicandoSugeridos}
							>
								{aplicandoSugeridos ? 'Aplicando…' : 'Aplicar'}
							</button>
						</div>
						<ul class="cxm-sug-lista">
							{#each sugeridos as g (g.concepto)}
								<li>
									<span class="cxm-sug-nom">{etiqueta(g.concepto)}</span>
									<span class="cxm-sug-val">${formatCOP(g.valor)}</span>
									<span class="cxm-sug-nota">{g.nota}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if filas.length === 0}
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
		/* 860 y no 660: la pestaña Items lleva ahora cliente, recorrido, fechas,
		   importe, los dos destinos de traslado y la ×. A 660 el recorrido se
		   partía en tres líneas y los botones caían fuera de la fila. */
		max-width: 860px;
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
	/**
	 * `fechas` es texto libre y hay valores largos de verdad
	 * («6.7.8.9.10.13.14.15.16.17.20.21.22.23 ABR»). Se recorta con puntos
	 * suspensivos y el valor entero queda en el `title`: dejarlo crecer
	 * empujaba el resto de columnas fuera del modal.
	 */
	.cxm-fechas {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #475569;
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
	/* Los dos destinos de traslado, pegados como un grupo. Neutros y no
	   verdes: no son la acción principal de la fila, y a dos por fila el verde
	   competiría con el «Devolver» de abajo. */
	.cxm-mover {
		display: inline-flex;
		gap: 4px;
		white-space: nowrap;
	}
	.cxm-mover-btn {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: #fff;
		padding: 3px 8px;
		font-size: 11px;
		font-weight: 700;
		font-family: inherit;
		color: #334155;
		cursor: pointer;
	}
	.cxm-mover-btn:hover:not(:disabled) {
		background: #f1f5f9;
		border-color: #94a3b8;
		color: #0f172a;
	}
	.cxm-mover-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	/* A dónde fue un item trasladado. Azul para ocasional y ámbar para
	   ingresos, para distinguirlos de un vistazo. */
	.cxm-destino {
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
		vertical-align: middle;
	}
	.cxm-destino-ing {
		background: #fffbeb;
		color: #b45309;
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

	/* Gastos calculados que le faltan al cierre. Ámbar y no rojo: no es un
	   error, es algo que se puede completar de un clic. */
	.cxm-sug {
		margin: 4px 2px 12px;
		border: 1px solid #fcd34d;
		background: #fffbeb;
		border-radius: 10px;
		padding: 10px 12px;
	}
	.cxm-sug-cab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.cxm-sug-tit {
		font-size: 12.5px;
		font-weight: 700;
		color: #92400e;
	}
	.cxm-sug-btn {
		border: 1px solid #b45309;
		background: #b45309;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		border-radius: 8px;
		padding: 5px 14px;
		cursor: pointer;
	}
	.cxm-sug-btn:hover:not(:disabled) {
		background: #92400e;
	}
	.cxm-sug-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.cxm-sug-lista {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.cxm-sug-lista li {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 12px;
	}
	.cxm-sug-nom {
		font-weight: 600;
		color: #78350f;
		min-width: 130px;
	}
	.cxm-sug-val {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #78350f;
	}
	.cxm-sug-nota {
		color: #a16207;
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
