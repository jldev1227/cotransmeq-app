<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { portalSession, isAuthenticated, getApiBase } from '$lib/stores/portalStore';

  const LOGO_SRC = '/assets/logo.png';
  const THEME_KEY = 'cotransmeq_portal_theme';
  const TOKEN_DAYS = 30;

  let dark = false;
  let authStep: 'cedula' | 'email_sent' | 'verificando' = 'cedula';
  let cedulaInput = '';
  let cedulaError = '';
  let emailHidden = '';
  let loadingAuth = false;

  function toggleTheme() {
    dark = !dark;
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }

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

      const desprendibleId = browser ? new URL(window.location.href).searchParams.get('desprendible') : null;

      if (browser) {
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('desprendible');
        window.history.replaceState({}, '', url.toString());
      }

      const redirectUrl = desprendibleId
        ? `/public/portal/desprendibles?highlight=${encodeURIComponent(desprendibleId)}`
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

  onMount(async () => {
    const saved = localStorage.getItem(THEME_KEY);
    dark = saved === 'dark';

    const desprendibleParam = $page.url.searchParams.get('desprendible');

    if ($isAuthenticated) {
      const redirectUrl = desprendibleParam
        ? `/public/portal/desprendibles?highlight=${encodeURIComponent(desprendibleParam)}`
        : '/public/portal/desprendibles';
      goto(redirectUrl);
      return;
    }

    const urlToken = $page.url.searchParams.get('token');
    if (urlToken) {
      await verificarTokenFromUrl(urlToken);
    }
  });
</script>

<div class="page" class:dark>
  <button class="theme-fab" on:click={toggleTheme} title="Cambiar tema" aria-label="Cambiar tema">
    {#if dark}☀️{:else}🌙{/if}
  </button>

  {#if authStep === 'verificando'}
    <div class="auth-card">
      <div class="auth-logo-wrap">
        <img src={LOGO_SRC} alt="Cotransmeq" class="auth-logo-img"
          on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
      </div>
      <div class="loading-state">
        <span class="spinner-lg"></span>
        <p class="loading-text">Verificando acceso...</p>
      </div>
    </div>

  {:else if authStep === 'email_sent'}
    <div class="auth-card" style="text-align:center;">
      <div class="auth-logo-wrap">
        <img src={LOGO_SRC} alt="Cotransmeq" class="auth-logo-img"
          on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
      </div>
      <div class="email-icon">📧</div>
      <h1 class="auth-title">Revisa tu<br/>correo</h1>
      <p class="auth-sub" style="text-align:center;">
        Hemos enviado un enlace de acceso a<br/>
        <strong class="email-addr">{emailHidden}</strong>
      </p>
      <div class="auth-note">
        💡 Revisa bandeja de entrada y spam.<br/>
        El enlace es válido por <strong class="accent">{TOKEN_DAYS} días</strong>.
      </div>
      <button class="btn-secondary" on:click={() => { authStep = 'cedula'; cedulaError = ''; }}>
        ← Volver a intentar
      </button>
    </div>

  {:else}
    <div class="auth-card">
      <div class="auth-logo-wrap">
        <img src={LOGO_SRC} alt="Cotransmeq" class="auth-logo-img"
          on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
      </div>

      <h1 class="auth-title">Portal del<br/>Conductor</h1>
      <p class="auth-sub">
        Ingresa tu número de cédula para acceder a tus <strong>desprendibles</strong> y <strong>reporte diario</strong>.
      </p>

      <div class="features-row">
        <div class="feature-chip">📄 Desprendibles</div>
        <div class="feature-chip">📅 Días Laborados</div>
      </div>

      <label for="cedula" class="input-label">Número de cédula</label>
      <input
        id="cedula" type="tel" inputmode="numeric"
        class="cedula-input" class:input-error={cedulaError}
        bind:value={cedulaInput}
        on:keydown={handleKey}
        placeholder="· · · · · · · ·"
        maxlength="12" autocomplete="off"
      />
      {#if cedulaError}
        <p class="error-msg">⚠ {cedulaError}</p>
      {/if}

      <button class="btn-primary" on:click={solicitarAcceso} disabled={loadingAuth}>
        {#if loadingAuth}
          <span class="spinner"></span> Verificando...
        {:else}
          Solicitar acceso →
        {/if}
      </button>

      <div class="auth-note">
        📧 Recibirás un enlace de acceso en tu correo registrado.<br/>
        🔒 Sesión activa por <strong class="accent">{TOKEN_DAYS} días</strong>.
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    --bg: #f1f5f9;
    --surface: #ffffff;
    --border: #e2e8f0;
    --text: #0f172a;
    --text2: #475569;
    --text3: #94a3b8;
    --accent-color: #EA580C;
    --accent-dark: #C2410C;
    --accent2: #1e40af;
    --input-bg: #f8fafc;

    font-family: 'Barlow', sans-serif;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 1rem;
    position: relative;
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, #EA580C15 0%, transparent 60%),
      var(--bg);
    color: var(--text);
    transition: background .25s, color .25s;
  }

  .page.dark {
    --bg: #0f172a;
    --surface: #1e293b;
    --border: #334155;
    --text: #f1f5f9;
    --text2: #94a3b8;
    --text3: #64748b;
    --input-bg: #0f172a;
  }

  :global(body) { margin: 0; }
  * { box-sizing: border-box; }

  .theme-fab {
    position: fixed;
    top: 1rem;
    right: 1rem;
    width: 40px; height: 40px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 50%; font-size: 1.1rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    z-index: 10;
    transition: transform .15s;
  }
  .theme-fab:active { transform: scale(0.9); }

  .auth-card {
    width: 100%;
    max-width: 400px;
    background: var(--surface);
    border-radius: 20px;
    padding: 2rem 1.75rem;
    box-shadow: 0 4px 32px rgba(0,0,0,0.08);
    border: 1px solid var(--border);
  }

  .auth-logo-wrap {
    text-align: center;
    margin-bottom: 1.25rem;
  }
  .auth-logo-img { height: 50px; width: auto; }

  .auth-title {
    text-align: center;
    font-size: 2rem;
    font-weight: 800;
    line-height: 1.15;
    margin: 0 0 0.5rem;
    background: linear-gradient(135deg, #EA580C, #C2410C);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .auth-sub {
    text-align: center;
    color: var(--text2);
    font-size: 0.92rem;
    line-height: 1.5;
    margin: 0 0 1.25rem;
  }

  .features-row {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .feature-chip {
    padding: 0.35rem 0.85rem;
    background: #FFF7ED;
    border: 1px solid #FDBA74;
    border-radius: 99px;
    font-size: 0.78rem;
    font-weight: 600;
    color: #9A3412;
  }

  .page.dark .feature-chip {
    background: #431407;
    border-color: #EA580C;
    color: #FDBA74;
  }

  .input-label {
    display: block;
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--text2);
    margin-bottom: 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .cedula-input {
    width: 100%;
    padding: 0.85rem 1rem;
    border: 2px solid var(--border);
    border-radius: 12px;
    font-size: 1.2rem;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    letter-spacing: 0.15em;
    background: var(--input-bg);
    color: var(--text);
    text-align: center;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .cedula-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.12);
  }
  .cedula-input.input-error { border-color: #ef4444; }

  .error-msg {
    color: #ef4444;
    font-size: 0.82rem;
    font-weight: 600;
    margin: 0.4rem 0 0;
    text-align: center;
  }

  .btn-primary {
    width: 100%;
    margin-top: 1rem;
    padding: 0.85rem;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, #EA580C, #C2410C);
    color: #fff;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: transform .1s, box-shadow .2s;
    box-shadow: 0 2px 12px rgba(234, 88, 12, 0.25);
  }
  .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(234, 88, 12, 0.35); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { opacity: 0.6; cursor: wait; }

  .btn-secondary {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.6rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text2);
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    transition: all .15s;
  }
  .btn-secondary:hover { background: var(--input-bg); }

  .auth-note {
    margin-top: 1.25rem;
    font-size: 0.78rem;
    color: var(--text3);
    text-align: center;
    line-height: 1.65;
  }
  .accent { color: var(--accent-color); }
  .email-addr { color: var(--accent-color); font-family: 'JetBrains Mono', monospace; font-size: 0.88rem; }
  .email-icon { font-size: 3rem; margin-bottom: 1rem; }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem 0;
  }
  .loading-text { color: var(--text2); font-size: 0.95rem; margin: 0; }

  .spinner-lg {
    width: 40px; height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
