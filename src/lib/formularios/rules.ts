/**
 * Evaluación de reglas condicionales en el cliente.
 *
 * ESPEJO de las funciones `esVisible` / `evaluarRegla` / `evaluarCondicion` de
 * `backend-nest/src/modules/formularios-dinamicos/formularios-respuestas.ts`.
 * Tienen que dar el MISMO resultado: si divergen, el runner pide un campo que el
 * servidor no exige (y el conductor se pelea con un error que no entiende) o al
 * contrario, deja pasar un envío que el servidor rechaza al sincronizar, con la
 * inspección ya hecha.
 *
 * Existe una copia en el cliente porque el runner funciona en modo avión: sin
 * esto, el conductor no sabría qué campos se le piden hasta recuperar señal.
 */

import type { FormFieldDto, FormSectionDto, Rule, RuleCondition } from './types';

/** Valor de una respuesta, indexado por `fieldKey` y ocurrencia. */
export type ValueLookup = (fieldKey: string, occurrenceId: string | null) => unknown;

const vacio = (v: unknown): boolean =>
	v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Índice plano de la definición, con el padre de cada campo. */
export interface FlatField {
	field: FormFieldDto;
	parent: FormFieldDto | null;
	section: FormSectionDto;
}

export function flattenSections(sections: FormSectionDto[]): FlatField[] {
	const out: FlatField[] = [];
	for (const section of sections) {
		const walk = (fields: FormFieldDto[], parent: FormFieldDto | null) => {
			for (const field of fields) {
				out.push({ field, parent, section });
				if (field.children?.length) walk(field.children, field);
			}
		};
		walk(section.fields, null);
	}
	return out;
}

/**
 * Estado de un campo según las reglas: visible, exigido y habilitado.
 *
 * Se resuelve todo de una pasada porque las cuatro acciones (`show`, `hide`,
 * `require`, `disable`) se leen del MISMO grafo de reglas. Calcularlas por
 * separado recorrería las reglas cuatro veces por campo, y el runner reevalúa en
 * cada pulsación de tecla.
 */
export interface FieldState {
	visible: boolean;
	/** `required` de la definición u obligado por una regla `require`. */
	required: boolean;
	disabled: boolean;
}

export function resolveFieldStates(
	flat: FlatField[],
	values: ValueLookup,
	occurrenceId: string | null = null
): Map<string, FieldState> {
	const estados = new Map<string, FieldState>();

	/// Estado base: lo que dice la definición sin reglas.
	for (const { field } of flat) {
		estados.set(field.id, { visible: true, required: field.required, disabled: false });
	}

	/// `show` es especial: si un campo tiene AL MENOS una regla `show`, pasa a
	/// estar oculto por defecto y solo se muestra si alguna se cumple. Las varias
	/// `show` se combinan con OR, porque son alternativas ("mostrar si NC" y
	/// "mostrar si NA") y con AND se anularían entre sí.
	const conShow = new Set<string>();
	const showCumplido = new Set<string>();

	const porKey = new Map<string, FormFieldDto>();
	for (const { field } of flat) porKey.set(field.key, field);

	for (const { field: dueño } of flat) {
		const rule = dueño.visibilityRule;
		if (!rule || typeof rule !== 'object' || !rule.effect) continue;

		const targetKey = rule.effect.targetFieldKey ?? dueño.key;
		const target = porKey.get(targetKey);
		if (!target) continue;

		const estado = estados.get(target.id)!;
		const cumple = evaluateRule(rule, occurrenceId, values);

		switch (rule.effect.action) {
			case 'show':
				conShow.add(target.id);
				if (cumple) showCumplido.add(target.id);
				break;
			case 'hide':
				if (cumple) estado.visible = false;
				break;
			case 'require':
				if (cumple) estado.required = true;
				break;
			case 'disable':
				if (cumple) estado.disabled = true;
				break;
		}
	}

	for (const id of conShow) {
		if (!showCumplido.has(id)) estados.get(id)!.visible = false;
	}

	/// Un hijo de un contenedor oculto está oculto. Se propaga después de
	/// resolver las reglas porque el contenedor puede haber quedado oculto por
	/// una de ellas.
	for (const { field, parent } of flat) {
		if (!parent) continue;
		if (!estados.get(parent.id)!.visible) estados.get(field.id)!.visible = false;
	}

	return estados;
}

export function evaluateRule(rule: Rule, occurrenceId: string | null, values: ValueLookup): boolean {
	const all = rule.all ?? [];
	const any = rule.any ?? [];
	/// Una regla sin condiciones NO se cumple. Tratarla como cierta haría que un
	/// `hide` mal construido ocultara el campo para siempre.
	if (all.length === 0 && any.length === 0) return false;

	const okAll = all.every((c) => evaluateCondition(c, occurrenceId, values));
	const okAny = any.length === 0 ? true : any.some((c) => evaluateCondition(c, occurrenceId, values));
	return okAll && okAny;
}

export function evaluateCondition(
	condition: RuleCondition,
	occurrenceId: string | null,
	values: ValueLookup
): boolean {
	const actual = values(condition.fieldKey, occurrenceId);
	const esperado = condition.value;

	/// Un valor multivaluado cumple si CUALQUIERA de sus elementos cumple:
	/// "si marcó derrame" no debe fallar porque además marcó otras casillas.
	const comparar = (fn: (v: unknown) => boolean): boolean =>
		Array.isArray(actual) ? actual.some(fn) : fn(actual);

	switch (condition.operator) {
		case 'exists':
			return Array.isArray(actual) ? actual.length > 0 : !vacio(actual);
		case 'equals':
			return comparar((v) => String(v) === String(esperado));
		case 'notEquals':
			return !comparar((v) => String(v) === String(esperado));
		case 'in':
			return Array.isArray(esperado) && comparar((v) => esperado.some((e) => String(e) === String(v)));
		case 'notIn':
			return Array.isArray(esperado) && !comparar((v) => esperado.some((e) => String(e) === String(v)));
		case 'gt':
		case 'gte':
		case 'lt':
		case 'lte': {
			const a = comparable(actual);
			const b = comparable(esperado);
			if (a === null || b === null) return false;
			if (condition.operator === 'gt') return a > b;
			if (condition.operator === 'gte') return a >= b;
			if (condition.operator === 'lt') return a < b;
			return a <= b;
		}
		default:
			return false;
	}
}

/** Número o fecha como número, para los operadores de orden. */
function comparable(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string' || value.trim() === '') return null;
	const n = Number(value);
	if (Number.isFinite(n)) return n;
	const t = Date.parse(value);
	return Number.isNaN(t) ? null : t;
}

/**
 * Campos que una regla afecta, para dibujar la dependencia en el builder.
 *
 * Devuelve pares `origen → destino` por `key`. Es lo que permite avisar "si
 * borras `estado` dejas huérfana la regla de `observacion`" antes de que el
 * publish lo rechace.
 */
export function ruleEdges(sections: FormSectionDto[]): { from: string; to: string; action: string }[] {
	const edges: { from: string; to: string; action: string }[] = [];
	for (const { field } of flattenSections(sections)) {
		const rule = field.visibilityRule;
		if (!rule?.effect) continue;
		const to = rule.effect.targetFieldKey ?? field.key;
		for (const condition of [...(rule.all ?? []), ...(rule.any ?? [])]) {
			if (!condition?.fieldKey) continue;
			edges.push({ from: condition.fieldKey, to, action: rule.effect.action });
		}
	}
	return edges;
}
