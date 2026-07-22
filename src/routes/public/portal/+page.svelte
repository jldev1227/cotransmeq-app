<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { portalSession, isAuthenticated, getApiBase } from '$lib/stores/portalStore';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  const LOGO_SRC = '/assets/logo_nombre.webp';
  const TOKEN_DAYS = 30;

  let authStep: 'cedula' | 'email_sent' | 'verificando' = 'cedula';
  let cedulaInput = '';
  let cedulaError = '';
  let emailHidden = '';
  let loadingAuth = false;
  let mounted = false;

  function validarCedula(v: string) {
    if (!v.trim()) return 'Ingresa tu número de cédula';
    if (!/^\d{5,12}$/.test(v.trim())) return 'La cédula debe tener entre 5 y 12 dígitos';
    return '';
  }

  async function solicitarAcceso() {
    cedulaError = validarCedula(cedulaInput);
    if (cedulaError) return;
    loadingAuth = true;
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/conductor-portal/solicitar-acceso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_identificacion: cedulaInput.trim() })
      });
      const json = await res.json();
      if (!res.ok) {
        cedulaError = json.message || 'Error al solicitar acceso';
        return;
      }
      emailHidden = json.email || '';
      authStep = 'email_sent';
    } catch (err: any) {
      cedulaError = err.message || 'Error de conexión';
    } finally {
      loadingAuth = false;
    }
  }

  async function verificarTokenFromUrl(token: string) {
    authStep = 'verificando';
    loadingAuth = true;
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/conductor-portal/verificar-token?token=${encodeURIComponent(token)}`);
      const json = await res.json();

      if (!res.ok) {
        cedulaError = json.message || 'Enlace inválido o expirado.';
        authStep = 'cedula';
        loadingAuth = false;
        return;
      }

      const data = json.data;
      portalSession.login({
        token: data.token,
        conductor: data.conductor,
        expiresAt: data.expires_at
      });

      const currentUrl = browser ? new URL(window.location.href) : null;
      const desprendibleId = currentUrl?.searchParams.get('desprendible') || null;
      const primaId = currentUrl?.searchParams.get('prima') || null;
      const tabParam = currentUrl?.searchParams.get('tab') || null;

      if (browser) {
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('desprendible');
        url.searchParams.delete('prima');
        url.searchParams.delete('tab');
        window.history.replaceState({}, '', url.toString());
      }

      const targetParams = new URLSearchParams();
      if (desprendibleId) targetParams.set('highlight', desprendibleId);
      if (primaId) targetParams.set('highlight_prima', primaId);
      if (tabParam) targetParams.set('tab', tabParam);
      const qs = targetParams.toString();
      const redirectUrl = qs
        ? `/public/portal/desprendibles?${qs}`
        : '/public/portal/desprendibles';
      goto(redirectUrl);
    } catch (err: any) {
      cedulaError = 'Enlace inválido o expirado. Solicita un nuevo acceso.';
      authStep = 'cedula';
    } finally {
      loadingAuth = false;
    }
  }

  function handleKey(e: KeyboardEvent) { if (e.key === 'Enter') solicitarAcceso(); }

  function formatEmail(email: string): string {
    if (!email) return '';
    const [user, domain] = email.split('@');
    if (!user || !domain) return email;
    const visible = user.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
  }

  onMount(async () => {
    const currentUrl = new URL(window.location.href);
    const desprendibleParam = currentUrl.searchParams.get('desprendible');
    const primaParam = currentUrl.searchParams.get('prima');
    const tabParam = currentUrl.searchParams.get('tab');

    const urlToken = $page.url.searchParams.get('token');

    // PRIORIDAD 1: Si hay un token en la URL, SIEMPRE validarlo.
    // El enlace mágico es una credencial fresca y debe reemplazar
    // cualquier sesión guardada (ej: de un login anterior en el mismo
    // navegador). Sin esto, un usuario con sesión activa en localStorage
    // nunca podría re-autenticarse con un nuevo enlace y la página se
    // quedaba en blanco (mounted=false) sin enviar request al backend.
    if (urlToken) {
      mounted = true;
      await verificarTokenFromUrl(urlToken);
      return;
    }

    // PRIORIDAD 2: Sin token en URL pero ya autenticado → ir al dashboard
    if ($isAuthenticated) {
      const targetParams = new URLSearchParams();
      if (desprendibleParam) targetParams.set('highlight', desprendibleParam);
      if (primaParam) targetParams.set('highlight_prima', primaParam);
      if (tabParam) targetParams.set('tab', tabParam);
      const qs = targetParams.toString();
      const redirectUrl = qs
        ? `/public/portal/desprendibles?${qs}`
        : '/public/portal/desprendibles';
      goto(redirectUrl);
      return;
    }

    // PRIORIDAD 3: Sin token y sin sesión → mostrar formulario
    mounted = true;
  });
</script>

<svelte:head>
  <title>Portal del Conductor · Cotransmeq S.A.S</title>
  <meta name="description" content="Acceso al portal del conductor de Cotransmeq S.A.S. Consulta tus desprendibles, servicios y días laborados." />
</svelte:head>

{#if mounted}
  <div class="portal-page" in:fade={{ duration: 300 }}>
    <!-- Ambient orbs (sutiles, editorial) -->
    <div class="orbs" aria-hidden="true">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
    </div>

    <div class="auth-shell" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
      <div class="auth-card">
        <div class="auth-head">
          <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="auth-logo" />
        </div>

        {#if authStep === 'verificando'}
          <div class="state-block" in:fade={{ duration: 250 }}>
            <div class="state-icon">
              <span class="spinner-lg"></span>
            </div>
            <h1 class="state-title">Verificando acceso</h1>
            <p class="state-sub">Estamos validando tu enlace mágico.</p>
          </div>

        {:else if authStep === 'email_sent'}
          <div class="state-block" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
            <div class="state-icon state-icon--success">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span class="eyebrow">Enlace enviado</span>
            <h1 class="auth-title">Revisa tu correo</h1>
            <p class="auth-sub">
              Hemos enviado un enlace de acceso a
              <strong class="email-addr">{formatEmail(emailHidden)}</strong>
            </p>

            <aside class="hint-card">
              <span class="hint-label">Importante</span>
              <p>
                Revisa tu bandeja de entrada y la carpeta de spam. El enlace es válido por
                <strong>{TOKEN_DAYS} días</strong>.
              </p>
            </aside>

            <button class="btn-secondary" on:click={() => { authStep = 'cedula'; cedulaError = ''; }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Volver a intentar
            </button>
          </div>

        {:else}
          <div class="state-block" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
            <span class="eyebrow">Acceso seguro</span>
            <h1 class="auth-title">Portal del<br />Conductor</h1>
            <p class="auth-sub">
              Ingresa tu número de cédula para acceder a tus
              <strong>desprendibles</strong>, <strong>servicios</strong> y
              <strong>reporte diario</strong>.
            </p>

            <ul class="features">
              <li>
                <span class="feature-mark">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Desprendibles de pago
              </li>
              <li>
                <span class="feature-mark">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Mis servicios asignados
              </li>
              <li>
                <span class="feature-mark">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Días laborados
              </li>
            </ul>

            <div class="field">
              <label for="cedula" class="field-label">Número de cédula</label>
              <input
                id="cedula"
                type="tel"
                inputmode="numeric"
                class="cedula-input"
                class:input-error={cedulaError}
                bind:value={cedulaInput}
                on:keydown={handleKey}
                placeholder="00000000"
                maxlength="12"
                autocomplete="off"
              />
              {#if cedulaError}
                <p class="error-msg" in:fly={{ y: -4, duration: 200 }}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  {cedulaError}
                </p>
              {/if}
            </div>

            <button class="btn-primary" on:click={solicitarAcceso} disabled={loadingAuth}>
              {#if loadingAuth}
                <span class="spinner"></span>
                Enviando enlace…
              {:else}
                Solicitar acceso
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              {/if}
            </button>

            <aside class="hint-card">
              <span class="hint-label">Cómo funciona</span>
              <p>
                Recibirás un enlace de acceso en tu correo registrado. La sesión
                permanece activa durante <strong>{TOKEN_DAYS} días</strong>.
              </p>
            </aside>
          </div>
        {/if}
      </div>

      <p class="footer-copy">
        © {new Date().getFullYear()} Cotransmeq S.A.S · Yopal, Casanare · Colombia
      </p>
    </div>
  </div>
{/if}

<style>
  .portal-page {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 1rem;
    background-color: #faf7f2;
    font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  .orbs {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
  }
  .orb-1 {
    top: -8rem;
    right: -6rem;
    width: 28rem;
    height: 28rem;
    background: rgba(249, 115, 22, 0.18);
  }
  .orb-2 {
    bottom: -10rem;
    left: -8rem;
    width: 32rem;
    height: 32rem;
    background: rgba(249, 115, 22, 0.12);
  }

  .auth-shell {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .auth-card {
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 24px;
    padding: 2.25rem 1.75rem 2rem;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.04),
      0 20px 60px rgba(15, 31, 26, 0.08);
  }

  .auth-head {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .auth-logo {
    height: 44px;
    width: auto;
    display: block;
  }

  .state-block {
    display: flex;
    flex-direction: column;
  }

  .state-icon {
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(249, 115, 22, 0.08);
    color: #f97316;
    margin-bottom: 1rem;
  }
  .state-icon svg {
    width: 28px;
    height: 28px;
  }
  .state-icon--success {
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #ffffff;
    box-shadow: 0 8px 24px rgba(249, 115, 22, 0.3);
  }

  .eyebrow {
    display: inline-block;
    align-self: flex-start;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #f97316;
    background: rgba(249, 115, 22, 0.08);
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    margin-bottom: 0.75rem;
  }

  .auth-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.75rem, 5vw, 2.15rem);
    font-weight: 400;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #0f1f1a;
    margin: 0 0 0.6rem;
  }

  .auth-sub {
    font-size: 0.9rem;
    line-height: 1.55;
    color: #4a4a4a;
    margin: 0 0 1.25rem;
  }
  .auth-sub strong {
    color: #0f1f1a;
    font-weight: 600;
  }

  .email-addr {
    font-family: 'JetBrains Mono', monospace;
    color: #065f46;
    background: rgba(249, 115, 22, 0.08);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.88em;
    font-weight: 700;
  }

  .features {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .features li {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-size: 0.85rem;
    color: #1a1a1a;
  }
  .feature-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    background: rgba(249, 115, 22, 0.12);
    color: #f97316;
    flex-shrink: 0;
  }
  .feature-mark svg {
    width: 12px;
    height: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.25rem;
  }

  .field-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6b6b6b;
  }

  .cedula-input {
    width: 100%;
    padding: 0.85rem 1rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: #0f1f1a;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    text-align: center;
    outline: none;
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .cedula-input::placeholder {
    color: #9a9a9a;
    letter-spacing: 0.3em;
  }
  .cedula-input:hover:not(:disabled) {
    border-color: rgba(0, 0, 0, 0.2);
  }
  .cedula-input:focus {
    border-color: #f97316;
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
  }
  .cedula-input.input-error {
    border-color: rgba(220, 38, 38, 0.45);
    background: rgba(220, 38, 38, 0.03);
  }

  .error-msg {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: #991b1b;
    font-size: 0.78rem;
    font-weight: 600;
    margin: 0;
  }
  .error-msg svg {
    width: 14px;
    height: 14px;
    color: #dc2626;
    flex-shrink: 0;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.85rem 1.25rem;
    margin-top: 0.75rem;
    font-family: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    color: #ffffff;
    background: linear-gradient(135deg, #f97316, #ea580c);
    border: none;
    border-radius: 12px;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
  }
  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-primary svg {
    width: 16px;
    height: 16px;
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    align-self: center;
    margin-top: 0.5rem;
    padding: 0.6rem 1.1rem;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    color: #0f1f1a;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .btn-secondary:hover {
    background: #faf7f2;
    border-color: rgba(0, 0, 0, 0.2);
  }
  .btn-secondary svg {
    width: 14px;
    height: 14px;
  }

  .hint-card {
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.08));
    border: 1px solid rgba(249, 115, 22, 0.15);
    border-radius: 12px;
    padding: 0.85rem 1rem;
    margin-top: 1.25rem;
  }
  .hint-label {
    display: inline-block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #f97316;
    background: #ffffff;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.45rem;
  }
  .hint-card p {
    font-size: 0.78rem;
    line-height: 1.5;
    color: #065f46;
    margin: 0;
  }
  .hint-card strong {
    color: #047857;
    font-weight: 700;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
  .spinner-lg {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(249, 115, 22, 0.18);
    border-top-color: #f97316;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  .state-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.5rem;
    font-weight: 500;
    color: #0f1f1a;
    margin: 0 0 0.35rem;
    text-align: center;
  }
  .state-sub {
    font-size: 0.9rem;
    color: #4a4a4a;
    margin: 0;
    text-align: center;
  }

  .footer-copy {
    font-size: 0.72rem;
    color: #9a9a9a;
    text-align: center;
    margin: 0;
    line-height: 1.5;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 480px) {
    .auth-card {
      padding: 1.75rem 1.25rem 1.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .auth-card,
    .btn-primary,
    .btn-secondary,
    .cedula-input {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
