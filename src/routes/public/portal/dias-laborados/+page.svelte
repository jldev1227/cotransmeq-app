<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { portalSession, isAuthenticated, portalFetch, conductorNombre } from '$lib/stores/portalStore';

  function uid(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  import Autocomplete from '$lib/components/Autocomplete.svelte';
  import TimePicker from '$lib/components/TimePicker.svelte';

  // ═══════════════════════════════
  // TIPOS
  // ═══════════════════════════════
  type TipoLabor = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

  interface Segmento {
    id?: string;
    cliente_id: string | null;
    cliente_nombre: string | null;
    vehiculo_id: string | null;
    vehiculo_placa: string;
    hora_inicio: string;
    hora_fin: string;
    inicio_dia_siguiente?: boolean;
    fin_dia_siguiente?: boolean;
    horas_conducidas: number;
    km_inicial?: number | null;
    km_final?: number | null;
    pernocte?: boolean;
    observaciones?: string | null;
  }

  interface RegistroDia {
    id?: string;
    fecha: string;
    tipo: TipoLabor;
    observaciones?: string | null;
    segmentos?: Segmento[];
  }

  interface ClienteBasico { id: string; nombre: string; }
  interface VehiculoBasico { id: string; placa: string; conductor_id?: string; }

  // ═══════════════════════════════
  // CONSTANTES
  // ═══════════════════════════════
  const TIPOS: { value: TipoLabor; label: string; color: string; icon: string }[] = [
    { value: 'LABORADO',      label: 'Día Laborado',  color: '#ea580c', icon: '🚛' },
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

  // Estado de tramos (segmentos) cuando el día es LABORADO
  let tramos: Segmento[] = [];
  let tramoExpandido: number | null = null;
  let soloLectura = false;

  // ═══════════════════════════════
  // MOUNT
  // ═══════════════════════════════
  onMount(async () => {
    if (!$isAuthenticated) {
      goto('/public/portal');
      return;
    }
    await cargarDatosIniciales();
    detectarBorradores();
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
      if (tramos.length === 0) { formError = 'Agrega al menos un tramo'; return; }
      for (let i = 0; i < tramos.length; i++) {
        const t = tramos[i];
        if (!t.vehiculo_placa) { formError = `Tramo ${i + 1}: indica la placa`; return; }
        if (!t.hora_inicio)    { formError = `Tramo ${i + 1}: hora de inicio`; return; }
        if (!t.hora_fin)       { formError = `Tramo ${i + 1}: hora de fin`; return; }
        if (!t.horas_conducidas || Number(t.horas_conducidas) <= 0) {
          formError = `Tramo ${i + 1}: horas conducidas`; return;
        }
        const inicioMins = t.hora_inicio.split(':').reduce((a, v) => a * 60 + Number(v), 0)
                          + (t.inicio_dia_siguiente ? 24 * 60 : 0);
        const finMins    = t.hora_fin.split(':').reduce((a, v) => a * 60 + Number(v), 0)
                          + (t.fin_dia_siguiente ? 24 * 60 : 0);
        if (finMins <= inicioMins) {
          formError = `Tramo ${i + 1}: la hora fin debe ser mayor a la inicio`; return;
        }
      }
    }

    guardando = true;
    guardadoExitoso = false; // se marcará true solo cuando el backend confirme
    // Cancelar cualquier autoGuardar pendiente para no reescribir el cache durante el envío
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      // Hacer una copia profunda del array tramos para evitar mutaciones durante el envío
      const tramosSnapshot = tramos.map(t => ({ ...t }));
      const payload: any = {
        fecha: fechaSeleccionada,
        tipo: form.tipo,
        observaciones: form.observaciones || null,
        // Solo LABORADO envía segmentos (la fuente de verdad es la tabla pivote)
        segmentos: form.tipo === 'LABORADO' ? tramosSnapshot.map(t => ({
          cliente_id: t.cliente_id,
          cliente_nombre: t.cliente_nombre,
          vehiculo_id: t.vehiculo_id,
          vehiculo_placa: t.vehiculo_placa,
          hora_inicio: t.hora_inicio,
          hora_fin: t.hora_fin,
          inicio_dia_siguiente: t.inicio_dia_siguiente === true,
          fin_dia_siguiente: t.fin_dia_siguiente === true,
          horas_conducidas: Number(t.horas_conducidas) || 0,
          km_inicial: t.km_inicial != null && String(t.km_inicial) !== '' ? Number(t.km_inicial) : null,
          km_final: t.km_final != null && String(t.km_final) !== '' ? Number(t.km_final) : null,
          pernocte: t.pernocte === true,
          observaciones: t.observaciones || null
        })) : []
      };

      const res = await portalFetch('/conductor-portal/dias-laborados/registros', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const saved = res.data;
      const f = saved.fecha.slice(0, 10);
      registros[f] = { ...saved, fecha: f };
      registros = { ...registros };

      // Borrador ya persistido en servidor → limpiar caché
      limpiarBorrador(f);
      detectarBorradores();

      // Marcar como exitoso: desactiva autoGuardar y bloquea reescritura del cache
      guardadoExitoso = true;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

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
      limpiarBorrador(fechaSeleccionada);
      detectarBorradores();
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

    // ¿Existe ya un registro guardado en el servidor para esta fecha?
    const regServidor = registros[fechaSeleccionada];
    const hayBorrador = !!cargarBorrador(fechaSeleccionada);
    // Solo lectura si hay registro en servidor Y no hay borrador pendiente de recuperar
    soloLectura = !!regServidor && !hayBorrador;

    // 1) Prioridad: borrador en localStorage (anti-pérdida móvil)
    const borrador = cargarBorrador(fechaSeleccionada);
    if (borrador) {
      form = {
        fecha: fechaSeleccionada,
        tipo: borrador.tipo,
        observaciones: borrador.observaciones
      };
      tramos = borrador.tramos.length > 0
        ? borrador.tramos.map(s => ({ ...s, id: s.id || uid() }))
        : [tramoVacio()];
      tramoExpandido = borrador.tramoExpandido ?? tramos.length - 1;
      guardadoOk = false; formError = ''; modalAbierto = true;
      return;
    }

    // 2) Si no hay borrador, cargar del servidor
    const reg = registros[fechaSeleccionada];
    form = reg ? { ...reg } : { fecha: fechaSeleccionada };

    if (reg && reg.segmentos && reg.segmentos.length > 0) {
      tramos = reg.segmentos.map(s => ({ ...s, id: s.id || uid() }));
    } else {
      tramos = [tramoVacio()];
    }
    tramoExpandido = tramos.length - 1;
    guardadoExitoso = false;

    guardadoOk = false; formError = ''; modalAbierto = true;
  }

  function cerrarModal() {
    modalAbierto = false;
    fechaSeleccionada = '';
    form = {};
    tramos = [];
    tramoExpandido = null;
    soloLectura = false;
    guardadoExitoso = false;
  }

  function tramoVacio(): Segmento {
    return {
      id: uid(),
      cliente_id: null,
      cliente_nombre: null,
      vehiculo_id: null,
      vehiculo_placa: '',
      hora_inicio: '',
      hora_fin: '',
      inicio_dia_siguiente: false,
      fin_dia_siguiente: false,
      horas_conducidas: 0,
      km_inicial: null,
      km_final: null,
      pernocte: false,
      observaciones: null
    };
  }

  function agregarTramo() {
    const nuevo: Segmento = tramoVacio();
    tramos = [...tramos, nuevo];
    tramoExpandido = tramos.length - 1;
  }

  function eliminarTramo(idx: number) {
    if (tramos.length === 1) {
      // Mantener al menos uno (vacío)
      tramos = [tramoVacio()];
    } else {
      tramos = tramos.filter((_, i) => i !== idx);
    }
    tramoExpandido = null;
  }

  function horasTramo(t: Segmento): number | null {
    if (!t.hora_inicio || !t.hora_fin) return null;
    const toMins = (h: string, next: boolean) =>
      h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0);
    const mins = toMins(t.hora_fin, !!t.fin_dia_siguiente) - toMins(t.hora_inicio, !!t.inicio_dia_siguiente);
    return mins > 0 ? +(mins / 60).toFixed(1) : null;
  }

  $: totalHorasTramos = tramos.reduce((s, t) => s + (Number(t.horas_conducidas) || 0), 0);

  // ═══════════════════════════════
  // PERSISTENCIA LOCAL (anti-pérdida por cierre/reload en móvil)
  // ═══════════════════════════════
  function cacheKey(fecha: string): string {
    const cid = $portalSession?.conductor?.id || 'anon';
    return `dias-laborados:bor:${cid}:${fecha}`;
  }

  interface BorradorCache {
    tipo: TipoLabor;
    observaciones: string;
    tramos: Segmento[];
    tramoExpandido: number | null;
    savedAt: number;
  }

  function guardarBorrador() {
    if (!browser || !fechaSeleccionada) return;
    try {
      const data: BorradorCache = {
        tipo: (form.tipo as TipoLabor) || 'LABORADO',
        observaciones: form.observaciones || '',
        tramos: JSON.parse(JSON.stringify(tramos)),
        tramoExpandido,
        savedAt: Date.now()
      };
      localStorage.setItem(cacheKey(fechaSeleccionada), JSON.stringify(data));
    } catch {}
  }

  function cargarBorrador(fecha: string): BorradorCache | null {
    if (!browser) return null;
    try {
      const raw = localStorage.getItem(cacheKey(fecha));
      if (!raw) return null;
      const data = JSON.parse(raw) as BorradorCache;
      // Descartar borradores con más de 7 días
      if (Date.now() - (data.savedAt || 0) > 7 * 24 * 3600 * 1000) {
        localStorage.removeItem(cacheKey(fecha));
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function limpiarBorrador(fecha: string) {
    if (!browser || !fecha) return;
    try { localStorage.removeItem(cacheKey(fecha)); } catch {}
  }

  // Auto-guardar en cada cambio del formulario o tramos (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let guardadoExitoso = false;
  function autoGuardar() {
    if (guardadoExitoso) return; // no persistir si ya se guardó en el servidor
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(guardarBorrador, 400);
  }
  // Disparar en cada cambio relevante
  $: if (browser && modalAbierto && !soloLectura && !guardadoExitoso) {
    void form; void tramos; void tramoExpandido; autoGuardar();
  }

  // Al cargar la página, mostrar indicador si hay borradores pendientes
  let borradoresPendientes: Set<string> = new Set();
  function detectarBorradores() {
    if (!browser) return;
    const set = new Set<string>();
    const cid = $portalSession?.conductor?.id || 'anon';
    const prefix = `dias-laborados:bor:${cid}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const fecha = k.replace(prefix, '');
        const data = cargarBorrador(fecha);
        if (data) set.add(fecha);
      }
    }
    borradoresPendientes = set;
  }

  // ═══════════════════════════════
  // FORMULARIO
  // ═══════════════════════════════
  // (horasCalculadas del form padre se reemplaza por horasTramo() por tramo)

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
      horasTotales: dm.reduce((s, r) => {
        if (r.tipo !== 'LABORADO') return s;
        const segs = r.segmentos || [];
        return s + segs.reduce((acc, sg) => acc + (Number(sg.horas_conducidas) || 0), 0);
      }, 0)
    };
  })();

  $: fechaLegible = (() => {
    if (!fechaSeleccionada) return '';
    const [y,m,d] = fechaSeleccionada.split('-').map(Number);
    return new Date(y, m-1, d).toLocaleDateString('es-CO',
      { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  })();

  $: tipoActual = form.tipo ? TIPOS.find(t => t.value === form.tipo) : null;

  // Opciones de autocomplete (precomputadas para evitar recalcular en cada keystroke)
  $: clienteOptions = clientes.map(c => ({ id: c.id, label: c.nombre }));
  $: vehiculoOptions = vehiculos.map(v => ({ id: v.id, label: v.placa, placa: v.placa }));
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
    <div class="stat-card" style="--accent:#ea580c">
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
          {@const reg = registros[fechaStr(dia)]}
          {@const tipo = reg ? TIPOS.find(t => t.value === reg.tipo) : null}
          {@const futuro = esFuturo(dia)}
          {@const hoyFlag = esHoy(dia)}
          {@const fStr = fechaStr(dia)}
          {@const tieneBorrador = borradoresPendientes.has(fStr)}
          <div
            class="dia-celda"
            class:registrado={!!tipo}
            class:futuro
            class:hoy-celda={hoyFlag}
            class:con-borrador={tieneBorrador}
            style={tipo ? `--tcolor:${tipo.color};` : ''}
            on:click={() => abrirDia(dia)}
            on:keydown={(e) => e.key==='Enter' && abrirDia(dia)}
            role="button" tabindex={futuro ? -1 : 0}
            aria-label="Día {dia}"
          >
            <span class="dia-num">{dia}</span>
            {#if tipo}<span class="dia-icon">{tipo.icon}</span>{/if}
            {#if tieneBorrador}<span class="dia-borrador-dot" title="Borrador sin guardar (recuperado del celular)">●</span>{/if}
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

    {#if soloLectura}
      <div class="modal-readonly-banner">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Este día ya fue registrado. Solo puedes consultarlo.</span>
      </div>
    {/if}

    <div class="modal-body">
      {#if soloLectura}
        <!-- ═══════════════════════════════════
             DETAILS VIEW (read-only summary)
             ═══════════════════════════════════ -->
        <div class="details-view">
          <!-- Tipo jornada (badge prominente) -->
          <div class="details-tipo-card" style="--tcolor: {tipoActual?.color || '#ea580c'}">
            <div class="details-tipo-icon-wrap">
              <span class="details-tipo-icon">{tipoActual?.icon}</span>
            </div>
            <div class="details-tipo-text">
              <div class="details-eyebrow">Tipo de jornada</div>
              <div class="details-tipo-name">{tipoActual?.label || '—'}</div>
            </div>
          </div>

          <!-- Tramos -->
          {#if form.tipo === 'LABORADO' && tramos.length > 0}
            <div class="details-section">
              <h3 class="details-section-title">
                <span>🚚 Tramos del día</span>
                <span class="details-section-count">
                  {tramos.length} {tramos.length === 1 ? 'tramo' : 'tramos'} · {totalHorasTramos}h
                </span>
              </h3>

              <div class="details-tramos-list">
                {#each tramos as t, i (t.id ?? `d-${i}`)}
                  <div class="details-tramo">
                    <div class="details-tramo-head">
                      <span class="details-tramo-num">{i + 1}</span>
                      <span class="details-tramo-title">Tramo {i + 1}</span>
                      {#if t.horas_conducidas > 0}
                        <span class="details-tramo-horas">{t.horas_conducidas}h</span>
                      {/if}
                    </div>

                    <dl class="details-grid">
                      <dt>Cliente</dt>
                      <dd>{t.cliente_nombre || '—'}</dd>

                      <dt>Vehículo</dt>
                      <dd>{t.vehiculo_placa || '—'}</dd>

                      <dt>Horario</dt>
                      <dd>
                        {#if t.hora_inicio && t.hora_fin}
                          {t.hora_inicio}{#if t.inicio_dia_siguiente}<span class="dia-sig-inline">+1</span>{/if} – {t.hora_fin}{#if t.fin_dia_siguiente}<span class="dia-sig-inline">+1</span>{/if}
                        {:else}
                          —
                        {/if}
                      </dd>

                      {#if t.km_inicial != null && t.km_final != null && Number(t.km_final) >= Number(t.km_inicial)}
                        <dt>Recorrido</dt>
                        <dd>{Number(t.km_final) - Number(t.km_inicial)} km
                          <span class="details-grid-hint">({t.km_inicial} → {t.km_final})</span>
                        </dd>
                      {/if}

                      {#if t.observaciones}
                        <dt>Observaciones</dt>
                        <dd>{t.observaciones}</dd>
                      {/if}
                    </dl>

                    {#if t.pernocte}
                      <div class="details-pernocte">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                        Pernoctó en este tramo
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Observaciones generales -->
          {#if form.observaciones && String(form.observaciones).trim() !== ''}
            <div class="details-section">
              <h3 class="details-section-title">
                <span>📝 Observaciones</span>
              </h3>
              <p class="details-obs-text">{form.observaciones}</p>
            </div>
          {/if}
        </div>
      {:else}
        <!-- ═══════════════════════════════════
             EDIT VIEW (form)
             ═══════════════════════════════════ -->
        <p class="section-label">Tipo de jornada</p>
        <div class="tipo-grid">
          {#each TIPOS as t}
            <button
              class="tipo-btn"
              class:selected={form.tipo === t.value}
              class:disabled={soloLectura}
              style={form.tipo === t.value ? `--tcolor:${t.color}` : ''}
              disabled={soloLectura}
              on:click={() => { if (!soloLectura) { form.tipo = t.value; formError = ''; } }}
            >
              <span class="tipo-icon">{t.icon}</span>
              <span class="tipo-label">{t.label}</span>
            </button>
          {/each}
        </div>

        {#if form.tipo === 'LABORADO'}
          <div class="form-section">
            <div class="form-section-title">
              🚚 Tramos del día
              <span class="tramos-meta">{tramos.length} {tramos.length === 1 ? 'tramo' : 'tramos'} · {totalHorasTramos}h</span>
            </div>

            {#if tramos.length === 0}
              <button class="btn-tramo-add" on:click={agregarTramo}>
                <span class="plus">+</span> Agregar primer tramo
              </button>
            {:else}
              <div class="tramos-list">
                {#each tramos as t, i (t.id ?? `t-${i}`)}
                  {@const expandido = tramoExpandido === i}
                  {@const hrs = horasTramo(t)}
                  <div class="tramo-card" class:expandido>
                    <button class="tramo-header" on:click={() => tramoExpandido = expandido ? null : i} type="button">
                      <span class="tramo-num">{i + 1}</span>
                      <div class="tramo-resumen">
                        {#if t.vehiculo_placa}
                          <span class="tramo-tag vehiculo">🚚 {t.vehiculo_placa}</span>
                        {:else}
                          <span class="tramo-tag muted">Sin vehículo</span>
                        {/if}
                        {#if t.cliente_nombre}
                          <span class="tramo-tag cliente">🏢 {t.cliente_nombre}</span>
                        {:else}
                          <span class="tramo-tag muted">Sin cliente</span>
                        {/if}
                        {#if t.hora_inicio && t.hora_fin}
                          <span class="tramo-tag hora">
                            🕐 {t.hora_inicio}{#if t.inicio_dia_siguiente}<sup class="dia-sig-sup">+1</sup>{/if}–{t.hora_fin}{#if t.fin_dia_siguiente}<sup class="dia-sig-sup">+1</sup>{/if}
                          </span>
                        {/if}
                        {#if t.horas_conducidas > 0}
                          <span class="tramo-tag horas">{t.horas_conducidas}h</span>
                        {/if}
                      </div>
                      <span class="tramo-toggle">{expandido ? '▾' : '▸'}</span>
                    </button>

                    {#if expandido}
                      <div class="tramo-body">
                        <div class="field-row">
                          <div class="field">
                            <label class="field-label">Hora inicio</label>
                            <TimePicker
                              bind:value={t.hora_inicio}
                              bind:dayOffset={t.inicio_dia_siguiente}
                              disabled={soloLectura}
                              placeholder="Inicio" />
                          </div>
                          <div class="field">
                            <label class="field-label">Hora fin</label>
                            <TimePicker
                              bind:value={t.hora_fin}
                              bind:dayOffset={t.fin_dia_siguiente}
                              disabled={soloLectura}
                              placeholder="Fin" />
                          </div>
                        </div>
                        {#if hrs !== null}
                          <p class="field-hint">⏱ Duración: <strong>{hrs} h</strong></p>
                        {/if}
                        <div class="field" style="margin-top:.65rem">
                          <label class="field-label">Horas conducidas</label>
                          <input type="number" min="0" max="24" step="0.5"
                            class="field-input" bind:value={t.horas_conducidas} placeholder="Ej: 4" disabled={soloLectura} />
                        </div>

                        <!-- KM inicial / final + Pernocte -->
                        <div class="field-row" style="margin-top:.65rem">
                          <div class="field">
                            <label class="field-label">KM inicial</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputmode="numeric"
                              class="field-input"
                              bind:value={t.km_inicial}
                              placeholder="Ej: 98402"
                              disabled={soloLectura}
                            />
                          </div>
                          <div class="field">
                            <label class="field-label">KM final</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputmode="numeric"
                              class="field-input"
                              bind:value={t.km_final}
                              placeholder="Ej: 98490"
                              disabled={soloLectura}
                            />
                          </div>
                        </div>
                        {#if t.km_inicial != null && t.km_final != null && Number(t.km_final) >= Number(t.km_inicial)}
                          {@const kmRecorrido = Number(t.km_final) - Number(t.km_inicial)}
                          <p class="field-hint" style="color:#1d4ed8">
                            📏 Recorrido: <strong>{kmRecorrido} km</strong>
                          </p>
                        {/if}

                        <label class="pernocte-toggle">
                          <input
                            type="checkbox"
                            bind:checked={t.pernocte}
                            disabled={soloLectura}
                          />
                          <span>🌙 Pernocté (requirió pasar la noche fuera)</span>
                        </label>

                        <!-- Cliente -->
                        <div class="field" style="margin-top:.65rem">
                          <label class="field-label">Cliente</label>
                          <Autocomplete
                            options={clienteOptions}
                            value={t.cliente_id || ''}
                            placeholder={t.cliente_nombre || '🔍 Buscar cliente...'}
                            disabled={soloLectura}
                            on:select={(e) => {
                              t.cliente_id = e.detail.id;
                              t.cliente_nombre = e.detail.label;
                            }}
                            on:clear={() => {
                              t.cliente_id = null;
                              t.cliente_nombre = null;
                            }}
                          />
                        </div>

                        <!-- Placa -->
                        <div class="field" style="margin-top:.65rem">
                          <label class="field-label">Placa vehículo</label>
                          <Autocomplete
                            options={vehiculoOptions}
                            value={t.vehiculo_id || ''}
                            placeholder={t.vehiculo_placa || '🔍 Buscar placa...'}
                            disabled={soloLectura}
                            on:select={(e) => {
                              t.vehiculo_id = e.detail.id;
                              t.vehiculo_placa = e.detail.placa || e.detail.label;
                            }}
                            on:clear={() => {
                              t.vehiculo_id = null;
                              t.vehiculo_placa = '';
                            }}
                          />
                        </div>

                        <!-- Eliminar tramo (oculto en solo lectura) -->
                        {#if !soloLectura}
                          <div class="tramo-acciones">
                            <button type="button" class="btn-tramo-del" on:click={() => eliminarTramo(i)}>
                              🗑 Eliminar tramo
                            </button>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if !soloLectura}
                <button class="btn-tramo-add" on:click={agregarTramo} type="button">
                  <span class="plus">+</span> Agregar otro tramo (cambio de cliente/vehículo)
                </button>
              {/if}
            {/if}
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
              disabled={soloLectura}
            ></textarea>
          </div>
        {/if}

        {#if formError}
          <div class="form-error">⚠ {formError}</div>
        {/if}
      {/if}
    </div>

    <div class="modal-actions">
      {#if soloLectura}
        <button
          class="btn-secondary-action"
          on:click={cerrarModal}
        >
          Cerrar
        </button>
      {:else}
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
      {/if}
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
    box-shadow: inset 0 0 0 2px #ea580c;
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
  .dia-borrador-dot {
    position: absolute;
    top: 4px;
    right: 5px;
    color: #f59e0b;
    font-size: 0.7rem;
    line-height: 1;
    text-shadow: 0 0 2px rgba(255,255,255,0.9);
  }
  .dia-celda.con-borrador {
    box-shadow: inset 0 0 0 1.5px #f59e0b;
  }

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

  /* ── Modal (landing-cotransmeq) ── */
  .modal-overlay {
    position: fixed; inset: 0;
    z-index: 200;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
    backdrop-filter: blur(8px) saturate(120%);
    -webkit-backdrop-filter: blur(8px) saturate(120%);
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
    border-radius: 24px 24px 0 0;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  }
  @media (min-width: 640px) {
    .modal { border-radius: 24px; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.1rem 1.5rem;
    border-bottom: 1px solid var(--border, #e2e8f0);
    background: linear-gradient(180deg, var(--surface, #fff) 0%, var(--bg, #fcfcfb) 100%);
  }
  .modal-fecha {
    font-family: 'Geist', 'Inter', system-ui, sans-serif;
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--text, #0f172a);
    text-transform: capitalize;
    letter-spacing: -0.01em;
  }
  .modal-readonly-banner {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.7rem 1.25rem;
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.06), rgba(249, 115, 22, 0.10));
    border-bottom: 1px solid rgba(249, 115, 22, 0.20);
    color: #c2410c;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .modal-readonly-banner svg { width: 1.05rem; height: 1.05rem; flex-shrink: 0; }
  .tipo-btn.disabled, .tipo-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .modal-fecha-sub {
    font-size: 0.72rem;
    color: var(--text3, #94a3b8);
    font-family: 'Geist', 'Inter', system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: 0.1em;
  }
  .btn-cerrar {
    width: 32px; height: 32px;
    border-radius: 10px;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    font-size: 1rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text2, #475569);
    transition: all 0.2s;
  }
  .btn-cerrar:hover {
    background: rgba(249, 115, 22, 0.06);
    border-color: rgba(249, 115, 22, 0.3);
    color: #ea580c;
    transform: rotate(90deg);
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
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    font-size: 0.9rem;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    outline: none;
    font-family: inherit;
  }
  .field-input:focus { border-color: #ea580c; box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.1); }
  .field-textarea { resize: vertical; min-height: 50px; }
  .field-hint { font-size: 0.78rem; color: #ea580c; margin: 0.3rem 0 0; }

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

  /* Pernocte toggle (móvil-friendly) */
  .pernocte-toggle {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.7rem;
    padding: 0.55rem 0.7rem;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    color: #c2410c;
    cursor: pointer;
    user-select: none;
  }
  .pernocte-toggle input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #c2410c;
    cursor: pointer;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border, #e2e8f0);
    background: var(--bg, #fcfcfb);
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
    background: linear-gradient(135deg, #ea580c, #047857);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    transition: all .15s;
  }
  .btn-guardar:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-guardar.ok { background: #ea580c; }

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
    border-top-color: #ea580c;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Tramos (segmentos) ── */
  .tramos-meta {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text3, #94a3b8);
    margin-left: 0.5rem;
    text-transform: none;
  }
  .tramos-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .tramo-card {
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 10px;
    background: var(--surface, #fff);
    overflow: hidden;
    transition: border-color .15s;
  }
  .tramo-card.expandido {
    border-color: #ea580c;
    box-shadow: 0 0 0 1px rgba(234, 88, 12, 0.1);
  }
  .tramo-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  .tramo-header:hover { background: var(--surface2, #f8fafc); }
  .tramo-num {
    width: 24px; height: 24px;
    border-radius: 50%;
    background: #ea580c;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .tramo-resumen {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    min-width: 0;
  }
  .tramo-tag {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    background: #f1f5f9;
    color: var(--text2, #475569);
    white-space: nowrap;
  }
  .tramo-tag.vehiculo { background: #dbeafe; color: #1e40af; }
  .tramo-tag.cliente  { background: #d1fae5; color: #047857; }
  .tramo-tag.hora     { background: #fef3c7; color: #92400e; }
  .tramo-tag.horas    { background: #ede9fe; color: #6d28d9; }
  .tramo-tag.muted    { background: #f1f5f9; color: var(--text3, #94a3b8); font-style: italic; }
  .dia-sig-sup {
    color: #f59e0b;
    font-weight: 800;
    font-size: 0.55rem;
    margin-left: 1px;
    vertical-align: super;
    line-height: 1;
  }
  .dia-sig-inline {
    display: inline-block;
    font-size: 0.58rem;
    font-weight: 800;
    color: #fff;
    background: #f59e0b;
    padding: 1px 4px;
    border-radius: 4px;
    margin: 0 2px;
    vertical-align: middle;
    line-height: 1.2;
    font-family: 'JetBrains Mono', monospace;
  }
  .tramo-toggle {
    color: var(--text3, #94a3b8);
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  .tramo-body {
    padding: 0.85rem 0.75rem;
    border-top: 1px dashed var(--border, #e2e8f0);
    background: var(--surface2, #f8fafc);
  }
  .tramo-acciones {
    margin-top: 0.65rem;
    display: flex;
    justify-content: flex-end;
  }
  .btn-tramo-del {
    font-size: 0.72rem;
    color: #dc2626;
    background: #fff;
    border: 1px solid #fca5a5;
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
  }
  .btn-tramo-del:hover { background: #fef2f2; }
  .btn-tramo-add {
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.65rem;
    border: 1.5px dashed #ea580c;
    background: rgba(234, 88, 12, 0.04);
    color: #047857;
    font-size: 0.82rem;
    font-weight: 700;
    border-radius: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    font-family: inherit;
    transition: all .15s;
  }
  .btn-tramo-add:hover {
    background: rgba(234, 88, 12, 0.1);
    border-style: solid;
  }
  .btn-tramo-add .plus {
    font-size: 1.1rem;
    font-weight: 800;
  }

  /* ── Responsive ── */
  @media (max-width: 380px) {
    .stats-row { grid-template-columns: repeat(3, 1fr); }
    .tipo-grid { grid-template-columns: 1fr; }
  }

  /* ═══════════════════════════════════════
     DETAILS VIEW (read-only summary)
     Design system: landing-transmeralda
     ═══════════════════════════════════════ */
  .details-view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .details-eyebrow {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #10B981;
    background: rgba(249, 115, 22, 0.08);
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    margin-bottom: 0.25rem;
  }

  /* Tipo de jornada (card prominente superior) */
  .details-tipo-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    background: #FFFFFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-left: 4px solid var(--tcolor);
    border-radius: 14px;
    padding: 1rem 1.1rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
  }
  .details-tipo-icon-wrap {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--tcolor) 12%, #FFFFFF);
    flex-shrink: 0;
  }
  .details-tipo-icon {
    font-size: 1.35rem;
    line-height: 1;
  }
  .details-tipo-text {
    flex: 1;
    min-width: 0;
  }
  .details-tipo-name {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 1.15rem;
    color: #0F1F1A;
    line-height: 1.2;
  }

  /* Secciones (Tramos, Observaciones) */
  .details-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .details-section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0;
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 0.95rem;
    color: #0F1F1A;
  }
  .details-section-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6B6B6B;
    background: rgba(0, 0, 0, 0.04);
    padding: 0.2rem 0.55rem;
    border-radius: 5px;
  }

  /* Lista de tramos (read-only) */
  .details-tramos-list {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .details-tramo {
    background: #FFFFFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 14px;
    padding: 0.85rem 1rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .details-tramo-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
  .details-tramo-num {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: linear-gradient(135deg, #10B981, #ea580c);
    color: #FFFFFF;
    font-size: 0.78rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }
  .details-tramo-title {
    flex: 1;
    font-weight: 700;
    font-size: 0.85rem;
    color: #0F1F1A;
  }
  .details-tramo-horas {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    font-weight: 700;
    color: #065F46;
    background: rgba(249, 115, 22, 0.10);
    padding: 0.18rem 0.55rem;
    border-radius: 5px;
  }

  /* Definition list (label/value) */
  .details-grid {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 0.4rem 0.85rem;
    margin: 0;
  }
  .details-grid dt {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6B6B6B;
    font-family: 'JetBrains Mono', monospace;
    padding-top: 0.15rem;
  }
  .details-grid dd {
    margin: 0;
    font-size: 0.88rem;
    color: #0F1F1A;
    font-weight: 500;
    line-height: 1.4;
    word-break: break-word;
  }
  .details-grid-hint {
    color: #6B6B6B;
    font-weight: 400;
    font-size: 0.78rem;
    font-family: 'JetBrains Mono', monospace;
    margin-left: 0.3rem;
  }

  /* Pernocte badge dentro del tramo */
  .details-pernocte {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    align-self: flex-start;
    padding: 0.35rem 0.7rem;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.20);
    color: #92400E;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .details-pernocte svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  /* Observaciones */
  .details-obs-text {
    background: #FAF7F2;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 12px;
    padding: 0.85rem 1rem;
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.55;
    color: #1A1A1A;
    white-space: pre-wrap;
  }

  /* Botón secundario de cerrar (en details view) */
  .btn-secondary-action {
    flex: 1;
    padding: 0.65rem 1.25rem;
    background: #FFFFFF;
    color: #1A1A1A;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-secondary-action:hover {
    background: #FAF7F2;
    border-color: rgba(0, 0, 0, 0.20);
  }
  .btn-secondary-action:active {
    transform: translateY(1px);
  }

  /* Mobile tweaks para details view */
  @media (max-width: 380px) {
    .details-grid {
      grid-template-columns: 90px 1fr;
      gap: 0.4rem 0.6rem;
    }
    .details-tipo-name { font-size: 1.05rem; }
  }
</style>
