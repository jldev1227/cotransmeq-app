/**
 * Tipos públicos del sistema de identidad biométrica (cliente).
 * Espejo de los DTOs del backend (`biometric/dto/*`).
 */
import type { CaptureOrientation } from './biometric.geometry';
import type { FramingHint } from './face.detector';

export type BiometricModel =
  | 'mediapipe-stub'
  | 'capacitaciones-face-v2'
  | 'face-api'
  | 'onnx-runtime'
  | string;

/**
 * Modelo que produce el engine actual. Se persiste junto al template.
 *
 * Cambiarlo INVALIDA los templates anteriores: el espacio vectorial no
 * es comparable entre versiones (v1 proyectaba el ROI central crudo;
 * v2 proyecta un recorte alineado al rostro y normalizado en
 * iluminación). El backend detecta la discrepancia en `verify` y el
 * cliente pide re-enrolar en vez de devolver un "no coincide" falso.
 */
export const CURRENT_BIOMETRIC_MODEL: BiometricModel = 'capacitaciones-face-v2';

export interface BiometricStatus {
  enrolled: boolean;
  enrolledAt: string | null;
  model: string | null;
  quality: number | null;
  version: number | null;
  embeddingDim: number | null;
}

export interface BiometricEnrollResult {
  id: string;
  version: number;
  enrolledAt: string;
  embeddingDim: number;
  quality: number;
  model: string;
}

export interface BiometricVerifyResult {
  matched: boolean;
  similarity: number;
  threshold: number;
  /** El template guardado viene de otra versión del engine. */
  modelMismatch?: boolean;
  /** El usuario debe volver a enrolarse antes de poder verificarse. */
  requiresReenroll?: boolean;
}

export interface BiometricPolicy {
  id: string;
  required: boolean;
  requiredForRoles: string[];
  requiredMessage: string | null;
  matchThreshold: number;
  maxEnrollAttempts: number;
  updatedAt: string;
}

export interface BiometricStats {
  enrolledUsers: number;
  activeUsers: number;
  unenrolledUsers: number;
  coverage: number;
}

export type LivenessChallengeId =
  | 'center'
  | 'turn-left'
  | 'turn-right'
  | 'blink'
  | 'smile';

export interface LivenessChallenge {
  id: LivenessChallengeId;
  label: string;
  instruction: string;
  /** Pista corta para la UI móvil (una línea, sin verbo compuesto). */
  hint?: string;
}

/** Catálogo completo. La secuencia real se arma con `buildLivenessSequence`. */
export const LIVENESS_CHALLENGES: LivenessChallenge[] = [
  {
    id: 'center',
    label: 'Centro',
    instruction: 'Centra tu rostro en el óvalo',
    hint: 'Mira de frente a la cámara'
  },
  {
    id: 'turn-left',
    label: 'Gira a la izquierda',
    instruction: 'Gira la cabeza hacia tu izquierda',
    hint: 'Sin mover el teléfono'
  },
  {
    id: 'turn-right',
    label: 'Gira a la derecha',
    instruction: 'Gira la cabeza hacia tu derecha',
    hint: 'Sin mover el teléfono'
  },
  { id: 'blink', label: 'Parpadeo', instruction: 'Parpadea una vez', hint: 'Haz un parpadeo natural' },
  { id: 'smile', label: 'Sonrisa', instruction: 'Sonríe ampliamente', hint: 'Muestra los dientes' }
];

const CHALLENGE_BY_ID = new Map(LIVENESS_CHALLENGES.map((c) => [c.id, c]));

/**
 * Arma la secuencia de pruebas de vida.
 *
 * `center` siempre va primero (fija el encuadre y la línea base de
 * todas las señales). El resto se baraja y se recorta a `count`: el
 * orden variable encarece el ataque por reproducción de un video
 * grabado, y en móvil 3 retos son suficientes sin agotar al usuario
 * sosteniendo el teléfono con el brazo estirado.
 */
export function buildLivenessSequence(count = 3): LivenessChallenge[] {
  const pool: LivenessChallengeId[] = ['turn-left', 'turn-right', 'blink', 'smile'];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.max(1, Math.min(count, pool.length)));
  return [
    CHALLENGE_BY_ID.get('center')!,
    ...picked.map((id) => CHALLENGE_BY_ID.get(id)!)
  ];
}

export interface BiometricEngineProgress {
  step: 'init' | 'camera' | 'detection' | 'liveness' | 'embedding' | 'done' | 'error';
  message: string;
  challenge?: LivenessChallenge;
  challengesCompleted?: number;
  challengesTotal?: number;
  faceQuality?: number;
  /** Avance dentro del reto actual (0..1) para animar el anillo. */
  challengeProgress?: number;
  /** Estado de encuadre en vivo (acércate, más luz, …). */
  hint?: FramingHint | null;
  hintMessage?: string | null;
  /** Relación de aspecto REAL del stream, para que la UI ajuste la caja. */
  streamAspect?: number | null;
  orientation?: CaptureOrientation;
}

export interface BiometricEngineResult {
  embedding: number[];
  embeddingDim: number;
  quality: number;
  model: BiometricModel;
  /** Cuántos frames se promediaron para el template. */
  samples: number;
  /** Retos superados, en el orden en que se pidieron. */
  challenges: LivenessChallengeId[];
  /** Contexto de captura — se audita, no se persiste como dato biométrico. */
  capture: {
    platform: string;
    orientation: CaptureOrientation;
    streamWidth: number;
    streamHeight: number;
    detector: 'native' | 'heuristic';
  };
}
