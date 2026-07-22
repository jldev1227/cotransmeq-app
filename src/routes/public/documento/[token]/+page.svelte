<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  // States
  type PageState = 'loading' | 'error' | 'firma' | 'firmando' | 'pdf';
  let estado: PageState = 'loading';
  let errorMessage = '';

  // Data
  let filename = '';
  let originalName = '';
  let sharedDoc: any = null;
  let signatureInfo: any = null;
  let presignedDocumentUrl = '';

  // Canvas
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let hasDrawn = false;
  let lastX = 0;
  let lastY = 0;

  $: token = $page.params.token ?? '';

  onMount(async () => {
    try { document.documentElement.style.overflow = 'auto' } catch (e) {}
    try { document.body.style.overflow = 'auto' } catch (e) {}
    await validarToken();
  });

  onDestroy(() => {
    try { document.body.style.overflow = '' } catch (e) {}
    try { document.documentElement.style.overflow = '' } catch (e) {}
  });

  async function validarToken() {
    try {
      estado = 'loading';
      const API = (import.meta.env.VITE_API_URL as string) || '';
      const base = API.endsWith('/') ? API.slice(0, -1) : API;
      const res = await fetch(`${base}/api/desprendible/compartido/${token}`);
      if (!res.ok) throw res;
      const json = await res.json();
      const data = json.data;
      sharedDoc = data;
      filename = data.filename || '';
      originalName = data.original_name || '';

      if (data.signed) {
        await cargarDatosShared();
      } else {
        estado = 'firma';
        initCanvas();
      }
    } catch (err: any) {
      const status = err?.status || err?.statusCode || (err?.response && err.response.status);
      if (status === 404) errorMessage = 'Este enlace no es válido.';
      else if (status === 410) errorMessage = 'Este enlace ha expirado.';
      else errorMessage = 'No se pudo verificar el enlace.';
      estado = 'error';
    }
  }

  async function cargarDatosShared() {
    try {
      estado = 'loading';
      const API = (import.meta.env.VITE_API_URL as string) || '';
      const base = API.endsWith('/') ? API.slice(0, -1) : API;
      const res = await fetch(`${base}/api/desprendible/compartido/${token}/datos`);
      if (!res.ok) throw res;
      const json = await res.json();
      const data = json.data;
      presignedDocumentUrl = data.document?.presigned_url || sharedDoc?.presigned_url || '';
      signatureInfo = data.signature ? { presignedUrl: data.signature.presignedUrl } : null;
      if (data.document) sharedDoc = data.document;
      estado = 'pdf';
    } catch (err: any) {
      errorMessage = 'Error al cargar los datos del documento.';
      estado = 'error';
    }
  }

  function initCanvas() {
    setTimeout(() => {
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);
    }, 100);
  }

  function getPosition(e: MouseEvent | TouchEvent) {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
  }

  function startDrawing(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    isDrawing = true;
    const pos = getPosition(e);
    lastX = pos.x; lastY = pos.y;
  }

  function draw(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    if (!isDrawing || !ctx) return;
    hasDrawn = true;
    const pos = getPosition(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastX = pos.x; lastY = pos.y;
  }

  function stopDrawing() { isDrawing = false }

  function limpiarFirma() {
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, rect.width, rect.height); hasDrawn = false;
  }

  async function enviarFirma() {
    if (!hasDrawn || !canvas) return;
    try {
      estado = 'firmando';
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('Error al generar imagen')) }, 'image/png');
      });
      const form = new FormData();
      form.append('file', blob, 'firma.png');
      const API = (import.meta.env.VITE_API_URL as string) || '';
      const base = API.endsWith('/') ? API.slice(0, -1) : API;
      const res = await fetch(`${base}/api/desprendible/compartido/${token}/firmar`, { method: 'POST', body: form });
      if (!res.ok) throw res;
      await cargarDatosShared();
    } catch (err: any) {
      errorMessage = 'Error al registrar la firma.';
      estado = 'error';
    }
  }

  function descargarPDF() { if (!presignedDocumentUrl) return; window.open(presignedDocumentUrl, '_blank') }
</script>

<svelte:head>
  <title>Desprendible de Nómina - Cotransmeq</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="min-h-screen overflow-auto bg-gradient-to-br from-gray-50 via-orange-50/30 to-orange-50/20">
  <!-- Header -->
  <header class="border-b border-orange-100 bg-white/80 backdrop-blur-md">
    <div class="mx-auto flex max-w-2xl items-center justify-center gap-3 px-4 py-4">
  <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30">
        <svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div>
        <h1 class="text-lg font-bold text-gray-900">Cotransmeq S.A.S</h1>
        <p class="text-xs text-gray-500">Desprendible de Nómina</p>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-2xl px-4 py-8">
    {#if estado === 'loading'}
      <div class="flex flex-col items-center justify-center py-24" in:fade={{ duration: 300 }}>
        <div class="relative mb-6">
          <div class="h-16 w-16 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500"></div>
        </div>
        <p class="text-lg font-medium text-gray-700">Verificando enlace...</p>
        <p class="mt-1 text-sm text-gray-500">Por favor espera un momento</p>
      </div>

    {:else if estado === 'error'}
      <div class="py-16" in:scale={{ start: 0.95, duration: 300 }}>
        <div class="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-xl shadow-red-500/5">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg class="h-8 w-8 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 class="mb-2 text-xl font-bold text-gray-900">No se puede acceder</h2>
          <p class="text-sm text-gray-600">{errorMessage}</p>
        </div>
      </div>

    {:else if estado === 'firma'}
      <div in:fly={{ y: 20, duration: 400 }}>
        <!-- Documento info -->
  <div class="mb-6 rounded-2xl border border-orange-100 bg-white p-6 shadow-lg shadow-orange-500/5">
          <div class="flex items-start gap-4">
            <div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 text-orange-600">
              <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h10v10H7z" />
              </svg>
            </div>
            <div class="flex-1">
              <p class="text-sm text-gray-500">Archivo compartido</p>
        <p class="mt-1 text-sm font-semibold text-orange-600">{filename}</p>
              {#if sharedDoc?.conductores || sharedDoc?.conductor}
                <div class="mt-2 text-sm text-gray-700">
                  <p class="font-medium">{sharedDoc?.conductores?.nombre ?? sharedDoc?.conductor?.nombre ?? ''} {sharedDoc?.conductores?.apellido ?? sharedDoc?.conductor?.apellido ?? ''}</p>
                  {#if (sharedDoc?.conductores?.numero_identificacion ?? sharedDoc?.conductor?.numero_identificacion)}
                    <p class="text-xs text-gray-500">CC: {sharedDoc?.conductores?.numero_identificacion ?? sharedDoc?.conductor?.numero_identificacion}</p>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <div class="mt-4">
            <div class="rounded-xl bg-gray-50 p-3">
              <p class="text-xs font-medium text-gray-500">Nombre de archivo</p>
              <p class="text-sm font-semibold text-gray-900">{filename}</p>
            </div>
          </div>
        </div>

        <!-- Signature board -->
  <div class="rounded-2xl border border-orange-100 bg-white p-6 shadow-lg shadow-orange-500/5">
    <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </div>
            <div>
              <h3 class="font-bold text-gray-900">Firma Digital</h3>
              <p class="text-xs text-gray-500">Firme en el recuadro para confirmar recibido</p>
            </div>
          </div>

          <div class="relative overflow-hidden rounded-xl border-2 border-dashed {hasDrawn ? 'border-orange-300 bg-white' : 'border-gray-300 bg-gray-50/50'}">
            <canvas
              bind:this={canvas}
              class="h-48 w-full cursor-crosshair touch-none"
              style="touch-action: none;"
              on:mousedown={startDrawing}
              on:mousemove={draw}
              on:mouseup={stopDrawing}
              on:mouseleave={stopDrawing}
              on:touchstart={startDrawing}
              on:touchmove={draw}
              on:touchend={stopDrawing}
            ></canvas>
            {#if !hasDrawn}
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p class="text-sm font-medium text-gray-400">Dibuje su firma aquí</p>
              </div>
            {/if}
          </div>

          <div class="mt-4 flex gap-3">
            <button
              on:click={limpiarFirma}
              disabled={!hasDrawn}
              class="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Limpiar
            </button>
            <button
              on:click={enviarFirma}
              disabled={!hasDrawn}
              class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            >
              Confirmar Firma
            </button>
          </div>

          <p class="mt-3 text-center text-xs text-gray-400">
            Al firmar, confirmas haber recibido y revisado el documento <strong>{sharedDoc?.original_name || filename}</strong>.
          </p>
        </div>
      </div>

    {:else if estado === 'firmando'}
      <div class="flex flex-col items-center justify-center py-24" in:fade={{ duration: 300 }}>
        <div class="relative mb-6">
          <div class="h-16 w-16 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500"></div>
        </div>
        <p class="text-lg font-medium text-gray-700">Registrando firma...</p>
        <p class="mt-1 text-sm text-gray-500">Esto puede tomar unos segundos</p>
      </div>

    {:else if estado === 'pdf'}
      <div in:fly={{ y: 20, duration: 400 }}>
  <div class="mb-6 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-orange-50 p-6 shadow-lg shadow-green-500/5">
          <div class="flex items-center gap-4">
            <div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-100">
              <svg class="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="font-bold text-orange-800">¡Firma registrada exitosamente!</h3>
              <p class="text-sm text-orange-600">Tu desprendible de nómina está listo para descargar.</p>
            </div>
          </div>
        </div>

        {#if signatureInfo?.presignedUrl}
          <div class="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg">
            <p class="text-sm text-gray-500 mb-3">Firma registrada:</p>
            <div class="flex flex-col items-center justify-center">
              <img src={signatureInfo.presignedUrl} alt="Firma del conductor" class="max-h-48 w-auto rounded-md border" />
              {#if sharedDoc?.conductores || sharedDoc?.conductor || sharedDoc?.conductor_id}
                <div class="mt-4 text-center">
                  <p class="text-sm font-semibold text-gray-900">{sharedDoc?.conductores?.nombre ?? sharedDoc?.conductor?.nombre ?? ''} {sharedDoc?.conductores?.apellido ?? sharedDoc?.conductor?.apellido ?? ''}</p>
                  {#if (sharedDoc?.conductores?.numero_identificacion ?? sharedDoc?.conductor?.numero_identificacion)}
                    <p class="text-xs text-gray-500">CC: {sharedDoc?.conductores?.numero_identificacion ?? sharedDoc?.conductor?.numero_identificacion}</p>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <div class="grid grid-cols-1 gap-3">
          {#if presignedDocumentUrl}
            <a href={presignedDocumentUrl} target="_blank" rel="noreferrer" class="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 text-base font-bold text-white shadow-xl shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-2xl">Ver Desprendible</a>
          {/if}
        </div>

        {#if sharedDoc?.updated_at}
          <p class="mt-4 text-center text-xs text-gray-400">Firmado el {new Date(sharedDoc.updated_at).toLocaleString('es-CO')}</p>
        {/if}
      </div>
    {/if}
  </main>

  <!-- Footer -->
  <footer class="border-t border-gray-100 bg-white/50 py-4 text-center">
    <p class="text-xs text-gray-400">Cotransmeq S.A.S © {new Date().getFullYear()}</p>
  </footer>
</div>
