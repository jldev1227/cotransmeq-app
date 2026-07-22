import { writable, derived } from 'svelte/store'
import { accionesCorrectivasAPI, type AprobacionAccion, type ActionStatusGlobal, type HallazgoTipo } from '$lib/api/acciones-correctivas'

export type ApprovalEstadoGeneral = 'PENDIENTE' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO'

// Event bus: contador de cambios en causas (crear/actualizar/eliminar)
// Step5 se suscribe para recalcular el estado global automáticamente
export const causaCambioStore = writable(0)

export function notificarCambioCausa() {
  causaCambioStore.update(n => n + 1)
}

export interface Step4State {
  loading: boolean
  error: string | null
  hallazgoTipo: string | null
  estadoGeneral: ApprovalEstadoGeneral
  rolEsperado: string | null
  approval: AprobacionAccion | null
}

export interface Step5State {
  loading: boolean
  error: string | null
  estadoGlobal: ActionStatusGlobal
  fechaActualizacion: string
  registradoPorId: string | null
  observaciones: string
}

const initialStep4: Step4State = {
  loading: false,
  error: null,
  hallazgoTipo: null,
  estadoGeneral: 'PENDIENTE',
  rolEsperado: null,
  approval: null
}

const initialStep5: Step5State = {
  loading: false,
  error: null,
  estadoGlobal: 'EN_PROCESO',
  fechaActualizacion: '',
  registradoPorId: null,
  observaciones: ''
}

function createStep4Store() {
  const { subscribe, set, update } = writable<Step4State>(initialStep4)

  async function cargarAprobaciones(accionId: string) {
    update(s => ({ ...s, loading: true, error: null }))
    try {
      const data = await accionesCorrectivasAPI.obtenerAprobaciones(accionId)
      update(s => ({
        ...s,
        loading: false,
        hallazgoTipo: data.hallazgoTipo?.hallazgo_tipo || null,
        estadoGeneral: (data.hallazgoTipo?.estado_aprobacion as ApprovalEstadoGeneral) || 'PENDIENTE',
        rolEsperado: data.rolEsperado,
        approval: data.approval
      }))
    } catch (e: any) {
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  async function aprobar(accionId: string, comentario?: string) {
    update(s => ({ ...s, loading: true, error: null }))
    try {
      const updated = await accionesCorrectivasAPI.aprobar(accionId, comentario)
      update(s => ({
        ...s,
        loading: false,
        approval: updated,
        estadoGeneral: 'APROBADO'
      }))
    } catch (e: any) {
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  async function rechazar(accionId: string, comentario: string) {
    update(s => ({ ...s, loading: true, error: null }))
    try {
      const updated = await accionesCorrectivasAPI.rechazar(accionId, comentario)
      update(s => ({
        ...s,
        loading: false,
        approval: updated,
        estadoGeneral: 'RECHAZADO'
      }))
    } catch (e: any) {
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  async function resetAprobacion(accionId: string) {
    update(s => ({ ...s, loading: true, error: null }))
    try {
      await accionesCorrectivasAPI.resetAprobacion(accionId)
      update(s => ({ ...s, loading: false, approval: null, estadoGeneral: 'PENDIENTE' }))
    } catch (e: any) {
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  function reset() {
    set(initialStep4)
  }

  return { subscribe, cargarAprobaciones, aprobar, rechazar, resetAprobacion, reset }
}

function createStep5Store() {
  const { subscribe, set, update } = writable<Step5State>(initialStep5)

  async function cargarEstado(accion: { estado_global?: string; fecha_actualizacion_estado?: string; registrado_por_id?: string; observaciones?: string }) {
    update(s => ({
      ...s,
      estadoGlobal: (accion.estado_global as ActionStatusGlobal) || 'EN_PROCESO',
      fechaActualizacion: accion.fecha_actualizacion_estado?.split('T')[0] || '',
      registradoPorId: accion.registrado_por_id || null,
      observaciones: accion.observaciones || ''
    }))
  }

  async function calcularEstado(accionId: string) {
    console.log('[step5Store] calcularEstado inicio', { accionId })
    update(s => ({ ...s, loading: true, error: null }))
    try {
      const resultado = await accionesCorrectivasAPI.calcularEstadoGlobal(accionId)
      console.log('[step5Store] calcularEstado respuesta del backend:', resultado)
      update(s => ({
        ...s,
        loading: false,
        estadoGlobal: resultado.estado_nuevo as ActionStatusGlobal,
        fechaActualizacion: new Date().toISOString().split('T')[0]
      }))
      console.log('[step5Store] calcularEstado store actualizado. estadoGlobal =', resultado.estado_nuevo)
    } catch (e: any) {
      console.error('[step5Store] calcularEstado error:', e)
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  async function actualizarEstado(accionId: string, data: {
    estado_global: ActionStatusGlobal
    registrado_por_id?: string
    observaciones?: string
  }) {
    update(s => ({ ...s, loading: true, error: null }))
    try {
      await accionesCorrectivasAPI.actualizarEstadoGlobal(accionId, data)
      update(s => ({
        ...s,
        loading: false,
        estadoGlobal: data.estado_global,
        fechaActualizacion: new Date().toISOString().split('T')[0],
        registradoPorId: data.registrado_por_id || null,
        observaciones: data.observaciones || ''
      }))
    } catch (e: any) {
      update(s => ({ ...s, loading: false, error: e.message }))
    }
  }

  function reset() {
    set(initialStep5)
  }

  return { subscribe, cargarEstado, calcularEstado, actualizarEstado, reset }
}

export const step4Store = createStep4Store()
export const step5Store = createStep5Store()

export const approvalFlowMap: Record<string, string[]> = {
  NC_MAYOR: ['Gerencia'],
  NC_MENOR: ['CoordinadorHSEQ'],
  OBSERVACION: ['CoordinadorHSEQ'],
  MEJORA: ['CoordinadorHSEQ']
}

const tipoHallazgoToEnum: Record<string, HallazgoTipo> = {
  'NC Mayor': 'NC_MAYOR',
  'NC Menor': 'NC_MENOR',
  'Observación': 'OBSERVACION',
  'Oportunidad de Mejora': 'MEJORA',
  'No conformidad mayor': 'NC_MAYOR',
  'No conformidad menor': 'NC_MENOR',
  'NC. MAYOR': 'NC_MAYOR',
  'NC. MENOR': 'NC_MENOR',
  'OBSERVACIÓN': 'OBSERVACION',
  'POSIBILIDAD DE MEJORA': 'MEJORA',
  'NC MAYOR': 'NC_MAYOR',
  'NC MENOR': 'NC_MENOR',
  'Observacion': 'OBSERVACION',
  'Oportunidad de mejora': 'MEJORA',
  'Hallazgo positivo': 'MEJORA'
}

function normalizarClave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.\s]+/g, ' ')
    .trim()
}

const tipoHallazgoNormalizado: Record<string, HallazgoTipo> = Object.entries(
  tipoHallazgoToEnum
).reduce<Record<string, HallazgoTipo>>((acc, [k, v]) => {
  acc[normalizarClave(k)] = v
  return acc
}, {})

export function mapTipoHallazgoToEnum(tipo: string | undefined | null): HallazgoTipo | null {
  if (!tipo) return null
  const direct = tipoHallazgoToEnum[tipo.trim()]
  if (direct) return direct
  return tipoHallazgoNormalizado[normalizarClave(tipo)] || null
}

export function getEstadoGeneralLabel(estado: string): string {
  const labels: Record<string, string> = {
    PENDIENTE: 'Pendiente',
    EN_REVISION: 'En Revisión',
    APROBADO: 'Aprobado',
    RECHAZADO: 'Rechazado',
    EN_PROCESO: 'En Proceso',
    VENCIDA: 'Vencida',
    CUMPLIDA: 'Cumplida',
    REPLANTEADA: 'Replanteada'
  }
  return labels[estado] || estado
}

const normalizarTexto = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

const cargosPorRol: Record<string, string[]> = {
  CoordinadorHSEQ: [
    'coordinador hseq',
    'coordinadora hseq',
    'coordinador de hseq',
    'coordinador hse',
    'coordinadora hse',
    'coord hseq',
    'hseq'
  ],
  Gerencia: [
    'gerencia',
    'gerente',
    'gerente general',
    'representante de la direccion',
    'representante legal',
    'direccion general',
    'dirección general'
  ]
}

export function getCargosPermitidosPorRol(rol: string): string[] {
  return cargosPorRol[rol] || []
}

export function usuarioPuedeAprobar(rol: string, cargoUsuario?: string | null): boolean {
  if (!cargoUsuario) return false
  const cargoNorm = normalizarTexto(cargoUsuario)
  return getCargosPermitidosPorRol(rol).some(c => normalizarTexto(c) === cargoNorm)
}
