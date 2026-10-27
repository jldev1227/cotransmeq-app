<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ArrowUpRight, Copy, Plus } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { encuestasAPI, type Encuesta, type EncuestaInput } from '$lib/api/encuestas';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';

	const puedeGestionar = $derived.by(() => {
		const u = $authStore.user;
		return !!u && checkAccess(u.role || u.rol, u.area, 'encuestas', u.permisos_rutas).level === 'full';
	});

	let encuestas = $state<Encuesta[]>([]);
	let cargando = $state(true);
	let creando = $state(false);
	let busqueda = $state('');
	let estadoFiltro = $state<'TODAS' | 'BORRADOR' | 'PUBLICADA' | 'CERRADA'>('TODAS');
	let error = $state('');

	const visibles = $derived(
		encuestas.filter((e) => {
			const coincideEstado = estadoFiltro === 'TODAS' || e.estado === estadoFiltro;
			const texto = `${e.titulo} ${e.descripcion ?? ''}`.toLocaleLowerCase('es');
			return coincideEstado && texto.includes(busqueda.trim().toLocaleLowerCase('es'));
		})
	);
	const publicadas = $derived(encuestas.filter((e) => e.estado === 'PUBLICADA').length);
	const borradores = $derived(encuestas.filter((e) => e.estado === 'BORRADOR').length);
	const cerradas = $derived(encuestas.filter((e) => e.estado === 'CERRADA').length);

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
		return () => { baja(); reconexion(); };
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
					activo={estadoFiltro}
					onElegir={(clave) => (estadoFiltro = clave as typeof estadoFiltro)}
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
			<BuscadorLista bind:valor={busqueda} onBuscar={() => {}} placeholder="Buscar por título o descripción…" etiqueta="Buscar encuestas" />
		</div>
		<p class="actualizacion"><span aria-hidden="true"></span> Respuestas en tiempo real</p>
	</div>
	{#if error}<p class="error page-card" role="alert">{error}</p>{/if}
	{#if cargando}<div class="estado-vacio page-card">Cargando encuestas…</div>
	{:else if visibles.length === 0}
		<div class="estado-vacio page-card">
			<strong>{busqueda || estadoFiltro !== 'TODAS' ? 'No hay encuestas con estos filtros' : 'Aún no hay encuestas'}</strong>
			<p>{busqueda || estadoFiltro !== 'TODAS' ? 'Prueba con otra búsqueda o cambia el estado seleccionado.' : 'Crea la primera y construye las preguntas que quieres compartir.'}</p>
			{#if puedeGestionar && !busqueda && estadoFiltro === 'TODAS'}
				<button type="button" class="btn-primary" onclick={() => void crear()} disabled={creando}><Plus size={16} /> Crear primera encuesta</button>
			{/if}
		</div>
	{:else}
		<div class="rejilla-encuestas">
			{#each visibles as encuesta (encuesta.id)}
				<article class="encuesta-card page-card">
					<div class="encuesta-card-meta">
						<span class="estado" class:publicada={encuesta.estado === 'PUBLICADA'} class:cerrada={encuesta.estado === 'CERRADA'}>{encuesta.estado === 'PUBLICADA' ? 'Publicada' : encuesta.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</span>
						<span class="fecha">Creada el {fecha(encuesta.created_at)}</span>
					</div>
					<h2>{encuesta.titulo}</h2>
					<p class="descripcion">{encuesta.descripcion || 'Sin descripción'}</p>
					<div class="encuesta-card-resumen">
						<div><strong>{encuesta._count?.respuestas ?? 0}</strong><span>Respuestas</span></div>
						<div><strong>{encuesta.preguntas?.length ?? 0}</strong><span>Preguntas</span></div>
					</div>
					<div class="encuesta-card-acciones">
						<a class="abrir-tablero" href={`/dashboard/encuestas/${encuesta.id}`}>Abrir encuesta <ArrowUpRight size={16} /></a>
						{#if encuesta.estado === 'PUBLICADA'}
							<button type="button" class="copiar-enlace" title="Copiar enlace público" aria-label="Copiar enlace de {encuesta.titulo}" onclick={() => void copiar(encuesta.token)}><Copy size={16} /> Copiar enlace</button>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.encuestas-pagina { overflow: auto; }
	.actualizacion { display: inline-flex; align-items: center; gap: .45rem; margin: 0 .25rem; color: var(--text-muted); font-size: .78rem; white-space: nowrap; }
	.actualizacion span { width: .5rem; height: .5rem; border-radius: 50%; background: var(--accion); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 14%, transparent); }
	.rejilla-encuestas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: .85rem; align-content: start; }
	.encuesta-card { display: flex; flex-direction: column; gap: .8rem; padding: 1rem 1.1rem; transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
	.encuesta-card:hover { border-color: color-mix(in srgb, var(--accion) 35%, var(--border-subtle)); box-shadow: var(--shadow-card-hover, var(--shadow-card)); transform: translateY(-1px); }
	.encuesta-card-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
	.estado { display: inline-flex; align-items: center; min-height: 1.45rem; padding: .15rem .55rem; border-radius: 999px; background: #fff5df; color: #805a10; font-size: .68rem; font-weight: 750; }
	.estado.publicada { background: color-mix(in srgb, var(--emerald-500) 13%, white); color: var(--emerald-800); }
	.estado.cerrada { background: var(--bg-subtle); color: var(--text-muted); }
	.fecha { color: var(--text-muted); font-size: .72rem; }
	h2 { margin: 0; color: var(--text-primary); font-size: 1rem; line-height: 1.35; overflow-wrap: anywhere; }
	.descripcion { min-height: 2.5em; margin: -.35rem 0 0; color: var(--text-muted); font-size: .8rem; line-height: 1.5; }
	.encuesta-card-resumen { display: flex; gap: 1.5rem; border-top: 1px solid var(--border-subtle); padding-top: .75rem; }
	.encuesta-card-resumen div { display: flex; align-items: baseline; gap: .4rem; }
	.encuesta-card-resumen strong { color: var(--text-primary); font-size: 1.05rem; }
	.encuesta-card-resumen span { color: var(--text-muted); font-size: .74rem; }
	.encuesta-card-acciones { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-top: auto; }
	.abrir-tablero, .copiar-enlace { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; min-height: 2.5rem; border-radius: .75rem; font: inherit; font-size: .78rem; font-weight: 700; text-decoration: none; cursor: pointer; }
	.abrir-tablero { color: var(--accion); }
	.copiar-enlace { padding: 0 .65rem; border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-secondary); }
	.estado-vacio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .55rem; min-height: 12rem; padding: 2rem; text-align: center; color: var(--text-muted); }
	.estado-vacio strong { color: var(--text-primary); font-size: .95rem; }
	.estado-vacio p { margin: 0 0 .5rem; font-size: .8rem; }
	.estado-vacio .btn-primary { margin-top: .4rem; }
	.error { color: #b42318; }
	@media (max-width: 640px) { .encuestas-pagina { padding: 1rem; } .encuesta-card-acciones { align-items: stretch; } .copiar-enlace { flex: 1; } }
</style>
