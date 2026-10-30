/**
 * BiometricEngine — captura facial + liveness + embedding en el navegador.
 *
 * Decisiones de arquitectura (alineadas con `README-arquitectura-biometrica.md`):
 *  - Todo el procesamiento pesado ocurre en el cliente (CPU del usuario).
 *  - El backend NUNCA recibe la imagen. Sólo recibe el embedding.
 *  - Los frames se descartan en cuanto se genera el embedding.
 *
 * ── Qué cambia respecto de la v1 ──────────────────────────────────
 *
 *  1. **Una sola geometría** (`biometric.geometry.ts`). El canvas de
 *     análisis reproduce EXACTAMENTE el recorte que el usuario ve, ya
 *     espejado. Antes se analizaba el frame completo deformado a 4:3
 *     mientras la pantalla mostraba un recorte central distinto: en
 *     móvil el motor medía el torso mientras el usuario apuntaba a su
 *     cara.
 *  2. **Encuadre adaptativo**. Se pide a la cámara la orientación que
 *     corresponde al dispositivo y la UI ajusta su caja al aspecto
 *     REAL del stream, así el recorte `cover` es casi nulo.
 *  3. **Detección anclada al óvalo** (`face.detector.ts`), con máscara
 *     de piel en YCbCr — la regla RGB anterior rechazaba pieles
 *     oscuras — y `FaceDetector` nativo cuando existe.
 *  4. **Guía en vivo** en lugar de un timeout mudo: acércate, más luz,
 *     centra el rostro.
 *  5. **Embedding alineado y promediado**. El recorte se toma de la
 *     caja del rostro detectado (no de un ROI fijo), se normaliza en
 *     escala e iluminación, y se promedian varias muestras. Sin esto
 *     el vector dependía de la distancia al teléfono y `verify` no
 *     podía funcionar de forma estable.
 *
 * El reemplazo por un modelo ONNX real sigue siendo drop-in: sólo
 * cambia `embedFromCrop()` y la etiqueta `CURRENT_BIOMETRIC_MODEL`.
 */
import { browser } from '$app/environment';
import {
  CURRENT_BIOMETRIC_MODEL,
  buildLivenessSequence,
  type BiometricEngineProgress,
  type BiometricEngineResult,
  type LivenessChallenge,
  type LivenessChallengeId
} from './biometric.types';
import {
  analysisSize,
  coverSourceRect,
  defaultBoxAspect,
  isMobileDevice,
  orientationOf,
  targetOval,
  type CaptureOrientation
} from './biometric.geometry';
import {
  createFaceDetector,
  hintMessage,
  type FaceDetectorLike,
  type FaceReading
} from './face.detector';
import { installGetUserMediaPolyfill } from './getUserMediaPolyfill';

const EMBEDDING_DIM = 128;
/** Lado del recorte facial canónico que alimenta el embedding. */
const CROP_GRID = 24;
/** Muestras que se promedian para construir el template. */
const EMBED_SAMPLES = 5;

const FRAME_INTERVAL_MS = 70;
const DETECTION_TIMEOUT_MS = 30_000;
const CHALLENGE_TIMEOUT_MS = 20_000;
const CENTER_HOLD_MS = 900;
const TURN_HOLD_MS = 320;
const SMILE_HOLD_MS = 350;
/** Giro mínimo respecto a la línea base para dar por válido un turn. */
const TURN_YAW_DELTA = 0.16;
/** Desplazamiento lateral alternativo (en radios de óvalo). */
const TURN_OFFSET_DELTA = 0.3;
/** Ventana más amplia para que móviles con cámara frontal detecten el cierre. */
const BLINK_CLOSED_RATIO = 0.82;
const BLINK_OPEN_RATIO = 0.88;
const BLINK_REQUIRED = 1;

const DEBUG =
  browser && typeof location !== 'undefined' && location.search.includes('biodebug');
const TAG = '[Biometric]';
const log = (...args: unknown[]) => {
  if (DEBUG) console.log(TAG, ...args);
};
const warn = (...args: unknown[]) => {
  if (DEBUG) console.warn(TAG, ...args);
};

export interface BiometricEngineOptions {
  onProgress: (p: BiometricEngineProgress) => void;
  signal?: AbortSignal;
  /** Retos de vida además de `center`. Default 3. */
  challengeCount?: number;
  /** Relación de aspecto inicial de la caja visible (ancho / alto). */
  boxAspect?: number;
}

export class BiometricEngine {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private detector: FaceDetectorLike | null = null;
  private opts: BiometricEngineOptions;
  private aborted = false;
  private abortReason: string | null = null;
  private skipRequested = false;
  private boxAspect: number;
  private lastReading: FaceReading | null = null;
  /**
   * Sólo tomamos muestras del template con el rostro de frente. Un
   * frame capturado a mitad de un giro contamina el vector.
   */
  private collecting = false;
  private embeddings: number[][] = [];
  private qualitySum = 0;
  private lastFrameAt = 0;
  private onVisibilityChange: (() => void) | null = null;

  constructor(opts: BiometricEngineOptions) {
    this.opts = opts;
    this.boxAspect = opts.boxAspect ?? defaultBoxAspect(isMobileDevice());
    log('engine construido', { boxAspect: this.boxAspect });
  }

  // ── API para el componente ──────────────────────────────────────

  /**
   * La UI reporta la relación de aspecto REAL de la caja donde se
   * pinta el video (cambia al rotar el teléfono o al pasar a pantalla
   * completa). El motor recalcula recorte, canvas y óvalo para que lo
   * analizado siga siendo lo mostrado.
   */
  setViewportAspect(aspect: number) {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    if (Math.abs(aspect - this.boxAspect) < 0.01) return;
    this.boxAspect = aspect;
    this.resizeCanvas();
    log('viewport aspect actualizado', aspect);
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  getLastReading(): FaceReading | null {
    return this.lastReading;
  }

  getOval() {
    return targetOval(this.boxAspect);
  }

  skipCurrentChallenge(): void {
    this.skipRequested = true;
  }

  abort() {
    this.aborted = true;
    this.release();
  }

  // ── Flujo principal ─────────────────────────────────────────────

  async run(): Promise<BiometricEngineResult> {
    if (!browser) throw new Error('BiometricEngine solo corre en el navegador');
    this.emit({ step: 'init', message: 'Inicializando cámara…' });

    try {
      await this.openCamera();
      const orientation = orientationOf(this.boxAspect);
      this.emit({
        step: 'camera',
        message: 'Cámara lista',
        streamAspect: this.streamAspect(),
        orientation
      });

      this.detector = createFaceDetector();
      log('detector', this.detector.source);

      await this.waitForFace();

      const sequence = buildLivenessSequence(this.opts.challengeCount ?? 3);
      const passed: LivenessChallengeId[] = [];
      this.emit({
        step: 'liveness',
        message: 'Iniciando pruebas de vida',
        challengesCompleted: 0,
        challengesTotal: sequence.length
      });

      for (let i = 0; i < sequence.length; i++) {
        const challenge = sequence[i];
        this.emit({
          step: 'liveness',
          message: challenge.instruction,
          challenge,
          challengesCompleted: i,
          challengesTotal: sequence.length,
          challengeProgress: 0
        });
        await this.runChallenge(challenge, i, sequence.length);
        passed.push(challenge.id);
        this.emit({
          step: 'liveness',
          message: `✓ ${challenge.label}`,
          challenge,
          challengesCompleted: i + 1,
          challengesTotal: sequence.length,
          challengeProgress: 1
        });
      }

      this.emit({ step: 'embedding', message: 'Generando identidad facial…' });
      const result = await this.finalizeEmbedding(passed);
      this.emit({ step: 'done', message: 'Identidad capturada' });
      return result;
    } catch (e) {
      this.emit({
        step: 'error',
        message: e instanceof Error ? e.message : 'Error en la captura'
      });
      throw e;
    } finally {
      this.release();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CÁMARA
  // ══════════════════════════════════════════════════════════════
  private async openCamera() {
    const diag = installGetUserMediaPolyfill();
    log('diagnóstico del entorno', diag);
    if (!diag.available) {
      throw new Error(
        diag.reason ?? 'Tu navegador no soporta acceso a cámara en este contexto.'
      );
    }
    if (!window.isSecureContext) {
      const local =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!local) {
        throw new Error(
          'La cámara sólo funciona por HTTPS o en http://localhost. En móvil la página DEBE servirse por HTTPS.'
        );
      }
    }

    // CAMPO DE VISIÓN NATIVO — no pedimos resolución ni relación de
    // aspecto concretas.
    //
    // El sensor frontal de casi todo teléfono y webcam es 4:3. Cuando
    // se le pide 720×1280 (9:16), el navegador satisface la petición
    // RECORTANDO el sensor y escalando el resultado
    // (`crop-and-scale`), que es un zoom digital real: se pierde ~25%
    // de campo horizontal y la imagen se ve "acercada" ~40%. Pedir una
    // resolución alta agrava el efecto, porque fuerza al driver a
    // elegir un formato recortado.
    //
    // Aquí sólo pedimos cámara frontal y, donde se soporta,
    // `resizeMode: 'none'` para PROHIBIR ese recorte. La UI se adapta
    // después al aspecto real del stream, así que no necesitamos
    // imponerle ninguno. Para el análisis nos basta el lado corto a
    // 256 px, de modo que la resolución nativa siempre sobra.
    // `resizeMode` es parte de Media Capture pero aún no está en las
    // definiciones de TS; lo declaramos aquí en vez de castear a `any`.
    type ExtendedTrackConstraints = MediaTrackConstraints & {
      resizeMode?: ConstrainDOMString;
    };

    const base: MediaTrackConstraints = {
      facingMode: { ideal: 'user' },
      frameRate: { ideal: 24, max: 30 }
    };

    const candidates: MediaStreamConstraints[] = [
      {
        video: { ...base, resizeMode: { ideal: 'none' } } as ExtendedTrackConstraints,
        audio: false
      },
      { video: base, audio: false },
      { video: true, audio: false }
    ];

    let lastError: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(candidates[i]);
        log(`constraint #${i + 1} OK`, this.stream.getVideoTracks()[0]?.getSettings?.());
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const name = (e as { name?: string })?.name;
        warn(`constraint #${i + 1} falló`, name);
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') break;
      }
    }
    if (!this.stream) throw new Error(this.translateCameraError(lastError));

    await this.resetDigitalZoom();
    await this.attachVideo(this.stream);
    this.watchStreamLifecycle();
    this.resizeCanvas();
  }

  /**
   * Devuelve el zoom digital a su mínimo.
   *
   * Varios Android conservan a nivel de sistema el zoom que dejó otra
   * aplicación (la cámara nativa, una videollamada), y `getUserMedia`
   * entrega la pista ya acercada. La verificación necesita campo de
   * visión, no acercamiento: si la pista expone la capacidad `zoom`,
   * la forzamos a su valor mínimo.
   */
  private async resetDigitalZoom() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track?.getCapabilities) return;
    try {
      const caps = track.getCapabilities() as MediaTrackCapabilities & {
        zoom?: { min?: number; max?: number };
      };
      if (!caps.zoom) return;
      const min = caps.zoom.min ?? 1;
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
      if (settings.zoom !== undefined && settings.zoom <= min) return;
      log('reseteando zoom digital', { from: settings.zoom, to: min });
      await track.applyConstraints({
        advanced: [{ zoom: min }]
      } as unknown as MediaTrackConstraints);
    } catch {
      // La plataforma no permite tocar el zoom: seguimos igual.
    }
  }

  /**
   * Crea el `<video>` que alimenta al canvas. Va adjunto al DOM
   * (oculto) porque iOS Safari y algunos Android no reproducen un
   * elemento detached.
   */
  private async attachVideo(stream: MediaStream) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    Object.assign(video.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none'
    });
    document.body.appendChild(video);
    video.srcObject = stream;
    this.video = video;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            this.translateCameraError({
              name: 'VideoStartError',
              message: e instanceof Error ? e.message : String(e)
            })
          )
        );
      };
      video.onloadedmetadata = () => video.play().then(ok).catch(fail);
      video.onerror = () => fail(new Error('El stream de video reportó un error.'));
      setTimeout(() => fail(new Error('Tiempo de espera agotado al iniciar la cámara (12s).')), 12_000);
    });

    // Esperamos a tener dimensiones reales: sin esto el primer
    // `drawImage` produciría un canvas negro.
    const t0 = performance.now();
    while (this.video.videoWidth === 0 && performance.now() - t0 < 3000) {
      await sleep(50);
    }
  }

  /**
   * En móvil la cámara se corta al bloquear la pantalla o al cambiar
   * de app. Sin esto el usuario volvía a un video congelado y a un
   * timeout incomprensible.
   */
  private watchStreamLifecycle() {
    const track = this.stream?.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      this.aborted = true;
      this.abortReason =
        'La cámara se cerró durante la captura. Verifica que ninguna otra app la esté usando.';
    });
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.aborted = true;
        this.abortReason = 'La captura se interrumpió al salir de la aplicación. Inténtalo de nuevo.';
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resizeCanvas() {
    const { width, height } = analysisSize(this.boxAspect);
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!this.ctx) throw new Error('No se pudo crear el contexto 2D del canvas');
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private streamAspect(): number | null {
    if (!this.video || !this.video.videoWidth) return null;
    return this.video.videoWidth / this.video.videoHeight;
  }

  private translateCameraError(err: unknown): string {
    if (!err) return 'Error desconocido al abrir la cámara.';
    const e = err as { name?: string; message?: string };
    switch (e.name ?? '') {
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No detectamos ninguna cámara en este dispositivo.';
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador (candado de la barra de direcciones) e inténtalo de nuevo.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'La cámara está siendo usada por otra aplicación (videollamada, otra pestaña). Ciérrala e inténtalo de nuevo.';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'Tu cámara no soporta la resolución solicitada. Probamos alternativas sin éxito.';
      case 'AbortError':
        return 'La apertura de la cámara fue cancelada. Intenta de nuevo.';
      case 'VideoStartError':
        return `No se pudo iniciar el video: ${e.message || 'error desconocido'}. En iPhone verifica que la página esté en HTTPS y que ninguna otra app use la cámara.`;
      default:
        return `No se pudo abrir la cámara (${e.name || 'error'}). ${e.message ?? ''}`.trim();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // BUCLE DE FRAMES
  // ══════════════════════════════════════════════════════════════

  /**
   * Dibuja el recorte visible en el canvas de análisis, **espejado**,
   * y devuelve la lectura facial. El espejo se aplica aquí para que
   * "izquierda" signifique lo mismo en el motor, en el óvalo y en la
   * pantalla del usuario.
   */
  private async readFrame(): Promise<FaceReading> {
    this.ensureAlive();
    const wait = FRAME_INTERVAL_MS - (performance.now() - this.lastFrameAt);
    if (wait > 0) await sleep(wait);
    await this.waitNextVideoFrame();
    this.lastFrameAt = performance.now();
    this.ensureAlive();

    const video = this.video!;
    const canvas = this.canvas!;
    const ctx = this.ctx!;
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('El video dejó de entregar frames. Vuelve a intentarlo.');
    }

    const crop = coverSourceRect(video.videoWidth, video.videoHeight, this.boxAspect);
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const reading = await this.detector!.detect(canvas, image, targetOval(this.boxAspect));
    this.lastReading = reading;
    // Aprovechamos los frames buenos para ir acumulando muestras del
    // template, en vez de depender de un único frame final.
    if (this.collecting && reading.found && reading.hint === 'ok') {
      this.collectSample(image, reading);
    }
    return reading;
  }

  private waitNextVideoFrame(): Promise<void> {
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof video?.requestVideoFrameCallback === 'function') {
      return new Promise<void>((resolve) => {
        let done = false;
        video.requestVideoFrameCallback!(() => {
          if (!done) {
            done = true;
            resolve();
          }
        });
        // Si el navegador deja de emitir frames (pestaña en segundo
        // plano) no nos quedamos colgados.
        setTimeout(() => {
          if (!done) {
            done = true;
            resolve();
          }
        }, 300);
      });
    }
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private ensureAlive() {
    if (this.aborted || this.opts.signal?.aborted) {
      throw new Error(this.abortReason ?? 'Captura cancelada');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // DETECCIÓN INICIAL (con guía en vivo)
  // ══════════════════════════════════════════════════════════════
  private async waitForFace() {
    const deadline = performance.now() + DETECTION_TIMEOUT_MS;
    let lastHint: string | null = null;
    let stableFrames = 0;

    while (performance.now() < deadline) {
      const r = await this.readFrame();
      const hint = r.found ? r.hint : 'no-face';
      const msg = hintMessage(hint);
      if (msg !== lastHint) {
        lastHint = msg;
        this.emit({
          step: 'detection',
          message: msg ?? 'Rostro detectado',
          faceQuality: r.score,
          hint,
          hintMessage: msg,
          streamAspect: this.streamAspect()
        });
      }
      if (r.found && hint === 'ok') {
        stableFrames++;
        if (stableFrames >= 4) {
          this.emit({
            step: 'detection',
            message: 'Rostro detectado',
            faceQuality: r.score,
            hint: 'ok',
            hintMessage: null
          });
          return;
        }
      } else {
        stableFrames = 0;
      }
    }
    throw new Error(
      'No logramos encuadrar tu rostro. Busca un lugar con más luz, sostén el teléfono a la altura de los ojos e inténtalo de nuevo.'
    );
  }

  // ══════════════════════════════════════════════════════════════
  // PRUEBAS DE VIDA
  // ══════════════════════════════════════════════════════════════
  private async runChallenge(c: LivenessChallenge, index: number, total: number) {
    const deadline = performance.now() + CHALLENGE_TIMEOUT_MS;
    this.skipRequested = false;
    this.collecting = c.id === 'center';

    // Línea base: todas las señales son RELATIVAS al estado neutro del
    // usuario, no a constantes absolutas. Es lo que hace que funcione
    // con distinta luz, distinta piel y distinta distancia.
    let baseYaw: number | null = null;
    let baseOffsetX = 0;
    let baseEyeDark = 0;
    let baseMouthBright = 0;
    let baseSamples = 0;

    let holdStart: number | null = null;
    let blinkCount = 0;
    let eyesClosed = false;
    let progress = 0;
    let lastEmit = 0;

    while (performance.now() < deadline) {
      if (this.skipRequested) {
        warn(`challenge ${c.id} saltado manualmente`);
        return;
      }
      const r = await this.readFrame();

      if (!r.found) {
        holdStart = null;
        this.emitChallenge(c, index, total, progress, 'no-face');
        continue;
      }

      if (baseSamples < 5) {
        baseYaw = baseYaw === null ? r.yaw : baseYaw * 0.7 + r.yaw * 0.3;
        baseOffsetX = baseSamples === 0 ? r.offsetX : baseOffsetX * 0.7 + r.offsetX * 0.3;
        baseEyeDark = baseSamples === 0 ? r.eyeDarkRatio : baseEyeDark * 0.7 + r.eyeDarkRatio * 0.3;
        baseMouthBright =
          baseSamples === 0 ? r.mouthBrightRatio : baseMouthBright * 0.7 + r.mouthBrightRatio * 0.3;
        baseSamples++;
      }

      const dYaw = baseYaw === null ? 0 : r.yaw - baseYaw;
      const dOffset = r.offsetX - baseOffsetX;
      let done = false;

      switch (c.id) {
        case 'center': {
          const ok = r.hint === 'ok';
          if (ok) {
            holdStart ??= performance.now();
            progress = Math.min(1, (performance.now() - holdStart) / CENTER_HOLD_MS);
            done = progress >= 1;
          } else {
            holdStart = null;
            progress = 0;
          }
          break;
        }
        case 'turn-left': {
          const turned = dYaw < -TURN_YAW_DELTA || dOffset < -TURN_OFFSET_DELTA;
          ({ holdStart, progress, done } = holdGate(turned, holdStart, TURN_HOLD_MS));
          break;
        }
        case 'turn-right': {
          const turned = dYaw > TURN_YAW_DELTA || dOffset > TURN_OFFSET_DELTA;
          ({ holdStart, progress, done } = holdGate(turned, holdStart, TURN_HOLD_MS));
          break;
        }
        case 'blink': {
          // Un ojo abierto tiene mucho contraste (iris/pestañas contra
          // esclerótica); al cerrarse, la proporción de píxeles oscuros
          // en la banda de ojos se desploma. Es más estable que medir
          // luminancia absoluta, que depende de la luz de la sala.
          // Suelo en la línea base: con luz muy plana `baseEyeDark`
          // puede quedar casi en cero y ningún parpadeo bajaría de
          // "cero por 0.82" — el reto sería imposible de superar.
          const base = Math.max(baseEyeDark, 0.04);
          // Una caída del 18% basta para iniciar el parpadeo (antes exigíamos
          // 38%). La histéresis evita que una variación de un solo frame
          // cuente como cierre y reapertura.
          const closedNow = r.eyeDarkRatio < base * BLINK_CLOSED_RATIO;
          const openNow = r.eyeDarkRatio > base * BLINK_OPEN_RATIO;
          if (!eyesClosed && closedNow) {
            eyesClosed = true;
          } else if (eyesClosed && openNow) {
            eyesClosed = false;
            blinkCount++;
          }
          progress = Math.min(1, blinkCount / BLINK_REQUIRED);
          done = blinkCount >= BLINK_REQUIRED;
          break;
        }
        case 'smile': {
          // Al sonreír aparecen dientes: píxeles claros dentro de la
          // banda de boca, que en reposo es la zona más oscura del
          // tercio inferior.
          const smiling =
            r.mouthBrightRatio > Math.max(baseMouthBright * 1.6, baseMouthBright + 0.035) ||
            r.mouthLuma > r.eyeLuma * 1.08;
          ({ holdStart, progress, done } = holdGate(smiling, holdStart, SMILE_HOLD_MS));
          break;
        }
      }

      if (done) return;

      if (performance.now() - lastEmit > 150) {
        lastEmit = performance.now();
        this.emitChallenge(c, index, total, progress, r.hint === 'ok' ? null : r.hint);
      }
    }

    throw new Error(`Tiempo agotado en "${c.label}". Vuelve a intentarlo.`);
  }

  private emitChallenge(
    c: LivenessChallenge,
    index: number,
    total: number,
    progress: number,
    hint: FaceReading['hint'] | 'no-face' | null
  ) {
    this.emit({
      step: 'liveness',
      message: c.instruction,
      challenge: c,
      challengesCompleted: index,
      challengesTotal: total,
      challengeProgress: progress,
      hint: hint ?? null,
      hintMessage: hint ? hintMessage(hint) : null
    });
  }

  // ══════════════════════════════════════════════════════════════
  // EMBEDDING
  // ══════════════════════════════════════════════════════════════

  /**
   * Recorta el rostro DETECTADO (no un ROI fijo), lo lleva a una malla
   * canónica y normaliza iluminación antes de proyectar. Así el mismo
   * rostro a 30 cm y a 60 cm produce vectores comparables, que es la
   * condición mínima para que `verify` signifique algo.
   */
  private collectSample(image: ImageData, r: FaceReading) {
    if (!r.box || this.embeddings.length >= EMBED_SAMPLES * 3) return;
    const quality = sampleQuality(r);
    if (quality < 0.45) return;
    const crop = resampleFace(image, r.box, CROP_GRID);
    if (!crop) return;
    this.embeddings.push(embedFromCrop(crop));
    this.qualitySum += quality;
  }

  private async finalizeEmbedding(passed: LivenessChallengeId[]): Promise<BiometricEngineResult> {
    // Completamos muestras si el liveness fue muy rápido.
    this.collecting = true;
    const deadline = performance.now() + 4000;
    while (this.embeddings.length < EMBED_SAMPLES && performance.now() < deadline) {
      try {
        await this.readFrame();
      } catch {
        // Si la cámara muere justo aquí pero ya tenemos muestras del
        // reto `center`, preferimos cerrar con lo que hay a tirar toda
        // la sesión del usuario.
        break;
      }
    }
    if (this.embeddings.length === 0) {
      throw new Error(
        'No conseguimos una captura nítida de tu rostro. Mejora la iluminación e inténtalo de nuevo.'
      );
    }

    // Promedio de vectores unitarios + renormalización: reduce el ruido
    // de un frame suelto (parpadeo, desenfoque, sombra puntual).
    const acc = new Array(EMBEDDING_DIM).fill(0);
    for (const v of this.embeddings) {
      for (let i = 0; i < EMBEDDING_DIM; i++) acc[i] += v[i];
    }
    const embedding = l2normalize(acc);
    const quality = Math.min(1, this.qualitySum / this.embeddings.length);
    const orientation: CaptureOrientation = orientationOf(this.boxAspect);

    return {
      embedding,
      embeddingDim: EMBEDDING_DIM,
      quality: Number(quality.toFixed(4)),
      model: CURRENT_BIOMETRIC_MODEL,
      samples: this.embeddings.length,
      challenges: passed,
      capture: {
        platform: isMobileDevice() ? 'mobile' : 'desktop',
        orientation,
        streamWidth: this.video?.videoWidth ?? 0,
        streamHeight: this.video?.videoHeight ?? 0,
        detector: this.detector?.source ?? 'heuristic'
      }
    };
  }

  // ══════════════════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════════════════
  release() {
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.parentNode?.removeChild(this.video);
      this.video = null;
    }
    this.detector?.dispose();
    this.detector = null;
    this.ctx = null;
    this.canvas = null;
    // Los vectores intermedios se descartan explícitamente: nunca hay
    // material biométrico vivo tras cerrar el modal.
    this.embeddings = [];
    this.lastReading = null;
  }

  private emit(p: BiometricEngineProgress) {
    this.opts.onProgress(p);
  }
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function holdGate(
  condition: boolean,
  holdStart: number | null,
  holdMs: number
): { holdStart: number | null; progress: number; done: boolean } {
  if (!condition) return { holdStart: null, progress: 0, done: false };
  const start = holdStart ?? performance.now();
  const progress = Math.min(1, (performance.now() - start) / holdMs);
  return { holdStart: start, progress, done: progress >= 1 };
}

/** Calidad del frame como material para el template (0..1). */
export function sampleQuality(r: FaceReading): number {
  if (!r.found) return 0;
  const framing = 1 - Math.min(1, Math.abs(r.fill - 1) / 0.6);
  const centered = 1 - Math.min(1, Math.hypot(r.offsetX, r.offsetY) / 0.8);
  const light = 1 - Math.min(1, Math.abs(r.brightness - 140) / 110);
  const sharp = Math.min(1, r.contrast / 45);
  const still = 1 - Math.min(1, r.motion / 0.25);
  return clamp01(framing * 0.25 + centered * 0.2 + light * 0.2 + sharp * 0.2 + still * 0.15);
}

/**
 * Recorte facial canónico en escala de grises, `grid × grid`, con
 * normalización de iluminación (media 0, desviación 1). Devuelve
 * `null` si la caja es degenerada.
 */
export function resampleFace(
  image: ImageData,
  box: { x: number; y: number; w: number; h: number },
  grid: number
): Float32Array | null {
  const { width: W, height: H, data } = image;
  // Margen del 12%: incluye frente y mentón, que aportan geometría.
  const mx = box.w * 0.12;
  const my = box.h * 0.12;
  const x0 = Math.max(0, Math.round((box.x - mx) * W));
  const y0 = Math.max(0, Math.round((box.y - my) * H));
  const x1 = Math.min(W, Math.round((box.x + box.w + mx) * W));
  const y1 = Math.min(H, Math.round((box.y + box.h + my) * H));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < grid || bh < grid) return null;

  const out = new Float32Array(grid * grid);
  const cw = bw / grid;
  const ch = bh / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const sx0 = x0 + Math.floor(gx * cw);
      const sy0 = y0 + Math.floor(gy * ch);
      const sx1 = Math.min(x1, sx0 + Math.max(1, Math.floor(cw)));
      const sy1 = Math.min(y1, sy0 + Math.max(1, Math.floor(ch)));
      let sum = 0;
      let count = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * W + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
        }
      }
      out[gy * grid + gx] = count > 0 ? sum / count : 0;
    }
  }

  // Normalización de iluminación: elimina el sesgo de la lámpara de la
  // sala y del auto-exposure del teléfono.
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  let variance = 0;
  for (let i = 0; i < out.length; i++) variance += (out[i] - mean) ** 2;
  const std = Math.sqrt(variance / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / std;
  return out;
}

/**
 * Proyección aleatoria (Johnson–Lindenstrauss) `grid²` → 128.
 *
 * Una matriz gaussiana con columnas normalizadas preserva de forma
 * aproximada los ángulos entre vectores, que es justo lo que consume
 * la cosine similarity del backend. La semilla es fija y vive en el
 * código: el mismo rostro produce siempre el mismo vector, sin estado
 * compartido entre cliente y servidor.
 */
let PROJECTION: Float32Array | null = null;
const PROJECTION_SEED = 0xf04da1b1;

function projectionMatrix(inputDim: number): Float32Array {
  if (PROJECTION && PROJECTION.length === inputDim * EMBEDDING_DIM) return PROJECTION;
  const m = new Float32Array(inputDim * EMBEDDING_DIM);
  const rng = mulberry32(PROJECTION_SEED);
  for (let i = 0; i < m.length; i++) m[i] = gaussian(rng);
  for (let j = 0; j < EMBEDDING_DIM; j++) {
    let norm = 0;
    for (let i = 0; i < inputDim; i++) norm += m[i * EMBEDDING_DIM + j] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < inputDim; i++) m[i * EMBEDDING_DIM + j] /= norm;
  }
  PROJECTION = m;
  return m;
}

export function embedFromCrop(crop: Float32Array): number[] {
  const inputDim = crop.length;
  const m = projectionMatrix(inputDim);
  const out = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < inputDim; i++) {
    const v = crop[i];
    if (v === 0) continue;
    const row = i * EMBEDDING_DIM;
    for (let j = 0; j < EMBEDDING_DIM; j++) out[j] += v * m[row + j];
  }
  return l2normalize(out);
}

export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
