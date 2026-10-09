<script lang="ts">
	/**
	 * Bandeja de solicitudes web.
	 *
	 * Todo lo que entra por el formulario público de la landing (cotizaciones,
	 * servicios, información) aparece aquí con su radicado, una prioridad
	 * comercial y un nivel de riesgo con las señales que lo explican. La idea
	 * es que operaciones decida con datos a quién responder y en qué orden, en
	 * vez de atender llamadas «de ya para ya» sin saber quién está al otro lado.
	 *
	 * El detalle abre en un panel lateral (`?solicitud=<id>`, que también usan
	 * las notificaciones). Quien solo tiene lectura ve todo pero no gestiona.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { limpiar as limpiarFiltrosDe, numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { confirmar } from '$lib/stores/confirm';
	import { socketUtils } from '$lib/socket';
	import {
		solicitudesAPI,
		TIPO_LABELS,
		ESTADO_LABELS,
		PRIORIDAD_LABELS,
		RIESGO_LABELS,
		MODALIDAD_LABELS,
		type SolicitudResumen,
		type SolicitudDetalle,
		type ResumenSolicitudes,
		type EstadoSolicitud,
		type PrioridadSolicitud
	} from '$lib/api/solicitudes';

	// ─── Permisos ───────────────────────────────────────────────────────────
	const puedeGestionar = $derived.by(() => {
		const u = $authStore.user;
		if (!u) return false;
		const { allowed, level } = checkAccess(u.role || u.rol, u.area, 'solicitudes', u.permisos_rutas);
		return allowed && level === 'full';
	});

	// ─── Filtros en la URL ──────────────────────────────────────────────────
	interface Filtros {
		q: string;
		/// `PENDIENTES` agrupa nueva + en verificación + verificada: es la vista
		/// por defecto porque es lo que alguien tiene que mover.
		estado: string;
		tipo: string;
		prioridad: string;
		riesgo: string;
		pagina: number;
		orden: string;
		direccion: string;
	}
	const POR_PAGINA = 20;
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		estado: opcion('PENDIENTES'),
		tipo: opcion('TODOS'),
		prioridad: opcion('TODAS'),
		riesgo: opcion('TODOS'),
		pagina: numero(1),
		orden: opcion('created_at'),
		direccion: opcion('desc')
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	$effect(() => {
		void filtros;
		cargar();
	});

	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
	const hayFiltro = $derived(
		filtros.q.trim() !== '' ||
			filtros.estado !== 'PENDIENTES' ||
			filtros.tipo !== 'TODOS' ||
			filtros.prioridad !== 'TODAS' ||
			filtros.riesgo !== 'TODOS'
	);

	// ─── Datos ──────────────────────────────────────────────────────────────
	let items = $state<SolicitudResumen[]>([]);
	let pagination = $state({ page: 1, limit: POR_PAGINA, total: 0, pages: 1 });
	let resumen = $state<ResumenSolicitudes | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	async function cargar() {
		cargando = true;
		error = null;
		try {
			const params: Record<string, unknown> = {
				page: filtros.pagina,
				limit: POR_PAGINA,
				orden: filtros.orden,
				direccion: filtros.direccion
			};
			if (filtros.q.trim()) params.search = filtros.q.trim();
			if (filtros.estado === 'PENDIENTES') params.pendientes = true;
			else if (filtros.estado !== 'TODOS') params.estado = filtros.estado;
			if (filtros.tipo !== 'TODOS') params.tipo = filtros.tipo;
			if (filtros.prioridad !== 'TODAS') params.prioridad = filtros.prioridad;
			if (filtros.riesgo !== 'TODOS') params.riesgo = filtros.riesgo;
			const data = await solicitudesAPI.listar(params);
			items = data.items;
			pagination = data.pagination;
			resumen = data.resumen;
		} catch (err: any) {
			error = err?.response?.data?.message || err?.message || 'No se pudieron cargar las solicitudes';
			toast.error(error ?? 'Error');
		} finally {
			cargando = false;
		}
	}

	/// Una solicitud nueva llega como notificación por socket; con eso basta
	/// para refrescar la lista sin que el usuario tenga que recargar.
	function alLlegarNotificacion(n: { referencia_tipo?: string }) {
		if (n?.referencia_tipo === 'solicitud_web') cargar();
	}
	onMount(() => {
		socketUtils.on('nueva-notificacion', alLlegarNotificacion);
		return () => socketUtils.off('nueva-notificacion', alLlegarNotificacion);
	});

	// ─── Tabla ──────────────────────────────────────────────────────────────
	const COLUMNAS: ColumnDef<SolicitudResumen, any>[] = [
		{ id: 'created_at', accessorKey: 'created_at', header: 'Recibida', size: 120 },
		{ id: 'radicado', header: 'Radicado', enableSorting: false, size: 150 },
		{ id: 'solicitante', header: 'Solicitante', enableSorting: false },
		{ id: 'servicio', header: 'Qué pide', enableSorting: false },
		{ id: 'prioridad', accessorKey: 'prioridad', header: 'Prioridad', size: 100 },
		{ id: 'riesgo_puntaje', accessorKey: 'riesgo_puntaje', header: 'Riesgo', size: 120 },
		{ id: 'estado', accessorKey: 'estado', header: 'Estado', size: 140 },
		{ id: 'asignado', header: 'Asignada a', enableSorting: false, size: 140 }
	];
	const ordenTabla = $derived<SortingState>(
		filtros.orden ? [{ id: filtros.orden, desc: filtros.direccion === 'desc' }] : []
	);
	function aplicarOrden(nuevo: SortingState) {
		const primero = nuevo[0];
		filtros = {
			...filtros,
			orden: primero?.id ?? 'created_at',
			direccion: primero ? (primero.desc ? 'desc' : 'asc') : 'desc',
			pagina: 1
		};
	}

	// ─── Detalle ────────────────────────────────────────────────────────────
	let detalleId = $state<string | null>(null);
	let detalle = $state<SolicitudDetalle | null>(null);
	let cargandoDetalle = $state(false);
	let guardando = $state(false);
	let nota = $state('');

	async function abrir(id: string) {
		detalleId = id;
		detalle = null;
		nota = '';
		cargandoDetalle = true;
		try {
			detalle = await solicitudesAPI.detalle(id);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'No se pudo abrir la solicitud');
			detalleId = null;
		} finally {
			cargandoDetalle = false;
		}
	}
	function cerrar() {
		detalleId = null;
		detalle = null;
	}

	/// Enlace de notificación: se consume una vez y se quita de la URL.
	$effect(() => {
		const id = page.url.searchParams.get('solicitud');
		if (!id) return;
		const url = new URL(page.url);
		url.searchParams.delete('solicitud');
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		abrir(id);
	});

	async function gestionar(cambios: Parameters<typeof solicitudesAPI.gestionar>[1], mensajeOk: string) {
		if (!detalle || guardando) return;
		guardando = true;
		try {
			detalle = await solicitudesAPI.gestionar(detalle.id, cambios);
			toast.success(mensajeOk);
			cargar();
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'No se pudo guardar');
		} finally {
			guardando = false;
		}
	}

	async function cambiarEstado(estado: EstadoSolicitud) {
		if (!detalle || detalle.estado === estado) return;
		if (estado === 'descartada' || estado === 'spam') {
			const ok = await confirmar({
				title: estado === 'spam' ? 'Marcar como spam' : 'Descartar la solicitud',
				message:
					estado === 'spam'
						? 'Quedará fuera de los pendientes y el mismo contacto sumará riesgo si vuelve a escribir.'
						: 'Quedará fuera de los pendientes. Puedes dejar una nota con el motivo.',
				tone: 'warning',
				confirmText: estado === 'spam' ? 'Marcar spam' : 'Descartar'
			});
			if (!ok) return;
		}
		await gestionar({ estado }, `Solicitud ${ESTADO_LABELS[estado].label.toLowerCase()}`);
	}

	async function agregarNota() {
		const texto = nota.trim();
		if (!texto) return;
		await gestionar({ nota: texto }, 'Nota guardada');
		nota = '';
	}

	// ─── Formato ────────────────────────────────────────────────────────────
	function fechaCorta(iso: string | null) {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: '2-digit' });
	}
	/// `fecha_servicio` es un DATE a medianoche UTC: formatearla en Bogotá la
	/// correría un día atrás.
	function fechaDia(iso: string | null) {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
	}
	function fechaHora(iso: string) {
		return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
	}
	function tiempoRelativo(iso: string) {
		const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (min < 1) return 'hace un momento';
		if (min < 60) return `hace ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `hace ${h} h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `hace ${d} d`;
		return fechaCorta(iso);
	}
	function diasPara(iso: string | null) {
		if (!iso) return null;
		const hoy = new Date();
		const hoyUtc = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
		return Math.round((new Date(iso).getTime() - hoyUtc) / 86_400_000);
	}
	function soloDigitos(t: string) {
		const d = t.replace(/\D/g, '');
		return d.length === 10 ? `57${d}` : d;
	}
	function copiar(texto: string) {
		navigator.clipboard?.writeText(texto).then(() => toast.success('Copiado'));
	}

	const conteos = $derived.by(() => {
		const r = resumen;
		if (!r) return [];
		return [
			{ clave: 'PENDIENTES', etiqueta: 'Pendientes', valor: r.pendientes },
			{ clave: 'nueva', etiqueta: 'Nuevas', valor: r.estados.nueva ?? 0, color: ESTADO_LABELS.nueva.dot },
			{ clave: 'en_verificacion', etiqueta: 'En verificación', valor: r.estados.en_verificacion ?? 0, color: ESTADO_LABELS.en_verificacion.dot },
			{ clave: 'verificada', etiqueta: 'Verificadas', valor: r.estados.verificada ?? 0, color: ESTADO_LABELS.verificada.dot },
			{ clave: 'atendida', etiqueta: 'Atendidas', valor: r.estados.atendida ?? 0, color: ESTADO_LABELS.atendida.dot },
			{ clave: 'descartada', etiqueta: 'Descartadas', valor: (r.estados.descartada ?? 0) + (r.estados.spam ?? 0), color: ESTADO_LABELS.descartada.dot }
		];
	});

	const ESTADOS_GESTION: EstadoSolicitud[] = ['en_verificacion', 'verificada', 'atendida', 'descartada', 'spam'];
</script>

<svelte:head>
	<title>Solicitudes web · Panel</title>
</svelte:head>

<div class="min-h-screen bg-[#f7faf8] px-5 pb-12 pt-6 font-sans text-zinc-900" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
	<!-- ═══ Cabecera ═══ -->
	<header class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" in:fade={{ duration: 400 }}>
		<div class="max-w-2xl">
			<span class="inline-block rounded-md bg-emerald-600/10 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-emerald-700">
				Operaciones · Bandeja de entrada
			</span>
			<h1 class="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">Solicitudes web</h1>
			<p class="mt-1 text-sm text-zinc-600">
				Cotizaciones, servicios y consultas que llegan por el formulario del sitio web. Cada una entra con un
				radicado, una prioridad y las señales que explican si conviene verificarla antes de responder.
			</p>
		</div>
		{#if resumen && resumen.pendientes_riesgo_alto > 0}
			<div class="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
				<span class="h-2 w-2 rounded-full bg-red-600" aria-hidden="true"></span>
				<strong>{resumen.pendientes_riesgo_alto}</strong> pendiente{resumen.pendientes_riesgo_alto === 1 ? '' : 's'} con riesgo alto
			</div>
		{/if}
	</header>

	<div class="mb-4"><ResumenConteos {conteos} activo={filtros.estado} onElegir={(c) => ponerFiltro('estado', c)} /></div>

	<!-- ═══ Filtros ═══ -->
	<div class="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3" in:fade={{ duration: 400, delay: 100 }}>
		<div class="min-w-[260px] flex-1">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(t) => ponerFiltro('q', t)}
				placeholder="Buscar por radicado, nombre, empresa, correo, teléfono o ruta…"
				etiqueta="Buscar solicitudes web"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Estado"
			valor={filtros.estado}
			onCambiar={(v) => ponerFiltro('estado', v)}
			opciones={[
				{ valor: 'PENDIENTES', etiqueta: 'Pendientes' },
				{ valor: 'TODOS', etiqueta: 'Todas' },
				...Object.entries(ESTADO_LABELS).map(([k, v]) => ({ valor: k, etiqueta: v.label, punto: v.dot }))
			]}
		/>
		<SegmentosFiltro
			etiqueta="Tipo"
			valor={filtros.tipo}
			onCambiar={(v) => ponerFiltro('tipo', v)}
			opciones={[{ valor: 'TODOS', etiqueta: 'Todos' }, ...Object.entries(TIPO_LABELS).map(([k, v]) => ({ valor: k, etiqueta: v }))]}
		/>
		<SegmentosFiltro
			etiqueta="Prioridad"
			valor={filtros.prioridad}
			onCambiar={(v) => ponerFiltro('prioridad', v)}
			opciones={[{ valor: 'TODAS', etiqueta: 'Todas' }, ...Object.entries(PRIORIDAD_LABELS).map(([k, v]) => ({ valor: k, etiqueta: v.label }))]}
		/>
		<SegmentosFiltro
			etiqueta="Riesgo"
			valor={filtros.riesgo}
			onCambiar={(v) => ponerFiltro('riesgo', v)}
			opciones={[{ valor: 'TODOS', etiqueta: 'Todos' }, ...Object.entries(RIESGO_LABELS).map(([k, v]) => ({ valor: k, etiqueta: v.label.replace('Riesgo ', ''), punto: v.dot }))]}
		/>
		{#if hayFiltro}
			<button type="button" class="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline" onclick={() => (filtros = limpiarFiltrosDe(DEFS, filtros))}>
				Limpiar
			</button>
		{/if}
	</div>

	<!-- ═══ Lista ═══ -->
	{#if error && items.length === 0}
		<div class="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" in:fade>
			<span>{error}</span>
			<button type="button" class="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100" onclick={cargar}>Reintentar</button>
		</div>
	{:else if !cargando && items.length === 0}
		<div class="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center" in:fade>
			<h3 class="text-base font-semibold text-zinc-800">
				{hayFiltro ? 'Nada con esos filtros' : 'No hay solicitudes pendientes'}
			</h3>
			<p class="mx-auto mt-1 max-w-md text-sm text-zinc-500">
				{hayFiltro
					? 'Ajusta los criterios o limpia los filtros para ver el resto.'
					: 'Cuando alguien diligencie el formulario del sitio web aparecerá aquí con su radicado.'}
			</p>
		</div>
	{:else}
		<div class="rounded-2xl border border-zinc-200 bg-white">
			<TablaLista
				columnas={COLUMNAS}
				datos={items}
				claveFila={(f) => f.id}
				cargando={cargando}
				orden={ordenTabla}
				onOrdenar={aplicarOrden}
				onFila={(f) => abrir(f.id)}
				etiqueta="Solicitudes web recibidas"
			>
				{#snippet celda({ columnaId, fila, valor })}
					{#if columnaId === 'created_at'}
						<div class="flex flex-col leading-tight">
							<span class="text-sm text-zinc-800">{fechaCorta(fila.created_at)}</span>
							<span class="text-xs text-zinc-400">{tiempoRelativo(fila.created_at)}</span>
						</div>
					{:else if columnaId === 'radicado'}
						<div class="flex flex-col gap-1 leading-tight">
							<span class="font-mono text-xs font-semibold text-zinc-700">{fila.radicado}</span>
							<span class="flex items-center gap-1.5 text-xs text-zinc-500">
								{TIPO_LABELS[fila.tipo]}
								{#if fila.urgente}
									<span class="rounded bg-red-600 px-1.5 py-px text-[0.65rem] font-bold uppercase tracking-wide text-white">Urgente</span>
								{/if}
							</span>
						</div>
					{:else if columnaId === 'solicitante'}
						<div class="flex flex-col leading-tight">
							<span class="text-sm font-medium text-zinc-900">{fila.nombre}</span>
							<span class="text-xs text-zinc-500">
								{fila.empresa ?? 'Sin empresa'}{#if fila.cliente_id}<span class="ml-1 rounded bg-emerald-600/10 px-1.5 py-px text-[0.65rem] font-semibold text-emerald-700">cliente</span>{/if}
							</span>
						</div>
					{:else if columnaId === 'servicio'}
						{@const dias = diasPara(fila.fecha_servicio)}
						<div class="flex flex-col leading-tight">
							{#if fila.origen || fila.destino}
								<span class="text-sm text-zinc-800">{fila.origen ?? '?'} → {fila.destino ?? '?'}</span>
							{:else}
								<span class="text-sm text-zinc-400">Sin ruta</span>
							{/if}
							<span class="text-xs text-zinc-500">
								{#if fila.fecha_servicio}{fechaDia(fila.fecha_servicio)}{#if dias !== null && dias >= 0 && dias <= 7}<span class="text-amber-700"> · en {dias} d</span>{/if}{/if}
								{#if fila.pasajeros}{fila.fecha_servicio ? ' · ' : ''}{fila.pasajeros} pax{/if}
							</span>
						</div>
					{:else if columnaId === 'prioridad'}
						{@const p = PRIORIDAD_LABELS[fila.prioridad]}
						<span class="inline-block rounded-md px-2 py-0.5 text-xs font-semibold" style="background:{p.bg};color:{p.color}">{p.label}</span>
					{:else if columnaId === 'riesgo_puntaje'}
						{@const r = RIESGO_LABELS[fila.riesgo_nivel]}
						<span class="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style="background:{r.bg};color:{r.color}">
							<span class="h-1.5 w-1.5 rounded-full" style="background:{r.dot}" aria-hidden="true"></span>
							{r.label.replace('Riesgo ', '')} · {fila.riesgo_puntaje}
						</span>
					{:else if columnaId === 'estado'}
						{@const e = ESTADO_LABELS[fila.estado]}
						<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:{e.bg};color:{e.color}">
							<span class="h-1.5 w-1.5 rounded-full" style="background:{e.dot}" aria-hidden="true"></span>
							{e.label}
						</span>
					{:else if columnaId === 'asignado'}
						<span class="text-sm {fila.asignado_a ? 'text-zinc-800' : 'text-zinc-400'}">{fila.asignado_a?.nombre ?? 'Nadie'}</span>
					{:else}
						{valor ?? ''}
					{/if}
				{/snippet}
			</TablaLista>
		</div>
		<PaginadorLista pagina={filtros.pagina} total={pagination.total} porPagina={POR_PAGINA} {cargando} nombreItems="solicitudes" onCambiar={(p) => (filtros = { ...filtros, pagina: p })} />
	{/if}
</div>

<!-- ═══ Panel de detalle ═══ -->
{#if detalleId}
	<button type="button" class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" aria-label="Cerrar" onclick={cerrar} transition:fade={{ duration: 150 }}></button>
	<aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl" transition:fly={{ x: 40, duration: 250, easing: quintOut }} aria-label="Detalle de la solicitud">
		{#if cargandoDetalle || !detalle}
			<div class="flex flex-1 items-center justify-center text-sm text-zinc-500">Cargando…</div>
		{:else}
			{@const d = detalle}
			{@const e = ESTADO_LABELS[d.estado]}
			{@const r = RIESGO_LABELS[d.riesgo_nivel]}
			{@const p = PRIORIDAD_LABELS[d.prioridad]}
			<header class="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<button type="button" class="font-mono text-xs font-semibold text-zinc-600 hover:text-emerald-700" onclick={() => copiar(d.radicado)} title="Copiar radicado">{d.radicado}</button>
						<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:{e.bg};color:{e.color}">
							<span class="h-1.5 w-1.5 rounded-full" style="background:{e.dot}" aria-hidden="true"></span>{e.label}
						</span>
						{#if d.urgente}<span class="rounded bg-red-600 px-1.5 py-px text-[0.65rem] font-bold uppercase tracking-wide text-white">Urgente</span>{/if}
					</div>
					<h2 class="mt-1 truncate text-lg font-semibold text-zinc-900">{d.nombre}</h2>
					<p class="text-sm text-zinc-500">
						{TIPO_LABELS[d.tipo]} · {d.empresa ?? 'sin empresa'}{d.cargo ? ` · ${d.cargo}` : ''} · recibida {fechaHora(d.created_at)}
					</p>
				</div>
				<button type="button" class="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" onclick={cerrar} aria-label="Cerrar">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</header>

			<div class="flex-1 space-y-6 overflow-y-auto px-6 py-5">
				<!-- Veredicto -->
				<section class="grid grid-cols-2 gap-3">
					<div class="rounded-xl border p-3" style="background:{r.bg};border-color:{r.dot}33">
						<p class="text-[0.65rem] font-bold uppercase tracking-wider" style="color:{r.color}">{r.label}</p>
						<p class="mt-0.5 text-2xl font-semibold" style="color:{r.color}">{d.riesgo_puntaje} <span class="text-sm font-normal">pts</span></p>
					</div>
					<div class="rounded-xl border border-zinc-200 p-3" style="background:{p.bg}">
						<p class="text-[0.65rem] font-bold uppercase tracking-wider" style="color:{p.color}">Prioridad {p.label.toLowerCase()}</p>
						{#if puedeGestionar}
							<select class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm" value={d.prioridad} disabled={guardando} onchange={(ev) => gestionar({ prioridad: (ev.currentTarget as HTMLSelectElement).value as PrioridadSolicitud }, 'Prioridad actualizada')}>
								{#each Object.entries(PRIORIDAD_LABELS) as [k, v]}<option value={k}>{v.label}</option>{/each}
							</select>
						{:else}
							<p class="mt-0.5 text-sm text-zinc-700">Definida al recibirla</p>
						{/if}
					</div>
				</section>

				{#if d.senales.length}
					<section>
						<h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Por qué este riesgo</h3>
						<ul class="space-y-1.5">
							{#each d.senales as s}
								<li class="flex items-start gap-2 text-sm">
									<span class="mt-0.5 inline-block w-8 shrink-0 rounded px-1 text-center font-mono text-[0.7rem] font-semibold {s.peso > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-600/10 text-emerald-700'}">{s.peso > 0 ? '+' : ''}{s.peso}</span>
									<span class="text-zinc-700">{s.texto}</span>
								</li>
							{/each}
						</ul>
					</section>
				{:else}
					<p class="rounded-xl bg-emerald-600/5 px-4 py-3 text-sm text-emerald-800">Sin señales de alerta: datos completos, con tiempo y sin antecedentes.</p>
				{/if}

				{#if d.cliente}
					<p class="rounded-xl border border-emerald-600/20 bg-emerald-600/5 px-4 py-3 text-sm text-emerald-900">
						Coincide con el cliente <strong>{d.cliente.nombre ?? '—'}</strong>{d.cliente.nit ? ` (NIT ${d.cliente.nit})` : ''}. Confirma con el contacto habitual de esa empresa antes de dar por buena la solicitud.
					</p>
				{/if}

				<!-- Contacto -->
				<section>
					<h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Contacto</h3>
					<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-zinc-500">Correo</dt><dd class="font-mono text-zinc-800">{d.correo}</dd>
						<dt class="text-zinc-500">Teléfono</dt><dd class="font-mono text-zinc-800">{d.telefono}</dd>
						<dt class="text-zinc-500">Documento</dt><dd class="font-mono text-zinc-800">{d.documento ?? '—'}</dd>
					</dl>
					<div class="mt-3 flex flex-wrap gap-2">
						<a class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50" href={`https://wa.me/${soloDigitos(d.telefono)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
						<a class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50" href={`tel:${d.telefono.replace(/\s/g, '')}`}>Llamar</a>
						<a class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50" href={`mailto:${d.correo}?subject=${encodeURIComponent(`Solicitud ${d.radicado}`)}`}>Correo</a>
					</div>
				</section>

				<!-- Servicio -->
				<section>
					<h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Lo que pide</h3>
					<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-zinc-500">Ruta</dt><dd class="text-zinc-800">{d.origen || d.destino ? `${d.origen ?? '?'} → ${d.destino ?? '?'}` : '—'}</dd>
						<dt class="text-zinc-500">Fecha</dt><dd class="text-zinc-800">{fechaDia(d.fecha_servicio)}</dd>
						<dt class="text-zinc-500">Pasajeros</dt><dd class="text-zinc-800">{d.pasajeros ?? '—'}</dd>
						<dt class="text-zinc-500">Vehículo</dt><dd class="text-zinc-800">{d.tipo_vehiculo ?? '—'}</dd>
						<dt class="text-zinc-500">Modalidad</dt><dd class="text-zinc-800">{d.modalidad ? MODALIDAD_LABELS[d.modalidad] : '—'}</dd>
					</dl>
					<blockquote class="mt-3 whitespace-pre-wrap rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-800">{d.mensaje}</blockquote>
				</section>

				<!-- Antecedentes -->
				<section>
					<h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Antecedentes del mismo contacto</h3>
					{#if d.antecedentes.length}
						<ul class="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
							{#each d.antecedentes as a}
								{@const ae = ESTADO_LABELS[a.estado]}
								<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
									<button type="button" class="min-w-0 text-left hover:text-emerald-700" onclick={() => abrir(a.id)}>
										<span class="font-mono text-xs text-zinc-600">{a.radicado}</span>
										<span class="ml-2 text-zinc-800">{a.nombre}</span>
										<span class="ml-1 text-xs text-zinc-400">· {TIPO_LABELS[a.tipo]} · {fechaCorta(a.created_at)} · mismo {a.coincide.join(' y ')}</span>
									</button>
									<span class="shrink-0 rounded-full px-2 py-0.5 text-xs" style="background:{ae.bg};color:{ae.color}">{ae.label}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-zinc-500">Primera vez que escribe desde este teléfono, correo o conexión.</p>
					{/if}
				</section>

				<!-- Gestión -->
				{#if puedeGestionar}
					<section class="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
						<h3 class="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Gestión</h3>
						<div class="flex flex-wrap gap-2">
							{#each ESTADOS_GESTION as est}
								{@const l = ESTADO_LABELS[est]}
								<button
									type="button"
									class="rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
									class:border-zinc-300={d.estado !== est}
									class:bg-white={d.estado !== est}
									class:text-zinc-800={d.estado !== est}
									style={d.estado === est ? `background:${l.bg};color:${l.color};border-color:${l.dot}` : ''}
									disabled={guardando || d.estado === est}
									onclick={() => cambiarEstado(est)}
								>
									{l.label}
								</button>
							{/each}
						</div>
						<label class="mt-4 block text-sm">
							<span class="text-zinc-600">Asignada a</span>
							<select class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm" value={d.asignado_a_id ?? ''} disabled={guardando} onchange={(ev) => gestionar({ asignado_a_id: (ev.currentTarget as HTMLSelectElement).value || null }, 'Asignación guardada')}>
								<option value="">Nadie</option>
								{#each d.candidatos as c}<option value={c.id}>{c.nombre}</option>{/each}
							</select>
						</label>
						<label class="mt-4 block text-sm">
							<span class="text-zinc-600">Nota interna</span>
							<textarea class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm" rows="2" placeholder="Qué se verificó, con quién se habló, qué se cotizó…" bind:value={nota} disabled={guardando}></textarea>
						</label>
						<div class="mt-2 flex justify-end">
							<button type="button" class="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" disabled={guardando || !nota.trim()} onclick={agregarNota}>Guardar nota</button>
						</div>
					</section>
				{/if}

				<!-- Historial -->
				<section>
					<h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Historial</h3>
					<ol class="space-y-3 border-l border-zinc-200 pl-4">
						{#each [...d.historial].reverse() as ev}
							<li class="relative text-sm">
								<span class="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-zinc-400" aria-hidden="true"></span>
								<p class="text-zinc-800">
									<strong>{ev.por}</strong>
									{#if ev.accion === 'recibida'}recibió la solicitud{:else if ev.accion === 'estado'}cambió el estado{:else if ev.accion === 'prioridad'}cambió la prioridad{:else if ev.accion === 'asignacion'}asignó{:else if ev.accion === 'nota'}anotó{:else}{ev.accion}{/if}
									<span class="text-xs text-zinc-400"> · {fechaHora(ev.en)}</span>
								</p>
								{#if ev.detalle}<p class="mt-0.5 whitespace-pre-wrap text-zinc-600">{ev.detalle}</p>{/if}
							</li>
						{/each}
					</ol>
				</section>

				<!-- Técnico -->
				<details class="text-xs text-zinc-500">
					<summary class="cursor-pointer">Datos técnicos del envío</summary>
					<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
						<dt>Sitio</dt><dd class="font-mono">{d.origen_sitio ?? '—'}</dd>
						<dt>IP</dt><dd class="font-mono">{d.ip_origen ?? '—'}</dd>
						<dt>Tiempo</dt><dd class="font-mono">{d.tiempo_llenado_ms !== null ? `${Math.round(d.tiempo_llenado_ms / 1000)} s` : '—'}</dd>
						<dt>Navegador</dt><dd class="break-all font-mono">{d.user_agent ?? '—'}</dd>
						<dt>Referer</dt><dd class="break-all font-mono">{d.referer ?? '—'}</dd>
					</dl>
				</details>
			</div>
		{/if}
	</aside>
{/if}
