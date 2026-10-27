<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { BarChart3, Plus, ArrowUpRight, Copy, Search, Sparkles } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { encuestasAPI, type Encuesta, type EncuestaInput } from '$lib/api/encuestas';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';

	const puedeGestionar = $derived.by(() => {
		const u = $authStore.user;
		return !!u && checkAccess(u.role || u.rol, u.area, 'encuestas', u.permisos_rutas).level === 'full';
	});

	let encuestas = $state<Encuesta[]>([]);
	let cargando = $state(true);
	let creando = $state(false);
	let tituloNuevo = $state('');
	let busqueda = $state('');
	let error = $state('');

	const visibles = $derived(
		encuestas.filter((e) => e.titulo.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es')))
	);
	const publicadas = $derived(encuestas.filter((e) => e.estado === 'PUBLICADA').length);
	const respuestas = $derived(encuestas.reduce((s, e) => s + (e._count?.respuestas ?? 0), 0));

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
		if (!tituloNuevo.trim() || creando) return;
		creando = true;
		try {
			const entrada: EncuestaInput = {
				titulo: tituloNuevo.trim(), descripcion: '', mensaje_final: '¡Gracias por compartir tu opinión!',
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
		await navigator.clipboard.writeText(encuestasAPI.enlace(token));
		toast.success('Enlace copiado');
	}

	function fecha(valor: string) {
		return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(valor));
	}
</script>

<svelte:head><title>Encuestas · Panel</title></svelte:head>

<div class="pagina">
	<header class="cabecera">
		<div>
			<div class="eyebrow"><Sparkles size={15} /> Participación y escucha</div>
			<h1>Encuestas</h1>
			<p>Crea un enlace, escucha al grupo y sigue las respuestas mientras llegan.</p>
		</div>
		{#if puedeGestionar}<button class="btn-crear" onclick={() => document.getElementById('nuevo-titulo')?.focus()}><Plus size={18} /> Nueva encuesta</button>{/if}
	</header>

	<section class="resumen" aria-label="Resumen de encuestas">
		<div><span>Encuestas</span><strong>{encuestas.length}</strong><small>en tu espacio</small></div>
		<div><span>Publicadas</span><strong>{publicadas}</strong><small>recibiendo respuestas</small></div>
		<div><span>Respuestas</span><strong>{respuestas}</strong><small>en total</small></div>
		<div class="resumen-ilustrado"><BarChart3 size={32} /><span>Tu tablero se actualiza al recibir una respuesta.</span></div>
	</section>

	{#if puedeGestionar}<section class="crear-panel">
		<div><strong>Empezar una encuesta</strong><p>Ponle un nombre. Después eliges preguntas y opciones.</p></div>
		<form onsubmit={(e) => { e.preventDefault(); void crear(); }}>
			<input id="nuevo-titulo" type="text" maxlength="180" minlength="3" placeholder="Ej. Encuesta de satisfacción del servicio" bind:value={tituloNuevo} required />
			<button type="submit" disabled={creando || tituloNuevo.trim().length < 3}>{creando ? 'Creando…' : 'Crear borrador'} <ArrowUpRight size={16} /></button>
		</form>
	</section>{/if}

	<div class="barra"><h2>Todas las encuestas</h2><label><Search size={17} /><input type="search" placeholder="Buscar por título" bind:value={busqueda} /></label></div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if cargando}<p class="vacio">Cargando encuestas…</p>
	{:else if visibles.length === 0}
		<div class="vacio">{puedeGestionar ? 'Todavía no hay encuestas que coincidan. Crea una arriba para empezar.' : 'No hay encuestas que coincidan.'}</div>
	{:else}
		<div class="rejilla">
			{#each visibles as encuesta (encuesta.id)}
				<article class="tarjeta">
					<div class="tarjeta-top">
						<span class:verde={encuesta.estado === 'PUBLICADA'} class:gris={encuesta.estado === 'CERRADA'} class="estado">{encuesta.estado === 'PUBLICADA' ? 'Publicada' : encuesta.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</span>
						<span class="fecha">{fecha(encuesta.created_at)}</span>
					</div>
					<h3>{encuesta.titulo}</h3>
					<p>{encuesta.descripcion || 'Sin descripción todavía'}</p>
					<div class="tarjeta-pie"><strong>{encuesta._count?.respuestas ?? 0}</strong><span>respuestas</span></div>
					<div class="acciones">
						<a href={`/dashboard/encuestas/${encuesta.id}`}>Abrir tablero <ArrowUpRight size={16} /></a>
						{#if encuesta.estado === 'PUBLICADA'}
							<button title="Copiar enlace público" aria-label="Copiar enlace de {encuesta.titulo}" onclick={() => copiar(encuesta.token)}><Copy size={17} /></button>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pagina { padding: 1.5rem 1.25rem 3rem; color: var(--text-primary); }
	.cabecera { display: flex; justify-content: space-between; align-items: end; gap: 1.5rem; margin: 0 0 2rem; }
	.eyebrow { display: flex; align-items: center; gap: .4rem; text-transform: uppercase; letter-spacing: .14em; color: var(--accion, #07875f); font-size: .72rem; font-weight: 800; }
	h1 { font-size: clamp(2.2rem, 4vw, 3.8rem); letter-spacing: -.05em; margin: .4rem 0; }
	.cabecera p { margin: 0; color: var(--text-secondary); }
	button, input { font: inherit; }
	.btn-crear, .crear-panel button { display: inline-flex; align-items: center; gap: .5rem; border: 0; border-radius: .8rem; background: var(--accion, #07875f); color: #fff; padding: .85rem 1.1rem; font-weight: 700; cursor: pointer; }
	.resumen { display: grid; grid-template-columns: repeat(3, minmax(9rem, 1fr)) minmax(12rem, 1.3fr); gap: .8rem; margin-bottom: 1rem; }
	.resumen > div { background: var(--bg-surface, #fff); border: 1px solid var(--border-subtle, #e3e9e5); border-radius: 1rem; padding: 1.25rem; display: flex; flex-direction: column; gap: .25rem; }
	.resumen span { color: var(--text-secondary); font-size: .84rem; }
	.resumen strong { font-size: 2rem; letter-spacing: -.04em; }
	.resumen small { color: var(--text-muted, #8a9991); }
	.resumen .resumen-ilustrado { background: color-mix(in srgb, var(--accion, #07875f) 10%, var(--bg-surface, white)); color: var(--accion, #07875f); justify-content: space-between; }
	.resumen-ilustrado span { color: var(--text-primary); font-weight: 600; }
	.crear-panel { display: flex; justify-content: space-between; gap: 2rem; align-items: center; border-radius: 1rem; padding: 1.35rem; background: var(--bg-surface, #fff); border: 1px solid var(--border-subtle, #e3e9e5); }
	.crear-panel strong { font-size: 1.04rem; }
	.crear-panel p { margin: .25rem 0 0; font-size: .84rem; color: var(--text-secondary); }
	.crear-panel form { display: flex; gap: .5rem; min-width: min(100%, 29rem); }
	.crear-panel input { min-width: 0; flex: 1; border: 1px solid var(--border-default, #ccd6d0); border-radius: .7rem; padding: .75rem; background: var(--bg-surface, #fff); color: var(--text-primary); }
	.crear-panel button:disabled { opacity: .55; cursor: default; }
	.barra { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 2rem 0 1rem; }
	h2 { font-size: 1.2rem; margin: 0; }
	.barra label { display: flex; align-items: center; gap: .5rem; padding: .55rem .8rem; border: 1px solid var(--border-default, #ccd6d0); border-radius: .75rem; color: var(--text-secondary); background: var(--bg-surface, #fff); }
	.barra input { border: 0; outline: 0; background: transparent; color: var(--text-primary); }
	.rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; }
	.tarjeta { display: flex; flex-direction: column; min-height: 15rem; background: var(--bg-surface, #fff); border: 1px solid var(--border-subtle, #e3e9e5); border-radius: 1rem; padding: 1.2rem; }
	.tarjeta-top { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
	.estado { display: inline-block; padding: .3rem .6rem; border-radius: 2rem; background: #f4ebd6; color: #875d15; font-size: .7rem; font-weight: 800; }
	.estado.verde { background: #e1f4e9; color: #116d44; }
	.estado.gris { background: #edf0f1; color: #5e6d71; }
	.fecha { color: var(--text-muted, #8a9991); font-size: .75rem; }
	h3 { margin: 1rem 0 .4rem; font-size: 1.15rem; letter-spacing: -.02em; }
	.tarjeta > p { margin: 0; color: var(--text-secondary); font-size: .84rem; line-height: 1.5; }
	.tarjeta-pie { display: flex; align-items: baseline; gap: .4rem; margin-top: auto; padding-top: 1.4rem; }
	.tarjeta-pie strong { font-size: 1.5rem; letter-spacing: -.04em; }
	.tarjeta-pie span { color: var(--text-secondary); font-size: .8rem; }
	.acciones { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-subtle, #e3e9e5); margin-top: 1rem; padding-top: .8rem; }
	.acciones a { display: inline-flex; align-items: center; gap: .3rem; color: var(--accion, #07875f); font-size: .84rem; font-weight: 750; text-decoration: none; }
	.acciones button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; padding: .4rem; }
	.vacio { border: 1px dashed var(--border-default, #ccd6d0); border-radius: 1rem; padding: 3rem; text-align: center; color: var(--text-secondary); }
	.error { color: #b42318; }
	@media (max-width: 850px) { .cabecera, .crear-panel { align-items: stretch; flex-direction: column; } .resumen { grid-template-columns: repeat(2, minmax(0, 1fr)); } .crear-panel form { min-width: 0; } }
	@media (max-width: 500px) { .resumen { grid-template-columns: 1fr 1fr; } .resumen-ilustrado { grid-column: 1 / -1; } .crear-panel form { flex-direction: column; } .barra { align-items: stretch; flex-direction: column; } }
</style>
