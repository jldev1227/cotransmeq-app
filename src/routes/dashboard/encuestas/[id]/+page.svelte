<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ArrowLeft, Save, Send, Copy, ExternalLink, LockKeyhole, FilePlus2, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { encuestasAPI, type Encuesta, type EncuestaInput, type ResultadoEncuesta } from '$lib/api/encuestas';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import EditorEncuesta from '$lib/components/encuestas/EditorEncuesta.svelte';
	import ResultadosEncuesta from '$lib/components/encuestas/ResultadosEncuesta.svelte';

	const id = $derived(page.params.id ?? '');
	const puedeGestionar = $derived.by(() => {
		const u = $authStore.user;
		return !!u && checkAccess(u.role || u.rol, u.area, 'encuestas', u.permisos_rutas).level === 'full';
	});
	let encuesta = $state<Encuesta | null>(null);
	let formulario = $state<EncuestaInput | null>(null);
	let resultados = $state<ResultadoEncuesta | null>(null);
	let vista = $state<'editor' | 'resultados'>('editor');
	let cargando = $state(true);
	let trabajando = $state(false);
	let error = $state('');
	let cambios = $state(false);

	function desdeEncuesta(e: Encuesta): EncuestaInput {
		return {
			titulo: e.titulo, descripcion: e.descripcion, mensaje_final: e.mensaje_final,
			nombre_modo: e.nombre_modo, correo_modo: e.correo_modo,
			registrar_origen: e.registrar_origen, politica_origen: e.politica_origen,
			fecha_cierre: e.fecha_cierre, preguntas: structuredClone(e.preguntas ?? [])
		};
	}
	function mensaje(e: any): string {
		return e?.response?.data?.message || e?.message || 'Ocurrió un error';
	}
	async function cargar() {
		try {
			const e = await encuestasAPI.obtener(id);
			encuesta = e;
			formulario = desdeEncuesta(e);
			vista = e.estado === 'BORRADOR' ? 'editor' : 'resultados';
			if (e.estado !== 'BORRADOR') await cargarResultados();
		} catch (e: any) {
			error = mensaje(e);
		} finally {
			cargando = false;
		}
	}
	async function cargarResultados(pagina = 1) {
		if (!id) return;
		try {
			resultados = await encuestasAPI.resultados(id, pagina);
		} catch (e: any) {
			toast.error(mensaje(e));
		}
	}
	onMount(() => {
		void cargar();
		const baja = socketUtils.on('encuestas:respuesta', (evento: { encuestaId: string }) => {
			if (evento.encuestaId === id) void cargarResultados(resultados?.pagina ?? 1);
		});
		const reconexion = socketUtils.onReconnect(() => {
			if (encuesta?.estado !== 'BORRADOR') void cargarResultados(resultados?.pagina ?? 1);
		});
		/// Respaldo para una pestaña que estuvo dormida durante el evento.
		const intervalo = setInterval(() => {
			if (document.visibilityState === 'visible' && encuesta?.estado !== 'BORRADOR') void cargarResultados(resultados?.pagina ?? 1);
		}, 30_000);
		return () => { baja(); reconexion(); clearInterval(intervalo); };
	});
	function editar(value: EncuestaInput) {
		formulario = value;
		cambios = true;
	}
	async function guardar(): Promise<boolean> {
		if (!formulario || trabajando) return false;
		trabajando = true;
		try {
			encuesta = await encuestasAPI.actualizar(id, formulario);
			formulario = desdeEncuesta(encuesta);
			cambios = false;
			toast.success('Borrador guardado');
			return true;
		} catch (e: any) {
			toast.error(mensaje(e));
			return false;
		} finally {
			trabajando = false;
		}
	}
	async function publicar() {
		if (!formulario || !encuesta || trabajando) return;
		if (formulario.preguntas.length === 0) { toast.error('Agrega al menos una pregunta'); return; }
		if (!(await guardar())) return;
		trabajando = true;
		try {
			encuesta = await encuestasAPI.accion(id, 'publicar');
			cambios = false;
			vista = 'resultados';
			await cargarResultados();
			toast.success('Encuesta publicada. Ya puedes compartir el enlace.');
		} catch (e: any) {
			toast.error(mensaje(e));
		} finally { trabajando = false; }
	}
	async function cerrar() {
		if (!encuesta || trabajando || !window.confirm('¿Cerrar esta encuesta? El enlace dejará de aceptar respuestas.')) return;
		trabajando = true;
		try {
			encuesta = await encuestasAPI.accion(id, 'cerrar');
			toast.success('Encuesta cerrada');
		} catch (e: any) { toast.error(mensaje(e)); }
		finally { trabajando = false; }
	}
	async function duplicar() {
		if (trabajando) return;
		trabajando = true;
		try {
			const copia = await encuestasAPI.accion(id, 'duplicar');
			toast.success('Copia creada');
			await goto(`/dashboard/encuestas/${copia.id}`);
		} catch (e: any) { toast.error(mensaje(e)); }
		finally { trabajando = false; }
	}
	async function archivar() {
		if (!window.confirm('¿Archivar esta encuesta? El enlace dejará de funcionar y se conservarán sus respuestas.')) return;
		try {
			await encuestasAPI.archivar(id);
			toast.success('Encuesta archivada');
			await goto('/dashboard/encuestas');
		} catch (e: any) { toast.error(mensaje(e)); }
	}
	async function copiar() {
		if (!encuesta) return;
		await navigator.clipboard.writeText(encuestasAPI.enlace(encuesta.token));
		toast.success('Enlace copiado');
	}
	async function descargar(formato: 'xlsx' | 'pdf') {
		try { await encuestasAPI.descargar(id, formato); }
		catch (e: any) { toast.error(mensaje(e)); }
	}
</script>

<svelte:head><title>{encuesta?.titulo ?? 'Encuesta'} · Encuestas</title></svelte:head>

<div class="pagina">
	<a class="volver" href="/dashboard/encuestas"><ArrowLeft size={17} /> Todas las encuestas</a>
	{#if cargando}
		<div class="vacio">Cargando encuesta…</div>
	{:else if error || !encuesta || !formulario}
		<div class="vacio error">{error || 'Encuesta no encontrada'}</div>
	{:else}
		<header class="cabecera">
			<div>
				<div class="eyebrow">Encuesta <span class:publicada={encuesta.estado === 'PUBLICADA'} class="estado">{encuesta.estado === 'PUBLICADA' ? 'Publicada' : encuesta.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</span></div>
				<h1>{encuesta.titulo}</h1>
				<p>{encuesta.estado === 'BORRADOR' ? 'Diseña las preguntas y publica cuando esté lista.' : 'Comparte el enlace y revisa los resultados mientras llegan.'}</p>
			</div>
			<div class="cabecera-acciones">
				{#if encuesta.estado === 'BORRADOR' && puedeGestionar}
					<button class="secundario" disabled={trabajando || !cambios} onclick={() => void guardar()}><Save size={16} /> Guardar</button>
					<button class="primario" disabled={trabajando} onclick={() => void publicar()}><Send size={16} /> Publicar y compartir</button>
				{:else if encuesta.estado !== 'BORRADOR'}
					<button class="secundario" onclick={() => void copiar()}><Copy size={16} /> Copiar enlace</button>
					<a class="primario" href={encuestasAPI.enlace(encuesta.token)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir encuesta</a>
				{/if}
			</div>
		</header>

		{#if encuesta.estado !== 'BORRADOR'}
			<div class="enlace"><span>Enlace para compartir</span><code>{encuestasAPI.enlace(encuesta.token)}</code><button title="Copiar enlace" onclick={() => void copiar()}><Copy size={17} /></button></div>
		{/if}

		<div class="tabs">
			{#if encuesta.estado === 'BORRADOR' && puedeGestionar}<button class:activa={vista === 'editor'} onclick={() => (vista = 'editor')}>Constructor {#if cambios}<span class="punto"></span>{/if}</button>{/if}
			{#if encuesta.estado !== 'BORRADOR'}<button class:activa={vista === 'resultados'} onclick={() => { vista = 'resultados'; void cargarResultados(); }}>Resultados <span>{resultados?.total ?? 0}</span></button>{/if}
		</div>

		{#if vista === 'editor' && encuesta.estado === 'BORRADOR' && !puedeGestionar}
			<div class="vacio">Esta encuesta está en borrador. Puedes consultar los resultados cuando se publique.</div>
		{:else if vista === 'editor' && encuesta.estado === 'BORRADOR'}
			<EditorEncuesta value={formulario} onChange={editar} />
			<div class="pie-editor"><span>{cambios ? 'Tienes cambios sin guardar' : 'Todos los cambios están guardados'}</span><div><button class="secundario" disabled={trabajando || !cambios} onclick={() => void guardar()}><Save size={16} /> Guardar</button><button class="primario" disabled={trabajando} onclick={() => void publicar()}><Send size={16} /> Publicar encuesta</button></div></div>
		{:else if resultados}
			<ResultadosEncuesta datos={resultados} onPagina={(pagina) => void cargarResultados(pagina)} onDescargar={(formato) => void descargar(formato)} />
		{:else}
			<div class="vacio">Preparando resultados…</div>
		{/if}

		{#if puedeGestionar}<div class="gestion">
			<button onclick={() => void duplicar()} disabled={trabajando}><FilePlus2 size={16} /> Duplicar como borrador</button>
			{#if encuesta.estado === 'PUBLICADA'}<button onclick={() => void cerrar()} disabled={trabajando}><LockKeyhole size={16} /> Cerrar recepción</button>{/if}
			<button class="peligro" onclick={() => void archivar()} disabled={trabajando}><Trash2 size={16} /> Archivar</button>
		</div>{/if}
	{/if}
</div>

<style>
	.pagina { padding: 1.4rem 1.25rem 3rem; color: var(--text-primary); }
	.volver { display: inline-flex; align-items: center; gap: .45rem; color: var(--text-secondary); font-size: .8rem; font-weight: 700; text-decoration: none; margin-bottom: 1.7rem; }
	.volver:hover { color: var(--accion, #07875f); }
	.cabecera { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.4rem; }
	.eyebrow { display: flex; gap: .5rem; align-items: center; text-transform: uppercase; font-size: .7rem; color: var(--accion, #07875f); font-weight: 800; letter-spacing: .13em; }
	.estado { background: #f6eddb; color: #8c651d; border-radius: 1rem; padding: .3rem .55rem; letter-spacing: 0; }
	.estado.publicada { background: #e2f5e9; color: #167247; }
	h1 { font-size: clamp(2rem, 3.5vw, 3.2rem); letter-spacing: -.045em; line-height: 1.08; margin: .45rem 0; }
	.cabecera p { margin: 0; color: var(--text-secondary); font-size: .85rem; }
	.cabecera-acciones, .pie-editor > div { display: flex; gap: .5rem; }
	button, a.primario { font: inherit; }
	.primario, .secundario { display: inline-flex; align-items: center; justify-content: center; gap: .45rem; min-height: 2.7rem; padding: .65rem .9rem; border-radius: .7rem; cursor: pointer; font-size: .8rem; font-weight: 750; text-decoration: none; }
	.primario { border: 1px solid var(--accion, #07875f); background: var(--accion, #07875f); color: white; }
	.secundario { border: 1px solid var(--border-default, #ccd6d0); background: var(--bg-surface, white); color: var(--text-primary); }
	button:disabled { opacity: .5; cursor: default; }
	.enlace { display: flex; align-items: center; gap: .65rem; padding: .7rem 1rem; border: 1px solid var(--border-subtle); border-radius: .8rem; background: var(--bg-surface); margin-bottom: 1rem; min-width: 0; }
	.enlace span { font-size: .75rem; color: var(--text-secondary); flex: none; }
	.enlace code { color: var(--accion, #07875f); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
	.enlace button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
	.tabs { display: flex; gap: .3rem; border-bottom: 1px solid var(--border-subtle); margin-bottom: 1rem; }
	.tabs button { display: inline-flex; align-items: center; gap: .4rem; padding: .75rem 1rem; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; font-size: .83rem; font-weight: 750; }
	.tabs button.activa { color: var(--accion, #07875f); border-color: var(--accion, #07875f); }
	.tabs span { color: var(--text-muted); }
	.tabs .punto { width: .4rem; height: .4rem; background: #e9a531; border-radius: 50%; }
	.pie-editor { position: sticky; bottom: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .7rem 1rem; margin-top: 1rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: .8rem; box-shadow: 0 -8px 25px rgba(0,0,0,.04); }
	.pie-editor > span { color: var(--text-secondary); font-size: .8rem; }
	.gestion { display: flex; flex-wrap: wrap; gap: .6rem; border-top: 1px solid var(--border-subtle); margin-top: 2rem; padding-top: 1rem; }
	.gestion button { display: inline-flex; align-items: center; gap: .35rem; border: 0; background: transparent; color: var(--text-secondary); padding: .5rem .6rem; cursor: pointer; font-size: .78rem; }
	.gestion .peligro { color: #b5483b; }
	.vacio { border: 1px dashed var(--border-default); border-radius: .9rem; padding: 3rem 1rem; color: var(--text-secondary); text-align: center; }
	.error { color: #bd3d32; }
	@media (max-width: 750px) { .cabecera { align-items: stretch; flex-direction: column; } .cabecera-acciones { flex-wrap: wrap; } .pie-editor { align-items: stretch; flex-direction: column; } .enlace { flex-wrap: wrap; } .enlace code { flex-basis: 80%; } }
</style>
