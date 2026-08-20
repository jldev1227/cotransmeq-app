/**
 * Validación de respuestas en el cliente.
 *
 * ESPEJO de `validateSubmissionAnswers` del backend
 * (`formularios-respuestas.ts`). El servidor sigue siendo la autoridad y
 * revalida todo; esto existe para dos cosas que el servidor no puede dar:
 *
 *  1. **feedback inmediato** al salir de cada campo, sin viaje de red;
 *  2. **validación completa en modo avión**, antes de meter el envío en la
 *     outbox. Sin ella el conductor terminaría la inspección, la outbox
 *     sincronizaría horas después y el rechazo llegaría cuando ya no está frente
 *     al vehículo.
 *
 * Devuelve los mismos códigos que el backend (`REQUIRED`, `TYPE`,
 * `OPTION_UNKNOWN`, …) para que el resumen de errores sea idéntico venga de donde
 * venga.
 */

import {
	capabilitiesOf,
	isFieldType,
	SUBMISSION_LIMITS,
	type FieldValidationConfig,
	type FormFieldDto,
	type FormSectionDto
} from './types';
import { flattenSections, resolveFieldStates, type FlatField } from './rules';

/** Estado local de una respuesta en el runner. */
export interface DraftAnswer {
	fieldId: string;
	occurrenceId?: string | null;
	rowIndex?: number | null;
	value?: unknown;
	optionValues?: string[];
}

/** Adjunto local pendiente o subido. */
export interface DraftAttachment {
	clientAttachmentId: string;
	fieldId: string;
	occurrenceId?: string | null;
	kind: 'PHOTO' | 'FILE' | 'SIGNATURE';
	mimeType: string;
	byteSize: number;
}

export interface AnswerIssue {
	fieldId: string;
	fieldKey: string;
	occurrenceId: string | null;
	code: string;
	message: string;
}

export interface AnswerValidationResult {
	errors: AnswerIssue[];
	/** Campos visibles y exigidos, para el cálculo de progreso. */
	requiredVisible: { fieldId: string; occurrenceId: string | null }[];
	answeredRequired: number;
}

const vacio = (v: unknown): boolean =>
	v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Clave de una respuesta. Coincide con lo que los índices únicos parciales de la
 * base consideran duplicado (`submission_id, field_id[, occurrence_id]`).
 */
export const answerKey = (fieldId: string, occurrenceId: string | null | undefined): string =>
	`${fieldId}|${occurrenceId ?? ''}`;

export function validateAnswers(params: {
	sections: FormSectionDto[];
	answers: DraftAnswer[];
	attachments?: DraftAttachment[];
	/** `field` valida solo ese campo (feedback al salir); `all`, todo el envío. */
	scope?: { fieldId: string; occurrenceId: string | null } | 'all';
}): AnswerValidationResult {
	const errors: AnswerIssue[] = [];
	const requiredVisible: { fieldId: string; occurrenceId: string | null }[] = [];
	let answeredRequired = 0;

	const flat = flattenSections(params.sections);
	const porId = new Map(flat.map((f) => [f.field.id, f]));
	const porKey = new Map(flat.map((f) => [f.field.key, f.field]));

	const recibidas = new Map<string, DraftAnswer>();
	for (const answer of params.answers) {
		recibidas.set(answerKey(answer.fieldId, answer.occurrenceId), answer);
	}

	const valorDe = (key: string, occurrenceId: string | null): unknown => {
		const field = porKey.get(key);
		if (!field) return undefined;
		const enFila = occurrenceId ? recibidas.get(answerKey(field.id, occurrenceId)) : undefined;
		const answer = enFila ?? recibidas.get(answerKey(field.id, null));
		if (!answer) return undefined;
		if ((answer.optionValues ?? []).length) return answer.optionValues;
		return answer.value;
	};

	/// Ocurrencias declaradas por contenedor: se derivan de las respuestas, que
	/// es también como las cuenta el backend.
	const ocurrencias = new Map<string, Set<string>>();
	for (const answer of recibidas.values()) {
		const entrada = porId.get(answer.fieldId);
		if (!entrada?.parent || !answer.occurrenceId) continue;
		const set = ocurrencias.get(entrada.parent.id) ?? new Set<string>();
		set.add(answer.occurrenceId);
		ocurrencias.set(entrada.parent.id, set);
	}

	const adjuntosPorCampo = new Map<string, number>();
	for (const attachment of params.attachments ?? []) {
		const clave = answerKey(attachment.fieldId, attachment.occurrenceId);
		adjuntosPorCampo.set(clave, (adjuntosPorCampo.get(clave) ?? 0) + 1);
	}

	/// Los estados se resuelven una vez por contexto de ocurrencia: dentro de una
	/// fila de repetible, una condición mira las celdas de SU fila.
	const estadosPorContexto = new Map<string, ReturnType<typeof resolveFieldStates>>();
	const estadosDe = (occurrenceId: string | null) => {
		const clave = occurrenceId ?? '';
		if (!estadosPorContexto.has(clave)) {
			estadosPorContexto.set(clave, resolveFieldStates(flat, valorDe, occurrenceId));
		}
		return estadosPorContexto.get(clave)!;
	};

	const enAlcance = (fieldId: string, occurrenceId: string | null) =>
		params.scope === undefined ||
		params.scope === 'all' ||
		(params.scope.fieldId === fieldId && params.scope.occurrenceId === occurrenceId);

	const push = (
		field: FormFieldDto,
		occurrenceId: string | null,
		code: string,
		message: string
	) => errors.push({ fieldId: field.id, fieldKey: field.key, occurrenceId, code, message });

	for (const entrada of flat) {
		const { field, parent } = entrada;
		if (!isFieldType(field.type)) continue;
		const cap = capabilitiesOf(field.type);
		const validation = (field.validation ?? {}) as FieldValidationConfig;

		if (cap.children) {
			const estado = estadosDe(null).get(field.id)!;
			if (!estado.visible) continue;
			const filas = ocurrencias.get(field.id) ?? new Set<string>();

			if (enAlcance(field.id, null)) {
				if (estado.required) {
					requiredVisible.push({ fieldId: field.id, occurrenceId: null });
					if (filas.size > 0) answeredRequired += 1;
					else push(field, null, 'REQUIRED', `"${field.label}" necesita al menos una fila.`);
				}
				if (validation.minRows != null && filas.size > 0 && filas.size < validation.minRows) {
					push(field, null, 'MIN_ROWS', `"${field.label}" necesita al menos ${validation.minRows} filas.`);
				}
				if (validation.maxRows != null && filas.size > validation.maxRows) {
					push(field, null, 'MAX_ROWS', `"${field.label}" admite ${validation.maxRows} filas como máximo.`);
				}
				if (filas.size > SUBMISSION_LIMITS.maxOccurrencesPerContainer) {
					push(
						field,
						null,
						'MAX_ROWS',
						`"${field.label}" supera el máximo de ${SUBMISSION_LIMITS.maxOccurrencesPerContainer} filas.`
					);
				}
			}
			continue;
		}

		if (cap.slot === 'none') continue;

		const contextos: (string | null)[] = parent
			? [...(ocurrencias.get(parent.id) ?? new Set<string>())]
			: [null];

		for (const occurrenceId of contextos) {
			const estado = estadosDe(occurrenceId).get(field.id)!;
			if (!estado.visible) continue;
			if (!enAlcance(field.id, occurrenceId)) continue;

			if (estado.required) requiredVisible.push({ fieldId: field.id, occurrenceId });

			const answer = recibidas.get(answerKey(field.id, occurrenceId));
			const adjuntos = adjuntosPorCampo.get(answerKey(field.id, occurrenceId)) ?? 0;

			if (cap.attachment) {
				if (adjuntos > 0 && estado.required) answeredRequired += 1;
				if (estado.required && adjuntos === 0) {
					push(field, occurrenceId, 'REQUIRED', `"${field.label}" necesita evidencia.`);
				}
				const maxFiles = validation.maxFiles ?? (field.type === 'SIGNATURE' ? 1 : undefined);
				if (maxFiles != null && adjuntos > maxFiles) {
					push(field, occurrenceId, 'MAX_FILES', `"${field.label}" admite ${maxFiles} archivo(s) como máximo.`);
				}
				continue;
			}

			const sinResponder = !answer || (vacio(answer.value) && (answer.optionValues ?? []).length === 0);
			if (sinResponder) {
				if (estado.required) push(field, occurrenceId, 'REQUIRED', `"${field.label}" es obligatorio.`);
				continue;
			}
			if (estado.required) answeredRequired += 1;

			const tipo = checkType(field, answer!);
			if (tipo) {
				push(field, occurrenceId, tipo.code, tipo.message);
				continue;
			}
			const rango = checkRange(field, answer!, validation);
			if (rango) push(field, occurrenceId, rango.code, rango.message);
		}
	}

	return { errors, requiredVisible, answeredRequired };
}

/**
 * Comprobación de tipo.
 *
 * Estricta con los formatos por el mismo motivo que en el backend: `new
 * Date('01/02/2026')` da enero o febrero según la configuración regional, y esa
 * ambigüedad en un preoperacional no se puede auditar después.
 */
function checkType(field: FormFieldDto, answer: DraftAnswer): { code: string; message: string } | null {
	const raw = answer.value;

	switch (field.type) {
		case 'SHORT_TEXT':
		case 'LONG_TEXT':
			if (typeof raw !== 'string') return { code: 'TYPE', message: `"${field.label}" espera texto.` };
			if (raw.length > SUBMISSION_LIMITS.maxTextLength) {
				return { code: 'MAX_LENGTH', message: `"${field.label}" supera el máximo de caracteres.` };
			}
			return null;

		case 'TIME':
			return typeof raw === 'string' && RE_HORA.test(raw)
				? null
				: { code: 'TYPE', message: `"${field.label}" espera una hora HH:mm.` };

		case 'INTEGER':
		case 'DECIMAL':
		case 'CALCULATED': {
			const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
			if (!Number.isFinite(n)) return { code: 'TYPE', message: `"${field.label}" espera un número.` };
			if (field.type === 'INTEGER' && !Number.isInteger(n)) {
				return { code: 'TYPE', message: `"${field.label}" espera un número entero.` };
			}
			return null;
		}

		case 'BOOLEAN': {
			if (typeof raw === 'boolean') return null;
			const texto = String(raw).trim().toLowerCase();
			return ['true', 'si', 'sí', '1', 'false', 'no', '0'].includes(texto)
				? null
				: { code: 'TYPE', message: `"${field.label}" espera sí o no.` };
		}

		case 'DATE':
			return typeof raw === 'string' && RE_FECHA.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
				? null
				: { code: 'TYPE', message: `"${field.label}" espera una fecha YYYY-MM-DD.` };

		case 'DATETIME':
			return typeof raw === 'string' && !Number.isNaN(Date.parse(raw))
				? null
				: { code: 'TYPE', message: `"${field.label}" espera una fecha y hora.` };

		case 'SINGLE_CHOICE':
		case 'MULTIPLE_CHOICE': {
			const valores = (answer.optionValues ?? []).length
				? answer.optionValues!
				: Array.isArray(raw)
					? raw.map(String)
					: raw != null
						? [String(raw)]
						: [];
			if (field.type === 'SINGLE_CHOICE' && valores.length > 1) {
				return { code: 'TOO_MANY_OPTIONS', message: `"${field.label}" admite una sola opción.` };
			}
			const declaradas = new Set(field.options.map((o) => o.value));
			for (const valor of valores) {
				if (!declaradas.has(valor)) {
					return { code: 'OPTION_UNKNOWN', message: `"${valor}" no es una opción de "${field.label}".` };
				}
			}
			return null;
		}

		case 'LOCATION': {
			if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
				return { code: 'TYPE', message: `"${field.label}" espera una ubicación.` };
			}
			const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
			return typeof lat === 'number' &&
				typeof lng === 'number' &&
				Math.abs(lat) <= 90 &&
				Math.abs(lng) <= 180
				? null
				: { code: 'TYPE', message: `"${field.label}" espera lat/lng válidos.` };
		}

		case 'LOOKUP':
			if (typeof raw === 'string') return null;
			if (typeof raw === 'object' && raw !== null && typeof (raw as any).id === 'string') return null;
			return { code: 'TYPE', message: `"${field.label}" espera una referencia.` };

		default:
			return null;
	}
}

function checkRange(
	field: FormFieldDto,
	answer: DraftAnswer,
	validation: FieldValidationConfig
): { code: string; message: string } | null {
	const raw = answer.value;

	if (typeof raw === 'string' && ['SHORT_TEXT', 'LONG_TEXT'].includes(field.type)) {
		if (validation.minLength != null && raw.length < validation.minLength) {
			return { code: 'MIN_LENGTH', message: `"${field.label}" necesita al menos ${validation.minLength} caracteres.` };
		}
		if (validation.maxLength != null && raw.length > validation.maxLength) {
			return { code: 'MAX_LENGTH', message: `"${field.label}" admite ${validation.maxLength} caracteres como máximo.` };
		}
		if (validation.pattern) {
			try {
				if (!new RegExp(validation.pattern).test(raw)) {
					return { code: 'PATTERN', message: `"${field.label}" no tiene el formato esperado.` };
				}
			} catch {
				/// Un `pattern` que no compila es un error de la DEFINICIÓN, no del
				/// conductor: se ignora en vez de bloquear el envío.
			}
		}
	}

	if (['INTEGER', 'DECIMAL', 'CALCULATED'].includes(field.type)) {
		const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
		if (Number.isFinite(n)) {
			if (validation.min != null && n < validation.min) {
				return { code: 'MIN', message: `"${field.label}" debe ser al menos ${validation.min}.` };
			}
			if (validation.max != null && n > validation.max) {
				return { code: 'MAX', message: `"${field.label}" no puede pasar de ${validation.max}.` };
			}
			if (validation.precision != null) {
				const decimales = String(n).split('.')[1]?.length ?? 0;
				if (decimales > validation.precision) {
					return { code: 'PRECISION', message: `"${field.label}" admite ${validation.precision} decimal(es).` };
				}
			}
		}
	}

	if (field.type === 'MULTIPLE_CHOICE') {
		const n = (answer.optionValues ?? []).length;
		if (validation.minSelected != null && n < validation.minSelected) {
			return { code: 'MIN_SELECTED', message: `"${field.label}" necesita al menos ${validation.minSelected} opciones.` };
		}
		if (validation.maxSelected != null && n > validation.maxSelected) {
			return { code: 'MAX_SELECTED', message: `"${field.label}" admite ${validation.maxSelected} opciones como máximo.` };
		}
	}

	return null;
}

/**
 * Progreso del borrador, en porcentaje.
 *
 * Cuenta SOLO los campos visibles y obligatorios. Contar todos haría que un
 * preoperacional con 40 observaciones opcionales nunca llegara al 100 % y el
 * conductor no supiera si ya puede enviar.
 */
export function computeProgress(result: AnswerValidationResult): number {
	if (result.requiredVisible.length === 0) return 100;
	return Math.min(100, Math.round((result.answeredRequired / result.requiredVisible.length) * 100));
}
