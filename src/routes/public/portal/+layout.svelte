<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { portalSession, isAuthenticated, conductorNombre, conductorCedula, diasRestantes } from '$lib/stores/portalStore';
  import '../../../app.css';

  const LOGO_SRC = '/assets/logo_nombre.png';

  let mobileMenuOpen = false;

  const navItems = [
    {
      path: '/public/portal/desprendibles',
      label: 'Desprendibles',
      shortLabel: 'Desprendibles',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
    },
    {
      path: '/public/portal/servicios',
      label: 'Mis Servicios',
      shortLabel: 'Servicios',
      icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0'
    },
    {
      path: '/public/portal/dias-laborados',
      label: 'Días Laborados',
      shortLabel: 'Días',
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
    }
  ];

  $: currentPath = $page.url.pathname;

  function cerrarSesion() {
    portalSession.logout();
    goto('/public/portal');
  }

  function navigate(path: string) {
    mobileMenuOpen = false;
    goto(path);
  }

  function initial(name: string | null | undefined): string {
    if (!name) return '?';
    const trimmed = name.trim();
    return trimmed.charAt(0).toUpperCase();
  }
</script>

<svelte:head>
  <title>Portal del Conductor · Cotransmeq</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
</svelte:head>

<div class="portal">
  {#if !$isAuthenticated}
    <slot />
  {:else}
    <!-- ════════ TOPBAR ════════ -->
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-left">
          <a class="brand" href="/public/portal/desprendibles">
            <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="topbar-logo" />
            <div class="brand-meta">
              <span class="brand-name">Cotransmeq</span>
              <span class="brand-tag">Portal Conductor</span>
            </div>
          </a>
        </div>

        <div class="topbar-right">
          <div class="conductor-chip" aria-label="Conductor autenticado">
            <div class="avatar">{initial($conductorNombre)}</div>
            <div class="chip-text">
              <span class="chip-name">{$conductorNombre || 'Conductor'}</span>
              <span class="chip-sub">
                CC {$conductorCedula} · {$diasRestantes}d
              </span>
            </div>
          </div>
          <button class="btn-salir" on:click={cerrarSesion} aria-label="Cerrar sesión">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span class="btn-salir-text">Salir</span>
          </button>
        </div>
      </div>
    </header>

    <!-- ════════ DESKTOP SIDEBAR + CONTENT ════════ -->
    <div class="main-layout">
      <nav class="sidebar" aria-label="Navegación del portal">
        <div class="sidebar-nav">
          {#each navItems as item}
            <button
              class="sidebar-item"
              class:active={currentPath.startsWith(item.path)}
              on:click={() => navigate(item.path)}
              aria-current={currentPath.startsWith(item.path) ? 'page' : undefined}
            >
              <span class="sidebar-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                  <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
                </svg>
              </span>
              <span class="sidebar-label">{item.label}</span>
            </button>
          {/each}
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-avatar">{initial($conductorNombre)}</div>
            <div class="sidebar-user-text">
              <span class="sidebar-user-name">{$conductorNombre || 'Conductor'}</span>
              <span class="sidebar-user-sub">{$diasRestantes} días restantes</span>
            </div>
          </div>
        </div>
      </nav>

      <main class="content">
        <slot />
      </main>
    </div>

    <!-- ════════ MOBILE BOTTOM NAV ════════ -->
    <nav class="bottom-nav" aria-label="Navegación móvil">
      {#each navItems as item}
        <button
          class="bottom-nav-item"
          class:active={currentPath.startsWith(item.path)}
          on:click={() => navigate(item.path)}
          aria-current={currentPath.startsWith(item.path) ? 'page' : undefined}
        >
          <span class="bottom-icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
            </svg>
          </span>
          <span class="bottom-label">{item.shortLabel}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  /* ═══════════════════════════════════════
     TOKENS — landing-transmeralda editorial
  ═══════════════════════════════════════ */
  .portal {
    --bg: #faf7f2;
    --surface: #ffffff;
    --surface-2: #f5f1e8;
    --border: rgba(0, 0, 0, 0.08);
    --border-default: rgba(0, 0, 0, 0.12);
    --text: #1a1a1a;
    --text-2: #4a4a4a;
    --text-3: #6b6b6b;
    --text-4: #9a9a9a;
    --orange-500: #f97316;
    --orange-600: #ea580c;
    --orange-700: #047857;
    --orange-800: #065f46;
    --emerald-tint: rgba(249, 115, 22, 0.08);
    --emerald-tint-hover: rgba(249, 115, 22, 0.14);
    --emerald-border: rgba(249, 115, 22, 0.18);
    --shadow-soft: 0 4px 24px rgba(0, 0, 0, 0.04);
    --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

    font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }

  :global(body) { margin: 0; overflow-x: hidden; }
  :global(html) { overflow-x: hidden; }
  * { box-sizing: border-box; }

  /* ═══════════════════════════════════════
     TOPBAR
  ═══════════════════════════════════════ */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--border);
  }

  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 1.25rem;
  }

  .topbar-left { display: flex; align-items: center; }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    text-decoration: none;
    line-height: 1;
  }

  .topbar-logo {
    height: 32px;
    width: auto;
    object-fit: contain;
    display: block;
  }

  .brand-meta {
    display: none;
    flex-direction: column;
    line-height: 1.15;
  }
  .brand-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .brand-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--emerald-600);
    margin-top: 0.1rem;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .conductor-chip {
    display: none;
    align-items: center;
    gap: 0.55rem;
    padding: 0.3rem 0.85rem 0.3rem 0.3rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    transition: all 0.2s var(--ease);
  }
  .conductor-chip:hover {
    border-color: var(--emerald-border);
  }

  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.82rem;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
    flex-shrink: 0;
  }

  .chip-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .chip-name {
    font-weight: 600;
    font-size: 0.78rem;
    color: var(--text);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-3);
    letter-spacing: 0.02em;
  }

  .btn-salir {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
    background: var(--surface);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .btn-salir svg {
    width: 14px;
    height: 14px;
  }
  .btn-salir:hover {
    background: rgba(220, 38, 38, 0.04);
    border-color: rgba(220, 38, 38, 0.25);
    color: #b91c1c;
  }
  .btn-salir-text { display: none; }

  /* ═══════════════════════════════════════
     MAIN LAYOUT
  ═══════════════════════════════════════ */
  .main-layout {
    display: flex;
    min-height: calc(100vh - 57px);
    min-height: calc(100dvh - 57px);
  }

  /* ═══════════════════════════════════════
     SIDEBAR (Desktop)
  ═══════════════════════════════════════ */
  .sidebar {
    display: none;
    width: 240px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    flex-direction: column;
    justify-content: space-between;
    padding: 1.25rem 0;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0 0.75rem;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border: none;
    background: transparent;
    color: var(--text-2);
    font-family: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s var(--ease);
    text-align: left;
    width: 100%;
  }
  .sidebar-item:hover {
    background: var(--emerald-tint);
    color: var(--emerald-800);
  }
  .sidebar-item.active {
    background: var(--emerald-tint);
    color: var(--emerald-700);
    font-weight: 600;
    box-shadow: inset 0 0 0 1px var(--emerald-border);
  }
  .sidebar-item.active .sidebar-icon {
    color: var(--emerald-600);
  }

  .sidebar-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--text-3);
    flex-shrink: 0;
    transition: color 0.2s var(--ease);
  }
  .sidebar-icon svg {
    width: 18px;
    height: 18px;
  }
  .sidebar-label { white-space: nowrap; }

  .sidebar-footer {
    padding: 0.85rem 0.85rem 0;
    border-top: 1px solid var(--border);
    margin-top: 1rem;
  }

  .sidebar-user {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .sidebar-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.95rem;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
    flex-shrink: 0;
  }
  .sidebar-user-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sidebar-user-name {
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }
  .sidebar-user-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-3);
    letter-spacing: 0.02em;
  }

  /* ═══════════════════════════════════════
     CONTENT AREA
  ═══════════════════════════════════════ */
  .content {
    flex: 1;
    min-width: 0;
    padding: 1rem;
    padding-bottom: calc(1rem + 68px);
    overflow-x: hidden;
  }

  /* ═══════════════════════════════════════
     BOTTOM NAV (Mobile)
  ═══════════════════════════════════════ */
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-around;
    height: 64px;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid var(--border);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.4rem 0;
    border: none;
    background: transparent;
    color: var(--text-3);
    font-family: inherit;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 0.2s var(--ease);
    -webkit-tap-highlight-color: transparent;
    position: relative;
  }
  .bottom-nav-item.active {
    color: var(--emerald-600);
  }
  .bottom-nav-item.active::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 24px;
    height: 2px;
    background: linear-gradient(90deg, var(--emerald-500), var(--emerald-600));
    border-radius: 0 0 2px 2px;
  }
  .bottom-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
  }
  .bottom-icon svg {
    width: 20px;
    height: 20px;
  }

  /* ═══════════════════════════════════════
     RESPONSIVE
  ═══════════════════════════════════════ */
  @media (min-width: 640px) {
    .brand-meta { display: flex; }
    .conductor-chip { display: flex; }
  }

  @media (min-width: 768px) {
    .sidebar { display: flex; }
    .bottom-nav { display: none; }
    .content { padding-bottom: 1.5rem; }
  }

  @media (min-width: 1024px) {
    .sidebar { width: 260px; }
    .content { padding: 1.75rem 2rem; }
  }

  @media (min-width: 1100px) {
    .btn-salir-text { display: inline; }
  }
</style>
