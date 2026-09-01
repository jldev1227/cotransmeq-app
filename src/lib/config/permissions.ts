/**
 * Sistema de permisos por área - Config compartida frontend
 */

export type AccessLevel = 'full' | 'read' | 'limited'

export type Area = 'administracion' | 'operaciones' | 'contabilidad' | 'facturacion' | 'talento_humano' | 'hseq'

export const AREA_LABELS: Record<Area, string> = {
  administracion: 'Administración',
  operaciones: 'Operaciones',
  contabilidad: 'Contabilidad',
  facturacion: 'Facturación',
  talento_humano: 'Talento Humano',
  hseq: 'HSEQ'
}

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
  contabilidad: {
    full: ['administracion', 'contabilidad'],
    description: 'Módulo de contabilidad'
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

export function checkAccess(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  moduleId: string
): { allowed: boolean; level: AccessLevel | null } {
  const permission = ROUTE_PERMISSIONS[moduleId]
  if (!permission) {
    return { allowed: false, level: null }
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
  userAreas: Area[] | Area | null | undefined
): Record<string, AccessLevel> {
  const modules: Record<string, AccessLevel> = {}
  for (const [moduleId] of Object.entries(ROUTE_PERMISSIONS)) {
    const { allowed, level } = checkAccess(userRole, userAreas, moduleId)
    if (allowed && level) {
      modules[moduleId] = level
    }
  }
  return modules
}
