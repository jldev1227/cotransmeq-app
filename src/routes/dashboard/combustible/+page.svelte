<script lang="ts">
	/**
	 * Combustible: tanqueos de la flota, gasto y rendimiento en km por galón.
	 *
	 * Dos vistas sobre el mismo filtro (periodo, vehículo, conductor):
	 *  - TANQUEOS: cada registro con el rendimiento del tramo que cierra;
	 *  - RENDIMIENTO: una fila por vehículo, de más alertas a menos.
	 *
	 * El rendimiento lo calcula el backend de lleno a lleno (un parcial no dice
	 * cuánto quedaba en el tanque). Una alerta es un tramo por debajo del 75 %
	 * de lo habitual del vehículo: fuga, robo, un tanqueo mal digitado o un
	 * problema mecánico. Misma cáscara que los directorios (`dir-*` y
	 * `listing/`); los filtros viven en la URL.
	 */
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Download, FileText, Pencil, Plus, Trash2, X } from 'lucide-svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import ModalTanqueo from '$lib/components/combustible/ModalTanqueo.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		bandera,
		firma,
		limpiar as limpiarFiltrosDe,
		numero as filtroNumero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { authStore } from '$lib/stores/auth';
	import { mascota } from '$lib/mascot';
	import {
		COMBUSTIBLE_LABELS,
		combustibleAPI,
		fechaTanqueo,
		horaTanqueo,
		hoyBogota,
		kmGal,
		moneda,
		numero,
		type CatalogosCombustible,
		type ListadoTanqueos,
		type RendimientoVehiculo,
		type Tanqueo,
		type TotalesCombustible
	} from '$lib/api/combustible';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 25;
	/// Semáforo del rendimiento: hex literales, no la escala de la marca (en
	/// cotransmeq `emerald` es naranja y un «bien» naranja confunde).
	const ROJO = '#dc2626';
	const VERDE = '#16a34a';

	const puedeEscribir = $derived(
		!!$authStore.user && authStore.getAccessLevel('combustible') === 'full'
	);

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		vista: string;
		/** `mes` | `anterior` | `90d` | `anio` | `todo` | `rango` (usa desde/hasta). */
		periodo: string;
		desde: string;
		hasta: string;
		vehiculo: string;
		conductor: string;
		alertas: boolean;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		vista: opcion('tanqueos'),
		periodo: opcion('mes'),
		desde: texto(),
		hasta: texto(),
		vehiculo: texto(),
		conductor: texto(),
		alertas: bandera(),
		pagina: filtroNumero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leerInicial());

	/// Depende de la FIRMA y no del objeto: leer `filtros` no suscribe a sus
	/// campos (es un proxy) y la URL se quedaba congelada.
	const firmaFiltros = $derived(firma(DEFS, filtros));
	$effect(() => {
		void firmaFiltros;
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
	function limpiarFiltros() {
		filtros = { ...limpiarFiltrosDe(DEFS, filtros), vista: filtros.vista };
	}
	const hayFiltros = $derived(
		filtros.periodo !== 'mes' || !!filtros.vehiculo || !!filtros.conductor || filtros.alertas
	);

	const PERIODOS = [
		{ valor: 'mes', etiqueta: 'Este mes' },
		{ valor: 'anterior', etiqueta: 'Mes anterior' },
		{ valor: '90d', etiqueta: '90 días' },
		{ valor: 'anio', etiqueta: 'Este año' },
		{ valor: 'todo', etiqueta: 'Todo' }
	];

	/** Periodo → días de calendario en Colombia. «Todo» no acota. */
	const rango = $derived.by((): { desde: string; hasta: string } => {
		const hoy = hoyBogota();
		const [a, m] = hoy.split('-').map(Number);
		const iso = (d: Date) => d.toISOString().slice(0, 10);
		switch (filtros.periodo) {
			case 'anterior': {
				const inicio = new Date(Date.UTC(a, m - 2, 1));
				const fin = new Date(Date.UTC(a, m - 1, 0));
				return { desde: iso(inicio), hasta: iso(fin) };
			}
			case '90d':
				return {
					desde: iso(new Date(Date.parse(`${hoy}T00:00:00Z`) - 89 * 86_400_000)),
					hasta: hoy
				};
			case 'anio':
				return { desde: `${a}-01-01`, hasta: hoy };
			case 'todo':
				return { desde: '', hasta: '' };
			case 'rango':
				return { desde: filtros.desde, hasta: filtros.hasta };
			default:
				return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
		}
	});

	/// Tocar una fecha a mano pasa a «rango» y conserva la otra punta.
	function ponerFecha(cual: 'desde' | 'hasta', valor: string) {
		filtros = {
			...filtros,
			periodo: 'rango',
			desde: cual === 'desde' ? valor : rango.desde,
			hasta: cual === 'hasta' ? valor : rango.hasta,
			pagina: 1
		};
	}

	const consulta = $derived({
		vehiculo_id: filtros.vehiculo || undefined,
		conductor_id: filtros.conductor || undefined,
		desde: rango.desde || undefined,
		hasta: rango.hasta || undefined,
		solo_alertas: filtros.alertas,
		pagina: filtros.pagina,
		por_pagina: POR_PAGINA
	});

	// ── Catálogos (selectores del filtro y del formulario) ───────────────
	let catalogos = $state<CatalogosCombustible | null>(null);
	onMount(async () => {
		try {
			catalogos = await combustibleAPI.catalogos();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los vehículos');
		}
	});

	const opcionesVehiculo = $derived(
		(catalogos?.vehiculos ?? []).map((v) => ({
			value: v.id,
			label: v.placa,
			labelSecundario: [v.marca, v.linea].filter(Boolean).join(' ') || 'Sin detalle',
			searchLabel: `${v.placa} ${v.marca ?? ''} ${v.linea ?? ''}`.toLowerCase()
		}))
	);
	const opcionesConductor = $derived(
		(catalogos?.conductores ?? []).map((c) => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido}`.trim(),
			labelSecundario: c.numero_identificacion ? `CC ${c.numero_identificacion}` : 'Sin documento',
			searchLabel: `${c.nombre} ${c.apellido} ${c.numero_identificacion ?? ''}`.toLowerCase()
		}))
	);

	// ── Datos ────────────────────────────────────────────────────────────
	let listado = $state<ListadoTanqueos | null>(null);
	let porVehiculo = $state<RendimientoVehiculo[] | null>(null);
	let totales = $state<TotalesCombustible | null>(null);
	let cargando = $state(true);
	/// Respuestas que llegan tarde de un filtro anterior no pisan la actual.
	let turno = 0;

	const firmaConsulta = $derived(JSON.stringify([filtros.vista, consulta]));
	$effect(() => {
		void firmaConsulta;
		if (!browser) return;
		void untrack(() => cargar());
	});

	async function cargar() {
		const mio = ++turno;
		cargando = true;
		try {
			if (filtros.vista === 'rendimiento') {
				const r = await combustibleAPI.rendimiento(consulta);
				if (mio !== turno) return;
				porVehiculo = r.vehiculos;
				totales = r.totales;
			} else {
				const r = await combustibleAPI.listar(consulta);
				if (mio !== turno) return;
				listado = r;
				totales = r.resumen;
			}
		} catch (error) {
			if (mio === turno)
				toast.error(error instanceof Error ? error.message : 'No se pudo cargar combustible');
		} finally {
			if (mio === turno) cargando = false;
		}
	}

	const conteos = $derived([
		{ clave: 'tanqueos', etiqueta: 'Tanqueos', valor: totales?.tanqueos ?? 0 },
		{ clave: 'galones', etiqueta: 'Galones', valor: numero(totales?.galones ?? 0, 1) },
		{ clave: 'gasto', etiqueta: 'Gasto', valor: moneda(totales?.gasto ?? 0) },
		{ clave: 'rendimiento', etiqueta: 'Rendimiento', valor: kmGal(totales?.rendimiento) },
		{ clave: 'costo', etiqueta: 'Costo por km', valor: moneda(totales?.costo_km) },
		{
			clave: 'alertas',
			etiqueta: 'Alertas',
			valor: totales?.alertas ?? 0,
			color: (totales?.alertas ?? 0) > 0 ? ROJO : undefined
		}
	]);
	/// Solo «Alertas» filtra: las demás cifras son totales, no estados.
	function elegirConteo(clave: string) {
		if (clave !== 'alertas') return;
		filtros = { ...filtros, vista: 'tanqueos', alertas: !filtros.alertas, pagina: 1 };
	}

	// ── Acciones ─────────────────────────────────────────────────────────
	let modalAbierto = $state(false);
	let enEdicion = $state<Tanqueo | null>(null);

	function abrirNuevo() {
		enEdicion = null;
		modalAbierto = true;
	}
	function abrirEdicion(t: Tanqueo) {
		enEdicion = t;
		modalAbierto = true;
	}

	async function eliminar(t: Tanqueo) {
		if (
			!(await confirmarEliminacion({
				title: `¿Eliminar el tanqueo de ${t.vehiculo.placa}?`,
				message: `${fechaTanqueo(t.fecha_hora)} · ${numero(t.galones, 2)} gal · ${moneda(t.valor_total)}. El rendimiento del tramo vecino se recalcula sin él.`,
				confirmText: 'Eliminar'
			}))
		)
			return;
		try {
			await combustibleAPI.eliminar(t.id);
			toast.success('Tanqueo eliminado');
			void cargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
		}
	}

	async function verComprobante(t: Tanqueo) {
		/// La pestaña se abre ANTES de pedir la URL: abierta después de un
		/// `await`, el navegador la trata como ventana emergente y la bloquea.
		const ventana = window.open('', '_blank');
		try {
			const url = await combustibleAPI.urlComprobante(t.id);
			if (ventana) ventana.location.href = url;
			else window.location.href = url;
		} catch (error) {
			ventana?.close();
			toast.error(error instanceof Error ? error.message : 'No se pudo abrir el comprobante');
		}
	}

	let exportando = $state(false);
	async function exportar() {
		exportando = true;
		try {
			const blob = await combustibleAPI.exportar(consulta);
			const enlace = document.createElement('a');
			enlace.href = URL.createObjectURL(blob);
			const sufijo = [rango.desde, rango.hasta].filter(Boolean).join('_a_') || 'todo';
			enlace.download = `tanqueos-${sufijo}.csv`;
			enlace.click();
			setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo exportar');
		} finally {
			exportando = false;
		}
	}

	// ── Columnas ─────────────────────────────────────────────────────────
	const COLUMNAS: ColumnDef<Tanqueo, any>[] = [
		{ id: 'vehiculo', header: 'Vehículo · Conductor', enableSorting: false },
		{ id: 'fecha', header: 'Fecha', enableSorting: false, size: 130 },
		{ id: 'odometro', header: 'Odómetro', enableSorting: false, size: 130 },
		{ id: 'galones', header: 'Galones', enableSorting: false, size: 140 },
		{ id: 'valor', header: 'Valor', enableSorting: false, size: 130 },
		{ id: 'rendimiento', header: 'Rendimiento', enableSorting: false, size: 210 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];

	const COLUMNAS_VEHICULO: ColumnDef<RendimientoVehiculo, any>[] = [
		{ id: 'vehiculo', header: 'Vehículo', enableSorting: false },
		{ id: 'consumo', header: 'Tanqueos · Galones', enableSorting: false, size: 160 },
		{ id: 'gasto', header: 'Gasto', enableSorting: false, size: 140 },
		{ id: 'recorrido', header: 'Km medidos', enableSorting: false, size: 130 },
		{ id: 'rendimiento', header: 'Rendimiento', enableSorting: false, size: 170 },
		{ id: 'ultimo', header: 'Último tramo', enableSorting: false, size: 190 },
		{ id: 'costo', header: 'Costo por km', enableSorting: false, size: 130 }
	];

	const porcentaje = (d: number | null) =>
		d == null ? '' : `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))} %`;
</script>

<svelte:head>
	<title>Combustible — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Combustible</h1>
			<p class="dir-desc">
				Tanqueos de la flota, gasto y rendimiento en km por galón, medido entre tanqueos de tanque
				lleno. Una alerta es un tramo por debajo del 75 % de lo habitual del vehículo.
			</p>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={filtros.alertas ? 'alertas' : null}
					onElegir={elegirConteo}
				/>
			</div>
		</div>
		<div class="dir-cabecera-acciones">
			<button type="button" class="btn-secondary" onclick={exportar} disabled={exportando}>
				<Download size={16} strokeWidth={2.2} />
				{exportando ? 'Exportando…' : 'Exportar CSV'}
			</button>
			{#if puedeEscribir}
				<button type="button" class="btn-primary" onclick={abrirNuevo}>
					<Plus size={16} strokeWidth={2.4} />
					Registrar tanqueo
				</button>
			{/if}
		</div>
	</header>

	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{
					id: 'tanqueos',
					label: 'Tanqueos',
					cuenta: filtros.vista === 'tanqueos' ? (listado?.meta.total ?? null) : null
				},
				{ id: 'rendimiento', label: 'Rendimiento por vehículo' }
			]}
			activa={filtros.vista}
			etiqueta="Vistas de combustible"
			onCambiar={(v) => (filtros = { ...filtros, vista: v, pagina: 1 })}
		/>
	</div>

	<div class="dir-filtros cb-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<SegmentosFiltro
			etiqueta="Periodo"
			opciones={PERIODOS}
			valor={filtros.periodo === 'rango' ? '' : filtros.periodo}
			onCambiar={(v) => (filtros = { ...filtros, periodo: v, desde: '', hasta: '', pagina: 1 })}
		/>
		<div class="cb-fechas" class:cb-fechas--activo={filtros.periodo === 'rango'}>
			<label class="cb-sr" for="cb-desde">Desde</label>
			<input
				id="cb-desde"
				type="date"
				class="cb-fecha"
				value={rango.desde}
				max={rango.hasta || undefined}
				onchange={(e) => ponerFecha('desde', e.currentTarget.value)}
			/>
			<span aria-hidden="true">–</span>
			<label class="cb-sr" for="cb-hasta">Hasta</label>
			<input
				id="cb-hasta"
				type="date"
				class="cb-fecha"
				value={rango.hasta}
				min={rango.desde || undefined}
				onchange={(e) => ponerFecha('hasta', e.currentTarget.value)}
			/>
		</div>
		<div class="cb-select">
			<SelectBuscable
				opciones={opcionesVehiculo}
				valor={filtros.vehiculo || null}
				placeholder="Todos los vehículos"
				placeholderBusqueda="Placa o marca…"
				onSeleccionar={(v) => ponerFiltro('vehiculo', v ?? '')}
			/>
		</div>
		<div class="cb-select">
			<SelectBuscable
				opciones={opcionesConductor}
				valor={filtros.conductor || null}
				placeholder="Todos los conductores"
				placeholderBusqueda="Nombre o documento…"
				onSeleccionar={(v) => ponerFiltro('conductor', v ?? '')}
			/>
		</div>
		{#if hayFiltros}
			<button type="button" class="btn-secondary cb-limpiar" onclick={limpiarFiltros}>
				<X size={14} strokeWidth={2.4} /> Limpiar
			</button>
		{/if}
	</div>

	{#if filtros.vista === 'rendimiento'}
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_VEHICULO}
					datos={porVehiculo ?? []}
					claveFila={(v) => v.vehiculo.id}
					{cargando}
					onFila={(v) =>
						(filtros = { ...filtros, vista: 'tanqueos', vehiculo: v.vehiculo.id, pagina: 1 })}
					etiqueta="Rendimiento de combustible por vehículo"
				>
					{#snippet celda({ columnaId, fila: v })}
						{#if columnaId === 'vehiculo'}
							<CeldaIdentidad
								codigo={v.vehiculo.placa}
								titulo={[v.vehiculo.marca, v.vehiculo.linea].filter(Boolean).join(' ') ||
									'Sin marca'}
								subtitulo={`Último: ${numero(v.ultimo_km)} km · ${fechaTanqueo(v.ultimo_tanqueo)}`}
							/>
						{:else if columnaId === 'consumo'}
							<div class="dir-celda">
								<span class="cb-num">{v.tanqueos} · {numero(v.galones, 1)} gal</span>
								<small>{moneda(v.precio_galon)} por galón</small>
							</div>
						{:else if columnaId === 'gasto'}
							<span class="cb-num cb-fuerte">{moneda(v.gasto)}</span>
						{:else if columnaId === 'recorrido'}
							<div class="dir-celda">
								<span class="cb-num">{numero(v.km_recorridos)} km</span>
								<small>{v.tramos} {v.tramos === 1 ? 'tramo' : 'tramos'}</small>
							</div>
						{:else if columnaId === 'rendimiento'}
							<div class="dir-celda">
								<span class="cb-num cb-fuerte">{kmGal(v.rendimiento)}</span>
								<small>Histórico {kmGal(v.rendimiento_historico)}</small>
							</div>
						{:else if columnaId === 'ultimo'}
							{#if v.ultimo_tramo}
								<div class="dir-celda">
									<EstadoPunto
										etiqueta={v.ultimo_tramo.anomalo
											? `Bajo ${porcentaje(v.ultimo_tramo.desviacion)}`
											: kmGal(v.ultimo_tramo.rendimiento)}
										color={v.ultimo_tramo.anomalo ? ROJO : VERDE}
									/>
									<small>
										{v.alertas
											? `${v.alertas} ${v.alertas === 1 ? 'alerta' : 'alertas'} en el periodo`
											: v.ultimo_tramo.referencia
												? `Habitual ${kmGal(v.ultimo_tramo.referencia)}`
												: 'Sin referencia aún'}
									</small>
								</div>
							{:else}
								<span class="dir-nulo">Sin tramos medidos</span>
							{/if}
						{:else if columnaId === 'costo'}
							<span class="cb-num">{moneda(v.costo_km)}</span>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>Sin tanqueos en el periodo</h3>
							<p>
								El rendimiento aparece cuando un vehículo tiene dos tanqueos de tanque lleno
								seguidos.
							</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
		</div>
	{:else}
		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={listado?.data ?? []}
					claveFila={(t) => t.id}
					{cargando}
					onFila={puedeEscribir ? abrirEdicion : undefined}
					etiqueta="Tanqueos de combustible"
				>
					{#snippet celda({ columnaId, fila: t })}
						{#if columnaId === 'vehiculo'}
							<CeldaIdentidad
								codigo={t.vehiculo.placa}
								titulo={t.conductor?.nombre ?? 'Sin conductor'}
								subtitulo={[t.estacion, COMBUSTIBLE_LABELS[t.tipo_combustible]]
									.filter(Boolean)
									.join(' · ')}
							/>
						{:else if columnaId === 'fecha'}
							<div class="dir-celda dir-celda--fecha">
								<span>{fechaTanqueo(t.fecha_hora)}</span>
								<small>{horaTanqueo(t.fecha_hora)}</small>
							</div>
						{:else if columnaId === 'odometro'}
							<div class="dir-celda">
								<span class="cb-num">{numero(t.kilometraje)} km</span>
								<small>{t.tanque_lleno ? 'Tanque lleno' : 'Parcial'}</small>
							</div>
						{:else if columnaId === 'galones'}
							<div class="dir-celda">
								<span class="cb-num">{numero(t.galones, 2)} gal</span>
								<small>{moneda(t.precio_galon)} / gal</small>
							</div>
						{:else if columnaId === 'valor'}
							<span class="cb-num cb-fuerte">{moneda(t.valor_total)}</span>
						{:else if columnaId === 'rendimiento'}
							{#if t.rendimiento.estado === 'alerta'}
								<div class="dir-celda">
									<EstadoPunto
										etiqueta={`${kmGal(t.rendimiento.rendimiento)} · ${porcentaje(t.rendimiento.desviacion)}`}
										color={ROJO}
									/>
									<small>Habitual {kmGal(t.rendimiento.referencia)}</small>
								</div>
							{:else if t.rendimiento.estado === 'medido'}
								<div class="dir-celda">
									<span class="cb-num cb-fuerte">{kmGal(t.rendimiento.rendimiento)}</span>
									<small>
										{numero(t.rendimiento.km_recorridos)} km con {numero(
											t.rendimiento.galones_tramo,
											1
										)} gal{t.rendimiento.referencia
											? ` · habitual ${kmGal(t.rendimiento.referencia)}`
											: ''}
									</small>
								</div>
							{:else if t.rendimiento.estado === 'parcial'}
								<span class="dir-nulo">Parcial: suma al próximo lleno</span>
							{:else}
								<span class="dir-nulo">Punto de partida</span>
							{/if}
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'comprobante',
										etiqueta: 'Ver comprobante',
										icono: FileText,
										onClick: () => verComprobante(t),
										oculta: !t.comprobante
									},
									{
										id: 'editar',
										etiqueta: 'Editar',
										icono: Pencil,
										onClick: () => abrirEdicion(t),
										oculta: !puedeEscribir
									},
									{
										id: 'eliminar',
										etiqueta: 'Eliminar',
										icono: Trash2,
										onClick: () => eliminar(t),
										peligrosa: true,
										oculta: !puedeEscribir
									}
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota(hayFiltros ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>
								{filtros.alertas
									? 'Sin alertas de rendimiento'
									: hayFiltros
										? 'Sin resultados'
										: 'No hay tanqueos este mes'}
							</h3>
							<p>
								{filtros.alertas
									? 'Ningún tramo del periodo quedó por debajo de lo habitual de su vehículo.'
									: 'Registra cada tanqueo con el odómetro y si quedó con tanque lleno: con dos llenos seguidos aparece el rendimiento.'}
							</p>
							{#if hayFiltros}
								<button type="button" class="btn-secondary" onclick={limpiarFiltros}
									>Limpiar filtros</button
								>
							{:else if puedeEscribir}
								<button type="button" class="btn-primary" onclick={abrirNuevo}>
									<Plus size={16} strokeWidth={2.4} /> Registrar tanqueo
								</button>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				total={listado?.meta.total ?? 0}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="tanqueos"
				onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
			/>
		</div>
	{/if}
</div>

<ModalTanqueo
	open={modalAbierto}
	tanqueo={enEdicion}
	{catalogos}
	vehiculoInicial={filtros.vehiculo || null}
	oncerrar={() => (modalAbierto = false)}
	onguardado={() => {
		modalAbierto = false;
		void cargar();
	}}
/>

<style>
	.cb-filtros {
		align-items: flex-end;
	}
	.cb-fechas {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: 13px;
	}
	.cb-fecha {
		min-height: 38px;
		padding: 0 0.6rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 13px;
	}
	/* Rango a mano: las fechas son el filtro activo, se marcan como un segmento. */
	.cb-fechas--activo .cb-fecha {
		border-color: var(--emerald-500);
		color: var(--text-primary);
		font-weight: 600;
	}
	.cb-select {
		flex: 0 1 15rem;
		min-width: 12rem;
	}
	.cb-limpiar {
		min-height: 38px;
	}
	.cb-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.cb-num {
		font-variant-numeric: tabular-nums;
	}
	.cb-fuerte {
		font-weight: 700;
	}
</style>
