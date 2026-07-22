<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { subscribe, getState, type SaveStatus } from '$lib/stores/realtimeCollab'

  let saveStatus: SaveStatus = 'idle'
  let lastSavedAt: string | null = null
  let unsub: () => void

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const s = Math.floor(diff / 1000)
    if (s < 5) return 'justo ahora'
    if (s < 60) return `hace ${s}s`
    const m = Math.floor(s / 60)
    return `hace ${m}m`
  }

  onMount(() => {
    unsub = subscribe(() => {
      const s = getState()
      saveStatus = s.saveStatus
      lastSavedAt = s.lastSavedAt
    })
  })

  onDestroy(() => {
    unsub?.()
  })
</script>

<div class="autosave-indicator">
  {#if saveStatus === 'editing'}
    <span class="dot dot-editing"></span>
    <span class="label">Editando</span>
  {:else if saveStatus === 'saving'}
    <span class="spinner-xs"></span>
    <span class="label">Guardando...</span>
  {:else if saveStatus === 'saved' && lastSavedAt}
    <span class="dot dot-saved"></span>
    <span class="label">Guardado {timeAgo(lastSavedAt)}</span>
  {:else if saveStatus === 'error'}
    <span class="dot dot-error"></span>
    <span class="label">Error al guardar</span>
  {:else if saveStatus === 'disconnected'}
    <span class="dot dot-disconnected"></span>
    <span class="label">Sin conexión</span>
  {/if}
</div>

<style>
  .autosave-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #94a3b8;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-editing {
    background-color: #f59e0b;
    animation: pulse 1.5s ease-in-out infinite;
  }
  .dot-saved {
    background-color: #f97316;
  }
  .dot-error {
    background-color: #ef4444;
  }
  .dot-disconnected {
    background-color: #64748b;
  }
  .spinner-xs {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(148, 163, 184, 0.3);
    border-top-color: #94a3b8;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
