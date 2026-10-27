<script lang="ts">
	import { Plus, Trash2, ArrowUp, ArrowDown, Copy, GripVertical } from 'lucide-svelte';
	import type { EncuestaInput, PreguntaEncuesta, TipoPregunta } from '$lib/api/encuestas';

	interface Props {
		value: EncuestaInput;
		onChange: (value: EncuestaInput) => void;
	}
	let { value, onChange }: Props = $props();

	const TIPOS: Array<{ value: TipoPregunta; label: string }> = [
		{ value: 'TEXTO_CORTO', label: 'Texto corto' },
		{ value: 'TEXTO_LARGO', label: 'Párrafo' },
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
	function fechaLocal(iso: string | null) {
		if (!iso) return '';
		const d = new Date(iso);
		return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	}
</script>

<div class="editor">
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
							<div class="opcion"><b>{oi + 1}</b><input value={o.texto} maxlength="160" oninput={(e) => actualizarOpcion(p, o.id, e.currentTarget.value)} /><button type="button" title="Quitar opción" disabled={p.opciones.length <= 2} onclick={() => quitarOpcion(p, o.id)}><Trash2 size={15} /></button></div>
						{/each}
						<button type="button" class="enlace" disabled={p.opciones.length >= 30} onclick={() => agregarOpcion(p)}><Plus size={15} /> Otra opción</button>
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

<style>
	.editor { display: grid; gap: 1rem; }
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
	.opcion { display: flex; align-items: center; gap: .6rem; margin-top: .45rem; }
	.opcion b { width: 1.6rem; text-align: center; color: var(--text-muted); font-size: .75rem; }
	.opcion input { flex: 1; }
	.enlace { display: inline-flex; align-items: center; gap: .3rem; border: 0; color: var(--accion, #07875f); background: transparent; font: inherit; font-size: .82rem; font-weight: 700; padding: .6rem 0; cursor: pointer; }
	.escala-config { max-width: 24rem; }
	.requerida { border-top: 1px solid var(--border-subtle); padding-top: 1rem; }
	.agregar-final { width: 100%; display: flex; justify-content: center; align-items: center; gap: .4rem; min-height: 44px; border: 1px dashed var(--border-default); border-radius: 12px; padding: .7rem; background: var(--bg-surface); color: var(--emerald-800); font: inherit; font-weight: 700; cursor: pointer; }
	@media (max-width: 650px) { .pregunta-principal { grid-template-columns: 1fr; gap: 0; } .preguntas-cabecera { align-items: start; flex-direction: column; } }
</style>
