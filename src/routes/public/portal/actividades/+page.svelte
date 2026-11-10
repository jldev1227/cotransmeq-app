<script lang="ts">
  import { onMount } from 'svelte';
  import { portalSession, portalFetch } from '$lib/stores/portalStore';

  let actividades = $state<any[]>([]);
  let cargando = $state(true);
  let sincronizando = $state(false);
  let error = $state('');
  let conductorId = '';

  const cacheKey = () => `portal-hseq-actividades:${conductorId}`;
  const apiId = (id: string) => encodeURIComponent(id);
  const fecha = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

  function enfocarActividad() {
    const id = new URLSearchParams(window.location.search).get('ocurrenciaId');
    if (id) window.setTimeout(() => document.getElementById(`actividad-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }

  async function cargar() {
    if (!conductorId) return;
    sincronizando = true;
    error = '';
    try {
      const raw = localStorage.getItem(cacheKey());
      if (raw) actividades = JSON.parse(raw);
    } catch { /* La caché dañada no debe impedir abrir el portal. */ }
    try {
      const respuesta = await portalFetch('/conductor-portal/mis-actividades');
      actividades = respuesta.data ?? [];
      localStorage.setItem(cacheKey(), JSON.stringify(actividades));
      enfocarActividad();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'No hay conexión. Mostramos la última copia guardada en este dispositivo.';
    } finally {
      sincronizando = false;
      cargando = false;
    }
  }

  async function completar(actividad: any) {
    try {
      await portalFetch(`/conductor-portal/mis-actividades/${apiId(actividad.id)}/completar`, { method: 'POST' });
      await cargar();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'No se pudo completar la actividad. Verifica la conexión y vuelve a intentarlo.';
    }
  }

  async function adjuntar(actividad: any, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    const form = new FormData();
    form.append('archivo', archivo);
    try {
      await portalFetch(`/conductor-portal/mis-actividades/${apiId(actividad.id)}/evidencias`, { method: 'POST', body: form });
      await cargar();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'No se pudo subir el soporte.';
    } finally { input.value = ''; }
  }

  async function abrirSoporte(id: string) {
    try {
      const result = await portalFetch(`/conductor-portal/mis-actividades/evidencias/${apiId(id)}/url`);
      window.open(result.data.url, '_blank', 'noopener');
    } catch { error = 'No se pudo abrir el soporte.'; }
  }

  onMount(() => portalSession.subscribe((session) => {
    conductorId = session?.conductor.id ?? '';
    if (session) void cargar();
    else { actividades = []; cargando = false; }
  }));
</script>

<svelte:head>
  <title>Mis actividades HSEQ/PESV · Portal del Conductor</title>
  <meta name="description" content="Consulta y completa las actividades HSEQ y PESV que te asignaron." />
</svelte:head>

<main class="activities-page">
  <header>
    <div>
      <p class="eyebrow">HSEQ · PESV</p>
      <h1>Mis actividades</h1>
      <p>Consulta tus tareas, fechas de cumplimiento y soportes.</p>
    </div>
    <button type="button" class="refresh" onclick={cargar} disabled={sincronizando}>
      {sincronizando ? 'Actualizando…' : 'Actualizar'}
    </button>
  </header>

  {#if error}<p class="notice" role="status">{error}</p>{/if}
  {#if cargando}
    <p class="state">Cargando tus actividades…</p>
  {:else if actividades.length === 0}
    <section class="empty">
      <span class="empty-icon" aria-hidden="true">✓</span>
      <h2>Estás al día</h2>
      <p>Cuando te asignen una actividad HSEQ o PESV aparecerá aquí, con su fecha y los soportes solicitados.</p>
    </section>
  {:else}
    <section class="activity-list" aria-label="Actividades asignadas">
      {#each actividades as actividad (actividad.id)}
        <article id="actividad-{actividad.id}" class="activity-card">
          <div class="card-top">
            <span class="program">{actividad.unidad_programa}</span>
            <span class:late={actividad.estado === 'ATRASADA'} class:done={actividad.estado === 'COMPLETADA'} class="status">
              {actividad.estado === 'COMPLETADA' ? 'Completada' : actividad.estado === 'ATRASADA' ? 'Atrasada' : 'Pendiente'}
            </span>
          </div>
          <h2>{actividad.actividad}</h2>
          <p class="due">Vence el {fecha(actividad.fecha_vencimiento)}</p>
          {#if actividad.roles?.length}<p class="due">Tu rol: {actividad.roles.map((rol: string) => rol === 'RESPONSABLE' ? 'Responsable' : rol === 'COLABORADOR' ? 'Colaborador' : 'Suplente').join(', ')}</p>{/if}
          {#if actividad.metodo_seguimiento}<p>{actividad.metodo_seguimiento}</p>{/if}
          {#if actividad.alcance}<p class="muted">Público de la actividad: {actividad.alcance}</p>{/if}

          {#if actividad.evidencias?.length}
            <div class="supports">
              <strong>Soportes</strong>
              {#each actividad.evidencias as evidencia}
                <button type="button" class="support-link" onclick={() => abrirSoporte(evidencia.id)}>{evidencia.nombre_archivo}</button>
              {/each}
            </div>
          {/if}

          {#if actividad.estado !== 'COMPLETADA' && actividad.estado !== 'NO_APLICA'}
            <div class="actions">
              {#if actividad.requiere_evidencia}
                <label class="upload">
                  <span>{actividad.evidencias?.length ? 'Adjuntar otro soporte' : 'Adjuntar soporte requerido'}</span>
                  <input type="file" accept="application/pdf,image/*,.docx,.xlsx,.txt" onchange={(event) => adjuntar(actividad, event)} />
                </label>
              {/if}
              <button type="button" class="complete" onclick={() => completar(actividad)}>
                Marcar como completada
              </button>
            </div>
            {#if actividad.requiere_evidencia && !actividad.evidencias?.length}
              <p class="muted">Debes adjuntar al menos un soporte para cerrar esta actividad.</p>
            {/if}
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</main>

<style>
  .activities-page { padding: 1.25rem; display: grid; gap: 1rem; color: var(--text-primary, #17372a); }
  header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; }
  h1 { margin:0; font-size:clamp(1.6rem,4vw,2.2rem); font-weight:850; }
  header p { margin:.3rem 0 0; color:var(--text-muted,#66756d); }
  .eyebrow { color:var(--emerald-600,#087a57); font-size:.72rem; font-weight:850; letter-spacing:.14em; }
  .refresh,.complete,.upload { min-height:44px; border:0; border-radius:10px; padding:.65rem .9rem; font-weight:800; cursor:pointer; }
  .refresh { background:#e8f5ed; color:var(--emerald-600,#087a57); }
  .refresh:disabled { opacity:.65; }
  .state,.notice,.empty,.activity-card { border:1px solid #dce8df; border-radius:16px; background:white; padding:1rem; }
  .notice { color:#8a3412; background:#fff8eb; border-color:#f2d6a2; }
  .empty { min-height:16rem; display:grid; justify-items:center; align-content:center; text-align:center; gap:.4rem; }
  .empty h2,.empty p { margin:0; }
  .empty p { max-width:42rem; color:#64756b; line-height:1.55; }
  .empty-icon { display:grid; place-items:center; width:3rem; height:3rem; border-radius:50%; background:#e8f5ed; color:var(--emerald-600,#087a57); font-size:1.5rem; font-weight:900; }
  .activity-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr)); gap:.8rem; }
  .activity-card { display:flex; flex-direction:column; align-items:flex-start; gap:.55rem; }
  .activity-card h2 { margin:.1rem 0; font-size:1.12rem; line-height:1.4; }
  .activity-card p { margin:0; color:#53655a; line-height:1.5; }
  .card-top { width:100%; display:flex; justify-content:space-between; align-items:center; gap:.5rem; }
  .program { color:var(--emerald-600,#087a57); font-size:.76rem; font-weight:850; }
  .status { border-radius:999px; padding:.25rem .55rem; background:#fff2d6; color:#855400; font-size:.73rem; font-weight:850; }
  .status.late { background:#fee9e7; color:#9a2d26; }
  .status.done { background:#e5f4eb; color:#145c3d; }
  .due { font-size:.9rem; font-weight:750; }
  .muted { color:#718076!important; font-size:.86rem; }
  .supports,.actions { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; width:100%; margin-top:.25rem; }
  .supports { border-top:1px solid #edf1ee; padding-top:.65rem; }
  .support-link { border:0; background:transparent; color:var(--emerald-600,#087a57); text-decoration:underline; cursor:pointer; padding:.35rem; }
  .upload { position:relative; display:inline-flex; align-items:center; background:#e8f5ed; color:#145c3d; }
  .upload input { position:absolute; inset:0; opacity:0; width:100%; cursor:pointer; }
  .complete { background:var(--emerald-600,#087a57); color:white; }
  @media(max-width:600px) { header { flex-direction:column; } .refresh { width:100%; } .actions { display:grid; } }
</style>
