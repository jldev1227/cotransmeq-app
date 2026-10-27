<script lang="ts">
	import { BarChart3, Users, Activity, ShieldCheck, FileSpreadsheet, FileText, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import Grafica from '$lib/components/dashboard/Grafica.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import type { ResultadoEncuesta, PreguntaEncuesta } from '$lib/api/encuestas';

	interface Props {
		datos: ResultadoEncuesta;
		onPagina: (pagina: number) => void;
		onDescargar: (formato: 'xlsx' | 'pdf') => void;
	}
	let { datos, onPagina, onDescargar }: Props = $props();
	let vista = $state<'graficas' | 'respuestas'>('graficas');

	const hoy = $derived(datos.por_dia.at(-1)?.total ?? 0);
	const preguntas = $derived(datos.encuesta.preguntas ?? []);

	function representar(p: PreguntaEncuesta, valor: unknown): string {
		if (valor == null) return '—';
		if (p.tipo === 'OPCION_UNICA') return p.opciones.find(o => o.id === valor)?.texto ?? String(valor);
		if (p.tipo === 'OPCION_MULTIPLE' && Array.isArray(valor)) return valor.map(v => p.opciones.find(o => o.id === v)?.texto ?? v).join(', ');
		if (p.tipo === 'SI_NO') return valor ? 'Sí' : 'No';
		return String(valor);
	}
	function fecha(valor: string) {
		return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(valor));
	}
</script>

<div class="resultados">
	<header class="page-card resultados-cabecera">
		<div><div class="eyebrow"><Activity size={14} /> En vivo</div><h2>Respuestas de tu grupo</h2><p>Los resultados se actualizan cuando llega una respuesta nueva.</p></div>
		<div class="exportar">
			<button type="button" class="btn-secondary" onclick={() => onDescargar('xlsx')}><FileSpreadsheet size={16} /> Descargar Excel</button>
			<button type="button" class="btn-secondary" onclick={() => onDescargar('pdf')}><FileText size={16} /> Descargar PDF</button>
		</div>
	</header>

	<section class="metricas" aria-label="Métricas de la encuesta">
		<div class="stat-card"><span class="stat-label"><Users size={16} /> Participación</span><strong class="stat-value">{datos.total}</strong><small>respuestas recibidas</small></div>
		<div class="stat-card"><span class="stat-label"><BarChart3 size={16} /> Preguntas</span><strong class="stat-value">{preguntas.length}</strong><small>en esta encuesta</small></div>
		<div class="stat-card"><span class="stat-label"><Activity size={16} /> Último día</span><strong class="stat-value">{hoy}</strong><small>respuestas de {datos.por_dia.at(-1)?.fecha ?? 'hoy'}</small></div>
		<div class="stat-card"><span class="stat-label"><ShieldCheck size={16} /> Origen</span><strong class="stat-value">{datos.encuesta.registrar_origen ? datos.coincidencias_dispositivo : '—'}</strong><small>{datos.encuesta.registrar_origen ? 'coincidencias de dispositivo' : 'comparación desactivada'}</small></div>
	</section>

	<TabsVista
		tabs={[
			{ id: 'graficas', label: 'Análisis visual' },
			{ id: 'respuestas', label: 'Respuestas individuales', cuenta: datos.total }
		]}
		activa={vista}
		onCambiar={(id) => (vista = id as typeof vista)}
		etiqueta="Vistas de resultados"
	/>

	{#if vista === 'graficas'}
		{#if datos.total === 0}
			<div class="vacio page-card"><BarChart3 size={30} /><strong>El tablero está listo.</strong><p>Comparte el enlace y los gráficos aparecerán al recibir respuestas.</p></div>
		{:else}
			<div class="graficas">
				<div class="grafica-card page-card tendencia">
					<div class="card-top"><div><span class="eyebrow">Participación</span><h3>Respuestas en el tiempo</h3></div><span class="chip">{datos.total} en total</span></div>
					<Grafica tipo="lineas" etiquetas={datos.por_dia.map(d => d.fecha)} series={[{ etiqueta: 'Respuestas', datos: datos.por_dia.map(d => d.total), color: 'primario' }]} alto={250} leyenda={false} />
				</div>
				{#each datos.analisis as q (q.id)}
					<div class="grafica-card page-card">
						<div class="card-top"><div><span class="eyebrow">{q.tipo.replace(/_/g, ' ')}</span><h3>{q.titulo}</h3></div><span class="chip">{q.respondidas} respuestas</span></div>
						{#if q.opciones.length}
							{#if q.promedio !== null || q.nps !== null}<div class="score">{q.nps !== null ? q.nps : q.promedio}<small>{q.nps !== null ? 'NPS' : 'promedio'}</small></div>{/if}
							<Grafica tipo={q.opciones.length <= 5 && q.tipo !== 'ESCALA' ? 'dona' : 'barras'} etiquetas={q.opciones.map(o => o.texto)} series={[{ etiqueta: 'Respuestas', datos: q.opciones.map(o => o.total), color: 'primario' }]} alto={230} leyenda={q.opciones.length <= 5 && q.tipo !== 'ESCALA'} />
							<div class="leyenda-opciones">{#each q.opciones as o}<div><span>{o.texto}</span><strong>{o.porcentaje} %</strong></div>{/each}</div>
						{:else if q.tipo === 'NUMERO' && q.promedio !== null}
							<div class="numero-grande">{q.promedio}<small>promedio de respuestas</small></div>
						{:else if q.textos.length}
							<div class="textos">{#each q.textos as texto}<blockquote>{texto}</blockquote>{/each}</div>
						{:else}
							<p class="sin-datos">Sin respuestas para esta pregunta.</p>
						{/if}
					</div>
				{/each}
			</div>
			{#if datos.encuesta.registrar_origen}
				<div class="origen"><ShieldCheck size={18} /><span>Coincidencias detectadas: <strong>{datos.coincidencias_ip}</strong> por IP y <strong>{datos.coincidencias_dispositivo}</strong> por navegador. Son señales para revisar, no una prueba de que sea la misma persona.</span></div>
			{/if}
		{/if}
	{:else}
		<div class="tabla-wrap page-card">
			{#if datos.respuestas.length === 0}<p class="sin-datos">Todavía no hay respuestas.</p>
			{:else}
				<table><thead><tr><th>Fecha</th><th>Participante</th><th>Origen</th>{#each preguntas as p}<th>{p.titulo}</th>{/each}</tr></thead>
					<tbody>{#each datos.respuestas as r (r.id)}<tr>
						<td>{fecha(r.created_at)}</td><td>{r.nombre || r.correo || 'Anónimo'}</td>
						<td>{r.coincide_dispositivo ? 'Mismo dispositivo' : r.coincide_ip ? 'Misma IP' : '—'}</td>
						{#each preguntas as p}<td>{representar(p, r.respuestas[p.id])}</td>{/each}
					</tr>{/each}</tbody></table>
			{/if}
		</div>
		{#if datos.paginas > 1}
			<div class="paginacion"><button disabled={datos.pagina <= 1} onclick={() => onPagina(datos.pagina - 1)}><ChevronLeft size={16} /> Anterior</button><span>Página {datos.pagina} de {datos.paginas}</span><button disabled={datos.pagina >= datos.paginas} onclick={() => onPagina(datos.pagina + 1)}>Siguiente <ChevronRight size={16} /></button></div>
		{/if}
	{/if}
</div>

<style>
	.resultados { display: grid; gap: 1rem; min-width: 0; }
	.resultados-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.eyebrow { display: inline-flex; align-items: center; gap: .35rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .12em; font-weight: 800; color: var(--accion, #07875f); }
	h2 { font-size: 1.25rem; letter-spacing: -.02em; margin: .35rem 0; }
	.resultados-cabecera p { margin: 0; font-size: .83rem; color: var(--text-muted); }
	.exportar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
	.metricas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .7rem; }
	.metricas > div { display: flex; flex-direction: column; gap: .3rem; }
	.metricas .stat-label { display: inline-flex; align-items: center; gap: .4rem; }
	.metricas .stat-value { display: block; }
	.metricas small { color: var(--text-muted); font-size: .74rem; }
	.graficas { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: .9rem; }
	.grafica-card { min-width: 0; }
	.tendencia { grid-column: 1 / -1; }
	.card-top { display: flex; justify-content: space-between; align-items: start; gap: .6rem; margin-bottom: 1rem; }
	h3 { font-size: 1rem; margin: .3rem 0 0; line-height: 1.4; letter-spacing: -.01em; }
	.chip { flex: none; border-radius: 1rem; background: var(--bg-subtle, #f0f3f0); color: var(--text-secondary); padding: .32rem .55rem; font-size: .7rem; }
	.score { font-size: 2.2rem; font-weight: 800; color: var(--accion, #07875f); letter-spacing: -.04em; }
	.score small, .numero-grande small { margin-left: .5rem; font-size: .75rem; font-weight: 600; color: var(--text-secondary); letter-spacing: 0; }
	.leyenda-opciones { display: grid; gap: .3rem; margin-top: .9rem; }
	.leyenda-opciones > div { display: flex; justify-content: space-between; gap: .5rem; font-size: .77rem; color: var(--text-secondary); }
	.leyenda-opciones strong { color: var(--text-primary); }
	.numero-grande { display: flex; align-items: baseline; padding: 2.5rem 0; font-size: 3rem; font-weight: 800; color: var(--accion, #07875f); }
	.textos { display: grid; gap: .6rem; max-height: 22rem; overflow: auto; }
	blockquote { margin: 0; padding: .7rem .9rem; border-left: 3px solid var(--accion, #07875f); background: var(--bg-subtle, #f7f9f7); border-radius: .2rem .6rem .6rem .2rem; font-size: .8rem; line-height: 1.5; }
	.sin-datos { padding: 2rem; color: var(--text-secondary); }
	.origen { display: flex; align-items: start; gap: .5rem; padding: .9rem 1rem; margin-top: 1rem; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: .8rem; font-size: .78rem; }
	.vacio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; min-height: 14rem; padding: 2rem 1rem; color: var(--text-secondary); text-align: center; }
	.vacio strong { color: var(--text-primary); }
	.vacio p { margin: 0; }
	.tabla-wrap { overflow: auto; padding: 0; }
	table { border-collapse: collapse; min-width: 100%; white-space: nowrap; font-size: .78rem; }
	th, td { padding: .8rem; border-bottom: 1px solid var(--border-subtle); text-align: left; }
	th { color: var(--text-secondary); background: var(--bg-subtle, #f5f7f5); font-weight: 750; }
	td { max-width: 25rem; white-space: normal; overflow-wrap: anywhere; }
	.paginacion { display: flex; align-items: center; justify-content: end; gap: .8rem; font-size: .8rem; color: var(--text-secondary); }
	.paginacion button { display: inline-flex; align-items: center; gap: .4rem; }
	.paginacion button:disabled { opacity: .45; cursor: default; }
	@media (max-width: 900px) { .metricas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 650px) { .resultados-cabecera { align-items: stretch; flex-direction: column; } .exportar { justify-content: stretch; } .exportar .btn-secondary { flex: 1; } .graficas { grid-template-columns: 1fr; } .tendencia { grid-column: auto; } }
</style>
