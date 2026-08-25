/**
 * Contrato de formularios dinámicos en el cliente.
 *
 * ESPEJO de `backend-nest/src/modules/formularios-dinamicos/domain/`. Los dos
 * repositorios son paquetes npm distintos, así que no hay import posible; lo que
 * hay es una copia deliberada de los literales y los tipos.
 *
 * Qué se copia y qué no, y por qué:
 *
 *  - **Literales y tipos** (aquí): el runner tiene que saber qué es un
 *    `SINGLE_CHOICE` estando en modo avión.
 *  - **Evaluación de reglas y validación de respuestas** (`rules.ts`,
 *    `validate-answers.ts`): también offline. Sin ellas el conductor no sabría
 *    qué campos se le piden hasta recuperar señal.
 *  - **Validación de la DEFINICIÓN**: NO se copia. La ejecuta el backend y la
 *    devuelve en `meta.validation` de cada guardado y en `/validate`. El builder
 *    solo se usa con red, así que duplicar 700 líneas que se desincronizarían no
 *    compra nada.
 *
 * Si se añade un tipo de campo hay que tocar TRES sitios: este archivo, el
 * `domain/field-types.ts` del backend y el CHECK `ck_form_fields_type` de la
 * migración.
 */

export const FIELD_TYPES = [
	'SHORT_TEXT',
	'LONG_TEXT',
	'INTEGER',
	'DECIMAL',
	'DATE',
	'TIME',
	'DATETIME',
	'SINGLE_CHOICE',
	'MULTIPLE_CHOICE',
	'BOOLEAN',
	'SIGNATURE',
	'PHOTO',
	'FILE',
	'LOCATION',
	'INFO',
	'REPEATABLE_GROUP',
	'MATRIX',
	'LOOKUP',
	'CALCULATED'
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type AnswerSlot =
	| 'value_text'
	| 'value_decimal'
	| 'value_boolean'
	| 'value_date'
	| 'value_datetime'
	| 'value_json'
	| 'options'
	| 'attachment'
	| 'none';

export interface FieldCapability {
	options: boolean;
	children: boolean;
	repeatable: boolean;
	attachment: boolean;
	slot: AnswerSlot;
}

const cap = (slot: AnswerSlot, over: Partial<FieldCapability> = {}): FieldCapability => ({
	options: false,
	children: false,
	repeatable: false,
	attachment: false,
	slot,
	...over
});

export const FIELD_CAPABILITIES: Record<FieldType, FieldCapability> = {
	SHORT_TEXT: cap('value_text'),
	LONG_TEXT: cap('value_text'),
	INTEGER: cap('value_decimal'),
	DECIMAL: cap('value_decimal'),
	DATE: cap('value_date'),
	TIME: cap('value_text'),
	DATETIME: cap('value_datetime'),
	SINGLE_CHOICE: cap('options', { options: true }),
	MULTIPLE_CHOICE: cap('options', { options: true }),
	BOOLEAN: cap('value_boolean'),
	SIGNATURE: cap('attachment', { attachment: true }),
	PHOTO: cap('attachment', { attachment: true }),
	FILE: cap('attachment', { attachment: true }),
	LOCATION: cap('value_json'),
	INFO: cap('none'),
	REPEATABLE_GROUP: cap('none', { children: true, repeatable: true }),
	MATRIX: cap('none', { children: true, repeatable: true }),
	LOOKUP: cap('value_json'),
	CALCULATED: cap('value_decimal')
};

export function capabilitiesOf(type: FieldType): FieldCapability {
	return FIELD_CAPABILITIES[type] ?? cap('value_text');
}

export function isFieldType(value: unknown): value is FieldType {
	return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

export function isContainer(type: FieldType): boolean {
	return capabilitiesOf(type).children;
}

export function isAnswerable(type: FieldType): boolean {
	return capabilitiesOf(type).slot !== 'none';
}

/** Etiqueta e icono de cada tipo en la paleta del builder. */
export const FIELD_TYPE_META: Record<
	FieldType,
	{ label: string; hint: string; icon: string; category: string }
> = {
	SHORT_TEXT: { label: 'Texto corto', hint: 'Placa, sede, cargo', icon: 'type', category: 'Básicos' },
	LONG_TEXT: { label: 'Texto largo', hint: 'Observaciones', icon: 'align-left', category: 'Básicos' },
	INTEGER: { label: 'Número entero', hint: 'Kilometraje, cantidad', icon: 'hash', category: 'Básicos' },
	DECIMAL: { label: 'Número decimal', hint: 'Horas, litros', icon: 'percent', category: 'Básicos' },
	BOOLEAN: { label: 'Sí / No', hint: 'Confirmación simple', icon: 'toggle', category: 'Básicos' },
	SINGLE_CHOICE: {
		label: 'Opción única',
		hint: 'C / NC / NA, B / M / R',
		icon: 'radio',
		category: 'Selección'
	},
	MULTIPLE_CHOICE: {
		label: 'Opción múltiple',
		hint: 'Elementos, categorías',
		icon: 'check-square',
		category: 'Selección'
	},
	DATE: { label: 'Fecha', hint: 'Inspección, vencimiento', icon: 'calendar', category: 'Fecha y hora' },
	TIME: { label: 'Hora', hint: 'Inicio de jornada', icon: 'clock', category: 'Fecha y hora' },
	DATETIME: { label: 'Fecha y hora', hint: 'Cierre, ocurrencia', icon: 'calendar-clock', category: 'Fecha y hora' },
	PHOTO: { label: 'Fotografía', hint: 'Registro visual', icon: 'camera', category: 'Evidencia' },
	FILE: { label: 'Archivo', hint: 'PDF de soporte', icon: 'paperclip', category: 'Evidencia' },
	SIGNATURE: { label: 'Firma', hint: 'Quien inspecciona / recibe', icon: 'pen', category: 'Evidencia' },
	LOCATION: { label: 'Ubicación', hint: 'GPS del punto', icon: 'map-pin', category: 'Evidencia' },
	INFO: { label: 'Texto informativo', hint: 'Instrucción, declaración', icon: 'info', category: 'Estructura' },
	REPEATABLE_GROUP: {
		label: 'Grupo repetible',
		hint: 'Hallazgos, plan de acción',
		icon: 'layers',
		category: 'Estructura'
	},
	MATRIX: { label: 'Matriz', hint: 'Lista de ítems C/NC/NA', icon: 'grid', category: 'Estructura' },
	LOOKUP: { label: 'Referencia', hint: 'Conductor, vehículo', icon: 'link', category: 'Avanzados' },
	CALCULATED: { label: 'Calculado', hint: 'Total, porcentaje', icon: 'sigma', category: 'Avanzados' }
};

export const PALETTE_CATEGORIES = [
	'Básicos',
	'Selección',
	'Fecha y hora',
	'Evidencia',
	'Estructura',
	'Avanzados'
] as const;

export const LOOKUP_SOURCES = ['CONDUCTOR', 'VEHICLE', 'SERVICE'] as const;
export type LookupSource = (typeof LOOKUP_SOURCES)[number];

// ─── Reglas ──────────────────────────────────────────────────────────────────

export const RULE_OPERATORS = [
	'equals',
	'notEquals',
	'in',
	'notIn',
	'exists',
	'gt',
	'gte',
	'lt',
	'lte'
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const RULE_ACTIONS = ['show', 'hide', 'require', 'disable'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
	equals: 'es igual a',
	notEquals: 'es distinto de',
	in: 'está entre',
	notIn: 'no está entre',
	exists: 'tiene respuesta',
	gt: 'es mayor que',
	gte: 'es mayor o igual que',
	lt: 'es menor que',
	lte: 'es menor o igual que'
};

export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
	show: 'mostrar',
	hide: 'ocultar',
	require: 'exigir',
	disable: 'deshabilitar'
};

export const ARRAY_OPERATORS: readonly RuleOperator[] = ['in', 'notIn'];
export const NUMERIC_OPERATORS: readonly RuleOperator[] = ['gt', 'gte', 'lt', 'lte'];
export const VALUELESS_OPERATORS: readonly RuleOperator[] = ['exists'];

export interface RuleCondition {
	fieldKey: string;
	operator: RuleOperator;
	value?: unknown;
}

export interface RuleEffect {
	action: RuleAction;
	targetFieldKey?: string;
}

export interface Rule {
	version: number;
	all?: RuleCondition[];
	any?: RuleCondition[];
	effect: RuleEffect;
}

// ─── DTOs de la API ──────────────────────────────────────────────────────────

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface FormOptionDto {
	id: string;
	value: string;
	label: string;
	color: string | null;
	score: number | null;
	sortOrder: number;
	metadata: Record<string, unknown>;
}

export interface FormFieldDto {
	id: string;
	key: string;
	parentFieldId: string | null;
	type: FieldType;
	label: string;
	helpText: string | null;
	placeholder: string | null;
	required: boolean;
	sortOrder: number;
	config: Record<string, unknown>;
	validation: FieldValidationConfig & Record<string, unknown>;
	visibilityRule: Rule | null;
	defaultValue: unknown;
	options: FormOptionDto[];
	children: FormFieldDto[];
}

export interface FormSectionDto {
	id: string;
	key: string;
	title: string;
	description: string | null;
	sortOrder: number;
	settings: Record<string, unknown>;
	fields: FormFieldDto[];
}

export interface FormVersionSummaryDto {
	id: string;
	formId: string;
	versionNumber: number;
	status: VersionStatus;
	title: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	archivedAt: string | null;
}

export interface FormVersionDto extends FormVersionSummaryDto {
	description: string | null;
	instructions: string | null;
	settings: Record<string, unknown>;
	sourceMetadata: Record<string, unknown>;
	sections: FormSectionDto[];
}

export interface FormDefinitionDto {
	id: string;
	code: string;
	slug: string;
	name: string;
	description: string | null;
	ownerArea: string;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
	activeVersion: FormVersionSummaryDto | null;
	draftVersion: FormVersionSummaryDto | null;
	versions?: FormVersionSummaryDto[];
	counts?: { assignments: number; submissions: number };
}

export interface FieldValidationConfig {
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	precision?: number;
	maxFiles?: number;
	minRows?: number;
	maxRows?: number;
	minSelected?: number;
	maxSelected?: number;
	pattern?: string;
}

// ─── Validación devuelta por el backend ──────────────────────────────────────

export interface ValidationIssue {
	code: string;
	severity: 'error' | 'warning';
	message: string;
	/** Ruta en el árbol, p. ej. `sections[0].fields[2].options[1]`. */
	path: string;
	meta?: Record<string, unknown>;
}

export interface DefinitionValidationResult {
	valid: boolean;
	errors: ValidationIssue[];
	warnings: ValidationIssue[];
}

// ─── Asignaciones ────────────────────────────────────────────────────────────

export const ASSIGNMENT_FREQUENCIES = [
	'ON_DEMAND',
	'ONCE',
	'DAILY',
	'WEEKLY',
	'MONTHLY',
	'PER_SERVICE'
] as const;
export type AssignmentFrequency = (typeof ASSIGNMENT_FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<AssignmentFrequency, string> = {
	ON_DEMAND: 'Cuando se necesite',
	ONCE: 'Una sola vez',
	DAILY: 'Diario',
	WEEKLY: 'Semanal',
	MONTHLY: 'Mensual',
	PER_SERVICE: 'Por servicio'
};

export const LIMIT_POLICIES = ['UNLIMITED', 'ONE_PER_PERIOD', 'ONE_PER_CONTEXT'] as const;
export type LimitPolicy = (typeof LIMIT_POLICIES)[number];

export const LIMIT_POLICY_LABELS: Record<LimitPolicy, string> = {
	UNLIMITED: 'Sin límite',
	ONE_PER_PERIOD: 'Uno por período',
	ONE_PER_CONTEXT: 'Uno por período y contexto'
};

export const TARGET_TYPES = ['ALL_CONDUCTORS', 'CONDUCTOR', 'VEHICLE', 'SEDE', 'GROUP'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const TARGET_TYPE_LABELS: Record<TargetType, string> = {
	ALL_CONDUCTORS: 'Todos los conductores',
	CONDUCTOR: 'Conductor específico',
	VEHICLE: 'Vehículo',
	SEDE: 'Sede',
	GROUP: 'Grupo'
};

export type AssignmentStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
	ACTIVE: 'Activa',
	PAUSED: 'Pausada',
	CLOSED: 'Cerrada'
};

export interface AssignmentTargetDto {
	id: string;
	type: TargetType;
	conductorId: string | null;
	vehicleId: string | null;
	sede: string | null;
	groupKey: string | null;
	conductor: { id: string; nombre: string } | null;
	vehiculo: { id: string; placa: string } | null;
}

export interface AssignmentDto {
	id: string;
	versionId: string;
	name: string;
	status: AssignmentStatus;
	frequency: AssignmentFrequency;
	limitPolicy: LimitPolicy;
	timezone: string;
	startsAt: string | null;
	endsAt: string | null;
	contextSchema: Record<string, { required?: boolean }>;
	settings: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	targets: AssignmentTargetDto[];
	version: {
		id: string;
		formId: string;
		versionNumber: number;
		status: VersionStatus;
		title: string;
		code: string | null;
	} | null;
	submissionCount?: number;
}

// ─── Envíos ──────────────────────────────────────────────────────────────────

export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'VOIDED';

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
	DRAFT: 'Borrador',
	SUBMITTED: 'Entregado',
	VOIDED: 'Anulado'
};

export type AttachmentKind = 'PHOTO' | 'FILE' | 'SIGNATURE';
export type AttachmentStatus = 'PENDING' | 'UPLOADED' | 'FAILED';

export interface AnswerDto {
	id: string;
	fieldId: string;
	fieldKey: string | null;
	occurrenceId: string | null;
	rowIndex: number | null;
	value: unknown;
	optionValues: string[];
}

export interface AttachmentDto {
	id: string;
	clientAttachmentId: string;
	answerId: string | null;
	kind: AttachmentKind;
	status: AttachmentStatus;
	mimeType: string;
	byteSize: number | null;
	sha256: string;
	originalName: string | null;
	metadata: Record<string, unknown>;
	createdAt: string | null;
	uploadedAt: string | null;
	/** URL firmada; caduca. Nunca se guarda en Cache Storage. */
	url: string | null;
}

export interface SubmissionEventDto {
	id: string;
	eventType: string;
	actorType: 'CONDUCTOR' | 'USER' | 'SYSTEM';
	actorId: string | null;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface SubmissionSummaryDto {
	id: string;
	clientSubmissionId: string;
	assignmentId: string;
	versionId: string;
	conductorId: string;
	vehicleId: string | null;
	serviceId: string | null;
	supersedesSubmissionId: string | null;
	status: SubmissionStatus;
	businessDate: string | null;
	periodKey: string | null;
	context: Record<string, unknown>;
	startedAt: string | null;
	submittedAt: string | null;
	/** Última escritura. En un borrador, hasta cuándo respaldó el teléfono. */
	updatedAt: string | null;
	voidedAt: string | null;
	voidReason: string | null;
	conductor: { id: string; nombre: string; numeroIdentificacion: string | null } | null;
	vehiculo: { id: string; placa: string } | null;
	assignment: { id: string; name: string; frequency: AssignmentFrequency } | null;
	version: {
		id: string;
		formId: string;
		versionNumber: number;
		title: string;
		code: string | null;
	} | null;
	attachmentCount?: number;
	answerCount?: number;
}

export interface SubmissionDetailDto extends SubmissionSummaryDto {
	device: Record<string, unknown>;
	answers: AnswerDto[];
	attachments: AttachmentDto[];
	events: SubmissionEventDto[];
}

// ─── Plantillas ──────────────────────────────────────────────────────────────

export interface FieldTemplateDto {
	id: string;
	name: string;
	category: string;
	fieldType: FieldType;
	template: Partial<FormFieldDto>;
	ownerArea: string | null;
	isGlobal: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

// ─── Límites (espejo de `domain/limits.ts`) ───────────────────────────────────

export const DEFINITION_LIMITS = {
	maxSections: 60,
	maxFieldsPerVersion: 800,
	maxFieldsPerSection: 300,
	maxOptionsPerField: 300,
	maxChildrenPerContainer: 120,
	maxConditionsPerRule: 20,
	maxNestingDepth: 2,
	maxKeyLength: 120,
	maxLabelLength: 500,
	maxTitleLength: 255
} as const;

export const SUBMISSION_LIMITS = {
	maxAnswersPerSubmission: 5000,
	maxAttachmentsPerSubmission: 60,
	maxOccurrencesPerContainer: 200,
	maxTextLength: 20000
} as const;

export const ATTACHMENT_LIMITS = {
	maxPhotoBytes: 10 * 1024 * 1024,
	maxFileBytes: 25 * 1024 * 1024,
	maxSignatureBytes: 2 * 1024 * 1024,
	maxDraftBytes: 100 * 1024 * 1024,
	/** Lado máximo tras comprimir una foto en el dispositivo. */
	photoMaxEdge: 1920,
	photoQuality: 0.82,
	allowedPhotoMime: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
	allowedSignatureMime: ['image/png', 'image/webp'] as readonly string[],
	allowedFileMime: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as readonly string[]
} as const;

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const OPTION_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Normaliza un texto libre a una `key` válida.
 *
 * El builder la propone desde la etiqueta para que HSEQ no tenga que inventar
 * claves; el usuario puede editarla mientras el borrador siga en DRAFT. Una vez
 * publicada, cambiarla rompería las reglas que la referencian y los informes
 * históricos, así que el inspector la bloquea.
 */
export function toKey(texto: string, fallback = 'campo'): string {
	const base = texto
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/^(\d)/, 'c$1')
		.slice(0, DEFINITION_LIMITS.maxKeyLength);
	return base || fallback;
}

/** Códigos de error del backend que el cliente distingue por comportamiento. */
export type FormErrorCode =
	| 'FORM_NOT_FOUND'
	| 'VERSION_NOT_FOUND'
	| 'ASSIGNMENT_NOT_FOUND'
	| 'SUBMISSION_NOT_FOUND'
	| 'ATTACHMENT_NOT_FOUND'
	| 'TEMPLATE_NOT_FOUND'
	| 'VERSION_IMMUTABLE'
	| 'VERSION_NOT_PUBLISHED'
	| 'VERSION_ARCHIVED'
	| 'REVISION_CONFLICT'
	| 'FORM_HAS_ACTIVE_ASSIGNMENTS'
	| 'FORM_CODE_TAKEN'
	| 'FORM_DEFINITION_INVALID'
	| 'FIELD_RULE_CYCLE'
	| 'FIELD_VALUE_INVALID'
	| 'ASSIGNMENT_NOT_AVAILABLE'
	| 'ASSIGNMENT_TARGET_DENIED'
	| 'ASSIGNMENT_CONTEXT_REQUIRED'
	| 'SUBMISSION_LIMIT_REACHED'
	| 'SUBMISSION_IMMUTABLE'
	| 'SUBMISSION_ALREADY_VOIDED'
	| 'IDEMPOTENCY_PAYLOAD_MISMATCH'
	| 'ATTACHMENT_MISSING'
	| 'ATTACHMENT_HASH_MISMATCH'
	| 'ATTACHMENT_TOO_LARGE'
	| 'ATTACHMENT_TYPE_NOT_ALLOWED'
	| 'PAYLOAD_TOO_LARGE'
	| 'FORBIDDEN'
	| 'VALIDATION_ERROR'
	| 'INTERNAL_ERROR';
