<script lang="ts">
  import { onDestroy } from 'svelte';

  type Props = {
    empresa: string;
    request: (path: string, method?: string, body?: unknown) => Promise<any>;
    onCreated: (curso: any, aviso?: string) => void;
  };

  let { empresa, request, onCreated }: Props = $props();

  const modalidades = [
    ['video', 'Video', 'Clases grabadas con transcripción y subtítulos.'],
    ['audio', 'Audio', 'Lecciones y podcasts.'],
    ['lectura', 'Lectura', 'Texto, PDF o presentación.'],
    ['interactivo', 'Interactivo', 'H5P, SCORM y actividades interactivas.']
  ] as const;
  const niveles = [
    ['primaria_incompleta', 'Primaria incompleta'], ['primaria_completa', 'Primaria completa'],
    ['bachillerato_incompleto', 'Bachillerato incompleto'], ['bachillerato_completo', 'Bachillerato completo'],
    ['tecnico', 'Técnico'], ['tecnologo', 'Tecnólogo'], ['profesional', 'Profesional']
  ];
  const estandares = [['scorm12', 'SCORM 1.2'], ['scorm2004', 'SCORM 2004'], ['xapi', 'xAPI'], ['cmi5', 'cmi5']];

  let form = $state({
    codigo: '', titulo: '', slug: '', slugManual: false, descripcion: '',
    duracionHoras: 0, modalidad: 'virtual_asincronica', nivelEducativo: '', dispositivo: 'ambos',
    ventanaAccesoDias: 30, totalSesiones: 4, ventanaSesionesDias: 14, maxMinutosSesion: 60,
    pausaCadaMinutos: 30, notasPlan: '', canalesSoporte: '', mobileFirst: false, modoOffline: false,
    subtitulos: false, accesible: false, pantallaMinima: '', estandares: [] as string[],
    autenticacion: 'cuenta_interna', hintAutenticacion: '',
    modalidadesEntrega: ['video', 'audio', 'lectura'] as string[], certificado: true,
    tipoCertificado: 'normal', requiereBiometria: false, puntajeAprobacion: 80,
    intentosMaximos: 3, cooldownHoras: 24,
    vigenciaDias: 365
  });
  let creando = $state(false);
  let error = $state('');
  let portadaFile = $state<File | null>(null);
  let portadaPreview = $state('');

  onDestroy(() => { if (portadaPreview) URL.revokeObjectURL(portadaPreview); });

  function slugify(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200);
  }

  function toggle(list: string[], key: string, checked: boolean) {
    return checked ? (list.includes(key) ? list : [...list, key]) : list.filter((x) => x !== key);
  }

  function seleccionarPortada(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!permitidos.includes(file.type) || file.size > 10_000_000) {
      error = 'La portada debe ser JPG, PNG, WebP o AVIF y pesar máximo 10 MB.';
      input.value = '';
      return;
    }
    if (portadaPreview) URL.revokeObjectURL(portadaPreview);
    portadaFile = file;
    portadaPreview = URL.createObjectURL(file);
    error = '';
  }

  async function cargarPortada(curso: any, configuracion: Record<string, unknown>) {
    if (!portadaFile) return curso;
    const file = portadaFile;
    const reserva = await request('/gestion/cursos/' + curso.id + '/archivos/iniciar', 'POST', {
      nombre: file.name, tipo: 'portada', mime: file.type, tamano: file.size
    });
    if (reserva.modo === 's3') {
      const respuesta = await fetch(reserva.uploadUrl, { method: 'PUT', headers: reserva.headers, body: file });
      if (!respuesta.ok) throw new Error('El almacenamiento rechazó la portada (' + respuesta.status + ').');
      await request('/gestion/archivos/' + reserva.archivo.id + '/confirmar', 'POST');
    } else {
      const datos = new FormData();
      datos.set('archivo', file);
      await request(reserva.uploadUrl, 'POST', datos);
    }
    return request('/gestion/cursos/' + curso.id, 'PUT', {
      codigo: form.codigo.trim().toUpperCase(), titulo: form.titulo.trim(), slug: form.slug,
      descripcion: form.descripcion.trim(), duracionHoras: Number(form.duracionHoras) || 0,
      estado: 'borrador', requiereBiometria: form.requiereBiometria,
      puntajeAprobacion: Number(form.puntajeAprobacion),
      vigenciaDias: form.certificado ? Number(form.vigenciaDias) || null : null,
      configuracion: { ...configuracion, portadaArchivoId: reserva.archivo.id }
    });
  }

  function validar() {
    if (!/^[A-Z0-9_-]{2,50}$/.test(form.codigo.trim().toUpperCase())) return 'El código interno debe tener entre 2 y 50 caracteres: letras, números, guion o guion bajo.';
    if (form.titulo.trim().length < 3) return 'Escribe un título de al menos 3 caracteres.';
    if (form.descripcion.trim().length < 10) return 'La descripción debe tener al menos 10 caracteres.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) return 'El slug debe usar minúsculas, números y guiones.';
    if (!form.modalidadesEntrega.length) return 'Selecciona al menos una modalidad de entrega.';
    if (form.puntajeAprobacion < 1 || form.puntajeAprobacion > 100) return 'El puntaje de aprobación debe estar entre 1 y 100.';
    return '';
  }

  async function crear(event: SubmitEvent) {
    event.preventDefault();
    error = validar();
    if (error || creando) return;
    creando = true;
    try {
      const configuracion = {
        version: 1,
        pedagogia: {
          modalidad: form.modalidad, nivelEducativoMinimo: form.nivelEducativo || null,
          dispositivoPrioritario: form.dispositivo, ventanaAccesoDias: form.ventanaAccesoDias || null,
          planSesiones: { total: form.totalSesiones, ventanaDias: form.ventanaSesionesDias,
            maxMinutosSesion: form.maxMinutosSesion, pausaCadaMinutos: form.pausaCadaMinutos,
            notas: form.notasPlan.trim() || null },
          canalesSoporte: form.canalesSoporte.split('\n').map((x) => x.trim()).filter(Boolean),
          requisitosTecnicos: { mobileFirst: form.mobileFirst, modoOffline: form.modoOffline,
            subtitulos: form.subtitulos, accesibilidad: form.accesible,
            pantallaMinima: form.pantallaMinima.trim() || null, estandares: form.estandares }
        },
        autenticacion: { tipo: form.autenticacion, instrucciones: form.hintAutenticacion.trim() || null },
        entrega: { modalidades: form.modalidadesEntrega, ordenPreferido: form.modalidadesEntrega },
        certificacion: { activa: form.certificado, tipo: form.tipoCertificado,
          vigenciaDias: form.vigenciaDias || null },
        evaluacion: { engine: 'interno', puntajeAprobacion: form.puntajeAprobacion,
          intentosMaximos: form.intentosMaximos || null, cooldownHoras: form.cooldownHoras || null }
      };
      let curso = await request('/gestion/cursos', 'POST', {
        codigo: form.codigo.trim().toUpperCase(), titulo: form.titulo.trim(), slug: form.slug,
        descripcion: form.descripcion.trim(),
        duracionHoras: Number(form.duracionHoras) || 0, estado: 'borrador',
        requiereBiometria: form.requiereBiometria,
        puntajeAprobacion: Number(form.puntajeAprobacion), vigenciaDias: form.certificado ? Number(form.vigenciaDias) || null : null,
        configuracion
      });
      let aviso: string | undefined;
      if (portadaFile) {
        try { curso = await cargarPortada(curso, configuracion); }
        catch (cause: any) { aviso = 'El borrador se creó, pero no se pudo cargar la portada: ' + (cause?.message ?? 'intenta subirla nuevamente.'); }
      }
      onCreated(curso, aviso);
    } catch (cause: any) {
      error = cause?.response?.data?.message ?? cause?.message ?? 'No se pudo crear la capacitación.';
    } finally { creando = false; }
  }
</script>

<form class="course-form" onsubmit={(event) => void crear(event)}>
  <div class="form-main">
    <section class="panel" aria-labelledby="course-identity-title">
      <header><div><p class="eyebrow">Nueva capacitación · {empresa}</p><h2 id="course-identity-title">Identidad del curso</h2>
        <p>Información que verá el personal en su catálogo de formación interna.</p></div><span class="draft">Borrador</span></header>
      <div class="fields">
        <label>Código interno <input bind:value={form.codigo} placeholder="PESV-MDP" maxlength="50" autocomplete="off" />
          <small>Único en la empresa. Usa letras, números, guiones o guion bajo.</small></label>
        <label>Duración estimada (horas) <input type="number" min="0" max="10000" bind:value={form.duracionHoras} /></label>
        <label class="wide">Título <input bind:value={form.titulo} oninput={() => { if (!form.slugManual) form.slug = slugify(form.titulo); }} placeholder="Manejo defensivo y preventivo" maxlength="180" /></label>
        <label class="wide">Identificador interno <input bind:value={form.slug} oninput={() => form.slugManual = true} placeholder="manejo-defensivo" maxlength="200" />
          <small>Se genera a partir del título. Se usa en las rutas internas del curso.</small></label>
        <label class="wide">Descripción <textarea bind:value={form.descripcion} rows="4" maxlength="2000" placeholder="Explica qué aprenderá el personal y a quién está dirigido."></textarea>
          <small>{form.descripcion.length} / 2000 · mínimo 10 caracteres</small></label>
        <div class="wide upload-field"><span class="field-label">Portada del curso</span>
          <label class="upload-control" for="cap-course-cover"><input id="cap-course-cover" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onchange={seleccionarPortada} />
            <strong>{portadaFile ? 'Cambiar portada' : 'Subir portada'}</strong><small>{portadaFile ? `${portadaFile.name} · ${(portadaFile.size / 1_000_000).toFixed(1)} MB` : 'JPG, PNG, WebP o AVIF · máximo 10 MB'}</small></label>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="pedagogy-title">
      <header><div><p class="eyebrow">Gobernanza pedagógica</p><h2 id="pedagogy-title">Información pedagógica</h2>
        <p>Define cómo se imparte, para quién está escrito y las condiciones recomendadas de acceso.</p></div></header>
      <div class="fields">
        <label>Modalidad pedagógica <select bind:value={form.modalidad}>
          <option value="virtual_asincronica">Virtual asincrónica (autogestionada)</option><option value="virtual_vivo">Virtual con instructor en vivo</option>
          <option value="mixto">Mixto (virtual + presencial)</option><option value="presencial">Presencial</option><option value="hibrido">Híbrido (el alumno elige)</option>
        </select></label>
        <label>Nivel educativo mínimo <select bind:value={form.nivelEducativo}><option value="">Sin requisito informativo</option>{#each niveles as [value, label]}<option {value}>{label}</option>{/each}</select>
          <small>Orientativo; no bloquea el acceso del personal.</small></label>
        <label>Dispositivo prioritario <select bind:value={form.dispositivo}><option value="ambos">Mismo peso móvil y escritorio</option><option value="mobile_first">Celular prioritario</option><option value="desktop_first">Computador prioritario</option></select></label>
        <label>Ventana de acceso (días) <input type="number" min="0" max="3650" bind:value={form.ventanaAccesoDias} /><small>0 = sin límite.</small></label>
      </div>
      <h3>Plan de sesiones sugerido</h3>
      <div class="fields four">
        <label>Total de sesiones <input type="number" min="1" max="100" bind:value={form.totalSesiones} /></label>
        <label>Ventana (días) <input type="number" min="1" max="365" bind:value={form.ventanaSesionesDias} /></label>
        <label>Máximo min/sesión <input type="number" min="1" max="600" bind:value={form.maxMinutosSesion} /></label>
        <label>Pausa cada (min) <input type="number" min="0" max="180" bind:value={form.pausaCadaMinutos} /></label>
        <label class="wide">Notas del plan <textarea bind:value={form.notasPlan} rows="2" placeholder="Recomendaciones para el alumno"></textarea></label>
      </div>
      <div class="fields">
        <label class="wide">Canales de soporte <textarea bind:value={form.canalesSoporte} rows="2" placeholder="Un canal por línea: correo, WhatsApp, mesa de ayuda…"></textarea></label>
        <label>Tamaño mínimo de pantalla <input bind:value={form.pantallaMinima} placeholder="320 px" /></label>
        <label>Acceso del alumno <input value="Cuenta de {empresa}" readonly /></label>
        <label class="wide">Instrucciones de acceso <textarea bind:value={form.hintAutenticacion} rows="2" placeholder="Indicaciones para iniciar el curso"></textarea></label>
      </div>
      <h3>Requisitos técnicos</h3>
      <div class="checks">
        <label><input type="checkbox" bind:checked={form.mobileFirst} /> Mobile-first real</label>
        <label><input type="checkbox" bind:checked={form.modoOffline} /> Modo sin conexión</label>
        <label><input type="checkbox" bind:checked={form.subtitulos} /> Subtítulos accesibles</label>
        <label><input type="checkbox" bind:checked={form.accesible} /> Controles accesibles WCAG</label>
        {#each estandares as [value, label]}
          <label><input type="checkbox" checked={form.estandares.includes(value)} onchange={(event) => form.estandares = toggle(form.estandares, value, event.currentTarget.checked)} /> {label}</label>
        {/each}
      </div>
    </section>

    <section class="panel" aria-labelledby="delivery-title">
      <header><div><p class="eyebrow">Entrega y certificación</p><h2 id="delivery-title">Modalidades de entrega</h2>
        <p>El personal podrá elegir entre los formatos habilitados en cada lección.</p></div></header>
      <div class="delivery-grid">
        {#each modalidades as [value, label, help]}
          <label class="choice" class:selected={form.modalidadesEntrega.includes(value)}><input type="checkbox" checked={form.modalidadesEntrega.includes(value)} onchange={(event) => form.modalidadesEntrega = toggle(form.modalidadesEntrega, value, event.currentTarget.checked)} />
            <span><strong>{label}</strong><small>{help}</small></span></label>
        {/each}
      </div>
      <h3>Certificación y evaluación</h3>
      <div class="checks">
        <label><input type="checkbox" bind:checked={form.certificado} /> Emitir certificado al completar el curso</label>
        <label><input type="checkbox" bind:checked={form.requiereBiometria} /> Verificación facial antes de evaluar</label>
      </div>
      <div class="fields four">
        <label>Tipo de certificado <select bind:value={form.tipoCertificado} disabled={!form.certificado}><option value="normal">Certificación plena</option><option value="asistencia">Certificado de asistencia</option></select></label>
        <label>Vigencia (días) <input type="number" min="1" max="3650" bind:value={form.vigenciaDias} disabled={!form.certificado} /></label>
        <label>Puntaje mínimo (%) <input type="number" min="1" max="100" bind:value={form.puntajeAprobacion} /></label>
        <label>Intentos máximos <input type="number" min="0" max="100" bind:value={form.intentosMaximos} /><small>0 = ilimitados.</small></label>
        <label>Espera entre intentos fallidos (h) <input type="number" min="0" max="720" bind:value={form.cooldownHoras} /></label>
        <label>Engine de evaluación <input value="Banco interno" readonly /><small>El banco de preguntas se configura después de guardar.</small></label>
      </div>
    </section>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer><p>Se guardará como borrador. Agrega módulos, lecciones y preguntas en el siguiente paso para habilitar la publicación.</p>
      <button class="primary" type="submit" disabled={creando}>{creando ? 'Creando…' : 'Crear borrador y continuar'}</button></footer>
  </div>

  <aside class="preview" aria-label="Vista previa del curso">
    <div class="preview-head"><p class="eyebrow">Vista previa</p><h2>Así lo verá el personal</h2><span>Solo personal de {empresa}</span></div>
    {#if portadaPreview}<img class="cover" src={portadaPreview} alt="Vista previa de la portada seleccionada" />{:else}<div class="cover-placeholder">{empresa}</div>{/if}
    <div class="preview-body"><span class="code">{form.codigo.trim().toUpperCase() || 'CÓDIGO DEL CURSO'}</span>
      <h3>{form.titulo.trim() || 'Nombre de la capacitación'}</h3>
      <p>{form.descripcion.trim() || 'La descripción del curso aparecerá aquí.'}</p>
      <div class="preview-meta"><span>{form.duracionHoras || 0} h</span><span>{form.modalidadesEntrega.length} formatos</span></div>
      <hr /><strong>Modalidad</strong><p>{form.modalidad.replaceAll('_', ' ')}</p>
      <strong>Certificación</strong><p>{form.certificado ? (form.tipoCertificado === 'normal' ? 'Plena' : 'Asistencia') : 'Sin certificado'}</p>
      <strong>Evaluación</strong><p>{form.puntajeAprobacion}% para aprobar · {form.intentosMaximos || '∞'} intentos</p>
      {#if form.requiereBiometria}<span class="badge">Verificación facial activa</span>{/if}
    </div>
    <div class="preview-note">Módulos, archivos y preguntas se agregan después de crear el borrador.</div>
  </aside>
</form>

<style>
  .course-form{display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;gap:1.25rem;color:var(--text-primary)}
  .form-main{display:grid;min-width:0;gap:1rem}.panel,.preview{min-width:0;overflow:hidden;border:1px solid var(--border-subtle);border-radius:20px;background:var(--bg-surface);box-shadow:var(--shadow-card)}
  .panel{padding:1.35rem 1.5rem}.panel header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.1rem;border-bottom:1px solid var(--border-subtle);padding-bottom:1rem}
  .panel header>div{display:grid;gap:.25rem;min-width:0}.panel h2{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1.1rem;font-weight:800;letter-spacing:-.02em;line-height:1.25}.panel header p:not(.eyebrow){margin:0;color:var(--text-muted);font-size:.78rem;line-height:1.5}
  h3{margin:1.35rem 0 .7rem;color:var(--text-primary);font-family:var(--font-display);font-size:.9rem;font-weight:800;letter-spacing:-.01em}.eyebrow{margin:0;color:var(--au-primary-strong);font-size:.64rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}
  .draft,.badge{display:inline-flex;flex:none;align-items:center;border:1px solid color-mix(in srgb,var(--au-primary-strong) 18%,var(--border-default));border-radius:999px;background:var(--au-tint);padding:.35rem .65rem;color:var(--au-primary-strong);font-size:.68rem;font-weight:800;white-space:nowrap}
  .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem 1.1rem}.fields.four{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:1rem}
  label{display:flex;min-width:0;flex-direction:column;gap:.4rem;color:var(--text-secondary);font-size:.75rem;font-weight:750;line-height:1.4}.wide{grid-column:1/-1}.field-label{color:var(--text-secondary);font-size:.75rem;font-weight:750}
  input:not([type=checkbox]),textarea,select{width:100%;min-width:0;min-height:44px;box-sizing:border-box;margin:0;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-surface);padding:.65rem .8rem;color:var(--text-primary);font:inherit;font-size:.8rem;font-weight:500;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
  textarea{min-height:100px;resize:vertical;line-height:1.55}input::placeholder,textarea::placeholder{color:var(--text-very-muted);font-weight:450}input:focus-visible,textarea:focus-visible,select:focus-visible{outline:0;border-color:var(--au-primary);box-shadow:0 0 0 3px rgba(var(--au-primary-rgb),.13)}input:disabled,select:disabled{background:var(--bg-base);color:var(--text-muted)}
  small{color:var(--text-muted);font-size:.68rem;font-weight:500;line-height:1.45}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:.7rem 0 1rem}
  .checks label{display:flex;min-height:42px;flex-direction:row;align-items:center;gap:.6rem;margin:0;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-surface);padding:.65rem .75rem;color:var(--text-secondary);font-size:.72rem;font-weight:650;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}.checks label:has(input:checked){border-color:color-mix(in srgb,var(--au-primary-strong) 28%,var(--border-default));background:var(--au-tint)}.checks input,.choice input{width:17px;height:17px;flex:none;margin:0;accent-color:var(--au-primary-strong)}
  .delivery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.choice{display:flex;min-width:0;align-items:flex-start;gap:.65rem;margin:0;border:1px solid var(--border-default);border-radius:14px;background:var(--bg-surface);padding:.85rem;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}.choice.selected{border-color:color-mix(in srgb,var(--au-primary-strong) 30%,var(--border-default));background:var(--au-tint);box-shadow:0 1px 2px rgba(1,67,57,.05)}
  .upload-field{display:grid;gap:.45rem}.upload-control{position:relative;display:grid;grid-template-columns:1fr;gap:.25rem;margin:0;border:1px dashed var(--border-emphasis);border-radius:14px;background:var(--bg-base);padding:.9rem 1rem;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}.upload-control:hover,.upload-control:focus-within{border-color:var(--au-primary);background:var(--au-tint)}.upload-control input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.upload-control strong{color:var(--au-primary-strong);font-size:.78rem}.upload-control small{display:block}.choice span{display:grid;min-width:0;gap:.25rem}.choice strong{color:var(--text-primary);font-size:.75rem}.choice small{font-size:.68rem}
  footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;border:1px solid var(--border-subtle);border-radius:16px;background:var(--bg-surface);padding:1rem 1.1rem;box-shadow:var(--shadow-card)}
  footer p{max-width:55ch;margin:0;color:var(--text-muted);font-size:.74rem;line-height:1.5}button{min-height:42px;border:1px solid transparent;border-radius:11px;padding:.65rem .9rem;font:inherit;font-size:.76rem;font-weight:750;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease,transform .15s ease}
  button:focus-visible{outline:2px solid var(--au-primary);outline-offset:2px}button:disabled{opacity:.55;cursor:not-allowed}.primary{border-color:var(--au-primary);background:var(--au-primary);box-shadow:0 2px 6px rgba(1,67,57,.12);color:#fff;white-space:nowrap}.primary:hover:not(:disabled){border-color:var(--au-primary-strong);background:var(--au-primary-strong);box-shadow:0 5px 12px rgba(1,67,57,.14);transform:translateY(-1px)}
  .error{margin:0;border:1px solid #f2c9c5;border-radius:12px;background:var(--au-danger-soft);padding:.8rem .95rem;color:var(--au-danger);font-size:.8rem}.preview{position:sticky;top:1rem}
  .preview-head{display:grid;gap:.3rem;background:linear-gradient(135deg,var(--au-tint),var(--bg-surface));padding:1.1rem 1.1rem .8rem}.preview-head h2{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1rem;font-weight:800;line-height:1.25}.preview-head span{color:var(--text-muted);font-size:.7rem}
  .cover,.cover-placeholder{display:flex;width:100%;aspect-ratio:16/9;min-height:145px;align-items:center;justify-content:center;object-fit:cover;background:linear-gradient(135deg,var(--au-tint),var(--bg-base));color:var(--au-primary-strong);font-family:var(--font-display);font-size:1.15rem;font-weight:850;letter-spacing:-.02em}
  .preview-body{display:grid;gap:.35rem;padding:1rem 1.1rem}.code{color:var(--au-primary-strong);font-size:.62rem;font-weight:850;letter-spacing:.1em}.preview-body h3{margin:.15rem 0;color:var(--text-primary);font-family:var(--font-display);font-size:1.12rem;font-weight:850;line-height:1.25}.preview-body p{margin:0;color:var(--text-muted);font-size:.73rem;line-height:1.5}.preview-meta{display:flex;flex-wrap:wrap;gap:.4rem;margin:.35rem 0}.preview-meta span{border:1px solid var(--border-subtle);border-radius:999px;background:var(--bg-base);padding:.3rem .55rem;color:var(--text-secondary);font-size:.65rem;font-weight:700}
  .preview-body strong{margin-top:.35rem;color:var(--text-secondary);font-size:.67rem;font-weight:800}.preview-body hr{width:100%;border:0;border-top:1px solid var(--border-subtle);margin:.4rem 0}.preview-note{border-top:1px solid var(--border-subtle);background:var(--bg-base);padding:.8rem 1.1rem;color:var(--text-muted);font-size:.66rem;line-height:1.45}
  @media(max-width:1120px){.course-form{grid-template-columns:minmax(0,1fr)}.preview{position:static;display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,.65fr);align-items:start}.preview-head{grid-column:1/-1}.cover,.cover-placeholder{grid-row:2;min-height:100%;height:100%;aspect-ratio:auto}.preview-body{grid-row:2}.preview-note{grid-column:1/-1}.fields.four{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){.course-form{grid-template-columns:minmax(0,1fr);gap:.85rem}.panel{padding:1rem}.panel header{gap:.65rem}.panel h2{font-size:1rem}.fields,.fields.four,.checks,.delivery-grid{grid-template-columns:minmax(0,1fr)}.wide{grid-column:auto}.preview{display:block}.cover,.cover-placeholder{aspect-ratio:16/9;height:auto;min-height:150px}footer{align-items:stretch;flex-direction:column}.primary{width:100%}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
</style>
