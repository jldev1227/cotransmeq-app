// Mapa completo de labels y tipos para los IDs de pregunta de los 3 formularios.
// Los IDs en este archivo son IDs LÓGICOS (sin prefijo de tipo), usados para
// agrupar campos similares entre los 3 formularios y mostrarlos con una
// etiqueta legible. La función `getKeyParaTipo` resuelve cada ID lógico al
// ID real usado por el backend (CLI-*, PER-*, ACC-*) según el tipo de
// formulario y (en clientes/proveedores) el tipo de cliente.

export type TipoCampo = 'texto' | 'numero' | 'moneda' | 'fecha' | 'si_no' | 'firma' | 'tabla' | 'lista' | 'opcion' | 'porcentaje'

/** Solo los tres formularios de conocimiento SARLAFT tienen mapa de campos
 *  curado en este archivo. Los formatos individuales (ej. SLFT-PTEE-FR-12) se
 *  renderizan en el dashboard a partir de su definición del backend. */
export type TipoFormularioSarlaft = 'cliente_proveedor' | 'accionistas' | 'personal'
export type TipoClienteSarlaft = 'Persona Natural' | 'Persona Jurídica' | null

export interface CampoDefinicion {
  id: string
  etiqueta: string
  tipo: TipoCampo
  /** Opciones para tipo 'opcion' o 'si_no' */
  opciones?: string[]
  /** Si es true, el valor vacío se considera información importante que no debe ocultarse */
  destacado?: boolean
}

export const CAMPOS: Record<string, CampoDefinicion> = {
  // ───────── Encabezado ─────────
  'ENC-01': { id: 'ENC-01', etiqueta: 'Fecha de diligenciamiento', tipo: 'fecha' },
  'ENC-02': { id: 'ENC-02', etiqueta: 'Autorización de tratamiento de datos', tipo: 'texto' },
  'ENC-03': { id: 'ENC-03', etiqueta: 'Nombre de quien autoriza', tipo: 'texto', destacado: true },
  'ENC-04': { id: 'ENC-04', etiqueta: 'Firma de quien autoriza', tipo: 'firma' },

  // ───────── Información general (compartida) ─────────
  'IG-01': { id: 'IG-01', etiqueta: 'Nombre completo / Razón social', tipo: 'texto', destacado: true },
  'IG-02': { id: 'IG-02', etiqueta: 'Número de cédula / NIT', tipo: 'texto' },
  'IG-03': { id: 'IG-03', etiqueta: 'Cargo', tipo: 'texto' },
  'IG-04': { id: 'IG-04', etiqueta: 'Área', tipo: 'texto' },
  'IG-05': { id: 'IG-05', etiqueta: '¿Persona políticamente expuesta (PEP)?', tipo: 'si_no' },
  'IG-06': { id: 'IG-06', etiqueta: 'Fecha de ingreso', tipo: 'fecha' },

  // ───────── Personal ─────────
  'IP-01': { id: 'IP-01', etiqueta: 'Dirección', tipo: 'texto' },
  'IP-02': { id: 'IP-02', etiqueta: 'Teléfono', tipo: 'texto' },
  'IP-03': { id: 'IP-03', etiqueta: 'Correo electrónico', tipo: 'texto' },
  'IP-04': { id: 'IP-04', etiqueta: 'Estado civil', tipo: 'opcion', opciones: ['Soltero/a', 'Casado/a', 'Unión libre', 'Divorciado/a', 'Viudo/a'] },

  // ───────── Financiera ─────────
  'IF-01': { id: 'IF-01', etiqueta: 'Ingresos mensuales (COP)', tipo: 'moneda' },
  'IF-02': { id: 'IF-02', etiqueta: 'Egresos mensuales (COP)', tipo: 'moneda' },
  'IF-03': { id: 'IF-03', etiqueta: 'Patrimonio (COP)', tipo: 'moneda' },

  // ───────── Empresa (accionistas) ─────────
  'EMP-01': { id: 'EMP-01', etiqueta: 'Razón social', tipo: 'texto', destacado: true },
  'EMP-02': { id: 'EMP-02', etiqueta: 'NIT', tipo: 'texto' },
  'EMP-03': { id: 'EMP-03', etiqueta: 'Dirección', tipo: 'texto' },
  'EMP-04': { id: 'EMP-04', etiqueta: 'Teléfono', tipo: 'texto' },
  'EMP-05': { id: 'EMP-05', etiqueta: 'Correo electrónico', tipo: 'texto' },

  // ───────── Persona Natural (cliente/proveedor) ─────────
  'PN-01': { id: 'PN-01', etiqueta: 'Nombre completo', tipo: 'texto', destacado: true },
  'PN-02': { id: 'PN-02', etiqueta: 'Cédula', tipo: 'texto' },
  'PN-03': { id: 'PN-03', etiqueta: 'Nacionalidad', tipo: 'texto' },
  'PN-04': { id: 'PN-04', etiqueta: 'Fecha de nacimiento', tipo: 'fecha' },
  'PN-05': { id: 'PN-05', etiqueta: 'Actividad económica', tipo: 'texto' },
  'PN-06': { id: 'PN-06', etiqueta: 'Ocupación / Cargo', tipo: 'texto' },
  'PN-07': { id: 'PN-07', etiqueta: 'Dirección', tipo: 'texto' },
  'PN-08': { id: 'PN-08', etiqueta: 'Teléfono', tipo: 'texto' },
  'PN-09': { id: 'PN-09', etiqueta: 'Correo electrónico', tipo: 'texto' },

  // ───────── Persona Jurídica (cliente/proveedor) ─────────
  'PJ-01': { id: 'PJ-01', etiqueta: 'Razón social', tipo: 'texto', destacado: true },
  'PJ-02': { id: 'PJ-02', etiqueta: 'NIT', tipo: 'texto' },
  'PJ-03': { id: 'PJ-03', etiqueta: 'Fecha de constitución', tipo: 'fecha' },
  'PJ-04': { id: 'PJ-04', etiqueta: 'Actividad económica principal', tipo: 'texto' },
  'PJ-05': { id: 'PJ-05', etiqueta: 'Actividad económica secundaria', tipo: 'texto' },

  // ───────── Jurisdicción ─────────
  'JU-01': { id: 'JU-01', etiqueta: 'Nacional — Municipio', tipo: 'texto' },
  'JU-02': { id: 'JU-02', etiqueta: 'Nacional — Departamento', tipo: 'texto' },
  'JU-03': { id: 'JU-03', etiqueta: 'Internacional — País', tipo: 'texto' },
  'JU-04': { id: 'JU-04', etiqueta: 'Internacional — Ciudad', tipo: 'texto' },

  // ───────── Domicilio principal ─────────
  'DP-01': { id: 'DP-01', etiqueta: 'Nacional — Municipio', tipo: 'texto' },
  'DP-02': { id: 'DP-02', etiqueta: 'Nacional — Departamento', tipo: 'texto' },
  'DP-03': { id: 'DP-03', etiqueta: 'Internacional — País', tipo: 'texto' },
  'DP-04': { id: 'DP-04', etiqueta: 'Internacional — Ciudad', tipo: 'texto' },
  'DP-05': { id: 'DP-05', etiqueta: 'Teléfono', tipo: 'texto' },
  'DP-06': { id: 'DP-06', etiqueta: 'Correo', tipo: 'texto' },
  'DP-07': { id: 'DP-07', etiqueta: 'Representante Legal', tipo: 'texto', destacado: true },
  'DP-08': { id: 'DP-08', etiqueta: 'Documento del Representante Legal', tipo: 'texto' },
  'DP-09': { id: 'DP-09', etiqueta: 'Representante Legal Suplente', tipo: 'texto' },
  'DP-10': { id: 'DP-10', etiqueta: 'Documento del RL Suplente', tipo: 'texto' },

  // ───────── Declaraciones SARLAFT/PTEE ─────────
  'DEC-01': { id: 'DEC-01', etiqueta: 'Declaración de veracidad', tipo: 'texto' },
  'DEC-02': { id: 'DEC-02', etiqueta: 'Recursos de origen lícito (LA/FT/FP)', tipo: 'si_no' },
  'DEC-03': { id: 'DEC-03', etiqueta: 'Cumplimiento anticorrupción', tipo: 'si_no' },
  'DEC-04': { id: 'DEC-04', etiqueta: '¿Realiza operaciones en moneda extranjera o activos virtuales?', tipo: 'si_no' },
  'DEC-04-1': { id: 'DEC-04-1', etiqueta: 'Origen lícito de operaciones', tipo: 'si_no' },
  'DEC-04-2': { id: 'DEC-04-2', etiqueta: 'No vinculadas a actividades ilícitas', tipo: 'si_no' },
  'DEC-04-3': { id: 'DEC-04-3', etiqueta: 'Compromiso de informar cambios', tipo: 'texto' },
  'DEC-04-4': { id: 'DEC-04-4', etiqueta: 'Autorización de verificación', tipo: 'si_no' },
  'DEC-05': { id: 'DEC-05', etiqueta: 'Descripción de operaciones en moneda extranjera / virtuales', tipo: 'texto' },

  // ───────── Perfil transaccional ─────────
  'PT-01': { id: 'PT-01', etiqueta: 'Tipo de servicio', tipo: 'texto' },
  'PT-02': { id: 'PT-02', etiqueta: 'Frecuencia', tipo: 'opcion', opciones: ['Diaria', 'Semanal', 'Mensual', 'Trimestral', 'Anual', 'Esporádica'] },
  'PT-03': { id: 'PT-03', etiqueta: 'Valor estimado de operaciones (COP)', tipo: 'moneda' },
  'PT-04': { id: 'PT-04', etiqueta: 'Municipio de origen de los servicios', tipo: 'texto' },
  'PT-05a': { id: 'PT-05a', etiqueta: 'Forma de pago — Transferencia bancaria', tipo: 'si_no' },
  'PT-05b': { id: 'PT-05b', etiqueta: 'Forma de pago — Cheque', tipo: 'si_no' },
  'PT-05c': { id: 'PT-05c', etiqueta: 'Forma de pago — Efectivo', tipo: 'si_no' },
  'PT-06': { id: 'PT-06', etiqueta: 'Entidad bancaria donde realiza el pago', tipo: 'texto' },

  // ───────── Conflicto de intereses ─────────
  'CI-01': { id: 'CI-01', etiqueta: '¿Tiene relación con empleados?', tipo: 'si_no' },
  'CI-02': { id: 'CI-02', etiqueta: '¿Tiene relación con directivos?', tipo: 'si_no' },
  'CI-03': { id: 'CI-03', etiqueta: '¿Tiene relación con entidades públicas?', tipo: 'si_no' },

  // ───────── Composición accionaria ─────────
  'CA-01': { id: 'CA-01', etiqueta: 'Nombre / Razón social del accionista', tipo: 'texto' },
  'CA-02': { id: 'CA-02', etiqueta: 'Cédula / NIT', tipo: 'texto' },
  'CA-03': { id: 'CA-03', etiqueta: 'Nacionalidad', tipo: 'texto' },
  'CA-04': { id: 'CA-04', etiqueta: 'Tipo societario', tipo: 'opcion', opciones: ['Natural', 'Jurídico'] },
  'CA-05': { id: 'CA-05', etiqueta: 'Correo electrónico', tipo: 'texto' },
  'CA-06': { id: 'CA-06', etiqueta: 'Teléfono', tipo: 'texto' },
  'CA-07': { id: 'CA-07', etiqueta: '% de participación', tipo: 'porcentaje' },
  'CA-08': { id: 'CA-08', etiqueta: '¿Persona políticamente expuesta (PEP)?', tipo: 'si_no' },

  // ───────── Beneficiarios finales ─────────
  'BF-01': { id: 'BF-01', etiqueta: 'Nombre completo', tipo: 'texto' },
  'BF-02': { id: 'BF-02', etiqueta: 'Documento', tipo: 'texto' },
  'BF-03': { id: 'BF-03', etiqueta: 'Participación %', tipo: 'porcentaje' },
  'BF-04': { id: 'BF-04', etiqueta: '¿Persona políticamente expuesta (PEP)?', tipo: 'si_no' },
  'BF-05': { id: 'BF-05', etiqueta: 'País de residencia', tipo: 'texto' },

  // ───────── Revisor fiscal ─────────
  'RF-01': { id: 'RF-01', etiqueta: 'Nombre completo', tipo: 'texto' },
  'RF-02': { id: 'RF-02', etiqueta: 'Documento', tipo: 'texto' },
  'RF-03': { id: 'RF-03', etiqueta: '¿Persona políticamente expuesta (PEP)?', tipo: 'si_no' },
  'RF-04': { id: 'RF-04', etiqueta: 'País de residencia', tipo: 'texto' },

  // ───────── Cuentas bancarias ─────────
  'CTA-01': { id: 'CTA-01', etiqueta: 'Entidad bancaria', tipo: 'texto' },
  'CTA-02': { id: 'CTA-02', etiqueta: 'Tipo de producto', tipo: 'opcion', opciones: ['Ahorro', 'Corriente'] },
  'CTA-03': { id: 'CTA-03', etiqueta: 'N° de producto', tipo: 'texto' },

  // ───────── Origen de fondos ─────────
  'OF-01': { id: 'OF-01', etiqueta: 'Origen de fondos', tipo: 'texto' }
}

export const SECCIONES: Array<{ id: string; titulo: string; descripcion: string; campos: string[] }> = [
  {
    id: 'encabezado',
    titulo: 'Encabezado del documento',
    descripcion: 'Datos básicos y autorización de tratamiento de datos',
    campos: ['ENC-01', 'ENC-02', 'ENC-03', 'ENC-04']
  },
  {
    id: 'informacion-general',
    titulo: 'Información general',
    descripcion: 'Datos de identificación del titular',
    campos: ['IG-01', 'IG-02', 'IG-03', 'IG-04', 'IG-05', 'IG-06']
  },
  {
    id: 'persona-natural',
    titulo: 'Persona natural',
    descripcion: 'Datos cuando el titular es persona natural',
    campos: ['PN-01', 'PN-02', 'PN-03', 'PN-04', 'PN-05', 'PN-06', 'PN-07', 'PN-08', 'PN-09']
  },
  {
    id: 'persona-juridica',
    titulo: 'Persona jurídica',
    descripcion: 'Datos cuando el titular es persona jurídica',
    campos: ['PJ-01', 'PJ-02', 'PJ-03', 'PJ-04', 'PJ-05']
  },
  {
    id: 'empresa',
    titulo: 'Información de la empresa',
    descripcion: 'Datos de la empresa (para accionistas)',
    campos: ['EMP-01', 'EMP-02', 'EMP-03', 'EMP-04', 'EMP-05']
  },
  {
    id: 'informacion-personal',
    titulo: 'Información personal',
    descripcion: 'Datos personales (para vinculación de personal)',
    campos: ['IP-01', 'IP-02', 'IP-03', 'IP-04']
  },
  {
    id: 'jurisdiccion',
    titulo: 'Jurisdicción',
    descripcion: 'Ubicación nacional o internacional',
    campos: ['JU-01', 'JU-02', 'JU-03', 'JU-04']
  },
  {
    id: 'domicilio',
    titulo: 'Domicilio principal',
    descripcion: 'Dirección de contacto y representante legal',
    campos: ['DP-01', 'DP-02', 'DP-03', 'DP-04', 'DP-05', 'DP-06', 'DP-07', 'DP-08', 'DP-09', 'DP-10']
  },
  {
    id: 'financiera',
    titulo: 'Información financiera',
    descripcion: 'Datos económicos del titular',
    campos: ['IF-01', 'IF-02', 'IF-03']
  },
  {
    id: 'origen-fondos',
    titulo: 'Origen de fondos',
    descripcion: 'Procedencia de los recursos',
    campos: ['OF-01']
  },
  {
    id: 'perfil-transaccional',
    titulo: 'Perfil transaccional',
    descripcion: 'Operaciones esperadas con COTRANSMEQ',
    campos: ['PT-01', 'PT-02', 'PT-03', 'PT-04', 'PT-05a', 'PT-05b', 'PT-05c', 'PT-06']
  },
  {
    id: 'conflicto',
    titulo: 'Conflicto de intereses',
    descripcion: 'Relaciones con empleados, directivos y entidades públicas',
    campos: ['CI-01', 'CI-02', 'CI-03']
  },
  {
    id: 'declaraciones',
    titulo: 'Declaraciones SARLAFT y PTEE',
    descripcion: 'Manifestaciones de cumplimiento y veracidad',
    campos: ['DEC-01', 'DEC-02', 'DEC-03', 'DEC-04', 'DEC-04-1', 'DEC-04-2', 'DEC-04-3', 'DEC-04-4', 'DEC-05']
  }
]

// Tablas repetibles
export const TABLAS: Record<string, { seccionId: string; titulo: string; campos: string[] }> = {
  'CLI-CA__rows': { seccionId: 'composicion-accionaria', titulo: 'Composición accionaria', campos: ['CA-01', 'CA-02', 'CA-03', 'CA-04', 'CA-05', 'CA-06', 'CA-07', 'CA-08'] },
  'CLI-BF__rows': { seccionId: 'beneficiarios', titulo: 'Beneficiarios finales', campos: ['BF-01', 'BF-02', 'BF-03', 'BF-04', 'BF-05'] },
  'CLI-RF__rows': { seccionId: 'revisor-fiscal', titulo: 'Revisor fiscal', campos: ['RF-01', 'RF-02', 'RF-03', 'RF-04'] },
  'CLI-CTA__rows': { seccionId: 'cuentas', titulo: 'Cuentas bancarias', campos: ['CTA-01', 'CTA-02', 'CTA-03'] },
  'ACC-CA__rows': { seccionId: 'composicion-accionaria', titulo: 'Composición accionaria', campos: ['CA-01', 'CA-02', 'CA-03', 'CA-04', 'CA-05', 'CA-06', 'CA-07', 'CA-08'] },
  'ACC-BF__rows': { seccionId: 'beneficiarios', titulo: 'Beneficiarios finales', campos: ['BF-01', 'BF-02', 'BF-03', 'BF-04'] },
  'ACC-CTA__rows': { seccionId: 'cuentas', titulo: 'Cuentas bancarias', campos: ['CTA-01', 'CTA-02', 'CTA-03'] }
}

/**
 * Resuelve un ID lógico (sin prefijo) al ID real del backend según el tipo
 * de formulario. Devuelve `null` si el ID no aplica al tipo de formulario.
 *
 * Para clientes/proveedores, el tipo de cliente (Persona Natural/Jurídica)
 * determina qué prefijo usar (PN-* vs PJ-*). Si no se conoce el tipo de
 * cliente todavía, devuelve los candidatos en orden de prioridad.
 */
export function getKeysParaTipo(
  campoIdLogico: string,
  tipo: TipoFormularioSarlaft,
  tipoCliente: TipoClienteSarlaft = null
): string[] {
  const prefijo = tipo === 'cliente_proveedor' ? 'CLI' : tipo === 'accionistas' ? 'ACC' : 'PER'

  // Mapeos específicos (no siguen el patrón prefijo-ID)
  const mapEspecial: Record<string, Record<TipoFormularioSarlaft, string | string[]>> = {
    'IG-01': {
      cliente_proveedor: tipoCliente === 'Persona Jurídica' ? ['CLI-PJ-01', 'CLI-PN-01'] : ['CLI-PN-01', 'CLI-PJ-01'],
      accionistas: 'ACC-EMP-01',
      personal: 'PER-IG-01'
    },
    'IG-02': {
      cliente_proveedor: tipoCliente === 'Persona Jurídica' ? ['CLI-PJ-02', 'CLI-PN-02'] : ['CLI-PN-02', 'CLI-PJ-02'],
      accionistas: 'ACC-EMP-02',
      personal: 'PER-IG-02'
    },
    'IG-03': {
      cliente_proveedor: ['CLI-IG-03', 'CLI-DP-07'],
      accionistas: 'ACC-IG-03',
      personal: 'PER-IG-03'
    },
    'IG-04': {
      cliente_proveedor: ['CLI-DP-07'],
      accionistas: 'ACC-IG-04',
      personal: 'PER-IG-04'
    },
    'IG-05': {
      cliente_proveedor: ['CLI-IG-05'],
      accionistas: 'ACC-IG-05',
      personal: 'PER-IG-05'
    },
    'IG-06': {
      cliente_proveedor: ['CLI-IG-02'],
      accionistas: 'ACC-IG-06',
      personal: 'PER-IG-06'
    },
    'DEC-04-1': {
      cliente_proveedor: 'CLI-DEC-04-1',
      accionistas: 'ACC-DEC-04-1',
      personal: 'PER-DEC-04-1'
    },
    'DEC-04-2': {
      cliente_proveedor: 'CLI-DEC-04-2',
      accionistas: 'ACC-DEC-04-2',
      personal: 'PER-DEC-04-2'
    },
    'DEC-04-3': {
      cliente_proveedor: 'CLI-DEC-04-3',
      accionistas: 'ACC-DEC-04-3',
      personal: 'PER-DEC-04-3'
    },
    'DEC-04-4': {
      cliente_proveedor: 'CLI-DEC-04-4',
      accionistas: 'ACC-DEC-04-4',
      personal: 'PER-DEC-04-4'
    },
    'ENC-04': {
      cliente_proveedor: 'CLI-ENC-04',
      accionistas: 'ACC-ENC-04',
      personal: 'PER-ENC-04'
    },
    'ENC-03': {
      cliente_proveedor: 'CLI-ENC-03',
      accionistas: 'ACC-ENC-03',
      personal: 'PER-ENC-03'
    },
    'ENC-02': {
      cliente_proveedor: 'CLI-ENC-02',
      accionistas: 'ACC-ENC-02',
      personal: 'PER-ENC-02'
    },
    'ENC-01': {
      cliente_proveedor: 'CLI-ENC-01',
      accionistas: 'ACC-ENC-01',
      personal: 'PER-ENC-01'
    }
  }

  if (mapEspecial[campoIdLogico]) {
    const v = mapEspecial[campoIdLogico][tipo]
    return Array.isArray(v) ? v : [v]
  }

  // Default: prepender prefijo del tipo (CLI-/ACC-/PER-)
  return [`${prefijo}-${campoIdLogico}`]
}
