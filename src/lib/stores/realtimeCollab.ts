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
  pendingCierreChanges: Record<string, any> | null
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
  pendingCierreChanges: null,
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

export function joinRoom(table: string, id: string, user: { id: string; name: string }) {
  const socket = getSocket()
  if (!socket) return

  currentTable = table
  currentId = id
  state.currentRoom = `row:${table}:${id}`

  socket.emit('join-room', { table, id, user })

  socket.on('presence:update', (data: { room: string; users: CollabUser[] }) => {
    state.presence = data.users
    notify()
  })

  socket.on('user-joined', (data: { user: CollabUser }) => {
    state.presence = [...state.presence, data.user]
    notify()
  })

  socket.on('user-left', (data: { userId: string }) => {
    state.presence = state.presence.filter(u => u.id !== data.userId)
    notify()
  })

  socket.on('typing', (data: { field: string; userId: string; userName: string }) => {
    state.typing.set(data.field, { userId: data.userId, userName: data.userName })
    notify()
  })

  socket.on('typing:stop', (data: { field: string }) => {
    state.typing.delete(data.field)
    notify()
  })

  socket.on('focus', (data: { field: string; userId: string; userName: string }) => {
    state.focusedField = { field: data.field, userId: data.userId, userName: data.userName }
    notify()
  })

  socket.on('row:updated', (data: { id: string; changes: Record<string, any>; updatedBy: string; updatedAt: string }) => {
    // Notify listeners that remote changes arrived
    window.dispatchEvent(new CustomEvent('collab:remote-update', { detail: data }))
  })

  socket.on('save-success', () => {
    clearSaveTimeout()
    state.saveStatus = 'saved'
    state.lastSavedAt = new Date().toISOString()
    notify()
    advanceQueue()
  })

  socket.on('save-error', (data: { error: string }) => {
    clearSaveTimeout()
    state.saveStatus = 'error'
    console.error('[collab] save error:', data.error)
    saveInFlight = false
    notify()
  })

  socket.on('disconnect', () => {
    state.saveStatus = 'disconnected'
    notify()
  })

  socket.on('connect', () => {
    state.saveStatus = 'idle'
    // Re-join room on reconnect
    socket.emit('join-room', { table, id, user })
    notify()
  })
}

export function leaveRoom() {
  const socket = getSocket()
  if (!socket || !currentId) return

  flushSave()
  clearSaveTimeout()

  socket.emit('leave-room', { table: currentTable, id: currentId })

  socket.off('presence:update')
  socket.off('user-joined')
  socket.off('user-left')
  socket.off('typing')
  socket.off('typing:stop')
  socket.off('focus')
  socket.off('row:updated')
  socket.off('save-success')
  socket.off('save-error')
  socket.off('disconnect')
  socket.off('connect')

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
  state.saveStatus = 'editing'
  state.pendingConceptos = conceptos
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

export function enqueueCierreChanges(changes: Record<string, any>) {
  state.saveStatus = 'editing'
  state.pendingCierreChanges = { ...state.pendingCierreChanges, ...changes }
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
    const hasPending =
      state.pendingConceptos ||
      state.pendingAdicionales ||
      state.pendingPropietarioOverrides ||
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
