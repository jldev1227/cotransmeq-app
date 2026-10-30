<script lang="ts">
  import { apiClient } from '$lib/api/apiClient';
  import { getApiBase } from '$lib/stores/portalStore';

  type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
  let { cursoId, modulos, request, onChange, modalidadesEntrega = [] }: {
    cursoId: string; modulos: any[]; request: Api; onChange: () => Promise<void>; modalidadesEntrega?: string[]
  } = $props();
  let moduloId = $state('');
  let leccionId = $state('');
  let titulo = $state('');
  let tipo = $state('lectura');
  let texto = $state('');
  let url = $state('');
  let subtitulosUrl = $state('');
  let subtitulosArchivoId = $state('');
  let archivoId = $state('');
  let archivoNombre = $state('');
  let archivoUrl = $state('');
  let archivoPreviewUrl = $state('');
  let textoArchivo = $state('');
  let nombreModulo = $state('');
  let subiendo = $state(false);
  let guardando = $state(false);
  let error = $state('');
  let aviso = $state('');
  let archivoInput: HTMLInputElement;
  let previewDialog: HTMLDialogElement;

  const tipos = [
    ['lectura', 'Lectura / README'], ['video', 'Video'], ['audio', 'Audio'],
    ['pdf', 'PDF'], ['pptx', 'Presentación PPTX'], ['h5p', 'H5P'],
    ['scorm', 'SCORM'], ['iframe', 'Proveedor externo']
  ] as const;
  const modalidadPorTipo: Record<string, string> = {
    lectura: 'lectura', pdf: 'lectura', pptx: 'lectura', video: 'video', audio: 'audio',
    h5p: 'interactivo', scorm: 'interactivo', iframe: 'interactivo'
  };
  let tiposVisibles = $derived(modalidadesEntrega.length
    ? tipos.filter(([valor]) => modalidadesEntrega.includes(modalidadPorTipo[valor] ?? '') || valor === tipo)
    : tipos);
  let lecciones = $derived(modulos.find((m: any) => m.id === moduloId)?.lecciones ?? []);
  let vista = $derived(archivoUrl || url);
  let urlVista = $derived(vista.startsWith('/') ? getApiBase() + vista : vista);
  let urlVistaPptx = $derived(archivoPreviewUrl.startsWith('/') ? getApiBase() + archivoPreviewUrl : archivoPreviewUrl);
  let urlSubtitulos = $derived(subtitulosUrl.startsWith('/') ? getApiBase() + subtitulosUrl : subtitulosUrl);

  function abrirVistaPrevia() {
    if (previewDialog && !previewDialog.open) previewDialog.showModal();
  }

  function limpiar() {
    leccionId = ''; titulo = ''; tipo = 'lectura'; texto = ''; url = ''; subtitulosUrl = ''; subtitulosArchivoId = '';
    archivoId = ''; archivoNombre = ''; archivoUrl = ''; archivoPreviewUrl = ''; textoArchivo = '';
    error = ''; aviso = '';
  }
  function limpiarArchivo() {
    archivoId = ''; archivoNombre = ''; archivoUrl = ''; archivoPreviewUrl = ''; textoArchivo = '';
  }
  function seleccionarModulo(id: string) { moduloId = id; limpiar(); }
  function seleccionarLeccion(l: any) {
    limpiar(); leccionId = l.id; moduloId = l.moduloId; titulo = l.titulo; tipo = l.tipo;
    texto = l.contenido?.texto ?? '';
    url = l.contenido?.archivoId ? '' : (l.contenido?.url ?? '');
    archivoId = l.contenido?.archivoId ?? '';
    archivoUrl = l.contenido?.archivoId ? (l.contenido?.url ?? '') : '';
    archivoPreviewUrl = l.contenido?.previewUrl ?? '';
    subtitulosUrl = l.contenido?.subtitulosUrl ?? '';
    subtitulosArchivoId = l.contenido?.subtitulosArchivoId ?? '';
    archivoNombre = l.contenido?.archivoId ? 'Archivo del curso' : '';
    if (tipo === 'lectura' && archivoUrl) {
      const actual = l.id;
      void fetch(archivoUrl.startsWith('/') ? getApiBase() + archivoUrl : archivoUrl)
        .then((r) => r.ok ? r.text() : Promise.reject(new Error('Lectura no disponible')))
        .then((text) => { if (leccionId === actual) textoArchivo = text; })
        .catch(() => { if (leccionId === actual) aviso = 'No se pudo cargar la vista previa del archivo.'; });
    }
  }
  function tipoArchivo(): string {
    return tipo === 'lectura' ? 'readme' : tipo;
  }
  function acepta(): string {
    const tiposArchivo: Record<string, string> = {
      video: '.mp4,.webm,.mov', audio: '.mp3,.m4a,.wav,.ogg',
      pdf: '.pdf', pptx: '.pptx', lectura: '.md,.txt', h5p: '.h5p', scorm: '.zip'
    };
    return tiposArchivo[tipo] ?? '';
  }
  function mime(file: File) {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const defaults: Record<string, string> = {
      md: 'text/markdown', txt: 'text/plain', vtt: 'text/vtt', h5p: 'application/x-h5p',
      zip: 'application/zip', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };
    return defaults[ext ?? ''] ?? 'application/octet-stream';
  }
  function mensaje(cause: any) {
    error = cause?.response?.data?.message ?? cause?.message ?? 'No se pudo guardar el contenido.';
  }
  async function crearModulo() {
    if (!nombreModulo.trim()) return;
    try {
      const m = await request('/gestion/cursos/' + cursoId + '/modulos', 'POST',
        { titulo: nombreModulo, orden: modulos.length });
      nombreModulo = ''; await onChange(); seleccionarModulo(m.id);
    } catch (cause) { mensaje(cause); }
  }
  async function cargarArchivo(file: File, recursoTipo: string) {
      const reserva = await request('/gestion/cursos/' + cursoId + '/archivos/iniciar', 'POST',
        { nombre: file.name, tipo: recursoTipo, mime: mime(file), tamano: file.size });
      try {
        if (reserva.modo === 's3-multipart') {
          const uploadParts = reserva.uploadParts as Array<{ partNumber: number; uploadUrl: string }>;
          if (!Array.isArray(uploadParts) || !uploadParts.length || !reserva.partSize || !reserva.uploadId) {
            throw new Error('El almacenamiento no pudo preparar los fragmentos del archivo.');
          }
          const partesSubidas: Array<{ partNumber: number; etag: string }> = new Array(uploadParts.length);
          let siguiente = 0;
          const subirParte = async () => {
            while (true) {
              const indice = siguiente++;
              if (indice >= uploadParts.length) return;
              const parte = uploadParts[indice];
              const inicio = (parte.partNumber - 1) * reserva.partSize;
              const cuerpo = file.slice(inicio, Math.min(inicio + reserva.partSize, file.size));
              const response = await fetch(parte.uploadUrl, { method: 'PUT', body: cuerpo });
              if (!response.ok) throw new Error('El almacenamiento rechazó el fragmento ' + parte.partNumber + ' (' + response.status + ').');
              const etag = response.headers.get('ETag');
              if (!etag) throw new Error('El almacenamiento no confirmó el fragmento ' + parte.partNumber + '.');
              partesSubidas[indice] = { partNumber: parte.partNumber, etag };
            }
          };
          await Promise.all(Array.from({ length: Math.min(3, uploadParts.length) }, () => subirParte()));
          await request('/gestion/archivos/' + reserva.archivo.id + '/multipart/completar', 'POST', {
            uploadId: reserva.uploadId, parts: partesSubidas
          });
        } else if (reserva.modo === 's3') {
          const response = await fetch(reserva.uploadUrl, {
            method: 'PUT', headers: reserva.headers, body: file
          });
          if (!response.ok) throw new Error('El almacenamiento rechazó la subida (' + response.status + ').');
          await request('/gestion/archivos/' + reserva.archivo.id + '/confirmar', 'POST');
        } else {
          const form = new FormData(); form.set('archivo', file);
          await apiClient.post(reserva.uploadUrl, form, { timeout: 300_000 });
        }
      } catch (cause) {
        if (reserva.modo === 's3-multipart' && reserva.uploadId) {
          await request('/gestion/archivos/' + reserva.archivo.id + '/multipart/abortar', 'POST', {
            uploadId: reserva.uploadId
          }).catch(() => undefined);
        }
        throw cause;
      }
      const preview = await request('/gestion/archivos/' + reserva.archivo.id + '/url');
      return { id: reserva.archivo.id as string, url: preview.url as string, previewUrl: preview.previewUrl as string | null };
  }
  async function subir(file: File) {
    if (!moduloId || subiendo) return;
    error = ''; aviso = ''; subiendo = true;
    try {
      const preview = await cargarArchivo(file, tipoArchivo());
      archivoId = preview.id; archivoNombre = file.name; archivoUrl = preview.url;
      archivoPreviewUrl = preview.previewUrl ?? '';
      if (tipo === 'lectura') textoArchivo = await file.text();
      url = ''; aviso = 'Archivo listo: ' + file.name;
    } catch (cause) { mensaje(cause); }
    finally { subiendo = false; if (archivoInput) archivoInput.value = ''; }
  }
  async function subirSubtitulos(file: File) {
    if (!moduloId || subiendo) return;
    error = ''; aviso = ''; subiendo = true;
    try {
      const recurso = await cargarArchivo(file, 'subtitulos');
      subtitulosArchivoId = recurso.id; subtitulosUrl = recurso.url;
      aviso = 'Subtítulos listos: ' + file.name;
    } catch (cause) { mensaje(cause); }
    finally { subiendo = false; }
  }
  async function guardar() {
    if (!moduloId || !titulo.trim() || guardando) return;
    error = ''; aviso = ''; guardando = true;
    try {
      let contenido: Record<string, unknown>;
      const subtitulos = subtitulosArchivoId ? { subtitulosArchivoId } : { subtitulosUrl };
      if (archivoId) contenido = { archivoId, ...(tipo === 'video' ? subtitulos : {}) };
      else if (tipo === 'lectura') contenido = { texto };
      else contenido = { url, ...(tipo === 'video' ? subtitulos : {}) };
      const path = leccionId
        ? '/gestion/modulos/' + moduloId + '/lecciones/' + leccionId
        : '/gestion/modulos/' + moduloId + '/lecciones';
      const guardada = await request(path, leccionId ? 'PUT' : 'POST',
        { titulo, tipo, contenido, orden: lecciones.length });
      await onChange(); leccionId = guardada.id;
      aviso = 'Lección guardada.';
    } catch (cause) { mensaje(cause); }
    finally { guardando = false; }
  }
</script>

<section class="editor" aria-label="Editor de lecciones">
  <aside class="outline">
    <h3>Contenido del curso</h3>
    <div class="new-module"><label for="cap-nuevo-modulo">Nuevo módulo</label>
      <input id="cap-nuevo-modulo" bind:value={nombreModulo} placeholder="Ej. Introducción" />
      <button onclick={() => void crearModulo()} disabled={!nombreModulo.trim()}>Agregar módulo</button>
    </div>
    {#each modulos as m}
      <div class="module">
        <button class:active={moduloId === m.id} onclick={() => seleccionarModulo(m.id)}>
          <strong>{m.titulo}</strong><small>{m.lecciones.length} lecciones</small>
        </button>
        {#if moduloId === m.id}
          {#each m.lecciones as l}
            <button class:active={leccionId === l.id} class="lesson-button" onclick={() => seleccionarLeccion(l)}>
              {l.titulo}<small>{l.tipo}</small>
            </button>
          {/each}
          <button class="add-lesson" onclick={limpiar}>+ Nueva lección</button>
        {/if}
      </div>
    {/each}
  </aside>

  <div class="form">
    <header><div><p class="eyebrow">Editor de lecciones</p>
      <h3>{leccionId ? 'Editar lección' : 'Nueva lección'}</h3></div>
      <div class="form-actions"><button type="button" class="preview-trigger" aria-haspopup="dialog" aria-controls="lesson-preview" onclick={abrirVistaPrevia}>Vista previa</button>
      <button class="save" onclick={() => void guardar()}
        disabled={!moduloId || !titulo.trim() || subiendo || guardando}>
        {guardando ? 'Guardando…' : 'Guardar lección'}</button></div></header>
    {#if !moduloId}<p>Elige o crea un módulo para comenzar.</p>{:else}
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      {#if aviso}<p role="status" class="notice">{aviso}</p>{/if}
      <label>Título de la lección <input bind:value={titulo} placeholder="Nombre que verá el personal" /></label>
      <label>Formato <select bind:value={tipo} onchange={limpiarArchivo}>
        {#each tiposVisibles as [valor, nombre]}<option value={valor}>{nombre}</option>{/each}
      </select></label>
      {#if tipo === 'lectura'}
        <label>Texto de la lección <textarea bind:value={texto} rows="9"
          placeholder="Escribe aquí el contenido o sube un archivo .md/.txt"></textarea></label>
      {/if}
      {#if acepta()}
        <div class="upload">
          <label>Subir {tipos.find(([v]) => v === tipo)?.[1]}
            <input bind:this={archivoInput} type="file" accept={acepta()}
              onchange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void subir(file); }} /></label>
          <small>{subiendo ? 'Subiendo archivo…' : archivoNombre || 'Se guarda en el almacenamiento privado de capacitaciones.'}</small>
        </div>
      {/if}
      {#if tipo !== 'lectura'}
        <label>URL HTTPS {tipo === 'iframe' ? 'del proveedor (Kahoot, Forms u otro)' : 'alternativa al archivo'}
          <input bind:value={url} placeholder="https://…" disabled={!!archivoId} /></label>
      {/if}
      {#if tipo === 'video'}
        <label>Subtítulos VTT
          <input type="file" accept=".vtt,text/vtt" onchange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void subirSubtitulos(file); }} />
        </label>
        <label>O URL HTTPS de subtítulos
          <input bind:value={subtitulosUrl} placeholder="https://…/subtitulos.vtt"
            disabled={!!subtitulosArchivoId} /></label>
        {#if subtitulosArchivoId}<button onclick={() => { subtitulosArchivoId = ''; subtitulosUrl = ''; }}>
          Quitar subtítulos cargados</button>{/if}
      {/if}
      {#if (tipo === 'h5p' || tipo === 'scorm') && archivoId}
        <p class="hint">El paquete queda guardado como ZIP privado. La vista previa ejecutable necesita
          el runtime del proveedor; aquí puedes revisar la carga antes de publicar.</p>
      {/if}
    {/if}
  </div>

  <dialog id="lesson-preview" class="preview-dialog" bind:this={previewDialog} aria-labelledby="lesson-preview-title">
    <div class="preview-dialog-shell">
    <header class="preview-dialog-header"><div><p class="eyebrow">Vista previa</p><h2 id="lesson-preview-title">{titulo || 'Tu lección'}</h2></div>
      <button type="button" class="preview-close" aria-label="Cerrar vista previa" onclick={() => previewDialog.close()}>×</button></header>
    <div class="preview-dialog-body">
    {#if tipo === 'lectura' && (textoArchivo || texto)}<div class="reading">{textoArchivo || texto}</div>
    {:else if tipo === 'video' && urlVista}
      <video controls src={urlVista}><track kind="captions" src={urlSubtitulos} srclang="es" label="Español" /></video>
    {:else if tipo === 'audio' && urlVista}<audio controls src={urlVista}></audio>
    {:else if tipo === 'pdf' && urlVista}<iframe title="Vista previa PDF" src={urlVista}></iframe>
    {:else if tipo === 'pptx' && urlVistaPptx}<iframe title="Vista previa de diapositivas" src={urlVistaPptx}></iframe>
    {:else if tipo === 'iframe' && urlVista}<iframe title="Vista previa del proveedor" src={urlVista}></iframe>
    {:else if (tipo === 'h5p' || tipo === 'scorm') && urlVista && !archivoId}
      <iframe title="Vista previa del proveedor" src={urlVista}></iframe>
    {:else if archivoNombre}<div class="file-preview"><strong>{archivoNombre}</strong>
      <p>{tipo === 'pptx' ? 'Presentación cargada. Instala LibreOffice en el backend para generar la vista previa PDF.'
        : tipo === 'h5p' || tipo === 'scorm' ? 'Paquete cargado. Se mostrará en el reproductor al habilitar su runtime.'
        : 'Archivo listo para la lección.'}</p>
      {#if urlVista}<a href={urlVista} target="_blank" rel="noopener noreferrer">Abrir archivo</a>{/if}
    </div>
    {:else}<p class="empty">La vista previa aparecerá mientras preparas la lección.</p>{/if}
    </div>
    </div>
  </dialog>
</section>

<style>
  .editor{display:grid;grid-template-columns:minmax(220px,260px) minmax(0,1fr);gap:1rem;align-items:start}
  .outline,.form{min-width:0;border:1px solid var(--border-subtle);border-radius:20px;background:var(--bg-surface);padding:1.15rem;box-shadow:var(--shadow-card)}
  .outline{position:sticky;top:1rem}.outline h3{margin:0 0 .85rem;color:var(--text-primary);font-family:var(--font-display);font-size:.95rem;font-weight:850;letter-spacing:-.015em}.form header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;border-bottom:1px solid var(--border-subtle);padding-bottom:.9rem}.form header>div{display:grid;gap:.25rem}.form header h3{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1rem;font-weight:850}.form-actions{display:flex;flex:0 0 auto;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:.5rem}.form-actions button{width:auto;flex:0 0 auto}
  .preview-trigger{border-color:var(--border-default);background:var(--bg-surface);color:var(--text-secondary);font-weight:750}.preview-trigger:hover{border-color:var(--border-emphasis);background:var(--bg-base);color:var(--au-primary-strong)}
  .preview-dialog{position:fixed;top:50%;left:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);width:min(920px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 48px);margin:0;padding:0;overflow:hidden;border:1px solid var(--border-default);border-radius:20px;background:var(--bg-surface);color:var(--text-primary);box-shadow:0 24px 80px rgba(1,67,57,.25)}.preview-dialog::backdrop{background:rgba(17,36,31,.72);backdrop-filter:blur(3px)}
  .preview-dialog-shell{display:flex;max-height:calc(100dvh - 48px);flex-direction:column}.preview-dialog-header{display:flex;flex:none;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border-subtle);padding:1rem 1.25rem}.preview-dialog-header>div{display:grid;gap:.25rem}.preview-dialog-header .eyebrow{margin:0}.preview-dialog-header h2{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1.1rem;font-weight:850;line-height:1.25}.preview-close{display:grid;width:40px;min-height:40px;place-items:center;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-base);padding:0;color:var(--text-secondary);font-size:1.35rem;line-height:1}.preview-close:hover{border-color:var(--border-emphasis);background:var(--bg-surface);color:var(--text-primary)}.preview-dialog-body{min-height:220px;overflow:auto;padding:1.25rem}.preview-dialog-body video,.preview-dialog-body iframe{display:block;width:100%;max-height:65vh;aspect-ratio:16/9;border:0;border-radius:14px;background:#10241f}.preview-dialog-body audio{width:100%}.preview-dialog-body .reading{max-width:78ch;margin:auto;color:var(--text-primary);line-height:1.7}.preview-dialog-body .empty,.preview-dialog-body .file-preview{display:grid;min-height:150px;place-content:center;gap:.5rem;border:1px dashed var(--border-default);border-radius:14px;background:var(--bg-base);padding:1.25rem;color:var(--text-muted);text-align:center}
  .eyebrow{margin:0;color:var(--au-primary-strong);font-size:.64rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}
  .new-module{display:grid;gap:.4rem;margin-bottom:.75rem}.new-module label{margin:0;color:var(--text-secondary);font-size:.7rem;font-weight:750}.new-module input,.form input,.form select,.form textarea{display:block;width:100%;min-width:0;box-sizing:border-box;margin:0;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-surface);padding:.65rem .75rem;color:var(--text-primary);font:inherit;font-size:.76rem}.form textarea{min-height:130px;resize:vertical;line-height:1.55}.new-module input:focus-visible,.form input:focus-visible,.form select:focus-visible,.form textarea:focus-visible{outline:0;border-color:var(--au-primary);box-shadow:0 0 0 3px rgba(var(--au-primary-rgb),.13)}.form input::placeholder,.form textarea::placeholder,.new-module input::placeholder{color:var(--text-very-muted)}
  .module{border-top:1px solid var(--border-subtle);padding:.6rem 0}.module button{display:flex;width:100%;min-height:42px;align-items:center;justify-content:space-between;gap:.5rem;border:1px solid transparent;border-radius:11px;background:transparent;padding:.6rem .65rem;color:var(--text-secondary);text-align:left}.module button strong{color:inherit;font-size:.74rem;line-height:1.35}.module button.active{border-color:color-mix(in srgb,var(--au-primary-strong) 24%,var(--border-default));background:var(--au-tint);color:var(--au-primary-strong)}.module small{flex:none;color:var(--text-muted);font-size:.64rem}.lesson-button{width:calc(100% - 10px)!important;min-height:36px!important;margin:3px 0 3px 10px!important;border-radius:9px!important;padding:.45rem .55rem!important;font-size:.69rem!important}.lesson-button.active{border-color:var(--border-default)!important;background:var(--bg-base)!important;color:var(--au-primary-strong)!important}.add-lesson{width:calc(100% - 10px)!important;min-height:34px!important;margin:3px 0 0 10px!important;border-style:dashed!important;border-color:var(--border-default)!important;border-radius:9px!important;background:transparent!important;padding:.4rem .55rem!important;color:var(--au-primary-strong)!important;font-size:.69rem!important}
  .form>p{margin:.75rem 0;color:var(--text-muted);font-size:.78rem;line-height:1.5}.form label{display:grid;gap:.4rem;margin:.8rem 0;color:var(--text-secondary);font-size:.73rem;font-weight:750;line-height:1.4}.form-actions button,.new-module button,.form>button,.form button:not(.preview-trigger):not(.save){min-height:40px;border:1px solid var(--border-default);border-radius:11px;background:var(--bg-surface);padding:.6rem .8rem;color:var(--text-secondary);font:inherit;font-size:.73rem;font-weight:750;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease,box-shadow .15s ease}.form-actions button:hover:not(:disabled),.new-module button:hover:not(:disabled),.form>button:hover:not(:disabled),.form button:not(.preview-trigger):not(.save):hover:not(:disabled){border-color:var(--border-emphasis);background:var(--bg-base)}.form-actions button:focus-visible,.new-module button:focus-visible,.form button:focus-visible{outline:2px solid var(--au-primary);outline-offset:2px}.form button:disabled,.new-module button:disabled{opacity:.5;cursor:not-allowed}.save{min-height:40px;border-color:var(--au-primary);background:var(--au-primary);padding:.6rem .9rem;color:#fff;font-size:.73rem;font-weight:800;white-space:nowrap}.save:hover:not(:disabled){border-color:var(--au-primary-strong);background:var(--au-primary-strong)}
  .upload{display:grid;gap:.35rem;margin:.8rem 0;border:1px dashed var(--border-emphasis);border-radius:14px;background:var(--bg-base);padding:.8rem}.upload label{margin:0}.upload input[type=file]{border:0;background:transparent;padding:.35rem 0;font-size:.7rem}.upload small{color:var(--text-muted);font-size:.68rem;line-height:1.45}
  .reading{max-width:78ch;white-space:pre-wrap;line-height:1.7}.file-preview,.empty{border:1px solid var(--border-subtle);border-radius:14px;background:var(--bg-base);padding:1rem;color:var(--text-muted);font-size:.76rem;line-height:1.5}.file-preview strong{color:var(--text-primary)}.file-preview p{margin:.4rem 0}.file-preview a{color:var(--au-primary-strong);font-weight:750}.error,.notice{margin:.75rem 0;border-radius:12px;padding:.7rem .85rem;font-size:.74rem;line-height:1.45}.error{border:1px solid #f2c9c5;background:var(--au-danger-soft);color:var(--au-danger)}.notice{border:1px solid color-mix(in srgb,var(--au-primary-strong) 18%,var(--border-default));background:var(--au-tint);color:var(--au-primary-strong)}.hint{border-left:3px solid var(--au-primary);border-radius:0 10px 10px 0;background:var(--bg-base);padding:.65rem .8rem;color:var(--text-muted);font-size:.73rem;line-height:1.5}
  @media(max-width:1050px){.editor{grid-template-columns:230px minmax(0,1fr)}.outline{position:static}}
  @media(max-width:720px){.editor{display:grid;grid-template-columns:minmax(0,1fr);gap:.85rem}.outline,.form{position:static;margin:0;padding:1rem}.form header{align-items:flex-start;flex-direction:column}.form-actions{width:100%}.form-actions button{flex:1}.preview-dialog{width:calc(100vw - 20px);max-height:calc(100dvh - 20px);border-radius:16px}.preview-dialog-shell{max-height:calc(100dvh - 20px)}.preview-dialog-header,.preview-dialog-body{padding:1rem}}
</style>
