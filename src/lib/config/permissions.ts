/**
 * Sistema de permisos por área - Config compartida frontend
 */

export type AccessLevel = 'full' | 'read' | 'limited'

export type Area =
  | 'administracion'
  | 'operaciones'
  | 'contabilidad'
  | 'facturacion'
  | 'talento_humano'
  | 'hseq'
  | 'mantenimiento'

export const AREA_LABELS: Record<Area, string> = {
  administracion: 'Administración',
  operaciones: 'Operaciones',
  contabilidad: 'Contabilidad',
  facturacion: 'Facturación',
  talento_humano: 'Talento Humano',
  hseq: 'HSEQ',
  mantenimiento: 'Mantenimiento'
}

/**
 * Lista canónica de áreas, para poblar desplegables.
 *
 * Se DERIVA de `AREA_LABELS` en vez de escribirse otra vez: es la misma
 * información, y el espejo del backend documenta que cuando se añadió
 * `mantenimiento` había cuatro copias del array y tres se quedaron sin
 * actualizar. Una copia menos es un sitio menos donde olvidarse.
 */
export const AREAS = Object.keys(AREA_LABELS) as Area[]

export interface RoutePermission {
  full: Area[]
  read?: Area[]
  limited?: Area[]
  general?: boolean
  description?: string
}

export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = {
  perfil: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Mi perfil'
  },
  flota: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Gestión de flota vehicular'
  },
  conductores: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Gestión de conductores'
  },
  servicios: {
    full: ['administracion', 'operaciones'],
    read: ['hseq', 'talento_humano', 'facturacion'],
    description: 'Gestión de servicios de transporte'
  },
  recargos: {
    full: ['administracion', 'operaciones'],
    read: ['hseq', 'facturacion', 'talento_humano'],
    description: 'Gestión de recargos/planillas'
  },
  clientes: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'hseq'],
    general: true,
    description: 'Gestión de clientes/empresas'
  },
  sarlaft: {
    full: ['administracion', 'talento_humano'],
    description: 'Formularios SARLAFT + PTEE (cumplimiento)'
  },
  asistencias: {
    full: ['administracion', 'hseq'],
    description: 'Formularios de asistencia'
  },
  'acciones-correctivas': {
    full: ['administracion', 'hseq'],
    description: 'Acciones correctivas y preventivas'
  },
  evaluaciones: {
    full: ['administracion', 'hseq'],
    description: 'Evaluaciones de conductores'
  },
  'salidas-nc': {
    full: ['administracion', 'operaciones', 'hseq'],
    description: 'Salidas no conformes'
  },
  // Espejo EXACTO de `backend-nest/src/config/permissions.ts`. Este mapa solo
  // decide qué se PINTA; el backend lo vuelve a comprobar en cada ruta. Si los
  // dos no coinciden, el sidebar muestra una entrada que la API rechaza con 403
  // (o al contrario, esconde algo a quien sí puede usarlo).
  formularios: {
    full: ['administracion', 'hseq'],
    read: ['operaciones'],
    description: 'Formularios dinámicos (constructor, asignaciones y envíos)'
  },

  /**
   * Diligenciar lo que a uno le asignaron.
   *
   * Módulo APARTE de `formularios` y `general: true` a propósito. `formularios`
   * es el constructor: publicar una versión o cambiar una asignación afecta a
   * cientos de personas y por eso solo lo tienen `administracion` y `hseq`.
   * Rellenar un formato que alguien te asignó no tiene nada de eso, y si
   * dependiera del mismo permiso, a un usuario de contabilidad al que HSEQ le
   * asigna una inspección no le aparecería la pantalla —ni siquiera podría
   * abrirla, porque el guard resuelve el módulo por el primer segmento de la
   * ruta—.
   *
   * El acceso a UNA asignación concreta no lo da este permiso: lo dan los
   * targets de la asignación, resueltos en `condicionAcceso`. Esto solo abre la
   * puerta de la pantalla.
   */
  'mis-formularios': {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
    general: true,
    description: 'Diligenciar los formularios asignados a mí'
  },
  nomina: {
    full: ['administracion', 'talento_humano', 'facturacion'],
    description: 'Gestión de nómina'
  },
  extractos: {
    full: ['administracion', 'operaciones'],
    description: 'Extractos de operaciones'
  },
  'liquidaciones-servicios': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion'],
    description: 'Liquidaciones de servicios'
  },
  'liquidaciones-terceros': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion', 'contabilidad'],
    description: 'Liquidaciones de terceros (propietarios)'
  },
  'liquidaciones-terceros-adicionales': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion', 'contabilidad'],
    description: 'Adicionales (unificados) de cierres finales de terceros'
  },
  pesv: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Plan Estratégico de Seguridad Vial'
  },
  certificados: {
    full: ['administracion', 'contabilidad'],
    description: 'Certificados tributarios de terceros'
  },
  terceros: {
    full: ['administracion', 'contabilidad', 'talento_humano', 'facturacion', 'operaciones'],
    description: 'Gestión de terceros'
  },
  usuarios: {
    full: ['administracion'],
    description: 'Gestión de usuarios del sistema'
  },
  sesiones: {
    full: ['administracion'],
    description: 'Visualización de sesiones'
  },
  directorio: {
    full: ['administracion'],
    description: 'Directorio del equipo — presencia e invitaciones'
  }
}

/**
 * Permisos por ruta guardados en el propio usuario (`users.permisos_rutas`).
 * `null` o `{}` significan «manda el área»; con al menos una clave es una lista
 * blanca que sustituye por completo a las reglas por área.
 */
export type PermisosRutas = Record<string, AccessLevel> | null | undefined

export function checkAccess(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  moduleId: string,
  rutasOverride?: PermisosRutas
): { allowed: boolean; level: AccessLevel | null } {
  const permission = ROUTE_PERMISSIONS[moduleId]
  if (!permission) {
    return { allowed: false, level: null }
  }

  // Lista blanca por usuario. Se resuelve ANTES que `general` a propósito: el
  // sentido de la lista es recortar («es de mantenimiento pero solo entra a
  // cuatro módulos, y en consulta»), así que un módulo marcado como general
  // también queda fuera si no aparece en ella. Los administradores la ignoran
  // para que un override mal puesto no deje el sistema sin quien lo gestione.
  const override = rutasOverride && Object.keys(rutasOverride).length > 0 ? rutasOverride : null
  const isAdmin = (userRole ?? '').toLowerCase() === 'admin'

  if (override && !isAdmin) {
    // El perfil propio nunca se recorta: sin él el usuario no podría ni ver ni
    // corregir sus propios datos, y no hay forma de pedirlo desde la UI.
    if (moduleId === 'perfil') {
      return { allowed: true, level: 'full' }
    }
    const level = override[moduleId]
    return level ? { allowed: true, level } : { allowed: false, level: null }
  }

  if (permission.general) {
    return { allowed: true, level: 'full' }
  }

  // Normalize to array
  const areas: Area[] = !userAreas ? [] : Array.isArray(userAreas) ? userAreas : [userAreas]
  if (areas.length === 0) {
    return { allowed: false, level: null }
  }

  if (areas.some(a => permission.full.includes(a))) {
    return { allowed: true, level: 'full' }
  }

  if (permission.read && areas.some(a => permission.read!.includes(a))) {
    return { allowed: true, level: 'read' }
  }

  if (permission.limited && areas.some(a => permission.limited!.includes(a))) {
    return { allowed: true, level: 'limited' }
  }

  return { allowed: false, level: null }
}

export function getAccessibleModules(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  rutasOverride?: PermisosRutas
): Record<string, AccessLevel> {
  const modules: Record<string, AccessLevel> = {}
  for (const [moduleId] of Object.entries(ROUTE_PERMISSIONS)) {
    const { allowed, level } = checkAccess(userRole, userAreas, moduleId, rutasOverride)
    if (allowed && level) {
      modules[moduleId] = level
    }
  }
  return modules
}
