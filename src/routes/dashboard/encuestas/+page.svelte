<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { ColumnDef } from '@tanstack/table-core';
	import { ArrowUpRight, Copy, ExternalLink, Plus } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { encuestasAPI, type Encuesta, type EncuestaInput } from '$lib/api/encuestas';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import { numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { coincide } from '$lib/listing/texto';

	const puedeGestionar = $derived.by(() => {
		const u = $authStore.user;
		return !!u && checkAccess(u.area, 'encuestas', u.permisos_rutas, u.id).level === 'full';
	});

	interface Filtros {
		q: string;
		estado: 'TODAS' | 'BORRADOR' | 'PUBLICADA' | 'CERRADA';
		pagina: number;
	}
	const POR_PAGINA = 20;
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		estado: opcion<'TODAS' | 'BORRADOR' | 'PUBLICADA' | 'CERRADA'>('TODAS'),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leerInicial());

	$effect(() => {
		void filtros.q;
		void filtros.estado;
		void filtros.pagina;
		estadoUrl.escribir(page.url, filtros);
	});

	let encuestas = $state<Encuesta[]>([]);
	let cargando = $state(true);
	let creando = $state(false);
	let error = $state('');

	const visibles = $derived(
		encuestas.filter((e) => {
			const coincideEstado = filtros.estado === 'TODAS' || e.estado === filtros.estado;
			return coincideEstado && coincide(filtros.q, [e.titulo, e.descripcion]);
		})
	);
	const paginaActual = $derived(
		visibles.slice((filtros.pagina - 1) * POR_PAGINA, filtros.pagina * POR_PAGINA)
	);
	const publicadas = $derived(encuestas.filter((e) => e.estado === 'PUBLICADA').length);
	const borradores = $derived(encuestas.filter((e) => e.estado === 'BORRADOR').length);
	const cerradas = $derived(encuestas.filter((e) => e.estado === 'CERRADA').length);
	const hayFiltros = $derived(filtros.q.trim().length > 0 || filtros.estado !== 'TODAS');

	/// El recorte espera los datos: aplicar `?pagina=3` antes de cargar dejaría
	/// visible solo una página vacía y perdería el enlace compartido.
	$effect(() => {
		if (cargando || visibles.length === 0) return;
		const maxPagina = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
		if (filtros.pagina > maxPagina) filtros = { ...filtros, pagina: maxPagina };
		if (filtros.pagina < 1) filtros = { ...filtros, pagina: 1 };
	});

	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	async function cargar() {
		try {
			encuestas = await encuestasAPI.listar();
			error = '';
		} catch (e: any) {
			error = e?.response?.data?.message || e?.message || 'No se pudieron cargar las encuestas';
		} finally {
			cargando = false;
		}
	}

	onMount(() => {
		void cargar();
		const baja = socketUtils.on('encuestas:respuesta', () => void cargar());
		const reconexion = socketUtils.onReconnect(() => void cargar());
		return () => {
			baja();
			reconexion();
		};
	});

	async function crear() {
		if (!puedeGestionar || creando) return;
		creando = true;
		try {
			const entrada: EncuestaInput = {
				titulo: 'Encuesta nueva', descripcion: '', mensaje_final: '¡Gracias por compartir tu opinión!',
				nombre_modo: 'NO', correo_modo: 'NO', registrar_origen: false,
				politica_origen: 'PERMITIR', fecha_cierre: null, preguntas: []
			};
			const encuesta = await encuestasAPI.crear(entrada);
			await goto(`/dashboard/encuestas/${encuesta.id}`);
		} catch (e: any) {
			toast.error(e?.response?.data?.message || e?.message || 'No se pudo crear la encuesta');
		} finally {
			creando = false;
		}
	}

	async function copiar(token: string) {
		try {
			await navigator.clipboard.writeText(encuestasAPI.enlace(token));
			toast.success('Enlace copiado');
		} catch {
			toast.error('No se pudo copiar el enlace');
		}
	}

	function fecha(valor: string) {
		return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(valor));
	}

	const COLUMNAS: ColumnDef<Encuesta, any>[] = [
		{ id: 'titulo', accessorKey: 'titulo', header: 'Encuesta' },
		{ id: 'estado', accessorKey: 'estado', header: 'Estado', size: 130 },
		{ id: 'respuestas', accessorFn: (e) => e._count?.respuestas ?? 0, header: 'Respuestas', size: 125 },
		{ id: 'preguntas', accessorFn: (e) => e.preguntas?.length ?? 0, header: 'Preguntas', size: 110 },
		{ id: 'created_at', accessorKey: 'created_at', header: 'Creada', size: 130 },
		{ id: 'acciones', header: 'Acciones', enableSorting: false, size: 200 }
	];
</script>

<svelte:head><title>Encuestas · Panel</title></svelte:head>

<div class="dir-pagina encuestas-pagina">
	<header class="page-card dir-cabecera">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Encuestas</h1>
			<p class="dir-desc">Crea cuestionarios, comparte el enlace y consulta las respuestas en tiempo real.</p>
			<div class="dir-conteos">
				<ResumenConteos
					conteos={[
						{ clave: 'TODAS', etiqueta: 'Todas', valor: encuestas.length },
						{ clave: 'BORRADOR', etiqueta: 'Borradores', valor: borradores, color: '#d99a24' },
						{ clave: 'PUBLICADA', etiqueta: 'Publicadas', valor: publicadas, color: 'var(--emerald-500)' },
						{ clave: 'CERRADA', etiqueta: 'Cerradas', valor: cerradas, color: '#87918d' }
					]}
					activo={filtros.estado}
					onElegir={(clave) => ponerFiltro('estado', clave as Filtros['estado'])}
				/>
			</div>
		</div>
		{#if puedeGestionar}
			<div class="dir-cabecera-acciones">
				<button type="button" class="btn-primary" onclick={() => void crear()} disabled={creando}>
					<Plus size={17} /> {creando ? 'Creando borrador…' : 'Nueva encuesta'}
				</button>
			</div>
		{/if}
	</header>

	<div class="dir-filtros">
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(q) => ponerFiltro('q', q)}
				placeholder="Buscar por título o descripción…"
				etiqueta="Buscar encuestas"
			/>
		</div>
		<p class="actualizacion"><span aria-hidden="true"></span> Respuestas en tiempo real</p>
	</div>

	{#if error}<p class="error page-card" role="alert">{error}</p>{/if}
	{#if cargando && encuestas.length === 0}
		<div class="estado-vacio page-card">Cargando encuestas…</div>
	{:else if visibles.length === 0}
		<div class="estado-vacio page-card">
			<strong>{hayFiltros ? 'No hay encuestas con estos filtros' : 'Aún no hay encuestas'}</strong>
			<p>{hayFiltros ? 'Prueba con otra búsqueda o cambia el estado seleccionado.' : 'Crea la primera y construye las preguntas que quieres compartir.'}</p>
			{#if puedeGestionar && !hayFiltros}
				<button type="button" class="btn-primary" onclick={() => void crear()} disabled={creando}><Plus size={16} /> Crear primera encuesta</button>
			{/if}
		</div>
	{:else}
		<section class="dir-lista" aria-label="Listado de encuestas">
			<div class="dir-lista-scroll">
				<TablaLista columnas={COLUMNAS} datos={paginaActual} claveFila={(e) => e.id} {cargando} etiqueta="Encuestas">
					{#snippet celda({ columnaId, fila: encuesta })}
						{#if columnaId === 'titulo'}
							<div class="celda-encuesta">
								<strong>{encuesta.titulo}</strong>
								<small>{encuesta.descripcion || 'Sin descripción'}</small>
							</div>
						{:else if columnaId === 'estado'}
							<span class="estado" class:publicada={encuesta.estado === 'PUBLICADA'} class:cerrada={encuesta.estado === 'CERRADA'}>
								{encuesta.estado === 'PUBLICADA' ? 'Publicada' : encuesta.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}
							</span>
						{:else if columnaId === 'respuestas'}
							<strong class="numero">{(encuesta._count?.respuestas ?? 0).toLocaleString('es-CO')}</strong>
						{:else if columnaId === 'preguntas'}
							<span>{encuesta.preguntas?.length ?? 0}</span>
						{:else if columnaId === 'created_at'}
							<span>{fecha(encuesta.created_at)}</span>
						{:else if columnaId === 'acciones'}
							<div class="acciones">
								<a class="abrir" href={`/dashboard/encuestas/${encuesta.id}`} aria-label="Abrir encuesta {encuesta.titulo}">Abrir <ArrowUpRight size={15} /></a>
								{#if encuesta.estado === 'PUBLICADA'}
									<button type="button" class="copiar" title="Copiar enlace público" aria-label="Copiar enlace de {encuesta.titulo}" onclick={(event) => { event.stopPropagation(); void copiar(encuesta.token); }}><Copy size={15} /> Copiar</button>
									<a class="publico" href={encuestasAPI.enlace(encuesta.token)} target="_blank" rel="noreferrer" aria-label="Abrir encuesta pública {encuesta.titulo}"><ExternalLink size={15} /></a>
								{/if}
							</div>
						{/if}
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				total={visibles.length}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="encuestas"
				onCambiar={(pagina) => (filtros = { ...filtros, pagina })}
			/>
		</section>
	{/if}
</div>

<style>
	.encuestas-pagina { overflow: auto; }
	.actualizacion { display: inline-flex; align-items: center; gap: .45rem; margin: 0 .25rem; color: var(--text-muted); font-size: .78rem; white-space: nowrap; }
	.actualizacion span { width: .5rem; height: .5rem; border-radius: 50%; background: var(--accion); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 14%, transparent); }
	.celda-encuesta { display: flex; flex-direction: column; gap: .2rem; min-width: 14rem; }
	.celda-encuesta strong { color: var(--text-primary); font-size: .83rem; }
	.celda-encuesta small { max-width: 38rem; color: var(--text-muted); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.estado { display: inline-flex; align-items: center; min-height: 1.45rem; padding: .15rem .55rem; border-radius: 999px; background: #fff5df; color: #805a10; font-size: .68rem; font-weight: 750; }
	.estado.publicada { background: color-mix(in srgb, var(--emerald-500) 13%, white); color: var(--emerald-800); }
	.estado.cerrada { background: var(--bg-subtle); color: var(--text-muted); }
	.numero { color: var(--text-primary); font-variant-numeric: tabular-nums; }
	.acciones { display: flex; align-items: center; gap: .4rem; white-space: nowrap; }
	.abrir, .copiar, .publico { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; min-height: 2rem; padding: 0 .55rem; border: 1px solid var(--border-default); border-radius: .65rem; background: var(--bg-surface); color: var(--text-secondary); font: inherit; font-size: .72rem; font-weight: 700; text-decoration: none; cursor: pointer; }
	.abrir { border-color: transparent; background: color-mix(in srgb, var(--accion) 10%, white); color: var(--accion); }
	.abrir:hover, .copiar:hover, .publico:hover { border-color: var(--accion); }
	.estado-vacio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .55rem; min-height: 12rem; padding: 2rem; text-align: center; color: var(--text-muted); }
	.estado-vacio strong { color: var(--text-primary); font-size: .95rem; }
	.estado-vacio p { margin: 0 0 .5rem; font-size: .8rem; }
	.error { color: #b42318; }
	@media (max-width: 640px) { .encuestas-pagina { padding: 1rem; } .actualizacion { display: none; } }
</style>
