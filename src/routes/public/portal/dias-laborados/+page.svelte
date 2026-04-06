<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { portalSession, isAuthenticated, portalFetch, conductorNombre } from '$lib/stores/portalStore';

  // ═══════════════════════════════
  // TIPOS
  // ═══════════════════════════════
  type TipoLabor = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

  interface RegistroDia {
    id?: string;
    fecha: string;
    tipo: TipoLabor;
    hora_inicio?: string | null;
    hora_fin?: string | null;
    horas_conducidas?: number | null;
    cliente_id?: string | null;
    cliente_nombre?: string | null;
    vehiculo_placa?: string | null;
    observaciones?: string | null;
  }

  interface ClienteBasico { id: string; nombre: string; }
  interface VehiculoBasico { id: string; placa: string; conductor_id?: string; }

  // ═══════════════════════════════
  // CONSTANTES
  // ═══════════════════════════════
  const TIPOS: { value: TipoLabor; label: string; color: string; icon: string }[] = [
    { value: 'LABORADO',      label: 'Día Laborado',  color: '#1e40af', icon: '🚛' },
    { value: 'DISPONIBLE',    label: 'Disponible',    color: '#2563eb', icon: '✅' },
    { value: 'DESCANSO',      label: 'Descanso',      color: '#d97706', icon: '🌙' },
    { value: 'MANTENIMIENTO', label: 'Mantenimiento', color: '#dc2626', icon: '🔧' }
  ];

  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // ═══════════════════════════════
  // ESTADO
  // ═══════════════════════════════
  const hoy = new Date();
  let mesActual  = hoy.getMonth();
  let anioActual = hoy.getFullYear();
  let registros: Record<string, RegistroDia> = {};
  let loadingRegistros = false;

  let clientes: ClienteBasico[] = [];
  let vehiculos: VehiculoBasico[] = [];
  let loadingDatos = false;

  let modalAbierto = false;
  let fechaSeleccionada = '';
  let form: Partial<RegistroDia> = {};
  let guardando  = false;
  let guardadoOk = false;
  let formError  = '';

  // ═══════════════════════════════
  // MOUNT
  // ═══════════════════════════════
  onMount(async () => {
    if (!$isAuthenticated) {
      goto('/public/portal');
      return;
    }
    await cargarDatosIniciales();
  });

  async function cargarDatosIniciales() {
    loadingDatos = true;
    try {
      const [clientesRes, vehiculosRes] = await Promise.all([
        portalFetch('/conductor-portal/dias-laborados/clientes'),
        portalFetch('/conductor-portal/dias-laborados/vehiculos')
      ]);
      clientes = clientesRes.data || [];
      vehiculos = vehiculosRes.data || [];
    } catch (err: any) {
      if (err.status === 401) { portalSession.logout(); goto('/public/portal'); return; }
      console.error('Error cargando datos:', err);
    } finally {
      loadingDatos = false;
    }
    await cargarRegistrosMes();
  }

  // ═══════════════════════════════
  // REGISTROS
  // ═══════════════════════════════
  async function cargarRegistrosMes() {
    loadingRegistros = true;
    try {
      const mes = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}`;
      const res = await portalFetch(`/conductor-portal/dias-laborados/registros?mes=${mes}`);
      const data: RegistroDia[] = res.data || [];
      const map: Record<string, RegistroDia> = {};
      for (const r of data) {
        const f = r.fecha.slice(0, 10);
        map[f] = { ...r, fecha: f };
      }
      registros = map;
    } catch (err: any) {
      if (err.status === 401) { portalSession.logout(); goto('/public/portal'); return; }
      console.error('Error cargando registros:', err);
    } finally {
      loadingRegistros = false;
    }
  }

  async function guardarDia() {
    formError = '';
    if (!form.tipo) { formError = 'Selecciona el tipo de jornada'; return; }
    if (form.tipo === 'LABORADO') {
      if (!form.hora_inicio) { formError = 'Ingresa la hora de inicio'; return; }
      if (!form.hora_fin) { formError = 'Ingresa la hora de fin'; return; }
      if (!form.horas_conducidas || Number(form.horas_conducidas) <= 0) {
        formError = 'Ingresa las horas conducidas'; return;
      }
      if (!form.cliente_id) {
        formError = 'Selecciona el cliente'; return;
      }
    }

    guardando = true;
    try {
      let clienteNombre: string | null = null;
      if (form.cliente_id) {
        const cl = clientes.find(c => c.id === form.cliente_id);
        clienteNombre = cl?.nombre || null;
      }

      const payload = {
        fecha: fechaSeleccionada,
        tipo: form.tipo,
        hora_inicio: form.tipo === 'LABORADO' ? form.hora_inicio : null,
        hora_fin: form.tipo === 'LABORADO' ? form.hora_fin : null,
        horas_conducidas: form.tipo === 'LABORADO' ? Number(form.horas_conducidas) : null,
        cliente_id: form.tipo === 'LABORADO' ? form.cliente_id : null,
        cliente_nombre: form.tipo === 'LABORADO' ? clienteNombre : null,
        vehiculo_placa: form.tipo === 'LABORADO' ? form.vehiculo_placa : null,
        observaciones: form.observaciones || null
      };

      const res = await portalFetch('/conductor-portal/dias-laborados/registros', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const saved = res.data;
      const f = saved.fecha.slice(0, 10);
      registros[f] = { ...saved, fecha: f };
      registros = { ...registros };

      guardadoOk = true;
      await new Promise(r => setTimeout(r, 800));
      cerrarModal();
    } catch (err: any) {
      formError = err.message || 'Error al guardar registro';
    } finally {
      guardando = false;
    }
  }

  async function eliminarRegistro() {
    try {
      await portalFetch(`/conductor-portal/dias-laborados/registros/${fechaSeleccionada}`, { method: 'DELETE' });
      delete registros[fechaSeleccionada];
      registros = { ...registros };
      cerrarModal();
    } catch (err: any) {
      formError = err.message || 'Error al eliminar registro';
    }
  }

  // ═══════════════════════════════
  // CALENDARIO
  // ═══════════════════════════════
  $: diasDelMes = (() => {
    const primer = new Date(anioActual, mesActual, 1).getDay();
    const total  = new Date(anioActual, mesActual + 1, 0).getDate();
    const dias: (number | null)[] = Array(primer).fill(null);
    for (let i = 1; i <= total; i++) dias.push(i);
    while (dias.length % 7 !== 0) dias.push(null);
    return dias;
  })();

  function mesAnterior()  {
    if (mesActual === 0) { mesActual = 11; anioActual--; } else mesActual--;
    cargarRegistrosMes();
  }
  function mesSiguiente() {
    if (mesActual === 11) { mesActual = 0; anioActual++; } else mesActual++;
    cargarRegistrosMes();
  }

  function fechaStr(dia: number) {
    return `${anioActual}-${String(mesActual+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  }
  function esFuturo(dia: number) {
    const f = new Date(anioActual, mesActual, dia); f.setHours(0,0,0,0);
    const h = new Date(); h.setHours(0,0,0,0);
    return f > h;
  }
  function esHoy(dia: number) {
    return fechaStr(dia) === `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  }
  function getTipo(dia: number) {
    const r = registros[fechaStr(dia)];
    return r ? TIPOS.find(t => t.value === r.tipo) : null;
  }

  function abrirDia(dia: number) {
    if (esFuturo(dia)) return;
    fechaSeleccionada = fechaStr(dia);
    const reg = registros[fechaSeleccionada];
    form = reg ? { ...reg } : { fecha: fechaSeleccionada };
    guardadoOk = false; formError = ''; modalAbierto = true;
  }
  function cerrarModal() { modalAbierto = false; fechaSeleccionada = ''; form = {}; }

  // ═══════════════════════════════
  // FORMULARIO
  // ═══════════════════════════════
  $: horasCalculadas = (() => {
    if (!form.hora_inicio || !form.hora_fin) return null;
    const [h1,m1] = form.hora_inicio.split(':').map(Number);
    const [h2,m2] = form.hora_fin.split(':').map(Number);
    const mins = (h2*60+m2) - (h1*60+m1);
    return mins > 0 ? +(mins/60).toFixed(1) : null;
  })();

  // ═══════════════════════════════
  // STATS
  // ═══════════════════════════════
  $: statsMes = (() => {
    const pre = `${anioActual}-${String(mesActual+1).padStart(2,'0')}`;
    const dm = Object.values(registros).filter(r => r.fecha.startsWith(pre));
    return {
      laborados:    dm.filter(r => r.tipo === 'LABORADO').length,
      disponibles:  dm.filter(r => r.tipo === 'DISPONIBLE').length,
      descansos:    dm.filter(r => r.tipo === 'DESCANSO').length,
      mantenimiento:dm.filter(r => r.tipo === 'MANTENIMIENTO').length,
      horasTotales: dm.reduce((s,r) => s + (Number(r.horas_conducidas)||0), 0)
    };
  })();

  $: fechaLegible = (() => {
    if (!fechaSeleccionada) return '';
    const [y,m,d] = fechaSeleccionada.split('-').map(Number);
    return new Date(y, m-1, d).toLocaleDateString('es-CO',
      { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  })();
</script>

<div class="dias-page">
  <!-- Header -->
  <div class="page-header">
    <div>
      <h1 class="page-title">📅 Días Laborados</h1>
      <p class="page-sub">Registra tu actividad diaria</p>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-row">
    <div class="stat-card" style="--accent:#1e40af">
      <div class="stat-val">{statsMes.laborados}</div>
      <div class="stat-label">Laborados</div>
    </div>
    <div class="stat-card" style="--accent:#2563eb">
      <div class="stat-val">{statsMes.disponibles}</div>
      <div class="stat-label">Disponible</div>
    </div>
    <div class="stat-card" style="--accent:#d97706">
      <div class="stat-val">{statsMes.descansos}</div>
      <div class="stat-label">Descanso</div>
    </div>
    <div class="stat-card" style="--accent:#dc2626">
      <div class="stat-val">{statsMes.mantenimiento}</div>
      <div class="stat-label">Mant.</div>
    </div>
    <div class="stat-card" style="--accent:#f97316">
      <div class="stat-val">{statsMes.horasTotales}h</div>
      <div class="stat-label">Horas</div>
    </div>
  </div>

  <!-- Calendar -->
  <div class="cal-card">
    <div class="cal-header">
      <button class="btn-nav" on:click={mesAnterior}>‹</button>
      <div style="text-align:center">
        <div class="cal-mes">{MESES[mesActual]}</div>
        <div class="cal-anio">{anioActual}</div>
      </div>
      <button class="btn-nav" on:click={mesSiguiente}>›</button>
    </div>

    <div class="cal-dias-nombre">
      {#each DIAS_SEMANA as d}
        <div class="dia-nombre">{d}</div>
      {/each}
    </div>

    <div class="cal-grid">
      {#each diasDelMes as dia}
        {#if dia === null}
          <div class="dia-celda vacio"></div>
        {:else}
          {@const tipo = getTipo(dia)}
          {@const futuro = esFuturo(dia)}
          {@const hoyFlag = esHoy(dia)}
          <div
            class="dia-celda"
            class:registrado={!!tipo}
            class:futuro
            class:hoy-celda={hoyFlag}
            style={tipo ? `--tcolor:${tipo.color};` : ''}
            on:click={() => abrirDia(dia)}
            on:keydown={(e) => e.key==='Enter' && abrirDia(dia)}
            role="button" tabindex={futuro ? -1 : 0}
            aria-label="Día {dia}"
          >
            <span class="dia-num">{dia}</span>
            {#if tipo}<span class="dia-icon">{tipo.icon}</span>{/if}
          </div>
        {/if}
      {/each}
    </div>

    {#if loadingRegistros}
      <div class="cal-loading">
        <span class="spinner-sm"></span> Cargando...
      </div>
    {/if}

    <div class="leyenda">
      {#each TIPOS as t}
        <div class="ley-item">
          <div class="ley-dot" style="background:{t.color}"></div>
          {t.icon} {t.label}
        </div>
      {/each}
    </div>
  </div>

  <div class="hint-bottom">📅 Toca cualquier día pasado para registrar tu actividad</div>
</div>

<!-- ═══════════════════════════════
     MODAL
═══════════════════════════════ -->
{#if modalAbierto}
<div
  class="modal-overlay"
  on:click|self={cerrarModal}
  on:keydown={(e) => e.key==='Escape' && cerrarModal()}
  role="dialog" aria-modal="true" tabindex="-1"
>
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="modal-fecha">{fechaLegible}</div>
        <div class="modal-fecha-sub">{fechaSeleccionada}</div>
      </div>
      <button class="btn-cerrar" on:click={cerrarModal}>✕</button>
    </div>

    <div class="modal-body">
      <p class="section-label">Tipo de jornada</p>
      <div class="tipo-grid">
        {#each TIPOS as t}
          <button
            class="tipo-btn"
            class:selected={form.tipo === t.value}
            style={form.tipo === t.value ? `--tcolor:${t.color}` : ''}
            on:click={() => { form.tipo = t.value; formError = ''; }}
          >
            <span class="tipo-icon">{t.icon}</span>
            <span class="tipo-label">{t.label}</span>
          </button>
        {/each}
      </div>

      {#if form.tipo === 'LABORADO'}
        <div class="form-section">
          <div class="form-section-title">🕐 Horas del turno</div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="h-inicio">Hora inicio</label>
              <input id="h-inicio" type="time" class="field-input" bind:value={form.hora_inicio} />
            </div>
            <div class="field">
              <label class="field-label" for="h-fin">Hora fin</label>
              <input id="h-fin" type="time" class="field-input" bind:value={form.hora_fin} />
            </div>
          </div>
          {#if horasCalculadas !== null}
            <p class="field-hint">⏱ Duración: <strong>{horasCalculadas} h</strong></p>
          {/if}
          <div class="field" style="margin-top:.75rem">
            <label class="field-label" for="h-cond">Horas conducidas</label>
            <input id="h-cond" type="number" min="0" max="24" step="0.5"
              class="field-input" bind:value={form.horas_conducidas} placeholder="Ej: 6.5" />
          </div>

          <div class="field" style="margin-top:.75rem">
            <label class="field-label" for="cliente">Cliente</label>
            <select id="cliente" class="field-input" bind:value={form.cliente_id}>
              <option value="">— Seleccionar cliente —</option>
              {#each clientes as c}
                <option value={c.id}>{c.nombre}</option>
              {/each}
            </select>
          </div>

          <div class="field" style="margin-top:.75rem">
            <label class="field-label" for="placa">Placa vehículo</label>
            <select id="placa" class="field-input" bind:value={form.vehiculo_placa}>
              <option value="">— Seleccionar placa —</option>
              {#each vehiculos as v}
                <option value={v.placa}>{v.placa}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}

      {#if form.tipo}
        <div class="field" style="margin-top:.5rem">
          <label class="field-label" for="obs">
            Observaciones <span style="color:var(--text3,#94a3b8);font-weight:400">(opcional)</span>
          </label>
          <textarea id="obs" class="field-input field-textarea"
            bind:value={form.observaciones}
            placeholder="Agrega notas si es necesario..."
            rows="2"
          ></textarea>
        </div>
      {/if}

      {#if formError}
        <div class="form-error">⚠ {formError}</div>
      {/if}
    </div>

    <div class="modal-actions">
      {#if registros[fechaSeleccionada]}
        <button class="btn-eliminar" on:click={eliminarRegistro} title="Eliminar registro">🗑</button>
      {/if}
      <button
        class="btn-guardar" class:ok={guardadoOk}
        on:click={guardarDia}
        disabled={guardando || !form.tipo}
      >
        {#if guardando}
          <span class="spinner-dark"></span> Guardando...
        {:else if guardadoOk}
          ✓ Guardado
        {:else}
          Guardar registro
        {/if}
      </button>
    </div>
  </div>
</div>
{/if}

<style>
  .dias-page {
    max-width: 560px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 1rem;
  }
  .page-title {
    font-size: 1.35rem;
    font-weight: 800;
    margin: 0;
    color: var(--text, #0f172a);
  }
  .page-sub {
    font-size: 0.82rem;
    color: var(--text3, #94a3b8);
    margin: 0.2rem 0 0;
  }

  /* ── Stats ── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .stat-card {
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 10px;
    padding: 0.5rem 0.25rem;
    text-align: center;
    border-top: 3px solid var(--accent);
  }
  .stat-val {
    font-weight: 800;
    font-size: 1.1rem;
    color: var(--accent);
    font-family: 'JetBrains Mono', monospace;
  }
  .stat-label {
    font-size: 0.62rem;
    color: var(--text3, #94a3b8);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-top: 0.1rem;
  }

  /* ── Calendar ── */
  .cal-card {
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 14px;
    padding: 1rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    position: relative;
  }
  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .cal-mes { font-weight: 800; font-size: 1.15rem; color: var(--text, #0f172a); }
  .cal-anio { font-size: 0.75rem; color: var(--text3, #94a3b8); }
  .btn-nav {
    width: 36px; height: 36px;
    border-radius: 10px;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    font-size: 1.3rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text2, #475569);
    transition: all .15s;
  }
  .btn-nav:active { transform: scale(0.9); }

  .cal-dias-nombre {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    margin-bottom: 0.25rem;
  }
  .dia-nombre {
    text-align: center;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text3, #94a3b8);
    text-transform: uppercase;
    padding: 0.25rem 0;
  }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
  }
  .dia-celda {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    cursor: pointer;
    transition: all .15s;
    position: relative;
    background: var(--surface, #fff);
    -webkit-tap-highlight-color: transparent;
  }
  .dia-celda.vacio { cursor: default; }
  .dia-celda.futuro { opacity: 0.3; cursor: not-allowed; }
  .dia-celda.registrado {
    background: color-mix(in srgb, var(--tcolor) 12%, transparent);
    border: 2px solid var(--tcolor);
  }
  .dia-celda.hoy-celda {
    box-shadow: inset 0 0 0 2px #1e40af;
  }
  .dia-celda:not(.vacio):not(.futuro):hover {
    background: var(--surface2, #f8fafc);
    transform: scale(1.05);
  }
  .dia-celda:not(.vacio):not(.futuro):active {
    transform: scale(0.95);
  }

  .dia-num {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--text, #0f172a);
  }
  .dia-icon { font-size: 0.7rem; margin-top: -1px; }

  .cal-loading {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(255,255,255,0.8);
    display: flex; align-items: center; justify-content: center;
    gap: 0.5rem;
    border-radius: 14px;
    font-size: 0.85rem;
    color: var(--text2, #475569);
  }

  .leyenda {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--border, #e2e8f0);
  }
  .ley-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--text2, #475569);
    font-weight: 600;
  }
  .ley-dot {
    width: 8px; height: 8px; border-radius: 50%;
  }

  .hint-bottom {
    text-align: center;
    font-size: 0.78rem;
    color: var(--text3, #94a3b8);
    margin-top: 0.75rem;
    padding-bottom: 0.5rem;
  }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed; inset: 0;
    z-index: 200;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end; justify-content: center;
    padding: 0;
  }
  @media (min-width: 640px) {
    .modal-overlay { align-items: center; padding: 1rem; }
  }

  .modal {
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    background: var(--surface, #fff);
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 32px rgba(0,0,0,0.15);
  }
  @media (min-width: 640px) {
    .modal { border-radius: 20px; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
  .modal-fecha { font-weight: 700; font-size: 0.95rem; color: var(--text, #0f172a); text-transform: capitalize; }
  .modal-fecha-sub { font-size: 0.72rem; color: var(--text3, #94a3b8); font-family: 'JetBrains Mono', monospace; }
  .btn-cerrar {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    font-size: 1rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text2, #475569);
  }

  .modal-body { padding: 1rem 1.25rem; }

  .section-label {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--text2, #475569);
    text-transform: uppercase;
    margin: 0 0 0.5rem;
  }

  .tipo-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .tipo-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 10px;
    border: 2px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    cursor: pointer;
    transition: all .15s;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .tipo-btn.selected {
    border-color: var(--tcolor);
    background: color-mix(in srgb, var(--tcolor) 8%, transparent);
    color: var(--tcolor);
  }
  .tipo-icon { font-size: 1.1rem; }
  .tipo-label { font-size: 0.8rem; }

  .form-section { margin-top: 1rem; }
  .form-section-title {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--text, #0f172a);
    margin-bottom: 0.5rem;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .field { display: flex; flex-direction: column; }
  .field-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text2, #475569);
    margin-bottom: 0.25rem;
    text-transform: uppercase;
  }
  .field-input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    font-size: 0.9rem;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    outline: none;
    font-family: inherit;
  }
  .field-input:focus { border-color: #1e40af; box-shadow: 0 0 0 2px rgba(30,64,175,0.1); }
  .field-textarea { resize: vertical; min-height: 50px; }
  .field-hint { font-size: 0.78rem; color: #1e40af; margin: 0.3rem 0 0; }

  .form-error {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    font-size: 0.82rem;
    color: #dc2626;
    font-weight: 600;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 1.25rem;
    border-top: 1px solid var(--border, #e2e8f0);
  }

  .btn-eliminar {
    width: 40px; height: 40px;
    border-radius: 10px;
    border: 1px solid #fca5a5;
    background: #fef2f2;
    font-size: 1.1rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s;
  }
  .btn-eliminar:hover { background: #fee2e2; }

  .btn-guardar {
    flex: 1;
    padding: 0.65rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #1e40af, #1d4ed8);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    transition: all .15s;
  }
  .btn-guardar:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-guardar.ok { background: #1e40af; }

  .spinner-sm, .spinner-dark {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
  .spinner-sm {
    border-color: var(--border, #e2e8f0);
    border-top-color: #1e40af;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ── */
  @media (max-width: 380px) {
    .stats-row { grid-template-columns: repeat(3, 1fr); }
    .tipo-grid { grid-template-columns: 1fr; }
  }
</style>
