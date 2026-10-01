<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { portalSession, isAuthenticated, getApiBase } from '$lib/stores/portalStore';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { mascota } from '$lib/mascot';

  const LOGO_SRC = '/assets/logo_nombre_white.webp';
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
  <div class="acceso" in:fade={{ duration: 300 }}>
    <div class="acceso-shell" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
      <!-- Hero: el mismo bloque verde de la pantalla de entrada de la app -->
      <section class="hero">
        <span class="hero-orbe hero-orbe--grande" aria-hidden="true"></span>
        <span class="hero-orbe hero-orbe--chico" aria-hidden="true"></span>
        <img src={LOGO_SRC} alt="Cotransmeq S.A.S" class="hero-logo" />
        <div class="hero-copy">
          <span class="hero-eyebrow">Portal del conductor</span>
          {#if authStep === 'email_sent'}
            <h1 class="hero-titulo">¡Mensaje enviado!</h1>
            <p class="hero-sub">Tu acceso seguro ya va en camino.</p>
          {:else if authStep === 'verificando'}
            <h1 class="hero-titulo">Un momento…</h1>
            <p class="hero-sub">Estamos validando tu enlace de acceso.</p>
          {:else}
            <h1 class="hero-titulo">Bienvenido de vuelta</h1>
            <p class="hero-sub">Todo lo que necesitas para tu jornada, en un solo lugar.</p>
          {/if}
        </div>
        <img
          class="hero-mascota"
          src={mascota(authStep === 'email_sent' ? 'correoEnviado' : authStep === 'verificando' ? 'procesando' : 'bienvenida').src}
          alt={mascota(authStep === 'email_sent' ? 'correoEnviado' : authStep === 'verificando' ? 'procesando' : 'bienvenida').alt}
        />
      </section>

      <!-- Tarjeta blanca que monta sobre el hero -->
      <div class="tarjeta">
        {#if authStep === 'verificando'}
          <div class="estado" in:fade={{ duration: 250 }}>
            <span class="spinner-lg" aria-hidden="true"></span>
            <h2 class="tarjeta-titulo">Verificando acceso</h2>
            <p class="ayuda">Estamos validando tu enlace mágico.</p>
          </div>

        {:else if authStep === 'email_sent'}
          <div class="estado-bloque" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
            <span class="insignia">✓ Enlace enviado</span>
            <h2 class="tarjeta-titulo">Revisa tu correo</h2>
            <p class="ayuda">
              Enviamos un enlace temporal a
              <strong class="correo">{formatEmail(emailHidden)}</strong>.
            </p>
            <p class="nota">
              Puede tardar unos minutos. Revisa también la carpeta de correo no deseado.
              El enlace es válido por <strong>{TOKEN_DAYS} días</strong>.
            </p>
            <button class="btn-secundario" on:click={() => { authStep = 'cedula'; cedulaError = ''; }}>
              Usar otra cédula
            </button>
          </div>

        {:else}
          <div class="estado-bloque" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
            <h2 class="tarjeta-titulo">Ingresa a tu cuenta</h2>
            <p class="ayuda">Te enviaremos un enlace seguro al correo registrado.</p>

            <div class="campo">
              <label for="cedula" class="campo-label">Número de cédula</label>
              <input
                id="cedula"
                type="tel"
                inputmode="numeric"
                class="campo-input"
                class:campo-input--error={cedulaError}
                bind:value={cedulaInput}
                on:keydown={handleKey}
                placeholder="Ej. 1098765432"
                maxlength="12"
                autocomplete="off"
              />
              {#if cedulaError}
                <p class="error" in:fly={{ y: -4, duration: 200 }}>
                  <img src={mascota('advertencia').src} alt="" aria-hidden="true" class="error-mascota" />
                  <span>{cedulaError}</span>
                </p>
              {:else}
                <p class="nota">Solo números, entre 5 y 12 dígitos.</p>
              {/if}
            </div>

            <button class="btn-principal" on:click={solicitarAcceso} disabled={loadingAuth}>
              {#if loadingAuth}
                <span class="spinner" aria-hidden="true"></span>
                Enviando enlace…
              {:else}
                Continuar con mi cédula
              {/if}
            </button>

            <p class="nota nota--centrada">
              Podrás ver tus <strong>formularios</strong>, <strong>servicios</strong>,
              <strong>días laborados</strong> y <strong>pagos</strong>. La sesión dura
              <strong>{TOKEN_DAYS} días</strong>.
            </p>
          </div>
        {/if}
      </div>

      <p class="privacidad">Acceso protegido · Tu información se usa únicamente para validar tu identidad.</p>
      <p class="pie">© {new Date().getFullYear()} Cotransmeq S.A.S · Yopal, Casanare · Colombia</p>
    </div>
  </div>
{/if}

<style>
  .acceso {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem 1rem 2rem;
    background: var(--au-bg, #effbf5);
    font-family: var(--font-sans);
    color: var(--au-text, #17201d);
    -webkit-font-smoothing: antialiased;
  }
  .acceso-shell {
    width: 100%;
    max-width: 440px;
  }

  /* ── Hero ── */
  .hero {
    position: relative;
    min-height: 17rem;
    padding: 1.5rem;
    border-radius: 30px;
    background: linear-gradient(160deg, var(--au-dark-2, #075c49) 0%, var(--au-dark, #014339) 70%);
    color: #fff;
    overflow: hidden;
    isolation: isolate;
  }
  .hero-orbe {
    position: absolute;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    z-index: -1;
  }
  .hero-orbe--grande {
    width: 200px;
    height: 200px;
    right: -60px;
    top: -80px;
  }
  .hero-orbe--chico {
    width: 90px;
    height: 90px;
    left: -28px;
    bottom: -40px;
  }
  .hero-logo {
    display: block;
    height: 2.9rem;
    width: auto;
    max-width: 10rem;
    object-fit: contain;
  }
  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 67%;
    margin-top: 1.6rem;
  }
  .hero-eyebrow {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--au-eyebrow, #a9efcb);
  }
  .hero-titulo {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.85rem;
    font-weight: 900;
    letter-spacing: -0.035em;
    line-height: 1.12;
    color: #fff;
  }
  .hero-sub {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--au-hero-text, #d4f3e5);
  }
  .hero-mascota {
    position: absolute;
    right: -1rem;
    bottom: -0.6rem;
    width: 11.5rem;
    height: 11.5rem;
    object-fit: contain;
    pointer-events: none;
    z-index: 1;
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.25));
  }

  /* ── Tarjeta ── */
  .tarjeta {
    position: relative;
    z-index: 2;
    margin: -1.25rem 0.6rem 0;
    padding: 1.4rem;
    border-radius: 24px;
    background: #fff;
    box-shadow: 0 12px 20px rgba(1, 67, 57, 0.12);
  }
  .estado-bloque,
  .estado {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .estado {
    align-items: center;
    text-align: center;
    padding: 0.5rem 0;
  }
  .tarjeta-titulo {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--au-text, #17201d);
  }
  .ayuda {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--au-muted, #66756f);
  }
  .correo {
    color: var(--au-dark, #014339);
    font-weight: 800;
    word-break: break-all;
  }
  .nota {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--au-muted, #66756f);
  }
  .nota strong {
    color: var(--au-text, #17201d);
    font-weight: 700;
  }
  .nota--centrada {
    text-align: center;
  }
  .insignia {
    align-self: flex-start;
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    background: var(--au-tint, #ddf7ea);
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--au-dark, #014339);
  }

  .campo {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .campo-label {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--au-text, #17201d);
  }
  .campo-input {
    width: 100%;
    min-height: 3.5rem;
    padding: 0 1rem;
    border: 1.5px solid var(--au-border, #dee7e3);
    border-radius: 14px;
    background: #f7faf8;
    font-family: inherit;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--au-text, #17201d);
    font-variant-numeric: tabular-nums;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .campo-input::placeholder {
    color: #8e9c96;
    font-weight: 500;
    letter-spacing: 0;
  }
  .campo-input:focus {
    outline: none;
    border-color: var(--au-primary, #079665);
    box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb, 7, 150, 101), 0.12);
    background: #fff;
  }
  .campo-input--error {
    border-color: #b42318;
    background: #fff0ed;
  }
  .error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.4;
    color: #b42318;
  }
  .error-mascota {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .btn-principal {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 3.5rem;
    border: none;
    border-radius: 14px;
    background: var(--au-primary, #079665);
    font-family: inherit;
    font-size: 1rem;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    transition: background-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
  }
  .btn-principal:hover:not(:disabled) {
    background: var(--au-primary-strong, #087a57);
  }
  .btn-principal:active:not(:disabled) {
    transform: scale(0.99);
  }
  .btn-principal:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
  .btn-secundario {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 3.1rem;
    border: 1.5px solid var(--au-primary, #079665);
    border-radius: 14px;
    background: transparent;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--au-dark, #014339);
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .btn-secundario:hover {
    background: var(--au-tint, #ddf7ea);
  }

  .spinner,
  .spinner-lg {
    display: inline-block;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: girar 0.8s linear infinite;
  }
  .spinner {
    width: 1rem;
    height: 1rem;
  }
  .spinner-lg {
    width: 2.5rem;
    height: 2.5rem;
    border-width: 3px;
    border-color: var(--au-tint, #ddf7ea);
    border-top-color: var(--au-primary, #079665);
  }
  @keyframes girar {
    to {
      transform: rotate(360deg);
    }
  }

  .privacidad,
  .pie {
    margin: 1rem 0 0;
    text-align: center;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--au-muted, #66756f);
  }
  .pie {
    margin-top: 0.4rem;
    font-size: 0.68rem;
    color: #8e9c96;
  }

  @media (min-width: 640px) {
    .acceso-shell {
      max-width: 480px;
    }
    .hero {
      min-height: 18rem;
      padding: 1.75rem;
    }
    .hero-titulo {
      font-size: 2.1rem;
    }
    .tarjeta {
      padding: 1.6rem;
    }
  }
</style>
