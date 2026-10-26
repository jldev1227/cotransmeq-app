/**
 * Diagnóstico exhaustivo del entorno del navegador para `getUserMedia`.
 *
 * Devuelve un objeto con todo lo relevante para entender por qué la
 * cámara podría no estar disponible. Pensado para:
 *  - Mostrar al usuario qué tiene mal configurado
 *  - Logging en consola para soporte
 *  - Decidir si reintentar o mostrar mensaje de error específico
 */
export interface GetUserMediaDiagnostics {
  /** API moderna presente (la que usamos por default). */
  hasModern: boolean;
  /** Alguna variante legacy presente (getUserMedia / webkit / moz). */
  hasLegacy: boolean;
  /** Qué variantes específicas se encontraron. */
  legacyVariants: string[];
  /** Estamos en un contexto seguro (HTTPS o localhost). */
  isSecureContext: boolean;
  /** Hostname actual (útil para diagnosticar "192.168.x.x"). */
  hostname: string;
  /** Protocolo actual. */
  protocol: string;
  /** `navigator.mediaDevices` existe como objeto. */
  hasMediaDevices: boolean;
  /** Es un dispositivo móvil (heurística). */
  isMobile: boolean;
  /** Plataforma detectada (iOS / Android / Desktop). */
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  /** `mediaDevices` está completamente ausente (HTTP en mobile, file://, etc). */
  mediaDevicesBlocked: boolean;
  /** Resumen: cámara usable o no. */
  available: boolean;
  /** Mensaje accionable si no está disponible. */
  reason: string | null;
}

export function diagnoseGetUserMedia(): GetUserMediaDiagnostics {
  const nav = navigator as any;
  const isSecure =
    typeof window !== 'undefined' ? window.isSecureContext : false;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : '';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && 'ontouchend' in document);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;
  const platform: GetUserMediaDiagnostics['platform'] = isIOS
    ? 'ios'
    : isAndroid
      ? 'android'
      : /Mobi|Android/i.test(ua)
        ? 'desktop' // tablet o híbrido
        : 'desktop';

  const hasMediaDevices = !!navigator.mediaDevices;
  const modernFn = navigator.mediaDevices?.getUserMedia;
  const hasModern = typeof modernFn === 'function';

  const legacyVariants: string[] = [];
  if (typeof nav.getUserMedia === 'function') legacyVariants.push('getUserMedia');
  if (typeof nav.webkitGetUserMedia === 'function') legacyVariants.push('webkitGetUserMedia');
  if (typeof nav.mozGetUserMedia === 'function') legacyVariants.push('mozGetUserMedia');
  const hasLegacy = legacyVariants.length > 0;

  // Caso típico en móvil: estás en HTTP. Los navegadores móviles
  // ni siquiera exponen `navigator.mediaDevices` para evitar
  // filtraciones de cámara en sitios no seguros.
  const isHttpNonLocalhost =
    protocol === 'http:' &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '';

  const mediaDevicesBlocked = !hasMediaDevices && isHttpNonLocalhost;

  let available = hasModern || hasLegacy;
  let reason: string | null = null;

  if (!available) {
    if (mediaDevicesBlocked) {
      reason =
        'La página se está cargando por HTTP. Los navegadores móviles BLOQUEAN el acceso a cámara en HTTP por seguridad. Soluciones: (a) usa https://, (b) accede desde el mismo dispositivo vía localhost (no funciona en móvil), o (c) configura un certificado local.';
    } else if (!isSecure && isMobile) {
      reason =
        'Contexto no seguro detectado. En iPhone y Android, la cámara SOLO funciona con HTTPS. Accede vía https://... aunque el certificado sea auto-firmado.';
    } else if (!isSecure) {
      reason =
        'La página debe servirse por HTTPS o desde localhost. La cámara está deshabilitada en HTTP fuera de localhost.';
    } else if (isIOS) {
      reason =
        'iOS Safari no expone la API de cámara. Actualiza a iOS 14+ o usa Safari/Chrome 84+ recientes.';
    } else if (isAndroid) {
      reason =
        'Android WebView no soporta la API. Prueba con Chrome 90+ o Firefox 80+ en navegación normal (no incognito).';
    } else {
      reason =
        'Tu navegador no expone la API de cámara. Prueba con Chrome 90+, Firefox 80+ o Safari 14+.';
    }
  }

  return {
    hasModern,
    hasLegacy,
    legacyVariants,
    isSecureContext: isSecure,
    hostname,
    protocol,
    hasMediaDevices,
    isMobile,
    platform,
    mediaDevicesBlocked,
    available,
    reason
  };
}

/**
 * Polyfill adaptativo de `navigator.mediaDevices.getUserMedia`.
 *
 * Algunos navegadores (especialmente móvil, iOS Safari < 11, Android
 * antiguos) NO exponen la API moderna, pero sí la legacy:
 *   - `navigator.getUserMedia(constraints, success, error)`
 *   - `navigator.webkitGetUserMedia(...)`  (prefijo WebKit)
 *   - `navigator.mozGetUserMedia(...)`     (prefijo Mozilla)
 *
 * Sin este polyfill, los chequeos `navigator.mediaDevices?.getUserMedia`
 * fallan en esos navegadores y el usuario ve "Tu navegador no soporta
 * acceso a cámara" aunque su navegador SÍ soporte la cámara.
 *
 * Devuelve el diagnóstico completo para que el caller pueda mostrar
 * mensajes accionables si la API no está disponible.
 */
export function installGetUserMediaPolyfill(): GetUserMediaDiagnostics {
  const diag = diagnoseGetUserMedia();
  if (typeof navigator === 'undefined') return diag;
  if (typeof window === 'undefined') return diag;

  if (diag.hasModern) {
    return diag; // API moderna presente, no hay nada que polyfill-ear.
  }

  if (!diag.hasLegacy) {
    return diag; // No hay variante legacy tampoco, no podemos hacer nada.
  }

  // Hay API legacy. Polyfill-eamos.
  if (!navigator.mediaDevices) {
    (navigator as any).mediaDevices = {};
  }

  // Usamos la primera variante legacy disponible, en orden de preferencia.
  const legacy: ((...args: any[]) => any) =
    (navigator as any).getUserMedia ||
    (navigator as any).webkitGetUserMedia ||
    (navigator as any).mozGetUserMedia;

  navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      try {
        legacy.call(navigator, constraints, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });

  // Re-diagnóstico post-polyfill para reportar `available = true`.
  return diagnoseGetUserMedia();
}
