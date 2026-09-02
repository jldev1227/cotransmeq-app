import { getSocket, connectSocket } from '$lib/socketClient'

export interface CollabUser {
  id: string
  name: string
  joinedAt: string
  currentField: string | null
}

export type SaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'error' | 'disconnected'

interface CollabState {
  presence: CollabUser[]
  typing: Map<string, { userId: string; userName: string }>
  focusedField: { field: string; userId: string; userName: string } | null
  saveStatus: SaveStatus
  lastSavedAt: string | null
  currentRoom: string | null
  pendingConceptos: any[] | null
  pendingAdicionales: any[] | null
  pendingPropietarioOverrides: Record<string, boolean> | null
  /// Array completo de copropietarios activos cuando el cierre está en modo
  /// multi-propietario. Mismo patrón que `pendingAdicionales`.
  pendingPropietarios: any[] | null
  pendingCierreChanges: Record<string, any> | null
  /// ── MENSUAL ─────────────────────────────────────────────
  /// Cuando el editor activo es la liquidación mensual, estos son los
  /// pendientes. Se emiten en una sola llamada `row:save` con
  /// `table='liquidacion-tercero-ocasional'` y los 3 arrays dentro de
  /// `changes`. El ACK correlacionado (`requestId`) garantiza que
  /// múltiples saves concurrentes no se mezclen.
  pendingOcasionalItems: any[] | null
  pendingOcasionalAdicionales: any[] | null
  pendingOcasionalConceptos: any[] | null
  pendingOcasionalObs: string | null
}

const state: CollabState = {
  presence: [],
  typing: new Map(),
  focusedField: null,
  saveStatus: 'idle',
  lastSavedAt: null,
  currentRoom: null,
  pendingConceptos: null,
  pendingAdicionales: null,
  pendingPropietarioOverrides: null,
  pendingPropietarios: null,
  pendingCierreChanges: null,
  pendingOcasionalItems: null,
  pendingOcasionalAdicionales: null,
  pendingOcasionalConceptos: null,
  pendingOcasionalObs: null,
}

type Listener = () => void
const listeners: Set<Listener> = new Set()

function notify() {
  for (const l of listeners) l()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveTimeout: ReturnType<typeof setTimeout> | null = null
let saveInFlight = false
const SAVE_DELAY = 800
const SAVE_TIMEOUT = 5000
/// Set de `requestId`s actualmente en vuelo. El backend responde con
/// `save-success { requestId }` cuando un save termina OK. Si un
/// `requestId` queda huérfano (no llega ACK en `SAVE_TIMEOUT`), se
/// descarta y el siguiente `flushSave` puede continuar.
const inFlightRequestIds = new Set<string>()
let requestIdCounter = 0
function nextRequestId(): string {
  requestIdCounter++
  return `req_${Date.now().toString(36)}_${requestIdCounter}`
}

let currentUser: { id: string; name: string } | null = null
let currentTable = 'liquidacion-tercero-final'
let currentId = ''

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getState(): CollabState {
  return { ...state, typing: new Map(state.typing) }
}

export function initCollab(user: { id: string; name: string }) {
  currentUser = user
  connectSocket()
}

/**
 * Handlers registrados por el `joinRoom` activo.
 *
 * Se guardan las REFERENCIAS por dos motivos:
 *   1. `socket.off(evento)` sin handler borra TODOS los listeners de ese
 *      evento en el socket compartido — incluidos los de chat, nómina o
 *      cualquier otro consumidor. `leaveRoom` hacía justo eso.
 *   2. Llamar `joinRoom` dos veces sin `leaveRoom` de por medio (retry,
 *      refetch, cambio de entidad) duplicaba los listeners, y cada evento
 *      pasaba a procesarse N veces.
 */
let roomHandlers: Record<string, (...args: any[]) => void> | null = null

function unbindRoomHandlers() {
  const socket = getSocket()
  if (!socket || !roomHandlers) return
  for (const [evento, handler] of Object.entries(roomHandlers)) {
    socket.off(evento, handler)
  }
  roomHandlers = null
}

export function joinRoom(table: string, id: string, user: { id: string; name: string }) {
  const socket = getSocket()
  if (!socket) return

  // Idempotente: si ya había una suscripción activa, se retira antes.
  unbindRoomHandlers()

  currentTable = table
  currentId = id
  state.currentRoom = `row:${table}:${id}`

  socket.emit('join-room', { table, id, user })

  const handlers: Record<string, (...args: any[]) => void> = {}

  handlers['presence:update'] = (data: { room: string; users: CollabUser[] }) => {
    state.presence = data.users
    notify()
  }

  handlers['user-joined'] = (data: { user: CollabUser }) => {
    state.presence = [...state.presence, data.user]
    notify()
  }

  handlers['user-left'] = (data: { userId: string }) => {
    state.presence = state.presence.filter(u => u.id !== data.userId)
    notify()
  }

  handlers['typing'] = (data: { field: string; userId: string; userName: string }) => {
    state.typing.set(data.field, { userId: data.userId, userName: data.userName })
    notify()
  }

  handlers['typing:stop'] = (data: { field: string }) => {
    state.typing.delete(data.field)
    notify()
  }

  handlers['focus'] = (data: { field: string; userId: string; userName: string }) => {
    state.focusedField = { field: data.field, userId: data.userId, userName: data.userName }
    notify()
  }

  handlers['row:updated'] = (data: { id: string; changes: Record<string, any>; updatedBy: string; updatedById?: string; updatedAt: string }) => {
    // Clasifica el cambio para que el consumidor (página de edición) pueda
    // decidir qué hacer sin inspeccionar `changes`. Mapea las keys de
    // `changes` a un `kind` semántico.
    let kind: 'items-refreshed' | 'conceptos' | 'adicionales' | 'propietario-overrides' | 'cierre-totales' | 'unknown' = 'unknown'
    if (data.changes?.itemsRefreshed === true) {
      kind = 'items-refreshed'
    } else if (Array.isArray(data.changes?.conceptos)) {
      kind = 'conceptos'
    } else if (Array.isArray(data.changes?.adicionales)) {
      kind = 'adicionales'
    } else if (data.changes && typeof data.changes.es_propietario_overrides === 'object') {
      kind = 'propietario-overrides'
    } else if (
      data.changes &&
      ('valor_liquidar' in data.changes ||
        'total_pagar' in data.changes ||
        'total_costos_laborales' in data.changes ||
        'total_gastos_operativos' in data.changes ||
        'total_impuestos' in data.changes ||
        'total_descuentos' in data.changes)
    ) {
      kind = 'cierre-totales'
    }
    // Notify listeners that remote changes arrived
    window.dispatchEvent(new CustomEvent('collab:remote-update', { detail: { ...data, kind } }))
  }

  handlers['save-success'] = (data?: { requestId?: string; id?: string; table?: string; timestamp?: number }) => {
    clearSaveTimeout()
    state.saveStatus = 'saved'
    state.lastSavedAt = new Date().toISOString()
    notify()
    // Si llega con requestId, lo descartamos del mapa de pendientes en vuelo
    if (data?.requestId) {
      inFlightRequestIds.delete(data.requestId);
    }
    advanceQueue()
  }

  handlers['save-error'] = (data: { error: string; requestId?: string }) => {
    clearSaveTimeout()
    state.saveStatus = 'error'
    console.error('[collab] save error:', data.error)
    if (data?.requestId) {
      inFlightRequestIds.delete(data.requestId);
    }
    saveInFlight = false
    notify()
  }

  handlers['disconnect'] = () => {
    state.saveStatus = 'disconnected'
    notify()
  }

  handlers['connect'] = () => {
    state.saveStatus = 'idle'
    // Re-join room on reconnect
    socket.emit('join-room', { table, id, user })
    notify()
  }

  for (const [evento, handler] of Object.entries(handlers)) {
    socket.on(evento, handler)
  }
  roomHandlers = handlers
}

export function leaveRoom() {
  const socket = getSocket()
  if (!socket || !currentId) return

  flushSave()
  clearSaveTimeout()

  socket.emit('leave-room', { table: currentTable, id: currentId })

  // Con las referencias exactas: `socket.off(evento)` a secas borraba
  // también los listeners de otros consumidores del socket compartido.
  unbindRoomHandlers()

  state.presence = []
  state.typing.clear()
  state.focusedField = null
  state.currentRoom = null
  state.saveStatus = 'idle'
  notify()
}

export function emitTypingStart(field: string) {
  const socket = getSocket()
  if (!socket || !currentUser) return
  socket.emit('typing:start', {
    table: currentTable,
    id: currentId,
    field,
    user: currentUser,
  })
}

export function emitTypingStop(field: string) {
  const socket = getSocket()
  if (!socket || !currentUser) return
  socket.emit('typing:stop', {
    table: currentTable,
    id: currentId,
    field,
    user: currentUser,
  })
}

export function emitFocus(field: string) {
  const socket = getSocket()
  if (!socket || !currentUser) return
  socket.emit('field:focus', {
    table: currentTable,
    id: currentId,
    field,
    user: currentUser,
  })
}

export function enqueueConceptosChanges(conceptos: any[]) {
  // Defensive dedupe: el gateway del socket hace deleteMany + createMany
  // del array completo, así que si llega con duplicados los persiste como
  // tales. Filtramos por la clave compuesta (tipo, concepto, conductor_id,
  // propietario_id) y conservamos la ÚLTIMA ocurrencia (última edición
  // del usuario gana). Esto es solo defensivo: si el estado local está
  // limpio, la operación es un no-op.
  const seen = new Set<string>()
  const deduped: any[] = []
  for (let i = conceptos.length - 1; i >= 0; i--) {
    const c = conceptos[i]
    const key = [c.tipo, c.concepto, c.conductor_id || '', c.propietario_id || ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.unshift(c)
  }
  state.saveStatus = 'editing'
  state.pendingConceptos = deduped
  notify()
  scheduleSave()
}

export function enqueueAdicionalesChanges(adicionales: any[]) {
  state.saveStatus = 'editing'
  state.pendingAdicionales = adicionales
  notify()
  scheduleSave()
}

export function enqueuePropietarioOverridesChanges(overrides: Record<string, boolean>) {
  state.saveStatus = 'editing'
  state.pendingPropietarioOverrides = overrides
  notify()
  scheduleSave()
}

/**
 * Encola el array completo de copropietarios activos del cierre (modo
 * multi-propietario). El backend hace soft-delete de los que ya no estén y
 * upsert de los vigentes. El autosave dispara una sola llamada `row:save`
 * con `table = 'liquidacion-tercero-final-propietarios'`.
 */
export function enqueuePropietariosChanges(propietarios: any[]) {
  state.saveStatus = 'editing'
  state.pendingPropietarios = propietarios
  notify()
  scheduleSave()
}

export function enqueueCierreChanges(changes: Record<string, any>) {
  state.saveStatus = 'editing'
  state.pendingCierreChanges = { ...state.pendingCierreChanges, ...changes }
  notify()
  scheduleSave()
}

// ─── MENSUAL ───────────────────────────────────────────────
// El canvas mensual envía 1 sola llamada `row:save` con los 3 arrays
// consolidados. Esto evita 3 round-trips por cada edición de celda
// y simplifica la lógica del gateway.

export function enqueueOcasionalItemsChanges(items: any[]) {
  state.saveStatus = 'editing'
  state.pendingOcasionalItems = items
  notify()
  scheduleSave()
}

export function enqueueOcasionalAdicionalesChanges(adicionales: any[]) {
  state.saveStatus = 'editing'
  state.pendingOcasionalAdicionales = adicionales
  notify()
  scheduleSave()
}

export function enqueueOcasionalConceptosChanges(conceptos: any[]) {
  state.saveStatus = 'editing'
  state.pendingOcasionalConceptos = conceptos
  notify()
  scheduleSave()
}

export function enqueueOcasionalObservaciones(observaciones: string | null) {
  state.saveStatus = 'editing'
  state.pendingOcasionalObs = observaciones
  notify()
  scheduleSave()
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, SAVE_DELAY)
}

function advanceQueue() {
  const socket = getSocket()
  if (!socket || !currentUser || !currentId) {
    saveInFlight = false
    return
  }

  saveInFlight = false

  if (state.pendingConceptos) {
    const payload = state.pendingConceptos
    state.pendingConceptos = null
    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()
    socket.emit('row:save', {
      table: 'liquidacion-tercero-final-concepto',
      id: currentId,
      changes: { conceptos: payload },
      user: currentUser,
    })
    return
  }

  if (state.pendingAdicionales) {
    const payload = state.pendingAdicionales
    state.pendingAdicionales = null
    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()
    socket.emit('row:save', {
      table: 'liquidacion-tercero-final-adicionales',
      id: currentId,
      changes: { adicionales: payload },
      user: currentUser,
    })
    return
  }

  if (state.pendingPropietarioOverrides) {
    const payload = state.pendingPropietarioOverrides
    state.pendingPropietarioOverrides = null
    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()
    socket.emit('row:save', {
      table: 'liquidacion-tercero-final-propietario-overrides',
      id: currentId,
      changes: { es_propietario_overrides: payload },
      user: currentUser,
    })
    return
  }

  if (state.pendingPropietarios) {
    const payload = state.pendingPropietarios
    state.pendingPropietarios = null
    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()
    socket.emit('row:save', {
      table: 'liquidacion-tercero-final-propietarios',
      id: currentId,
      changes: { propietarios: payload },
      user: currentUser,
    })
    return
  }

  if (state.pendingCierreChanges && Object.keys(state.pendingCierreChanges).length > 0) {
    const payload = state.pendingCierreChanges
    state.pendingCierreChanges = null
    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()
    socket.emit('row:save', {
      table: 'liquidacion-tercero-final',
      id: currentId,
      changes: payload,
      user: currentUser,
    })
    return
  }

  // ── MENSUAL: 3 colas independientes, 1 sola emisión ──
  if (
    state.pendingOcasionalItems ||
    state.pendingOcasionalAdicionales ||
    state.pendingOcasionalConceptos ||
    state.pendingOcasionalObs
  ) {
    const items = state.pendingOcasionalItems || []
    const adicionales = state.pendingOcasionalAdicionales || []
    const conceptos = state.pendingOcasionalConceptos || []
    const observaciones = state.pendingOcasionalObs
    state.pendingOcasionalItems = null
    state.pendingOcasionalAdicionales = null
    state.pendingOcasionalConceptos = null
    state.pendingOcasionalObs = null

    state.saveStatus = 'saving'
    notify()
    saveInFlight = true
    startSaveTimeout()

    // Recuperamos mes/anio del cache del cliente via custom event o del
    // currentRoom metadata. Aquí emitimos y el handler del gateway hace el
    // match contra la cabecera por id.
    const reqId = nextRequestId()
    inFlightRequestIds.add(reqId)
    socket.emit('row:save', {
      table: 'liquidacion-tercero-ocasional',
      id: currentId,
      changes: {
        items,
        adicionales,
        conceptos,
        observaciones
      },
      user: currentUser,
      requestId: reqId,
    })
    return
  }

  state.saveStatus = 'saved'
  state.lastSavedAt = new Date().toISOString()
  notify()
}

export function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  if (saveInFlight) return

  advanceQueue()
}

function clearSaveTimeout() {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
}

function startSaveTimeout() {
  clearSaveTimeout()
  saveTimeout = setTimeout(() => {
    console.warn('[collab] save timeout — no save-success received')
    saveInFlight = false
    // If there are still pending items, keep status as 'editing' so they
    // can be retried on the next change. Otherwise fall back to 'idle'.
    // Los cuatro buckets `pendingOcasional*` faltaban aquí, aunque
    // `clearPendingForKind` sí los tiene en cuenta. Tras un timeout, el
    // indicador caía a 'idle' con cambios del ocasional todavía pendientes:
    // el usuario veía "sin cambios" teniendo trabajo sin guardar.
    const hasPending =
      state.pendingConceptos ||
      state.pendingAdicionales ||
      state.pendingPropietarioOverrides ||
      state.pendingPropietarios ||
      state.pendingOcasionalItems ||
      state.pendingOcasionalAdicionales ||
      state.pendingOcasionalConceptos ||
      state.pendingOcasionalObs ||
      (state.pendingCierreChanges && Object.keys(state.pendingCierreChanges).length > 0)
    state.saveStatus = hasPending ? 'editing' : 'idle'
    notify()
  }, SAVE_TIMEOUT)
}

export function isTypingByOther(field: string): string | null {
  const t = state.typing.get(field)
  return t ? t.userName : null
}

export function isFocusedByOther(field: string): string | null {
  if (state.focusedField && state.focusedField.field === field) {
    return state.focusedField.userName
  }
  return null
}

/**
 * Permite que módulos externos (ej. editor mensual) actualicen el estado
 * de autosave SIN pasar por el socket. Útil cuando el save es HTTP en vez
 * de socket (p.ej. cuando la tabla destino aún no tiene handler en el
 * gateway de realtime).
 */
export function setSaveStatus(
  status: SaveStatus,
  lastSavedAt: string | null = state.lastSavedAt,
) {
  state.saveStatus = status
  if (lastSavedAt) state.lastSavedAt = lastSavedAt
  notify()
}

/**
 * Descarta el pending local de un `kind` específico. Se usa cuando el
 * cliente recibe un `row:updated` de OTRO usuario con el mismo `kind` que
 * el cliente tenía en su debounce: el cambio remoto gana (last-write-wins
 * vía servidor) y el pending local se descarta para que el debounce no
 * guarde un valor stale encima del remoto.
 *
 * También cancela el timer del debounce para que no se dispare más tarde
 * con datos viejos.
 */
export type PendingKind =
  | 'conceptos'
  | 'adicionales'
  | 'propietario-overrides'
  | 'propietarios'
  | 'cierre-totales'
  | 'mensual-items'
  | 'mensual-adicionales'
  | 'mensual-conceptos'
  | 'mensual-observaciones'

export function clearPendingForKind(kind: PendingKind) {
  let cleared = false
  if (kind === 'conceptos' && state.pendingConceptos) {
    state.pendingConceptos = null
    cleared = true
  } else if (kind === 'adicionales' && state.pendingAdicionales) {
    state.pendingAdicionales = null
    cleared = true
  } else if (kind === 'propietario-overrides' && state.pendingPropietarioOverrides) {
    state.pendingPropietarioOverrides = null
    cleared = true
  } else if (kind === 'propietarios' && state.pendingPropietarios) {
    state.pendingPropietarios = null
    cleared = true
  } else if (
    kind === 'cierre-totales' &&
    state.pendingCierreChanges &&
    Object.keys(state.pendingCierreChanges).length > 0
  ) {
    state.pendingCierreChanges = null
    cleared = true
  } else if (kind === 'mensual-items' && state.pendingOcasionalItems) {
    state.pendingOcasionalItems = null
    cleared = true
  } else if (kind === 'mensual-adicionales' && state.pendingOcasionalAdicionales) {
    state.pendingOcasionalAdicionales = null
    cleared = true
  } else if (kind === 'mensual-conceptos' && state.pendingOcasionalConceptos) {
    state.pendingOcasionalConceptos = null
    cleared = true
  } else if (kind === 'mensual-observaciones' && state.pendingOcasionalObs !== null) {
    state.pendingOcasionalObs = null
    cleared = true
  }
  if (cleared) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    // Si no hay más nada pending ni nada en vuelo, devolvemos el status a
    // 'saved' (lo último que el servidor aceptó) para que el
    // AutosaveIndicator deje de mostrar "editando…".
    const hasPending =
      state.pendingConceptos ||
      state.pendingAdicionales ||
      state.pendingPropietarioOverrides ||
      state.pendingPropietarios ||
      (state.pendingCierreChanges && Object.keys(state.pendingCierreChanges).length > 0) ||
      state.pendingOcasionalItems ||
      state.pendingOcasionalAdicionales ||
      state.pendingOcasionalConceptos ||
      state.pendingOcasionalObs
    if (!hasPending && !saveInFlight) {
      state.saveStatus = 'saved'
      state.lastSavedAt = new Date().toISOString()
    }
    notify()
  }
}

/**
 * Persiste un draft local del canvas mensual al backend para sobrevivir
 * un refresh de la pestaña. Llamado por la página de canvas cada N
 * segundos o antes de salir.
 */
export async function persistDraft(payload: any): Promise<{ ok: boolean; version?: number }> {
  if (!currentUser) return { ok: false }
  try {
    const { liquidacionesTercerosOcasionalAPI } = await import(
      '$lib/api/liquidaciones-terceros-ocasional'
    )
    const result = await liquidacionesTercerosOcasionalAPI.guardarDraft({
      liquidacion_ocasional_id: currentId,
      payload,
    })
    return { ok: true, version: result.version }
  } catch (e: any) {
    console.error('[collab] persistDraft error:', e?.message)
    return { ok: false }
  }
}

export async function fetchDraft(): Promise<{
  id: string;
  payload: any;
  version: number;
  updated_at: string;
} | null> {
  if (!currentUser) return null
  try {
    const { liquidacionesTercerosOcasionalAPI } = await import(
      '$lib/api/liquidaciones-terceros-ocasional'
    )
    return await liquidacionesTercerosOcasionalAPI.obtenerDraft(currentId)
  } catch (e: any) {
    console.error('[collab] fetchDraft error:', e?.message)
    return null
  }
}

export async function clearDraft(): Promise<{ ok: boolean }> {
  if (!currentUser) return { ok: false }
  try {
    const { liquidacionesTercerosOcasionalAPI } = await import(
      '$lib/api/liquidaciones-terceros-ocasional'
    )
    return await liquidacionesTercerosOcasionalAPI.eliminarDraft(currentId)
  } catch (e: any) {
    console.error('[collab] clearDraft error:', e?.message)
    return { ok: false }
  }
}
