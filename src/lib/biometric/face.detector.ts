/**
 * Detector facial del cliente.
 *
 * Dos implementaciones tras una sola interfaz:
 *
 *  1. `FaceDetector` nativo (Shape Detection API). Disponible en
 *     buena parte de Chrome/Android. Da bounding box y, en algunos
 *     dispositivos, landmarks (ojos, boca) → yaw y roll reales.
 *  2. Heurística propia (fallback universal: iOS Safari, Firefox,
 *     escritorio). Máscara de piel en **YCbCr** + imagen integral +
 *     barrido multiescala restringido al óvalo guía.
 *
 * Por qué YCbCr y no la regla RGB anterior: el criterio previo
 * (`r > g && g >= b && r - g > 15 && r > 95`) exige un canal rojo alto
 * en valor absoluto, así que **rechazaba pieles oscuras** con
 * iluminación normal — el usuario simplemente "no era detectado". El
 * locus de piel en crominancia (Cb/Cr) es prácticamente invariante al
 * tono y a la luminancia, que es justo lo que necesitamos.
 *
 * Todas las coordenadas que salen de aquí están normalizadas 0..1
 * respecto al canvas de análisis, que por construcción
 * (`biometric.geometry.ts`) es exactamente lo que el usuario ve en
 * pantalla, ya espejado.
 */
import type { TargetOval } from './biometric.geometry';

export type FramingHint =
  | 'ok'
  | 'no-face'
  | 'too-far'
  | 'too-close'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'too-dark'
  | 'too-bright'
  | 'hold-still';

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceReading {
  found: boolean;
  /** Confianza 0..1. */
  score: number;
  box: FaceBox | null;
  /** Centro del rostro, normalizado al canvas. */
  cx: number;
  cy: number;
  /** Alto del rostro / alto del óvalo. 1 = encuadre ideal. */
  fill: number;
  /** Desplazamiento respecto al centro del óvalo, en radios de óvalo. */
  offsetX: number;
  offsetY: number;
  /** Giro horizontal en espacio de USUARIO: <0 su izquierda, >0 su derecha. */
  yaw: number;
  /** Inclinación vertical: <0 mirando arriba, >0 mirando abajo. */
  pitch: number;
  /** Luminancia media dentro del rostro (0..255). */
  brightness: number;
  /** Desviación estándar de luminancia — proxy de nitidez/contraste. */
  contrast: number;
  /** Luminancia de la banda de ojos. */
  eyeLuma: number;
  /** Proporción de píxeles oscuros en la banda de ojos (0..1). */
  eyeDarkRatio: number;
  /** Luminancia de la banda de boca. */
  mouthLuma: number;
  /** Proporción de píxeles claros en la banda de boca (dientes). */
  mouthBrightRatio: number;
  /** Movimiento respecto al frame anterior (0..1). */
  motion: number;
  hint: FramingHint;
  source: 'native' | 'heuristic';
}

export interface FaceDetectorLike {
  detect(canvas: HTMLCanvasElement, image: ImageData, oval: TargetOval): Promise<FaceReading>;
  readonly source: 'native' | 'heuristic';
  dispose(): void;
}

/** Mensajes accionables en es-CO para cada hint de encuadre. */
export function hintMessage(hint: FramingHint): string | null {
  switch (hint) {
    case 'no-face':
      return 'No vemos tu rostro. Sube la cámara a la altura de tus ojos.';
    case 'too-far':
      return 'Acerca un poco el rostro.';
    case 'too-close':
      return 'Aleja un poco el rostro.';
    case 'move-left':
      return 'Muévete un poco a tu izquierda.';
    case 'move-right':
      return 'Muévete un poco a tu derecha.';
    case 'move-up':
      return 'Sube un poco la cámara.';
    case 'move-down':
      return 'Baja un poco la cámara.';
    case 'too-dark':
      return 'Necesitamos más luz sobre tu rostro.';
    case 'too-bright':
      return 'Hay demasiada luz de fondo. Ponte de espaldas a la ventana.';
    case 'hold-still':
      return 'Mantén el teléfono quieto.';
    case 'ok':
    default:
      return null;
  }
}

// ── Umbrales de encuadre ────────────────────────────────────────────
const FILL_MIN = 0.62;
const FILL_MAX = 1.55;
const OFFSET_TOLERANCE = 0.55;
const DARK_LIMIT = 52;
const BRIGHT_LIMIT = 232;
const MOTION_LIMIT = 0.22;

const EMPTY_READING: FaceReading = {
  found: false,
  score: 0,
  box: null,
  cx: 0.5,
  cy: 0.5,
  fill: 0,
  offsetX: 0,
  offsetY: 0,
  yaw: 0,
  pitch: 0,
  brightness: 0,
  contrast: 0,
  eyeLuma: 0,
  eyeDarkRatio: 0,
  mouthLuma: 0,
  mouthBrightRatio: 0,
  motion: 0,
  hint: 'no-face',
  source: 'heuristic'
};

/**
 * Crea el mejor detector disponible en este navegador. Nunca lanza:
 * si el nativo falla en runtime, cae a la heurística en caliente.
 */
export function createFaceDetector(): FaceDetectorLike {
  const NativeCtor = (globalThis as unknown as { FaceDetector?: NativeFaceDetectorCtor })
    .FaceDetector;
  if (typeof NativeCtor === 'function') {
    try {
      return new NativeFaceDetector(new NativeCtor({ maxDetectedFaces: 1, fastMode: true }));
    } catch {
      // Constructor disponible pero no utilizable (permiso, plataforma).
    }
  }
  return new HeuristicFaceDetector();
}

// ════════════════════════════════════════════════════════════════════
// Fotometría común (se aplica sobre la caja detectada, venga de donde venga)
// ════════════════════════════════════════════════════════════════════

/** Estado compartido para medir movimiento entre frames. */
class MotionTracker {
  private prev: Float32Array | null = null;
  private readonly cols = 12;
  private readonly rows = 12;

  measure(image: ImageData): number {
    const { width, height, data } = image;
    const grid = new Float32Array(this.cols * this.rows);
    const cw = width / this.cols;
    const ch = height / this.rows;
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        let sum = 0;
        let count = 0;
        const x0 = Math.floor(gx * cw);
        const y0 = Math.floor(gy * ch);
        const x1 = Math.min(width, Math.floor(x0 + cw));
        const y1 = Math.min(height, Math.floor(y0 + ch));
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            const i = (y * width + x) * 4;
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            count++;
          }
        }
        grid[gy * this.cols + gx] = count > 0 ? sum / count : 0;
      }
    }
    let motion = 0;
    if (this.prev) {
      let acc = 0;
      for (let i = 0; i < grid.length; i++) acc += Math.abs(grid[i] - this.prev[i]);
      motion = Math.min(1, acc / grid.length / 40);
    }
    this.prev = grid;
    return motion;
  }

  reset() {
    this.prev = null;
  }
}

interface Photometrics {
  brightness: number;
  contrast: number;
  eyeLuma: number;
  eyeDarkRatio: number;
  mouthLuma: number;
  mouthBrightRatio: number;
  /** Asimetría de la banda de ojos: <0 más oscuro a la izquierda. */
  eyeAsymmetry: number;
  /** Centroide horizontal de los píxeles oscuros de la banda de ojos. */
  eyeCentroidX: number;
}

/**
 * Mide luminancia global, banda de ojos y banda de boca dentro de la
 * caja del rostro. Las bandas son proporciones antropométricas
 * estándar: ojos ≈ 28-48% del alto de la cabeza, boca ≈ 62-85%.
 */
function photometrics(image: ImageData, box: FaceBox): Photometrics {
  const { width: W, height: H, data } = image;
  const x0 = Math.max(0, Math.round(box.x * W));
  const y0 = Math.max(0, Math.round(box.y * H));
  const x1 = Math.min(W, Math.round((box.x + box.w) * W));
  const y1 = Math.min(H, Math.round((box.y + box.h) * H));
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);

  const eyeTop = y0 + bh * 0.28;
  const eyeBottom = y0 + bh * 0.48;
  const mouthTop = y0 + bh * 0.62;
  const mouthBottom = y0 + bh * 0.85;
  const midX = x0 + bw / 2;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let eyeSum = 0;
  let eyeCount = 0;
  let eyeDark = 0;
  let eyeLeft = 0;
  let eyeLeftCount = 0;
  let eyeRight = 0;
  let eyeRightCount = 0;
  let eyeDarkMassX = 0;
  let eyeDarkMass = 0;
  let mouthSum = 0;
  let mouthCount = 0;
  let mouthBright = 0;

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += luma;
      sumSq += luma * luma;
      count++;
      if (y >= eyeTop && y < eyeBottom) {
        eyeSum += luma;
        eyeCount++;
        if (x < midX) {
          eyeLeft += luma;
          eyeLeftCount++;
        } else {
          eyeRight += luma;
          eyeRightCount++;
        }
      } else if (y >= mouthTop && y < mouthBottom) {
        mouthSum += luma;
        mouthCount++;
      }
    }
  }

  const brightness = count > 0 ? sum / count : 0;
  const variance = count > 0 ? Math.max(0, sumSq / count - brightness * brightness) : 0;
  const eyeLuma = eyeCount > 0 ? eyeSum / eyeCount : 0;
  const mouthLuma = mouthCount > 0 ? mouthSum / mouthCount : 0;

  // Segunda pasada barata sólo en las bandas, con umbrales relativos a
  // la luminancia local (robusto ante piel clara/oscura y luz cálida).
  const darkThreshold = eyeLuma * 0.72;
  const brightThreshold = mouthLuma * 1.28;
  let eyeBandPixels = 0;
  let mouthBandPixels = 0;
  for (let y = Math.floor(eyeTop); y < eyeBottom; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      eyeBandPixels++;
      if (luma < darkThreshold) {
        eyeDark++;
        eyeDarkMassX += x;
        eyeDarkMass++;
      }
    }
  }
  for (let y = Math.floor(mouthTop); y < mouthBottom; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      mouthBandPixels++;
      if (luma > brightThreshold) mouthBright++;
    }
  }

  const eyeLeftAvg = eyeLeftCount > 0 ? eyeLeft / eyeLeftCount : 0;
  const eyeRightAvg = eyeRightCount > 0 ? eyeRight / eyeRightCount : 0;
  const eyeAsymmetry =
    eyeLeftAvg + eyeRightAvg > 0
      ? (eyeRightAvg - eyeLeftAvg) / (eyeLeftAvg + eyeRightAvg)
      : 0;
  const eyeCentroidX = eyeDarkMass > 0 ? (eyeDarkMassX / eyeDarkMass - x0) / bw : 0.5;

  return {
    brightness,
    contrast: Math.sqrt(variance),
    eyeLuma,
    eyeDarkRatio: eyeBandPixels > 0 ? eyeDark / eyeBandPixels : 0,
    mouthLuma,
    mouthBrightRatio: mouthBandPixels > 0 ? mouthBright / mouthBandPixels : 0,
    eyeAsymmetry,
    eyeCentroidX
  };
}

function buildReading(
  box: FaceBox,
  score: number,
  image: ImageData,
  oval: TargetOval,
  motion: number,
  source: 'native' | 'heuristic',
  yawOverride?: number
): FaceReading {
  const p = photometrics(image, box);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const fill = box.h / (oval.ry * 2);
  const offsetX = (cx - oval.cx) / oval.rx;
  const offsetY = (cy - oval.cy) / oval.ry;

  // Yaw: combinamos dos señales independientes. El centroide de los
  // píxeles oscuros de la banda de ojos se desplaza cuando la cabeza
  // gira (un ojo se acerca al borde), y la asimetría de luminancia
  // captura la mejilla que queda a contraluz. Ninguna es un modelo 3D,
  // pero ambas responden al giro REAL de la cabeza, no a que el
  // usuario se desplace lateralmente.
  const yaw =
    yawOverride !== undefined
      ? yawOverride
      : clamp(-1, 1, (p.eyeCentroidX - 0.5) * 2.2 + p.eyeAsymmetry * 0.8);

  const hint = framingHint({ fill, offsetX, offsetY, brightness: p.brightness, motion });

  return {
    found: true,
    score,
    box,
    cx,
    cy,
    fill,
    offsetX,
    offsetY,
    yaw,
    pitch: clamp(-1, 1, offsetY),
    brightness: p.brightness,
    contrast: p.contrast,
    eyeLuma: p.eyeLuma,
    eyeDarkRatio: p.eyeDarkRatio,
    mouthLuma: p.mouthLuma,
    mouthBrightRatio: p.mouthBrightRatio,
    motion,
    hint,
    source
  };
}

function framingHint(v: {
  fill: number;
  offsetX: number;
  offsetY: number;
  brightness: number;
  motion: number;
}): FramingHint {
  if (v.brightness < DARK_LIMIT) return 'too-dark';
  if (v.brightness > BRIGHT_LIMIT) return 'too-bright';
  if (v.fill < FILL_MIN) return 'too-far';
  if (v.fill > FILL_MAX) return 'too-close';
  if (v.offsetX < -OFFSET_TOLERANCE) return 'move-right';
  if (v.offsetX > OFFSET_TOLERANCE) return 'move-left';
  if (v.offsetY < -OFFSET_TOLERANCE) return 'move-down';
  if (v.offsetY > OFFSET_TOLERANCE) return 'move-up';
  if (v.motion > MOTION_LIMIT) return 'hold-still';
  return 'ok';
}

// ════════════════════════════════════════════════════════════════════
// 1) Detector nativo (Shape Detection API)
// ════════════════════════════════════════════════════════════════════

/**
 * Tipos mínimos de la Shape Detection API. No están en lib.dom.d.ts
 * porque la especificación sigue en borrador; declaramos sólo lo que
 * consumimos.
 */
interface NativeBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface NativeLandmark {
  type?: string;
  locations?: { x: number; y: number }[];
}
interface NativeDetectedFace {
  boundingBox: NativeBoundingBox;
  landmarks?: NativeLandmark[];
}
interface NativeFaceDetectorApi {
  detect(source: CanvasImageSource): Promise<NativeDetectedFace[]>;
}
type NativeFaceDetectorCtor = new (options: {
  maxDetectedFaces?: number;
  fastMode?: boolean;
}) => NativeFaceDetectorApi;

class NativeFaceDetector implements FaceDetectorLike {
  readonly source = 'native' as const;
  private motion = new MotionTracker();
  private fallback: HeuristicFaceDetector | null = null;

  constructor(private readonly native: NativeFaceDetectorApi) {}

  async detect(
    canvas: HTMLCanvasElement,
    image: ImageData,
    oval: TargetOval
  ): Promise<FaceReading> {
    const motion = this.motion.measure(image);
    let faces: NativeDetectedFace[];
    try {
      faces = await this.native.detect(canvas);
    } catch {
      // El nativo se cayó (pasa en algunos Android al rotar). A partir
      // de aquí usamos la heurística y no volvemos a intentarlo.
      this.fallback ??= new HeuristicFaceDetector();
      return this.fallback.detect(canvas, image, oval);
    }
    if (!faces || faces.length === 0) {
      return { ...EMPTY_READING, motion, source: this.source };
    }
    // La cara más grande gana (evita que un rostro de fondo secuestre
    // la sesión).
    const best = faces.reduce((a, b) =>
      b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height
        ? b
        : a
    );
    const bb = best.boundingBox;
    const box: FaceBox = {
      x: bb.x / canvas.width,
      y: bb.y / canvas.height,
      w: bb.width / canvas.width,
      h: bb.height / canvas.height
    };
    const yaw = yawFromLandmarks(best.landmarks, bb);
    return buildReading(box, 0.95, image, oval, motion, this.source, yaw);
  }

  dispose() {
    this.motion.reset();
  }
}

/**
 * Yaw a partir de landmarks nativos: la nariz (o el punto medio entre
 * ojos) se desplaza dentro de la caja cuando la cabeza gira.
 * Devuelve `undefined` si la plataforma no expone landmarks.
 */
function yawFromLandmarks(
  landmarks: NativeLandmark[] | undefined,
  bb: NativeBoundingBox
): number | undefined {
  if (!landmarks || landmarks.length === 0) return undefined;
  const eyes = landmarks.filter((l) => l.type === 'eye');
  if (eyes.length < 2) return undefined;
  const pts = eyes.map((e) => e.locations?.[0] ?? { x: 0, y: 0 });
  const midX = (pts[0].x + pts[1].x) / 2;
  const rel = (midX - bb.x) / Math.max(1, bb.width);
  return clamp(-1, 1, (rel - 0.5) * 3);
}

// ════════════════════════════════════════════════════════════════════
// 2) Heurística: máscara YCbCr + imagen integral + barrido multiescala
// ════════════════════════════════════════════════════════════════════
class HeuristicFaceDetector implements FaceDetectorLike {
  readonly source = 'heuristic' as const;
  private motion = new MotionTracker();
  private mask: Uint8Array | null = null;
  private integral: Int32Array | null = null;
  private maskW = 0;
  private maskH = 0;

  async detect(
    _canvas: HTMLCanvasElement,
    image: ImageData,
    oval: TargetOval
  ): Promise<FaceReading> {
    const motion = this.motion.measure(image);
    this.buildMask(image);
    const best = this.scan(oval);
    if (!best) {
      return { ...EMPTY_READING, motion, source: this.source };
    }
    return buildReading(best.box, best.score, image, oval, motion, this.source);
  }

  dispose() {
    this.motion.reset();
    this.mask = null;
    this.integral = null;
  }

  /** Máscara binaria de piel a media resolución + imagen integral. */
  private buildMask(image: ImageData) {
    const { width: W, height: H, data } = image;
    const mw = W >> 1;
    const mh = H >> 1;
    if (!this.mask || this.maskW !== mw || this.maskH !== mh) {
      this.mask = new Uint8Array(mw * mh);
      this.integral = new Int32Array((mw + 1) * (mh + 1));
      this.maskW = mw;
      this.maskH = mh;
    }
    const mask = this.mask!;
    for (let my = 0; my < mh; my++) {
      const sy = my << 1;
      for (let mx = 0; mx < mw; mx++) {
        const i = (sy * W + (mx << 1)) * 4;
        mask[my * mw + mx] = isSkinYCbCr(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
      }
    }
    const integral = this.integral!;
    const stride = mw + 1;
    for (let y = 0; y < mh; y++) {
      let rowSum = 0;
      for (let x = 0; x < mw; x++) {
        rowSum += mask[y * mw + x];
        integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
      }
    }
  }

  private density(x0: number, y0: number, x1: number, y1: number): number {
    const integral = this.integral!;
    const stride = this.maskW + 1;
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    const sum =
      integral[y1 * stride + x1] -
      integral[y0 * stride + x1] -
      integral[y1 * stride + x0] +
      integral[y0 * stride + x0];
    return sum / area;
  }

  /**
   * Barrido de ventanas candidatas ANCLADO AL ÓVALO. El detector
   * anterior partía del centro geométrico del frame; por eso, en un
   * encuadre vertical, terminaba midiendo el torso. Aquí sólo se
   * exploran posiciones plausibles alrededor de la guía que el usuario
   * ve en pantalla, lo que además reduce el coste del barrido.
   */
  private scan(oval: TargetOval): { box: FaceBox; score: number } | null {
    const mw = this.maskW;
    const mh = this.maskH;
    const ovalW = oval.rx * 2 * mw;
    const ovalH = oval.ry * 2 * mh;
    const cx0 = oval.cx * mw;
    const cy0 = oval.cy * mh;

    let best: { box: FaceBox; score: number } | null = null;
    // El rango de escalas debe DESBORDAR los umbrales de encuadre
    // (`FILL_MIN`/`FILL_MAX`): si la escala mínima ya cumpliera el
    // mínimo, nunca podríamos decirle al usuario "acércate".
    const scales = [0.45, 0.6, 0.75, 0.9, 1.1, 1.35, 1.7];
    for (const s of scales) {
      const bw = Math.round(ovalW * s);
      const bh = Math.round(ovalH * s);
      if (bw < 8 || bh < 8 || bw > mw || bh > mh) continue;
      const stepX = Math.max(2, Math.round(bw / 7));
      const stepY = Math.max(2, Math.round(bh / 7));
      // Ventana de búsqueda: el óvalo ampliado un 70%.
      const searchX0 = Math.max(0, Math.round(cx0 - ovalW * 0.85 - bw / 2));
      const searchX1 = Math.min(mw - bw, Math.round(cx0 + ovalW * 0.85 - bw / 2));
      const searchY0 = Math.max(0, Math.round(cy0 - ovalH * 0.85 - bh / 2));
      const searchY1 = Math.min(mh - bh, Math.round(cy0 + ovalH * 0.85 - bh / 2));
      for (let y = searchY0; y <= searchY1; y += stepY) {
        for (let x = searchX0; x <= searchX1; x += stepX) {
          const inner = this.density(x, y, x + bw, y + bh);
          if (inner < 0.3) continue;
          // Penalizamos ventanas cuyo entorno también es piel: eso
          // suele ser un brazo, el cuello o una pared color carne.
          const pad = Math.round(bw * 0.35);
          const ox0 = Math.max(0, x - pad);
          const oy0 = Math.max(0, y - pad);
          const ox1 = Math.min(mw, x + bw + pad);
          const oy1 = Math.min(mh, y + bh + pad);
          const outer = this.density(ox0, oy0, ox1, oy1);
          const contrast = inner - outer;
          // Preferimos lo que caiga cerca del óvalo: es donde le
          // pedimos al usuario que ponga la cara.
          const dx = (x + bw / 2 - cx0) / Math.max(1, ovalW);
          const dy = (y + bh / 2 - cy0) / Math.max(1, ovalH);
          const centerBonus = 1 - Math.min(1, Math.hypot(dx, dy));
          const score = inner * 0.55 + contrast * 0.25 + centerBonus * 0.2;
          if (!best || score > best.score) {
            best = {
              score: Math.min(1, score),
              box: { x: x / mw, y: y / mh, w: bw / mw, h: bh / mh }
            };
          }
        }
      }
    }
    return best && best.score >= 0.35 ? best : null;
  }
}

/**
 * Locus de piel en YCbCr. Invariante al tono de piel y bastante
 * estable bajo luz cálida/fría, que es exactamente lo que la regla
 * RGB anterior no lograba.
 */
export function isSkinYCbCr(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 30 || y > 250) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 133 && cr >= 133 && cr <= 177 && cr >= cb - 20;
}

function clamp(min: number, max: number, v: number): number {
  return v < min ? min : v > max ? max : v;
}
