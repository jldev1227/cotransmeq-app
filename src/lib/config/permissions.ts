/**
 * Sistema de permisos por área - Config compartida frontend
 */

export type AccessLevel = 'full' | 'read' | 'limited';

export type Area =
	| 'administracion'
	| 'operaciones'
	| 'contabilidad'
	| 'facturacion'
	| 'talento_humano'
	| 'hseq'
	| 'mantenimiento';

export const AREA_LABELS: Record<Area, string> = {
	administracion: 'Administración',
	operaciones: 'Operaciones',
	contabilidad: 'Contabilidad',
	facturacion: 'Facturación',
	talento_humano: 'Talento Humano',
	hseq: 'HSEQ',
	mantenimiento: 'Mantenimiento'
};

/**
 * Lista canónica de áreas, para poblar desplegables.
 *
 * Se DERIVA de `AREA_LABELS` en vez de escribirse otra vez: es la misma
 * información, y el espejo del backend documenta que cuando se añadió
 * `mantenimiento` había cuatro copias del array y tres se quedaron sin
 * actualizar. Una copia menos es un sitio menos donde olvidarse.
 */
export const AREAS = Object.keys(AREA_LABELS) as Area[];

export interface RoutePermission {
	full: Area[];
	read?: Area[];
	limited?: Area[];
	/** Permite asignar `limited` en la lista blanca individual para acciones puntuales. */
	allowLimited?: boolean;
	description?: string;
}

export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = {
	// Panel de inicio y registro de actividad: todas las áreas entran; lo que cada uno ve
	// adentro lo decide el backend sección por sección según sus módulos.
	dashboard: {
		full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
		description: 'Panel de inicio'
	},
	actividad: {
		full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
		description: 'Actividad reciente del equipo'
	},
	perfil: {
		full: [
			'administracion',
			'operaciones',
			'contabilidad',
			'facturacion',
			'talento_humano',
			'hseq',
			'mantenimiento'
		],
		description: 'Mi perfil'
	},
	flota: {
		full: [
			'administracion',
			'operaciones',
			'contabilidad',
			'facturacion',
			'talento_humano',
			'hseq',
			'mantenimiento'
		],
		description: 'Gestión de flota vehicular'
	},
	conductores: {
		full: [
			'administracion',
			'operaciones',
			'contabilidad',
			'facturacion',
			'talento_humano',
			'hseq',
			'mantenimiento'
		],
		description: 'Gestión de conductores'
	},
	servicios: {
		full: ['administracion', 'operaciones'],
		read: ['hseq', 'talento_humano', 'facturacion'],
		description: 'Gestión de servicios de transporte'
	},
	recargos: {
		full: ['administracion', 'operaciones'],
		read: ['talento_humano'],
		allowLimited: true,
    description: 'Planillas: consulta para talento humano; nivel limitado permite adjuntar soporte sin editar'
	},
	clientes: {
		full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
		description: 'Gestión de clientes/empresas'
	},
	sarlaft: {
		full: ['administracion', 'talento_humano'],
		description: 'Formularios SARLAFT + PTEE (cumplimiento)'
	},
	// Bandeja de las solicitudes del formulario público de la landing.
	// Espejo EXACTO del backend (`config/permissions.ts`).
	solicitudes: {
		full: ['administracion', 'operaciones'],
		read: ['facturacion', 'contabilidad'],
		description: 'Solicitudes web (cotizaciones y servicios desde la landing)'
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
	viaticos: {
		full: ['administracion', 'operaciones'],
		read: ['contabilidad'],
		description: 'Anticipos de viáticos y gastos de conductores'
	},
	// Espejo EXACTO de `backend-nest/src/config/permissions.ts`. Este mapa solo
	// decide qué se PINTA; el backend lo vuelve a comprobar en cada ruta. Si los
	// dos no coinciden, el sidebar muestra una entrada que la API rechaza con 403
	// (o al contrario, esconde algo a quien sí puede usarlo).
	encuestas: {
		full: ['administracion', 'hseq', 'operaciones'],
		read: ['contabilidad', 'talento_humano'],
		description: 'Encuestas públicas, respuestas y reportes'
	},
	formularios: {
		full: ['administracion', 'hseq'],
		read: ['operaciones'],
		description: 'Formularios dinámicos (constructor, asignaciones y envíos)'
	},

	/**
	 * Diligenciar lo que a uno le asignaron.
	 *
	 * Módulo APARTE de `formularios`. `formularios`
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
		full: [
			'administracion',
			'operaciones',
			'contabilidad',
			'facturacion',
			'talento_humano',
			'hseq',
			'mantenimiento'
		],
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
	// El canvas de RECORRIDOS es un módulo aparte de `conductores` a propósito.
	// `conductores` permite la ficha del conductor a todas las áreas,
	// y eso vale para consultar la ficha de un conductor, pero no para reescribir
	// sus recorridos: la hoja alimenta los bonos y el pernocte que acaban en la
	// nómina, así que editarla es una operación contable, no una consulta.
	//
	// Administración edita. Operaciones consulta; el rol heredado no concede edición.
	//
	// Espejo EXACTO de `backend-cotransmeq/src/config/permissions.ts`. Si aquí y
	// allí no coinciden, el sidebar muestra una entrada que la API rechaza con 403.
	recorridos: {
		full: ['administracion'],
		read: ['operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
		description: 'Canvas de recorridos, días laborados de conductores y bonos de planilla'
	},

	'liquidaciones-servicios': {
		full: ['administracion', 'operaciones'],
		limited: ['facturacion'],
		description: 'Liquidaciones de servicios'
	},
	'liquidaciones-servicios-seccion06': {
		full: ['administracion'],
		read: ['operaciones', 'facturacion'],
		description: 'SECCIÓN 06 — Hoja 4: liquidación de terceros'
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
	certificados: {
		full: ['administracion', 'contabilidad'],
		description: 'Certificados tributarios de terceros'
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
	// Módulos de octubre de 2026. Cada uno con su propia llave para poder
	// concederlo o quitarlo aparte; espejo EXACTO en el `config/permissions.ts`
	// del backend.
	mantenimiento: {
		full: ['administracion', 'mantenimiento'],
		read: ['operaciones', 'hseq'],
		description: 'Planes y órdenes de mantenimiento de la flota'
	},

	combustible: {
		full: ['administracion', 'operaciones', 'mantenimiento'],
		read: ['contabilidad', 'hseq'],
		description: 'Tanqueos y rendimiento de combustible'
	},

	incidentes: {
		full: ['administracion', 'hseq'],
		read: ['operaciones', 'mantenimiento', 'talento_humano'],
		description: 'Accidentes e incidentes con su investigación'
	},

	cartera: {
		full: ['administracion', 'facturacion', 'contabilidad'],
		read: ['operaciones'],
		description: 'Cuentas por cobrar, abonos y edades de cartera'
	},

	directorio: {
		full: ['administracion'],
		description: 'Directorio del equipo — presencia e invitaciones'
	}
};

/** `null` hereda el área; un objeto limita lo permitido y `{}` deja solo el perfil. */
export type PermisosRutas = Record<string, AccessLevel> | null | undefined;
const NIVELES_VALIDOS: readonly AccessLevel[] = ['full', 'read', 'limited'];

export const OMAR_OPERACIONES_ID = '77c70289-a726-4b4d-bde9-d1997f9e471f';
export const PERMISOS_RUTA_ESPECIALES: Record<string, Record<string, AccessLevel>> = {
	[OMAR_OPERACIONES_ID]: {
		recorridos: 'full',
		'liquidaciones-servicios-seccion06': 'full'
	}
};

export function normalizarRutasOverride(valor: unknown): Record<string, AccessLevel> | null {
	if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
	const limpio: Record<string, AccessLevel> = {};
	for (const [moduleId, nivel] of Object.entries(valor as Record<string, unknown>)) {
		const permiso = ROUTE_PERMISSIONS[moduleId];
		if (!permiso || !NIVELES_VALIDOS.includes(nivel as AccessLevel)) continue;
		if (nivel === 'limited' && !permiso.allowLimited && !permiso.limited?.length) continue;
		limpio[moduleId] = nivel as AccessLevel;
	}
	return limpio;
}

/** Resuelve el nivel base del área y aplica `permisos_rutas` solo como límite. */
export function checkAccess(
	userAreas: Area[] | Area | null | undefined,
	moduleId: string,
	rutasOverride?: PermisosRutas,
	userId?: string | null
): { allowed: boolean; level: AccessLevel | null } {
	const permission = ROUTE_PERMISSIONS[moduleId];
	if (!permission) return { allowed: false, level: null };
	const areas: Area[] = !userAreas ? [] : Array.isArray(userAreas) ? userAreas : [userAreas];
	if (areas.length === 0) return { allowed: false, level: null };

	let nivelArea: AccessLevel | null = null;
	if (areas.some((area) => permission.full.includes(area))) nivelArea = 'full';
	const permisoEspecial = userId ? PERMISOS_RUTA_ESPECIALES[userId]?.[moduleId] : undefined;
	if (!nivelArea && permisoEspecial && areas.includes('operaciones')) nivelArea = permisoEspecial;
	if (!nivelArea && permission.read && areas.some((area) => permission.read!.includes(area))) nivelArea = 'read';
	if (!nivelArea && permission.limited && areas.some((area) => permission.limited!.includes(area))) nivelArea = 'limited';
	if (!nivelArea) return { allowed: false, level: null };

	const override = normalizarRutasOverride(rutasOverride);
	if (!override || moduleId === 'perfil') return { allowed: true, level: nivelArea };
	const nivelUsuario = override[moduleId];
	if (!nivelUsuario) return { allowed: false, level: null };
	const jerarquia: AccessLevel[] = ['limited', 'read', 'full'];
	return {
		allowed: true,
		level: jerarquia[Math.min(jerarquia.indexOf(nivelArea), jerarquia.indexOf(nivelUsuario))]
	};
}

export function getAccessibleModules(
	userAreas: Area[] | Area | null | undefined,
	rutasOverride?: PermisosRutas,
	userId?: string | null
): Record<string, AccessLevel> {
	const modules: Record<string, AccessLevel> = {};
	for (const moduleId of Object.keys(ROUTE_PERMISSIONS)) {
		const { allowed, level } = checkAccess(userAreas, moduleId, rutasOverride, userId);
		if (allowed && level) modules[moduleId] = level;
	}
	return modules;
}
