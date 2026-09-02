<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
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
    firmado?: boolean;
    fecha_firma?: string | null;
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
  let firmaTarget: { id: string; tipo: 'desprendible' | 'prima'; ref: Desprendible | PrimaPortal } | null = null;
  let firmaCanvas: HTMLCanvasElement;
  let firmaCtx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let firmaBase64 = '';
  let firmaEnviando = false;

  // Signature quality validation
  let totalStrokeLength = 0;
  let strokePoints: {x: number; y: number}[] = [];
  let strokeCount = 0;
  const MIN_STROKE_LENGTH = 150; // min total px drawn
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

  // Success animation
  let showSuccess = false;
  let successMessage = '';

  // ── Años disponibles ──
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

  // ── Filtrado reactivo ──
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
      // 1) Endpoint dedicado
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
        list = list.filter((p) => map[p.id] !== false); // default: visible
      } catch {
        /* ignore */
      }

      // Ordenar por año/mes desc
      list.sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));
      primas = list;

      // Años disponibles
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
      const { liquidacion, dataParaPdf, firma } = res.data;

      // El backend ya devuelve `dataParaPdf` con las planillas
      // clasificadas (`_categoria`: 'pagar' | 'bono_aparte' | 'no_pagar'),
      // exactamente la misma estructura que arma el modal del dashboard
      // en su frontend. GEOLAB, RED SALUD e INGENIERIA ESPECIALIZADA
      // quedan como 'bono_aparte' (sin valor monetario en el total).
      //
      // Si por alguna razón el backend no lo construyó (ej. error al
      // obtener el preview), caemos a un `dataParaPdf` vacío para no
      // romper la generación de la página 1 del desprendible.
      const dataParaPdfSafe: { planillas: any[] } =
        dataParaPdf && Array.isArray(dataParaPdf.planillas)
          ? dataParaPdf
          : { planillas: [] };

      // Convertir la firma del portal al formato `FirmaConUrl[]` que
      // espera `pdfDesprendible.ts` (necesita `presignedUrl` y
      // `fecha_firma`).
      const firmas: any[] =
        firma && firma.presignedUrl
          ? [
              {
                id: '',
                liquidacion_id: liquidacion.id,
                conductor_id: liquidacion.conductor_id,
                firma_url: '',
                firma_s3_key: '',
                fecha_firma: firma.fecha_firma || new Date().toISOString(),
                estado: 'firmado',
                presignedUrl: firma.presignedUrl
              }
            ]
          : [];

      const { generarPdfDesprendible } = await import('$lib/utils/pdfDesprendible');
      await generarPdfDesprendible(liquidacion, firmas, dataParaPdfSafe);
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
      const res = await portalFetch(`/conductor-portal/primas/${primaId}/enriquecida`);
      const { prima, firma } = res.data;

      // Regla: el portal del conductor SOLO permite ver el PDF si la prima
      // tiene firma propia. La firma de nomina es solo fallback para el PDF
      // generado desde el dashboard — desde el portal conductor exigimos
      // firma explícita de la prima.
      if (!firma || firma.origen !== 'prima') {
        // Buscar la prima en la lista local para abrir el modal de firma
        const primaLocal = primas.find((p) => p.id === primaId);
        if (primaLocal) {
          abrirFirmaModalPrima(primaLocal);
        } else {
          // Fallback: crear objeto mínimo
          abrirFirmaModalPrima({
            id: primaId,
            mes: prima.mes,
            anio: prima.anio,
            prima: Number(prima.prima) || 0,
            prima_pendiente: prima.prima_pendiente != null ? Number(prima.prima_pendiente) : null,
            estado: prima.estado
          });
        }
        return;
      }

      const firmas = firma.presignedUrl
        ? [{ presignedUrl: firma.presignedUrl, fecha_firma: firma.fecha_firma }]
        : [];
      const { generarPdfPrima } = await import('$lib/utils/pdfPrima');
      await generarPdfPrima(prima, firmas as any);
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

  function handleActionPrima(p: PrimaPortal) {
    if (p.firmado) {
      verPrima(p.id);
    } else {
      abrirFirmaModalPrima(p);
    }
  }
  // (verPrima revalida contra el backend: si la firma de la lista está stale
  // y la prima NO tiene firma propia, forzará el modal de firma)

  // Cambia de pestaña y sincroniza el query param ?tab= para que el link
  // del portal refleje la vista activa (compartible, deep-linkable).
  function cambiarTab(tab: 'desprendibles' | 'primas') {
    activeTab = tab;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }

  async function abrirFirmaModalPrima(p: PrimaPortal) {
    firmaTarget = { id: p.id, tipo: 'prima', ref: p };
    showFirmaModal = true;
    firmaBase64 = '';
    totalStrokeLength = 0;
    strokePoints = [];
    strokeCount = 0;

    await tick();
    initCanvas();
  }

  // ═══════════════════════════════════════
  // FIRMA CANVAS LOGIC
  // ═══════════════════════════════════════

  async function abrirFirmaModal(d: Desprendible) {
    firmaTarget = { id: d.id, tipo: 'desprendible', ref: d };
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
    firmaCtx.strokeStyle = '#ea580c';
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
    // Calculate distance from last point
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
    // Update base64 in real-time once threshold is reached
    if (totalStrokeLength >= MIN_STROKE_LENGTH && firmaCanvas) {
      firmaBase64 = firmaCanvas.toDataURL('image/png');
    }
  }

  function stopDraw() {
    if (!isDrawing) return;
    isDrawing = false;
    // Save base64
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

    const esPrima = firmaTarget.tipo === 'prima';
    const endpoint = esPrima
      ? `/conductor-portal/primas/${firmaTarget.id}/firmar`
      : `/conductor-portal/desprendibles/${firmaTarget.id}/firmar`;
    const successMsg = esPrima
      ? '¡Prima firmada exitosamente!'
      : '¡Desprendible firmado exitosamente!';
    const yaFirmadoMsg = esPrima
      ? 'Esta prima ya fue firmada.'
      : 'Este desprendible ya fue firmado.';

    try {
      const res = await portalFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ firma_base64: firmaBase64 })
      });

      // Update local store
      if (esPrima) {
        const idx = primas.findIndex(p => p.id === firmaTarget!.id);
        if (idx !== -1) {
          primas[idx] = {
            ...primas[idx],
            firmado: true,
            fecha_firma: res.data?.fecha_firma || new Date().toISOString()
          };
          primas = primas;
        }
      } else {
        const idx = desprendibles.findIndex(d => d.id === firmaTarget!.id);
        if (idx !== -1) {
          desprendibles[idx] = {
            ...desprendibles[idx],
            firmado: true,
            fecha_firma: res.data?.fecha_firma || new Date().toISOString()
          };
          desprendibles = desprendibles;
        }
      }

      const targetId = firmaTarget.id;
      cerrarFirmaModal();

      // Show success animation
      successMessage = successMsg;
      showSuccess = true;

      // After animation, open PDF
      setTimeout(async () => {
        showSuccess = false;
        if (esPrima) {
          await verPrima(targetId);
        } else {
          await verDesprendible(targetId);
        }
      }, 2500);

    } catch (err: any) {
      if (err.status === 401) {
        portalSession.logout();
        goto('/public/portal');
        return;
      }
      if (err.status === 409) {
        // Already signed, update local
        if (esPrima) {
          const idx = primas.findIndex(p => p.id === firmaTarget!.id);
          if (idx !== -1) {
            primas[idx] = { ...primas[idx], firmado: true };
            primas = primas;
          }
        } else {
          const idx = desprendibles.findIndex(d => d.id === firmaTarget!.id);
          if (idx !== -1) {
            desprendibles[idx] = { ...desprendibles[idx], firmado: true };
            desprendibles = desprendibles;
          }
        }
        cerrarFirmaModal();
        alert(yaFirmadoMsg);
      } else {
        alert(err.message || 'Error al enviar la firma');
      }
    } finally {
      firmaEnviando = false;
    }
  }

  // ── Action handler: decides firma modal or PDF ──
  function handleAction(d: Desprendible) {
    if (d.firmado) {
      verDesprendible(d.id);
    } else {
      abrirFirmaModal(d);
    }
  }

  // Función reutilizable para aplicar el fix de overflow
  function applyOverflowFix() {
    if (typeof document === 'undefined') return;
    const layoutSelectors = ['.content', '.main-layout', '.portal', 'body'];
    layoutSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        (el as HTMLElement).style.setProperty('overflow-x', 'auto', 'important');
        (el as HTMLElement).style.setProperty('overflow', 'auto', 'important');
      });
    });
  }

  // Reaplicar el fix periódicamente durante los primeros segundos
  // (porque el layout se rehidrata y puede sobrescribir el inline style)
  let overflowInterval: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    if (!$isAuthenticated) {
      goto('/public/portal');
      return;
    }

    // Forzar overflow visible en contenedores del layout padre
    applyOverflowFix();

    // Reaplicar varias veces durante 2 segundos para vencer la rehidratación del layout
    overflowInterval = setInterval(applyOverflowFix, 100);
    setTimeout(() => {
      if (overflowInterval) {
        clearInterval(overflowInterval);
        overflowInterval = null;
      }
    }, 2000);

    // También reaplicar en el siguiente tick
    setTimeout(applyOverflowFix, 50);
    setTimeout(applyOverflowFix, 200);
    setTimeout(applyOverflowFix, 500);
    setTimeout(applyOverflowFix, 1000);

    // Leer param highlight del email
    highlightId = $page.url.searchParams.get('highlight');
    highlightPrimaId = $page.url.searchParams.get('highlight_prima');
    const tabParam = $page.url.searchParams.get('tab');

    // Activar pestaña desde query param (default: desprendibles)
    if (tabParam === 'primas' || tabParam === 'desprendibles') {
      activeTab = tabParam;
    }

    await cargarDesprendibles();
    await cargarPrimas();

    // Si el email apunta a una prima, abrir la pestaña de primas
    if (highlightPrimaId) {
      activeTab = 'primas';
    }

    // Scroll + highlight al desprendible del email
    if (highlightId) {
      // Auto-ajustar año si el desprendible pertenece a otro año
      const target = desprendibles.find(d => d.id === highlightId);
      if (target?.periodo_fin) {
        try {
          const targetYear = new Date(target.periodo_fin + 'T00:00:00').getFullYear();
          if (targetYear !== selectedYear) {
            selectedYear = targetYear;
          }
        } catch {}
      }
      // Limpiar búsqueda por mes para que no filtre
      searchMes = '';

      await tick();
      const el = document.getElementById(`desp-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Remover highlight después de 6 segundos
        setTimeout(() => { highlightId = null; }, 6000);
      }
      // Limpiar param de la URL
      const url = new URL(window.location.href);
      url.searchParams.delete('highlight');
      window.history.replaceState({}, '', url.toString());
    }

    // Scroll + highlight a la prima del email
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
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    } else if (tabParam) {
      // Si solo vino el tab (sin highlight), limpiarlo también
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
  });

  onDestroy(() => {
    if (overflowInterval) {
      clearInterval(overflowInterval);
      overflowInterval = null;
    }
    // Restaurar overflow del body al salir de esta página
    if (typeof document !== 'undefined') {
      ['.content', '.main-layout', '.portal', 'body'].forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          (el as HTMLElement).style.removeProperty('overflow-x');
          (el as HTMLElement).style.removeProperty('overflow');
        });
      });
    }
  });
</script>

<div class="desprendibles-page">
  <!-- ═══ Header ═══ -->
  <div class="page-header">
    <div class="page-header-text">
      <span class="eyebrow">Portal del conductor</span>
      <h1 class="page-title">Desprendibles y Primas</h1>
      <p class="page-sub">Consulta, firma y descarga tus comprobantes de nómina y liquidaciones de prima.</p>
    </div>
    <button class="btn-refresh" on:click={cargarDesprendibles} disabled={loading} title="Actualizar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:spinning={loading}>
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
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
      on:click={() => cambiarTab('desprendibles')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      Desprendibles
      <span class="portal-tab-count">{desprendibles.length}</span>
    </button>
    <button
      type="button"
      role="tab"
      class="portal-tab"
      class:active={activeTab === 'primas'}
      aria-selected={activeTab === 'primas'}
      on:click={() => cambiarTab('primas')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4"/>
      </svg>
      Primas
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
                  <span class="firma-dot firma-dot--ok" title={d.fecha_firma ? `Firmado el ${new Date(d.fecha_firma).toLocaleDateString('es-CO')}` : 'Firmado'}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                {:else}
                  <span class="firma-dot firma-dot--pending" title="Pendiente de firma">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 20h9"/>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                  </span>
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
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                        Ver
                      {/if}
                    </button>
                  {:else}
                    <button
                      class="btn-action btn-firmar"
                      on:click={() => abrirFirmaModal(d)}
                      title="Firmar Desprendible"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                      </svg>
                      Firmar
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
        <div id="desp-{d.id}" class="m-card" class:cotransmeq={d.es_cotransmeq} class:highlight-card={highlightId === d.id}>
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
                <span class="m-stat-value" style={d.firmado ? 'color:#16a34a' : 'color:#d97706'}>
                  {d.firmado ? 'Firmado' : 'Pendiente'}
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
                  <span class="spinner-mini-w"></span> Generando…
                {:else}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  Ver desprendible
                {/if}
              </button>
            {:else}
              <button
                class="m-btn-firmar"
                on:click={() => abrirFirmaModal(d)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Firmar desprendible
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <div class="results-count">
        <span class="meta-mono">{filtered.length}</span>
        de <span class="meta-mono">{desprendibles.length}</span>
        desprendible{desprendibles.length !== 1 ? 's' : ''}
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
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                      </svg>
                      Ver prima
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
                <span class="spinner-mini-w"></span> Generando prima…
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Ver desprendible de prima
              {/if}
            </button>
          </div>
        {/each}
      </div>

      <div class="results-count">
        <span class="meta-mono">{filteredPrimas.length}</span>
        de <span class="meta-mono">{primas.length}</span>
        prima{primas.length !== 1 ? 's' : ''}
      </div>
    {/if}
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- MODAL DE FIRMA                                         -->
<!-- ═══════════════════════════════════════════════════════ -->
{#if showFirmaModal && firmaTarget}
  {@const isPrima = firmaTarget.tipo === 'prima'}
  {@const targetRef = firmaTarget.ref as any}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" transition:fade={{ duration: 200 }} on:click|self={cerrarFirmaModal}>
    <div class="modal-content" transition:fly={{ y: 40, duration: 300 }}>
      <!-- Modal header -->
      <div class="modal-header">
        <div>
          <span class="eyebrow">{isPrima ? 'Firma de prima' : 'Firma de desprendible'}</span>
          <h2 class="modal-title">{isPrima ? 'Firmar Prima' : 'Firmar Desprendible'}</h2>
          <p class="modal-sub">
            {#if isPrima}
              {MESES[(targetRef as PrimaPortal).mes - 1]} {(targetRef as PrimaPortal).anio}
            {:else}
              {getMes(targetRef.periodo_fin)} — {periodoRango(targetRef.periodo_inicio, targetRef.periodo_fin)}
            {/if}
          </p>
        </div>
        <button class="modal-close" on:click={cerrarFirmaModal} disabled={firmaEnviando} aria-label="Cerrar modal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Info resumen -->
      <div class="firma-resumen">
        {#if isPrima}
          <div class="fr-item">
            <span class="fr-label">Valor Prima</span>
            <span class="fr-value main">{fmt((targetRef as PrimaPortal).prima)}</span>
          </div>
          {#if (targetRef as PrimaPortal).prima_pendiente}
            <div class="fr-item">
              <span class="fr-label">Prima Pendiente</span>
              <span class="fr-value">{fmt((targetRef as PrimaPortal).prima_pendiente)}</span>
            </div>
          {/if}
        {:else}
          <div class="fr-item">
            <span class="fr-label">Sueldo Total</span>
            <span class="fr-value main">{fmt(targetRef.sueldo_total)}</span>
          </div>
          <div class="fr-item">
            <span class="fr-label">Días</span>
            <span class="fr-value">{targetRef.dias_laborados}</span>
          </div>
          <div class="fr-item">
            <span class="fr-label">Recargos</span>
            <span class="fr-value">{fmt(targetRef.total_recargos)}</span>
          </div>
        {/if}
      </div>

      <!-- Canvas -->
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

          <!-- Placeholder -->
          {#if totalStrokeLength === 0}
            <div class="canvas-placeholder" transition:fade={{ duration: 150 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <p>Firma aquí</p>
            </div>
          {/if}

          <!-- Clear button -->
          {#if totalStrokeLength > 0}
            <button
              class="canvas-clear"
              on:click={limpiarFirma}
              disabled={firmaEnviando}
              transition:fade={{ duration: 150 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Limpiar
            </button>
          {/if}
        </div>

        <!-- Real-time validation feedback -->
        {#if firmaFeedback}
          <p class="firma-feedback invalid" transition:fade={{ duration: 200 }}>
            ⚠️ {firmaFeedback}
          </p>
        {:else if firmaValida}
          <p class="firma-feedback valid" transition:fade={{ duration: 200 }}>
            ✅ Firma válida — puedes enviar
          </p>
        {/if}

        <!-- Progress bar -->
        {#if totalStrokeLength > 0 && !firmaValida}
          <div class="firma-progress-bar">
            <div
              class="firma-progress-fill"
              style="width: {Math.min(100, (totalStrokeLength / MIN_STROKE_LENGTH) * 100)}%"
            ></div>
          </div>
        {/if}
      </div>

      <!-- Actions -->
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
            <span class="spinner-mini-w"></span> Enviando…
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Firmar y ver PDF
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════ -->
<!-- SUCCESS ANIMATION                                       -->
<!-- ═══════════════════════════════════════════════════════ -->
{#if showSuccess}
  <div
    class="success-overlay"
    transition:fade={{ duration: 300 }}
  >
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

      <!-- Confetti -->
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
  /* ═══ TOKENS — landing-transmeralda editorial ═══ */
  .desprendibles-page {
    --bg: #faf7f2;
    --surface: #ffffff;
    --surface-2: #f5f1e8;
    --border: rgba(0, 0, 0, 0.08);
    --border-default: rgba(0, 0, 0, 0.12);
    --border-hover: rgba(0, 0, 0, 0.2);
    --text-primary: #0f1f1a;
    --text-secondary: #4a4a4a;
    --text-muted: #6b6b6b;
    --text-very-muted: #9a9a9a;
    --accent: #f97316;
    --accent-hover: #ea580c;
    --accent-bg: rgba(249, 115, 22, 0.08);
    --accent-ring: rgba(249, 115, 22, 0.18);
    --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  /* ═══ Highlight Animation (from email link) ═══ */
  @keyframes highlightPulse {
    0% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.6); }
    40% { box-shadow: 0 0 0 8px rgba(249, 115, 22, 0.2); }
    100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
  }
  @keyframes highlightBg {
    0% { background-color: rgba(249, 115, 22, 0.15); }
    50% { background-color: rgba(249, 115, 22, 0.05); }
    100% { background-color: rgba(249, 115, 22, 0.15); }
  }

  :global(tr.highlight-row) {
    animation: highlightPulse 1.5s ease-in-out infinite, highlightBg 2s ease-in-out infinite;
    border-left: 3px solid #f97316 !important;
    position: relative;
  }
  .highlight-card {
    animation: highlightPulse 1.5s ease-in-out infinite, highlightBg 2s ease-in-out infinite;
    border-left: 4px solid #f97316 !important;
  }

  .desprendibles-page {
    padding: 0 0.5rem;
    overflow-x: auto;
    overflow-y: visible;
    min-width: min(100%, 1180px);
  }

  /* Override del layout padre: permitir scroll horizontal en esta página.
     Usamos selectores muy específicos con !important para sobrescribir
     el overflow-x: hidden del layout del portal. */
  :global(.portal-app-overflow) { overflow: visible !important; }

  /* ═══ Header ═══ */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .page-header-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .eyebrow {
    display: inline-block;
    align-self: flex-start;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent-hover);
    background: var(--accent-bg);
    padding: 0.2rem 0.6rem;
    border-radius: 5px;
    margin-bottom: 0.4rem;
  }
  .page-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.45rem;
    font-weight: 500;
    margin: 0;
    color: var(--text-primary);
    letter-spacing: -0.015em;
    line-height: 1.2;
  }
  .page-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    line-height: 1.45;
  }
  .meta-mono {
    font-family: 'JetBrains Mono', monospace;
    color: inherit;
    font-weight: 600;
  }
  .btn-refresh {
    width: 38px; height: 38px;
    border-radius: 10px;
    border: 1px solid var(--border-default);
    background: var(--surface);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-secondary);
    transition: all 0.2s var(--ease);
    flex-shrink: 0;
  }
  .btn-refresh svg { width: 16px; height: 16px; }
  .btn-refresh:hover {
    background: rgba(249, 115, 22, 0.04);
    border-color: var(--accent-ring);
    color: var(--accent-hover);
  }
  .btn-refresh:disabled { opacity: 0.5; }
  .spinning { display: inline-block; animation: spin 1s linear infinite; }

  /* ═══ Filters ═══ */
  .filters-bar {
    display: flex;
    gap: 0.65rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
    padding: 0.85rem 0.95rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }
  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .filter-group.grow { flex: 1; min-width: 180px; }
  .filter-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .filter-select {
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border-default);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 500;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    min-width: 90px;
    transition: all 0.2s var(--ease);
  }
  .filter-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
  }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 0.85rem;
    font-size: 0.85rem;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    color: var(--text-very-muted);
  }
  .filter-input {
    width: 100%;
    padding: 0.55rem 0.85rem 0.55rem 2.3rem;
    border: 1px solid var(--border-default);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-family: inherit;
    outline: none;
    transition: all 0.2s var(--ease);
  }
  .filter-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
  }
  .filter-input::placeholder { color: var(--text-very-muted); }
  .search-clear {
    position: absolute;
    right: 0.45rem;
    width: 22px; height: 22px;
    border-radius: 50%;
    border: none;
    background: var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    line-height: 1;
    transition: background 0.2s var(--ease);
  }
  .search-clear:hover { background: var(--border-hover); }

  /* ═══ States ═══ */
  .state-box {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .state-box p { margin: 0.4rem 0 0; font-size: 0.9rem; }
  .state-emoji { font-size: 2.5rem; display: block; margin-bottom: 0.4rem; }
  .state-title {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 1.05rem;
    color: var(--text-primary);
    margin: 0;
  }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(249, 115, 22, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
  .btn-retry {
    margin-top: 0.85rem;
    padding: 0.5rem 1.1rem;
    border: 1px solid var(--border-default);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-primary);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.82rem;
    font-family: inherit;
    transition: all 0.2s var(--ease);
  }
  .btn-retry:hover {
    background: var(--surface-2);
    border-color: var(--border-hover);
  }

  /* ═══ TABLE (Desktop) ═══ */
  .table-wrap {
    display: none;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .desp-table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
    font-size: 0.85rem;
    table-layout: fixed;
  }
  .desp-table thead {
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .desp-table th {
    padding: 0.7rem 0.6rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    white-space: nowrap;
    text-align: left;
  }
  .desp-table td {
    padding: 0.65rem 0.6rem;
    border-top: 1px solid var(--border);
    color: var(--text-primary);
    vertical-align: middle;
  }
  .desp-table th:nth-child(1), .desp-table td:nth-child(1) { width: 18%; }
  .desp-table th:nth-child(2), .desp-table td:nth-child(2) { width: 14%; }
  .desp-table th:nth-child(3), .desp-table td:nth-child(3) { width: 10%; }
  .desp-table th:nth-child(4), .desp-table td:nth-child(4) { width: 6%; }
  .desp-table th:nth-child(5), .desp-table td:nth-child(5) { width: 11%; }
  .desp-table th:nth-child(6), .desp-table td:nth-child(6) { width: 12%; }
  .desp-table th:nth-child(7), .desp-table td:nth-child(7) { width: 6%; }
  .desp-table th:nth-child(8), .desp-table td:nth-child(8) { width: 23%; }
  .desp-table tbody tr {
    transition: background 0.15s var(--ease);
  }
  .desp-table tbody tr:hover {
    background: rgba(249, 115, 22, 0.04);
  }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }
  .td-mes { display: block; white-space: normal; }
  .mes-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .mes-name { font-weight: 600; }
  .tag-cotrans {
    padding: 0.1rem 0.45rem;
    border-radius: 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.6rem;
    font-weight: 700;
    background: rgba(245, 158, 11, 0.08);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.25);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .td-periodo {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .status-pill::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .status-pill.liquidado {
    background: rgba(34, 197, 94, 0.08);
    color: #15803d;
    border: 1px solid rgba(34, 197, 94, 0.2);
  }
  .status-pill.liquidado::before { background: #22c55e; }
  .status-pill.pendiente {
    background: rgba(245, 158, 11, 0.08);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.22);
  }
  .status-pill.pendiente::before { background: #f59e0b; }
  .status-pill.otro {
    background: rgba(0, 0, 0, 0.05);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .status-pill.otro::before { background: var(--text-very-muted); }
  .sueldo { font-weight: 700; color: var(--accent-hover); }

  .firma-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .firma-dot--ok {
    background: rgba(34, 197, 94, 0.12);
    color: #15803d;
    border: 1px solid rgba(34, 197, 94, 0.25);
  }
  .firma-dot--pending {
    background: rgba(245, 158, 11, 0.08);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.22);
  }

  /* Action buttons in table */
  .action-stack {
    display: flex;
    flex-direction: row;
    gap: 0.3rem;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
  }
  .btn-action {
    padding: 0.3rem 0.6rem;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.3rem;
    transition: all 0.2s var(--ease);
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .btn-ver {
    background: rgba(249, 115, 22, 0.08);
    color: var(--accent-hover);
    border: 1px solid rgba(249, 115, 22, 0.22);
  }
  .btn-ver:hover:not(:disabled) {
    background: rgba(249, 115, 22, 0.16);
    transform: translateY(-1px);
  }
  .btn-ver:disabled { opacity: 0.5; cursor: wait; }
  .btn-firmar {
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #fff;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
  }
  .btn-firmar:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(249, 115, 22, 0.4);
  }
  .btn-firmar:active { transform: scale(0.97); }

  .spinner-mini {
    width: 14px; height: 14px;
    border: 2px solid rgba(249, 115, 22, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* ═══ MOBILE CARDS ═══ */
  .mobile-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .m-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    border-left: 4px solid var(--accent);
    min-width: 0;
    max-width: 100%;
    transition: all 0.2s var(--ease);
  }
  .m-card:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(249, 115, 22, 0.08); }
  .m-card.cotransmeq { border-left-color: #f59e0b; }
  .m-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 0.85rem 1rem 0;
    gap: 0.5rem;
  }
  .m-card-mes { display: flex; flex-direction: column; }
  .m-mes-name {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 1rem;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }
  .m-periodo {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    margin-top: 0.1rem;
  }
  .m-card-badges {
    display: flex; gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;
  }
  .m-card-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 0.75rem;
    padding: 0.7rem 1rem 0.4rem;
  }
  .m-stat { display: flex; flex-direction: column; }
  .m-stat-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .m-stat-value {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    margin-top: 0.1rem;
  }
  .m-stat-value.main { font-size: 1.05rem; color: var(--accent-hover); }
  .m-btn-pdf {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: calc(100% - 2rem);
    margin: 0.5rem 1rem 1rem;
    padding: 0.65rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #fff;
    font-weight: 600;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
    transition: all 0.2s var(--ease);
  }
  .m-btn-pdf:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4); }
  .m-btn-pdf:active:not(:disabled) { transform: scale(0.98); }
  .m-btn-pdf:disabled { opacity: 0.6; cursor: wait; }
  .m-btn-pdf svg { width: 14px; height: 14px; }

  .m-btn-firmar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: calc(100% - 2rem);
    margin: 0.5rem 1rem 1rem;
    padding: 0.65rem;
    border: 1px solid rgba(249, 115, 22, 0.3);
    border-radius: 10px;
    background: rgba(249, 115, 22, 0.06);
    color: var(--accent-hover);
    font-weight: 600;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .m-btn-firmar:hover {
    background: rgba(249, 115, 22, 0.12);
    border-color: rgba(249, 115, 22, 0.5);
  }
  .m-btn-firmar:active { transform: scale(0.98); }
  .m-btn-firmar svg { width: 14px; height: 14px; }

  .spinner-mini-w {
    width: 14px; height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* ═══ Results count ═══ */
  .results-count {
    text-align: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 1rem;
    padding-bottom: 0.5rem;
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  /* ═══════════════════════════════════════ */
  /* MODAL DE FIRMA — landing-cotransmeq    */
  /* ═══════════════════════════════════════ */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
    backdrop-filter: blur(8px) saturate(120%);
    -webkit-backdrop-filter: blur(8px) saturate(120%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-content {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 24px;
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  }
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.5rem 1.5rem 1.1rem;
    gap: 0.75rem;
    background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border);
  }
  .modal-title {
    font-family: 'Geist', 'Inter', system-ui, sans-serif;
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0.4rem 0 0;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }
  .modal-sub {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0.2rem 0 0;
    font-family: 'Geist', 'Inter', system-ui, sans-serif;
    font-weight: 500;
  }
  .modal-close {
    width: 32px; height: 32px;
    border-radius: 10px;
    border: 1px solid var(--border-default);
    background: var(--surface);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
    transition: all 0.2s var(--ease);
    flex-shrink: 0;
  }
  .modal-close:hover {
    background: rgba(249, 115, 22, 0.06);
    border-color: rgba(249, 115, 22, 0.3);
    color: #ea580c;
    transform: rotate(90deg);
  }
  .modal-close svg { width: 14px; height: 14px; }

  /* Firma resumen */
  .firma-resumen {
    display: flex;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    margin: 1rem 1.5rem 0;
    background: var(--bg);
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .fr-item { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .fr-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }
  .fr-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    margin-top: 0.1rem;
  }
  .fr-value.main { color: var(--accent-hover); font-size: 0.95rem; }

  /* Canvas area */
  .firma-canvas-container {
    padding: 1rem 1.5rem 0;
  }
  .firma-canvas-label {
    display: block;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.4rem;
  }
  .required { color: #ef4444; }

  .canvas-wrap {
    position: relative;
    border: 2px solid var(--border-default);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s var(--ease);
    background: var(--surface);
  }
  .canvas-wrap.canvas-valid {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
  }
  .canvas-wrap.canvas-invalid {
    border-color: #f59e0b;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
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
    gap: 0.4rem;
    pointer-events: none;
    color: var(--text-very-muted);
  }
  .canvas-placeholder p {
    font-size: 0.82rem;
    margin: 0;
    color: var(--text-muted);
  }
  .canvas-clear {
    position: absolute;
    top: 0.5rem; right: 0.5rem;
    padding: 0.3rem 0.6rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    transition: all 0.2s var(--ease);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .canvas-clear svg { width: 11px; height: 11px; }
  .canvas-clear:hover { background: var(--bg); }

  /* Feedback */
  .firma-feedback {
    font-size: 0.78rem;
    font-weight: 600;
    margin: 0.4rem 0 0;
  }
  .firma-feedback.invalid { color: #b45309; }
  .firma-feedback.valid { color: #15803d; }

  /* Progress bar */
  .firma-progress-bar {
    height: 4px;
    background: var(--border);
    border-radius: 4px;
    margin-top: 0.4rem;
    overflow: hidden;
  }
  .firma-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b, #f97316);
    border-radius: 4px;
    transition: width 0.2s;
  }

  /* Modal actions */
  .modal-actions {
    display: flex;
    gap: 0.65rem;
    padding: 1.25rem 1.5rem 1.5rem;
    margin-top: 0.5rem;
    background: var(--bg);
  }
  .btn-modal-cancel {
    flex: 1;
    padding: 0.7rem;
    border: 1px solid var(--border-default);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-primary);
    font-family: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .btn-modal-cancel:hover { background: var(--bg); border-color: var(--border-hover); }
  .btn-modal-cancel:disabled { opacity: 0.5; }
  .btn-modal-submit {
    flex: 2;
    padding: 0.7rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #fff;
    font-family: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
    transition: all 0.2s var(--ease);
  }
  .btn-modal-submit:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
  }
  .btn-modal-submit:active:not(:disabled) { transform: scale(0.98); }
  .btn-modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-modal-submit svg { width: 14px; height: 14px; }

  /* ═══════════════════════════════════════ */
  /* SUCCESS ANIMATION                      */
  /* ═══════════════════════════════════════ */
  .success-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.95), rgba(234, 88, 12, 0.95));
    padding: 1rem;
  }
  .success-content {
    text-align: center;
    position: relative;
  }
  .success-icon-wrap {
    width: 120px; height: 120px;
    border-radius: 50%;
    background: var(--surface);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 1.5rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  }
  .success-icon {
    width: 72px; height: 72px;
    color: var(--accent-hover);
  }
  .success-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.8rem;
    font-weight: 500;
    color: #fff;
    margin: 0;
    letter-spacing: -0.015em;
  }
  .success-sub {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.85);
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
  .confetti:nth-child(2n) { background: rgba(255, 255, 255, 0.8); width: 8px; height: 8px; }
  .confetti:nth-child(3n) { background: rgba(255, 255, 255, 0.6); width: 12px; height: 4px; }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ═══ TABS (Desprendibles | Primas) ═══ */
  .portal-tabs {
    display: flex;
    gap: 0.4rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.3rem;
    margin-bottom: 1.25rem;
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
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    border-radius: 9px;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .portal-tab svg { width: 15px; height: 15px; }
  .portal-tab:hover:not(.active) {
    background: rgba(249, 115, 22, 0.06);
    color: var(--accent-hover);
  }
  .portal-tab.active {
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #fff;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
  }
  .portal-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.68rem;
    font-weight: 700;
  }
  .portal-tab:not(.active) .portal-tab-count {
    background: var(--surface);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  /* Mobile: prima card con acento ámbar */
  .m-card.m-card-prima {
    border-left-color: #f59e0b;
  }
  .m-stat-value.sueldo {
    color: #b45309;
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
    /* Asegurar que en mobile se permita scroll horizontal si el contenido es ancho */
    .desprendibles-page {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .mobile-cards {
      min-width: 0;
    }
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
  .action-stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: center;
  }
  .btn-prima {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    border: none;
    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
  }
  .btn-prima:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
  }
  .btn-prima:active:not(:disabled) { transform: scale(0.97); }
  .btn-prima:disabled { opacity: 0.5; cursor: wait; }
  .m-stat-prima {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.04), rgba(245, 158, 11, 0.1));
    border-radius: 8px;
    padding: 0.3rem 0.5rem;
    margin: -0.3rem -0.5rem;
    border: 1px solid rgba(245, 158, 11, 0.15);
  }
  .m-btn-prima {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: calc(100% - 2rem);
    margin: 0.5rem 1rem 1rem;
    padding: 0.6rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    font-family: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
    transition: all 0.2s var(--ease);
  }
  .m-btn-prima:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
  }
  .m-btn-prima:active:not(:disabled) { transform: scale(0.98); }
  .m-btn-prima:disabled { opacity: 0.6; cursor: wait; }
  .m-btn-prima svg { width: 14px; height: 14px; }
</style>
