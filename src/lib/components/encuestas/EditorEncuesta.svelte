<script lang="ts">
	import { Plus, Trash2, ArrowUp, ArrowDown, Copy, GripVertical, Sparkles, LoaderCircle, Check, RotateCcw } from 'lucide-svelte';
	import { encuestasAPI, type EncuestaInput, type PreguntaEncuesta, type PropuestaEncuestaIA, type TipoPregunta } from '$lib/api/encuestas';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	interface Props {
		value: EncuestaInput;
		onChange: (value: EncuestaInput) => void;
	}
	let { value, onChange }: Props = $props();
	let instruccionesIA = $state('');
	let propuestaIA = $state<PropuestaEncuestaIA | null>(null);
	let propuestaAplicada = $state(false);
	let generandoIA = $state(false);
	let errorIA = $state('');
	let confirmarReemplazo = $state(false);

	const TIPOS: Array<{ value: TipoPregunta; label: string }> = [
		{ value: 'TEXTO_CORTO', label: 'Texto corto · solo respuesta abierta' },
		{ value: 'TEXTO_LARGO', label: 'Párrafo · solo respuesta abierta' },
		{ value: 'OPCION_UNICA', label: 'Elegir una opción' },
		{ value: 'OPCION_MULTIPLE', label: 'Elegir varias' },
		{ value: 'SI_NO', label: 'Sí o no' },
		{ value: 'ESCALA', label: 'Escala numérica' },
		{ value: 'NPS', label: 'Recomendación 0–10' },
		{ value: 'NUMERO', label: 'Número' },
		{ value: 'FECHA', label: 'Fecha' },
		{ value: 'CORREO', label: 'Correo' }
	];

	function cambiar<K extends keyof EncuestaInput>(clave: K, dato: EncuestaInput[K]) {
		onChange({ ...value, [clave]: dato });
	}
	async function generarConIA() {
		if (generandoIA || instruccionesIA.trim().length < 5) return;
		generandoIA = true;
		errorIA = '';
		propuestaIA = null;
		propuestaAplicada = false;
		try {
			propuestaIA = await encuestasAPI.generar(instruccionesIA.trim());
		} catch (error: any) {
			errorIA = error?.response?.data?.message || error?.message || 'No se pudo preparar la encuesta. Intenta de nuevo.';
		} finally {
			generandoIA = false;
		}
	}
	function aplicarPropuesta() {
		if (!propuestaIA) return;
		onChange({ ...value, ...propuestaIA });
		propuestaIA = null;
		propuestaAplicada = true;
		instruccionesIA = '';
		confirmarReemplazo = false;
	}
	function solicitarAplicarPropuesta() {
		if (!propuestaIA) return;
		const yaHayContenido = value.preguntas.length > 0 || (value.titulo.trim() && value.titulo !== 'Encuesta nueva') || !!value.descripcion?.trim();
		if (yaHayContenido) confirmarReemplazo = true;
		else aplicarPropuesta();
	}
	function cambiarPregunta(id: string, parcial: Partial<PreguntaEncuesta>) {
		cambiar('preguntas', value.preguntas.map((p) => p.id === id ? { ...p, ...parcial } : p));
	}
	function nueva(tipo: TipoPregunta = 'OPCION_UNICA') {
		const pregunta: PreguntaEncuesta = {
			id: crypto.randomUUID(), titulo: '', descripcion: '', tipo, requerida: true,
			opciones: ['OPCION_UNICA', 'OPCION_MULTIPLE'].includes(tipo)
				? [{ id: crypto.randomUUID(), texto: 'Opción 1' }, { id: crypto.randomUUID(), texto: 'Opción 2' }] : [],
			minimo: 1, maximo: 5
		};
		cambiar('preguntas', [...value.preguntas, pregunta]);
	}
	function cambiarTipo(p: PreguntaEncuesta, tipo: TipoPregunta) {
		cambiarPregunta(p.id, {
			tipo,
			permite_otro: ['OPCION_UNICA', 'OPCION_MULTIPLE'].includes(tipo) ? p.permite_otro ?? false : false,
			opciones: ['OPCION_UNICA', 'OPCION_MULTIPLE'].includes(tipo) && p.opciones.length < 2
				? [{ id: crypto.randomUUID(), texto: 'Opción 1' }, { id: crypto.randomUUID(), texto: 'Opción 2' }]
				: p.opciones
		});
	}
	function mover(id: string, direccion: -1 | 1) {
		const lista = [...value.preguntas];
		const i = lista.findIndex(p => p.id === id);
		const j = i + direccion;
		if (i < 0 || j < 0 || j >= lista.length) return;
		[lista[i], lista[j]] = [lista[j], lista[i]];
		cambiar('preguntas', lista);
	}
	function duplicar(p: PreguntaEncuesta) {
		const i = value.preguntas.findIndex(x => x.id === p.id);
		const copia = { ...p, id: crypto.randomUUID(), titulo: `${p.titulo} (copia)`, opciones: p.opciones.map(o => ({ ...o, id: crypto.randomUUID() })) };
		const lista = [...value.preguntas];
		lista.splice(i + 1, 0, copia);
		cambiar('preguntas', lista);
	}
	function actualizarOpcion(p: PreguntaEncuesta, id: string, texto: string) {
		cambiarPregunta(p.id, { opciones: p.opciones.map(o => o.id === id ? { ...o, texto } : o) });
	}
	function agregarOpcion(p: PreguntaEncuesta) {
		cambiarPregunta(p.id, { opciones: [...p.opciones, { id: crypto.randomUUID(), texto: `Opción ${p.opciones.length + 1}` }] });
	}
	function quitarOpcion(p: PreguntaEncuesta, id: string) {
		cambiarPregunta(p.id, { opciones: p.opciones.filter(o => o.id !== id) });
	}
	function cambiarPermiteOtro(p: PreguntaEncuesta, permite: boolean) {
		const opciones = [...p.opciones];
		while (!permite && opciones.length < 2) opciones.push({ id: crypto.randomUUID(), texto: `Opción ${opciones.length + 1}` });
		cambiarPregunta(p.id, { permite_otro: permite, opciones });
	}
	function fechaLocal(iso: string | null) {
		if (!iso) return '';
		const d = new Date(iso);
		return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	}
</script>

<div class="editor">
	<section class="page-card ia-panel" aria-labelledby="ia-titulo">
		<div class="ia-cabecera">
			<div class="ia-icono"><Sparkles size={18} /></div>
			<div><span class="ia-etiqueta">ASISTENTE IA</span><h2 id="ia-titulo">Arma la encuesta desde una idea</h2><p>Cuéntame qué quieres conocer o pega aquí tu brief. Prepararé el título y las preguntas en el editor para que los revises.</p></div>
		</div>
		<label class="campo ia-instrucciones"><span>¿Sobre qué quieres preguntar?</span><textarea rows="4" maxlength="12000" value={instruccionesIA} oninput={(e) => { instruccionesIA = e.currentTarget.value; errorIA = ''; }} placeholder="Ejemplo: Encuesta anónima para conductores sobre la calidad del servicio de mantenimiento. Crea 8 preguntas: 3 de selección única, una NPS de recomendación, dos escalas de 1 a 5 y dos abiertas. Evalúa tiempos, calidad del trabajo, trato recibido y facilidad para reportar novedades."></textarea></label>
		<div class="ia-pie"><span>Puedes indicar tipos, cantidad, opciones, preguntas exactas y tono. La IA no publicará ni guardará la encuesta.</span><button type="button" class="btn-primary" disabled={generandoIA || instruccionesIA.trim().length < 5} onclick={() => void generarConIA()}>{#if generandoIA}<LoaderCircle size={16} class="girando" /> Preparando…{:else}<Sparkles size={16} /> Generar propuesta{/if}</button></div>
		{#if errorIA}<p class="ia-error" role="alert">{errorIA}</p>{/if}
		{#if propuestaAplicada}<p class="ia-aplicada" role="status"><Check size={16} /> Propuesta incorporada al editor. Revisa y ajusta las preguntas antes de guardar.</p>{/if}
		{#if propuestaIA}
			<div class="ia-propuesta">
				<div class="propuesta-titulo"><div><span class="ia-etiqueta">PROPUESTA LISTA</span><h3>{propuestaIA.titulo}</h3><p>{propuestaIA.preguntas.length} preguntas · Revisa la propuesta antes de incorporarla al formulario.</p></div><span class="propuesta-conteo">{propuestaIA.preguntas.length}</span></div>
				<ol>{#each propuestaIA.preguntas.slice(0, 5) as pregunta (pregunta.id)}<li><span>{pregunta.titulo}</span><small>{TIPOS.find((tipo) => tipo.value === pregunta.tipo)?.label ?? pregunta.tipo}</small></li>{/each}</ol>
				{#if propuestaIA.preguntas.length > 5}<p class="mas-preguntas">Y {propuestaIA.preguntas.length - 5} preguntas más…</p>{/if}
				<div class="propuesta-acciones"><button type="button" class="btn-secondary" onclick={() => { propuestaIA = null; }}>Descartar</button><button type="button" class="btn-primary" onclick={solicitarAplicarPropuesta}><Check size={16} /> Usar esta propuesta</button><button type="button" class="btn-secondary" disabled={generandoIA} onclick={() => void generarConIA()}><RotateCcw size={15} /> Generar otra</button></div>
			</div>
		{/if}
	</section>
	<section class="page-card cabecera-formulario">
		<div class="eyebrow">01 · Presentación</div>
		<label class="campo"><span>Título de la encuesta</span><input value={value.titulo} maxlength="180" oninput={(e) => cambiar('titulo', e.currentTarget.value)} placeholder="¿Qué te gustaría preguntar?" /></label>
		<label class="campo"><span>Descripción o instrucciones</span><textarea rows="3" maxlength="4000" value={value.descripcion ?? ''} oninput={(e) => cambiar('descripcion', e.currentTarget.value)} placeholder="Cuenta por qué se hace esta encuesta y cuánto tarda."></textarea></label>
		<label class="campo"><span>Mensaje después de enviar</span><input value={value.mensaje_final ?? ''} maxlength="1000" oninput={(e) => cambiar('mensaje_final', e.currentTarget.value)} placeholder="¡Gracias por compartir tu opinión!" /></label>
	</section>

	<section class="page-card">
		<div class="eyebrow">02 · Participantes</div>
		<h2>Datos y procedencia</h2>
		<p class="ayuda">Una encuesta puede ser anónima. Pide nombre o correo solo si los necesitas para interpretar o contactar a quien responde.</p>
		<div class="config-grid">
			<label class="campo"><span>Nombre</span><select value={value.nombre_modo} onchange={(e) => cambiar('nombre_modo', e.currentTarget.value as EncuestaInput['nombre_modo'])}>
				<option value="NO">No solicitar</option><option value="OPCIONAL">Opcional</option><option value="OBLIGATORIO">Obligatorio</option>
			</select></label>
			<label class="campo"><span>Correo</span><select value={value.correo_modo} onchange={(e) => cambiar('correo_modo', e.currentTarget.value as EncuestaInput['correo_modo'])}>
				<option value="NO">No solicitar</option><option value="OPCIONAL">Opcional</option><option value="OBLIGATORIO">Obligatorio</option>
			</select></label>
			<label class="campo"><span>Cierre automático</span><input type="datetime-local" value={fechaLocal(value.fecha_cierre)} onchange={(e) => cambiar('fecha_cierre', e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)} /></label>
		</div>
		<div class="origen">
			<label class="switch"><input type="checkbox" checked={value.registrar_origen} onchange={(e) => onChange({ ...value, registrar_origen: e.currentTarget.checked, politica_origen: e.currentTarget.checked ? 'MARCAR' : 'PERMITIR' })} /><span>Comparar procedencia de respuestas</span></label>
			<p>Se generan huellas de IP y navegador por esta encuesta. Las personas de la misma red pueden responder; una coincidencia de IP solo se señala.</p>
			{#if value.registrar_origen}
				<label class="campo"><span>Si se repite el dispositivo</span><select value={value.politica_origen} onchange={(e) => cambiar('politica_origen', e.currentTarget.value as EncuestaInput['politica_origen'])}>
					<option value="PERMITIR">Permitir, sin comparar</option>
					<option value="MARCAR">Aceptar y señalar en el reporte</option>
					<option value="BLOQUEAR_HUELLA">Una respuesta por dispositivo</option>
				</select></label>
			{/if}
		</div>
	</section>

	<section class="preguntas">
		<div class="preguntas-cabecera"><div><div class="eyebrow">03 · Cuestionario</div><h2>Preguntas <span>{value.preguntas.length}</span></h2></div><button type="button" class="btn-primary" onclick={() => nueva()}><Plus size={16} /> Agregar pregunta</button></div>
		{#if value.preguntas.length === 0}
			<div class="vacio page-card"><span>✦</span><strong>Tu encuesta empieza con una pregunta.</strong><p>Combina opciones, escalas, textos, fechas y números según lo que quieras aprender.</p><button type="button" class="btn-secondary" onclick={() => nueva()}><Plus size={16} /> Agregar primera pregunta</button></div>
		{/if}
		{#each value.preguntas as p, i (p.id)}
			<div class="page-card pregunta">
				<div class="pregunta-top"><span class="indice"><GripVertical size={16} /> Pregunta {String(i + 1).padStart(2, '0')}</span><div class="herramientas">
					<button type="button" title="Subir" disabled={i === 0} onclick={() => mover(p.id, -1)}><ArrowUp size={16} /></button>
					<button type="button" title="Bajar" disabled={i === value.preguntas.length - 1} onclick={() => mover(p.id, 1)}><ArrowDown size={16} /></button>
					<button type="button" title="Duplicar" onclick={() => duplicar(p)}><Copy size={16} /></button>
					<button type="button" title="Eliminar" onclick={() => cambiar('preguntas', value.preguntas.filter(x => x.id !== p.id))}><Trash2 size={16} /></button>
				</div></div>
				<div class="pregunta-principal">
					<label class="campo"><span>Pregunta</span><input value={p.titulo} maxlength="300" placeholder="Escribe la pregunta" oninput={(e) => cambiarPregunta(p.id, { titulo: e.currentTarget.value })} /></label>
					<label class="campo"><span>Tipo de respuesta</span><select value={p.tipo} onchange={(e) => cambiarTipo(p, e.currentTarget.value as TipoPregunta)}>
						{#each TIPOS as tipo}<option value={tipo.value}>{tipo.label}</option>{/each}
					</select></label>
				</div>
				<label class="campo"><span>Ayuda adicional <small>opcional</small></span><input value={p.descripcion} maxlength="500" placeholder="Una aclaración breve" oninput={(e) => cambiarPregunta(p.id, { descripcion: e.currentTarget.value })} /></label>
				{#if p.tipo === 'OPCION_UNICA' || p.tipo === 'OPCION_MULTIPLE'}
					<div class="opciones-editor">
						<span>Opciones de respuesta</span>
						{#each p.opciones as o, oi (o.id)}
							<div class="opcion"><b>{oi + 1}</b><input value={o.texto} maxlength="160" oninput={(e) => actualizarOpcion(p, o.id, e.currentTarget.value)} /><button type="button" title="Quitar opción" disabled={p.opciones.length <= (p.permite_otro ? 0 : 2)} onclick={() => quitarOpcion(p, o.id)}><Trash2 size={15} /></button></div>
						{/each}
						<button type="button" class="enlace" disabled={p.opciones.length >= 30} onclick={() => agregarOpcion(p)}><Plus size={15} /> Otra opción</button>
						<label class="switch otro-switch"><input type="checkbox" checked={p.permite_otro ?? false} onchange={(e) => cambiarPermiteOtro(p, e.currentTarget.checked)} /><span>Permitir una respuesta abierta</span></label>
						{#if p.permite_otro}<label class="campo otro-etiqueta"><span>Texto de la opción abierta</span><input value={p.otro_etiqueta ?? 'Otra (especificar)'} maxlength="80" oninput={(e) => cambiarPregunta(p.id, { otro_etiqueta: e.currentTarget.value })} placeholder="Otra (especificar)" /><small>Al elegirla, la persona podrá escribir su respuesta.</small></label>{/if}
					</div>
				{:else if p.tipo === 'ESCALA'}
					<div class="config-grid escala-config">
						<label class="campo"><span>Desde</span><input type="number" min="0" max="9" value={p.minimo ?? 1} onchange={(e) => cambiarPregunta(p.id, { minimo: Number(e.currentTarget.value) })} /></label>
						<label class="campo"><span>Hasta</span><input type="number" min="1" max="10" value={p.maximo ?? 5} onchange={(e) => cambiarPregunta(p.id, { maximo: Number(e.currentTarget.value) })} /></label>
					</div>
				{:else if p.tipo === 'NPS'}
					<p class="ayuda">Escala de 0 a 10. El reporte calcula automáticamente promotores, detractores y NPS.</p>
				{/if}
				<label class="switch requerida"><input type="checkbox" checked={p.requerida} onchange={(e) => cambiarPregunta(p.id, { requerida: e.currentTarget.checked })} /><span>Respuesta obligatoria</span></label>
			</div>
		{/each}
		{#if value.preguntas.length > 0}<button type="button" class="agregar-final" onclick={() => nueva()}><Plus size={16} /> Agregar otra pregunta</button>{/if}
	</section>
</div>

<ConfirmDialog
	open={confirmarReemplazo}
	title="¿Reemplazar el contenido actual?"
	message="La propuesta reemplazará el título, la descripción, el mensaje final y las preguntas actuales. Se conservarán las opciones de participantes y procedencia."
	tone="warning"
	confirmText="Usar propuesta"
	onconfirm={aplicarPropuesta}
	oncancel={() => (confirmarReemplazo = false)}
/>

<style>
	.editor { display: grid; gap: 1rem; }
	.ia-panel { display: grid; gap: .8rem; border-color: color-mix(in srgb, var(--emerald-500) 28%, var(--border-subtle)); background: linear-gradient(145deg, color-mix(in srgb, var(--emerald-500) 6%, var(--bg-surface)) 0%, var(--bg-surface) 62%); }
	.ia-cabecera { display: flex; align-items: flex-start; gap: .8rem; }
	.ia-icono { display: grid; place-items: center; width: 2.4rem; height: 2.4rem; flex: 0 0 auto; border-radius: .75rem; color: var(--emerald-800); background: color-mix(in srgb, var(--emerald-500) 14%, white); }
	.ia-etiqueta { color: var(--emerald-800); font-size: .66rem; font-weight: 850; letter-spacing: .12em; }
	.ia-cabecera h2 { margin: .25rem 0; }
	.ia-cabecera p, .propuesta-titulo p { margin: 0; color: var(--text-muted); font-size: .82rem; line-height: 1.5; }
	.ia-instrucciones { margin: 0; }
	.ia-instrucciones textarea { min-height: 7rem; }
	.ia-pie { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.ia-pie > span { max-width: 42rem; color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
	.ia-error { margin: 0; padding: .7rem .85rem; border: 1px solid color-mix(in srgb, #b42318 25%, transparent); border-radius: .65rem; color: #b42318; background: color-mix(in srgb, #b42318 5%, white); font-size: .8rem; }
	.ia-aplicada { display: flex; align-items: center; gap: .5rem; margin: 0; padding: .75rem .85rem; border: 1px solid color-mix(in srgb, var(--emerald-500) 26%, transparent); border-radius: .65rem; color: var(--emerald-800); background: color-mix(in srgb, var(--emerald-500) 7%, white); font-size: .8rem; font-weight: 650; }
	.ia-propuesta { display: grid; gap: .7rem; padding: 1rem; border: 1px solid var(--border-subtle); border-radius: .9rem; background: var(--bg-surface); }
	.propuesta-titulo { display: flex; justify-content: space-between; gap: 1rem; }
	.propuesta-titulo h3 { margin: .25rem 0; color: var(--text-primary); font-size: 1rem; }
	.propuesta-conteo { display: grid; place-items: center; width: 2.3rem; height: 2.3rem; flex: 0 0 auto; border-radius: .7rem; color: var(--emerald-800); background: color-mix(in srgb, var(--emerald-500) 12%, white); font-weight: 800; }
	.ia-propuesta ol { display: grid; gap: .35rem; margin: 0; padding: 0; list-style: none; }
	.ia-propuesta li { display: flex; justify-content: space-between; align-items: center; gap: .8rem; padding: .55rem .65rem; border-radius: .55rem; background: var(--bg-base); font-size: .8rem; }
	.ia-propuesta li span { min-width: 0; }
	.ia-propuesta li small { flex: 0 0 auto; color: var(--text-muted); font-size: .7rem; }
	.mas-preguntas { margin: 0; color: var(--text-muted); font-size: .75rem; }
	.propuesta-acciones { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: .5rem; }
	.girando { animation: girar 1s linear infinite; }
	@keyframes girar { to { transform: rotate(360deg); } }
	.eyebrow { margin-bottom: .75rem; }
	h2 { margin: 0 0 .5rem; font-size: 1.15rem; letter-spacing: -.02em; }
	h2 span { color: var(--text-muted); font-weight: 500; }
	.ayuda { margin: 0 0 1.2rem; font-size: .84rem; color: var(--text-secondary); line-height: 1.5; }
	.campo { display: flex; flex-direction: column; gap: .38rem; margin: .8rem 0; min-width: 0; }
	.campo > span, .opciones-editor > span { font-size: .78rem; color: var(--text-secondary); font-weight: 750; }
	.campo small { font-weight: 400; }
	input, textarea, select { width: 100%; box-sizing: border-box; min-height: 2.7rem; border: 1px solid var(--border-default, #ccd6d0); border-radius: .65rem; background: var(--bg-surface, white); color: var(--text-primary); padding: .65rem .75rem; font: inherit; }
	textarea { resize: vertical; }
	input:focus, textarea:focus, select:focus { outline: 2px solid var(--accion, #07875f); outline-offset: 2px; }
	.config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 1rem; }
	.origen { border-top: 1px solid var(--border-subtle); margin-top: 1rem; padding-top: 1rem; }
	.origen p { color: var(--text-secondary); font-size: .8rem; margin: .4rem 0 .8rem; line-height: 1.5; }
	.switch { display: inline-flex; align-items: center; gap: .5rem; font-size: .83rem; font-weight: 700; cursor: pointer; }
	.switch input { width: 1rem; min-height: 1rem; accent-color: var(--accion, #07875f); }
	.preguntas-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 1rem 0; }
	.vacio { display: flex; flex-direction: column; align-items: center; gap: .6rem; min-height: 13rem; text-align: center; padding: 2rem 1rem; color: var(--text-secondary); }
	.vacio span { font-size: 2rem; color: var(--accion, #07875f); }
	.vacio strong { color: var(--text-primary); }
	.vacio p { max-width: 26rem; margin: 0; }
	.vacio .btn-secondary { margin-top: .35rem; }
	.pregunta { margin-bottom: 0; }
	.pregunta-top { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: .8rem; margin-bottom: 1rem; }
	.indice { display: inline-flex; align-items: center; gap: .4rem; color: var(--text-secondary); font-size: .72rem; text-transform: uppercase; font-weight: 800; letter-spacing: .07em; }
	.herramientas { display: flex; gap: .2rem; }
	.herramientas button, .opcion button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; padding: .35rem; border-radius: .4rem; }
	.herramientas button:hover, .opcion button:hover { background: var(--bg-subtle, #edf2ee); }
	.herramientas button:disabled, .opcion button:disabled { opacity: .35; cursor: default; }
	.pregunta-principal { display: grid; grid-template-columns: minmax(0, 2fr) minmax(11rem, 1fr); gap: 1rem; }
	.opciones-editor { margin: 1.1rem 0; }
	.otro-switch { margin-top: .5rem; }
	.otro-etiqueta { margin: .25rem 0 0; }
	.otro-etiqueta small { color: var(--text-muted); font-size: .72rem; }
	.opcion { display: flex; align-items: center; gap: .6rem; margin-top: .45rem; }
	.opcion b { width: 1.6rem; text-align: center; color: var(--text-muted); font-size: .75rem; }
	.opcion input { flex: 1; }
	.enlace { display: inline-flex; align-items: center; gap: .3rem; border: 0; color: var(--accion, #07875f); background: transparent; font: inherit; font-size: .82rem; font-weight: 700; padding: .6rem 0; cursor: pointer; }
	.escala-config { max-width: 24rem; }
	.requerida { border-top: 1px solid var(--border-subtle); padding-top: 1rem; }
	.agregar-final { width: 100%; display: flex; justify-content: center; align-items: center; gap: .4rem; min-height: 44px; border: 1px dashed var(--border-default); border-radius: 12px; padding: .7rem; background: var(--bg-surface); color: var(--emerald-800); font: inherit; font-weight: 700; cursor: pointer; }
	@media (max-width: 650px) { .pregunta-principal { grid-template-columns: 1fr; gap: 0; } .preguntas-cabecera { align-items: start; flex-direction: column; } .ia-pie { align-items: stretch; flex-direction: column; } .ia-pie .btn-primary { justify-content: center; } .propuesta-acciones { display: grid; grid-template-columns: 1fr; } .ia-propuesta li { align-items: flex-start; flex-direction: column; gap: .2rem; } }
</style>
