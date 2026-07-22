<script lang="ts">
  import { onMount } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import { toast } from 'svelte-sonner'
  import {
    step4Store,
    mapTipoHallazgoToEnum,
    getEstadoGeneralLabel,
    approvalFlowMap,
    usuarioPuedeAprobar
  } from '$lib/stores/acciones-correctivas'
  import { authStore } from '$lib/stores/auth'
  import type { AccionCorrectivaPreventiva } from '$lib/api/acciones-correctivas'

  export let accion: AccionCorrectivaPreventiva
  export let tipoHallazgoDetectado: string | undefined | null = ''

  let comentario = ''
  let cargandoInicial = true

  $: auth = $authStore
  $: usuarioLogueado = auth.user
  $: store = $step4Store
  $: hallazgoEnum = mapTipoHallazgoToEnum(tipoHallazgoDetectado || accion?.tipo_hallazgo_detectado)
  $: rolEsperado = hallazgoEnum ? approvalFlowMap[hallazgoEnum]?.[0] || null : null

  onMount(() => {
    if (accion?.id) {
      cargandoInicial = true
      step4Store.cargarAprobaciones(accion.id).finally(() => {
        cargandoInicial = false
      })
    } else {
      cargandoInicial = false
    }
    return () => step4Store.reset()
  })

  function getRolLabel(rol: string): string {
    const labels: Record<string, string> = {
      Gerencia: 'Gerencia',
      CoordinadorHSEQ: 'Coordinador HSEQ',
    }
    return labels[rol] || rol
  }

  function getRolIcon(rol: string): string {
    const icons: Record<string, string> = {
      Gerencia: '👔',
      CoordinadorHSEQ: '🛡️',
    }
    return icons[rol] || '👤'
  }

  $: usuarioPuedeAprobarEste = !!(usuarioLogueado && rolEsperado
    && usuarioPuedeAprobar(rolEsperado, usuarioLogueado.cargo))

  $: yaAprobado = store.approval?.estado === 'APROBADO'
  $: yaRechazado = store.approval?.estado === 'RECHAZADO'

  async function aprobar() {
    try {
      await step4Store.aprobar(accion.id, comentario.trim() || undefined)
      toast.success('Aprobación registrada')
      comentario = ''
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function rechazar() {
    if (!comentario.trim()) {
      toast.warning('Debe ingresar un comentario para rechazar')
      return
    }
    try {
      await step4Store.rechazar(accion.id, comentario.trim())
      toast.success('Rechazo registrado')
      comentario = ''
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  $: estadoGeneralColor = (() => {
    const colors: Record<string, string> = {
      PENDIENTE: 'bg-gray-100 text-gray-700 border-gray-300',
      EN_REVISION: 'bg-amber-50 text-amber-700 border-amber-300',
      APROBADO: 'bg-orange-50 text-orange-700 border-orange-300',
      RECHAZADO: 'bg-red-50 text-red-700 border-red-300'
    }
    return colors[store.estadoGeneral] || colors.PENDIENTE
  })()
</script>

<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm" transition:fly={{ y: 20 }}>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-lg font-semibold text-gray-900">4. Aprobación del Plan de Acción</h2>
    <span class="rounded-full border px-3 py-1 text-xs font-semibold {estadoGeneralColor}">
      {getEstadoGeneralLabel(store.estadoGeneral)}
    </span>
  </div>

  {#if !hallazgoEnum}
    <div class="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
      Seleccione el tipo de hallazgo para habilitar la aprobación.
    </div>
  {:else if cargandoInicial || store.loading}
    <div class="flex items-center justify-center py-8 text-sm text-gray-500">
      Cargando información de aprobación...
    </div>
  {:else}
    <div class="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4" transition:slide>
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-full text-lg
          {yaAprobado ? 'bg-orange-100' : yaRechazado ? 'bg-red-100' : 'bg-indigo-100'}">
          {yaAprobado ? '✓' : yaRechazado ? '✗' : getRolIcon(rolEsperado || '')}
        </div>
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold text-gray-900">
              Aprobación por {rolEsperado ? getRolLabel(rolEsperado) : '—'}
            </span>
            <span class="text-xs font-medium
              {yaAprobado ? 'text-orange-600' : yaRechazado ? 'text-red-600' : 'text-indigo-600'}">
              {yaAprobado ? 'Aprobado' : yaRechazado ? 'Rechazado' : 'Pendiente'}
            </span>
          </div>

          <p class="mt-1 text-xs text-gray-600">
            Tipo de hallazgo: <span class="font-medium">{hallazgoEnum}</span>.
            Aprobador único: <span class="font-medium">{rolEsperado ? getRolLabel(rolEsperado) : '—'}</span>.
          </p>

          {#if store.approval?.aprobador}
            <p class="mt-1 text-xs text-gray-700">
              <span class="font-medium">{store.approval.aprobador.nombre}</span>
              {#if store.approval.aprobador.cargo}— {store.approval.aprobador.cargo}{/if}
            </p>
          {/if}

          {#if store.approval?.fecha}
            <p class="text-xs text-gray-400">
              {new Date(store.approval.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          {/if}

          {#if store.approval?.comentario}
            <p class="mt-2 text-xs italic text-gray-700">"{store.approval.comentario}"</p>
          {/if}

          {#if yaAprobado || yaRechazado}
            <p class="mt-3 rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600">
              Esta acción ya fue {yaAprobado ? 'aprobada' : 'rechazada'}. Para modificarla, contacte al administrador.
            </p>
          {:else if !usuarioLogueado}
            <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" transition:slide>
              <span class="font-semibold">Inicie sesión</span> para registrar una aprobación.
            </div>
          {:else if !usuarioPuedeAprobarEste}
            <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" transition:slide>
              <p class="font-semibold">
                Solo usuarios con cargo de {rolEsperado ? getRolLabel(rolEsperado) : '—'} pueden aprobar esta acción.
              </p>
              <p class="mt-1">
                Su cargo actual: <span class="font-medium">{usuarioLogueado.cargo || 'sin cargo'}</span>.
              </p>
            </div>
          {:else}
            <div class="mt-3 space-y-2" transition:slide>
              <textarea
                bind:value={comentario}
                placeholder="Comentario (opcional para aprobar, requerido para rechazar)"
                rows="2"
                class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
              ></textarea>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={aprobar}
                  disabled={store.loading}
                  class="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                >
                  Aprobar
                </button>
                <button
                  type="button"
                  onclick={rechazar}
                  disabled={store.loading}
                  class="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if store.error}
    <div class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{store.error}</div>
  {/if}
</div>
