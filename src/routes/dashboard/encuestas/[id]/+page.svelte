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
		/// Después del PUT, `e` ya pasó por `$state` y sus preguntas son proxies;
		/// `structuredClone` falla con proxies aunque el contenido sea JSON válido.
		const preguntas = $state.snapshot(e.preguntas ?? []);
		return {
			titulo: e.titulo, descripcion: e.descripcion, mensaje_final: e.mensaje_final,
			nombre_modo: e.nombre_modo, correo_modo: e.correo_modo,
			registrar_origen: e.registrar_origen, politica_origen: e.politica_origen,
			fecha_cierre: e.fecha_cierre, preguntas: structuredClone(preguntas)
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

<div class="dir-pagina encuesta-detalle">
	<a class="volver" href="/dashboard/encuestas"><ArrowLeft size={16} /> Encuestas</a>
	{#if cargando}
		<div class="estado-panel page-card">Cargando encuesta…</div>
	{:else if error || !encuesta || !formulario}
		<div class="estado-panel page-card error" role="alert">{error || 'Encuesta no encontrada'}</div>
	{:else}
		<header class="page-card dir-cabecera">
			<div class="dir-cabecera-texto">
				<div class="detalle-tipo">ENCUESTA <span class="estado" class:publicada={encuesta.estado === 'PUBLICADA'} class:cerrada={encuesta.estado === 'CERRADA'}>{encuesta.estado === 'PUBLICADA' ? 'Publicada' : encuesta.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</span></div>
				<h1 class="dir-titulo">{encuesta.titulo}</h1>
				<p class="dir-desc">{encuesta.estado === 'BORRADOR' ? 'Configura la presentación y las preguntas. Publica cuando esté lista.' : 'Comparte el enlace y revisa las respuestas de tu grupo.'}</p>
			</div>
			<div class="dir-cabecera-acciones">
				{#if encuesta.estado !== 'BORRADOR'}
					<button type="button" class="btn-secondary" onclick={() => void copiar()}><Copy size={16} /> Copiar enlace</button>
					<a class="btn-primary" href={encuestasAPI.enlace(encuesta.token)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir encuesta</a>
				{/if}
			</div>
		</header>

		{#if encuesta.estado !== 'BORRADOR'}
			<div class="enlace page-card"><div><span class="enlace-etiqueta">Enlace para compartir</span><code>{encuestasAPI.enlace(encuesta.token)}</code></div><button class="btn-secondary" type="button" title="Copiar enlace" onclick={() => void copiar()}><Copy size={16} /> Copiar</button></div>
		{/if}

		{#if vista === 'editor' && encuesta.estado === 'BORRADOR' && !puedeGestionar}
			<div class="estado-panel page-card">Esta encuesta está en borrador. Puedes consultar los resultados cuando se publique.</div>
		{:else if vista === 'editor' && encuesta.estado === 'BORRADOR'}
			<EditorEncuesta value={formulario} onChange={editar} />
			<div class="pie-editor page-card"><span class:cambio-pendiente={cambios}><i></i>{cambios ? 'Cambios sin guardar' : 'Todos los cambios están guardados'}</span><div><button type="button" class="btn-secondary" disabled={trabajando || !cambios} onclick={() => void guardar()}><Save size={16} /> Guardar borrador</button><button type="button" class="btn-primary" disabled={trabajando} onclick={() => void publicar()}><Send size={16} /> Publicar y compartir</button></div></div>
		{:else if resultados}
			<ResultadosEncuesta datos={resultados} onPagina={(pagina) => void cargarResultados(pagina)} onDescargar={(formato) => void descargar(formato)} />
		{:else}
			<div class="estado-panel page-card">Preparando resultados…</div>
		{/if}

		{#if puedeGestionar}<div class="acciones-gestion" aria-label="Otras acciones de la encuesta">
			<button type="button" class="btn-secondary" onclick={() => void duplicar()} disabled={trabajando}><FilePlus2 size={16} /> Duplicar</button>
			{#if encuesta.estado === 'PUBLICADA'}<button type="button" class="btn-secondary" onclick={() => void cerrar()} disabled={trabajando}><LockKeyhole size={16} /> Cerrar recepción</button>{/if}
			<button type="button" class="btn-danger" onclick={() => void archivar()} disabled={trabajando}><Trash2 size={16} /> Archivar</button>
		</div>{/if}
	{/if}
</div>

<style>
	.encuesta-detalle { overflow: auto; }
	.volver { display: inline-flex; align-items: center; align-self: flex-start; gap: .4rem; width: fit-content; color: var(--text-muted); font-size: .78rem; font-weight: 700; text-decoration: none; }
	.volver:hover { color: var(--accion); }
	.detalle-tipo { display: flex; align-items: center; gap: .55rem; color: var(--text-muted); font-size: .67rem; font-weight: 800; letter-spacing: .1em; }
	.estado { display: inline-flex; align-items: center; min-height: 1.4rem; padding: .15rem .55rem; border-radius: 999px; background: color-mix(in srgb, #d99a24 14%, white); color: #805a10; font-size: .68rem; font-weight: 750; letter-spacing: 0; }
	.estado.publicada { background: color-mix(in srgb, var(--emerald-500) 13%, white); color: var(--emerald-800); }
	.estado.cerrada { background: var(--bg-base); color: var(--text-muted); }
	.enlace { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-width: 0; padding: .85rem 1.1rem; }
	.enlace > div { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }
	.enlace-etiqueta { color: var(--text-muted); font-size: .68rem; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
	.enlace code { overflow: hidden; color: var(--emerald-800); font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
	.pie-editor { position: sticky; bottom: .75rem; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .7rem 1rem; }
	.pie-editor > span { display: inline-flex; align-items: center; gap: .5rem; color: var(--text-muted); font-size: .78rem; }
	.pie-editor > span i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--emerald-500); }
	.pie-editor > span.cambio-pendiente i { background: #d99a24; }
	.pie-editor > div { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
	.acciones-gestion { display: flex; flex-wrap: wrap; gap: .5rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem; }
	.estado-panel { display: flex; align-items: center; justify-content: center; min-height: 10rem; padding: 2rem; color: var(--text-muted); text-align: center; }
	.estado-panel.error { color: #b42318; }
	@media (max-width: 640px) { .encuesta-detalle { padding: 1rem; } .enlace { align-items: stretch; flex-direction: column; } .enlace .btn-secondary { align-self: flex-start; } .pie-editor { align-items: stretch; flex-direction: column; bottom: .5rem; } .pie-editor > div { display: grid; grid-template-columns: 1fr; } .acciones-gestion .btn-secondary, .acciones-gestion .btn-danger { flex: 1; } }
</style>
