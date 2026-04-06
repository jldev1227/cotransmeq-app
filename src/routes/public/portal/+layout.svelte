<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { portalSession, isAuthenticated, conductorNombre, conductorCedula, diasRestantes } from '$lib/stores/portalStore';
  import '../../../app.css';

  const LOGO_SRC = '/assets/logo.png';
  const THEME_KEY = 'cotransmeq_portal_theme';

  let dark = false;
  let mobileMenuOpen = false;

  const navItems = [
    { path: '/public/portal/desprendibles', label: 'Desprendibles', icon: '📄', shortLabel: 'Desprendibles' },
    { path: '/public/portal/dias-laborados', label: 'Días Laborados', icon: '📅', shortLabel: 'Días' }
  ];

  $: currentPath = $page.url.pathname;

  function toggleTheme() {
    dark = !dark;
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }

  function cerrarSesion() {
    portalSession.logout();
    goto('/public/portal');
  }

  function navigate(path: string) {
    mobileMenuOpen = false;
    goto(path);
  }

  onMount(() => {
    const saved = localStorage.getItem(THEME_KEY);
    dark = saved === 'dark';
  });
</script>

<svelte:head>
  <title>Portal del Conductor · Cotransmeq</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</svelte:head>

<div class="portal" class:dark>
  {#if !$isAuthenticated}
    <slot />
  {:else}
    <!-- ════════ TOPBAR ════════ -->
    <header class="topbar">
      <div class="topbar-left">
        <img src={LOGO_SRC} alt="Cotransmeq" class="topbar-logo"
          on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
        <span class="topbar-title">Portal Conductor</span>
      </div>

      <div class="topbar-right">
        <button class="theme-btn" on:click={toggleTheme} aria-label="Cambiar tema" title={dark ? 'Modo claro' : 'Modo oscuro'}>
          {#if dark}☀️{:else}🌙{/if}
        </button>

        <div class="conductor-info-chip">
          <div class="avatar">{$conductorNombre ? $conductorNombre.charAt(0).toUpperCase() : '?'}</div>
          <div class="info-text">
            <span class="info-name">{$conductorNombre}</span>
            <span class="info-sub">CC {$conductorCedula} · {$diasRestantes}d</span>
          </div>
        </div>

        <button class="btn-salir" on:click={cerrarSesion}>Salir</button>
      </div>
    </header>

    <!-- ════════ DESKTOP SIDEBAR + CONTENT ════════ -->
    <div class="main-layout">
      <nav class="sidebar">
        <div class="sidebar-nav">
          {#each navItems as item}
            <button
              class="sidebar-item"
              class:active={currentPath.startsWith(item.path)}
              on:click={() => navigate(item.path)}
            >
              <span class="sidebar-icon">{item.icon}</span>
              <span class="sidebar-label">{item.label}</span>
            </button>
          {/each}
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-avatar">{$conductorNombre ? $conductorNombre.charAt(0).toUpperCase() : '?'}</div>
            <div>
              <div class="sidebar-user-name">{$conductorNombre}</div>
              <div class="sidebar-user-sub">{$diasRestantes} días restantes</div>
            </div>
          </div>
        </div>
      </nav>

      <main class="content">
        <slot />
      </main>
    </div>

    <!-- ════════ MOBILE BOTTOM NAV ════════ -->
    <nav class="bottom-nav">
      {#each navItems as item}
        <button
          class="bottom-nav-item"
          class:active={currentPath.startsWith(item.path)}
          on:click={() => navigate(item.path)}
        >
          <span class="bottom-icon">{item.icon}</span>
          <span class="bottom-label">{item.shortLabel}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  /* ═══════════════════════════════════════
     CSS VARIABLES — COTRANSMEQ (Blue theme)
  ═══════════════════════════════════════ */
  .portal {
    --bg: #f1f5f9;
    --surface: #ffffff;
    --surface2: #f8fafc;
    --border: #e2e8f0;
    --text: #0f172a;
    --text2: #475569;
    --text3: #94a3b8;
    --accent: #1e40af;
    --accent-light: #eff6ff;
    --accent-dark: #1d4ed8;
    --shadow: 0 1px 3px rgba(0,0,0,0.08);
    --shadow-lg: 0 4px 16px rgba(0,0,0,0.12);

    font-family: 'Barlow', sans-serif;
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--text);
    transition: background .25s, color .25s;
  }

  .portal.dark {
    --bg: #0f172a;
    --surface: #1e293b;
    --surface2: #0f172a;
    --border: #334155;
    --text: #f1f5f9;
    --text2: #94a3b8;
    --text3: #64748b;
    --accent-light: #172554;
    --shadow: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-lg: 0 4px 16px rgba(0,0,0,0.4);
  }

  :global(body) { margin: 0; overflow-x: hidden; }
  * { box-sizing: border-box; }

  .topbar {
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    height: 56px; padding: 0 1rem;
    background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: var(--shadow);
  }
  .topbar-left { display: flex; align-items: center; gap: 0.75rem; }
  .topbar-logo { height: 32px; width: auto; object-fit: contain; }
  .topbar-title { font-weight: 700; font-size: 1rem; color: var(--accent); display: none; }
  .topbar-right { display: flex; align-items: center; gap: 0.5rem; }

  .theme-btn {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid var(--border); background: var(--surface2);
    font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: transform .15s;
  }
  .theme-btn:active { transform: scale(0.9); }

  .conductor-info-chip {
    display: none; align-items: center; gap: 0.5rem;
    padding: 0.25rem 0.75rem 0.25rem 0.25rem;
    background: var(--surface2); border: 1px solid var(--border); border-radius: 99px;
  }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 0.85rem;
  }
  .info-text { display: flex; flex-direction: column; line-height: 1.2; }
  .info-name { font-weight: 600; font-size: 0.8rem; color: var(--text); }
  .info-sub { font-size: 0.7rem; color: var(--text3); font-family: 'JetBrains Mono', monospace; }

  .btn-salir {
    padding: 0.35rem 0.85rem; border-radius: 8px;
    border: 1px solid var(--border); background: var(--surface2);
    color: var(--text2); font-weight: 600; font-size: 0.8rem;
    cursor: pointer; transition: all .15s;
  }
  .btn-salir:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }

  .main-layout { display: flex; min-height: calc(100vh - 56px); min-height: calc(100dvh - 56px); }

  .sidebar {
    display: none; width: 240px; flex-shrink: 0;
    background: var(--surface); border-right: 1px solid var(--border);
    flex-direction: column; justify-content: space-between; padding: 1rem 0;
  }
  .sidebar-nav { display: flex; flex-direction: column; gap: 0.25rem; padding: 0 0.75rem; }
  .sidebar-item {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.65rem 0.85rem; border-radius: 10px; border: none;
    background: transparent; color: var(--text2); font-weight: 500;
    font-size: 0.9rem; cursor: pointer; transition: all .15s; text-align: left;
  }
  .sidebar-item:hover { background: var(--surface2); color: var(--text); }
  .sidebar-item.active { background: var(--accent-light); color: var(--accent); font-weight: 700; }
  .sidebar-icon { font-size: 1.15rem; }
  .sidebar-label { white-space: nowrap; }
  .sidebar-footer { padding: 0.75rem; border-top: 1px solid var(--border); margin-top: 1rem; }
  .sidebar-user {
    display: flex; align-items: center; gap: 0.65rem;
    padding: 0.5rem; border-radius: 10px; background: var(--surface2);
  }
  .sidebar-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1rem; flex-shrink: 0;
  }
  .sidebar-user-name {
    font-weight: 600; font-size: 0.85rem; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;
  }
  .sidebar-user-sub { font-size: 0.72rem; color: var(--text3); }

  .content {
    flex: 1; min-width: 0; padding: 1rem;
    padding-bottom: calc(1rem + 68px); overflow-x: hidden;
  }

  .bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-around;
    height: 64px; background: var(--surface);
    border-top: 1px solid var(--border); box-shadow: 0 -2px 12px rgba(0,0,0,0.08);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .bottom-nav-item {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 0.15rem; padding: 0.4rem 0;
    border: none; background: transparent; color: var(--text3);
    cursor: pointer; transition: all .15s; -webkit-tap-highlight-color: transparent; position: relative;
  }
  .bottom-nav-item.active { color: var(--accent); }
  .bottom-nav-item.active::after {
    content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 24px; height: 3px; background: var(--accent); border-radius: 0 0 3px 3px;
  }
  .bottom-icon { font-size: 1.4rem; line-height: 1; }
  .bottom-label { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.02em; }

  @media (min-width: 640px) {
    .topbar-title { display: block; }
    .conductor-info-chip { display: flex; }
  }
  @media (min-width: 768px) {
    .sidebar { display: flex; }
    .bottom-nav { display: none; }
    .content { padding-bottom: 1.5rem; }
  }
  @media (min-width: 1024px) {
    .sidebar { width: 260px; }
    .content { padding: 1.5rem 2rem; }
  }
</style>
