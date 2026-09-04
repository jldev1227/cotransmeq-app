import { apiClient } from './apiClient'

/** Devuelve la URL base del API en runtime (igual a la del apiClient). */
function getApiBaseUrl(): string {
  return (apiClient.defaults.baseURL as string) || ''
}

/** Estados administrativos.
 *
 *  `condicionado` es una DECISIÓN FINAL: cierra la evaluación y, en los
 *  formatos con documento controlado, emite una versión documental nueva.
 *  No es sinónimo de `escalado`, que deja el caso pendiente de decisión. */
export type EstadoSarlaft =
  | 'recibido'
  | 'en_revision'
  | 'aprobado'
  | 'condicionado'
  | 'rechazado'
  | 'escalado'
export type TipoFormularioSarlaft =
  | 'cliente_proveedor'
  | 'accionistas'
  | 'personal'
  | 'autorizacion_propietario'
  | 'declaracion_empresa_transporte'

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

/** Definición del formato tal como la publica el backend. Se usa para
 *  renderizar genéricamente los formularios sin mapa de campos curado. */
export interface SarlaftPreguntaDefinicion {
  id: string
  pregunta: string
  tipo_respuesta: string
  modo_respuesta?: string
  opciones?: string[] | null
  obligatorio?: boolean
  nota?: string
}

export interface SarlaftSeccionDefinicion {
  seccion: string
  tipo_bloque?: string
  key_tabla?: string
  nota?: string
  preguntas: SarlaftPreguntaDefinicion[]
}

export interface SarlaftFormularioDefinicion {
  codigo: string
  titulo: string
  version: string
  tipo: TipoFormularioSarlaft
  categoria?: 'sarlaft' | 'individual'
  secciones: SarlaftSeccionDefinicion[]
}

export interface SarlaftFormularioResumen {
  id: string
  radicado: string
  codigo_formulario: 'SLFT-PTEE-FR-04' | 'SLFT-PTEE-FR-05' | 'SLFT-PTEE-FR-06' | 'SLFT-PTEE-FR-12' | 'GC-FOR-13'
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

/** Intento de entrega de una versión documental. Nunca trae el token de
 *  descarga: en base de datos solo vive su hash. */
export interface SarlaftEntregaDocumento {
  id: string
  canal: 'email_declarante' | 'email_interno' | 'descarga'
  destinatario: string | null
  estado: 'pendiente' | 'enviado' | 'fallido' | 'descargado' | 'revocado'
  proveedor: string | null
  provider_message_id: string | null
  intento: number
  error_codigo: string | null
  expires_at: string | null
  completed_at: string | null
  created_at: string
}

/** Versión inmutable del PDF generado sobre el formato controlado.
 *
 *  La versión 1 es la `recibida` (sin resultado marcado) y nunca cambia; cada
 *  decisión final emite una `evaluada` nueva con su propio hash. */
export interface SarlaftDocumentoGenerado {
  id: string
  clase: string
  marca: string
  version_documento: number
  estado_documental: 'recibida' | 'evaluada'
  codigo_template: string
  version_template: string
  template_sha256: string
  pdf_sha256: string
  mime_type: string
  tamano_bytes: string
  created_at: string
  generado_por: { id: string; nombre: string } | null
  entregas: SarlaftEntregaDocumento[]
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
  /** Null si el código de formato ya no existe en el backend. */
  definicion: SarlaftFormularioDefinicion | null
  documentos: SarlaftDocumento[]
  /** Vacío para los formatos que no se dibujan sobre un template. */
  documentos_generados: SarlaftDocumentoGenerado[]
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
  },

  /**
   * Construye la URL del endpoint para descargar el PDF del formulario.
   * Se usa como href en un <a> para forzar descarga nativa.
   */
  urlPDF(id: string): string {
    return `${getApiBaseUrl()}/api/formularios-sarlaft/${id}/pdf`
  },

  /**
   * Descarga el binario ARCHIVADO de una versión documental concreta.
   *
   * No regenera nada: sirve exactamente el PDF que se entregó, que es el que
   * corresponde al hash registrado.
   */
  async descargarVersionDocumental(
    formularioId: string,
    documentoId: string,
    nombreSugerido?: string
  ): Promise<string> {
    const r = await apiClient.get<Blob>(
      `/api/formularios-sarlaft/${formularioId}/documentos-generados/${documentoId}/pdf`,
      { responseType: 'blob', ...{ _noRetry: true } } as any
    )
    const filename =
      parseFilename(r.headers['content-disposition']) || nombreSugerido || `documento_${documentoId}.pdf`
    triggerBrowserDownload(r.data, filename)
    return filename
  },

  /**
   * Construye la URL del endpoint para descargar el ZIP de evidencia.
   */
  urlEvidencia(id: string): string {
    return `${getApiBaseUrl()}/api/formularios-sarlaft/${id}/evidencia`
  },

  /**
   * Descarga el PDF (respuestas + firma) y dispara la descarga en el navegador.
   * Devuelve el nombre de archivo sugerido.
   */
  async descargarPDF(id: string): Promise<string> {
    const r = await apiClient.get<Blob>(`/api/formularios-sarlaft/${id}/pdf`, {
      responseType: 'blob',
      ...{ _noRetry: true }
    } as any)
    const filename = parseFilename(r.headers['content-disposition']) || `SARLAFT_${id}.pdf`
    triggerBrowserDownload(r.data, filename)
    return filename
  },

  /**
   * Descarga el ZIP de evidencia completa (PDF + adjuntos) y dispara la
   * descarga en el navegador.
   */
  async descargarEvidencia(id: string): Promise<string> {
    const r = await apiClient.get<Blob>(`/api/formularios-sarlaft/${id}/evidencia`, {
      responseType: 'blob',
      ...{ _noRetry: true }
    } as any)
    const filename = parseFilename(r.headers['content-disposition']) || `Evidencia_SARLAFT_${id}.zip`
    triggerBrowserDownload(r.data, filename)
    return filename
  }
}

/** Extrae `filename="..."` del header Content-Disposition. */
function parseFilename(header: string | undefined | null): string | null {
  if (!header) return null
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return m ? decodeURIComponent(m[1].trim()) : null
}

/** Dispara la descarga de un Blob en el navegador. */
function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Liberar memoria tras un tick
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export const TIPO_FORMULARIO_LABELS: Record<TipoFormularioSarlaft, string> = {
  cliente_proveedor: 'Cliente / Proveedor',
  accionistas: 'Accionistas',
  personal: 'Personal',
  autorizacion_propietario: 'Autorización del Propietario',
  declaracion_empresa_transporte: 'Declaración empresa de transporte'
}

export const TIPO_FORMULARIO_CODIGOS: Record<TipoFormularioSarlaft, string> = {
  cliente_proveedor: 'SLFT-PTEE-FR-04',
  accionistas: 'SLFT-PTEE-FR-05',
  personal: 'SLFT-PTEE-FR-06',
  autorizacion_propietario: 'SLFT-PTEE-FR-12',
  declaracion_empresa_transporte: 'GC-FOR-13'
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
  // Ámbar propio: es una aprobación con condiciones, así que no puede leerse
  // ni como el verde de Aprobado ni como el rojo de Rechazado.
  condicionado: {
    label: 'Condicionado',
    color: '#9A3412',
    bg: '#FFF7ED',
    border: '#FED7AA',
    dot: '#F97316'
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
  // SARLAFT (SLFT-PTEE-FR-04 / 05 / 06)
  cedula_representante: 'Cédula de ciudadanía',
  rut: 'RUT actualizado',
  certificado_existencia: 'Certificado de existencia',
  composicion_accionaria: 'Composición accionaria',
  // Autorización del Propietario (SLFT-PTEE-FR-12)
  identidad_propietario: 'Documento de identidad del propietario',
  identidad_tercero: 'Documento de identidad del tercero autorizado',
  rut_propietario: 'RUT del propietario',
  rut_tercero: 'RUT del tercero autorizado',
  tarjeta_propiedad: 'Tarjeta de propiedad del vehículo',
  certificacion_bancaria: 'Certificación bancaria del tercero',
  cert_existencia_propietario: 'Certificado de existencia y representación legal',
  cert_tradicion_vehiculo: 'Certificado de tradición del vehículo',
  contrato_relacion_juridica: 'Contrato que acredita la relación jurídica',
  formulario_conocimiento_tercero: 'Formulario de conocimiento del tercero',
  otros_anexos: 'Otros anexos',
  // Declaración de empresa de transporte (GC-FOR-13)
  anexo_alertas: 'Documento anexo de alertas',
  relacion_vehiculos: 'Relación de vehículos cubiertos'
}

/**
 * Configuración de contacto (destinatarios + canales) por tipo de formulario.
 * Espejo del registro del backend en `sarlaft-config.ts`. Aquí se usa para
 * pintar el sidebar del detalle con enlaces wa.me, tel: y mailto:.
 */
export interface ContactoSarlaft {
  emails: string[]
  area_responsable: string
  telefono_principal: string
  telefono_wa: string
  correo_publico?: string
}

// Espejo de `sarlaft-config.ts` del backend. Los únicos buzones autorizados
// para recibir formularios SARLAFT + PTEE son compras.cotransmeq@hotmail.com
// (Compras/Proveedores) y cotransmeqreportesla@gmail.com (reportes de
// Cumplimiento), y ambos reciben todos los tipos. El `correo_publico` sí varía:
// es el canal de dudas que se le muestra al titular. Si se edita esta tabla hay
// que editar también la del backend, que es la que manda en el envío real.
export const CONTACTO_POR_TIPO: Record<TipoFormularioSarlaft, ContactoSarlaft> = {
  cliente_proveedor: {
    emails: ['compras.cotransmeq@hotmail.com', 'cotransmeqreportesla@gmail.com'],
    area_responsable: 'Operaciones',
    telefono_principal: '+57 302 571 1858',
    telefono_wa: '573025711858',
    correo_publico: 'compras.cotransmeq@hotmail.com'
  },
  accionistas: {
    emails: ['compras.cotransmeq@hotmail.com', 'cotransmeqreportesla@gmail.com'],
    area_responsable: 'Cumplimiento',
    telefono_principal: '+57 302 571 1858',
    telefono_wa: '573025711858',
    correo_publico: 'cotransmeqreportesla@gmail.com'
  },
  personal: {
    emails: ['compras.cotransmeq@hotmail.com', 'cotransmeqreportesla@gmail.com'],
    area_responsable: 'Talento Humano',
    telefono_principal: '+57 302 571 1858',
    telefono_wa: '573025711858',
    correo_publico: 'cotransmeqreportesla@gmail.com'
  },
  autorizacion_propietario: {
    emails: ['compras.cotransmeq@hotmail.com', 'cotransmeqreportesla@gmail.com'],
    area_responsable: 'Cumplimiento',
    telefono_principal: '+57 302 571 1858',
    telefono_wa: '573025711858',
    correo_publico: 'cotransmeqreportesla@gmail.com'
  },
  declaracion_empresa_transporte: {
    emails: ['compras.cotransmeq@hotmail.com', 'cotransmeqreportesla@gmail.com'],
    area_responsable: 'Cumplimiento',
    telefono_principal: '+57 302 571 1858',
    telefono_wa: '573025711858',
    correo_publico: 'cotransmeqreportesla@gmail.com'
  }
}

/** Helpers de URL (wa.me, tel:, mailto:) */
export function waLink(c: ContactoSarlaft): string {
  return `https://wa.me/${c.telefono_wa}`
}
export function telLink(c: ContactoSarlaft): string {
  return `tel:+${c.telefono_wa}`
}
export function mailtoLink(c: ContactoSarlaft): string {
  return `mailto:${c.correo_publico ?? c.emails[0]}`
}
