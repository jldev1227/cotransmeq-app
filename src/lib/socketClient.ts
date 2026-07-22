import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
let connected = false
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10

export function getSocket(): Socket | null {
  return socket
}

export function isConnected(): boolean {
  return connected
}

export function connectSocket(token?: string): Socket {
  if (socket) return socket

  socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    auth: token ? { token } : undefined,
  })

  socket.on('connect', () => {
    connected = true
    reconnectAttempts = 0
    console.log('[socket] connected:', socket?.id)
  })

  socket.on('disconnect', () => {
    connected = false
    console.log('[socket] disconnected')
  })

  socket.on('connect_error', (err) => {
    reconnectAttempts++
    console.error('[socket] connect_error:', err.message)
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    connected = false
  }
}
