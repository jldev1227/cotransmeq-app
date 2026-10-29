<script lang="ts">
	/**
	 * Accidentes, incidentes y casi-accidentes.
	 *
	 * Lista con el estado de cada reporte y su plazo de investigación (15 días,
	 * Res. 1401 de 2007), y una pestaña de indicadores. El reporte se registra
	 * en un modal; la investigación, las evidencias y las acciones viven en el
	 * detalle (`/dashboard/incidentes/[id]`), cuyo «Volver» regresa a esta misma
	 * URL con sus filtros.
	 *
	 * Filtros, página y pestaña viven en la URL: un enlace filtrado se puede
	 * compartir y recargar no pierde nada.
	 */
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Eye } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import ModalReporteIncidente from '$lib/components/incidentes/ModalReporteIncidente.svelte';
	import IndicadoresIncidentes from '$lib/components/incidentes/IndicadoresIncidentes.svelte';
	import { mascota } from '$lib/mascot';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		firma,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { listadoIncidentes } from '$lib/incidentes/listado';
	import {
		incidentesAPI,
		mensajeError,
		fechaCorta,
		ESTADO_LABELS,
		SEVERIDAD_LABELS,
		TIPO_LABELS,
		type IncidenteResumen,
		type IndicadoresIncidentes as Indicadores,
		type ResumenIncidentes,
		type Severidad
	} from '$lib/api/incidentes';

	// ─── Permisos ───────────────────────────────────────────────────────────
	/// Lectura entra a la pantalla; reportar pide `incidentes` en `full`. El
	/// backend aplica lo mismo: esto solo evita ofrecer un botón que daría 403.
	const puedeReportar = $derived.by(() => {
		const u = $authStore.user;
		if (!u) return false;
		const { allowed, level } = checkAccess(u.area, 'incidentes', u.permisos_rutas, u.id);
		return allowed && level === 'full';
	});

	// ─── Filtros en la URL ──────────────────────────────────────────────────
	interface Filtros {
		q: string;
		/// `vencidos`: sin cerrar y con el plazo de 15 días cumplido.
		estado: string;
		tipo: string;
		gravedad: string;
		desde: string;
		hasta: string;
		pagina: number;
		vista: string;
	}
	const POR_PAGINA = 20;
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		estado: opcion('todos'),
		tipo: opcion('todos'),
		gravedad: opcion('todas'),
		desde: texto(),
		hasta: texto(),
		pagina: numero(1),
		vista: opcion('reportes')
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leerInicial());
	let mostrarFiltros = $state(false);

	/// Depende de la FIRMA, no del objeto: leer `filtros` no suscribe a sus campos.
	const firmaFiltros = $derived(firma(DEFS, filtros));
	$effect(() => {
		void firmaFiltros;
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/// Lo que cambia la consulta al servidor: todo menos la pestaña.
	const firmaDatos = $derived(firma(DEFS, { ...filtros, vista: 'reportes' }));
	$effect(() => {
		void firmaDatos;
		if (!browser) return;
		untrack(() => void cargar());
	});

	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	const chips = $derived([
		...(filtros.gravedad !== 'todas'
			? [
					{
						key: 'gravedad',
						label: 'Gravedad',
						value: SEVERIDAD_LABELS[filtros.gravedad as Severidad] ?? filtros.gravedad
					}
				]
			: []),
		...(filtros.desde ? [{ key: 'desde', label: 'Desde', value: fechaCorta(filtros.desde) }] : []),
		...(filtros.hasta ? [{ key: 'hasta', label: 'Hasta', value: fechaCorta(filtros.hasta) }] : [])
	]);
	const hayFiltro = $derived(
		filtros.q.trim() !== '' ||
			filtros.estado !== 'todos' ||
			filtros.tipo !== 'todos' ||
			chips.length > 0
	);

	// ─── Datos ──────────────────────────────────────────────────────────────
	let items = $state<IncidenteResumen[]>([]);
	let total = $state(0);
	let resumen = $state<ResumenIncidentes | null>(null);
	let cargando = $state(true);
	let indicadores = $state<Indicadores | null>(null);
	let cargandoIndicadores = $state(false);

	async function cargar() {
		cargando = true;
		try {
			const params: Record<string, unknown> = { page: filtros.pagina, limit: POR_PAGINA };
			if (filtros.q.trim()) params.q = filtros.q.trim();
			if (filtros.estado === 'vencidos') params.plazo = 'vencido';
			else if (filtros.estado !== 'todos') params.estado = filtros.estado;
			if (filtros.tipo !== 'todos') params.tipo = filtros.tipo;
			if (filtros.gravedad !== 'todas') params.severidad = filtros.gravedad;
			if (filtros.desde) params.desde = filtros.desde;
			if (filtros.hasta) params.hasta = filtros.hasta;
			const r = await incidentesAPI.listar(params);
			items = r.items;
			total = r.pagination.total;
			resumen = r.resumen;
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudieron cargar los incidentes'));
		} finally {
			cargando = false;
		}
	}

	async function cargarIndicadores() {
		cargandoIndicadores = true;
		try {
			indicadores = await incidentesAPI.indicadores(12);
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudieron calcular los indicadores'));
		} finally {
			cargandoIndicadores = false;
		}
	}

	/// Los indicadores se piden la primera vez que se abre su pestaña.
	$effect(() => {
		if (filtros.vista !== 'indicadores') return;
		untrack(() => {
			if (!indicadores && !cargandoIndicadores) void cargarIndicadores();
		});
	});

	/// Una página fuera de rango (tras filtrar) vuelve a la última que existe.
	/// Solo con datos: antes de la primera carga `total` vale 0 y recortaría
	/// el `?pagina=3` que venía en la URL.
	$effect(() => {
		if (cargando || items.length === 0) return;
		const ultima = Math.max(1, Math.ceil(total / POR_PAGINA));
		if (filtros.pagina > ultima) untrack(() => (filtros = { ...filtros, pagina: ultima }));
	});

	/// Un reporte nuevo de otra persona llega como notificación: refresca la lista.
	function alLlegarNotificacion(n: { referencia_tipo?: string }) {
		if (n?.referencia_tipo?.startsWith('incidente')) {
			void cargar();
			indicadores = null;
			if (filtros.vista === 'indicadores') void cargarIndicadores();
		}
	}
	onMount(() => {
		socketUtils.on('nueva-notificacion', alLlegarNotificacion);
		return () => socketUtils.off('nueva-notificacion', alLlegarNotificacion);
	});

	/// Cada URL en que se asienta el listado queda como destino del «Volver» del detalle.
	afterNavigate(({ to }) => {
		if (to?.url) listadoIncidentes.recordar(to.url.pathname + to.url.search);
	});

	// ─── Presentación ───────────────────────────────────────────────────────
	const COLUMNAS: ColumnDef<IncidenteResumen, any>[] = [
		{ id: 'incidente', header: 'Reporte', enableSorting: false },
		{ id: 'lugar', header: 'Lugar', enableSorting: false },
		{ id: 'vehiculo', header: 'Vehículo · Conductor', enableSorting: false },
		{ id: 'gravedad', header: 'Gravedad', enableSorting: false },
		{ id: 'plazo', header: 'Investigación', enableSorting: false, size: 170 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 150 },
		{ id: 'acciones', header: '', enableSorting: false, size: 60 }
	];

	const conteos = $derived(
		resumen
			? [
					{ clave: 'todos', etiqueta: 'Total', valor: resumen.total },
					{
						clave: 'REPORTADO',
						etiqueta: 'Reportados',
						valor: resumen.REPORTADO,
						color: ESTADO_LABELS.REPORTADO.color
					},
					{
						clave: 'EN_INVESTIGACION',
						etiqueta: 'En investigación',
						valor: resumen.EN_INVESTIGACION,
						color: ESTADO_LABELS.EN_INVESTIGACION.color
					},
					{
						clave: 'CERRADO',
						etiqueta: 'Cerrados',
						valor: resumen.CERRADO,
						color: ESTADO_LABELS.CERRADO.color
					},
					{
						clave: 'vencidos',
						etiqueta: 'Plazo vencido',
						valor: resumen.vencidos,
						color: '#dc2626'
					}
				]
			: []
	);

	const SEGMENTOS_TIPO = [
		{ valor: 'todos', etiqueta: 'Todos' },
		...Object.entries(TIPO_LABELS).map(([valor, t]) => ({
			valor,
			etiqueta: t.corto,
			punto: t.color
		}))
	];

	function textoPlazo(i: IncidenteResumen): { texto: string; color: string } {
		if (i.estado === 'CERRADO') return { texto: 'Concluida', color: '#16a34a' };
		const d = i.plazo.dias_restantes ?? 0;
		if (d < 0)
			return { texto: `Vencida hace ${-d} ${-d === 1 ? 'día' : 'días'}`, color: '#dc2626' };
		if (d === 0) return { texto: 'Vence hoy', color: '#dc2626' };
		return {
			texto: `Vence en ${d} ${d === 1 ? 'día' : 'días'}`,
			color: d <= 3 ? '#d97706' : '#66756f'
		};
	}

	function textoGravedad(i: IncidenteResumen): string {
		if (!i.severidad) return i.tipo === 'CASI_ACCIDENTE' ? 'Sin consecuencias' : 'Sin daños';
		const victimas = [
			i.heridos ? `${i.heridos} lesionado${i.heridos === 1 ? '' : 's'}` : '',
			i.fallecidos ? `${i.fallecidos} fallecido${i.fallecidos === 1 ? '' : 's'}` : ''
		].filter(Boolean);
		return victimas.length ? victimas.join(' · ') : SEVERIDAD_LABELS[i.severidad];
	}

	let modalReporte = $state(false);
</script>

<svelte:head>
	<title>Incidentes · Panel</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 300 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Accidentes e incidentes</h1>
			<p class="dir-desc">
				Reporte, investigación (15 días, Res. 1401 de 2007) y acciones correctivas de cada evento
				vial.
			</p>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={filtros.estado === 'todos' ? null : filtros.estado}
					onElegir={(c) => ponerFiltro('estado', filtros.estado === c ? 'todos' : c)}
				/>
			</div>
		</div>
		<div class="dir-cabecera-acciones">
			<button
				onclick={() => (mostrarFiltros = !mostrarFiltros)}
				class="btn-secondary"
				style="border-color: {mostrarFiltros || chips.length
					? 'var(--emerald-500)'
					: 'var(--border-default)'}; color: {mostrarFiltros || chips.length
					? 'var(--emerald-800)'
					: 'var(--text-secondary)'};"
			>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				Filtros{chips.length ? ` (${chips.length})` : ''}
			</button>
			{#if puedeReportar}
				<button class="btn-primary" onclick={() => (modalReporte = true)}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Reportar evento
				</button>
			{/if}
		</div>

		<FilterDrawer
			open={mostrarFiltros}
			onClose={() => (mostrarFiltros = false)}
			eyebrow="Filtros"
			title="Refinar reportes"
			subtitle="Por gravedad y por fecha del evento."
			activeCount={chips.length}
		>
			<div slot="chips" class="flex flex-wrap gap-1.5">
				{#each chips as chip (chip.key)}
					<button
						class="filter-chip"
						onclick={() =>
							ponerFiltro(
								chip.key as keyof Filtros,
								DEFS[chip.key as keyof Filtros].porDefecto as never
							)}
					>
						<span style="color: var(--text-muted); font-weight: 500;">{chip.label}:</span>
						<span>{chip.value}</span>
					</button>
				{/each}
			</div>
			<div class="flex flex-col gap-5">
				<div class="filter-field">
					<label for="f-gravedad" class="filter-field-label">Gravedad</label>
					<select
						id="f-gravedad"
						value={filtros.gravedad}
						onchange={(e) => ponerFiltro('gravedad', (e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="todas">Todas</option>
						{#each Object.entries(SEVERIDAD_LABELS) as [valor, etiqueta]}<option value={valor}
								>{etiqueta}</option
							>{/each}
					</select>
				</div>
				<div class="filter-field">
					<label for="f-desde" class="filter-field-label">Desde</label>
					<input
						id="f-desde"
						type="date"
						class="inc-fecha"
						value={filtros.desde}
						onchange={(e) => ponerFiltro('desde', (e.currentTarget as HTMLInputElement).value)}
					/>
				</div>
				<div class="filter-field">
					<label for="f-hasta" class="filter-field-label">Hasta</label>
					<input
						id="f-hasta"
						type="date"
						class="inc-fecha"
						value={filtros.hasta}
						onchange={(e) => ponerFiltro('hasta', (e.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			</div>
			<div slot="footer">
				<button
					class="filter-clear"
					onclick={() => (filtros = limpiarFiltrosDe(DEFS, filtros, ['vista']))}
					disabled={!hayFiltro}
				>
					Limpiar
				</button>
				<button class="btn-primary" onclick={() => (mostrarFiltros = false)}>Ver resultados</button>
			</div>
		</FilterDrawer>
	</header>

	<TabsVista
		tabs={[
			{ id: 'reportes', label: 'Reportes', cuenta: resumen?.total ?? null },
			{ id: 'indicadores', label: 'Indicadores' }
		]}
		activa={filtros.vista}
		etiqueta="Vistas de incidentes"
		onCambiar={(id) => (filtros = { ...filtros, vista: id })}
	/>

	{#if filtros.vista === 'indicadores'}
		<div in:fly={{ y: 10, duration: 300 }}>
			<IndicadoresIncidentes datos={indicadores} cargando={cargandoIndicadores} />
		</div>
	{:else}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Radicado, placa, conductor, lugar o IPAT…"
					etiqueta="Buscar incidentes"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Tipo"
				opciones={SEGMENTOS_TIPO}
				valor={filtros.tipo}
				onCambiar={(v) => ponerFiltro('tipo', v)}
			/>
		</div>

		<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={items}
					claveFila={(i) => i.id}
					{cargando}
					onFila={(i) => goto(`/dashboard/incidentes/${i.id}`)}
					etiqueta="Reportes de accidentes e incidentes"
				>
					{#snippet celda({ columnaId, fila: i })}
						{#if columnaId === 'incidente'}
							<CeldaIdentidad
								codigo={i.codigo.replace('INC-', '')}
								titulo={TIPO_LABELS[i.tipo].label}
								subtitulo="{i.codigo} · {fechaCorta(i.fecha)}{i.hora ? ` · ${i.hora}` : ''}"
								punto={TIPO_LABELS[i.tipo].color}
							/>
						{:else if columnaId === 'lugar'}
							<div class="dir-celda">
								<span>{i.lugar ?? '—'}</span>
								<small
									>{i.municipio
										? `${i.municipio.nombre}, ${i.municipio.departamento}`
										: 'Sin municipio'}</small
								>
							</div>
						{:else if columnaId === 'vehiculo'}
							<div class="dir-celda">
								<span>{i.vehiculo?.placa ?? 'Sin vehículo'}</span>
								<small>{i.conductor?.nombre ?? 'Sin conductor'}</small>
							</div>
						{:else if columnaId === 'gravedad'}
							<div class="dir-celda">
								<span>{i.severidad ? SEVERIDAD_LABELS[i.severidad] : '—'}</span>
								<small>{textoGravedad(i)}</small>
							</div>
						{:else if columnaId === 'plazo'}
							{@const p = textoPlazo(i)}
							<div class="dir-celda">
								<span style="color:{p.color};font-weight:600">{p.texto}</span>
								<small
									>{i.estado === 'CERRADO'
										? `${i.acciones} acción(es)`
										: `Límite ${fechaCorta(i.plazo.limite)}`}</small
								>
							</div>
						{:else if columnaId === 'estado'}
							<EstadoPunto
								etiqueta={ESTADO_LABELS[i.estado].label}
								color={ESTADO_LABELS[i.estado].color}
								apagado={i.estado === 'CERRADO'}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'ver',
										etiqueta: 'Ver detalle',
										icono: Eye,
										onClick: () => goto(`/dashboard/incidentes/${i.id}`)
									}
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltro ? 'Nada con esos filtros' : 'Sin reportes'}</h3>
							<p>
								{hayFiltro
									? 'Ajusta los criterios o limpia los filtros para ver el resto.'
									: 'Cuando se reporte un accidente, incidente o casi-accidente aparecerá aquí con su plazo de investigación.'}
							</p>
							{#if hayFiltro}
								<button
									class="btn-secondary"
									onclick={() => (filtros = limpiarFiltrosDe(DEFS, filtros, ['vista']))}
									>Limpiar filtros</button
								>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				{total}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="reportes"
				onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
			/>
		</div>
	{/if}
</div>

<ModalReporteIncidente
	open={modalReporte}
	oncerrar={() => (modalReporte = false)}
	onguardado={(d) => {
		modalReporte = false;
		goto(`/dashboard/incidentes/${d.id}`);
	}}
/>

<style>
	.inc-fecha {
		width: 100%;
		min-height: 40px;
		padding: 8px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 14px;
	}
</style>
