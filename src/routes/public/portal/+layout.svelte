<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { portalSession, isAuthenticated, conductorNombre, conductorCedula, diasRestantes } from '$lib/stores/portalStore';
  import { startSync, wakeAll } from '$lib/offline/forms-sync';
  import { clearAll, hayTrabajoPendiente } from '$lib/offline/forms-db';
  import '../../../app.css';

  /// Logotipo en blanco: la barra y el menú van sobre el verde de marca.
  const LOGO_SRC = '/assets/logo_nombre_white.webp';

  let mobileMenuOpen = false;

  /**
   * Mantiene viva la outbox en TODO el portal y adopta builds nuevos sin cortar
   * una inspección a mitad de una respuesta.
   *
   * El service worker activa la versión nueva enseguida, pero el JavaScript de
   * una pestaña abierta sigue siendo el anterior hasta recargar. Se espera a 30 s
   * sin interacción: para entonces el autosave de 250 ms ya terminó y el original
   * está en IndexedDB. Si la pestaña está oculta, se actualiza de inmediato.
   */
  onMount(() => {
    const INACTIVIDAD_PARA_ACTUALIZAR_MS = 30_000;
    let ultimaActividad = Date.now();
    let actualizacionPendiente = false;
    let recargando = false;

    const registrarActividad = () => (ultimaActividad = Date.now());
    const adoptarActualizacion = () => {
      if (!actualizacionPendiente || recargando) return;
      const inactivo = Date.now() - ultimaActividad >= INACTIVIDAD_PARA_ACTUALIZAR_MS;
      if (document.visibilityState !== 'hidden' && !inactivo) return;
      recargando = true;
      window.location.reload();
    };
    const alCambiarWorker = () => {
      actualizacionPendiente = true;
      adoptarActualizacion();
    };

    for (const evento of ['pointerdown', 'keydown', 'input', 'touchstart'] as const) {
      window.addEventListener(evento, registrarActividad, { passive: true });
    }
    navigator.serviceWorker?.addEventListener('controllerchange', alCambiarWorker);
    const vigilanciaActualizacion = window.setInterval(adoptarActualizacion, 5_000);

    /// El layout persiste entre `/portal` y sus páginas hijas. Suscribirse a la
    /// sesión cubre también el login que ocurre después del primer montaje.
    const desuscribirSesion = portalSession.subscribe((sesion) => {
      if (!sesion) return;
      void startSync()
        .then(() => wakeAll())
        .catch((err) => console.error('[portal] no se pudo iniciar la sincronización', err));
    });

    return () => {
      desuscribirSesion();
      window.clearInterval(vigilanciaActualizacion);
      navigator.serviceWorker?.removeEventListener('controllerchange', alCambiarWorker);
      for (const evento of ['pointerdown', 'keydown', 'input', 'touchstart'] as const) {
        window.removeEventListener(evento, registrarActividad);
      }
    };
  });

  /// Las mismas secciones y en el mismo orden que el menú de la app móvil.
  const navItems = [
    {
      // Primero en la lista: es la tarea diaria del conductor (el preoperacional
      // se diligencia antes de salir), mientras que los desprendibles se
      // consultan una o dos veces al mes.
      path: '/public/portal/formularios',
      label: 'Formularios',
      shortLabel: 'Formularios',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'
    },
    {
      path: '/public/portal/servicios',
      label: 'Servicios',
      shortLabel: 'Servicios',
      icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0'
    },
    {
      path: '/public/portal/dias-laborados',
      label: 'Días laborados',
      shortLabel: 'Días',
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
    },
    {
      path: '/public/portal/desprendibles',
      label: 'Pagos',
      shortLabel: 'Pagos',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
    }
  ];

  $: currentPath = $page.url.pathname;

  /**
   * Cierre de sesión DELIBERADO: el único sitio que puede vaciar lo local.
   *
   * No se hace dentro de `portalSession.logout()` a propósito. Ese método lo
   * llaman también los manejadores de 401 de medio portal, y un token vencido a
   * mitad de una inspección borraría el trabajo que todavía no salió del móvil.
   *
   * Aun aquí se pregunta antes: mientras queden borradores u operaciones en la
   * outbox no se borra nada, porque el dispositivo es la única copia. Lo que se
   * limpia es la caché de lectura —recibos, asignaciones, definiciones—, que es
   * lo que se le quedaba al siguiente conductor que entrara.
   */
  async function cerrarSesion() {
    try {
      if (!(await hayTrabajoPendiente())) await clearAll();
    } catch {
      /// Sin almacenamiento local no hay nada que limpiar, y desde luego no es
      /// motivo para dejar al conductor atrapado en la sesión.
    }
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

  /// «MONICA ANDREA» → «Monica»: los nombres llegan en mayúsculas desde la base.
  function primerNombre(nombre: string | null | undefined): string {
    const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
    return primero
      ? primero.charAt(0).toLocaleUpperCase('es') + primero.slice(1).toLocaleLowerCase('es')
      : 'Conductor';
  }

  function saludo(hora: number): string {
    if (hora < 12) return 'Buenos días';
    if (hora < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }
</script>

<svelte:head>
  <title>Portal del Conductor · Cotransmeq</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#14532d" />
</svelte:head>

<div class="portal">
  {#if !$isAuthenticated}
    <slot />
  {:else}
    <!-- ════════ BARRA SUPERIOR: sobre el verde de marca, como la app ════════ -->
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/public/portal/formularios" aria-label="Portal del conductor">
          <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="topbar-logo" />
          <span class="brand-tag">Portal del conductor</span>
        </a>

        <div class="topbar-right">
          <div class="conductor-chip" aria-label="Conductor autenticado">
            <div class="avatar">{initial($conductorNombre)}</div>
            <div class="chip-text">
              <span class="chip-name">{$conductorNombre || 'Conductor'}</span>
              <span class="chip-sub">CC {$conductorCedula} · {$diasRestantes} días</span>
            </div>
          </div>
          <button class="btn-salir" on:click={cerrarSesion} aria-label="Cerrar sesión" title="Cerrar sesión">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- ════════ MENÚ LATERAL (escritorio) + CONTENIDO ════════ -->
    <div class="main-layout">
      <nav class="sidebar" aria-label="Navegación del portal">
        <!-- El saludo del menú de la app: quién está y qué día es. -->
        <div class="sidebar-saludo">
          <span class="sidebar-saludo-hola">{saludo(new Date().getHours())},</span>
          <span class="sidebar-saludo-nombre">{primerNombre($conductorNombre)}</span>
          <span class="sidebar-saludo-cc">C.C. {$conductorCedula}</span>
        </div>

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
          <span class="sidebar-restantes">Sesión activa · {$diasRestantes} días restantes</span>
          <button class="sidebar-item sidebar-item--salir" on:click={cerrarSesion}>
            <span class="sidebar-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </span>
            <span class="sidebar-label">Cerrar sesión</span>
          </button>
        </div>
      </nav>

      <main class="content">
        <slot />
      </main>
    </div>

    <!-- ════════ BARRA INFERIOR (móvil) ════════ -->
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
     TOKENS — la paleta de la app móvil
     Los nombres antiguos (`--bg`, `--text-2`, `--emerald-600`…) se conservan
     porque las páginas los usan: aquí se remapean a los tokens `--au-*`.
  ═══════════════════════════════════════ */
  .portal {
    --bg: var(--au-bg, #effbf5);
    --surface: #ffffff;
    --surface-2: var(--au-tint, #ddf7ea);
    --border: var(--au-border, #dee7e3);
    --border-default: var(--au-border, #dee7e3);
    --border-hover: var(--au-primary, #079665);
    --text: var(--au-text, #17201d);
    --text-2: #33423d;
    --text-3: var(--au-muted, #66756f);
    --text-4: #8e9c96;
    --emerald-500: var(--au-primary, #079665);
    --emerald-600: var(--au-primary-strong, #087a57);
    --emerald-700: var(--au-dark-2, #075c49);
    --emerald-800: var(--au-dark, #014339);
    --emerald-50: var(--au-bg, #effbf5);
    --emerald-200: var(--au-tint, #ddf7ea);
    --emerald-tint: rgba(var(--au-primary-rgb, 7, 150, 101), 0.1);
    --emerald-tint-hover: rgba(var(--au-primary-rgb, 7, 150, 101), 0.16);
    --emerald-border: rgba(var(--au-primary-rgb, 7, 150, 101), 0.25);
    --shadow-soft: 0 6px 14px rgba(1, 67, 57, 0.065);
    --shadow-card: 0 6px 14px rgba(1, 67, 57, 0.065);
    --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

    font-family: var(--font-sans);
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }

  :global(body) { margin: 0; overflow-x: hidden; background: var(--au-bg, #effbf5); }
  :global(html) { overflow-x: hidden; }
  * { box-sizing: border-box; }

  /* ═══════════════════════════════════════
     BARRA SUPERIOR
  ═══════════════════════════════════════ */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--au-dark, #014339);
    color: #fff;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 64px;
    padding: 0 1rem;
    padding-top: env(safe-area-inset-top, 0);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    text-decoration: none;
    line-height: 1;
  }

  .topbar-logo {
    height: 34px;
    width: auto;
    object-fit: contain;
    display: block;
  }

  .brand-tag {
    display: none;
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--au-eyebrow, #a9efcb);
    white-space: nowrap;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .conductor-chip {
    display: none;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.9rem 0.3rem 0.3rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    border: 1.5px solid rgba(255, 255, 255, 0.28);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .chip-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .chip-name {
    font-weight: 700;
    font-size: 0.8rem;
    color: #fff;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-sub {
    font-size: 0.66rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.62);
    letter-spacing: 0.02em;
  }

  .btn-salir {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    background: rgba(239, 68, 68, 0.16);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 12px;
    color: #fecaca;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .btn-salir svg {
    width: 16px;
    height: 16px;
  }
  .btn-salir:hover {
    background: #dc2626;
    border-color: #dc2626;
    color: #fff;
  }

  /* ═══════════════════════════════════════
     DISPOSICIÓN
  ═══════════════════════════════════════ */
  .main-layout {
    display: flex;
    min-height: calc(100vh - 64px);
    min-height: calc(100dvh - 64px);
  }

  /* ═══════════════════════════════════════
     MENÚ LATERAL (escritorio): el menú de la app
  ═══════════════════════════════════════ */
  .sidebar {
    display: none;
    position: sticky;
    top: 64px;
    align-self: flex-start;
    height: calc(100vh - 64px);
    height: calc(100dvh - 64px);
    width: 250px;
    flex-shrink: 0;
    background: var(--au-dark, #014339);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    flex-direction: column;
    color: #fff;
  }

  .sidebar-saludo {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 1.35rem 1.35rem 1.2rem;
    overflow: hidden;
    background: linear-gradient(160deg, var(--au-dark-2, #075c49) 0%, var(--au-dark, #014339) 100%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .sidebar-saludo::before,
  .sidebar-saludo::after {
    content: '';
    position: absolute;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
  }
  .sidebar-saludo::before {
    width: 150px;
    height: 150px;
    right: -40px;
    top: -60px;
  }
  .sidebar-saludo::after {
    width: 70px;
    height: 70px;
    left: -22px;
    bottom: -30px;
  }
  .sidebar-saludo-hola {
    position: relative;
    font-size: 0.82rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
  }
  .sidebar-saludo-nombre {
    position: relative;
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sidebar-saludo-cc {
    position: relative;
    align-self: flex-start;
    margin-top: 0.5rem;
    padding: 3px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 0.68rem;
    font-weight: 700;
    color: #fff;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem 0.85rem;
    flex: 1;
    overflow-y: auto;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.7rem 0.85rem;
    border: 1px solid transparent;
    border-radius: 14px;
    background: transparent;
    color: rgba(255, 255, 255, 0.68);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s var(--ease);
  }
  .sidebar-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .sidebar-item.active {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.28);
    color: #fff;
    font-weight: 700;
  }
  .sidebar-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
  .sidebar-icon svg {
    width: 20px;
    height: 20px;
  }
  .sidebar-label { white-space: nowrap; }

  .sidebar-footer {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .sidebar-restantes {
    padding: 0 0.85rem;
    font-size: 0.66rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
  }
  .sidebar-item--salir {
    color: #fca5a5;
  }
  .sidebar-item--salir:hover {
    background: rgba(239, 68, 68, 0.14);
    color: #fecaca;
  }

  /* ═══════════════════════════════════════
     CONTENIDO
  ═══════════════════════════════════════ */
  .content {
    flex: 1;
    min-width: 0;
    padding: 0.75rem 1rem;
    padding-bottom: calc(1rem + 72px + env(safe-area-inset-bottom, 0));
    overflow-x: hidden;
  }

  /* ═══════════════════════════════════════
     BARRA INFERIOR (móvil)
  ═══════════════════════════════════════ */
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0));
    background: #fff;
    border-top: 1px solid var(--border);
    box-shadow: 0 -8px 24px rgba(1, 67, 57, 0.06);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.35rem 0;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: var(--text-3);
    font-family: inherit;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: color 0.2s var(--ease);
    -webkit-tap-highlight-color: transparent;
  }
  .bottom-nav-item.active {
    color: var(--au-dark, #014339);
  }
  .bottom-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 28px;
    border-radius: 999px;
    transition: background-color 0.2s var(--ease);
  }
  .bottom-nav-item.active .bottom-icon {
    background: var(--au-tint, #ddf7ea);
  }
  .bottom-icon svg {
    width: 20px;
    height: 20px;
  }

  /* ═══════════════════════════════════════
     RESPONSIVE
  ═══════════════════════════════════════ */
  @media (min-width: 640px) {
    .brand-tag { display: inline; }
    .conductor-chip { display: flex; }
    .topbar-inner { padding: 0 1.25rem; }
  }

  @media (min-width: 768px) {
    .sidebar { display: flex; }
    .bottom-nav { display: none; }
    .content { padding: 1.25rem 1.5rem 2rem; }
  }

  @media (min-width: 1024px) {
    .sidebar { width: 270px; }
    .content { padding: 1.5rem 2rem 2.5rem; }
  }
</style>
