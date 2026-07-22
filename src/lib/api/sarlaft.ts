import { apiClient } from './apiClient'

export type EstadoSarlaft = 'recibido' | 'en_revision' | 'aprobado' | 'rechazado' | 'escalado'
export type TipoFormularioSarlaft = 'cliente_proveedor' | 'accionistas' | 'personal'

export interface SarlaftDocumento {
  id: string
  tipo_documento: string
  nombre_archivo: string
  s3_key: string
  mime_type: string
  tamano_bytes: string
  hash_sha256: string | null
  created_at: string
}

export interface SarlaftFormularioResumen {
  id: string
  radicado: string
  codigo_formulario: 'GC-FR-04' | 'GC-FR-05' | 'GC-FR-06'
  tipo_formulario: TipoFormularioSarlaft
  version: string
  fecha_envio: string
  fecha_diligenciamiento: string | null
  nombre_completo: string | null
  tipo_documento: string | null
  numero_documento: string | null
  correo: string | null
  telefono: string | null
  estado: EstadoSarlaft
  documentos_count: number
  evaluado_por: { id: string; nombre: string } | null
}

export interface SarlaftFormularioDetalle extends SarlaftFormularioResumen {
  evaluacion_concepto: string | null
  evaluacion_observaciones: string | null
  evaluado_at: string | null
  evaluado_por: { id: string; nombre: string; correo: string } | null
  ip_origen: string | null
  user_agent: string | null
  referer: string | null
  respuestas: Record<string, any>
  documentos: SarlaftDocumento[]
  created_at: string
  updated_at: string
}

export interface SarlaftPagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface SarlaftListado {
  items: SarlaftFormularioResumen[]
  pagination: SarlaftPagination
}

export const sarlaftAPI = {
  async listar(params: {
    page?: number
    limit?: number
    search?: string
    tipo_formulario?: TipoFormularioSarlaft
    estado?: EstadoSarlaft
    fecha_desde?: string
    fecha_hasta?: string
  } = {}): Promise<SarlaftListado> {
    const r = await apiClient.get<{ success: boolean } & SarlaftListado>('/api/formularios-sarlaft', { params })
    return { items: r.data.items, pagination: r.data.pagination }
  },

  async obtenerDetalle(id: string): Promise<SarlaftFormularioDetalle> {
    const r = await apiClient.get<{ success: boolean; formulario: SarlaftFormularioDetalle }>(`/api/formularios-sarlaft/${id}`)
    return r.data.formulario
  },

  async obtenerUrlDescarga(documentoId: string): Promise<{
    id: string
    nombre_archivo: string
    mime_type: string
    tamano_bytes: string
    url: string
    expires_in: number
  }> {
    const r = await apiClient.get(`/api/formularios-sarlaft/_/documentos/${documentoId}/url`)
    return r.data
  },

  async actualizarEvaluacion(
    id: string,
    data: { estado?: EstadoSarlaft; concepto?: string; observaciones?: string }
  ): Promise<SarlaftFormularioDetalle> {
    const r = await apiClient.patch(`/api/formularios-sarlaft/${id}/evaluacion`, data)
    return r.data.formulario
  }
}

export const TIPO_FORMULARIO_LABELS: Record<TipoFormularioSarlaft, string> = {
  cliente_proveedor: 'Cliente / Proveedor',
  accionistas: 'Accionistas',
  personal: 'Personal'
}

export const TIPO_FORMULARIO_CODIGOS: Record<TipoFormularioSarlaft, string> = {
  cliente_proveedor: 'GC-FR-04',
  accionistas: 'GC-FR-05',
  personal: 'GC-FR-06'
}

export const ESTADO_LABELS: Record<EstadoSarlaft, { label: string; color: string; bg: string; border: string; dot: string }> = {
  recibido: {
    label: 'Recibido',
    color: '#1E3A8A',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    dot: '#3B82F6'
  },
  en_revision: {
    label: 'En revisión',
    color: '#92400E',
    bg: '#FFFBEB',
    border: '#FDE68A',
    dot: '#F59E0B'
  },
  aprobado: {
    label: 'Aprobado',
    color: '#065F46',
    bg: '#ECFDF5',
    border: '#A7F3D0',
    dot: '#10B981'
  },
  rechazado: {
    label: 'Rechazado',
    color: '#991B1B',
    bg: '#FEF2F2',
    border: '#FECACA',
    dot: '#EF4444'
  },
  escalado: {
    label: 'Escalado',
    color: '#7C3AED',
    bg: '#F5F3FF',
    border: '#DDD6FE',
    dot: '#8B5CF6'
  }
}

export const TIPO_DOCUMENTO_LABELS: Record<string, string> = {
  cedula_representante: 'Cédula de ciudadanía',
  rut: 'RUT actualizado',
  certificado_existencia: 'Certificado de existencia',
  composicion_accionaria: 'Composición accionaria'
}
