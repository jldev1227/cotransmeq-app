<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fade, fly, scale } from 'svelte/transition';
  import { elasticOut } from 'svelte/easing';
  import { portalSession, isAuthenticated, portalFetch } from '$lib/stores/portalStore';

  interface Desprendible {
    id: string;
    periodo_inicio: string;
    periodo_fin: string;
    estado: string;
    sueldo_total: number;
    dias_laborados: number;
    salario_devengado: number;
    total_recargos: number;
    total_bonificaciones: number;
    total_pernotes: number;
    es_cotransmeq: boolean;
    fecha_liquidacion: string | null;
    created_at: string;
    firmado: boolean;
    fecha_firma: string | null;
    prima_asociada?: {
      id: string;
      mes: number;
      anio: number;
      prima: number;
      prima_pendiente?: number | null;
      estado: string;
    } | null;
  }

  interface PrimaPortal {
    id: string;
    mes: number;
    anio: number;
    prima: number;
    prima_pendiente?: number | null;
    estado: string;
    observaciones?: string | null;
    es_cotransmeq?: boolean;
    conductor_id?: string;
    created_at?: string;
  }

  let desprendibles: Desprendible[] = [];
  let loading = true;
  let error = '';
  let generandoPdf: string | null = null;
  let generandoPdfPrima: string | null = null;

  // ── Primas (sección independiente) ──
  let primas: PrimaPortal[] = [];
  let loadingPrimas = true;
  let filtroPrimaMes = '';
  let filtroPrimaAnio: number | '' = '';
  let availablePrimaYears: number[] = [];
  let activeTab: 'desprendibles' | 'primas' = 'desprendibles';

  // ── Highlight desde email ──
  let highlightId: string | null = null;
  let highlightPrimaId: string | null = null;

  // ── Filtros ──
  let selectedYear = new Date().getFullYear();
  let searchMes = '';

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // ── Firma Modal ──
  let showFirmaModal = false;
  let firmaTarget: Desprendible | null = null;
  let firmaCanvas: HTMLCanvasElement;
  let firmaCtx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let firmaBase64 = '';
  let firmaEnviando = false;

  let totalStrokeLength = 0;
  let strokePoints: {x: number; y: number}[] = [];
  let strokeCount = 0;
  const MIN_STROKE_LENGTH = 150;
  let firmaValida = false;

  $: {
    firmaValida = totalStrokeLength >= MIN_STROKE_LENGTH;
  }
  $: firmaFeedback = (() => {
    if (totalStrokeLength === 0) return '';
    if (totalStrokeLength < MIN_STROKE_LENGTH * 0.3) return 'Firma demasiado corta — sigue dibujando';
    if (totalStrokeLength < MIN_STROKE_LENGTH) return 'Casi listo — completa tu firma';
    return '';
  })();

  let showSuccess = false;
  let successMessage = '';

  $: availableYears = (() => {
    const years = new Set<number>();
    for (const d of desprendibles) {
      const fin = d.periodo_fin;
      if (fin) {
        try { years.add(new Date(fin + 'T00:00:00').getFullYear()); } catch {}
      }
    }
    if (years.size === 0) years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  })();

  $: filtered = desprendibles.filter(d => {
    const fin = d.periodo_fin;
    if (!fin) return false;
    try {
      const date = new Date(fin + 'T00:00:00');
      if (date.getFullYear() !== selectedYear) return false;
      if (searchMes.trim()) {
        const mesNombre = MESES[date.getMonth()].toLowerCase();
        const mesNum = String(date.getMonth() + 1);
        const query = searchMes.trim().toLowerCase();
        if (!mesNombre.includes(query) && !mesNum.startsWith(query)) return false;
      }
      return true;
    } catch { return false; }
  });

  // ── Helpers ──
  function fmt(value: any): string {
    const num = Number(value) || 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(num);
  }

  function getMes(fin: string): string {
    try {
      const d = new Date(fin + 'T00:00:00');
      return MESES[d.getMonth()];
    } catch { return '—'; }
  }

  function periodoRango(inicio: string, fin: string): string {
    const fmtDate = (s: string) => {
      try {
        const d = new Date(s + 'T00:00:00');
        return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
      } catch { return s; }
    };
    return `${fmtDate(inicio)} — ${fmtDate(fin)}`;
  }

  // ── API ──
  async function cargarDesprendibles() {
    loading = true;
    error = '';
    try {
      const res = await portalFetch('/conductor-portal/desprendibles');
      desprendibles = res.data || [];
    } catch (err: any) {
      if (err.status === 401) {
        portalSession.logout();
        goto('/public/portal');
        return;
      }
      error = err.message || 'Error al cargar desprendibles';
    } finally {
      loading = false;
    }
  }

  // ── Primas (entidad independiente de la liquidación) ─────────
  // 1) Intenta el endpoint dedicado /conductor-portal/primas
  // 2) Si no existe, arma la lista deduplicando desde `prima_asociada` de los
  //    desprendibles ya cargados.
  // 3) Filtra por visibilidad (sessionStorage 'primas_portal_visibility').
  async function cargarPrimas() {
    loadingPrimas = true;
    try {
      let list: PrimaPortal[] = [];
      try {
        const res: any = await portalFetch('/conductor-portal/primas');
        list = (res.data || []) as PrimaPortal[];
      } catch (err: any) {
        if (err?.status !== 404 && err?.status !== 501) throw err;
        // 2) Fallback: dedupe desde prima_asociada
        const seen = new Set<string>();
        list = [];
        for (const d of desprendibles) {
          const p = d.prima_asociada;
          if (p && !seen.has(p.id)) {
            seen.add(p.id);
            list.push({
              id: p.id,
              mes: p.mes,
              anio: p.anio,
              prima: Number(p.prima) || 0,
              prima_pendiente: p.prima_pendiente != null ? Number(p.prima_pendiente) : null,
              estado: p.estado
            });
          }
        }
      }

      // 3) Visibilidad (mock)
      try {
        const raw = sessionStorage.getItem('primas_portal_visibility') || '{}';
        const map: Record<string, boolean> = JSON.parse(raw);
        list = list.filter((p) => map[p.id] !== false);
      } catch {
        /* ignore */
      }

      list.sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));
      primas = list;

      const years = new Set<number>();
      list.forEach((p) => years.add(p.anio));
      availablePrimaYears = [...years].sort((a, b) => b - a);
      if (availablePrimaYears.length === 0) availablePrimaYears = [new Date().getFullYear()];
    } catch (err: any) {
      console.warn('Error cargando primas del portal:', err);
    } finally {
      loadingPrimas = false;
    }
  }

  $: filteredPrimas = primas.filter((p) => {
    if (filtroPrimaAnio && p.anio !== filtroPrimaAnio) return false;
    if (filtroPrimaMes.trim()) {
      const mesNombre = MESES[p.mes - 1]?.toLowerCase() || '';
      const mesNum = String(p.mes);
      const q = filtroPrimaMes.trim().toLowerCase();
      if (!mesNombre.includes(q) && !mesNum.startsWith(q)) return false;
    }
    return true;
  });

  async function verDesprendible(id: string) {
    generandoPdf = id;
    try {
      const res = await portalFetch(`/conductor-portal/desprendibles/${id}`);
      const { liquidacion, recargos } = res.data;
      // No cargar firmas desde S3 en el portal del conductor (evita CORS y requests innecesarias)
      const { generarPdfDesprendible } = await import('$lib/utils/pdfDesprendible');
      await generarPdfDesprendible(liquidacion, [], recargos);
    } catch (err: any) {
      if (err.status === 401) {
        portalSession.logout();
        goto('/public/portal');
        return;
      }
      alert(err.message || 'Error al generar PDF');
    } finally {
      generandoPdf = null;
    }
  }

  async function verPrima(primaId: string) {
    generandoPdfPrima = primaId;
    try {
      const res: any = await portalFetch(`/conductor-portal/prima/${primaId}`);
      const { prima } = res.data;

      // El portal del conductor NO muestra la firma en el PDF de prima
      const { generarPdfPrima } = await import('$lib/utils/pdfPrima');
      await generarPdfPrima(prima, []);
    } catch (err: any) {
      if (err.status === 401) {
        portalSession.logout();
        goto('/public/portal');
        return;
      }
      if (err.status === 404) {
        alert('La prima ya no está disponible.');
        await cargarDesprendibles();
        return;
      }
      alert(err.message || 'Error al generar el PDF de la prima');
    } finally {
      generandoPdfPrima = null;
    }
  }

  // ═══ FIRMA CANVAS LOGIC ═══

  async function abrirFirmaModal(d: Desprendible) {
    firmaTarget = d;
    showFirmaModal = true;
    firmaBase64 = '';
    totalStrokeLength = 0;
    strokePoints = [];
    strokeCount = 0;
    await tick();
    initCanvas();
  }

  function cerrarFirmaModal() {
    showFirmaModal = false;
    firmaTarget = null;
    firmaBase64 = '';
    totalStrokeLength = 0;
    strokeCount = 0;
  }

  function initCanvas() {
    if (!firmaCanvas) return;
    firmaCtx = firmaCanvas.getContext('2d');
    if (!firmaCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = firmaCanvas.getBoundingClientRect();
    firmaCanvas.width = rect.width * dpr;
    firmaCanvas.height = rect.height * dpr;
    firmaCtx.scale(dpr, dpr);
    firmaCtx.strokeStyle = '#EA580C';
    firmaCtx.lineWidth = 2.5;
    firmaCtx.lineCap = 'round';
    firmaCtx.lineJoin = 'round';
  }

  function getPos(e: MouseEvent | TouchEvent): {x: number; y: number} {
    const rect = firmaCanvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e: MouseEvent | TouchEvent) {
    if (firmaEnviando) return;
    isDrawing = true;
    strokeCount++;
    strokePoints = [];
    const pos = getPos(e);
    strokePoints.push(pos);
    if (firmaCtx) {
      firmaCtx.beginPath();
      firmaCtx.moveTo(pos.x, pos.y);
    }
  }

  function draw(e: MouseEvent | TouchEvent) {
    if (!isDrawing || firmaEnviando) return;
    e.preventDefault();
    const pos = getPos(e);
    const last = strokePoints[strokePoints.length - 1];
    if (last) {
      const dist = Math.sqrt((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2);
      totalStrokeLength += dist;
    }
    strokePoints.push(pos);
    if (firmaCtx) {
      firmaCtx.lineTo(pos.x, pos.y);
      firmaCtx.stroke();
    }
    if (totalStrokeLength >= MIN_STROKE_LENGTH && firmaCanvas) {
      firmaBase64 = firmaCanvas.toDataURL('image/png');
    }
  }

  function stopDraw() {
    if (!isDrawing) return;
    isDrawing = false;
    if (firmaCanvas && totalStrokeLength > 0) {
      firmaBase64 = firmaCanvas.toDataURL('image/png');
    }
  }

  function limpiarFirma() {
    if (firmaCtx && firmaCanvas) {
      const dpr = window.devicePixelRatio || 1;
      firmaCtx.clearRect(0, 0, firmaCanvas.width / dpr, firmaCanvas.height / dpr);
    }
    firmaBase64 = '';
    totalStrokeLength = 0;
    strokePoints = [];
    strokeCount = 0;
  }

  async function enviarFirma() {
    if (!firmaTarget || !firmaValida || !firmaBase64) return;
    firmaEnviando = true;
    try {
      const res = await portalFetch(`/conductor-portal/desprendibles/${firmaTarget.id}/firmar`, {
        method: 'POST',
        body: JSON.stringify({ firma_base64: firmaBase64 })
      });
      const idx = desprendibles.findIndex(d => d.id === firmaTarget!.id);
      if (idx !== -1) {
        desprendibles[idx] = {
          ...desprendibles[idx],
          firmado: true,
          fecha_firma: res.data?.fecha_firma || new Date().toISOString()
        };
        desprendibles = desprendibles;
      }
      const targetId = firmaTarget.id;
      cerrarFirmaModal();
      successMessage = '¡Desprendible firmado exitosamente!';
      showSuccess = true;
      setTimeout(async () => {
        showSuccess = false;
        await verDesprendible(targetId);
      }, 2500);
    } catch (err: any) {
      if (err.status === 401) {
        portalSession.logout();
        goto('/public/portal');
        return;
      }
      if (err.status === 409) {
        const idx = desprendibles.findIndex(d => d.id === firmaTarget!.id);
        if (idx !== -1) {
          desprendibles[idx] = { ...desprendibles[idx], firmado: true };
          desprendibles = desprendibles;
        }
        cerrarFirmaModal();
        alert('Este desprendible ya fue firmado.');
      } else {
        alert(err.message || 'Error al enviar la firma');
      }
    } finally {
      firmaEnviando = false;
    }
  }

  function handleAction(d: Desprendible) {
    if (d.firmado) {
      verDesprendible(d.id);
    } else {
      abrirFirmaModal(d);
    }
  }

  onMount(async () => {
    if (!$isAuthenticated) {
      goto('/public/portal');
      return;
    }
    highlightId = $page.url.searchParams.get('highlight');
    highlightPrimaId = $page.url.searchParams.get('highlight_prima');
    await cargarDesprendibles();
    await cargarPrimas();

    if (highlightPrimaId) {
      activeTab = 'primas';
    }

    if (highlightId) {
      const target = desprendibles.find(d => d.id === highlightId);
      if (target?.periodo_fin) {
        try {
          const targetYear = new Date(target.periodo_fin + 'T00:00:00').getFullYear();
          if (targetYear !== selectedYear) selectedYear = targetYear;
        } catch {}
      }
      searchMes = '';
      await tick();
      const el = document.getElementById(`desp-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { highlightId = null; }, 6000);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('highlight');
      window.history.replaceState({}, '', url.toString());
    }

    if (highlightPrimaId) {
      const target = primas.find(p => p.id === highlightPrimaId);
      if (target) {
        filtroPrimaAnio = target.anio;
        filtroPrimaMes = '';
      }
      await tick();
      const el = document.getElementById(`prima-${highlightPrimaId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { highlightPrimaId = null; }, 6000);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('highlight_prima');
      window.history.replaceState({}, '', url.toString());
    }
  });
</script>

<div class="desprendibles-page">
  <!-- ═══ Header ═══ -->
  <div class="page-header">
    <div>
      <h1 class="page-title">📄 Mis Desprendibles y Primas</h1>
      <p class="page-sub">Consulta, firma y descarga tus comprobantes de nómina y liquidaciones de prima</p>
    </div>
    <button class="btn-refresh" on:click={cargarDesprendibles} disabled={loading} title="Actualizar">
      <span class:spinning={loading}>↻</span>
    </button>
  </div>

  <!-- ═══ Tabs ═══ -->
  <div class="portal-tabs" role="tablist">
    <button
      type="button"
      role="tab"
      class="portal-tab"
      class:active={activeTab === 'desprendibles'}
      aria-selected={activeTab === 'desprendibles'}
      on:click={() => (activeTab = 'desprendibles')}
    >
      📄 Desprendibles
      <span class="portal-tab-count">{desprendibles.length}</span>
    </button>
    <button
      type="button"
      role="tab"
      class="portal-tab"
      class:active={activeTab === 'primas'}
      aria-selected={activeTab === 'primas'}
      on:click={() => (activeTab = 'primas')}
    >
      💰 Primas
      <span class="portal-tab-count">{primas.length}</span>
    </button>
  </div>

  <!-- ═══ TAB: DESPRENDIBLES (lógica original) ═══ -->
  {#if activeTab === 'desprendibles'}
  <!-- ═══ Filtros ═══ -->
  <div class="filters-bar">
    <div class="filter-group">
      <label class="filter-label" for="filter-year">Año</label>
      <select id="filter-year" class="filter-select" bind:value={selectedYear}>
        {#each availableYears as y}
          <option value={y}>{y}</option>
        {/each}
      </select>
    </div>
    <div class="filter-group grow">
      <label class="filter-label" for="filter-mes">Buscar mes</label>
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input
          id="filter-mes"
          type="text"
          class="filter-input"
          placeholder="Ej: Marzo, 3, Abr..."
          bind:value={searchMes}
        />
        {#if searchMes}
          <button class="search-clear" on:click={() => searchMes = ''}>✕</button>
        {/if}
      </div>
    </div>
  </div>

  <!-- ═══ Content ═══ -->
  {#if loading && desprendibles.length === 0}
    <div class="state-box">
      <span class="spinner"></span>
      <p>Cargando desprendibles...</p>
    </div>
  {:else if error}
    <div class="state-box">
      <span class="state-emoji">⚠️</span>
      <p>{error}</p>
      <button class="btn-retry" on:click={cargarDesprendibles}>Reintentar</button>
    </div>
  {:else if desprendibles.length === 0}
    <div class="state-box">
      <span class="state-emoji">📋</span>
      <p class="state-title">Sin desprendibles</p>
      <p>Aún no tienes liquidaciones registradas.</p>
    </div>
  {:else if filtered.length === 0}
    <div class="state-box">
      <span class="state-emoji">🔎</span>
      <p class="state-title">Sin resultados</p>
      <p>No se encontraron desprendibles para {selectedYear}{searchMes ? ` con "${searchMes}"` : ''}.</p>
    </div>
  {:else}
    <!-- ═══ TABLA (Desktop ≥640px) ═══ -->
    <div class="table-wrap">
      <table class="desp-table">
        <thead>
          <tr>
            <th>Mes</th>
            <th>Periodo</th>
            <th>Estado</th>
            <th class="text-right">Días</th>
            <th class="text-right">Recargos</th>
            <th class="text-right">Sueldo Total</th>
            <th class="text-center">Firma</th>
            <th class="text-center">Acción</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as d (d.id)}
            <tr id="desp-{d.id}" class:highlight-row={highlightId === d.id}>
              <td class="td-mes">
                <div class="mes-row">
                  <span class="mes-name">{getMes(d.periodo_fin)}</span>
                  {#if d.es_cotransmeq}
                    <span class="tag-cotrans">CTM</span>
                  {/if}
                </div>
              </td>
              <td class="td-periodo">{periodoRango(d.periodo_inicio, d.periodo_fin)}</td>
              <td>
                {#if d.estado === 'Liquidado'}
                  <span class="status-pill liquidado">Liquidado</span>
                {:else if d.estado === 'Pendiente'}
                  <span class="status-pill pendiente">Pendiente</span>
                {:else}
                  <span class="status-pill otro">{d.estado}</span>
                {/if}
              </td>
              <td class="text-right mono">{d.dias_laborados}</td>
              <td class="text-right mono">{fmt(d.total_recargos)}</td>
              <td class="text-right mono sueldo">{fmt(d.sueldo_total)}</td>
              <td class="text-center">
                {#if d.firmado}
                  <span class="firma-si" title={d.fecha_firma ? `Firmado el ${new Date(d.fecha_firma).toLocaleDateString('es-CO')}` : 'Firmado'}>✅</span>
                {:else}
                  <span class="firma-pendiente" title="Pendiente de firma">🖊️</span>
                {/if}
              </td>
              <td class="text-center">
                <div class="action-stack">
                  {#if d.firmado}
                    <button
                      class="btn-action btn-ver"
                      on:click={() => verDesprendible(d.id)}
                      disabled={generandoPdf === d.id}
                      title="Ver Desprendible PDF"
                    >
                      {#if generandoPdf === d.id}
                        <span class="spinner-mini"></span>
                      {:else}
                        📥 Ver
                      {/if}
                    </button>
                  {:else}
                    <button
                      class="btn-action btn-firmar"
                      on:click={() => abrirFirmaModal(d)}
                      title="Firmar Desprendible"
                    >
                      ✍️ Firmar
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- ═══ CARDS (Mobile <640px) ═══ -->
    <div class="mobile-cards">
      {#each filtered as d (d.id)}
        <div id="desp-{d.id}" class="m-card" class:highlight-card={highlightId === d.id}>
          <div class="m-card-header">
            <div class="m-card-mes">
              <span class="m-mes-name">{getMes(d.periodo_fin)}</span>
              <span class="m-periodo">{periodoRango(d.periodo_inicio, d.periodo_fin)}</span>
            </div>
            <div class="m-card-badges">
              {#if d.es_cotransmeq}
                <span class="tag-cotrans">CTM</span>
              {/if}
              {#if d.estado === 'Liquidado'}
                <span class="status-pill liquidado">{d.estado}</span>
              {:else if d.estado === 'Pendiente'}
                <span class="status-pill pendiente">{d.estado}</span>
              {:else}
                <span class="status-pill otro">{d.estado}</span>
              {/if}
            </div>
          </div>

          <div class="m-card-stats">
            <div class="m-stat">
              <span class="m-stat-label">Sueldo</span>
              <span class="m-stat-value main">{fmt(d.sueldo_total)}</span>
            </div>
            <div class="m-stat">
              <span class="m-stat-label">Días</span>
              <span class="m-stat-value">{d.dias_laborados}</span>
            </div>
            <div class="m-stat">
              <span class="m-stat-label">Recargos</span>
              <span class="m-stat-value">{fmt(d.total_recargos)}</span>
            </div>
            <div class="m-stat">
              <span class="m-stat-label">Firma</span>
              <span class="m-stat-value" style={d.firmado ? 'color:#EA580C' : 'color:#d97706'}>
                {d.firmado ? '✅' : '🖊️ Pendiente'}
              </span>
            </div>
          </div>

          {#if d.firmado}
            <button
              class="m-btn-pdf"
              on:click={() => verDesprendible(d.id)}
              disabled={generandoPdf === d.id}
            >
              {#if generandoPdf === d.id}
                <span class="spinner-mini-w"></span> Generando...
              {:else}
                📥 Ver Desprendible
              {/if}
            </button>
          {:else}
            <button
              class="m-btn-firmar"
              on:click={() => abrirFirmaModal(d)}
             >
              ✍️ Firmar Desprendible
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="results-count">
      {filtered.length} de {desprendibles.length} desprendible{desprendibles.length !== 1 ? 's' : ''}
    </div>
  {/if}

  <!-- ═══ TAB: PRIMAS (entidad separada) ═══ -->
  {:else if activeTab === 'primas'}
    <!-- Filtros de primas -->
    <div class="filters-bar">
      <div class="filter-group">
        <label class="filter-label" for="filter-prima-anio">Año</label>
        <select
          id="filter-prima-anio"
          class="filter-select"
          bind:value={filtroPrimaAnio}
        >
          <option value={''}>Todos</option>
          {#each availablePrimaYears as y}
            <option value={y}>{y}</option>
          {/each}
        </select>
      </div>
      <div class="filter-group grow">
        <label class="filter-label" for="filter-prima-mes">Buscar mes</label>
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input
            id="filter-prima-mes"
            type="text"
            class="filter-input"
            placeholder="Ej: Marzo, 3, Abr..."
            bind:value={filtroPrimaMes}
          />
          {#if filtroPrimaMes}
            <button class="search-clear" on:click={() => filtroPrimaMes = ''}>✕</button>
          {/if}
        </div>
      </div>
    </div>

    {#if loadingPrimas && primas.length === 0}
      <div class="state-box">
        <span class="spinner"></span>
        <p>Cargando primas...</p>
      </div>
    {:else if primas.length === 0}
      <div class="state-box">
        <span class="state-emoji">💰</span>
        <p class="state-title">Sin primas</p>
        <p>Aún no tienes liquidaciones de prima registradas.</p>
      </div>
    {:else if filteredPrimas.length === 0}
      <div class="state-box">
        <span class="state-emoji">🔎</span>
        <p class="state-title">Sin resultados</p>
        <p>No se encontraron primas para los filtros aplicados.</p>
      </div>
    {:else}
      <!-- ═══ TABLA (Desktop ≥640px) ═══ -->
      <div class="table-wrap">
        <table class="desp-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Año</th>
              <th>Estado</th>
              <th class="text-right">Prima</th>
              <th class="text-right">Pendiente</th>
              <th class="text-right">Total</th>
              <th class="text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredPrimas as p (p.id)}
              <tr
                id={`prima-${p.id}`}
                class:highlight-row={highlightPrimaId === p.id}
              >
                <td>
                  <div class="mes-row">
                    <span class="mes-name">{MESES[p.mes - 1] || '—'}</span>
                  </div>
                </td>
                <td class="td-periodo mono">{p.anio}</td>
                <td>
                  {#if p.estado === 'Pagado'}
                    <span class="status-pill liquidado">{p.estado}</span>
                  {:else}
                    <span class="status-pill pendiente">{p.estado}</span>
                  {/if}
                </td>
                <td class="text-right mono">{fmt(p.prima)}</td>
                <td class="text-right mono">
                  {#if p.prima_pendiente && Number(p.prima_pendiente) > 0}
                    +{fmt(p.prima_pendiente)}
                  {:else}
                    <span class="text-xs text-gray-400">—</span>
                  {/if}
                </td>
                <td class="text-right mono sueldo">
                  {fmt(p.prima + (p.prima_pendiente || 0))}
                </td>
                <td class="text-center">
                  <button
                    class="btn-action btn-prima"
                    on:click={() => verPrima(p.id)}
                    disabled={generandoPdfPrima === p.id}
                    title="Ver Desprendible de Prima"
                  >
                    {#if generandoPdfPrima === p.id}
                      <span class="spinner-mini"></span>
                    {:else}
                      💰 Ver Prima
                    {/if}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- ═══ CARDS (Mobile <640px) ═══ -->
      <div class="mobile-cards">
        {#each filteredPrimas as p (p.id)}
          <div
            id={`prima-${p.id}`}
            class="m-card m-card-prima"
            class:highlight-card={highlightPrimaId === p.id}
          >
            <div class="m-card-header">
              <div class="m-card-mes">
                <span class="m-mes-name">{MESES[p.mes - 1] || '—'} {p.anio}</span>
              </div>
              <div class="m-card-badges">
                {#if p.estado === 'Pagado'}
                  <span class="status-pill liquidado">{p.estado}</span>
                {:else}
                  <span class="status-pill pendiente">{p.estado}</span>
                {/if}
              </div>
            </div>

            <div class="m-card-stats">
              <div class="m-stat">
                <span class="m-stat-label">Prima</span>
                <span class="m-stat-value main">{fmt(p.prima)}</span>
              </div>
              {#if p.prima_pendiente && Number(p.prima_pendiente) > 0}
                <div class="m-stat m-stat-prima">
                  <span class="m-stat-label">Pendiente</span>
                  <span class="m-stat-value">+{fmt(p.prima_pendiente)}</span>
                </div>
              {/if}
              <div class="m-stat">
                <span class="m-stat-label">Total</span>
                <span class="m-stat-value sueldo">{fmt(p.prima + (p.prima_pendiente || 0))}</span>
              </div>
            </div>

            <button
              class="m-btn-prima"
              on:click={() => verPrima(p.id)}
              disabled={generandoPdfPrima === p.id}
            >
              {#if generandoPdfPrima === p.id}
                <span class="spinner-mini-w"></span> Generando prima...
              {:else}
                💰 Ver Desprendible de Prima
              {/if}
            </button>
          </div>
        {/each}
      </div>

      <div class="results-count">
        {filteredPrimas.length} de {primas.length} prima{primas.length !== 1 ? 's' : ''}
      </div>
    {/if}
  {/if}
</div>

<!-- ═══ MODAL DE FIRMA ═══ -->
{#if showFirmaModal && firmaTarget}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" transition:fade={{ duration: 200 }} on:click|self={cerrarFirmaModal}>
    <div class="modal-content" transition:fly={{ y: 40, duration: 300 }}>
      <div class="modal-header">
        <div>
          <h2 class="modal-title">✍️ Firmar Desprendible</h2>
          <p class="modal-sub">
            {getMes(firmaTarget.periodo_fin)} — {periodoRango(firmaTarget.periodo_inicio, firmaTarget.periodo_fin)}
          </p>
        </div>
        <button class="modal-close" on:click={cerrarFirmaModal} disabled={firmaEnviando}>✕</button>
      </div>

      <div class="firma-resumen">
        <div class="fr-item">
          <span class="fr-label">Sueldo Total</span>
          <span class="fr-value main">{fmt(firmaTarget.sueldo_total)}</span>
        </div>
        <div class="fr-item">
          <span class="fr-label">Días</span>
          <span class="fr-value">{firmaTarget.dias_laborados}</span>
        </div>
        <div class="fr-item">
          <span class="fr-label">Recargos</span>
          <span class="fr-value">{fmt(firmaTarget.total_recargos)}</span>
        </div>
      </div>

      <div class="firma-canvas-container">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="firma-canvas-label">
          Dibuja tu firma en el recuadro
          <span class="required">*</span>
        </label>

        <div class="canvas-wrap" class:canvas-valid={firmaValida} class:canvas-invalid={totalStrokeLength > 0 && !firmaValida}>
          <canvas
            bind:this={firmaCanvas}
            class="firma-canvas"
            on:mousedown={startDraw}
            on:mousemove={draw}
            on:mouseup={stopDraw}
            on:mouseleave={stopDraw}
            on:touchstart={startDraw}
            on:touchmove={draw}
            on:touchend={stopDraw}
          ></canvas>

          {#if totalStrokeLength === 0}
            <div class="canvas-placeholder" transition:fade={{ duration: 150 }}>
              <span style="font-size:2rem">✍️</span>
              <p>Firma aquí</p>
            </div>
          {/if}

          {#if totalStrokeLength > 0}
            <button
              class="canvas-clear"
              on:click={limpiarFirma}
              disabled={firmaEnviando}
              transition:fade={{ duration: 150 }}
            >
              🗑 Limpiar
            </button>
          {/if}
        </div>

        {#if firmaFeedback}
          <p class="firma-feedback invalid" transition:fade={{ duration: 200 }}>
            ⚠️ {firmaFeedback}
          </p>
        {:else if firmaValida}
          <p class="firma-feedback valid" transition:fade={{ duration: 200 }}>
            ✅ Firma válida — puedes enviar
          </p>
        {/if}

        {#if totalStrokeLength > 0 && !firmaValida}
          <div class="firma-progress-bar">
            <div
              class="firma-progress-fill"
              style="width: {Math.min(100, (totalStrokeLength / MIN_STROKE_LENGTH) * 100)}%"
            ></div>
          </div>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn-modal-cancel" on:click={cerrarFirmaModal} disabled={firmaEnviando}>
          Cancelar
        </button>
        <button
          class="btn-modal-submit"
          on:click={enviarFirma}
          disabled={!firmaValida || firmaEnviando}
        >
          {#if firmaEnviando}
            <span class="spinner-mini-w"></span> Enviando...
          {:else}
            ✍️ Firmar y Ver PDF
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══ SUCCESS ANIMATION ═══ -->
{#if showSuccess}
  <div class="success-overlay" transition:fade={{ duration: 300 }}>
    <div class="success-content" transition:scale={{ duration: 600, easing: elasticOut, start: 0.5 }}>
      <div class="success-icon-wrap" transition:scale={{ duration: 800, delay: 200, easing: elasticOut }}>
        <svg class="success-icon" fill="none" viewBox="0 0 24 24">
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            class="checkmark-animation"
          />
        </svg>
      </div>
      <h2 class="success-title" transition:fade={{ delay: 400, duration: 400 }}>{successMessage}</h2>
      <p class="success-sub" transition:fade={{ delay: 600, duration: 400 }}>Generando tu desprendible PDF...</p>

      <div class="confetti-container">
        {#each Array(20) as _, i}
          <div
            class="confetti"
            style="--delay: {i * 0.1}s; --x: {Math.random() * 200 - 100}px; --rotation: {Math.random() * 360}deg;"
          ></div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ═══ Highlight Animation (from email link) ═══ */
  @keyframes highlightPulse {
    0% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.6); }
    40% { box-shadow: 0 0 0 8px rgba(234, 88, 12, 0.2); }
    100% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0); }
  }
  @keyframes highlightBg {
    0% { background-color: rgba(234, 88, 12, 0.15); }
    50% { background-color: rgba(234, 88, 12, 0.05); }
    100% { background-color: rgba(234, 88, 12, 0.15); }
  }

  :global(tr.highlight-row) {
    animation: highlightPulse 1.5s ease-in-out infinite, highlightBg 2s ease-in-out infinite;
    border-left: 3px solid #EA580C !important;
    position: relative;
  }
  .highlight-card {
    animation: highlightPulse 1.5s ease-in-out infinite, highlightBg 2s ease-in-out infinite;
    border-left: 4px solid #EA580C !important;
  }

  .desprendibles-page {
    max-width: 900px;
    margin: 0 auto;
  }

  /* ═══ Header ═══ */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .page-title {
    font-size: 1.3rem;
    font-weight: 800;
    margin: 0;
    color: var(--text, #0f172a);
  }
  .page-sub {
    font-size: 0.8rem;
    color: var(--text3, #94a3b8);
    margin: 0.15rem 0 0;
  }
  .btn-refresh {
    width: 36px; height: 36px;
    border-radius: 10px;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    font-size: 1.15rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text2, #475569);
    transition: all .15s;
    flex-shrink: 0;
  }
  .btn-refresh:hover { background: var(--surface2, #f8fafc); }
  .btn-refresh:disabled { opacity: 0.5; }
  .spinning { display: inline-block; animation: spin 1s linear infinite; }

  /* ═══ Filters ═══ */
  .filters-bar {
    display: flex;
    gap: 0.65rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .filter-group.grow { flex: 1; min-width: 160px; }
  .filter-label {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text3, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .filter-select {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 9px;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    font-size: 0.88rem;
    font-weight: 600;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    min-width: 90px;
  }
  .filter-select:focus { border-color: #EA580C; box-shadow: 0 0 0 2px rgba(234,88,12,0.12); }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 0.6rem;
    font-size: 0.85rem;
    pointer-events: none;
  }
  .filter-input {
    width: 100%;
    padding: 0.5rem 0.7rem 0.5rem 2rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 9px;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    font-size: 0.88rem;
    font-family: inherit;
    outline: none;
  }
  .filter-input:focus { border-color: #EA580C; box-shadow: 0 0 0 2px rgba(234,88,12,0.12); }
  .filter-input::placeholder { color: var(--text3, #94a3b8); }
  .search-clear {
    position: absolute;
    right: 0.45rem;
    width: 22px; height: 22px;
    border-radius: 50%;
    border: none;
    background: var(--border, #e2e8f0);
    color: var(--text2, #475569);
    font-size: 0.7rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    line-height: 1;
  }

  /* ═══ States ═══ */
  .state-box {
    text-align: center;
    padding: 2.5rem 1rem;
    color: var(--text2, #475569);
  }
  .state-box p { margin: 0.4rem 0 0; font-size: 0.9rem; }
  .state-emoji { font-size: 2.5rem; display: block; }
  .state-title { font-weight: 700; font-size: 1.05rem; color: var(--text, #0f172a); }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border, #e2e8f0);
    border-top-color: #EA580C;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
  .btn-retry {
    margin-top: 0.6rem;
    padding: 0.4rem 1rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    background: var(--surface, #fff);
    color: var(--text2, #475569);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
  }

  /* ═══ TABLE (Desktop) ═══ */
  .table-wrap {
    display: none;
    overflow-x: auto;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 12px;
    background: var(--surface, #fff);
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  .desp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .desp-table thead {
    background: var(--surface2, #f8fafc);
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
  .desp-table th {
    padding: 0.6rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text3, #94a3b8);
    white-space: nowrap;
    text-align: left;
  }
  .desp-table td {
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--border, #e2e8f0);
    color: var(--text, #0f172a);
    vertical-align: middle;
  }
  .desp-table tbody tr { transition: background .12s; }
  .desp-table tbody tr:hover { background: var(--surface2, #f8fafc); }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; }
  .td-mes {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .mes-name { font-weight: 700; }
  .td-periodo {
    font-size: 0.78rem;
    color: var(--text3, #94a3b8);
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap;
  }
  .status-pill {
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    font-size: 0.68rem;
    font-weight: 700;
    white-space: nowrap;
    display: inline-block;
  }
  .status-pill.liquidado { background: #dbeafe; color: #1e3a8a; }
  .status-pill.pendiente { background: #fef9c3; color: #854d0e; }
  .status-pill.otro { background: #f1f5f9; color: #475569; }
  .sueldo { font-weight: 700; color: #EA580C; }
  .firma-si { font-size: 1rem; cursor: help; }
  .firma-pendiente { font-size: 0.95rem; opacity: 0.7; }

  .btn-action {
    padding: 0.3rem 0.65rem;
    border-radius: 7px;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.25rem;
    transition: all .15s;
    white-space: nowrap;
    border: none;
  }
  .btn-ver {
    background: #FFF7ED;
    color: #EA580C;
    border: 1px solid #FDBA74;
  }
  .btn-ver:hover:not(:disabled) { background: #FFEDD5; }
  .btn-ver:disabled { opacity: 0.5; cursor: wait; }
  .btn-firmar {
    background: linear-gradient(135deg, #EA580C, #C2410C);
    color: #fff;
    box-shadow: 0 1px 4px rgba(234,88,12,0.2);
  }
  .btn-firmar:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(234,88,12,0.3); }
  .btn-firmar:active { transform: scale(0.96); }

  .spinner-mini {
    width: 14px; height: 14px;
    border: 2px solid var(--border, #e2e8f0);
    border-top-color: #EA580C;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* ═══ MOBILE CARDS ═══ */
  .mobile-cards {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .m-card {
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    border-left: 4px solid #EA580C;
  }
  .m-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 0.7rem 0.85rem 0;
    gap: 0.4rem;
  }
  .m-card-mes { display: flex; flex-direction: column; }
  .m-mes-name { font-weight: 700; font-size: 1rem; color: var(--text, #0f172a); }
  .m-periodo {
    font-size: 0.72rem;
    color: var(--text3, #94a3b8);
    font-family: 'JetBrains Mono', monospace;
    margin-top: 0.05rem;
  }
  .m-card-badges {
    display: flex; gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;
  }
  .m-card-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem 0.5rem;
    padding: 0.5rem 0.85rem;
  }
  .m-stat { display: flex; flex-direction: column; }
  .m-stat-label {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text3, #94a3b8);
    letter-spacing: 0.03em;
  }
  .m-stat-value {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text, #0f172a);
    font-family: 'JetBrains Mono', monospace;
  }
  .m-stat-value.main { font-size: 1.05rem; color: #EA580C; }
  .m-btn-pdf {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: calc(100% - 1.7rem);
    margin: 0 0.85rem 0.7rem;
    padding: 0.55rem;
    border: none;
    border-radius: 9px;
    background: linear-gradient(135deg, #EA580C, #C2410C);
    color: #fff;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(234,88,12,0.18);
    transition: transform .1s;
  }
  .m-btn-pdf:active:not(:disabled) { transform: scale(0.97); }
  .m-btn-pdf:disabled { opacity: 0.6; cursor: wait; }

  .m-btn-firmar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: calc(100% - 1.7rem);
    margin: 0 0.85rem 0.7rem;
    padding: 0.55rem;
    border: 2px solid #EA580C;
    border-radius: 9px;
    background: #FFF7ED;
    color: #EA580C;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all .15s;
  }
  .m-btn-firmar:active { transform: scale(0.97); background: #FFEDD5; }

  .spinner-mini-w {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  .results-count {
    text-align: center;
    font-size: 0.75rem;
    color: var(--text3, #94a3b8);
    margin-top: 0.85rem;
    padding-bottom: 0.5rem;
  }

  /* ═══ MODAL DE FIRMA ═══ */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-content {
    background: var(--surface, #fff);
    border-radius: 16px;
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  }
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.25rem 1.25rem 0;
    gap: 0.5rem;
  }
  .modal-title {
    font-size: 1.15rem;
    font-weight: 800;
    margin: 0;
    color: var(--text, #0f172a);
  }
  .modal-sub {
    font-size: 0.78rem;
    color: var(--text3, #94a3b8);
    margin: 0.1rem 0 0;
    font-family: 'JetBrains Mono', monospace;
  }
  .modal-close {
    width: 32px; height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--surface, #fff);
    font-size: 1rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text3, #94a3b8);
    transition: all .15s;
    flex-shrink: 0;
  }
  .modal-close:hover { background: var(--surface2, #f8fafc); color: var(--text, #0f172a); }

  .firma-resumen {
    display: flex;
    gap: 0.75rem;
    padding: 0.85rem 1.25rem;
    margin: 0.75rem 1.25rem 0;
    background: var(--surface2, #f8fafc);
    border-radius: 10px;
    border: 1px solid var(--border, #e2e8f0);
  }
  .fr-item { display: flex; flex-direction: column; flex: 1; }
  .fr-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text3, #94a3b8);
    letter-spacing: 0.03em;
  }
  .fr-value {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text, #0f172a);
    font-family: 'JetBrains Mono', monospace;
  }
  .fr-value.main { color: #EA580C; font-size: 0.95rem; }

  .firma-canvas-container { padding: 0.85rem 1.25rem; }
  .firma-canvas-label {
    display: block;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text, #0f172a);
    margin-bottom: 0.4rem;
  }
  .required { color: #ef4444; }

  .canvas-wrap {
    position: relative;
    border: 2px solid var(--border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    transition: border-color .2s, box-shadow .2s;
    background: #fff;
  }
  .canvas-wrap.canvas-valid {
    border-color: #EA580C;
    box-shadow: 0 0 0 3px rgba(234,88,12,0.12);
  }
  .canvas-wrap.canvas-invalid {
    border-color: #f59e0b;
    box-shadow: 0 0 0 3px rgba(245,158,11,0.12);
  }
  .firma-canvas {
    width: 100%;
    height: 180px;
    cursor: crosshair;
    touch-action: none;
    display: block;
  }
  .canvas-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    color: var(--text3, #94a3b8);
  }
  .canvas-placeholder p {
    font-size: 0.85rem;
    margin: 0.3rem 0 0;
  }
  .canvas-clear {
    position: absolute;
    top: 0.5rem; right: 0.5rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: none;
    background: rgba(255,255,255,0.9);
    color: var(--text2, #475569);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    transition: all .15s;
  }
  .canvas-clear:hover { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.12); }

  .firma-feedback {
    font-size: 0.78rem;
    font-weight: 600;
    margin: 0.4rem 0 0;
  }
  .firma-feedback.invalid { color: #d97706; }
  .firma-feedback.valid { color: #EA580C; }

  .firma-progress-bar {
    height: 4px;
    background: var(--border, #e2e8f0);
    border-radius: 4px;
    margin-top: 0.4rem;
    overflow: hidden;
  }
  .firma-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b, #EA580C);
    border-radius: 4px;
    transition: width .2s;
  }

  .modal-actions {
    display: flex;
    gap: 0.65rem;
    padding: 0 1.25rem 1.25rem;
    margin-top: 0.25rem;
  }
  .btn-modal-cancel {
    flex: 1;
    padding: 0.65rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 10px;
    background: var(--surface, #fff);
    color: var(--text2, #475569);
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    transition: all .15s;
  }
  .btn-modal-cancel:hover { background: var(--surface2, #f8fafc); }
  .btn-modal-cancel:disabled { opacity: 0.5; }
  .btn-modal-submit {
    flex: 2;
    padding: 0.65rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #EA580C, #C2410C);
    color: #fff;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 0.35rem;
    box-shadow: 0 2px 8px rgba(234,88,12,0.2);
    transition: all .15s;
  }
  .btn-modal-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(234,88,12,0.3); }
  .btn-modal-submit:active:not(:disabled) { transform: scale(0.98); }
  .btn-modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ═══ SUCCESS ANIMATION ═══ */
  .success-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(234,88,12,0.95), rgba(194,65,12,0.95));
    padding: 1rem;
  }
  .success-content {
    text-align: center;
    position: relative;
  }
  .success-icon-wrap {
    width: 120px; height: 120px;
    border-radius: 50%;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 1.5rem;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
  }
  .success-icon {
    width: 72px; height: 72px;
    color: #EA580C;
  }
  .success-title {
    font-size: 1.8rem;
    font-weight: 800;
    color: #fff;
    margin: 0;
  }
  .success-sub {
    font-size: 1rem;
    color: rgba(255,255,255,0.85);
    margin: 0.75rem 0 0;
  }

  @keyframes checkmark {
    0% { stroke-dasharray: 0 100; }
    100% { stroke-dasharray: 100 100; }
  }
  .checkmark-animation {
    stroke-dasharray: 0 100;
    animation: checkmark 0.6s ease-out 0.5s forwards;
  }

  @keyframes confetti-fall {
    0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
    100% { transform: translateY(100vh) translateX(var(--x)) rotate(var(--rotation)); opacity: 0; }
  }
  .confetti-container {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 100%; height: 100%;
    pointer-events: none;
    overflow: hidden;
  }
  .confetti {
    position: absolute;
    width: 10px; height: 10px;
    background: white;
    top: -20px; left: 50%;
    opacity: 0;
    animation: confetti-fall 2s ease-out var(--delay) forwards;
    border-radius: 2px;
  }
  .confetti:nth-child(2n) { background: rgba(255,255,255,0.8); width: 8px; height: 8px; }
  .confetti:nth-child(3n) { background: rgba(255,255,255,0.6); width: 12px; height: 4px; }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ═══ TABS (Desprendibles | Primas) ═══ */
  .portal-tabs {
    display: flex;
    gap: 0.4rem;
    background: #FFF7ED;
    border: 1px solid #FED7AA;
    border-radius: 12px;
    padding: 0.3rem;
    margin-bottom: 1rem;
  }
  .portal-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.55rem 0.8rem;
    border: none;
    background: transparent;
    color: #9A3412;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    border-radius: 9px;
    cursor: pointer;
    transition: all .15s;
  }
  .portal-tab:hover:not(.active) {
    background: rgba(249, 115, 22, 0.08);
    color: #7C2D12;
  }
  .portal-tab.active {
    background: linear-gradient(135deg, #F97316, #EA580C);
    color: #fff;
    box-shadow: 0 1px 4px rgba(249, 115, 22, 0.25);
  }
  .portal-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    font-size: 0.7rem;
    font-weight: 700;
  }
  .portal-tab:not(.active) .portal-tab-count {
    background: #FED7AA;
    color: #9A3412;
  }

  /* Mobile: prima card con acento naranja */
  .m-card.m-card-prima {
    border-left-color: #F97316;
  }
  .m-stat-value.sueldo {
    color: #F97316;
  }

  /* ═══ RESPONSIVE ═══ */
  @media (min-width: 640px) {
    .table-wrap { display: block; }
    .mobile-cards { display: none; }
  }
  @media (max-width: 639px) {
    .table-wrap { display: none; }
    .mobile-cards { display: flex; }
    .page-title { font-size: 1.15rem; }
    .modal-content { max-width: 100%; }
    .success-title { font-size: 1.4rem; }
    .success-icon-wrap { width: 100px; height: 100px; }
    .success-icon { width: 60px; height: 60px; }
  }
  @media (max-width: 380px) {
    .m-card-stats { grid-template-columns: 1fr; }
    .firma-resumen { flex-direction: column; gap: 0.4rem; }
  }

  /* ═══ PRIMA ASOCIADA ═══ */
  .mes-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .tag-prima {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.18rem 0.5rem;
    margin-top: 0.3rem;
    border-radius: 5px;
    font-size: 0.65rem;
    font-weight: 800;
    background: linear-gradient(135deg, #fef3c7, #fde68a);
    color: #92400e;
    border: 1px solid #fcd34d;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .action-stack {
    display: flex;
    flex-direction: row;
    gap: 0.3rem;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
  }
  .btn-prima {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #fff;
    border: 1px solid #f59e0b;
    box-shadow: 0 1px 3px rgba(245, 158, 11, 0.25);
  }
  .btn-prima:hover:not(:disabled) { background: linear-gradient(135deg, #f59e0b, #d97706); }
  .btn-prima:disabled { opacity: 0.5; cursor: wait; }
  .m-btn-prima {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: calc(100% - 1.7rem);
    margin: 0 0.85rem 0.4rem;
    padding: 0.5rem;
    border: none;
    border-radius: 9px;
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #fff;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(245, 158, 11, 0.2);
    transition: transform .1s;
  }
  .m-btn-prima:active:not(:disabled) { transform: scale(0.97); }
  .m-btn-prima:disabled { opacity: 0.6; cursor: wait; }
</style>
