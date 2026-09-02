<!--
  PresenceAvatars — quién está viendo esto ahora mismo.

  Dos fuentes posibles:
    · `users` como prop → la manda el consumidor (canvas anuales, que tienen
      una `SheetSession` por libro).
    · sin prop → cae al singleton `realtimeCollab`, para las páginas que
      todavía lo usan (canvas del cierre final individual).

  La prop existe porque `realtimeCollab` guarda la presencia en estado de
  MÓDULO: con dos canvas abiertos en la misma pestaña, ambos mostraban la
  misma lista, la del último que hubiera hecho join.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { subscribe, getState, type CollabUser } from '$lib/stores/realtimeCollab'

  export let maxVisible = 4
  /** Presencia explícita. Si se pasa, ignora el store global. */
  export let users: Array<{ id: string; name: string; mes?: number | null }> | null = null

  let globalPresence: CollabUser[] = []
  let unsub: () => void

  $: presence = users ?? globalPresence

  const AVATAR_COLORS = [
    '#f97316', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  ]

  function colorForUser(userId: string): string {
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash)
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  }

  function initials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  }

  onMount(() => {
    if (users !== null) return
    unsub = subscribe(() => {
      globalPresence = getState().presence
    })
  })

  onDestroy(() => {
    unsub?.()
  })
</script>

{#if presence.length > 0}
  <div class="presence-stack">
    {#each presence.slice(0, maxVisible) as user}
      <div class="avatar" style="background-color: {colorForUser(user.id)}" title={user.name}>
        {initials(user.name)}
      </div>
    {/each}
    {#if presence.length > maxVisible}
      <div class="avatar avatar-more">+{presence.length - maxVisible}</div>
    {/if}
    <span class="presence-count">{presence.length} en línea</span>
  </div>
{/if}

<style>
  .presence-stack {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    border: 2px solid #fff;
    margin-left: -6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  }
  .avatar:first-child {
    margin-left: 0;
  }
  .avatar-more {
    background-color: #64748b !important;
  }
  .presence-count {
    font-size: 11px;
    color: #94a3b8;
    margin-left: 4px;
  }
</style>
