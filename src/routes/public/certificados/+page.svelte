<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { certificadosPublicTerceroAPI } from '$lib/api/certificadosTercero';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  const LOGO_SRC = '/assets/logo_nombre.webp';
  const TOKEN_DAYS = 90;

  let authStep: 'identificacion' | 'email_sent' | 'verificando' | 'portal' = 'identificacion';
  let identificacionInput = '';
  let identificacionError = '';
  let emailHidden = '';
  let loadingAuth = false;
  let mounted = false;

  let tercero: any = null;
  let certificados: any[] = [];
  let tokenExpiresAt = '';

  function validarIdentificacion(v: string) {
    if (!v.trim()) return 'Ingresa tu número de identificación';
    if (!/^\d{5,15}$/.test(v.trim())) return 'La identificación debe tener entre 5 y 15 dígitos';
    return '';
  }

  async function solicitarAcceso() {
    identificacionError = validarIdentificacion(identificacionInput);
    if (identificacionError) return;
    loadingAuth = true;
    try {
      const res = await certificadosPublicTerceroAPI.solicitarAcceso(identificacionInput.trim());
      emailHidden = res.data.email || '';
      authStep = 'email_sent';
    } catch (err: any) {
      identificacionError = err?.response?.data?.error || err?.message || 'Error al solicitar acceso';
    } finally {
      loadingAuth = false;
    }
  }

  async function verificarTokenFromUrl(token: string) {
    authStep = 'verificando';
    loadingAuth = true;
    try {
      const res = await certificadosPublicTerceroAPI.verificarToken(token);
      tercero = res.data.tercero;
      certificados = res.data.certificados;
      tokenExpiresAt = res.data.expires_at;
      authStep = 'portal';

      if (browser) {
        localStorage.setItem('certificados_access_token', token);
      }
    } catch (err: any) {
      identificacionError = err?.response?.data?.error || 'Enlace inválido o expirado. Solicita un nuevo acceso.';
      authStep = 'identificacion';
    } finally {
      loadingAuth = false;
    }
  }

  function handleKey(e: KeyboardEvent) { if (e.key === 'Enter') solicitarAcceso(); }

  function cerrarSesion() {
    if (browser) localStorage.removeItem('certificados_access_token');
    authStep = 'identificacion';
    tercero = null;
    certificados = [];
    tokenExpiresAt = '';
  }

  function formatTipo(codigo: string): string {
    const map: Record<string, string> = {
      RETEFUENTE: 'Retefuente',
      RETEICA: 'Reteica',
      RETEIVA: 'Reteiva',
      ICA: 'ICA',
      IVA: 'IVA',
      RETENCIONES: 'Retenciones',
      OTROS: 'Otros'
    };
    return map[codigo] || codigo;
  }

  function initial(name: string | null | undefined): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
  }

  function formatEmail(email: string): string {
    if (!email) return '';
    const [user, domain] = email.split('@');
    if (!user || !domain) return email;
    const visible = user.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
  }

  function formatDate(iso?: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return '—';
    }
  }

  onMount(async () => {
    let urlToken: string | null = null;
    if (browser) {
      const params = new URLSearchParams(window.location.search);
      urlToken = params.get('token');
    }
    if (!urlToken) {
      urlToken = $page.url.searchParams.get('token');
    }
    if (urlToken) {
      await verificarTokenFromUrl(urlToken);
    }
    mounted = true;
  });
</script>

<svelte:head>
  <title>Portal de Certificados · Cotransmeq S.A.S</title>
  <meta name="description" content="Acceso al portal de certificados tributarios de Cotransmeq S.A.S" />
</svelte:head>

{#if mounted}
  <div class="page" in:fade={{ duration: 300 }}>
    <!-- Ambient orbs -->
    <div class="orbs" aria-hidden="true">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
    </div>

    <div class="auth-shell" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
      {#if authStep === 'verificando'}
        <div class="auth-card">
          <div class="auth-head">
            <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="auth-logo" />
          </div>
          <div class="state-block" in:fade={{ duration: 250 }}>
            <div class="state-icon">
              <span class="spinner-lg"></span>
            </div>
            <h1 class="state-title">Verificando acceso</h1>
            <p class="state-sub">Estamos validando tu enlace mágico.</p>
          </div>
        </div>

      {:else if authStep === 'email_sent'}
        <div class="auth-card" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
          <div class="auth-head">
            <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="auth-logo" />
          </div>
          <div class="state-block">
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

            <button class="btn-secondary" on:click={() => { authStep = 'identificacion'; identificacionError = ''; }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Volver a intentar
            </button>
          </div>
        </div>

      {:else if authStep === 'portal' && tercero}
        <div class="auth-card auth-card--wide" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
          <div class="auth-head">
            <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="auth-logo" />
            <button class="btn-logout" on:click={cerrarSesion} aria-label="Cerrar sesión">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Salir</span>
            </button>
          </div>

          <div class="welcome-block">
            <div class="welcome-avatar">{initial(tercero.nombre_completo)}</div>
            <div class="welcome-info">
              <p class="welcome-greeting">¡Hola!</p>
              <h1 class="welcome-name">{tercero.nombre_completo}</h1>
              <p class="welcome-id">CC {tercero.identificacion}</p>
            </div>
          </div>

          <aside class="hint-card hint-card--info">
            <span class="hint-label">Sesión</span>
            <p>
              Acceso válido hasta el
              <strong>{formatDate(tokenExpiresAt)}</strong>.
            </p>
          </aside>

          {#if certificados.length === 0}
            <div class="empty-state" in:fade={{ duration: 250 }}>
              <div class="empty-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 class="empty-title">Sin certificados disponibles</h2>
              <p class="empty-sub">Aún no tienes certificados cargados en el sistema.</p>
            </div>
          {:else}
            <div class="certs-list">
              {#each certificados as cert (cert.id)}
                <div class="cert-item">
                  <div class="cert-info">
                    <div class="cert-tipo">
                      <span class="cert-tipo-label">{formatTipo(cert.tipo_certificado?.codigo || cert.tipo || 'Certificado')}</span>
                      <span class="cert-year">
                        Año <span class="meta-mono">{cert.anio}</span>
                      </span>
                    </div>
                  </div>
                  {#if cert.url}
                    <a href={cert.url} target="_blank" rel="noopener noreferrer" class="btn-download" title="Descargar">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      <span>Descargar</span>
                    </a>
                  {:else}
                    <span class="cert-na">—</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

      {:else}
        <div class="auth-card" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
          <div class="auth-head">
            <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="auth-logo" />
          </div>

          <span class="eyebrow">Acceso seguro</span>
          <h1 class="auth-title">Portal de<br />Certificados</h1>
          <p class="auth-sub">
            Ingresa tu número de identificación para acceder a tus
            <strong>certificados tributarios</strong>.
          </p>

          <ul class="features">
            <li>
              <span class="feature-mark">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              Certificados tributarios
            </li>
            <li>
              <span class="feature-mark">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              Descarga directa en PDF
            </li>
            <li>
              <span class="feature-mark">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              Acceso seguro y cifrado
            </li>
          </ul>

          <div class="field">
            <label for="identificacion" class="field-label">Número de identificación</label>
            <input
              id="identificacion"
              type="tel"
              inputmode="numeric"
              class="cedula-input"
              class:input-error={identificacionError}
              bind:value={identificacionInput}
              on:keydown={handleKey}
              placeholder="00000000"
              maxlength="15"
              autocomplete="off"
            />
            {#if identificacionError}
              <p class="error-msg" in:fly={{ y: -4, duration: 200 }}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {identificacionError}
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
              Recibirás un enlace de acceso en tu correo registrado. La sesión permanece activa
              durante <strong>{TOKEN_DAYS} días</strong>.
            </p>
          </aside>
        </div>
      {/if}

      <p class="footer-copy">
        © {new Date().getFullYear()} Cotransmeq S.A.S · Yopal, Casanare · Colombia
      </p>
    </div>
  </div>
{/if}

<style>
  .page {
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

  .auth-card--wide {
    max-width: 560px;
  }

  .auth-head {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 1.5rem;
    position: relative;
  }

  .auth-logo {
    height: 44px;
    width: auto;
    display: block;
  }

  .btn-logout {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.7rem;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: #4a4a4a;
    background: #faf7f2;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .btn-logout svg {
    width: 14px;
    height: 14px;
  }
  .btn-logout:hover {
    background: rgba(220, 38, 38, 0.04);
    border-color: rgba(220, 38, 38, 0.2);
    color: #b91c1c;
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
  .state-icon--success {
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #ffffff;
    box-shadow: 0 8px 24px rgba(249, 115, 22, 0.3);
  }
  .state-icon svg {
    width: 28px;
    height: 28px;
  }
  .state-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.4rem;
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
  .hint-card--info {
    margin-top: 0.5rem;
    margin-bottom: 1.5rem;
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

  .welcome-block {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .welcome-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1.1rem;
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
    flex-shrink: 0;
  }
  .welcome-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .welcome-greeting {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #f97316;
    margin: 0;
  }
  .welcome-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.2rem;
    font-weight: 500;
    color: #0f1f1a;
    margin: 0.15rem 0 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }
  .welcome-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    color: #6b6b6b;
    margin: 0.15rem 0 0;
    letter-spacing: 0.04em;
  }

  .certs-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .cert-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0.9rem;
    background: #faf7f2;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px;
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .cert-item:hover {
    border-color: rgba(249, 115, 22, 0.3);
    background: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.08);
  }
  .cert-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .cert-tipo {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .cert-tipo-label {
    font-size: 0.88rem;
    font-weight: 600;
    color: #0f1f1a;
  }
  .cert-year {
    font-size: 0.78rem;
    color: #6b6b6b;
  }
  .meta-mono {
    font-family: 'JetBrains Mono', monospace;
    color: #0f1f1a;
    font-weight: 600;
  }
  .btn-download {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.85rem;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #ffffff;
    border-radius: 8px;
    text-decoration: none;
    font-size: 0.78rem;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    flex-shrink: 0;
  }
  .btn-download:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(249, 115, 22, 0.35);
  }
  .btn-download svg {
    width: 14px;
    height: 14px;
  }
  .cert-na {
    font-size: 0.8rem;
    color: #9a9a9a;
    padding: 0 0.5rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 2.5rem 1.5rem;
    background: #faf7f2;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    text-align: center;
  }
  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(249, 115, 22, 0.08);
    color: #f97316;
    margin-bottom: 0.3rem;
  }
  .empty-icon svg {
    width: 22px;
    height: 22px;
  }
  .empty-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1rem;
    font-weight: 500;
    color: #0f1f1a;
    margin: 0;
  }
  .empty-sub {
    font-size: 0.82rem;
    color: #6b6b6b;
    margin: 0;
    max-width: 320px;
  }

  .footer-copy {
    font-size: 0.72rem;
    color: #9a9a9a;
    text-align: center;
    margin: 0;
    line-height: 1.5;
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
    width: 32px;
    height: 32px;
    border: 3px solid rgba(249, 115, 22, 0.15);
    border-top-color: #f97316;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 480px) {
    .auth-card {
      padding: 1.75rem 1.25rem 1.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .auth-card,
    .btn-primary,
    .btn-secondary,
    .cedula-input,
    .cert-item {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
