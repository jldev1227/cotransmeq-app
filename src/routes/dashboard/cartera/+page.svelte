<script lang="ts">
	/**
	 * Cartera: cuánto deben los clientes por las facturas de liquidaciones de
	 * servicios y desde cuándo.
	 *
	 * Dos vistas sobre los mismos datos:
	 *  - «Por cliente»: una fila por cliente con su saldo repartido en edades
	 *    (corriente, 1–30, 31–60, 61–90, +90). Es por donde empieza quien cobra.
	 *  - «Facturas»: las facturas con su saldo y estado. Pulsar un cliente o una
	 *    edad lleva aquí ya filtrado.
	 *
	 * Los filtros viven en la URL (`crearEstadoUrl`): una vista como «facturas
	 * de este cliente a más de 90 días» se puede pegar en un chat.
	 *
	 * El saldo, el estado y la edad los calcula el backend con la fecha de hoy
	 * en Colombia; esta página no recalcula nada.
	 */
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Download, Eye, HandCoins, X } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import ModalFacturaCartera from '$lib/components/cartera/ModalFacturaCartera.svelte';
	import { mascota } from '$lib/mascot';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { coincide } from '$lib/listing/texto';
	import { firma, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import {
		carteraAPI,
		ESTADO_CARTERA,
		ETIQUETA_TRAMO,
		mensajeError,
		TRAMOS,
		type FacturaCartera,
		type FilaClienteCartera,
		type ResumenCartera,
		type TramoEdad
	} from '$lib/api/cartera';
	import { fechaCorta, pesos } from '$lib/pagos/medios';

	interface FiltrosCartera {
		q: string;
		/** `clientes` | `facturas`. */
		vista: string;
		/** Id del cliente, o `sin-cliente`. Vacío: todos. */
		cliente: string;
		/** `abiertas` | `vencida` | `abonada` | `pendiente` | `pagada` | `todas`. */
		estado: string;
		/** Tramo de edad; vacío: todos. */
		tramo: string;
	}

	const DEFS: DefinicionesFiltros<FiltrosCartera> = {
		q: texto(),
		vista: opcion('clientes'),
		cliente: texto(),
		estado: opcion('abiertas'),
		tramo: opcion('')
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosCartera>(estadoUrl.leerInicial());

	/// Filtros → URL. Depende de la FIRMA (que lee cada campo): leer el objeto
	/// `$state` no suscribe a sus propiedades y la URL se quedaba congelada.
	$effect(() => {
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	const puedeEditar = $derived(!!$authStore.user && authStore.getAccessLevel('cartera') === 'full');

	// ── Datos ──
	let hoy = $state('');
	let resumen = $state<ResumenCartera | null>(null);
	let clientes = $state<FilaClienteCartera[]>([]);
	let cargandoResumen = $state(true);
	let facturas = $state<FacturaCartera[]>([]);
	let cargandoFacturas = $state(false);
	let error = $state<string | null>(null);

	let detalleId = $state<string | null>(null);
	let detalleModo = $state<'detalle' | 'abonar'>('detalle');

	async function cargarResumen() {
		try {
			const r = await carteraAPI.resumen();
			hoy = r.hoy;
			resumen = r.resumen;
			clientes = r.clientes;
			error = null;
		} catch (e) {
			error = mensajeError(e, 'No se pudo cargar la cartera');
		} finally {
			cargandoResumen = false;
		}
	}

	/// Lo que cambia la consulta al servidor. La búsqueda NO entra: se filtra
	/// en memoria para no pedir una vez por tecla.
	const firmaFacturas = $derived(
		filtros.vista === 'facturas' ? `${filtros.cliente}|${filtros.estado}|${filtros.tramo}` : ''
	);

	let pedido = 0;
	async function cargarFacturas() {
		if (filtros.vista !== 'facturas') return;
		const yo = ++pedido;
		cargandoFacturas = true;
		try {
			const r = await carteraAPI.facturas({
				cliente_id: filtros.cliente || undefined,
				estado: filtros.estado,
				tramo: filtros.tramo || undefined
			});
			/// Solo la última respuesta pinta: cambiar dos filtros seguidos
			/// lanzaba dos peticiones y la lenta podía llegar después.
			if (yo !== pedido) return;
			facturas = r.facturas;
			hoy = r.hoy;
		} catch (e) {
			if (yo === pedido) toast.error(mensajeError(e, 'No se pudieron cargar las facturas'));
		} finally {
			if (yo === pedido) cargandoFacturas = false;
		}
	}

	$effect(() => {
		if (!firmaFacturas) return;
		untrack(() => void cargarFacturas());
	});

	function recargarTodo() {
		void cargarResumen();
		void cargarFacturas();
	}

	onMount(() => {
		void cargarResumen();
		/// Un abono o una factura nueva de otro usuario cambia los saldos.
		const bajas = [
			socketUtils.on('facturacion-updated', recargarTodo),
			socketUtils.on('facturacion-created', recargarTodo),
			socketUtils.on('facturacion-anulada', recargarTodo)
		];
		return () => bajas.forEach((b) => b());
	});

	// ── Derivados ──
	const clientesVisibles = $derived(clientes.filter((c) => coincide(filtros.q, [c.nombre, c.nit])));
	const facturasVisibles = $derived(
		facturas.filter((f) =>
			coincide(filtros.q, [f.numero_factura, f.cliente?.nombre, f.cliente?.nit])
		)
	);

	/// Nombre del cliente filtrado, de lo que ya hay cargado.
	const clienteFiltrado = $derived.by(() => {
		if (!filtros.cliente) return null;
		if (filtros.cliente === 'sin-cliente') return 'Sin cliente';
		return (
			clientes.find((c) => c.cliente_id === filtros.cliente)?.nombre ??
			facturas.find((f) => f.cliente?.id === filtros.cliente)?.cliente?.nombre ??
			'Cliente'
		);
	});

	const conteos = $derived(
		resumen
			? [
					{ clave: 'por_cobrar', etiqueta: 'Por cobrar', valor: pesos(resumen.por_cobrar) },
					{
						clave: 'vencido',
						etiqueta: 'Vencido',
						valor: pesos(resumen.vencido),
						color: ESTADO_CARTERA.vencida.color
					},
					{
						clave: 'por_vencer',
						etiqueta: 'Por vencer este mes',
						valor: pesos(resumen.por_vencer_mes),
						color: ESTADO_CARTERA.abonada.color
					},
					{ clave: 'facturas', etiqueta: 'Facturas abiertas', valor: resumen.facturas_abiertas },
					{ clave: 'clientes', etiqueta: 'Clientes', valor: resumen.clientes_con_saldo }
				]
			: []
	);

	/// Edades del total, con su proporción: es la foto de la cartera de un vistazo.
	const COLOR_TRAMO: Record<TramoEdad, string> = {
		corriente: '#2563eb',
		d1_30: '#d97706',
		d31_60: '#ea580c',
		d61_90: '#dc2626',
		d90_mas: '#991b1b'
	};
	const edadesTotal = $derived(
		resumen
			? TRAMOS.map((t) => ({
					tramo: t,
					valor: resumen!.edades[t],
					proporcion: resumen!.por_cobrar > 0 ? resumen!.edades[t] / resumen!.por_cobrar : 0
				}))
			: []
	);

	// ── Navegación entre vistas ──
	function verFacturasDe(clienteId: string | null, tramo: TramoEdad | '' = '') {
		filtros = {
			...filtros,
			vista: 'facturas',
			cliente: clienteId ?? 'sin-cliente',
			estado: 'abiertas',
			tramo,
			q: ''
		};
	}

	function verTramo(tramo: TramoEdad) {
		filtros = {
			...filtros,
			vista: 'facturas',
			estado: 'abiertas',
			tramo: filtros.tramo === tramo ? '' : tramo
		};
	}

	function abrir(f: FacturaCartera, modo: 'detalle' | 'abonar' = 'detalle') {
		detalleModo = modo;
		detalleId = f.id;
	}

	// ── Tablas ──
	const COLUMNAS_CLIENTES: ColumnDef<FilaClienteCartera, any>[] = [
		{ id: 'cliente', header: 'Cliente', enableSorting: false },
		{ id: 'saldo', header: 'Saldo', enableSorting: false, size: 140 },
		...TRAMOS.map((t): ColumnDef<FilaClienteCartera, any> => ({
			id: t,
			header: ETIQUETA_TRAMO[t],
			enableSorting: false,
			size: 120
		})),
		{ id: 'atraso', header: 'Atraso máx.', enableSorting: false, size: 110 },
		{ id: 'acciones', header: '', enableSorting: false, size: 60 }
	];

	const COLUMNAS_FACTURAS: ColumnDef<FacturaCartera, any>[] = [
		{ id: 'factura', header: 'Factura', enableSorting: false },
		{ id: 'emision', header: 'Emisión', enableSorting: false, size: 110 },
		{ id: 'vence', header: 'Vence', enableSorting: false, size: 150 },
		{ id: 'valor', header: 'Valor', enableSorting: false, size: 130 },
		{ id: 'abonado', header: 'Abonado', enableSorting: false, size: 130 },
		{ id: 'saldo', header: 'Saldo', enableSorting: false, size: 130 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 120 },
		{ id: 'acciones', header: '', enableSorting: false, size: 90 }
	];

	const SEGMENTOS_VISTA = [
		{ valor: 'clientes', etiqueta: 'Por cliente' },
		{ valor: 'facturas', etiqueta: 'Facturas' }
	];
	const SEGMENTOS_ESTADO = [
		{ valor: 'abiertas', etiqueta: 'Con saldo' },
		{ valor: 'vencida', etiqueta: 'Vencidas', punto: ESTADO_CARTERA.vencida.color },
		{ valor: 'abonada', etiqueta: 'Abonadas', punto: ESTADO_CARTERA.abonada.color },
		{ valor: 'pendiente', etiqueta: 'Pendientes', punto: ESTADO_CARTERA.pendiente.color },
		{ valor: 'pagada', etiqueta: 'Pagadas', punto: ESTADO_CARTERA.pagada.color },
		{ valor: 'todas', etiqueta: 'Todas' }
	];

	function textoVence(f: FacturaCartera): string {
		if (f.estado === 'pagada') return 'pagada';
		if (f.dias_vencida > 0) return `hace ${f.dias_vencida} d`;
		if (!hoy) return '';
		const dias = Math.round(
			(Date.parse(`${f.fecha_vencimiento}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000
		);
		return dias === 0 ? 'hoy' : `en ${dias} d`;
	}

	// ── CSV ──
	/// Números sin separador de miles y con punto: así Excel los lee como
	/// número en cualquier configuración regional y se pueden sumar.
	function descargarCSV() {
		const celdas = (fila: unknown[]) =>
			fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
		let lineas: string[];
		let nombre: string;
		if (filtros.vista === 'clientes') {
			lineas = [
				celdas([
					'Cliente',
					'NIT',
					'Facturas con saldo',
					'Saldo',
					...TRAMOS.map((t) => ETIQUETA_TRAMO[t]),
					'Vencido',
					'Atraso máximo (días)'
				]),
				...clientesVisibles.map((c) =>
					celdas([
						c.nombre,
						c.nit,
						c.facturas,
						c.saldo,
						...TRAMOS.map((t) => c.edades[t]),
						c.vencido,
						c.max_dias_vencida
					])
				)
			];
			nombre = `cartera-por-cliente-${hoy}.csv`;
		} else {
			lineas = [
				celdas([
					'Factura',
					'Cliente',
					'NIT',
					'Emisión',
					'Plazo (días)',
					'Vencimiento',
					'Valor',
					'Recibido',
					'Retenciones',
					'Saldo',
					'Estado',
					'Días vencida',
					'Edad'
				]),
				...facturasVisibles.map((f) =>
					celdas([
						f.numero_factura,
						f.cliente?.nombre,
						f.cliente?.nit,
						f.fecha_emision,
						f.plazo_dias,
						f.fecha_vencimiento,
						f.valor,
						f.recibido,
						f.retenciones,
						f.saldo,
						ESTADO_CARTERA[f.estado].etiqueta,
						f.dias_vencida,
						f.tramo ? ETIQUETA_TRAMO[f.tramo] : ''
					])
				)
			];
			nombre = `cartera-facturas-${hoy}.csv`;
		}
		if (lineas.length <= 1) {
			toast.warning('No hay filas para exportar');
			return;
		}
		const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = nombre;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		toast.success(`${lineas.length - 1} filas exportadas`);
	}
</script>

<svelte:head>
	<title>Cartera — Cotransmeq</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 300 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Cartera</h1>
			<p class="dir-desc">
				Cuentas por cobrar de las facturas de liquidaciones de servicios: saldo, abonos y edades.
				{#if hoy}<span class="ca-corte">Corte: {fechaCorta(hoy)}</span>{/if}
			</p>
			{#if resumen}
				<div class="dir-conteos"><ResumenConteos {conteos} /></div>
			{/if}
		</div>
		<div class="dir-cabecera-acciones">
			<button class="btn-secondary" onclick={descargarCSV} disabled={cargandoResumen}>
				<Download size={16} /> Exportar CSV
			</button>
		</div>

		{#if resumen && resumen.por_cobrar > 0}
			<!-- Edades del total. Cada tramo filtra las facturas. -->
			<div class="ca-edades" role="group" aria-label="Edades de la cartera">
				<div class="ca-barra" aria-hidden="true">
					{#each edadesTotal as e (e.tramo)}
						{#if e.proporcion > 0}
							<span style="flex:{e.proporcion}; background:{COLOR_TRAMO[e.tramo]}"></span>
						{/if}
					{/each}
				</div>
				<div class="ca-tramos">
					{#each edadesTotal as e (e.tramo)}
						<button
							type="button"
							class="ca-tramo"
							class:ca-tramo--activo={filtros.vista === 'facturas' && filtros.tramo === e.tramo}
							onclick={() => verTramo(e.tramo)}
							aria-pressed={filtros.vista === 'facturas' && filtros.tramo === e.tramo}
						>
							<span class="ca-tramo-etq">
								<i style="background:{COLOR_TRAMO[e.tramo]}"></i>
								{e.tramo === 'corriente' ? 'Corriente' : `${ETIQUETA_TRAMO[e.tramo]} días`}
							</span>
							<strong>{pesos(e.valor)}</strong>
							<small>{Math.round(e.proporcion * 100)} %</small>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</header>

	<div class="dir-filtros" in:fly={{ y: 12, duration: 350, delay: 80 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={filtros.q}
				onBuscar={(t) => (filtros = { ...filtros, q: t })}
				placeholder={filtros.vista === 'clientes'
					? 'Cliente o NIT…'
					: 'N° de factura, cliente o NIT…'}
				etiqueta="Buscar en cartera"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Vista"
			opciones={SEGMENTOS_VISTA}
			valor={filtros.vista}
			onCambiar={(v) => (filtros = { ...filtros, vista: v })}
		/>
		{#if filtros.vista === 'facturas'}
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS_ESTADO}
				valor={filtros.estado}
				onCambiar={(v) => (filtros = { ...filtros, estado: v })}
			/>
		{/if}
	</div>

	{#if filtros.vista === 'facturas' && (filtros.cliente || filtros.tramo)}
		<div class="ca-chips">
			{#if filtros.cliente}
				<button class="filter-chip" onclick={() => (filtros = { ...filtros, cliente: '' })}>
					<span style="color: var(--text-muted); font-weight: 500;">Cliente:</span>
					<span>{clienteFiltrado}</span>
					<X size={13} />
				</button>
			{/if}
			{#if filtros.tramo}
				<button class="filter-chip" onclick={() => (filtros = { ...filtros, tramo: '' })}>
					<span style="color: var(--text-muted); font-weight: 500;">Edad:</span>
					<span>{ETIQUETA_TRAMO[filtros.tramo as TramoEdad] ?? filtros.tramo}</span>
					<X size={13} />
				</button>
			{/if}
		</div>
	{/if}

	{#if error}
		<p class="ca-error">{error}</p>
	{/if}

	<div class="dir-lista" in:fly={{ y: 12, duration: 350, delay: 120 }}>
		<div class="dir-lista-scroll">
			{#if filtros.vista === 'clientes'}
				<TablaLista
					columnas={COLUMNAS_CLIENTES}
					datos={clientesVisibles}
					claveFila={(c) => c.cliente_id ?? 'sin-cliente'}
					cargando={cargandoResumen}
					onFila={(c) => verFacturasDe(c.cliente_id)}
					etiqueta="Cartera por cliente"
				>
					{#snippet celda({ columnaId, fila: c })}
						{#if columnaId === 'cliente'}
							<CeldaIdentidad
								titulo={c.nombre}
								subtitulo={[
									c.nit ? `NIT ${c.nit}` : null,
									`${c.facturas} factura${c.facturas === 1 ? '' : 's'}`
								]
									.filter(Boolean)
									.join(' · ')}
							/>
						{:else if columnaId === 'saldo'}
							<span class="ca-num ca-fuerte">{pesos(c.saldo)}</span>
						{:else if columnaId === 'atraso'}
							{#if c.max_dias_vencida > 0}
								<span class="ca-num" style="color:{ESTADO_CARTERA.vencida.color}"
									>{c.max_dias_vencida} d</span
								>
							{:else}
								<span class="ca-num dir-nulo">al día</span>
							{/if}
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'ver',
										etiqueta: 'Ver facturas',
										icono: Eye,
										onClick: () => verFacturasDe(c.cliente_id)
									}
								]}
							/>
						{:else if TRAMOS.includes(columnaId as TramoEdad)}
							{@const monto = c.edades[columnaId as TramoEdad]}
							{#if monto > 0}
								<button
									type="button"
									class="ca-num ca-celda-tramo"
									style="--c:{COLOR_TRAMO[columnaId as TramoEdad]}"
									title="Ver las facturas de {c.nombre} en este tramo"
									onclick={(e) => {
										e.stopPropagation();
										verFacturasDe(c.cliente_id, columnaId as TramoEdad);
									}}
								>
									{pesos(monto)}
								</button>
							{:else}
								<span class="ca-num ca-cero">—</span>
							{/if}
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota(filtros.q ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{filtros.q ? 'Sin coincidencias' : 'Nadie debe nada'}</h3>
							<p>
								{filtros.q
									? 'Ningún cliente con saldo coincide con la búsqueda.'
									: 'No hay facturas activas con saldo pendiente.'}
							</p>
						</div>
					{/snippet}
				</TablaLista>
			{:else}
				<TablaLista
					columnas={COLUMNAS_FACTURAS}
					datos={facturasVisibles}
					claveFila={(f) => f.id}
					cargando={cargandoFacturas && facturas.length === 0}
					onFila={(f) => abrir(f)}
					etiqueta="Facturas en cartera"
				>
					{#snippet celda({ columnaId, fila: f })}
						{#if columnaId === 'factura'}
							<div class="dir-celda">
								<span class="ca-mono">{f.numero_factura}</span>
								<small>{f.cliente?.nombre ?? 'Sin cliente'}</small>
							</div>
						{:else if columnaId === 'emision'}
							<span class="dir-celda--fecha">{fechaCorta(f.fecha_emision)}</span>
						{:else if columnaId === 'vence'}
							<div class="dir-celda">
								<span class="dir-celda--fecha">{fechaCorta(f.fecha_vencimiento)}</span>
								<small style={f.dias_vencida > 0 ? `color:${ESTADO_CARTERA.vencida.color}` : ''}>
									{textoVence(f)}
								</small>
							</div>
						{:else if columnaId === 'valor'}
							<span class="ca-num">{pesos(f.valor)}</span>
						{:else if columnaId === 'abonado'}
							<span
								class="ca-num"
								title={f.retenciones ? `Incluye ${pesos(f.retenciones)} de retenciones` : ''}
							>
								{f.aplicado ? pesos(f.aplicado) : '—'}
							</span>
						{:else if columnaId === 'saldo'}
							<span class="ca-num ca-fuerte">{pesos(f.saldo)}</span>
						{:else if columnaId === 'estado'}
							<EstadoPunto
								etiqueta={ESTADO_CARTERA[f.estado].etiqueta}
								color={ESTADO_CARTERA[f.estado].color}
								apagado={f.estado === 'pagada'}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'abonar',
										etiqueta: 'Registrar abono',
										icono: HandCoins,
										onClick: () => abrir(f, 'abonar'),
										oculta: !puedeEditar || f.saldo <= 0
									},
									{ id: 'ver', etiqueta: 'Ver detalle', icono: Eye, onClick: () => abrir(f) }
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>Sin facturas</h3>
							<p>
								{filtros.q || filtros.cliente || filtros.tramo || filtros.estado !== 'abiertas'
									? 'Ninguna factura coincide con estos filtros.'
									: 'No hay facturas activas con saldo pendiente.'}
							</p>
						</div>
					{/snippet}
				</TablaLista>
			{/if}
		</div>
	</div>
</div>

<ModalFacturaCartera
	open={detalleId !== null}
	facturaId={detalleId}
	modoInicial={detalleModo}
	{puedeEditar}
	oncerrar={() => (detalleId = null)}
	oncambio={recargarTodo}
/>

<style>
	.ca-corte {
		margin-left: 0.35rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ca-edades {
		flex-basis: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.ca-barra {
		display: flex;
		height: 8px;
		border-radius: 999px;
		overflow: hidden;
		background: var(--bg-base);
		gap: 2px;
	}
	.ca-tramos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.5rem;
	}
	.ca-tramo {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 0.55rem 0.75rem;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.ca-tramo:hover {
		border-color: var(--emerald-500);
	}
	.ca-tramo--activo {
		border-color: var(--emerald-500);
		background: var(--au-tint);
	}
	.ca-tramo-etq {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ca-tramo-etq i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.ca-tramo strong {
		font-size: 1rem;
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.ca-tramo small {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.ca-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.ca-error {
		margin: 0;
		padding: 0.6rem 0.85rem;
		border-radius: 10px;
		background: #fef2f2;
		color: #b91c1c;
		font-size: 0.85rem;
	}
	.ca-num {
		display: block;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.ca-fuerte {
		font-weight: 800;
	}
	.ca-cero {
		color: var(--text-very-muted);
	}
	.ca-mono {
		font-family: var(--font-mono);
		font-weight: 700;
	}
	.ca-celda-tramo {
		width: 100%;
		border: none;
		background: none;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
		font: inherit;
		font-weight: 700;
		color: var(--c);
		cursor: pointer;
	}
	.ca-celda-tramo:hover {
		background: color-mix(in srgb, var(--c) 10%, transparent);
	}
</style>
