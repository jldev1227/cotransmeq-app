<script lang="ts">
  import { tick } from 'svelte'
  import { fade, fly, slide } from 'svelte/transition'
  import { toast } from 'svelte-sonner'
  import SignatureCanvas from '$lib/components/asistencias/SignatureCanvas.svelte'
  import SuccessAnimation from '$lib/components/asistencias/SuccessAnimation.svelte'
  import { induccionesAPI } from '$lib/api/inducciones'
  import { mascota } from '$lib/mascot';

  let isSubmitting = false
  let showSuccessAnimation = false
  let step = 1
  let scrollArea: HTMLDivElement

  type Sede = 'yopal' | 'villanueva' | 'ambas' | 'lugar_prestacion'
  let sede: Sede | '' = ''
  let fecha = new Date().toISOString()

  let visitante_nombre = ''
  let visitante_cargo = ''
  let visitante_cedula = ''
  let visitante_entidad = ''
  let visitante_firma = ''
  let observaciones = ''

  let responsable_nombre = ''
  let responsable_cargo = ''
  let responsable_cedula = ''
  let responsable_firma = ''

  let temas = {
    peligros_riesgos: false,
    normas_comportamiento: false,
    uso_epp: false,
    prohibicion_alcohol_drogas: false,
    manejo_residuos: false,
    uso_agua_energia: false,
    procedimiento_derrames: false,
    alarma_evacuacion: false,
    pasos_emergencia: false,
    numeros_emergencia: false,
    seguridad_vial: false
  }

  const sedeOpciones = [
    { value: 'yopal',            label: 'Sede Yopal',               desc: 'Calle 27 No. 16-64, Barrio Seduca' },
    { value: 'villanueva',       label: 'Sede Villanueva',           desc: 'Calle 16 No. 06-95, Barrio Bello Horizonte' },
    { value: 'ambas',            label: 'Visita a las dos Sedes',    desc: 'Yopal y Villanueva' },
    { value: 'lugar_prestacion', label: 'Lugar Prestación Servicio', desc: 'Fuera de las sedes' }
  ] as const

  const temasLabels: Record<keyof typeof temas, string> = {
    peligros_riesgos:           'Peligros y riesgos generales de las instalaciones (tráfico, locativo, químico, caídas, ruido)',
    normas_comportamiento:      'Normas básicas de comportamiento para visitantes dentro de las instalaciones',
    uso_epp:                    'Uso obligatorio de Elementos de Protección Personal (EPP) según alcance de la visita',
    prohibicion_alcohol_drogas: 'Prohibición de ingreso bajo efectos de alcohol, drogas o sustancias psicoactivas',
    manejo_residuos:            'Manejo y clasificación de residuos en puntos ecológicos',
    uso_agua_energia:           'Uso racional del agua y la energía eléctrica durante la visita',
    procedimiento_derrames:     'Procedimiento a seguir en caso de derrame de combustible u otra sustancia química',
    alarma_evacuacion:          'Señal de alarma, rutas de evacuación y punto de encuentro de la sede',
    pasos_emergencia:           'Pasos de actuación ante una emergencia',
    numeros_emergencia:         'Números de emergencia (Bomberos, Cruz Roja, Policía, contacto de la empresa, etc.)',
    seguridad_vial:             'Normas de seguridad vial si se transporta en vehículo de la empresa'
  }

  const stepsConfig = [
    { num: 1, label: 'Sede' },
    { num: 2, label: 'Visitante' },
    { num: 3, label: 'Temas' },
    { num: 4, label: 'Confirmar' }
  ]

  type Errors = {
    sede: string
    visitante_nombre: string
    visitante_cargo: string
    visitante_cedula: string
    visitante_entidad: string
    visitante_firma: string
    responsable_nombre: string
    responsable_cargo: string
    responsable_cedula: string
    responsable_firma: string
  }

  let errors: Errors = {
    sede: '',
    visitante_nombre: '',
    visitante_cargo: '',
    visitante_cedula: '',
    visitante_entidad: '',
    visitante_firma: '',
    responsable_nombre: '',
    responsable_cargo: '',
    responsable_cedula: '',
    responsable_firma: ''
  }

  $: temasKeys             = Object.keys(temas) as (keyof typeof temas)[]
  $: temasConfirmados      = temasKeys.filter(k => temas[k]).length
  $: porcentajeConformidad = Math.round((temasConfirmados / temasKeys.length) * 100)
  $: progressPct           = ((step - 1) / 3) * 100

  function validarPaso(n: number): boolean {
    let ok = true
    if (n === 1) {
      errors.sede = sede ? '' : 'Seleccione la sede que visita'
      if (!sede) ok = false
    }
    if (n === 2) {
      errors.visitante_nombre   = visitante_nombre.trim()   ? '' : 'El nombre es requerido'
      errors.visitante_cargo    = visitante_cargo.trim()    ? '' : 'El cargo es requerido'
      errors.visitante_cedula   = visitante_cedula.trim()   ? '' : 'La cédula es requerida'
      errors.visitante_entidad  = visitante_entidad.trim()  ? '' : 'La entidad/empresa es requerida'
      errors.visitante_firma    = visitante_firma.trim()    ? '' : 'La firma es requerida'
      errors.responsable_nombre = responsable_nombre.trim() ? '' : 'El nombre del responsable es requerido'
      errors.responsable_cargo  = responsable_cargo.trim()  ? '' : 'El cargo del responsable es requerido'
      errors.responsable_cedula = responsable_cedula.trim() ? '' : 'La cédula del responsable es requerida'
      errors.responsable_firma  = responsable_firma.trim()  ? '' : 'La firma del responsable es requerida'
      ok = !Object.values(errors).some(Boolean)
    }
    return ok
  }

  function scrollTop() {
    tick().then(() => scrollArea?.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  function retroceder() {
    step = Math.max(step - 1, 1)
    scrollTop()
  }

  function marcarTodos(val: boolean) {
    temasKeys.forEach(k => (temas[k] = val))
    temas = { ...temas }
  }

  async function avanzar() {
    if (!validarPaso(step)) {
      toast.error('Por favor completa todos los campos obligatorios')
      return
    }
    step = Math.min(step + 1, 4)
    scrollTop()
  }

  async function handleSubmit() {
    if (!validarPaso(2)) {
      toast.error('Por favor revisa los datos antes de enviar')
      return
    }
    isSubmitting = true
    try {
      await induccionesAPI.crear({
        sede: sede as any,
        fecha,
        visitante_nombre: visitante_nombre.trim(),
        visitante_cargo:  visitante_cargo.trim(),
        visitante_cedula: visitante_cedula.trim(),
        visitante_entidad: visitante_entidad.trim(),
        visitante_firma,
        responsable_nombre: responsable_nombre.trim(),
        responsable_cargo:  responsable_cargo.trim(),
        responsable_cedula: responsable_cedula.trim(),
        responsable_firma,
        temas_informados: temas,
        observaciones: observaciones.trim() || undefined
      })
      showSuccessAnimation = true
      setTimeout(() => {
        showSuccessAnimation = false
        step = 1; sede = ''
        visitante_nombre = visitante_cargo = visitante_cedula = visitante_entidad = visitante_firma = observaciones = ''
        responsable_nombre = responsable_cargo = responsable_cedula = responsable_firma = ''
        marcarTodos(false)
        scrollTop()
      }, 3500)
    } catch (error: any) {
      toast.error(error.message || 'Error al registrar la inducción')
    } finally {
      isSubmitting = false
    }
  }

  function formatFecha(iso: string): string {
    return new Date(iso).toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }
</script>

<svelte:head>
  <title>Inducción Visitantes – HSEQ-FR-66 | Cotransmeq</title>
</svelte:head>

<!--
  Layout mobile-first:
  - Contenedor ocupa 100dvh (dynamic viewport, cuenta con barra del browser en mobile)
  - flex-col: header fijo arriba + scroll content + footer fijo abajo
  - safe-area-inset para iPhone con notch/home bar
-->
<div class="page-root">

  <!-- ── ZONA FIJA SUPERIOR ─────────────────────────────────────────────── -->
  <div class="top-zone">
    <header class="page-intro page-card">
      <div class="intro-main">
        <div class="intro-brand">
          <img class="intro-logo intro-logo--co" src="/assets/logo.webp" alt="Logo de Cotransmeq" width="58" height="44" />
          <strong class="intro-brand-name">COTRANSMEQ S.A.S.</strong>
          <span>GESTIÓN HSEQ · VISITANTES</span>
        </div>
        <div class="intro-bottom">
          <div class="intro-copy">
            <h1>Inducción de visitantes</h1>
            <p class="intro-description">Completa la información de tu visita y confirma los temas de seguridad recibidos.</p>
          </div>
          <div class="intro-documento"><strong>HSEQ-FR-66</strong><span>{formatFecha(fecha)}</span></div>
        </div>
      </div>
      <img class="intro-mascot" src={mascota('bienvenida').src} alt={mascota('bienvenida').alt} width="108" height="108" />
    </header>

    <!-- Stepper -->
    <div class="steps-bar mx-4 mb-1.5 flex items-center justify-between rounded-xl bg-white px-3 py-2.5 border border-gray-100">
      {#each stepsConfig as s, i}
        <div class="flex flex-col items-center gap-0.5">
          <div class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300
            {step > s.num  ? 'bg-orange-500 text-white'
            : step === s.num ? 'bg-orange-600 text-white ring-4 ring-orange-100'
            : 'bg-gray-100 text-gray-400'}">
            {#if step > s.num}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            {:else}{s.num}{/if}
          </div>
          <span class="hidden text-[10px] font-medium sm:block {step === s.num ? 'text-orange-700' : 'text-gray-400'}">{s.label}</span>
        </div>
        {#if i < stepsConfig.length - 1}
          <div class="flex-1 mx-1 h-0.5 rounded transition-colors duration-500 {step > s.num ? 'bg-orange-400' : 'bg-gray-200'}"></div>
        {/if}
      {/each}
    </div>

    <!-- Progress bar -->
    <div class="progress-track mx-4 mb-2 h-1 overflow-hidden rounded-full bg-gray-200">
      <div
        class="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-500 ease-out"
        style="width: {progressPct}%"
      ></div>
    </div>
  </div>

  <!-- ── ZONA SCROLLABLE ────────────────────────────────────────────────── -->
  <div bind:this={scrollArea} class="scroll-zone">
    <div class="px-4 pb-4">
      <div class="form-card page-card">

        <!-- PASO 1: Sede -->
        {#if step === 1}
          <div class="p-5" in:fly={{ y: 10, duration: 220 }}>
            <h2 class="mb-1 text-base font-bold text-gray-900">¿Usted está en…?</h2>
            <p class="mb-4 text-sm text-gray-500">Seleccione la sede o lugar que visita hoy</p>

            {#if errors.sede}
              <p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 border border-red-100"
                in:slide={{ duration: 200 }}>{errors.sede}</p>
            {/if}

            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {#each sedeOpciones as opcion}
                <button type="button" on:click={() => { sede = opcion.value; errors.sede = '' }}
                  class="rounded-xl border-2 p-3.5 text-left transition-all duration-200
                    {sede === opcion.value
                      ? 'border-orange-500 bg-orange-50 shadow-sm'
                      : 'border-gray-200 bg-gray-50 active:bg-orange-50/40'}">
                  <div class="flex items-start gap-3">
                    <div class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all
                      {sede === opcion.value ? 'border-orange-500 bg-orange-500' : 'border-gray-300'}">
                      {#if sede === opcion.value}<div class="h-2 w-2 rounded-full bg-white"></div>{/if}
                    </div>
                    <div>
                      <p class="text-sm font-semibold {sede === opcion.value ? 'text-orange-800' : 'text-gray-800'}">{opcion.label}</p>
                      <p class="text-xs text-gray-500 mt-0.5">{opcion.desc}</p>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          </div>

        <!-- PASO 2: Visitante -->
        <!-- PASO 2: Visitante -->
        {:else if step === 2}
          <div class="p-5" in:fly={{ y: 10, duration: 220 }}>
            <h2 class="mb-1 text-base font-bold text-gray-900">Datos del Visitante</h2>
            <p class="mb-4 text-sm text-gray-500">Ingrese su información personal</p>

            <div class="space-y-3.5">
              <div>
                <label for="visitante_nombre" class="mb-1 block text-sm font-medium text-gray-700">Nombre y Apellido <span class="text-red-500">*</span></label>
                <input id="visitante_nombre" type="text" bind:value={visitante_nombre} placeholder="Ej: María González Pérez" autocomplete="name"
                  class="w-full rounded-xl border {errors.visitante_nombre ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                {#if errors.visitante_nombre}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.visitante_nombre}</p>{/if}
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="visitante_cargo" class="mb-1 block text-sm font-medium text-gray-700">Cargo <span class="text-red-500">*</span></label>
                  <input id="visitante_cargo" type="text" bind:value={visitante_cargo} placeholder="Ej: Auditor..."
                    class="w-full rounded-xl border {errors.visitante_cargo ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                  {#if errors.visitante_cargo}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.visitante_cargo}</p>{/if}
                </div>
                <div>
                  <label for="visitante_cedula" class="mb-1 block text-sm font-medium text-gray-700">C.C. <span class="text-red-500">*</span></label>
                  <input id="visitante_cedula" type="text" inputmode="numeric" bind:value={visitante_cedula} placeholder="1234567890"
                    class="w-full rounded-xl border {errors.visitante_cedula ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                  {#if errors.visitante_cedula}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.visitante_cedula}</p>{/if}
                </div>
              </div>

              <div>
                <label for="visitante_entidad" class="mb-1 block text-sm font-medium text-gray-700">Entidad / Empresa <span class="text-red-500">*</span></label>
                <input id="visitante_entidad" type="text" bind:value={visitante_entidad} placeholder="Ej: Ministerio de Transporte..."
                  class="w-full rounded-xl border {errors.visitante_entidad ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                {#if errors.visitante_entidad}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.visitante_entidad}</p>{/if}
              </div>

              <div>
                <label for="observaciones" class="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea id="observaciones" bind:value={observaciones} rows="2" placeholder="Observaciones adicionales (opcional)"
                  class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none resize-none transition-colors"></textarea>
              </div>

              <SignatureCanvas bind:value={visitante_firma} error={errors.visitante_firma} disabled={isSubmitting} />

              <div class="mt-4 border-t border-gray-100 pt-4">
                <h3 class="mb-3 text-sm font-semibold text-gray-700">Datos del Responsable HSEQ</h3>
                <div class="space-y-3.5">
                  <div>
                    <label for="responsable_nombre" class="mb-1 block text-sm font-medium text-gray-700">Nombre del Responsable <span class="text-red-500">*</span></label>
                    <input id="responsable_nombre" type="text" bind:value={responsable_nombre} placeholder="Ej: Carlos Ramírez"
                      class="w-full rounded-xl border {errors.responsable_nombre ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                    {#if errors.responsable_nombre}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.responsable_nombre}</p>{/if}
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label for="responsable_cargo" class="mb-1 block text-sm font-medium text-gray-700">Cargo <span class="text-red-500">*</span></label>
                      <input id="responsable_cargo" type="text" bind:value={responsable_cargo} placeholder="Ej: Coordinador HSEQ"
                        class="w-full rounded-xl border {errors.responsable_cargo ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                      {#if errors.responsable_cargo}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.responsable_cargo}</p>{/if}
                    </div>
                    <div>
                      <label for="responsable_cedula" class="mb-1 block text-sm font-medium text-gray-700">C.C. <span class="text-red-500">*</span></label>
                      <input id="responsable_cedula" type="text" inputmode="numeric" bind:value={responsable_cedula} placeholder="1234567890"
                        class="w-full rounded-xl border {errors.responsable_cedula ? 'border-red-300' : 'border-gray-200'} px-3 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:outline-none transition-colors" />
                      {#if errors.responsable_cedula}<p class="mt-1 text-xs text-red-500" in:slide={{ duration: 200 }}>{errors.responsable_cedula}</p>{/if}
                    </div>
                  </div>
                  <SignatureCanvas bind:value={responsable_firma} error={errors.responsable_firma} disabled={isSubmitting} />
                </div>
              </div>
            </div>
          </div>
        <!-- PASO 3: Temas -->
        {:else if step === 3}
          <div class="p-5" in:fly={{ y: 10, duration: 220 }}>
            <div class="mb-3 flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-gray-900">Temas Informados</h2>
                <p class="text-xs text-gray-500">Marque los temas explicados</p>
              </div>
              <div class="flex flex-col items-end gap-0.5">
                <span class="text-lg font-bold {porcentajeConformidad === 100 ? 'text-orange-600' : 'text-gray-700'}">
                  {porcentajeConformidad}%
                </span>
                <div class="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                  <div class="h-full rounded-full transition-all duration-500 {porcentajeConformidad === 100 ? 'bg-orange-500' : 'bg-amber-400'}"
                    style="width: {porcentajeConformidad}%"></div>
                </div>
                <span class="text-[10px] text-gray-400">{temasConfirmados}/{temasKeys.length}</span>
              </div>
            </div>

            <div class="mb-3 flex gap-2">
              <button type="button" on:click={() => marcarTodos(true)}
                class="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 active:bg-orange-100 transition-colors">
                ✓ Todos Sí
              </button>
              <button type="button" on:click={() => marcarTodos(false)}
                class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 active:bg-gray-100 transition-colors">
                Desmarcar
              </button>
            </div>

            <div class="space-y-2">
              {#each temasKeys as key, i}
                <div class="flex items-start gap-3 rounded-xl border p-3 transition-all duration-200
                  {temas[key] ? 'border-orange-200 bg-orange-50' : 'border-gray-100 bg-gray-50'}">
                  <div class="flex flex-shrink-0 gap-1.5 pt-0.5">
                    <button type="button" on:click={() => { temas[key] = true; temas = { ...temas } }}
                      class="rounded px-2 py-0.5 text-xs font-bold transition-all
                        {temas[key] ? 'bg-[var(--accion)] text-white' : 'bg-white border border-gray-200 text-gray-400'}">SÍ</button>
                    <button type="button" on:click={() => { temas[key] = false; temas = { ...temas } }}
                      class="rounded px-2 py-0.5 text-xs font-bold transition-all
                        {!temas[key] ? 'bg-gray-400 text-white' : 'bg-white border border-gray-200 text-gray-400'}">NO</button>
                  </div>
                  <span class="text-xs leading-relaxed {temas[key] ? 'text-orange-800' : 'text-gray-600'}">
                    <span class="mr-1 font-bold text-gray-300">{i + 1}.</span>{temasLabels[key]}
                  </span>
                </div>
              {/each}
            </div>
          </div>

        <!-- PASO 4: Confirmar -->
        {:else if step === 4}
          <div class="p-5" in:fly={{ y: 10, duration: 220 }}>
            <h2 class="mb-1 text-base font-bold text-gray-900">Confirmar y Registrar</h2>
            <p class="mb-3 text-sm text-gray-500">Revise la información antes de enviar</p>

            <div class="space-y-3">
              <div class="rounded-xl bg-orange-50 border border-orange-100 px-4 py-3">
                <p class="text-xs font-semibold uppercase tracking-wider text-orange-500">Sede</p>
                <p class="mt-0.5 text-sm font-semibold text-gray-800">{sedeOpciones.find(s => s.value === sede)?.label ?? sede}</p>
              </div>

              <div class="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Visitante</p>
                <div class="grid grid-cols-2 gap-1.5 text-xs">
                  <div><span class="text-gray-400">Nombre:</span> <span class="font-medium text-gray-800">{visitante_nombre}</span></div>
                  <div><span class="text-gray-400">C.C.:</span> <span class="font-medium text-gray-800">{visitante_cedula}</span></div>
                  <div><span class="text-gray-400">Cargo:</span> <span class="font-medium text-gray-800">{visitante_cargo}</span></div>
                  <div><span class="text-gray-400">Entidad:</span> <span class="font-medium text-gray-800">{visitante_entidad}</span></div>
                </div>
                {#if visitante_firma}
                  <div class="mt-2">
                    <p class="mb-1 text-xs text-gray-400">Firma</p>
                    <img src={visitante_firma} alt="Firma visitante" class="h-12 w-auto rounded border border-gray-200 bg-white" />
                  </div>
                {/if}
              </div>

              <div class="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <div class="mb-2 flex items-center justify-between">
                  <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Temas Informados</p>
                  <span class="rounded-full px-2 py-0.5 text-xs font-bold
                    {porcentajeConformidad === 100 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}">
                    {porcentajeConformidad}%
                  </span>
                </div>
                <div class="space-y-1">
                  {#each temasKeys as key}
                    <div class="flex items-start gap-2 text-xs">
                      <span class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold
                        {temas[key] ? 'bg-[var(--accion)] text-white' : 'bg-red-100 text-red-500'}">
                        {temas[key] ? '✓' : '✗'}
                      </span>
                      <span class="{temas[key] ? 'text-gray-700' : 'text-gray-400'} leading-snug">{temasLabels[key]}</span>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
                <strong>Declaro</strong> que COTRANSMEQ S.A.S. me suministró la información indicada, que la he leído y
                comprendido, y que me comprometo a cumplir las normas durante mi permanencia en sus instalaciones.
              </div>
            </div>
          </div>
        {/if}

      </div>

      <p class="py-3 text-center text-[11px] text-gray-400">COTRANSMEQ S.A.S. · HSEQ-FR-66 · Versión 1</p>
    </div>
  </div>

  <!-- ── FOOTER FIJO ─────────────────────────────────────────────────────── -->
  <div class="footer-zone">
    <div class="flex gap-3 px-4 pt-3">
      {#if step > 1}
        <button
          type="button"
          on:click={retroceder}
          disabled={isSubmitting}
          class="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Anterior
        </button>
      {:else}
        <div></div>
      {/if}

      {#if step < 4}
        <button
          type="button"
          on:click={avanzar}
          class="btn-primary flex flex-1 items-center justify-center gap-2"
        >
          Siguiente
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      {:else}
        <button
          type="button"
          on:click={handleSubmit}
          disabled={isSubmitting}
          class="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if isSubmitting}
            <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Registrando...
          {:else}
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Registrar Inducción
          {/if}
        </button>
      {/if}
    </div>
  </div>

</div>

<SuccessAnimation
  show={showSuccessAnimation}
  message="¡Inducción registrada exitosamente!"
  subtitle="El registro ha sido guardado en el sistema"
/>

<style>
  /* Usa 100dvh para que el viewport sea correcto en mobile (excluye la barra del browser) */
  .page-root {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--bg-base, #f5f7f5);
    /* Respeta el safe area del notch en la parte superior (iOS) */
    padding-top: env(safe-area-inset-top);
  }

  .top-zone { flex-shrink: 0; padding: 1rem 1rem .4rem; }
  .page-intro { display: flex; align-items: stretch; justify-content: space-between; gap: 1rem; min-height: 144px; padding: 1rem 1.2rem 0; border: 1px solid var(--border-default, #dce7e1); border-radius: 18px; background: linear-gradient(110deg, var(--bg-surface, #fff) 65%, #fff1e7); overflow: hidden; }
  .intro-main { display: flex; flex: 1; min-width: 0; flex-direction: column; justify-content: space-between; padding-bottom: 1rem; }
  .intro-brand { display: flex; align-items: center; flex-wrap: wrap; gap: .7rem; min-height: 44px; }
  .intro-logo { display: block; width: 146px; height: 36px; object-fit: contain; object-position: left center; }
  .intro-logo--co { width: 56px; }
  .intro-brand-name { color: #193b31; font-size: .85rem; font-weight: 900; letter-spacing: -.02em; }
  .intro-brand span { border-left: 1px solid var(--border-default, #dce7e1); padding-left: .7rem; color: #a34c1c; font-size: .69rem; font-weight: 800; letter-spacing: .09em; }
  .intro-bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-top: .5rem; }
  .intro-copy { min-width: 0; }
  .page-intro h1 { margin: 0; color: var(--text-primary, #17221d); font: 800 clamp(1.4rem, 2vw, 1.75rem)/1.15 var(--font-display, inherit); letter-spacing: -.025em; }
  .intro-description { margin: .35rem 0 0; color: var(--text-muted, #63756a); font-size: .85rem; }
  .intro-documento { display: flex; flex-direction: column; gap: .2rem; flex: none; text-align: right; color: #a34c1c; font-size: .78rem; }
  .intro-documento span { color: var(--text-muted, #63756a); }
  .intro-mascot { align-self: flex-end; flex: none; width: 104px; height: 104px; object-fit: contain; object-position: bottom center; }
  .form-card { overflow: hidden; border: 1px solid var(--border-default, #e5e8e5); border-radius: 18px; background: var(--bg-surface, #fff); box-shadow: 0 4px 24px rgba(40, 30, 10, .04); }
  @media (max-width: 640px) { .page-intro { position: relative; min-height: 0; padding: .8rem .9rem 0; gap: .2rem; } .intro-logo { width: 112px; height: 31px; } .intro-logo--co { width: 36px; } .intro-brand-name { font-size: .72rem; } .intro-brand { gap: .45rem; min-height: 34px; } .intro-brand span { font-size: .56rem; padding-left: .45rem; } .intro-bottom { align-items: flex-start; flex-direction: column; gap: .35rem; margin-top: .5rem; } .intro-documento { flex-direction: row; flex-wrap: wrap; gap: .5rem; text-align: left; font-size: .7rem; } .intro-description { max-width: 245px; font-size: .78rem; } .intro-main { width: 100%; padding-bottom: .85rem; } .intro-documento { padding-right: 66px; } .intro-mascot { position: absolute; right: .45rem; bottom: 0; width: 64px; height: 76px; } }

  /* El área de contenido crece para llenar el espacio disponible y es scrollable */
  .scroll-zone {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch; /* scroll suave en iOS */
    overscroll-behavior: contain;
  }

  /* El footer no crece, respeta el safe area del home indicator en iPhone */
  .footer-zone {
    flex-shrink: 0;
    background: var(--bg-surface, white);
    border-top: 1px solid var(--border-default, #e5e8e5);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.07);
    /* Safe area para el home indicator del iPhone */
    padding-bottom: 10px;
  }
	.steps-bar, .progress-track { margin-left: 0; margin-right: 0; }
  .steps-bar { margin-top: .7rem; }
  .progress-track { margin-top: .6rem; }
	.scroll-zone > div { padding: .25rem 1rem 1rem; }
</style>