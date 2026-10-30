/**
 * Geometría de captura biométrica — FUENTE ÚNICA DE VERDAD.
 *
 * El bug que motiva este módulo: en móvil el usuario apuntaba la
 * cámara a su cara y en pantalla veía su torso. Tres causas
 * encadenadas, todas de coordenadas:
 *
 *  1. El `<video>` se pintaba con `object-fit: cover` dentro de una
 *     caja fija `4/3` (apaisada). El stream frontal de un teléfono en
 *     vertical es ~`3/4`, así que `cover` escalaba por ancho y
 *     recortaba ~44% del alto POR EL CENTRO: la cara (que vive en el
 *     tercio superior del encuadre) quedaba fuera y sobraba el pecho.
 *  2. El motor analizaba `drawImage(video, 0, 0, 320, 240)`, es decir
 *     el frame COMPLETO deformado a 4:3. La imagen que analizaba el
 *     detector no era la que veía el usuario.
 *  3. El óvalo guía se dibujaba en `cy=38` mientras el ROI de
 *     detección estaba fijo en el centro (`cy=50`). La UI señalaba un
 *     sitio y el algoritmo miraba otro.
 *
 * La corrección: **un solo sistema de coordenadas**. La caja visible,
 * el recorte que se dibuja en el canvas de análisis y el óvalo guía se
 * calculan todos aquí, en coordenadas normalizadas 0..1 de la caja
 * visible. Si la UI cambia de tamaño o el teléfono rota, el motor
 * recibe el nuevo `aspect` y todo sigue cuadrando.
 *
 * Convención de espejo: el preview se muestra espejado (selfie) y el
 * canvas de análisis se dibuja TAMBIÉN espejado. Así "izquierda" en el
 * motor, en el óvalo y en la pantalla del usuario significan lo mismo.
 */

export type CaptureOrientation = 'portrait' | 'landscape';

/** Rect de origen (en píxeles del video) que se dibuja en el canvas. */
export interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Óvalo guía en coordenadas normalizadas (0..1) de la caja visible. */
export interface TargetOval {
  cx: number;
  cy: number;
  /** Radio horizontal como fracción del ANCHO de la caja. */
  rx: number;
  /** Radio vertical como fracción del ALTO de la caja. */
  ry: number;
}

/**
 * Sesgo vertical del recorte `cover`.
 *
 * Cuando el stream es más alto que la caja (retrato dentro de una caja
 * casi cuadrada) hay que recortar arriba y abajo. Recortar por el
 * centro (`0.5`, el default de CSS) es exactamente lo que se comía la
 * cara. `0.38` mantiene la cabeza dentro y sacrifica el pecho, que es
 * lo que sobra.
 *
 * El CSS del `<video>` DEBE usar el mismo valor vía
 * `objectPositionCss()`, o la imagen analizada y la mostrada se
 * desalinean otra vez.
 */
export const CROP_BIAS_Y = 0.38;
export const CROP_BIAS_X = 0.5;

/** `object-position` que corresponde 1:1 al recorte de `coverSourceRect`. */
export function objectPositionCss(): string {
  return `${(CROP_BIAS_X * 100).toFixed(1)}% ${(CROP_BIAS_Y * 100).toFixed(1)}%`;
}

/**
 * Réplica exacta de `object-fit: cover` + `object-position`.
 *
 * Devuelve el rect del video que queda VISIBLE dentro de una caja con
 * relación de aspecto `boxAspect` (= ancho / alto).
 */
export function coverSourceRect(
  videoW: number,
  videoH: number,
  boxAspect: number,
  biasX: number = CROP_BIAS_X,
  biasY: number = CROP_BIAS_Y
): CoverRect {
  if (!videoW || !videoH || !Number.isFinite(boxAspect) || boxAspect <= 0) {
    return { sx: 0, sy: 0, sw: videoW || 1, sh: videoH || 1 };
  }
  const videoAspect = videoW / videoH;
  if (videoAspect > boxAspect) {
    // El video es más ancho que la caja → recortamos a los lados.
    const sw = videoH * boxAspect;
    return { sx: (videoW - sw) * biasX, sy: 0, sw, sh: videoH };
  }
  // El video es más alto que la caja → recortamos arriba/abajo con sesgo.
  const sh = videoW / boxAspect;
  return { sx: 0, sy: (videoH - sh) * biasY, sw: videoW, sh };
}

/**
 * Encaja una caja de relación `aspect` DENTRO del hueco disponible,
 * sin recortar (equivalente a `object-fit: contain` aplicado a la caja
 * completa, no al video).
 *
 * Es la contrapartida de `coverSourceRect`: si la caja se estira para
 * llenar el hueco, `cover` recorta la imagen y el usuario percibe un
 * zoom que nadie pidió. Prefiere banda de fondo antes que perder campo
 * de visión — quien se está encuadrando necesita verse entero.
 */
export function fitBox(
  slotW: number,
  slotH: number,
  aspect: number
): { width: number; height: number } | null {
  if (!slotW || !slotH || !Number.isFinite(aspect) || aspect <= 0) return null;
  return slotW / slotH > aspect
    ? { width: Math.round(slotH * aspect), height: Math.round(slotH) }
    : { width: Math.round(slotW), height: Math.round(slotW / aspect) };
}

/** Orientación derivada de la relación de aspecto de la caja visible. */
export function orientationOf(boxAspect: number): CaptureOrientation {
  return boxAspect < 1 ? 'portrait' : 'landscape';
}

/**
 * Relación de aspecto por defecto de la caja de captura, ANTES de que
 * el stream reporte sus dimensiones reales. En móvil arrancamos en
 * retrato para no provocar el recorte que causaba el bug.
 */
export function defaultBoxAspect(isMobile: boolean): number {
  return isMobile ? 3 / 4 : 4 / 3;
}

/** Proporción cabeza (ancho/alto) usada para dimensionar el óvalo. */
const HEAD_ASPECT = 0.78;
/** El óvalo nunca ocupa más de este fragmento del ancho de la caja. */
const MAX_RX = 0.34;

/**
 * Óvalo guía adaptado a la caja visible.
 *
 * Se define por su ALTO (fracción de la caja) y se deriva el ancho con
 * la proporción de una cabeza humana, de modo que el óvalo siempre
 * "parece" una cara sin importar si la caja es 3:4, 4:3 o pantalla
 * completa 9:19.5.
 */
export function targetOval(boxAspect: number): TargetOval {
  const a = Number.isFinite(boxAspect) && boxAspect > 0 ? boxAspect : 3 / 4;
  // Interpolamos el alto del óvalo entre retrato (0.30) y apaisado (0.36).
  const t = clamp01((a - 0.85) / (1.2 - 0.85));
  let ry = 0.3 + t * 0.06;
  let rx = (ry * HEAD_ASPECT) / a;
  if (rx > MAX_RX) {
    // Cajas muy altas (pantalla completa en móvil): limitamos el ancho
    // y recalculamos el alto para conservar la proporción de cabeza.
    rx = MAX_RX;
    ry = (rx * a) / HEAD_ASPECT;
  }
  // La cara se sostiene un poco por encima del centro geométrico: es
  // donde queda la cabeza cuando alguien sujeta el teléfono a la
  // altura del pecho y mira la pantalla.
  const cy = 0.44 + t * 0.03;
  return { cx: 0.5, cy, rx, ry };
}

/** Óvalo en píxeles de una caja concreta (para canvas / SVG absoluto). */
export function ovalToPixels(oval: TargetOval, boxW: number, boxH: number) {
  return {
    cx: oval.cx * boxW,
    cy: oval.cy * boxH,
    rx: oval.rx * boxW,
    ry: oval.ry * boxH
  };
}

/**
 * Resolución del canvas de análisis. Mantiene la relación de aspecto
 * de la caja visible (invariante que hace que las coordenadas del
 * detector sean directamente las de la pantalla) y limita el lado
 * corto a 256 px: suficiente para detección, barato para el móvil.
 */
export function analysisSize(boxAspect: number, shortSide = 256) {
  const a = Number.isFinite(boxAspect) && boxAspect > 0 ? boxAspect : 3 / 4;
  if (a < 1) {
    return { width: Math.max(96, Math.round(shortSide * a)), height: shortSide };
  }
  return { width: shortSide, height: Math.max(96, Math.round(shortSide / a)) };
}

/** Heurística de dispositivo móvil (touch + UA), sin dependencias. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && 'ontouchend' in document);
  return iOS || /Android|Mobi/i.test(ua);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
