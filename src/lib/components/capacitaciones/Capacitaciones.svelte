<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { apiClient } from '$lib/api/apiClient';
  import { portalFetch, portalFetchBlob, getApiBase } from '$lib/stores/portalStore';
  import { BiometricEngine } from '$lib/biometric/biometric.engine';
  import CourseCreateForm from './CourseCreateForm.svelte';
  import LessonEditor from './LessonEditor.svelte';
  import QuestionBankEditor from './QuestionBankEditor.svelte';

  let { portal = false, empresa = 'Transmeralda', vistaInicial = 'mios', cursoId = null, avisoInicial = '' }: {
    portal?: boolean; empresa?: string; vistaInicial?: 'mios' | 'gestion' | 'nuevo'; cursoId?: string | null; avisoInicial?: string
  } = $props();
  let base = $derived(portal ? '/conductor-portal/capacitaciones' : '/capacitaciones');
  let vista = $derived(vistaInicial);
  let cursos: any[] = $state([]);
  let gestion: any[] = $state([]);
  let portadasFallidas: Record<string, boolean> = $state({});
  let portadaDetalleFallida = $state(false);
  let puedeGestionar = $state(false);
  let requiereBiometria = $state(false);
  let puntajeAprobacion = $state(80);
  let vigenciaDias = $state<number | undefined>(undefined);
  let personas: any[] = $state([]);
  let busquedaPersonal = $state('');
  let filtroPersonal: 'todos' | 'conductor' | 'administrativo' = $state('todos');
  let detalle: any = $state(null);
  let gestionDetalle: any = $state(null);
  let seleccionados: string[] = $state([]);
  let respuestas: number[] = $state([]);
  let editarTitulo = $state('');
  let editarDescripcion = $state('');
  let nombreModulo = $state('');
  let nombreLeccion = $state('');
  let tipoLeccion = $state('lectura');
  let contenidoLeccion = $state('');
  let subtitulosLeccion = $state('');
  let moduloActivo = $state('');
  let preguntasTexto = $state('');
  let cargando = $state(false);
  let error = $state('');
  let aviso = $state('');
  let biometria: any = $state(null);
  let capturando = $state(false);
  let mensajeCaptura = $state('');
  let video: HTMLVideoElement | undefined = $state();
  let engine: BiometricEngine | null = null;
  let intervalo: ReturnType<typeof setInterval> | null = null;

  let personasFiltradas = $derived.by(() => {
    const termino = busquedaPersonal.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO').trim();
    return personas.filter((persona: any) => {
      const coincideTipo = filtroPersonal === 'todos' || persona.tipo === filtroPersonal;
      const texto = [persona.nombre, persona.detalle, persona.tipo, persona.id].filter(Boolean).join(' ')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO');
      return coincideTipo && (!termino || texto.includes(termino));
    });
  });
  let visiblesSeleccionados = $derived(personasFiltradas.length > 0 && personasFiltradas.every((persona: any) => seleccionados.includes(persona.tipo + ':' + persona.id)));

  function alternarPersona(persona: any, checked: boolean) {
    const clave = persona.tipo + ':' + persona.id;
    if (checked) {
      if (seleccionados.includes(clave) || seleccionados.length >= 200) return;
      seleccionados = [...seleccionados, clave];
    } else {
      seleccionados = seleccionados.filter((seleccionado) => seleccionado !== clave);
    }
  }

  function alternarVisibles() {
    if (visiblesSeleccionados) {
      const visibles = new Set(personasFiltradas.map((persona: any) => persona.tipo + ':' + persona.id));
      seleccionados = seleccionados.filter((clave) => !visibles.has(clave));
    } else {
      const resultado = new Set(seleccionados);
      for (const persona of personasFiltradas) {
        if (resultado.size >= 200) break;
        resultado.add(persona.tipo + ':' + persona.id);
      }
      seleccionados = [...resultado];
    }
  }

  async function request(path: string, method = 'GET', body?: unknown) {
    if (portal) {
      const response = await portalFetch(base + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return response.data;
    }
    const url = path.startsWith('/api/') ? path : '/api' + base + path;
    const response = await apiClient.request({ url, method, data: body });
    return response.data?.data;
  }
  function urlMedia(value: unknown): string {
    const url = typeof value === 'string' ? value : '';
    return url.startsWith('/') ? getApiBase() + url : url;
  }

  function inicialPortada(item: any): string {
    return String(item.codigo || item.titulo || 'C').trim().charAt(0).toUpperCase() || 'C';
  }

  function falla(cause: any) {
    error = cause?.response?.data?.message ?? cause?.message ?? 'No se pudo completar la operación.';
  }

  async function cargar() {
    cargando = true; error = '';
    try {
      if (portal || vista === 'mios') {
        cursos = await request('/cursos');
        if (!portal) {
          try { await request('/gestion/acceso'); puedeGestionar = true; }
          catch (cause: any) { puedeGestionar = false; if (cause?.response?.status !== 403) throw cause; }
        }
      } else if (vista === 'gestion') {
        gestion = await request('/gestion/cursos');
        personas = await request('/gestion/personas');
        puedeGestionar = true;
      } else {
        await request('/gestion/acceso');
        puedeGestionar = true;
      }
    } catch (cause) { falla(cause); }
    finally { cargando = false; }
  }

  async function abrir(id: string, administrar = false) {
    cargando = true; error = ''; aviso = '';
    portadaDetalleFallida = false;
    try {
      if (administrar) {
        gestionDetalle = await request('/gestion/cursos/' + id);
        editarTitulo = gestionDetalle.curso.titulo;
        editarDescripcion = gestionDetalle.curso.descripcion ?? '';
        requiereBiometria = gestionDetalle.curso.requiereBiometria;
        puntajeAprobacion = gestionDetalle.curso.puntajeAprobacion;
        vigenciaDias = gestionDetalle.curso.vigenciaDias ?? undefined;
        preguntasTexto = JSON.stringify(gestionDetalle.curso.preguntas.map((q: any) => ({ enunciado: q.enunciado, opciones: q.opciones, respuestaIndice: q.respuestaIndice })), null, 2);
        detalle = null;
      } else {
        detalle = await request('/cursos/' + id);
        gestionDetalle = null;
        respuestas = Array(detalle.curso.preguntas.length).fill(-1);
        biometria = await request('/biometria');
      }
    } catch (cause) { falla(cause); }
    finally { cargando = false; }
  }

  async function modulo() {
    if (!gestionDetalle) return;
    try {
      await request('/gestion/cursos/' + gestionDetalle.curso.id + '/modulos', 'POST',
        { titulo: nombreModulo, orden: gestionDetalle.curso.modulos.length });
      nombreModulo = ''; await abrir(gestionDetalle.curso.id, true);
    } catch (cause) { falla(cause); }
  }

  async function leccion() {
    if (!gestionDetalle || !moduloActivo) return;
    try {
      const contenido = tipoLeccion === 'lectura' ? { texto: contenidoLeccion } : { url: contenidoLeccion, subtitulosUrl: subtitulosLeccion };
      await request('/gestion/modulos/' + moduloActivo + '/lecciones', 'POST',
        { titulo: nombreLeccion, tipo: tipoLeccion, contenido });
      nombreLeccion = ''; contenidoLeccion = ''; subtitulosLeccion = ''; await abrir(gestionDetalle.curso.id, true);
    } catch (cause) { falla(cause); }
  }

  async function guardarConfiguracion() {
    if (!gestionDetalle) return;
    try {
      const c = gestionDetalle.curso;
      await request('/gestion/cursos/' + c.id, 'PUT', { titulo: editarTitulo, descripcion: editarDescripcion, estado: c.estado, requiereBiometria, puntajeAprobacion, vigenciaDias });
      await abrir(c.id, true); aviso = 'Configuración guardada.';
    } catch (cause) { falla(cause); }
  }

  async function publicar() {
    if (!gestionDetalle) return;
    try {
      const c = gestionDetalle.curso;
      await request('/gestion/cursos/' + c.id, 'PUT', {
        titulo: c.titulo, descripcion: c.descripcion, estado: 'publicado',
        puntajeAprobacion: c.puntajeAprobacion, requiereBiometria: c.requiereBiometria,
        vigenciaDias: c.vigenciaDias
      });
      await cargar(); await abrir(c.id, true); aviso = 'Curso publicado.';
    } catch (cause) { falla(cause); }
  }

  async function eliminarItem(tipo: 'modulos' | 'lecciones', id: string) {
    if (!gestionDetalle || !window.confirm('¿Eliminar este contenido y su progreso asociado?')) return;
    try {
      await request('/gestion/' + tipo + '/' + id, 'DELETE');
      await abrir(gestionDetalle.curso.id, true);
      aviso = 'Contenido eliminado.';
    } catch (cause) { falla(cause); }
  }

  async function guardarPreguntas() {
    if (!gestionDetalle) return;
    try {
      const preguntas = JSON.parse(preguntasTexto);
      await request('/gestion/cursos/' + gestionDetalle.curso.id + '/preguntas', 'PUT', { preguntas });
      await abrir(gestionDetalle.curso.id, true); aviso = 'Evaluación guardada.';
    } catch (cause) { falla(cause); }
  }

  async function asignar() {
    if (!gestionDetalle || !seleccionados.length) return;
    try {
      await request('/gestion/cursos/' + gestionDetalle.curso.id + '/asignaciones', 'POST', {
        personas: seleccionados.map((key) => { const [tipo, id] = key.split(':'); return { tipo, id }; })
      });
      seleccionados = []; await abrir(gestionDetalle.curso.id, true);
      aviso = 'Personas asignadas.';
    } catch (cause) { falla(cause); }
  }

  async function progreso(leccion: any, porcentaje: number, segundosVistos = 0) {
    if (!detalle) return;
    try {
      await request('/cursos/' + detalle.curso.id + '/lecciones/' + leccion.id + '/progreso',
        'PUT', { porcentaje, segundosVistos });
      await abrir(detalle.curso.id); aviso = 'Progreso guardado.';
    } catch (cause) { falla(cause); }
  }

  async function evaluar() {
    if (!detalle) return;
    try {
      const resultado = await request('/cursos/' + detalle.curso.id + '/evaluacion',
        'POST', { respuestas });
      aviso = resultado.intento.aprobado
        ? 'Aprobaste con ' + resultado.intento.puntaje + ' %. Certificado emitido.'
        : 'Obtuviste ' + resultado.intento.puntaje + ' %. Puedes intentarlo de nuevo.';
      await abrir(detalle.curso.id);
    } catch (cause) { falla(cause); }
  }

  async function descargarCertificado() {
    if (!detalle) return;
    try {
      const path = base + '/cursos/' + detalle.curso.id + '/certificado/pdf';
      const blob = portal
        ? await portalFetchBlob(path)
        : (await apiClient.get('/api' + path, { responseType: 'blob' })).data as Blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'certificado-' + detalle.asignacion.certificado.codigo + '.pdf';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { falla(cause); }
  }

  async function capturar() {
    if (capturando) return;
    capturando = true; error = ''; mensajeCaptura = 'Preparando cámara…';
    engine = new BiometricEngine({ onProgress: (p) => { mensajeCaptura = p.hintMessage || p.message; } });
    intervalo = setInterval(() => {
      if (video && engine?.getStream() && video.srcObject !== engine.getStream()) {
        video.srcObject = engine.getStream(); void video.play();
      }
    }, 150);
    try {
      const resultado = await engine.run();
      if (biometria?.enrolled && detalle) {
        const v = await request('/cursos/' + detalle.curso.id + '/biometria/verificar', 'POST', resultado);
        if (!v.matched) throw new Error('La identidad facial no coincide.');
        await abrir(detalle.curso.id);
        aviso = 'Identidad facial verificada.';
      } else {
        await request('/biometria/enrolar', 'POST', resultado);
        aviso = 'Identidad facial registrada. Verifícala antes de evaluar.';
      }
      biometria = await request('/biometria');
    } catch (cause) { falla(cause); }
    finally {
      engine?.abort(); engine = null; capturando = false;
      if (intervalo) clearInterval(intervalo);
      intervalo = null; if (video) video.srcObject = null;
    }
  }

  onMount(() => {
    void (async () => {
      await cargar();
      if (vista === 'gestion' && cursoId && puedeGestionar) {
        await abrir(cursoId, true);
        if (avisoInicial) aviso = avisoInicial;
      }
    })();
  });
  onDestroy(() => { engine?.abort(); if (intervalo) clearInterval(intervalo); });
</script>

<svelte:head><title>Capacitaciones | {empresa}</title></svelte:head>
<main class="cap">
  <header class="page-card cap-header">
    <div class="cap-heading">
      <p class="cap-eyebrow">Formación interna · {empresa}</p>
      <h1 class="cap-title">Capacitaciones</h1>
      <p class="cap-description">Cursos, lecciones, evaluaciones y certificados del personal.</p>
    </div>
    <div class="cap-actions">
      {#if !portal && vista === 'mios' && puedeGestionar}
        <a class="btn-secondary" href="/dashboard/capacitaciones/gestion">Administrar cursos</a>
      {:else if !portal && vista === 'gestion'}
        <a class="btn-secondary" href="/dashboard/capacitaciones">Mis cursos</a>
        <a class="btn-primary" href="/dashboard/capacitaciones/nuevo">Nuevo curso</a>
      {:else if !portal && vista === 'nuevo'}
        <a class="btn-secondary" href="/dashboard/capacitaciones/gestion">Volver a cursos</a>
      {/if}
      <button class="btn-secondary" onclick={() => void cargar()} disabled={cargando}>Actualizar</button>
    </div>
  </header>
  {#if error}<p class="alert cap-feedback" role="alert">{error}</p>{/if}
  {#if aviso}<p class="notice cap-feedback" role="status">{aviso}</p>{/if}
  {#if cargando}<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span>Cargando capacitaciones…</div>{/if}
  <div class="cap-content">
  {#if vista === 'mios' || portal}
    {#if detalle}
      <div class="learning-view">
      <button class="btn-secondary back" onclick={() => { detalle = null; void cargar(); }}>← Volver a mis cursos</button>
      <section class="page-card learning-course-heading">
        <div><span class="course-code">{detalle.curso.codigo ?? detalle.curso.slug ?? 'FORMACIÓN INTERNA'}</span><h2>{detalle.curso.titulo}</h2><p>{detalle.curso.descripcion}</p></div>
        <span class="catalog-count"><strong>{detalle.curso.modulos.length}</strong><span>módulos</span></span>
      </section>
      {#each detalle.curso.modulos as modulo}
        <section class="card learning-module"><h3>{modulo.titulo}</h3>
          {#each modulo.lecciones as leccion}
            <article class="lesson"><h4>{leccion.titulo}</h4>
              {#if leccion.tipo === 'lectura' && leccion.contenido.texto}
                <div class="reading">{leccion.contenido.texto}</div>
              {:else if leccion.tipo === 'lectura' && leccion.contenido.url}
                <iframe title={leccion.titulo} src={urlMedia(leccion.contenido.url)} class="content-frame"></iframe>
              {:else if leccion.tipo === 'video'}
                <video controls src={urlMedia(leccion.contenido.url)} onended={() => void progreso(leccion, 100, leccion.duracionSeg)}><track kind="captions" src={urlMedia(leccion.contenido.subtitulosUrl)} srclang="es" label="Español" /></video>
              {:else if leccion.tipo === 'audio'}
                <audio controls src={urlMedia(leccion.contenido.url)} onended={() => void progreso(leccion, 100, leccion.duracionSeg)}></audio>
              {:else if leccion.tipo === 'pptx' && leccion.contenido.previewUrl}
                <iframe title={leccion.titulo} src={urlMedia(leccion.contenido.previewUrl)} class="content-frame"></iframe>
                <a href={urlMedia(leccion.contenido.url)} target="_blank" rel="noopener noreferrer">Descargar presentación</a>
              {:else if leccion.tipo === 'pdf' || leccion.tipo === 'iframe' || !leccion.contenido.archivoId}
                <iframe title={leccion.titulo} src={urlMedia(leccion.contenido.url)} class="content-frame"></iframe>
              {:else}
                <p>Paquete {leccion.tipo.toUpperCase()} disponible como material descargable.</p>
                <a href={urlMedia(leccion.contenido.url)} target="_blank" rel="noopener noreferrer">Abrir archivo</a>
              {/if}
              {#if !detalle.asignacion.progresos.some((p: any) => p.leccionId === leccion.id && p.completadoAt) && leccion.tipo !== 'video' && leccion.tipo !== 'audio'}
                <button onclick={() => void progreso(leccion, 100, leccion.duracionSeg)}>Marcar como completada</button>
              {:else if detalle.asignacion.progresos.some((p: any) => p.leccionId === leccion.id && p.completadoAt)}<span class="done">✓ Completada</span>{/if}
            </article>
          {/each}
        </section>
      {/each}
      {#if detalle.curso.requiereBiometria}
        <section class="card"><h3>Verificación facial</h3>
          <p>{biometria?.enrolled ? 'Tu rostro está registrado. Verifica tu identidad antes de evaluar.' : 'Registra tu rostro para esta capacitación.'}</p>
          {#if capturando}<video bind:this={video} muted playsinline class="camera"></video><p role="status">{mensajeCaptura}</p>{/if}
          <button onclick={() => void capturar()} disabled={capturando}>{biometria?.enrolled ? 'Verificar identidad' : 'Registrar rostro'}</button>
        </section>
      {/if}
      {#if detalle.curso.preguntas.length}
        <section class="card"><h3>Evaluación</h3>
          {#each detalle.curso.preguntas as pregunta, i}
            <fieldset><legend>{i + 1}. {pregunta.enunciado}</legend>
              {#each pregunta.opciones as opcion, j}
                <label><input type="radio" name={'pregunta-' + i} checked={respuestas[i] === j}
                  onchange={() => { respuestas[i] = j; respuestas = [...respuestas]; }} /> {opcion}</label>
              {/each}
            </fieldset>
          {/each}
          <button disabled={respuestas.some((x) => x < 0)} onclick={() => void evaluar()}>Enviar evaluación</button>
        </section>
      {/if}
      {#if detalle.asignacion.certificado}
        <section class="card certificate"><h3>Certificado</h3><strong>{detalle.asignacion.certificado.codigo}</strong>
          <p>Emitido el {new Date(detalle.asignacion.certificado.emitidoAt).toLocaleDateString('es-CO')}</p>
          <button onclick={() => void descargarCertificado()}>Descargar PDF</button>
          <a href={'/capacitaciones/verificar/' + detalle.asignacion.certificado.codigo}>Verificar certificado</a>
        </section>
      {/if}
      </div>
    {:else}
      <div class="section-heading">
        <div><p class="cap-eyebrow">Tu formación</p><h2>Mis cursos</h2><p>Continúa donde lo dejaste y revisa tu avance.</p></div>
        <span class="catalog-count"><strong>{cursos.length}</strong><span>cursos</span></span>
      </div>
      {#if !cursos.length && !cargando}<div class="empty-state"><span class="empty-mark" aria-hidden="true">C</span><h3>Aún no tienes cursos asignados</h3><p>Cuando Talento Humano o HSEQ te asignen una capacitación, aparecerá aquí.</p></div>{/if}
      <div class="grid">{#each cursos as item}
        <button class="card course learner-course-card" onclick={() => void abrir(item.curso.id)}>
          <strong>{item.curso.titulo}</strong><span>{item.estado === 'aprobado' ? 'Aprobado' : 'En curso'}</span>
          <small>{item.curso._count?.modulos ?? 0} módulos</small>
        </button>
      {/each}</div>
    {/if}
  {:else if vista === 'gestion'}
    {#if gestionDetalle}
      <div class="course-management">
        <a class="back" href="/dashboard/capacitaciones/gestion">← Volver al catálogo</a>
        <section class="page-card course-summary" aria-labelledby="course-summary-title">
          {#if gestionDetalle.curso.portadaUrl && !portadaDetalleFallida}
            <img class="course-summary-cover" src={urlMedia(gestionDetalle.curso.portadaUrl)} alt="Portada de {gestionDetalle.curso.titulo}" onerror={() => portadaDetalleFallida = true} />
          {:else}
            <div class="course-summary-fallback" aria-hidden="true"><strong>{inicialPortada(gestionDetalle.curso)}</strong><span>Capacitación · {empresa}</span></div>
          {/if}
          <div class="course-summary-copy">
            <span class="course-code">{gestionDetalle.curso.codigo ?? gestionDetalle.curso.slug ?? 'CURSO INTERNO'}</span>
            <h2 id="course-summary-title">{gestionDetalle.curso.titulo}</h2>
            {#if gestionDetalle.curso.descripcion}<p>{gestionDetalle.curso.descripcion}</p>{/if}
            <div class="course-summary-meta">
              <span class="course-status state-{gestionDetalle.curso.estado}">{gestionDetalle.curso.estado}</span>
              <span class="summary-metric"><strong>{gestionDetalle.curso.modulos.length}</strong> módulos</span>
              <span class="summary-metric"><strong>{gestionDetalle.curso.preguntas.length}</strong> preguntas</span>
              <span class="summary-metric"><strong>{gestionDetalle.asignaciones.length}</strong> personas</span>
            </div>
          </div>
          {#if gestionDetalle.curso.estado !== 'publicado'}
            <button class="btn-primary publish-action" onclick={() => void publicar()}>Publicar curso</button>
          {/if}
        </section>
        <section class="card detail-panel" aria-labelledby="course-settings-title">
          <header class="content-heading"><div><p class="cap-eyebrow">Ajustes generales</p><h3 id="course-settings-title">Configuración del curso</h3><p>Define los requisitos de aprobación y la vigencia del certificado.</p></div>
            <button class="btn-secondary" onclick={() => void guardarConfiguracion()}>Guardar cambios</button></header>
          <div class="detail-settings">
            <label class="wide">Título <input bind:value={editarTitulo} /></label>
            <label class="wide">Descripción <textarea bind:value={editarDescripcion}></textarea></label>
            <label class="check-setting"><input type="checkbox" bind:checked={requiereBiometria} /> Requerir verificación facial antes de evaluar</label>
            <label>Puntaje mínimo para aprobar <input type="number" min="1" max="100" bind:value={puntajeAprobacion} /></label>
            <label>Vigencia del certificado en días <input type="number" min="1" max="3650" bind:value={vigenciaDias} /></label>
          </div>
        </section>
        <div class="management-section">
          <LessonEditor cursoId={gestionDetalle.curso.id} modulos={gestionDetalle.curso.modulos}
            modalidadesEntrega={gestionDetalle.curso.configuracion?.entrega?.modalidades ?? []}
            {request} onChange={() => abrir(gestionDetalle.curso.id, true)} />
        </div>
        <div class="management-section">
          <QuestionBankEditor cursoId={gestionDetalle.curso.id} preguntas={gestionDetalle.curso.preguntas}
            {request} onSaved={() => abrir(gestionDetalle.curso.id, true)} />
        </div>
        <section class="card assignment-panel" aria-labelledby="assignment-title">
          <header class="content-heading"><div><p class="cap-eyebrow">Participantes</p><h3 id="assignment-title">Asignar personal</h3><p>Selecciona conductores o personal administrativo para este curso.</p></div>
            <span class="catalog-count"><strong>{gestionDetalle.asignaciones.length}</strong><span>asignaciones</span></span></header>
          <div class="people-picker">
            <div class="people-picker-tools">
              <label class="people-search">Buscar personal <input type="search" bind:value={busquedaPersonal} placeholder="Nombre, área o últimos dígitos" autocomplete="off" /></label>
              <button type="button" class="select-visible" aria-pressed={visiblesSeleccionados} disabled={!personasFiltradas.length || (seleccionados.length >= 200 && !visiblesSeleccionados)} onclick={alternarVisibles}>
                {visiblesSeleccionados ? 'Quitar visibles' : 'Seleccionar visibles'}
              </button>
            </div>
            <div class="people-filters" role="group" aria-label="Filtrar tipo de personal">
              <button type="button" class:active={filtroPersonal === 'todos'} aria-pressed={filtroPersonal === 'todos'} onclick={() => filtroPersonal = 'todos'}>Todos <span>{personas.length}</span></button>
              <button type="button" class:active={filtroPersonal === 'conductor'} aria-pressed={filtroPersonal === 'conductor'} onclick={() => filtroPersonal = 'conductor'}>Conductores <span>{personas.filter((persona: any) => persona.tipo === 'conductor').length}</span></button>
              <button type="button" class:active={filtroPersonal === 'administrativo'} aria-pressed={filtroPersonal === 'administrativo'} onclick={() => filtroPersonal = 'administrativo'}>Usuarios <span>{personas.filter((persona: any) => persona.tipo === 'administrativo').length}</span></button>
            </div>
            <div class="people-results" role="group" aria-label="Resultados de personal">
              {#each personasFiltradas as persona (persona.tipo + ':' + persona.id)}
                {@const clave = persona.tipo + ':' + persona.id}
                <label class="people-option" class:selected={seleccionados.includes(clave)}>
                  <input type="checkbox" checked={seleccionados.includes(clave)} disabled={!seleccionados.includes(clave) && seleccionados.length >= 200} onchange={(event) => alternarPersona(persona, event.currentTarget.checked)} />
                  <span class="people-option-copy"><strong>{persona.nombre}</strong><small>{persona.tipo === 'conductor' ? 'Conductor' : 'Usuario'}{persona.detalle ? ' · ' + persona.detalle : ''}</small></span>
                </label>
              {:else}
                <p class="people-no-results">No hay personas que coincidan con esa búsqueda.</p>
              {/each}
            </div>
            <footer class="people-selection"><span><strong>{seleccionados.length}</strong> seleccionados <small>· máximo 200 por asignación</small></span>
              <div class="selection-actions"><button type="button" class="clear-selection" disabled={!seleccionados.length} onclick={() => seleccionados = []}>Limpiar selección</button>
                <button class="btn-primary" disabled={!seleccionados.length} onclick={() => void asignar()}>Asignar seleccionados</button></div>
            </footer>
          </div>
          {#if gestionDetalle.asignaciones.length}
            <div class="table-wrap"><table><thead><tr><th scope="col">Persona</th><th scope="col">Estado</th><th scope="col">Completó</th><th scope="col">Certificado</th></tr></thead><tbody>
            {#each gestionDetalle.asignaciones as a}<tr>
              <td>{personas.find((p: any) => p.tipo === a.personaTipo && p.id === a.personaId)?.nombre ?? a.personaId}</td>
              <td>{a.estado}</td><td>{a.completadoAt ? new Date(a.completadoAt).toLocaleDateString('es-CO') : '—'}</td>
              <td>{a.certificado?.codigo ?? '—'}</td>
            </tr>{/each}
            </tbody></table></div>
          {:else}
            <p class="assignment-empty">Todavía no hay personas asignadas a esta capacitación.</p>
          {/if}
        </section>
      </div>
    {:else}
      <section class="course-catalog" aria-labelledby="catalog-title">
        <div class="section-heading"><div><p class="cap-eyebrow">Biblioteca institucional</p><h2 id="catalog-title">Todos los cursos</h2><p>Administra contenidos, evaluaciones y asignaciones del personal.</p></div>
          <span class="catalog-count"><strong>{gestion.length}</strong><span>cursos</span></span></div>
        {#if !gestion.length && !cargando}<div class="empty-state"><span class="empty-mark" aria-hidden="true">C</span><h3>El catálogo está listo para comenzar</h3><p>Crea la primera capacitación y organiza sus lecciones, preguntas y participantes.</p><a class="btn-primary" href="/dashboard/capacitaciones/nuevo">Registrar curso</a></div>{/if}
        {#if gestion.length}<div class="grid course-grid">{#each gestion as item, i}
        <a class="card course course-card" href={'/dashboard/capacitaciones/gestion/' + item.id}>
          <div class="course-banner">
            {#if item.portadaUrl && !portadasFallidas[item.id]}
              <img src={urlMedia(item.portadaUrl)} alt="Portada del curso {item.titulo}" loading="lazy" decoding="async"
                onerror={() => portadasFallidas = { ...portadasFallidas, [item.id]: true }} />
            {:else}
              <div class={`course-fallback tone-${i % 4}`} aria-hidden="true">
                <span class="fallback-code">{item.codigo ?? 'FORMACIÓN INTERNA'}</span>
                <strong>{inicialPortada(item)}</strong>
                <span class="fallback-caption">Capacitación · {empresa}</span>
              </div>
            {/if}
            <span class="state state-{item.estado}">{item.estado}</span>
          </div>
          <div class="course-body">
            <span class="course-code">{item.codigo ?? item.slug ?? 'CURSO INTERNO'}</span>
            <h3>{item.titulo}</h3>
            {#if item.descripcion}<p class="course-description">{item.descripcion}</p>{/if}
            <div class="course-stats">
              <span>{item._count?.modulos ?? 0} módulos</span>
              <span>{item._count?.preguntas ?? 0} preguntas</span>
            </div>
            <div class="course-footer">
              <small>{item._count?.asignaciones ?? 0} personas asignadas</small>
              <span class="course-open">Editar <span aria-hidden="true">→</span></span>
            </div>
          </div>
        </a>
      {/each}</div>{/if}
      </section>
    {/if}
  {:else if vista === 'nuevo'}
    {#if puedeGestionar}
      <CourseCreateForm {request} {empresa} onCreated={(curso, mensaje) => {
        const query = mensaje ? '?aviso=' + encodeURIComponent(mensaje) : '';
        void goto('/dashboard/capacitaciones/gestion/' + curso.id + query);
      }} />
    {:else if !cargando}
      <p class="alert" role="alert">No tienes permisos para registrar capacitaciones.</p>
    {/if}
  {/if}
  </div>
</main>

<style>
  .cap{width:100%;padding:24px;color:var(--text-primary);font-family:inherit}
  .cap-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px 24px;margin-bottom:16px;padding:1.25rem 1.5rem}
  .cap-heading{display:flex;min-width:0;flex-direction:column;gap:4px}
  .cap-eyebrow{margin:0;color:var(--au-primary-strong);font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .cap-title{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1.6rem;font-weight:800;letter-spacing:-.025em;line-height:1.15}
  .cap-description{margin:0;color:var(--text-muted);font-size:.85rem;line-height:1.5}
  .cap-actions{display:flex;flex-shrink:0;flex-wrap:wrap;align-items:center;gap:.5rem}
  .cap-content{display:grid;min-width:0;gap:1rem}.cap-feedback{margin:0}
  .loading-state{display:flex;align-items:center;gap:.65rem;border:1px solid var(--border-subtle);border-radius:14px;background:var(--bg-surface);padding:.8rem 1rem;color:var(--text-muted);font-size:.85rem}
  .loading-spinner{width:16px;height:16px;border:2px solid var(--border-default);border-top-color:var(--au-primary-strong);border-radius:50%;animation:cap-spin .8s linear infinite}
  @keyframes cap-spin{to{transform:rotate(360deg)}}
  .course-catalog,.course-management,.learning-view{display:grid;min-width:0;gap:1rem}
  .course-management>.back{display:inline-flex;min-height:40px;align-items:center;gap:.4rem;justify-self:start;margin:0;border:1px solid var(--border-subtle);border-radius:11px;background:var(--bg-surface);padding:.55rem .8rem;color:var(--text-secondary);font-size:.76rem;font-weight:750;text-decoration:none;transition:border-color .15s ease,color .15s ease,background-color .15s ease}
  .course-management>.back:hover{border-color:var(--border-emphasis);background:var(--bg-base);color:var(--au-primary-strong)}
  .course-summary{display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr) auto;align-items:center;gap:1.25rem;margin:0;padding:1.25rem 1.4rem}
  .course-summary-cover,.course-summary-fallback{display:flex;width:100%;aspect-ratio:16/9;align-items:center;justify-content:center;overflow:hidden;border-radius:15px;object-fit:cover}
  .course-summary-fallback{position:relative;flex-direction:column;gap:.5rem;background:linear-gradient(135deg,var(--au-tint),var(--bg-base));color:var(--au-primary-strong)}.course-summary-fallback::after{position:absolute;right:-24px;bottom:-54px;width:130px;height:130px;border:1px solid color-mix(in srgb,var(--au-primary) 16%,transparent);border-radius:50%;content:''}.course-summary-fallback strong{font-family:var(--font-display);font-size:3.5rem;line-height:1}.course-summary-fallback span{font-size:.64rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .course-summary-copy{display:grid;min-width:0;gap:.4rem}.course-summary-copy h2,.learning-course-heading h2{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1.35rem;font-weight:850;letter-spacing:-.025em;line-height:1.2}.course-summary-copy>p,.learning-course-heading p{max-width:75ch;margin:0;color:var(--text-muted);font-size:.82rem;line-height:1.55}
  .course-summary-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;margin-top:.3rem;color:var(--text-muted);font-size:.69rem}.summary-metric{display:inline-flex;min-height:29px;align-items:center;gap:.28rem;border:1px solid var(--border-subtle);border-radius:999px;background:var(--bg-base);padding:.25rem .55rem}.summary-metric strong{color:var(--text-primary);font-size:.72rem;font-weight:850}
  .course-status{display:inline-flex;min-height:29px;align-items:center;border:1px solid var(--border-default);border-radius:999px;background:var(--bg-surface);padding:.25rem .65rem;color:var(--text-secondary);font-size:.67rem;font-weight:850;text-transform:capitalize}.course-status.state-publicado{border-color:color-mix(in srgb,var(--au-primary-strong) 22%,var(--border-default));background:var(--au-tint);color:var(--au-primary-strong)}.publish-action{white-space:nowrap}
  .detail-panel,.assignment-panel{margin:0;border-color:var(--border-subtle);border-radius:20px;padding:1.25rem 1.4rem;box-shadow:var(--shadow-card)}.content-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.content-heading>div{display:grid;gap:.25rem}.content-heading .cap-eyebrow{font-size:.64rem}.content-heading h3{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1rem;font-weight:850;letter-spacing:-.015em}.content-heading p:last-child{margin:0;color:var(--text-muted);font-size:.76rem;line-height:1.5}
  .detail-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.3rem 1.1rem;margin-top:1rem}.detail-settings label{display:grid;min-width:0;gap:.4rem;margin:0 0 .65rem;color:var(--text-secondary);font-size:.74rem;font-weight:750}.detail-settings .wide{grid-column:1/-1}.detail-settings label input:not([type=checkbox]),.detail-settings label textarea{width:100%;max-width:none;min-height:43px;margin:0;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-surface);padding:.65rem .8rem;color:var(--text-primary);font:inherit;font-size:.8rem}.detail-settings label textarea{min-height:92px;resize:vertical}.detail-settings label input:focus-visible,.detail-settings label textarea:focus-visible{outline:0;border-color:var(--au-primary);box-shadow:0 0 0 3px rgba(var(--au-primary-rgb),.13)}.detail-settings .check-setting{display:flex;align-items:center;gap:.6rem;align-self:center;margin:0;padding:.7rem .8rem;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-base)}.detail-settings .check-setting input{width:17px;height:17px;min-height:0;flex:none;margin:0;padding:0;accent-color:var(--au-primary-strong)}
  .people-picker{display:grid;gap:.75rem;margin-top:1rem}.people-picker-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:.75rem}.people-search{display:grid;gap:.35rem;margin:0;color:var(--text-secondary);font-size:.76rem;font-weight:750}.people-search input{max-width:none;margin:0;border-color:var(--border-default);border-radius:12px;padding:.7rem .85rem}.select-visible{min-height:42px;border-color:var(--border-default);border-radius:12px;background:var(--bg-surface);color:var(--au-primary-strong);font-size:.76rem;font-weight:750}.select-visible:disabled{opacity:.5}
  .people-filters{display:flex;flex-wrap:wrap;gap:.35rem;padding:.25rem;border:1px solid var(--border-subtle);border-radius:13px;background:var(--bg-base)}.people-filters button{display:inline-flex;align-items:center;gap:.45rem;min-height:36px;padding:.35rem .7rem;border-color:transparent;border-radius:9px;background:transparent;color:var(--text-muted);font-size:.74rem;font-weight:750}.people-filters button.active{border-color:var(--border-subtle);background:var(--bg-surface);color:var(--au-primary-strong);box-shadow:0 1px 2px #0f172a0a}.people-filters button span{display:inline-grid;min-width:20px;height:20px;place-items:center;border-radius:999px;background:var(--bg-base);color:var(--text-muted);font-size:.65rem}
  .people-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:.5rem;max-height:350px;overflow:auto;padding:.15rem .15rem .35rem}.people-option{display:flex;min-width:0;align-items:center;gap:.7rem;margin:0;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-surface);padding:.65rem .75rem;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}.people-option.selected{border-color:color-mix(in srgb,var(--au-primary-strong) 34%,var(--border-default));background:var(--au-tint)}.people-option>input{width:17px;height:17px;flex:none;margin:0;accent-color:var(--au-primary-strong)}.people-option-copy{display:grid;min-width:0;gap:.15rem}.people-option-copy strong{overflow:hidden;color:var(--text-primary);font-size:.76rem;text-overflow:ellipsis;white-space:nowrap}.people-option-copy small{overflow:hidden;color:var(--text-muted);font-size:.68rem;text-overflow:ellipsis;white-space:nowrap}.people-no-results{grid-column:1/-1;margin:0;border:1px dashed var(--border-default);border-radius:12px;padding:1rem;color:var(--text-muted);font-size:.8rem;text-align:center}
  .people-selection{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid var(--border-subtle);padding-top:.8rem;color:var(--text-secondary);font-size:.78rem}.people-selection>span{display:flex;flex-wrap:wrap;align-items:baseline;gap:.3rem}.people-selection strong{color:var(--text-primary);font-size:.95rem}.people-selection small{color:var(--text-muted);font-size:.7rem}.selection-actions{display:flex;align-items:center;gap:.5rem}.clear-selection{border-color:transparent;background:transparent;color:var(--text-muted);font-size:.74rem;font-weight:700}.clear-selection:hover:not(:disabled){background:var(--bg-base);color:var(--text-primary)}.assignment-empty{margin:0;border-top:1px solid var(--border-subtle);padding-top:.9rem;color:var(--text-muted);font-size:.82rem}
  .management-section{min-width:0}.management-section :global(.bank){margin:0;border-color:var(--border-subtle);border-radius:20px;box-shadow:var(--shadow-card)}
  .assignment-panel .table-wrap{margin-top:1rem;overflow:auto;border:1px solid var(--border-subtle);border-radius:14px}.assignment-panel table{width:100%;border-collapse:collapse}.assignment-panel th,.assignment-panel td{padding:.75rem .85rem;text-align:left;vertical-align:middle}.assignment-panel th{background:var(--bg-base);color:var(--text-muted);font-size:.64rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.assignment-panel td{color:var(--text-secondary);font-size:.73rem}.assignment-panel tr:last-child td{border-bottom:0}
  .learning-course-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:0;padding:1.25rem 1.5rem}.learning-course-heading>div{display:grid;gap:.4rem;min-width:0}.learning-module,.learning-view>.card{margin:0}.learner-course-card{min-height:160px;border:1px solid var(--border-subtle);color:var(--text-primary);text-align:left;cursor:pointer}.learner-course-card:hover{border-color:var(--border-emphasis)}
  h1{font-size:clamp(28px,4vw,42px);margin:4px 0}h2{margin-top:26px}h3{margin-top:0}
  button{cursor:pointer;border:1px solid #b9d2c9;background:white;border-radius:10px;padding:10px 14px;color:#17342d}
  button:hover{border-color:#28745d}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#116b50;color:white}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
  .course-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:stretch;gap:24px}
  .card{background:white;border:1px solid #dbe8e3;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 4px 20px #17342d0a}
  .course{text-align:left;display:flex;flex-direction:column;gap:8px;width:100%;min-height:145px}.course strong{font-size:18px}.course-code{font-size:11px;color:#558474;font-weight:750;letter-spacing:.08em;text-transform:uppercase}a.course{text-decoration:none;color:inherit}
  .course-card{margin:0;padding:12px;border-radius:18px;min-width:0;min-height:100%;gap:0;overflow:hidden;box-shadow:0 6px 22px #17342d0a;transition:transform 180ms ease,box-shadow 180ms ease,border-color 180ms ease}.course-card:focus-visible{outline:3px solid #61a889;outline-offset:3px}
  .course-banner{position:relative;overflow:hidden;aspect-ratio:16/9;border-radius:12px;background:#edf4ef}.course-banner>img{display:block;width:100%;height:100%;object-fit:cover}.course-fallback{position:relative;display:flex;width:100%;height:100%;min-height:150px;flex-direction:column;justify-content:space-between;overflow:hidden;padding:16px 18px;color:#17342d}.course-fallback::after{position:absolute;right:-25px;bottom:-66px;width:174px;height:174px;border:1px solid #ffffff80;border-radius:50%;content:''}.course-fallback::before{position:absolute;right:18px;bottom:-42px;width:118px;height:118px;border:1px solid #ffffff70;border-radius:50%;content:''}.tone-0{background:linear-gradient(135deg,#dcefe4,#b6dac7)}.tone-1{background:linear-gradient(135deg,#e0edf5,#b9d4e2)}.tone-2{background:linear-gradient(135deg,#f4ebd9,#e7c98e)}.tone-3{background:linear-gradient(135deg,#ece6f3,#cfc0df)}.fallback-code,.fallback-caption{position:relative;z-index:1;color:#31594a;font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.fallback-code{max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.course-fallback strong{position:relative;z-index:1;font-size:clamp(42px,5vw,64px);font-weight:800;line-height:.9;letter-spacing:-.08em;color:#ffffffb8}.fallback-caption{color:#45685b;letter-spacing:.04em;text-transform:none}.course-banner .state{position:absolute;top:10px;right:10px;border:1px solid #ffffffb8;border-radius:999px;background:#ffffffed;padding:5px 9px;color:#31594a;font-size:10px;font-weight:750;text-transform:capitalize;backdrop-filter:blur(8px)}.course-banner .state-publicado{background:#e9f7efed;color:#14643f}.course-body{display:flex;min-width:0;flex:1;flex-direction:column;padding:14px 5px 4px}.course-body h3{display:-webkit-box;overflow:hidden;margin:6px 0 0;color:#17342d;font-size:17px;line-height:1.3;-webkit-box-orient:vertical;-webkit-line-clamp:2}.course-description{display:-webkit-box;overflow:hidden;min-height:38px;margin:8px 0 12px;color:#64776f;font-size:12px;line-height:1.55;-webkit-box-orient:vertical;-webkit-line-clamp:2}.course-stats{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 14px}.course-stats span{border:1px solid #e3ece7;border-radius:999px;background:#f8fbf9;padding:5px 8px;color:#536b60;font-size:10px;font-weight:650}.course-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;border-top:1px solid #edf2ef;padding-top:11px}.course-footer small{color:#60766d;font-size:11px}.course-open{color:#176b50;font-size:11px;font-weight:750;white-space:nowrap}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.section-heading h2{margin:0}.section-heading p{margin:5px 0;color:#60766d}.section-heading>span{font-size:12px;color:#60766d}
  .lesson{border-top:1px solid #e4eee9;padding:16px 0}.reading{white-space:pre-wrap;line-height:1.7;max-width:75ch}
  video:not(.camera),.content-frame{width:100%;max-width:760px;aspect-ratio:16/9;border:0;background:#10241f}
  audio{width:100%;max-width:600px}.camera{width:min(100%,440px);aspect-ratio:4/5;object-fit:cover;transform:scaleX(-1);border-radius:18px;background:#10241f}
  .done{display:inline-block;color:#116b50;margin:12px}.back{margin:14px 0}
  .course-cover{display:block;width:min(100%,520px);aspect-ratio:16/9;object-fit:cover;border-radius:14px;margin:12px 0 18px;background:#e8f0eb}
  label{display:block;margin:12px 0}input:not([type=radio]):not([type=checkbox]),textarea,select{display:block;width:100%;max-width:680px;padding:10px;margin-top:5px;border:1px solid #b9d2c9;border-radius:8px;font:inherit}
  select[multiple]{max-width:600px}fieldset{border:1px solid #dbe8e3;border-radius:8px;margin:14px 0}fieldset label{display:block}
  .table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:580px}th,td{text-align:left;padding:10px;border-bottom:1px solid #dbe8e3}th{font-size:12px;text-transform:uppercase;color:#52796b}
  .alert,.notice{padding:12px 16px;border-radius:10px}.alert{background:#fff1ee;color:#aa3126}.notice{background:#e7f7ec;color:#166347}
  .catalog-count{display:inline-flex;flex:none;align-items:baseline;gap:.4rem;border:1px solid var(--border-subtle);border-radius:999px;background:var(--bg-surface);padding:.45rem .75rem;color:var(--text-muted);font-size:.72rem}.catalog-count strong{color:var(--text-primary);font-size:1rem;font-weight:850}
  .empty-state{display:grid;justify-items:center;gap:.55rem;border:1px dashed var(--border-emphasis);border-radius:18px;background:var(--bg-surface);padding:2.25rem 1.25rem;text-align:center}.empty-mark{display:grid;width:48px;height:48px;place-items:center;border-radius:15px;background:var(--au-tint);color:var(--au-primary-strong);font-family:var(--font-display);font-size:1.25rem;font-weight:850}.empty-state h3{margin:.2rem 0 0;color:var(--text-primary);font-family:var(--font-display);font-size:1rem}.empty-state p{max-width:54ch;margin:0 0 .55rem;color:var(--text-muted);font-size:.82rem;line-height:1.55}
  .section-heading{padding:.1rem .1rem .3rem}.section-heading>div{display:grid;gap:.25rem;min-width:0}.section-heading h2{color:var(--text-primary);font-family:var(--font-display);font-size:1.25rem;font-weight:800;letter-spacing:-.02em}.section-heading p{margin:0;color:var(--text-muted);font-size:.82rem;line-height:1.5}.section-heading>.catalog-count{font-size:.72rem;color:var(--text-muted)}
  @media (hover:hover) and (pointer:fine){.course-card:hover{transform:translateY(-2px);border-color:#b6d0c4;box-shadow:0 12px 28px #17342d12}}
  @media (prefers-reduced-motion:reduce){.loading-spinner{animation:none;border-top-color:var(--border-default)}}
  @media(max-width:1000px){.course-summary{grid-template-columns:minmax(130px,190px) minmax(0,1fr)}.publish-action{grid-column:2;justify-self:start}}
  @media(max-width:650px){.cap-header{padding:1rem;gap:14px}.cap-actions{width:100%}.cap-actions>*{flex:1;justify-content:center;padding-inline:.75rem}.cap{padding:16px}.course-grid{gap:16px}}
  @media(max-width:650px){.course-summary{grid-template-columns:minmax(0,1fr);gap:.9rem;padding:1rem}.course-summary-cover,.course-summary-fallback{max-height:200px}.publish-action{grid-column:1}.detail-panel,.assignment-panel{padding:1rem}.content-heading{align-items:flex-start;flex-direction:column}.content-heading>.catalog-count{align-self:flex-start}.detail-settings{grid-template-columns:minmax(0,1fr)}.detail-settings .wide{grid-column:auto}.people-picker-tools{grid-template-columns:minmax(0,1fr)}.select-visible{justify-self:start}.people-selection{align-items:stretch;flex-direction:column}.selection-actions{width:100%}.selection-actions .btn-primary{flex:1}.learning-course-heading{align-items:flex-start;padding:1rem}.learning-course-heading .catalog-count{align-self:flex-start}.section-heading{align-items:flex-start}.section-heading>.catalog-count{padding:.4rem .6rem}}
</style>
