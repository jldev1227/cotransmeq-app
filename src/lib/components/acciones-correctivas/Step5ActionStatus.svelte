<script lang="ts">
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import {
    step5Store,
    getEstadoGeneralLabel,
    causaCambioStore
  } from '$lib/stores/acciones-correctivas'
  import { authStore } from '$lib/stores/auth'
  import { accionesCorrectivasAPI } from '$lib/api/acciones-correctivas'
  import type { AccionCorrectivaPreventiva, ActionStatusGlobal } from '$lib/api/acciones-correctivas'

  export let accion: AccionCorrectivaPreventiva
  export let usuarioId: string | null = null

  $: auth = $authStore
  $: usuarioLogueadoId = usuarioId || auth.user?.id || null
  $: store = $step5Store
  $: contadorCambios = $causaCambioStore

  onMount(() => {
    if (accion) {
      step5Store.cargarEstado(accion)
    }
    return () => step5Store.reset()
  })

  // Reaccionar a cambios en causas (crear/actualizar/eliminar causa o
  // agregar seguimiento) y recalcular el estado global automáticamente.
  // El primer cambio (counter==1) se ignora porque coincide con el mount.
  let recalculoInicialHecho = false
  let recalculandoAuto = false

  $: if (accion?.id && contadorCambios > 0) {
    void contadorCambios // dependencia reactiva
    if (recalculoInicialHecho) {
      console.log('[Step5] 🔔 Cambio en causa detectado (contador=' + contadorCambios + '). Recalculando estado global automáticamente...')
      void recalcularAutomaticamente()
    } else {
      console.log('[Step5] ⏭ Primer cambio ignorado (mount inicial). contador=' + contadorCambios)
      recalculoInicialHecho = true
    }
  }

  async function recalcularAutomaticamente() {
    if (recalculandoAuto || !accion?.id) return
    recalculandoAuto = true
    const t0 = performance.now()
    try {
      console.log('[Step5] 📡 POST /calcular-estado para accion', accion.id)
      const resultado = await accionesCorrectivasAPI.calcularEstadoGlobal(accion.id)
      console.log('[Step5] ✅ Resultado del backend:', resultado)

      // Refrescar el estado local con el resultado del backend
      try {
        const data = await accionesCorrectivasAPI.obtener(accion.id)
        const causasDetalle = (data.causas || []).map((c: any) => ({
          estado_seguimiento: c.estado_seguimiento,
          evaluacion_cierre_eficaz: c.evaluacion_cierre_eficaz,
          fecha_cierre: c.fecha_cierre
        }))
        console.log('[Step5] 📊 Estado de las causas después del recálculo:', causasDetalle)
        console.log('[Step5] 📊 Estado global en BD ahora:', data.estado_global)
        accion = data
        step5Store.cargarEstado(data)
      } catch (e: any) {
        console.warn('[Step5] ⚠ No se pudo refrescar la acción:', e?.message)
      }
    } catch (e: any) {
      console.warn('[Step5] ❌ Auto-recalculo falló:', e?.message)
    } finally {
      console.log(`[Step5] ⏱ Auto-recalculo tomó ${(performance.now() - t0).toFixed(0)}ms`)
      recalculandoAuto = false
    }
  }

  let estadoSeleccionado: ActionStatusGlobal = 'EN_PROCESO'
  let observaciones = ''
  let fechaReprogramada = ''

  $: {
    estadoSeleccionado = store.estadoGlobal
    observaciones = store.observaciones
  }

  $: requiereJustificacion = estadoSeleccionado === 'REPLANTEADA'
  $: isCumplida = store.estadoGlobal === 'CUMPLIDA'

  const statusOptions: { value: ActionStatusGlobal; label: string; icon: string; desc: string; active: string; inactive: string }[] = [
    {
      value: 'EN_PROCESO',
      label: 'EN PROCESO',
      icon: '🟡',
      desc: 'Corrección y/o planes de acción en ejecución dentro del plazo establecido.',
      active: 'border-yellow-500 bg-yellow-50 shadow-sm',
      inactive: 'border-gray-200 bg-white hover:border-yellow-300'
    },
    {
      value: 'VENCIDA',
      label: 'VENCIDA',
      icon: '🔴',
      desc: 'Corrección y/o planes de acción superaron la fecha límite sin implementarse.',
      active: 'border-red-500 bg-red-50 shadow-sm',
      inactive: 'border-gray-200 bg-white hover:border-red-300'
    },
    {
      value: 'CUMPLIDA',
      label: 'CUMPLIDA',
      icon: '✅',
      desc: 'Corrección Y planes de acción implementados completamente con evidencia disponible. Habilita evaluación de eficacia.',
      active: 'border-orange-500 bg-orange-50 shadow-sm',
      inactive: 'border-gray-200 bg-white hover:border-orange-300'
    },
    {
      value: 'REPLANTEADA',
      label: 'REPLANTEADA',
      icon: '📅',
      desc: 'Se redefinió el plazo con justificación documentada para la Acción Registrada.',
      active: 'border-amber-500 bg-amber-50 shadow-sm',
      inactive: 'border-gray-200 bg-white hover:border-amber-300'
    }
  ]

  const statusColors: Record<string, string> = {
    EN_PROCESO: 'bg-yellow-50 text-yellow-700 border-yellow-300',
    VENCIDA: 'bg-red-50 text-red-700 border-red-300',
    CUMPLIDA: 'bg-orange-50 text-orange-700 border-orange-300',
    REPLANTEADA: 'bg-amber-50 text-amber-700 border-amber-300'
  }


</script>

<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm" transition:fly={{ y: 20 }}>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-lg font-semibold text-gray-900">5. Estado de la Acción</h2>
    <span class="rounded-full border px-3 py-1 text-xs font-semibold {statusColors[store.estadoGeneral as string] || 'bg-gray-100 text-gray-700 border-gray-300'}">
      {getEstadoGeneralLabel(store.estadoGlobal)}
    </span>
  </div>

  <!-- Banner informativo de aprobación -->
  <div class="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-sm text-indigo-900">
    <p class="leading-relaxed">
      El plan de acción debe estar documentado y aprobado dentro del plazo establecido. La cadena de aprobación se despliega según el tipo de hallazgo seleccionado en la <span class="font-semibold">Sección 1</span>. Priorización cuando hay múltiples hallazgos activos: <span class="font-semibold">(1) NC Mayor → (2) NC Menor → (3) Observaciones → (4) Posibilidades de Mejora</span>.
    </p>
    <p class="mt-2 text-xs italic text-indigo-700">
      Seleccione el tipo de hallazgo en la Sección 1 para ver los campos de aprobación correspondientes.
    </p>
  </div>

  <!-- Advertencia ISO 9001/14001/45001 -->
  <div class="mb-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
    <p class="font-semibold">
      <span class="mr-1">⚠</span> OBLIGATORIO (ISO 9001:10.2.1.d / ISO 14001:10.2.c / ISO 45001:10.2.f):
    </p>
    <p class="mt-1 leading-relaxed">
      El <span class="font-semibold">Estado de la Acción</span> refleja el estado global de la <span class="font-semibold">ACCIÓN REGISTRADA</span> — considera tanto la corrección como los planes de acción. Solo cuando el Estado sea <span class="font-semibold">Cumplida</span> se puede iniciar la evaluación de eficacia de la Sección 6.
    </p>
  </div>

  <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
    <div class="rounded-lg bg-gray-50 p-4">
      <p class="text-xs font-medium text-gray-500">Estado global de la acción registrada</p>
      <p class="mt-1 text-sm font-bold text-gray-900">{getEstadoGeneralLabel(store.estadoGlobal)}</p>
    </div>
    <div class="rounded-lg bg-gray-50 p-4">
      <p class="text-xs font-medium text-gray-500">Fecha de actualización del estado</p>
      <p class="mt-1 text-sm font-bold text-gray-900">{store.fechaActualizacion ? new Date(store.fechaActualizacion).toLocaleDateString('es-CO') : '—'}</p>
    </div>
    <div class="rounded-lg bg-gray-50 p-4">
      <p class="text-xs font-medium text-gray-500">Registrado por</p>
      <p class="mt-1 text-sm text-gray-900">{store.observaciones ? 'Nombre y cargo — Coordinador HSEQ / Auxiliar Administrativo HSEQ' : '—'}</p>
    </div>
  </div>

  <div class="mb-6">
    <p class="mb-3 text-sm font-medium text-gray-700">
      Estado global de la acción registrada <span class="text-red-500">*</span>
    </p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {#each statusOptions as opt}
        <button
          type="button"
          onclick={() => { estadoSeleccionado = opt.value }}
          class="rounded-lg border-2 p-3 text-left transition-all {estadoSeleccionado === opt.value ? opt.active : opt.inactive}"
        >
          <div class="flex items-center gap-2">
            <span class="text-lg leading-none">{opt.icon}</span>
            <p class="text-sm font-bold text-gray-900">{opt.label}</p>
          </div>
          <p class="mt-2 text-xs leading-snug text-gray-600">{opt.desc}</p>
        </button>
      {/each}
    </div>
  </div>

  {#if requiereJustificacion}
    <div class="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4" transition:fly={{ y: 10 }}>
      <p class="mb-3 text-sm font-semibold text-amber-900">Justificación de replanteo</p>
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-amber-800">Nueva fecha reprogramada *</label>
          <input
            type="date"
            bind:value={fechaReprogramada}
            class="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-amber-800">Justificación *</label>
          <textarea
            bind:value={observaciones}
            rows="3"
            class="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            placeholder="Detalle la situación actual de la acción registrada, avances, evidencias o justificación del estado seleccionado..."
          ></textarea>
        </div>
      </div>
    </div>
  {:else}
    <div class="mb-6">
      <label class="mb-1 block text-sm font-medium text-gray-700">
        Observaciones del estado
      </label>
      <textarea
        bind:value={observaciones}
        rows="3"
        class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
        placeholder="Detalle la situación actual de la acción registrada, avances, evidencias o justificación del estado seleccionado..."
      ></textarea>
    </div>
  {/if}



  {#if isCumplida}
    <div class="mt-4 rounded-lg border-l-4 border-orange-500 bg-orange-50 p-3 text-sm text-orange-800">
      <span class="font-semibold">✅ Acción cumplida.</span> La evaluación de eficacia (Sección 6) está habilitada.
    </div>
  {:else if store.estadoGlobal}
    <div class="mt-4 rounded-lg border-l-4 border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
      La evaluación de eficacia solo puede iniciarse cuando la Acción Registrada se encuentre en estado <span class="font-semibold">CUMPLIDA</span>.
    </div>
  {/if}

  {#if store.error}
    <div class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{store.error}</div>
  {/if}
</div>
